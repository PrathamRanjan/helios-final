// Back-test harness — runs the LIVE HELIO engine against real measured
// before/after outcomes. For each case it applies the intervention to a
// representative Jurong East corridor, reads the modelled uplift on the treated
// corridor (not district-diluted), and compares it to a measured corridor/site
// field result.
//
// HONEST SCOPE (surfaced in the UI): HELIO models a whole-district mode-choice
// elasticity, so its corridor uplift is expected to be SMALLER than a field
// study that measures only the treated segment. The test therefore checks two
// things: DIRECTION (does HELIO move the right way?) and POSTURE (is HELIO
// conservative vs the field result — i.e. does it under-claim, not over-claim?).

import { loadBaselineWorld } from "@/lib/compass/world/buildWorld";
import { cloneWorld, applyModifier, affectedEdgeWeights } from "@/lib/compass/world/modifiers";
import { modeShares } from "@/lib/compass/world/agentChoice";
import { buildModifier } from "@/lib/compass/flow/scenario";
import { simulateTimeline } from "@/lib/compass/world/simulateTimeline";
import type { Mode, ModifierGeometry } from "@/lib/compass/world/types";
import cases from "@/data/backtest_cases.json";

const START = 2026;
const END = 2036;
const BUILT = 2027;
const CORRIDOR_WEIGHT = 0.5; // edges meaningfully on the treated corridor

export type BacktestVerdict = "conservative" | "in-range" | "overshoots" | "wrong-direction";

export interface BacktestRow {
  id: string;
  project: string;
  city: string;
  years: string;
  metric: string;
  mode: Mode;
  measuredLoPct: number;
  measuredHiPct: number;
  modelledUpliftPct: number; // relative uplift on the treated corridor
  co2AvoidedT: number;
  tripsShiftedPerDay: number;
  direction: "match" | "miss";
  verdict: BacktestVerdict;
  source: string;
}

export interface BacktestReport {
  rows: BacktestRow[];
  summary: { directionMatches: number; conservative: number; total: number };
}

/** Relative uplift (%) of `mode` on the treated corridor after the modifier. */
function corridorUplift(
  worldYear: Awaited<ReturnType<typeof loadBaselineWorld>>,
  geometry: ModifierGeometry,
  caps: string[],
  mode: Mode
): number {
  const mod = buildModifier({ geometry, capabilityIds: caps, costTier: "med", builtYear: BUILT });
  const weights = affectedEdgeWeights(worldYear, mod);
  const before = new Map(worldYear.edges.map((e) => [e.id, modeShares(e)[mode]]));
  const after = cloneWorld(worldYear, BUILT);
  applyModifier(after, mod, BUILT);
  let sb = 0, sa = 0;
  for (const e of after.edges) {
    if ((weights.get(e.id) ?? 0) >= CORRIDOR_WEIGHT) { sb += before.get(e.id) ?? 0; sa += modeShares(e)[mode]; }
  }
  return sb > 0 ? ((sa - sb) / sb) * 100 : 0;
}

export async function runBacktests(): Promise<BacktestReport> {
  const geometry: ModifierGeometry = { type: "LineString", coordinates: (cases as any).corridor as [number, number][] };
  // The corridor uplift is read at the build year (full adoption ramp reached
  // over the horizon; BUILT+ keeps the effect present).
  const worldAtBuild = await loadBaselineWorld("jurong_east", BUILT);
  const worldAtStart = await loadBaselineWorld("jurong_east", START);

  const rows: BacktestRow[] = [];
  for (const c of (cases as any).cases as any[]) {
    const modelledUpliftPct = Number(corridorUplift(worldAtBuild, geometry, c.caps, c.mode as Mode).toFixed(1));
    // Full-timeline run for the engine's real headline outputs.
    const mod = buildModifier({ geometry, capabilityIds: c.caps, costTier: "med", builtYear: BUILT });
    const scen = simulateTimeline(worldAtStart, [mod], START, END, "target_achieved", []);

    const direction: "match" | "miss" = modelledUpliftPct > 0 ? "match" : "miss";
    let verdict: BacktestVerdict;
    if (modelledUpliftPct <= 0) verdict = "wrong-direction";
    else if (modelledUpliftPct < c.measuredLoPct) verdict = "conservative";
    else if (modelledUpliftPct <= c.measuredHiPct) verdict = "in-range";
    else verdict = "overshoots";

    rows.push({
      id: c.id,
      project: c.project,
      city: c.city,
      years: c.years,
      metric: c.metric,
      mode: c.mode,
      measuredLoPct: c.measuredLoPct,
      measuredHiPct: c.measuredHiPct,
      modelledUpliftPct,
      co2AvoidedT: Math.round(scen.summary.cumulativeCO2AvoidedTonnes),
      tripsShiftedPerDay: Math.round(scen.summary.tripsShiftedPerDay),
      direction,
      verdict,
      source: c.source,
    });
  }

  return {
    rows,
    summary: {
      directionMatches: rows.filter((r) => r.direction === "match").length,
      conservative: rows.filter((r) => r.verdict === "conservative" || r.verdict === "in-range").length,
      total: rows.length,
    },
  };
}
