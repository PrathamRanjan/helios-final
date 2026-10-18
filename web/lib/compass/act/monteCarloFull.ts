// FULL Monte Carlo — re-runs the REAL agent simulation for every draw.
//
// The lightweight monteCarlo() scales the deterministic headline numbers by
// sampled multipliers. This version instead perturbs the INPUTS and re-runs
// simulateTimeline each draw, so uncertainty propagates through the actual
// nonlinear mode-choice (saturation, mode interactions, threshold effects) and
// the finance engine — not a linear scaling of the output.
//
// Sampled inputs (labelled-proxy widths, matching MC_PARAMS):
//   • behavioural response — scales every modifier's mobility-response effect
//     (comfort/safety/time/cost deltas), so the agent reallocation is re-solved.
//   • EV displacement — a continuous fraction swept through the engine.
//   • unit capex — scales each modifier's capex, flowing into cost-per-tonne.
//
// Runs server-side (this module imports the engine). ~200–400 real sims ≈ 1–2 s.

import type { WorldState, WorldModifier, Shock, Mode } from "../world/types";
import { simulateTimeline } from "../world/simulateTimeline";
import type { PathwayId } from "../policy/applyPolicy";
import type { MonteCarloResult, McBand } from "./monteCarlo";

const BEHAVIOURAL_SD = 0.15;
const CAPEX_SD = 0.2;
const EV_BASE = 0.5; // base displacement fraction
const EV_SD = 0.3; // relative

function randn(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function scaleModeRecord(
  rec: Partial<Record<Mode, number>> | undefined,
  k: number,
  deviationFromOne: boolean
): Partial<Record<Mode, number>> | undefined {
  if (!rec) return rec;
  const out: Partial<Record<Mode, number>> = {};
  for (const [m, v] of Object.entries(rec) as [Mode, number][]) {
    out[m] = deviationFromOne ? 1 + (v - 1) * k : v * k;
  }
  return out;
}

/** Clone a modifier with its mobility-RESPONSE effects and capex scaled.
 *  Physical energy/capacity effects (solar/battery/charging) are left intact. */
export function perturb(mod: WorldModifier, behavioural: number, capexMult: number): WorldModifier {
  const e = mod.effects;
  return {
    ...mod,
    effects: {
      ...e,
      shadeDelta: e.shadeDelta !== undefined ? e.shadeDelta * behavioural : undefined,
      rainProtectionDelta: e.rainProtectionDelta !== undefined ? e.rainProtectionDelta * behavioural : undefined,
      carTimePenaltyMin: e.carTimePenaltyMin !== undefined ? e.carTimePenaltyMin * behavioural : undefined,
      busWaitDeltaMin: e.busWaitDeltaMin !== undefined ? e.busWaitDeltaMin * behavioural : undefined,
      cycleMaxKmExtension: e.cycleMaxKmExtension !== undefined ? e.cycleMaxKmExtension * behavioural : undefined,
      comfortDelta: scaleModeRecord(e.comfortDelta, behavioural, false),
      safetyDelta: scaleModeRecord(e.safetyDelta, behavioural, false),
      travelTimeMultiplier: scaleModeRecord(e.travelTimeMultiplier, behavioural, true),
      costMultiplier: scaleModeRecord(e.costMultiplier, behavioural, true),
    },
    economics: { ...mod.economics, capexUsd: Math.round(mod.economics.capexUsd * capexMult) },
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}
function band(arr: number[]): McBand {
  return {
    p10: Math.round(percentile(arr, 10)),
    p50: Math.round(percentile(arr, 50)),
    p90: Math.round(percentile(arr, 90)),
    mean: Math.round(arr.reduce((s, x) => s + x, 0) / Math.max(1, arr.length)),
  };
}

/** Run N real simulations with sampled inputs; return the output distribution. */
export function monteCarloFull(
  world: WorldState,
  modifiers: WorldModifier[],
  startYear: number,
  endYear: number,
  pathway: PathwayId,
  shocks: Shock[],
  draws = 300
): MonteCarloResult {
  const co2Samples: number[] = [];
  const costSamples: number[] = [];
  let positive = 0;
  let under6k = 0;

  for (let i = 0; i < draws; i++) {
    const behavioural = clamp(1 + randn() * BEHAVIOURAL_SD, 0.4, 1.8);
    const capexMult = clamp(1 + randn() * CAPEX_SD, 0.5, 1.8);
    const displaceFactor = clamp(EV_BASE * (1 + randn() * EV_SD), 0.15, 0.85);

    const perturbed = modifiers.map((m) => perturb(m, behavioural, capexMult));
    const r = simulateTimeline(world, perturbed, startYear, endYear, pathway, shocks, "base", displaceFactor);

    const co2 = r.summary.netCO2AvoidedTonnes;
    co2Samples.push(co2);
    if (co2 > 0) positive++;

    const cpt = r.summary.costPerTonneUsd;
    if (cpt !== null && Number.isFinite(cpt)) {
      costSamples.push(cpt);
      if (cpt < 6000) under6k++;
    }
  }

  co2Samples.sort((a, b) => a - b);
  costSamples.sort((a, b) => a - b);

  return {
    draws,
    co2Tonnes: band(co2Samples),
    costPerTonneUsd: costSamples.length ? band(costSamples) : null,
    probPositiveCarbon: Math.round((positive / draws) * 100),
    probUnder6kPerTonne: costSamples.length ? Math.round((under6k / costSamples.length) * 100) : 0,
    co2Samples,
  };
}
