// Generalized agent mode choice: a NESTED logit (bus+MRT share a public-transport nest,
// walk+cycle share an active-travel nest) with heat / rain / comfort / safety terms driven
// by corridor attributes, plus planning-area constants calibrated to GHS 2025 census mode
// shares (engine/helios_engine/choice/ — BLP contraction, validated out-of-sample).
//
// Output is an illustrative, calibrated reallocation — NOT a ridership forecast.

import type { Mode, ModeSplit } from "../types";
import type { CorridorEdge } from "./types";
import mc from "@/data/assumptions/mode_choice.json";
import freq from "@/data/lta_frequencies.json";
import cal from "@/data/assumptions/calibrated/mode_choice_calibrated.json";

export const MODES: Mode[] = ["car", "bus", "mrt", "walk", "cycle"];

const B = mc.betas as Record<string, { value: number }>;
// Calibrated runtime parameters (engine/helios_engine/choice/export_runtime.py). The nested
// constants are solved so the district's baseline split equals the accepted MNL baseline; only
// substitution behaviour and within-district area differences change.
const RT = (cal as any).runtime as
  | {
      asc_nested: Record<Mode, number>;
      lambda: { pt: number; active: number };
      pa_delta_relative: Record<string, Record<Mode, number>>;
      edge_pa: Record<string, string>;
    }
  | undefined;
const ASC = (RT?.asc_nested ?? mc.asc) as Record<Mode, number>;
const LAMBDA = { pt: RT?.lambda.pt ?? 1, active: RT?.lambda.active ?? 1 };
const NEST_OF: Record<Mode, "car" | "pt" | "active"> = { car: "car", bus: "pt", mrt: "pt", walk: "active", cycle: "active" };

/**
 * Census-calibrated planning-area constant for this corridor (0 if unmapped).
 * Jurong East corridors are mapped in edge_pa; corridors in any other area carry
 * their planning area on the edge (ingest/build_area.py) and use the all-area table.
 */
function paDelta(edgeId: string, mode: Mode, edgePa?: string): number {
  const pa = RT?.edge_pa[edgeId];
  if (pa) return RT!.pa_delta_relative[pa]?.[mode] ?? 0;
  if (edgePa) return (RT as any)?.pa_delta_relative_all?.[edgePa]?.[mode] ?? 0;
  return 0;
}
const SPEED = mc.speed_kmh as Record<Mode, number>;
const WAIT = { ...(mc.access_wait_min as Record<Mode, number>) };
const COST_KM = mc.cost_per_km_usd as Record<Mode, number>;
const COST_FIX = mc.fixed_cost_usd as Record<Mode, number>;
const EXPOSURE = mc.exposure_weight_by_mode as Record<Mode, number>;
const COMFORT_W = mc.comfort_weight_by_mode as Record<Mode, number>;
const SAFETY_W = mc.safety_weight_by_mode as Record<Mode, number>;

// Measured bus wait from real LTA dispatch headways overrides the assumed value.
const realBusWait = (freq as any)?.peak_wait_min;
if (typeof realBusWait === "number") WAIT.bus = realBusWait;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Parameter overrides for uncertainty analysis (Sobol / EVPI / Monte Carlo over MODEL parameters,
 * not just intervention effects). Multipliers on the literature/calibrated values; 1 = unchanged.
 * Callers that change these must call clearBaselineCache() (simulateTimeline) so the memoised
 * policy baseline is recomputed under the same parameters.
 */
export const PARAM_OVERRIDES = { betaHeatMult: 1, betaCostMult: 1, betaTimeMult: 1, lambdaPt: NaN, lambdaActive: NaN };
export function setParamOverrides(o: Partial<typeof PARAM_OVERRIDES>) {
  Object.assign(PARAM_OVERRIDES, { betaHeatMult: 1, betaCostMult: 1, betaTimeMult: 1, lambdaPt: NaN, lambdaActive: NaN }, o);
}
function lambdaNow() {
  return {
    pt: Number.isFinite(PARAM_OVERRIDES.lambdaPt) ? PARAM_OVERRIDES.lambdaPt : LAMBDA.pt,
    active: Number.isFinite(PARAM_OVERRIDES.lambdaActive) ? PARAM_OVERRIDES.lambdaActive : LAMBDA.active,
  };
}

