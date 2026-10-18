// Policy in the money and on every intervention.
//
//  • carbonPrice(year, scenario)  — S$/t straight from the rule JSONs: the Act (law) or the
//    stated 2030 trajectory (proposed). No price is hard-coded here.
//  • carbonValue(result, …)       — values a plan's avoided tonnes at that price, giving a
//    cost per tonne net of carbon value, per scenario: "what flips if the tax hits S$80".
//  • badgesForModifier(mod, …)    — Singapore-Asia Taxonomy class + Green Mark effect for
//    any drawn / suggested intervention, from the same deterministic engine.

import { evaluate } from "./evaluate";
import { ruleById } from "./rules";
import { checkDistrictBuilding, type DistrictBuilding } from "./facts";
import type { Finding, Rule } from "./types";
import type { WorldModifier, ScenarioResult } from "../world/types";
import { convertFromUsd } from "../finance/currency";

export type PriceScenario = "law" | "low" | "central" | "high";

export const PRICE_SCENARIOS: { id: PriceScenario; label: string; hint: string }[] = [
  { id: "law", label: "Law today", hint: "Carbon Pricing Act 2018: S$45/t from 2026, held flat (no later rate is legislated)" },
  { id: "low", label: "S$50 by 2030", hint: "Low end of the stated S$50–80/t range (proposed, not law). In Budget 2026 the PM signalled the rate may sit toward this end if global climate momentum keeps weakening." },
  { id: "central", label: "S$65 by 2030", hint: "Midpoint of the stated S$50–80/t range (proposed, not law)" },
  { id: "high", label: "S$80 by 2030", hint: "Top of the stated S$50–80/t range (proposed, not law)" },
];

type Rate = { from_year: number; to_year: number | null; sgd_per_t: number; range?: [number, number] };

function rateFor(rule: Rule | undefined, year: number, pick: "value" | "low" | "high" = "value"): number | null {
  const r = (rule?.rates as Rate[] | undefined)?.find((x) => year >= x.from_year && (x.to_year == null || year <= x.to_year));
  if (!r) return null;
  if (pick !== "value" && r.range) return pick === "low" ? r.range[0] : r.range[1];
  return r.sgd_per_t;
}

/** Carbon tax rate (S$/tCO2e) for a year under a scenario, read from the rule registry. */
export function carbonPrice(year: number, scenario: PriceScenario = "law"): { sgd: number; status: "law" | "proposed"; ruleId: string } {
  const law = ruleById("sg.carbon_tax.cpa2018");
  const prop = ruleById("sg.carbon_tax.trajectory_2030_proposed");
  const legal = rateFor(law, year) ?? 0;
  if (scenario === "law" || !prop) return { sgd: legal, status: "law", ruleId: law?.id ?? "" };
  const p = rateFor(prop, year, scenario === "low" ? "low" : scenario === "high" ? "high" : "value");
  // Before the proposed window starts, the law applies.
  return p == null ? { sgd: legal, status: "law", ruleId: law?.id ?? "" } : { sgd: Math.max(p, legal), status: year >= 2030 ? "proposed" : "law", ruleId: year >= 2030 ? prop.id : law!.id };
}

export interface CarbonValueRow {
  scenario: PriceScenario;
  label: string;
  /** Value of the plan's avoided tonnes over the horizon at that price (S$). */
  carbonValueSgd: number;
  /** Cost per tonne after subtracting carbon value (S$/t). ≤ 0 = pays for itself on carbon alone. */
  netCostPerTonneSgd: number | null;
  avgPriceSgd: number;
  flips: boolean;
}

/**
 * Value a plan's avoided CO₂ at the carbon tax. This is a shadow value: in Singapore the
 * tax is levied on large emitters (power stations, refineries) and passes through prices,
 * so avoided tonnes are worth roughly the tax to the economy, not a cheque to the planner.
 */
