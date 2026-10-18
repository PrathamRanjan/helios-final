// Shock physics: external events become multipliers on the same world
// attributes agents already react to. No shock carries a hardcoded CO₂ number —
// agents re-choose modes under the distorted world, and carbon falls out.

import type { WorldState, Shock } from "../world/types";
import { hazeEffect } from "../air/haze";

export interface ShockFactors {
  heatMultiplier: number; // × on edge heatExposure (shade cushions automatically)
  rainMultiplier: number; // × on edge rainExposure (covered links cushion)
  carCostMultiplier: number; // × on car monetary cost (β_cost reacts)
  demandFactor: number; // × on total trips (pandemic, with linear recovery)
  gridMultiplier: number; // × on the year's grid carbon factor
  mrtTimeMultiplier: number; // × on MRT travel time (<1 = faster → more attractive)
  /** Annualised share of walking / cycling utility lost to haze (0 = no haze). */
  hazeActivePenalty: number;
  /** × on added rooftop-solar yield (haze cuts irradiance). */
  solarMultiplier: number;
}

export const NEUTRAL_FACTORS: ShockFactors = {
  heatMultiplier: 1,
  rainMultiplier: 1,
  carCostMultiplier: 1,
  demandFactor: 1,
  gridMultiplier: 1,
  mrtTimeMultiplier: 1,
  hazeActivePenalty: 0,
  solarMultiplier: 1,
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Combine all active shocks into this year's world distortion. */
export function shockFactors(shocks: Shock[], year: number): ShockFactors {
  const f = { ...NEUTRAL_FACTORS };
  for (const s of shocks) {
    const end = s.startYear + s.durationYears - 1;
    const active = year >= s.startYear && year <= end;
    switch (s.type) {
      case "heatwave":
        if (active) f.heatMultiplier *= 1 + s.severity;
        break;
      case "heavy_rain":
        if (active) f.rainMultiplier *= 1 + s.severity;
        break;
      case "oil_price_spike":
        if (active) f.carCostMultiplier *= 1 + s.carCostIncreasePct / 100;
        break;
      case "pandemic": {
        if (active) {
          f.demandFactor *= 1 - s.demandDropPct / 100;
        } else if (year > end && year <= end + s.recoveryYears) {
          // linear recovery back to full demand
          const t = (year - end) / s.recoveryYears;
          f.demandFactor *= 1 - (s.demandDropPct / 100) * (1 - t);
        }
        break;
      }
      case "grid_carbon_spike":
        if (active) f.gridMultiplier *= s.gridFactorMultiplier;
        break;
      case "mrt_loop_closure":
        if (active) f.mrtTimeMultiplier *= 1 - s.mrtSpeedupPct / 100;
        break;
      case "haze":
        if (active) {
          const h = hazeEffect(s.psi, s.daysPerYear);
          f.hazeActivePenalty = Math.min(0.9, f.hazeActivePenalty + h.cycleDropOnHazeDay * h.dayShare);
          f.solarMultiplier *= 1 - h.pvLossOnHazeDay * h.dayShare;
        }
        break;
    }
  }
  return f;
}

/** Distort a per-year world clone. Grid/demand factors are applied by the timeline. */
export function applyShockToWorld(world: WorldState, f: ShockFactors): void {
  if (
    f.heatMultiplier === 1 &&
    f.rainMultiplier === 1 &&
    f.carCostMultiplier === 1 &&
    f.demandFactor === 1 &&
    f.mrtTimeMultiplier === 1 &&
    f.hazeActivePenalty === 0
  ) {
    return;
  }
  for (const edge of world.edges) {
    const a = edge.attrs;
    if (f.heatMultiplier !== 1) a.heatExposure = clamp01(a.heatExposure * f.heatMultiplier);
    if (f.rainMultiplier !== 1) a.rainExposure = clamp01(a.rainExposure * f.rainMultiplier);
    if (f.carCostMultiplier !== 1) {
      a.costMultiplier.car = (a.costMultiplier.car ?? 1) * f.carCostMultiplier;
    }
    if (f.mrtTimeMultiplier !== 1) {
      a.travelTimeMultiplier.mrt = (a.travelTimeMultiplier.mrt ?? 1) * f.mrtTimeMultiplier;
    }
    if (f.demandFactor !== 1) edge.totalTripsDaily *= f.demandFactor;
    if (f.hazeActivePenalty > 0) {
      // Comfort is the 0..1 attribute agents weigh for active modes; haze removes it
      // regardless of shade or shelter. Walking is assumed half as sensitive as cycling.
      a.comfortBonus.cycle = (a.comfortBonus.cycle ?? 0) - f.hazeActivePenalty;
      a.comfortBonus.walk = (a.comfortBonus.walk ?? 0) - f.hazeActivePenalty / 2;
    }
  }
}

/** Stable key for memoizing baseline runs that include shocks. */
export function shocksKey(shocks: Shock[]): string {
  if (!shocks.length) return "none";
  return shocks
    .map((s) => JSON.stringify(s))
    .sort()
    .join("|");
}
