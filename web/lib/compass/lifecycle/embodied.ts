// Lifecycle / embodied-carbon engine.
//
// The operational engine (simulateTimeline) already avoids CO2 by shifting
// modes and displacing grid/fuel. But BUILDING an intervention emits carbon
// too — PV manufacturing, battery cells, charger hardware, concrete/steel of a
// canopy, asphalt of a lane. This module estimates that one-off embodied debt
// from the SAME quantities the effects imply, so we can report:
//   • embodied CO2 (cradle-to-gate)
//   • NET lifecycle CO2 avoided = operational avoided over horizon − embodied
//   • carbon payback year = when cumulative operational avoided overtakes embodied
//
// Circular procurement choices reduce the embodied debt (second-life batteries,
// PV recycling, modular/repairable hardware) — circularity as a computed lever,
// not a slide.

import type { WorldModifier, ScenarioResult, YearResult } from "../world/types";
import { polylineLengthKm } from "../world/geo";
import emb from "@/data/assumptions/embodied.json";

const F = {
  yield: (emb as any).solar_yield_kwh_per_kwp.value as number,
  pvPerKwp: (emb as any).pv_kgco2e_per_kwp.value as number,
  batteryPerKWh: (emb as any).battery_kgco2e_per_kwh.value as number,
  chargerPerPort: (emb as any).ev_charger_kgco2e_per_port.value as number,
  chargerCivilPerPort: (emb as any).ev_charger_civil_kgco2e_per_port.value as number,
  cycleLanePerKm: (emb as any).cycle_lane_kgco2e_per_km.value as number,
  walkwayPerKm: (emb as any).covered_walkway_kgco2e_per_km.value as number,
  treeSeqPerKm: (emb as any).shade_tree_sequestration_kgco2e_per_km.value as number,
};

const CIRC = {
  secondLifeBattery: (emb as any).circular.second_life_battery_factor.value as number,
  pvRecycling: (emb as any).circular.pv_recycling_credit_factor.value as number,
  modular: (emb as any).circular.modular_replacement_avoided_factor.value as number,
};

export interface CircularOptions {
  secondLifeBattery?: boolean;
  pvRecycling?: boolean;
  modular?: boolean;
}

export interface EmbodiedLine {
  item: string;
  kg: number;
  detail: string;
}

export interface EmbodiedBreakdown {
  totalKg: number;
  lines: EmbodiedLine[];
}

function geometryKm(mod: WorldModifier): number {
  const g = mod.geometry;
  if (g.type === "LineString") return polylineLengthKm(g.coordinates);
  if (g.type === "Polygon") return polylineLengthKm(g.coordinates[0] ?? []);
  return 0; // Point interventions have no length
}

/** Embodied CO2 for one modifier, from the quantities its effects imply. */
export function embodiedForModifier(mod: WorldModifier): EmbodiedBreakdown {
  const e = mod.effects;
  const circ: CircularOptions = (mod as any).lifecycle?.circular ?? {};
  const km = geometryKm(mod);
  const lines: EmbodiedLine[] = [];

  // Solar: kWp from annual kWh / specific yield.
  if (e.solarAnnualKWhDelta) {
    const kwp = e.solarAnnualKWhDelta / F.yield;
    let kg = kwp * F.pvPerKwp;
    if (circ.pvRecycling) kg *= CIRC.pvRecycling;
    lines.push({ item: "Solar PV", kg, detail: `${Math.round(kwp)} kWp × ${F.pvPerKwp} kg/kWp${circ.pvRecycling ? " · recycled-content" : ""}` });
  }

  // Battery.
  if (e.batteryCapacityKWhDelta) {
    let kg = e.batteryCapacityKWhDelta * F.batteryPerKWh;
    if (circ.secondLifeBattery) kg *= CIRC.secondLifeBattery;
    lines.push({ item: "Battery", kg, detail: `${e.batteryCapacityKWhDelta} kWh × ${F.batteryPerKWh} kg/kWh${circ.secondLifeBattery ? " · second-life" : ""}` });
  }

  // EV charger ports (hardware + civil), ~22 kW per port.
  if (e.chargingCapacityKWDelta) {
    const ports = Math.max(1, Math.round(e.chargingCapacityKWDelta / 22));
    let per = F.chargerPerPort + F.chargerCivilPerPort;
    if (circ.modular) per = F.chargerPerPort * CIRC.modular + F.chargerCivilPerPort;
    lines.push({ item: "EV chargers", kg: ports * per, detail: `${ports} ports × ${Math.round(per)} kg (hardware + civil)${circ.modular ? " · modular" : ""}` });
  }

  // Linear civil works — pick the dominant per-km asset from the effects.
  if (km > 0) {
    if (e.rainProtectionDelta) {
      lines.push({ item: "Covered walkway", kg: km * F.walkwayPerKm, detail: `${km.toFixed(2)} km × ${F.walkwayPerKm / 1000} tCO2e/km (steel + concrete)` });
    } else if (e.cycleMaxKmExtension || e.safetyDelta?.cycle) {
      lines.push({ item: "Cycle lane", kg: km * F.cycleLanePerKm, detail: `${km.toFixed(2)} km × ${F.cycleLanePerKm / 1000} tCO2e/km (asphalt + separators)` });
    }
    if (e.shadeDelta) {
      lines.push({ item: "Shade trees", kg: km * F.treeSeqPerKm, detail: `${km.toFixed(2)} km planting — net sequestration credit` });
    }
  }

  const totalKg = lines.reduce((s, l) => s + l.kg, 0);
  return { totalKg, lines };
}

export interface LifecycleSummary {
  embodiedTonnes: number;
  netCO2AvoidedTonnes: number; // operational avoided over horizon − embodied
  carbonPaybackYear: number | null; // null = never repaid within horizon
  netNegative: boolean; // embodied exceeds operational avoided over the horizon
  breakdown: EmbodiedLine[];
}

/** Combine embodied debt with the operational avoided timeline. */
export function lifecycleSummary(result: ScenarioResult, modifiers: WorldModifier[]): LifecycleSummary {
  const lineMap = new Map<string, EmbodiedLine>();
  let embodiedKg = 0;
  for (const mod of modifiers) {
    const b = embodiedForModifier(mod);
    embodiedKg += b.totalKg;
    for (const l of b.lines) {
      const cur = lineMap.get(l.item);
      if (cur) cur.kg += l.kg;
      else lineMap.set(l.item, { ...l });
    }
  }
  const embodiedTonnes = embodiedKg / 1000;
  const cumOperational = result.summary.cumulativeCO2AvoidedTonnes;

  // Payback: first year cumulative operational avoided ≥ embodied debt.
  let carbonPaybackYear: number | null = null;
  for (const y of result.timeline as YearResult[]) {
    if (y.cumulativeCO2AvoidedTonnes >= embodiedTonnes) {
      carbonPaybackYear = y.year;
      break;
    }
  }

  return {
    embodiedTonnes: Math.round(embodiedTonnes * 10) / 10,
    netCO2AvoidedTonnes: Math.round((cumOperational - embodiedTonnes) * 10) / 10,
    carbonPaybackYear,
    netNegative: embodiedTonnes > cumOperational,
    breakdown: [...lineMap.values()].map((l) => ({ ...l, kg: Math.round(l.kg) })),
  };
}
