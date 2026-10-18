// Intervention finance (B2G) — the money side of the decision.
//
// Turns what the planner drew into real costs (from official Singapore unit
// costs, USD) and asks the government CBA questions:
//   • CAPEX — what does it cost to build
//   • O&M — yearly upkeep
//   • Carbon value — the CO2 it avoids priced at the SG carbon tax
//   • NPV — is it a good deal once future value is discounted
//   • Money payback year — when cumulative benefit overtakes the build cost
//   • Budget share — how much of the district envelope it eats
//
// MVP-simple and defensible: one number each, labelled. No sensitivity band.

import type { WorldModifier, YearResult } from "../world/types";
import { polylineLengthKm } from "../world/geo";
import fin from "@/data/assumptions/finance.json";

const YIELD = 1200; // kWh/kWp — SG rooftop specific yield (shared with embodied)
const U = (fin as any).unit_costs_usd;
const OPEX = (fin as any).opex_rate_per_year;
const DISCOUNT = (fin as any).discount_rate_social.value as number;
const BUDGET = (fin as any).district_budget_usd.value as number;
const CARBON_TRAJ = (fin as any).carbon_price_usd_per_t.trajectory as Record<string, number>;
const TARIFF = (fin as any).energy_value_usd_per_kwh.electricity_tariff.value as number;
const EV_MARGIN = (fin as any).energy_value_usd_per_kwh.ev_cost_recovery.value as number;

export const SOCIAL_DISCOUNT_RATE = DISCOUNT;
export const DISTRICT_BUDGET_USD = BUDGET;

/** Linear-interpolate the carbon price (USD/t) for any year from the trajectory. */
export function carbonPriceUsd(year: number): number {
  const yrs = Object.keys(CARBON_TRAJ).map(Number).sort((a, b) => a - b);
  if (year <= yrs[0]) return CARBON_TRAJ[yrs[0]];
  if (year >= yrs[yrs.length - 1]) return CARBON_TRAJ[yrs[yrs.length - 1]];
  for (let i = 0; i < yrs.length - 1; i++) {
    if (year >= yrs[i] && year <= yrs[i + 1]) {
      const t = (year - yrs[i]) / (yrs[i + 1] - yrs[i]);
      return CARBON_TRAJ[yrs[i]] + t * (CARBON_TRAJ[yrs[i + 1]] - CARBON_TRAJ[yrs[i]]);
    }
  }
  return CARBON_TRAJ[yrs[yrs.length - 1]];
}

export interface CapexLine { item: string; usd: number; detail: string }
export interface CapexResult { totalUsd: number; opexPerYearUsd: number; lines: CapexLine[] }

function geometryKm(mod: WorldModifier): number {
  const g = mod.geometry;
  if (g.type === "LineString") return polylineLengthKm(g.coordinates);
  if (g.type === "Polygon") return polylineLengthKm(g.coordinates[0] ?? []);
  return 0;
}

/** Real capex + weighted O&M for one modifier, from the quantities its effects imply. */
export function capexForModifier(mod: WorldModifier): CapexResult {
  const e = mod.effects;
  const km = geometryKm(mod);
  const lines: CapexLine[] = [];
  let opex = 0;

  if (e.solarAnnualKWhDelta) {
    const kwp = e.solarAnnualKWhDelta / YIELD;
    const usd = kwp * U.solar_per_kwp.value;
    lines.push({ item: "Solar PV", usd, detail: `${Math.round(kwp)} kWp × $${U.solar_per_kwp.value}/kWp` });
    opex += usd * OPEX.solar.value;
  }
  if (e.batteryCapacityKWhDelta) {
    const usd = e.batteryCapacityKWhDelta * U.battery_per_kwh.value;
    lines.push({ item: "Battery", usd, detail: `${e.batteryCapacityKWhDelta} kWh × $${U.battery_per_kwh.value}/kWh` });
    opex += usd * OPEX.ev.value;
  }
  if (e.chargingCapacityKWDelta) {
    const ports = Math.max(1, Math.round(e.chargingCapacityKWDelta / 22));
    const usd = ports * U.ev_ac_port.value;
    lines.push({ item: "EV chargers", usd, detail: `${ports} ports × $${U.ev_ac_port.value}` });
    opex += usd * OPEX.ev.value;
  }
  if (km > 0) {
    if (e.rainProtectionDelta) {
      const usd = km * U.covered_walkway_per_km.value;
      lines.push({ item: "Covered walkway", usd, detail: `${km.toFixed(2)} km × $${(U.covered_walkway_per_km.value / 1e6).toFixed(2)}M/km` });
      opex += usd * OPEX.civil.value;
    } else if (e.cycleMaxKmExtension || e.safetyDelta?.cycle) {
      const usd = km * U.cycle_lane_per_km.value;
      lines.push({ item: "Cycle lane", usd, detail: `${km.toFixed(2)} km × $${Math.round(U.cycle_lane_per_km.value / 1000)}k/km` });
      opex += usd * OPEX.civil.value;
    }
    if (e.shadeDelta) {
      const usd = km * U.shade_trees_per_km.value;
      lines.push({ item: "Shade trees", usd, detail: `${km.toFixed(2)} km planting` });
      opex += usd * OPEX.civil.value;
    }
  }

  const totalUsd = lines.reduce((s, l) => s + l.usd, 0);
  return { totalUsd, opexPerYearUsd: opex, lines };
}

