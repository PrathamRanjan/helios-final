// Singapore Green Plan policy pathways: the city evolves on its own each year;
// user drawings stack on top. Policy is just another source of world change —
// scheduled emission-factor shifts plus district-wide edge bonuses.

import type { Mode } from "../types";
import type { WorldState } from "../world/types";
import pathways from "@/data/policy/singapore_green_plan_pathways.json";

export type PathwayId = "target_achieved" | "delayed" | "accelerated" | "frozen" | "lta_trend";

export const PATHWAY_IDS: PathwayId[] = ["target_achieved", "delayed", "accelerated", "frozen", "lta_trend"];

export interface PolicyYear {
  gridKgPerKWh: number;
  efByMode: Record<Mode, number>; // gCO₂/pkm for this year under this pathway
  busElectricShare: number;
  cycleComfortBonus: number;
  cycleSafetyBonus: number;
  cycleMaxKmExtension: number;
  walkComfortBonus: number;
}

const ANCHORS = pathways.anchor_years as number[];
const D = pathways.derived as {
  ebus_kwh_per_pkm: number;
  mrt_kwh_per_pkm: number;
  diesel_bus_ef_gpkm: number;
};

/** Piecewise-linear interpolation over the anchor years. */
function lerpAnchors(values: number[], year: number): number {
  if (year <= ANCHORS[0]) return values[0];
  const last = ANCHORS.length - 1;
  if (year >= ANCHORS[last]) return values[last];
  for (let i = 0; i < last; i++) {
    if (year <= ANCHORS[i + 1]) {
      const t = (year - ANCHORS[i]) / (ANCHORS[i + 1] - ANCHORS[i]);
      return values[i] + t * (values[i + 1] - values[i]);
    }
  }
  return values[last];
}

export function pathwayLabel(id: PathwayId): string {
  return (pathways.pathways as any)[id]?.label ?? id;
}

/** The world's physics for one year under one pathway. */
export function policyYear(id: PathwayId, year: number): PolicyYear {
  const p = (pathways.pathways as any)[id];
  const grid = lerpAnchors(p.grid_kgco2_per_kwh, year);
  const eShare = lerpAnchors(p.bus_electric_share, year);

  // Electric modes are coupled to the year's grid factor — a cleaner grid makes
  // MRT and e-buses cleaner automatically (and solar avoid less, honestly).
  const ebusEF = D.ebus_kwh_per_pkm * grid * 1000;
  const busEF = (1 - eShare) * D.diesel_bus_ef_gpkm + eShare * ebusEF;
  const mrtEF = D.mrt_kwh_per_pkm * grid * 1000;

  return {
    gridKgPerKWh: grid,
    efByMode: {
      car: lerpAnchors(p.car_ef_gpkm, year),
      bus: busEF,
      mrt: mrtEF,
      walk: 0,
      cycle: 0,
    },
    busElectricShare: eShare,
    cycleComfortBonus: lerpAnchors(p.cycle_comfort_bonus, year),
    cycleSafetyBonus: lerpAnchors(p.cycle_safety_bonus, year),
    cycleMaxKmExtension: lerpAnchors(p.cycle_max_km_extension, year),
    walkComfortBonus: lerpAnchors(p.walk_comfort_bonus, year),
  };
}

/**
 * Recompute electric-mode EFs under a shocked grid (grid_carbon_spike): MRT and
 * the electric share of the bus fleet get dirtier; ICE cars are unaffected.
 */
export function efWithGrid(py: PolicyYear, gridKgPerKWh: number): Record<Mode, number> {
  if (gridKgPerKWh === py.gridKgPerKWh) return py.efByMode;
  const ebusEF = D.ebus_kwh_per_pkm * gridKgPerKWh * 1000;
  return {
    ...py.efByMode,
    bus: (1 - py.busElectricShare) * D.diesel_bus_ef_gpkm + py.busElectricShare * ebusEF,
    mrt: D.mrt_kwh_per_pkm * gridKgPerKWh * 1000,
  };
}

/**
 * Apply the pathway's district-wide network effects (proportional share of the
 * national cycling/walkway rollout) to a per-year world clone. Emission factors
 * are handled by the timeline engine, not here.
 */
export function applyPolicyToWorld(world: WorldState, py: PolicyYear): void {
  if (
    py.cycleComfortBonus === 0 &&
    py.cycleSafetyBonus === 0 &&
    py.cycleMaxKmExtension === 0 &&
    py.walkComfortBonus === 0
  ) {
    return;
  }
  for (const edge of world.edges) {
    const a = edge.attrs;
    if (py.cycleComfortBonus) a.comfortBonus.cycle = (a.comfortBonus.cycle ?? 0) + py.cycleComfortBonus;
    if (py.cycleSafetyBonus) a.safetyBonus.cycle = (a.safetyBonus.cycle ?? 0) + py.cycleSafetyBonus;
    if (py.cycleMaxKmExtension) a.cycleMaxKmExtension += py.cycleMaxKmExtension;
    if (py.walkComfortBonus) a.comfortBonus.walk = (a.comfortBonus.walk ?? 0) + py.walkComfortBonus;
  }
}
