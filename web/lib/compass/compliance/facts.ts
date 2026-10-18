// Facts adapters — turn a vehicle, a building, or a Helios modifier into the
// flat Facts object rules read. Rules never see Helios internals.

import type { WorldModifier } from "../world/types";
import { evaluate, netCostSgd } from "./evaluate";
import { ruleById, rulesForAsset } from "./rules";
import type { FactProvenance, Facts, Finding } from "./types";
import districtBuildingsJson from "@/data/compliance/buildings_jurong_east.json";

// ---- Vehicles -----------------------------------------------------------------

export interface VehicleInput {
  vehicle_class: "car" | "taxi";
  fuel: "electric" | "hybrid" | "petrol" | "diesel";
  /** Tailpipe CO₂ (g/km). For EVs leave empty and give whPerKm instead. */
  co2_g_km?: number;
  hc_g_km?: number;
  co_g_km?: number;
  nox_g_km?: number;
  pm_mg_km?: number;
  /** EV energy consumption (Wh/km) — converted to VES CO₂ at the scheme's grid factor. */
  whPerKm?: number;
  arf_sgd?: number;
}

export function vehicleFacts(v: VehicleInput, asOf: string): { facts: Facts; provenance: Record<string, FactProvenance> } {
  const { whPerKm: _w, ...rest } = v;
  const facts: Facts = { ...rest };
  const provenance: Record<string, FactProvenance> = {};
  if (v.fuel === "electric") {
    // EVs have zero tailpipe pollutants; CO₂ is accounted from electricity.
    for (const k of ["hc_g_km", "co_g_km", "nox_g_km", "pm_mg_km"]) if (facts[k] === undefined) facts[k] = 0;
    if (facts.co2_g_km === undefined && v.whPerKm !== undefined) {
      const ves = ruleById("sg.ves.2026_2027");
      const ef = (ves?.constants as any)?.ev_grid_emission_factor_g_per_wh;
      if (ef && (!ef.until || asOf <= ef.until)) {
        facts.co2_g_km = +(v.whPerKm * ef.value).toFixed(1);
        provenance.co2_g_km = "user_input";
      }
    }
  }
  return { facts, provenance };
}

export function checkVehicle(v: VehicleInput, asOf: string) {
  const { facts, provenance } = vehicleFacts(v, asOf);
  const rules = rulesForAsset("vehicle");
  const findings = evaluate(facts, rules, { asOf, provenance });
  return { facts, findings, ...netCostSgd(findings, facts, rules, asOf) };
}

// ---- Buildings ----------------------------------------------------------------

export interface BuildingInput {
  name?: string;
  building_type: string; // key in the Green Mark EUI table
  cooling_system: "in_house" | "district";
  gfa_m2?: number;
  annual_kwh?: number;
  eui_kwh_m2_yr?: number;
  onsite_re_kwh?: number;
  offsite_re_kwh?: number; // Singapore RECs (ZE only)
  ev_charging_kwh?: number;
  energy_savings_vs_2005?: number;
  provenance?: Record<string, FactProvenance>;
}

export function buildingFacts(b: BuildingInput): Facts {
  const { provenance: _p, name: _n, ...rest } = b;
  const facts: Facts = { ...rest };
  // Renewable shares for SLE/ZE/PE: renewable kWh ÷ total consumption (incl. plug load).
  if (b.annual_kwh && b.onsite_re_kwh !== undefined) {
    facts.onsite_renewable_share = +(b.onsite_re_kwh / b.annual_kwh).toFixed(3);
    facts.renewable_share = +((b.onsite_re_kwh + (b.offsite_re_kwh ?? 0)) / b.annual_kwh).toFixed(3);
  }
  return facts;
}

export function checkBuilding(b: BuildingInput, asOf: string): { facts: Facts; findings: Finding[] } {
  const facts = buildingFacts(b);
  const findings = evaluate(facts, rulesForAsset("building"), { asOf, provenance: b.provenance });
  return { facts, findings };
}

// ---- District building profiles (measured BCA data) ---------------------------