export interface FinanceSummary {
  capexUsd: number;
  opexPerYearUsd: number; // at full operation (all modifiers active)
  carbonValueUsd: number; // total over horizon, NOT discounted (context only)
  socialNpvUsd: number; // carbon + energy − capex − O&M, discounted
  cashNpvUsd: number; // energy/EV margin − capex − O&M, discounted (NO carbon) — the private-operator view
  cashPaybackYear: number | null; // payback on cash flows alone (no carbon credit)
  moneyPaybackYear: number | null;
  budgetSharePct: number;
  capexLines: CapexLine[];
}

/**
 * Public-sector CBA. Capex/O&M come from ONE authoritative source — the
 * modifier's own economics (computed from unit costs for user-drawn changes,
 * or the carried demand-sized package for EV sites) — so this reconciles with
 * cost-per-tonne. Capex is charged in each modifier's builtYear and O&M runs
 * only from builtYear onward; both are discounted at the year they occur.
 * The capex breakdown reconciles to the authoritative total via a
 * balance-of-system remainder (civil / grid / install) where they differ.
 */
export function financeSummary(timeline: YearResult[], startYear: number, modifiers: WorldModifier[]): FinanceSummary {
  const lineMap = new Map<string, CapexLine>();
  let capexUsd = 0;
  let opexPerYearUsd = 0;
  for (const mod of modifiers) {
    capexUsd += mod.economics.capexUsd;
    opexPerYearUsd += mod.economics.annualOpexUsd;
    // Breakdown for display: quantity-derived lines + a remainder so they sum
    // to the authoritative capex (EV site packages include civil/grid beyond
    // hardware line items).
    const computed = capexForModifier(mod);
    let lineSum = 0;
    for (const l of computed.lines) {
      lineSum += l.usd;
      const cur = lineMap.get(l.item);
      if (cur) cur.usd += l.usd;
      else lineMap.set(l.item, { ...l });
    }
    const remainder = mod.economics.capexUsd - lineSum;
    if (remainder > 1) {
      const key = "Civil / grid / install";
      const cur = lineMap.get(key);
      if (cur) cur.usd += remainder;
      else lineMap.set(key, { item: key, usd: remainder, detail: "balance of system" });
    }
  }

  let carbonValueUsd = 0;
  let cumBalance = 0; // social (carbon + energy)
  let cumCash = 0; // cash only (energy/EV margin, no carbon)
  let capexCharged = 0;
  let npv = 0; // social NPV
  let cashNpv = 0; // cash NPV (no carbon)
  let moneyPaybackYear: number | null = null;
  let cashPaybackYear: number | null = null;
  for (const y of timeline) {
    const t = y.year - startYear; // 0 for the start year
    const disc = Math.pow(1 + DISCOUNT, t);
    // Capex hits in each modifier's build year; O&M runs from build year onward.
    const capexThisYear = modifiers
      .filter((m) => m.metadata.builtYear === y.year)
      .reduce((s, m) => s + m.economics.capexUsd, 0);
    const opexThisYear = modifiers
      .filter((m) => m.metadata.builtYear <= y.year)
      .reduce((s, m) => s + m.economics.annualOpexUsd, 0);
    capexCharged += capexThisYear;

    const carbonVal = y.annualCO2AvoidedTonnes * carbonPriceUsd(y.year);
    const energyVal = y.solarKWh * TARIFF + y.evChargingKWh * EV_MARGIN;
    carbonValueUsd += carbonVal;

    const net = carbonVal + energyVal - opexThisYear - capexThisYear;
    const cashNet = energyVal - opexThisYear - capexThisYear; // no carbon credit
    npv += net / disc;
    cashNpv += cashNet / disc;
    cumBalance += net;
    cumCash += cashNet;
    // Payback only once capex has actually been charged (post-build recovery).
    if (moneyPaybackYear === null && capexCharged > 0 && cumBalance >= 0) moneyPaybackYear = y.year;
    if (cashPaybackYear === null && capexCharged > 0 && cumCash >= 0) cashPaybackYear = y.year;
  }

  return {
    capexUsd: Math.round(capexUsd),
    opexPerYearUsd: Math.round(opexPerYearUsd),
    carbonValueUsd: Math.round(carbonValueUsd),
    socialNpvUsd: Math.round(npv),
    cashNpvUsd: Math.round(cashNpv),
    cashPaybackYear,
    moneyPaybackYear,
    budgetSharePct: Math.round((capexUsd / BUDGET) * 100),
    capexLines: [...lineMap.values()].map((l) => ({ ...l, usd: Math.round(l.usd) })),
  };
}
