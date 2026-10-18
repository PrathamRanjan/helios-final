import { NextRequest, NextResponse } from "next/server";
import { loadBaselineWorld } from "@/lib/compass/world/buildWorld";
import { monteCarloFull } from "@/lib/compass/act/monteCarloFull";
import { sensitivityTornado } from "@/lib/compass/act/sensitivity";
import { PATHWAY_IDS, type PathwayId } from "@/lib/compass/policy/applyPolicy";
import type { WorldModifier, Shock } from "@/lib/compass/world/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_MODIFIERS = 50;
// Each draw re-runs the full ~5,000-edge simulation (~140 ms), so cap draws to
// stay well under the route's 30 s budget.
const MAX_DRAWS = 150;

/**
 * FULL Monte Carlo: re-runs the real simulation N times with sampled inputs
 * (behavioural response, EV displacement, capex) and returns the resulting
 * distribution of net CO₂ avoided and cost-per-tonne. Frozen-world only.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    districtId?: string;
    startYear?: number;
    endYear?: number;
    modifiers?: WorldModifier[];
    policyPathway?: string;
    shocks?: Shock[];
    draws?: number;
  };
  const {
    districtId = "jurong_east",
    startYear = 2026,
    endYear = 2036,
    modifiers = [],
    policyPathway = "target_achieved",
    shocks = [],
    draws = 60,
  } = body;

  if (!Array.isArray(modifiers) || modifiers.length === 0 || modifiers.length > MAX_MODIFIERS) {
    return NextResponse.json({ error: `modifiers must be a non-empty array of ≤${MAX_MODIFIERS}` }, { status: 400 });
  }
  if (!PATHWAY_IDS.includes(policyPathway as PathwayId)) {
    return NextResponse.json({ error: "invalid policyPathway" }, { status: 400 });
  }
  const nDraws = Math.max(30, Math.min(MAX_DRAWS, Number(draws) || 60));

  try {
    const world = await loadBaselineWorld(districtId, startYear);
    const result = monteCarloFull(
      world,
      modifiers,
      startYear,
      endYear,
      policyPathway as PathwayId,
      (shocks as Shock[]) ?? [],
      nDraws
    );
    // Same world load → also run the OAT sensitivity tornado (≈7 real sims).
    const sensitivity = sensitivityTornado(world, modifiers, startYear, endYear, (shocks as Shock[]) ?? []);
    // Drop the raw sample array from the wire payload (keep it lean).
    const { co2Samples, ...lean } = result;
    return NextResponse.json({ ...lean, histogram: histogram(co2Samples), sensitivity });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}

/** Coarse 12-bin histogram of the CO₂ samples for a sparkline. */
function histogram(samples: number[], bins = 12): { x: number; n: number }[] {
  if (samples.length === 0) return [];
  const lo = Math.min(...samples);
  const hi = Math.max(...samples);
  const w = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const s of samples) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor((s - lo) / w)));
    counts[b]++;
  }
  return counts.map((n, i) => ({ x: Math.round(lo + (i + 0.5) * w), n }));
}
