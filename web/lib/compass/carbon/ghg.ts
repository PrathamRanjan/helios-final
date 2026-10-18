// HELIOS carbon accounting: Scope 1 & 2 for buildings and portfolios, and a draft
// climate disclosure that feeds the compliance rules (climate reporting roadmap,
// carbon tax, Singapore-Asia Taxonomy).
//
// Method (GHG Protocol Corporate Standard + Scope 2 Guidance, location-based):
//   electricity kWh = measured EUI (BCA) × GFA (BCA)
//   Scope 2 tCO2    = kWh × EMA grid emission factor for that year ÷ 1000
//   Scope 1         = on-site fuel (diesel gensets, gas, refrigerant leaks). BCA does
//                     not publish it, so it is an owner input, never guessed.

import efJson from "@/data/carbon/grid_emission_factors.json";
import { evaluate } from "../compliance/evaluate";
import { ruleById } from "../compliance/rules";
import type { DistrictBuilding } from "../compliance/facts";
import type { Finding, FactProvenance } from "../compliance/types";

type EfEntry = { value: number; source: keyof typeof efJson.sources };
const FACTORS = efJson.factors as Record<string, EfEntry>;
const YEARS = Object.keys(FACTORS).sort();

export interface GridFactor {
  year: string; // the factor's own year
  forYear: string; // the year it is applied to
  value: number; // kgCO2/kWh
  source: string;
  url: string;
  confidence: "verified_primary" | "secondary";
  /** True when the requested year has no published factor and the latest one is carried forward. */
  carriedForward: boolean;
}

/** EMA grid factor for a year. Years after the latest published one carry the latest forward (stated, never silent). */
export function gridFactor(year: string | number): GridFactor | null {
  const y = String(year);
  const exact = FACTORS[y];
  const key = exact ? y : y > YEARS[YEARS.length - 1] ? YEARS[YEARS.length - 1] : null;
  if (!key) return null;
  const e = FACTORS[key];
  const src = efJson.sources[e.source];
  return { year: key, forYear: y, value: e.value, source: src.title, url: src.url, confidence: src.confidence as GridFactor["confidence"], carriedForward: !exact };
}

export interface BuildingGhg {
  id: string;
  name: string;
  year: string;
  gfa_m2: number;
  eui: number;
  kwh: number;
  scope2_t: number;
  intensity_kg_m2: number;
  factor: GridFactor;
  provenance: FactProvenance;
}

/** Location-based Scope 2 for one BCA building and one EUI year (latest by default). */
export function buildingScope2(b: DistrictBuilding, year?: string): BuildingGhg | null {
  const ys = Object.keys(b.eui ?? {}).sort();
  const y = year && b.eui?.[year] !== undefined ? year : ys[ys.length - 1];
  if (!y || !b.gfa_m2) return null;
  const f = gridFactor(y);
  if (!f) return null;
  const eui = b.eui[y];
  const kwh = eui * b.gfa_m2;
  const t = (kwh * f.value) / 1000;
  return { id: b.id, name: b.name, year: y, gfa_m2: b.gfa_m2, eui, kwh, scope2_t: t, intensity_kg_m2: (eui * f.value), factor: f, provenance: "measured" };
}

/** Scope 2 for every published EUI year — the building's measured trend. */
export function scope2Trend(b: DistrictBuilding): BuildingGhg[] {
  return Object.keys(b.eui ?? {})
    .sort()
    .map((y) => buildingScope2(b, y))
    .filter((x): x is BuildingGhg => !!x);
}

// ---- Entity / portfolio disclosure draft --------------------------------------

export type EntityType = "sti" | "listed_large" | "listed_small" | "large_non_listed" | "other";

export interface EntityInput {
  name: string;
  entity_type: EntityType;
  financial_year: number;
  buildings: DistrictBuilding[];
  /** Owner-reported Scope 1 (tCO2e) — fuel, gensets, refrigerants. Undefined = not provided. */
  scope1_t?: number;
  /** Largest single facility's direct emissions (tCO2e) — what the carbon tax tests. */
  largest_facility_scope1_t?: number;
}

export interface DisclosureDraft {
  entity: { name: string; entity_type: EntityType; financial_year: number };
  asOf: string;
  scope1: { t: number | null; provenance: FactProvenance | "missing" };
  scope2: { t: number; kwh: number; gfa_m2: number; intensity_kg_m2: number; years: string[]; covered: number; excluded: { id: string; name: string; why: string }[] };
  perBuilding: (BuildingGhg & { sat?: Finding; stock_percentile?: number | null })[];
  obligations: Finding;
  carbonTax: Finding;
  /** Share of portfolio GFA that is SAT Green / Amber / Ineligible / unknown as an owned building (TSC 3.4). */
  taxonomy: { green_m2: number; amber_m2: number; ineligible_m2: number; unknown_m2: number };
  gaps: string[];
}