export function utility(mode: Mode, edge: CorridorEdge): number {
  const a = edge.attrs;
  const ttMult = a.travelTimeMultiplier[mode] ?? 1;
  let wait = WAIT[mode];
  if (mode === "bus") wait = Math.max(1, wait + a.busWaitDeltaMin);
  if (mode === "car") wait += a.carTimePenaltyMin;
  const timeMin = (edge.distKm / SPEED[mode]) * 60 * ttMult + wait;

  const costMult = a.costMultiplier[mode] ?? 1;
  const cost = (edge.distKm * COST_KM[mode] + COST_FIX[mode]) * costMult;

  // Shade reduces *effective* heat — the emergent mechanism that makes trees,
  // canopies and covered walkways all work through one physics.
  const effHeat = a.heatExposure * (1 - a.shadeScore);
  const comfort = clamp01(a.comfortScore + (a.comfortBonus[mode] ?? 0));
  const safety = clamp01(a.safetyScore + (a.safetyBonus[mode] ?? 0));

  let u =
    B.time_per_min.value * PARAM_OVERRIDES.betaTimeMult * timeMin +
    B.cost_per_usd.value * PARAM_OVERRIDES.betaCostMult * cost +
    B.heat.value * PARAM_OVERRIDES.betaHeatMult * effHeat * EXPOSURE[mode] +
    B.rain.value * a.rainExposure * EXPOSURE[mode] +
    B.comfort.value * (1 - comfort) * COMFORT_W[mode] +
    B.safety.value * (1 - safety) * SAFETY_W[mode] +
    ASC[mode] +
    paDelta(edge.id, mode, edge.pa);

  if (mode === "walk" && edge.distKm > mc.walk_max_km) u += mc.infeasible_penalty;
  if (mode === "cycle" && edge.distKm > mc.cycle_max_km + a.cycleMaxKmExtension) {
    u += mc.infeasible_penalty;
  }
  return u;
}

/**
 * Nested-logit shares for one corridor (McFadden 1978):
 *   P(m) = P(m | nest) · P(nest),  P(m|k) = e^{V_m/λ_k} / Σ_{j∈k} e^{V_j/λ_k},
 *   P(k) = e^{λ_k I_k} / Σ_l e^{λ_l I_l},  I_k = ln Σ_{j∈k} e^{V_j/λ_k}.
 * λ = 1 for every nest reduces exactly to multinomial logit.
 */
export function nestedShares(u: Record<Mode, number>, lambda = lambdaNow()): ModeSplit {
  const nests: Record<string, Mode[]> = { car: ["car"], pt: ["bus", "mrt"], active: ["walk", "cycle"] };
  const lam = (k: string) => (k === "pt" ? lambda.pt : k === "active" ? lambda.active : 1);
  const top: Record<string, number> = {};
  for (const [k, ms] of Object.entries(nests)) {
    const z = ms.map((m) => u[m] / lam(k));
    const zmax = Math.max(...z);
    const I = zmax + Math.log(z.reduce((acc, x) => acc + Math.exp(x - zmax), 0));
    top[k] = lam(k) * I;
  }
  const tmax = Math.max(...Object.values(top));
  const denom = Object.values(top).reduce((acc, x) => acc + Math.exp(x - tmax), 0);
  const split: any = {};
  for (const [k, ms] of Object.entries(nests)) {
    const pNest = Math.exp(top[k] - tmax) / denom;
    const z = ms.map((m) => u[m] / lam(k));
    const zmax = Math.max(...z);
    const ez = z.map((x) => Math.exp(x - zmax));
    const s = ez.reduce((a, b) => a + b, 0);
    ms.forEach((m, i) => (split[m] = (ez[i] / s) * pNest));
  }
  return split as ModeSplit;
}

/** Mode shares for one corridor under the current world state (nested logit). */
export function modeShares(edge: CorridorEdge): ModeSplit {
  const u: any = {};
  for (const m of MODES) u[m] = utility(m, edge);
  return nestedShares(u);
}

/** Expected maximum utility (logsum) — the consumer-surplus basis (Small & Rosen 1981). */
export function logsum(edge: CorridorEdge, lambda = lambdaNow()): number {
  const u: any = {};
  for (const m of MODES) u[m] = utility(m, edge);
  const nests: Record<string, Mode[]> = { car: ["car"], pt: ["bus", "mrt"], active: ["walk", "cycle"] };
  const lam = (k: string) => (k === "pt" ? lambda.pt : k === "active" ? lambda.active : 1);
  const top = Object.entries(nests).map(([k, ms]) => {
    const z = ms.map((m) => u[m] / lam(k));
    const zmax = Math.max(...z);
    return lam(k) * (zmax + Math.log(z.reduce((acc, x) => acc + Math.exp(x - zmax), 0)));
  });
  const tmax = Math.max(...top);
  return tmax + Math.log(top.reduce((acc, x) => acc + Math.exp(x - tmax), 0));
}

/** |β_cost| — converts logsum differences into dollars per trip (respects overrides). */
export function betaCostAbs(): number {
  return Math.abs(B.cost_per_usd.value * PARAM_OVERRIDES.betaCostMult);
}

export { NEST_OF };
