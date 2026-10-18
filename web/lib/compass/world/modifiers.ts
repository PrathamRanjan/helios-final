// Generic world-modifier application. The core rule of HELIO Flow:
// modifiers edit graph attributes; they NEVER carry hardcoded carbon outcomes.

import type { Mode } from "../types";
import type { WorldState, WorldModifier, CorridorEdge, EdgeEnv } from "./types";
import { distKm, pointToPolylineKm, pointInPolygon } from "./geo";
import wd from "@/data/assumptions/world_defaults.json";

const POINT_RADIUS_KM = (wd.modifier_reach as any).point_radius_km.value as number;
const LINE_BUFFER_KM = (wd.modifier_reach as any).line_buffer_km.value as number;
const ADOPTION_RAMP = (wd.economics as any).adoption_ramp.value as number[];

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Benefit phase-in: a 10-year logistic adoption S-curve (calibrated proxy).
 *  Behaviour keeps shifting across the whole horizon — habit formation and
 *  network effects accrue over a decade rather than saturating in 4 years. */
export function adoptionRamp(yearsSinceBuilt: number): number {
  if (yearsSinceBuilt < 0) return 0;
  const idx = Math.min(yearsSinceBuilt, ADOPTION_RAMP.length - 1);
  return ADOPTION_RAMP[idx];
}

/** An edge counts as meaningfully affected above this weight. */
const AFFECT_THRESHOLD = 0.05;

/** Corridor endpoints get partial exposure (first/last-mile), midpoints full. */
const ENDPOINT_WEIGHT = 0.6;

/** Samples along a corridor used to measure how much of it a linear/area intervention covers. */
const COVERAGE_SAMPLES = 12;

/**
 * Proximity-weighted targeting: effect strength decays linearly with distance
 * from the drawn geometry (1 at the geometry → 0 at the reach limit). A corridor
 * whose midpoint sits on the drawn corridor feels it fully; one that merely
 * starts nearby feels it partially.
 */
export function affectedEdgeWeights(
  world: WorldState,
  modifier: WorldModifier
): Map<string, number> {
  const nodeById = new Map(world.nodes.map((n) => [n.id, n]));
  const weights = new Map<string, number>();
  const g = modifier.geometry;

  const proximity = (p: [number, number]): number => {
    if (g.type === "Point") {
      return Math.max(0, 1 - distKm(p, g.coordinates) / POINT_RADIUS_KM);
    }
    if (g.type === "LineString") {
      return Math.max(0, 1 - pointToPolylineKm(p, g.coordinates) / LINE_BUFFER_KM);
    }
    const ring = g.coordinates[0] ?? [];
    return ring.length >= 3 && pointInPolygon(p, ring) ? 1 : 0;
  };

  for (const edge of world.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    let w: number;
    if (g.type === "Point" || !from || !to) {
      // Point interventions (EV hub, bus stop, station-area works) act per TRIP that starts or
      // ends in their catchment — catchment semantics are right here.
      w = Math.max(
        proximity([edge.midLng, edge.midLat]),
        from ? ENDPOINT_WEIGHT * proximity([from.lng, from.lat]) : 0,
        to ? ENDPOINT_WEIGHT * proximity([to.lng, to.lat]) : 0
      );
    } else {
      // Linear / area interventions (shaded walkway, cycle lane, bus priority) only change the
      // PART of a trip that runs alongside them. Coverage = mean proximity along the corridor,
      // i.e. the share of the trip's length inside the intervention's catchment. (Previously the
      // max of midpoint/endpoint proximity, which applied a 400 m walkway to a whole 2 km trip.)
      let acc = 0;
      for (let i = 0; i < COVERAGE_SAMPLES; i++) {
        const t = (i + 0.5) / COVERAGE_SAMPLES;
        acc += proximity([from.lng + (to.lng - from.lng) * t, from.lat + (to.lat - from.lat) * t]);
      }
      w = acc / COVERAGE_SAMPLES;
    }
    if (w > AFFECT_THRESHOLD) weights.set(edge.id, w);
  }
  return weights;
}

function mergeModeMap(
  target: Partial<Record<Mode, number>>,
  source: Partial<Record<Mode, number>> | undefined,
  ramp: number,
  combine: (cur: number, val: number) => number,
  neutral: number
) {
  if (!source) return;
  for (const [m, v] of Object.entries(source) as [Mode, number][]) {
    // Scale multiplier effects toward neutral by the ramp; additive effects by ramp.
    const scaled = neutral === 1 ? 1 + (v - 1) * ramp : v * ramp;
    target[m] = combine(target[m] ?? neutral, scaled);
  }
}

/**
 * Apply one modifier's effects to every affected edge, scaled by adoption ramp
 * × proximity weight. Mutates `world` (callers pass a per-year clone, never the
 * baseline).
 */
export function applyModifier(world: WorldState, modifier: WorldModifier, year: number): number {
  const ramp = adoptionRamp(year - modifier.metadata.builtYear);
  if (ramp <= 0) return 0;
  const e = modifier.effects;
  const weights = affectedEdgeWeights(world, modifier);

  for (const edge of world.edges) {
    const w = weights.get(edge.id);
    if (!w) continue;
    const k = ramp * w;
    const a: EdgeEnv = edge.attrs;
    if (e.shadeDelta) a.shadeScore = clamp01(a.shadeScore + e.shadeDelta * k);
    if (e.rainProtectionDelta) a.rainExposure = clamp01(a.rainExposure - e.rainProtectionDelta * k);
    if (e.carTimePenaltyMin) a.carTimePenaltyMin += e.carTimePenaltyMin * k;
    if (e.busWaitDeltaMin) a.busWaitDeltaMin += e.busWaitDeltaMin * k;
    if (e.cycleMaxKmExtension) a.cycleMaxKmExtension += e.cycleMaxKmExtension * k;
    mergeModeMap(a.comfortBonus, e.comfortDelta, k, (c, v) => c + v, 0);
    mergeModeMap(a.safetyBonus, e.safetyDelta, k, (c, v) => c + v, 0);
    mergeModeMap(a.travelTimeMultiplier, e.travelTimeMultiplier, k, (c, v) => c * v, 1);
    mergeModeMap(a.costMultiplier, e.costMultiplier, k, (c, v) => c * v, 1);
  }

  // District-wide energy additions (detailed dispatch arrives in M5).
  if (e.solarAnnualKWhDelta) world.energy.addedSolarAnnualKWh += e.solarAnnualKWhDelta * ramp;
  if (e.batteryCapacityKWhDelta) world.energy.addedBatteryKWh += e.batteryCapacityKWhDelta * ramp;
  if (e.chargingCapacityKWDelta) world.energy.addedChargingKW += e.chargingCapacityKWDelta * ramp;

  // Report only meaningfully-affected corridors (weight ≥ 0.3), not every
  // corridor grazed by the decay tail.
  let meaningful = 0;
  for (const w of weights.values()) if (w >= 0.3) meaningful++;
  return meaningful;
}

/** Cheap world clone: nodes/cohorts are immutable in M1, edges + energy mutate. */
export function cloneWorld(world: WorldState, year: number): WorldState {
  return {
    ...world,
    year,
    edges: world.edges.map((edge) => ({
      ...edge,
      attrs: {
        ...edge.attrs,
        comfortBonus: { ...edge.attrs.comfortBonus },
        safetyBonus: { ...edge.attrs.safetyBonus },
        travelTimeMultiplier: { ...edge.attrs.travelTimeMultiplier },
        costMultiplier: { ...edge.attrs.costMultiplier },
      },
    })),
    energy: { ...world.energy },
  };
}