export function carbonValue(result: ScenarioResult): CarbonValueRow[] {
  const tl = result.timeline;
  const cpt = result.summary.costPerTonneUsd;
  const cum = result.summary.cumulativeCO2AvoidedTonnes;
  return PRICE_SCENARIOS.map((s) => {
    let value = 0;
    for (let i = 0; i < tl.length; i++) {
      const avoided = Math.max(0, tl[i].annualCO2AvoidedTonnes ?? 0);
      value += avoided * carbonPrice(tl[i].year, s.id).sgd;
    }
    const cptSgd = cpt != null ? convertFromUsd(cpt, "SGD") : null;
    const avg = cum > 0 ? value / cum : carbonPrice(result.endYear, s.id).sgd;
    const net = cptSgd != null ? cptSgd - avg : null;
    return { scenario: s.id, label: s.label, carbonValueSgd: value, netCostPerTonneSgd: net, avgPriceSgd: avg, flips: net != null && net <= 0 };
  });
}

/** Carbon tax embedded in a building's electricity (Scope 2 × price) — what a higher tax would pass through. */
export function passThroughSgd(scope2Tonnes: number, year: number, scenario: PriceScenario) {
  return scope2Tonnes * carbonPrice(year, scenario).sgd;
}

// ---- Badges on interventions ----------------------------------------------------

export interface Badge {
  key: string;
  label: string;
  tone: "good" | "warn" | "bad" | "info";
  detail: string;
  ruleId: string;
  finding?: Finding;
}

/** Which Singapore-Asia Taxonomy activity an intervention is. Null = no mapping yet (stated). */
export function satActivity(mod: WorldModifier): string | null {
  const e = mod.effects;
  if (e.solarAnnualKWhDelta) return "solar_pv";
  if (e.chargingCapacityKWDelta) return "ev_charging";
  if (e.cycleMaxKmExtension || e.shadeDelta || e.rainProtectionDelta || e.comfortDelta?.walk || e.comfortDelta?.cycle || e.safetyDelta?.cycle || e.safetyDelta?.walk)
    return "active_mobility_infra";
  return null;
}

export function badgesForModifier(mod: WorldModifier, opts: { asOf: string; host?: DistrictBuilding | null }): Badge[] {
  const out: Badge[] = [];
  const sat = ruleById("sg.sat2023.activities");
  const act = satActivity(mod);
  if (sat && act) {
    const f = evaluate({ activity: act }, [sat], { asOf: opts.asOf })[0];
    out.push({
      key: "sat",
      label: `Taxonomy ${f.tier ?? f.outcome}`,
      tone: f.tier === "Green" ? "good" : f.tier === "Amber" ? "warn" : f.outcome === "fail" ? "bad" : "info",
      detail: f.summary,
      ruleId: sat.id,
      finding: f,
    });
  } else if (sat) {
    out.push({ key: "sat", label: "Taxonomy: not mapped", tone: "info", detail: "No Singapore-Asia Taxonomy activity mapped for this kind of change yet.", ruleId: sat.id });
  }
  // Solar on a building in BCA's listing → Green Mark tier before/after (on-site generation nets off EUI).
  if (mod.effects.solarAnnualKWhDelta && opts.host && Object.keys(opts.host.eui ?? {}).length) {
    const before = checkDistrictBuilding(opts.host, opts.asOf).findings[0];
    const after = checkDistrictBuilding(opts.host, opts.asOf, { addSolarKwh: mod.effects.solarAnnualKWhDelta }).findings[0];
    const t = (f: Finding) => f.tier ?? (f.outcome === "fail" ? "below Gold" : "n/a");
    const up = t(before) !== t(after);
    out.push({
      key: "gm",
      label: up ? `Green Mark ${t(before)} → ${t(after)}` : `Green Mark ${t(after)}`,
      tone: after.outcome === "pass" ? "good" : "bad",
      detail: `${opts.host.name}: ${after.summary}`,
      ruleId: before.ruleId,
      finding: after,
    });
  }
  if (mod.effects.chargingCapacityKWDelta) {
    const ev = ruleById("sg.evca2022.defined_works");
    if (ev)
      out.push({
        key: "evca",
        label: "EV Charging Act: voluntary",
        tone: "info",
        detail: "A charger retrofit on its own is not a 'defined work' (new building, +50% GFA, or electrical load raised above 280 kVA), so Part 9 minimums don't apply. The Act's charger registration and operator licensing parts aren't ingested yet.",
        ruleId: ev.id,
      });
  }
  return out;
}