export function draftDisclosure(e: EntityInput, asOf: string): DisclosureDraft {
  const per: DisclosureDraft["perBuilding"] = [];
  const excluded: DisclosureDraft["scope2"]["excluded"] = [];
  const sat = ruleById("sg.sat2023.activities");
  const tax = { green_m2: 0, amber_m2: 0, ineligible_m2: 0, unknown_m2: 0 };
  for (const b of e.buildings) {
    const g = buildingScope2(b);
    if (!g) {
      excluded.push({ id: b.id, name: b.name, why: !b.gfa_m2 ? "no GFA published" : "no measured EUI published by BCA" });
      continue;
    }
    const certValid = !!b.certificate && (!b.certificate.expires || b.certificate.expires >= asOf);
    const pct = b.stock_percentile;
    const satF = sat
      ? evaluate(
          { activity: "building_ownership", green_mark_valid: certValid, stock_percentile: pct ?? undefined },
          [sat],
          { asOf, provenance: { green_mark_valid: "measured", stock_percentile: "modelled" } }
        )[0]
      : undefined;
    const bucket = satF?.tier === "Green" ? "green_m2" : satF?.tier === "Amber" ? "amber_m2" : satF?.tier === "Ineligible" ? "ineligible_m2" : "unknown_m2";
    tax[bucket] += g.gfa_m2;
    per.push({ ...g, sat: satF, stock_percentile: pct ?? null });
  }
  const s2 = per.reduce((s, x) => s + x.scope2_t, 0);
  const kwh = per.reduce((s, x) => s + x.kwh, 0);
  const gfa = per.reduce((s, x) => s + x.gfa_m2, 0);
  const reporting = ruleById("sg.climate_reporting.roadmap");
  const cpa = ruleById("sg.carbon_tax.cpa2018");
  const obligations = evaluate({ entity_type: e.entity_type, financial_year: e.financial_year }, reporting ? [reporting] : [], { asOf })[0];
  const carbonTax = evaluate(
    { facility_tco2e: e.largest_facility_scope1_t, emissions_year: e.financial_year },
    cpa ? [cpa] : [],
    { asOf, provenance: { facility_tco2e: "user_input" } }
  )[0];

  const gaps: string[] = [];
  if (e.scope1_t === undefined) gaps.push("Scope 1 not provided — add on-site fuel (diesel gensets, gas), and refrigerant top-ups from maintenance logs.");
  if (excluded.length) gaps.push(`${excluded.length} building${excluded.length > 1 ? "s" : ""} excluded: BCA publishes no EUI or GFA for them — use utility bills.`);
  const years = [...new Set(per.map((p) => p.year))].sort();
  if (years.length && Number(years[years.length - 1]) < e.financial_year - 1)
    gaps.push(`Electricity is BCA's measured ${years.join("/")} EUI, not FY${e.financial_year} bills — replace with metered kWh for the reporting year.`);
  if (per.some((p) => p.factor.carriedForward)) gaps.push("Grid factor carried forward from the latest EMA year.");
  if (per.some((p) => p.factor.confidence === "secondary")) gaps.push("Grid factor for 2021–2024 is secondary — check against EMA Singapore Energy Statistics.");
  gaps.push("Location-based Scope 2 only. Market-based Scope 2 needs your RECs / green tariff contracts.");
  gaps.push("Not assured. SGX/ACRA require external limited assurance of Scope 1 & 2 from FY2029 (listed) — this draft is the working file an assurer would test.");

  return {
    entity: { name: e.name, entity_type: e.entity_type, financial_year: e.financial_year },
    asOf,
    scope1: { t: e.scope1_t ?? null, provenance: e.scope1_t === undefined ? "missing" : "user_input" },
    scope2: { t: s2, kwh, gfa_m2: gfa, intensity_kg_m2: gfa ? (s2 * 1000) / gfa : 0, years, covered: per.length, excluded },
    perBuilding: per.sort((a, b) => b.scope2_t - a.scope2_t),
    obligations,
    carbonTax,
    taxonomy: tax,
    gaps,
  };
}

/** National-stock percentile by EUI within the same building type (0 = best). Used for SAT TSC 3.4 "top 15% of stock". */
export function stockPercentiles(all: DistrictBuilding[], year = "2020"): Map<string, { pct: number; n: number }> {
  const groups = new Map<string, { id: string; eui: number }[]>();
  for (const b of all) {
    const eui = b.eui?.[year];
    if (eui === undefined) continue;
    const k = b.building_type !== "unknown" ? b.building_type : `fn:${b.bca_function ?? "unknown"}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push({ id: b.id, eui });
  }
  const out = new Map<string, { pct: number; n: number }>();
  for (const list of groups.values()) {
    if (list.length < 10) continue; // too few peers to rank honestly
    list.sort((a, b) => a.eui - b.eui);
    list.forEach((x, i) => out.set(x.id, { pct: +(i / list.length).toFixed(3), n: list.length }));
  }
  return out;
}