export interface DistrictBuilding {
  id: string;
  name: string;
  building_type: string;
  cooling_system: "in_house" | "district";
  gfa_m2?: number;
  eui: Record<string, number>;
  provenance: Record<string, FactProvenance>;
  certificate: { rating: string; scheme: string; issued: string | null; expires: string | null; label?: string | null } | null;
  /** Measured rooftop solar potential (Google Solar API) — only the curated Jurong East set has it. */
  rooftop_solar?: { kwp: number; annual_kwh: number };
  note?: string;
  lat?: number;
  lng?: number;
  address?: string;
  bca_function?: string;
  solar_pv?: boolean | null;
  /** Planning area id (island-wide listing). */
  area?: string | null;
  /** EUI rank among same-type peers in BCA's listing, 0 = best (added by /api/sg/buildings). */
  stock_percentile?: number | null;
  stock_peers?: number | null;
}

export const DISTRICT_BUILDINGS = (districtBuildingsJson as { buildings: DistrictBuilding[] }).buildings;

/**
 * Green Mark check for a district building from its measured EUI. With
 * `addSolarKwh`, on-site generation is netted off EUI (GM2021 rule), and the
 * EUI becomes "modelled" because the generation is a potential, not a meter read.
 */
export function checkDistrictBuilding(b: DistrictBuilding, asOf: string, opts: { euiYear?: string; addSolarKwh?: number } = {}) {
  const years = Object.keys(b.eui).sort();
  const euiYear = opts.euiYear && b.eui[opts.euiYear] !== undefined ? opts.euiYear : years[years.length - 1];
  const measured = euiYear ? b.eui[euiYear] : undefined;
  const provenance = { ...b.provenance };
  let eui = measured;
  if (eui !== undefined && opts.addSolarKwh && b.gfa_m2) {
    eui = +(eui - opts.addSolarKwh / b.gfa_m2).toFixed(2);
    provenance.eui_kwh_m2_yr = "modelled";
  }
  const input: BuildingInput = {
    name: b.name,
    building_type: b.building_type,
    cooling_system: b.cooling_system,
    gfa_m2: b.gfa_m2,
    eui_kwh_m2_yr: eui,
    provenance,
  };
  // SLE/ZE/PE shares need total consumption: EUI × GFA.
  if (measured !== undefined && b.gfa_m2) {
    input.annual_kwh = measured * b.gfa_m2;
    input.onsite_re_kwh = opts.addSolarKwh ?? 0;
  }
  const facts = buildingFacts(input);
  delete facts.annual_kwh; // EUI already given; don't re-derive
  const findings = evaluate(facts, rulesForAsset("building"), { asOf, provenance });
  const cert = b.certificate;
  const certStatus = !cert ? "none" : cert.expires && cert.expires < asOf ? "expired" : "valid";
  return { euiYear, measuredEui: measured, eui, findings, certStatus };
}

// ---- Helios modifiers ---------------------------------------------------------

/**
 * What a drawn intervention adds to a host building's energy facts. Today only
 * on-site solar maps onto a rule input (it is netted off Green Mark EUI);
 * other effects have no rule yet and are reported as uncovered.
 */
export function modifierEnergyDelta(mod: WorldModifier): { onsite_re_kwh: number; uncovered: string[] } {
  const e = mod.effects;
  const uncovered: string[] = [];
  if (e.chargingCapacityKWDelta) uncovered.push("EV chargers (EV Charging Act rules not yet ingested)");
  if (e.rainProtectionDelta || e.shadeDelta || e.cycleMaxKmExtension) uncovered.push("Street / mobility works (no rule set yet)");
  return { onsite_re_kwh: e.solarAnnualKWhDelta ?? 0, uncovered };
}

/** Re-check a building with an intervention's solar added — before vs after. */
export function checkBuildingWithModifier(b: BuildingInput, mod: WorldModifier, asOf: string) {
  const before = checkBuilding(b, asOf);
  const delta = modifierEnergyDelta(mod);
  const after = checkBuilding({ ...b, onsite_re_kwh: (b.onsite_re_kwh ?? 0) + delta.onsite_re_kwh }, asOf);
  return { before, after, uncovered: delta.uncovered };
}
