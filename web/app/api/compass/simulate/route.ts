import { NextRequest, NextResponse } from "next/server";
import { loadBaselineWorld } from "@/lib/compass/world/buildWorld";
import { simulateTimeline } from "@/lib/compass/world/simulateTimeline";
import { placementCheck } from "@/lib/compass/feasibility/placementCheck";
import { loadFeasibilityGeo } from "@/lib/compass/feasibility/geoData";
import { PATHWAY_IDS, type PathwayId } from "@/lib/compass/policy/applyPolicy";
import type { ScenarioRequest, WorldModifier, Shock } from "@/lib/compass/world/types";

export const runtime = "nodejs";

const MAX_MODIFIERS = 50;
const MAX_SHOCKS = 10;
const SHOCK_TYPES = new Set(["heatwave", "heavy_rain", "oil_price_spike", "pandemic", "grid_carbon_spike", "mrt_loop_closure", "haze"]);

/**
 * HELIO Flow scenario simulation. Frozen-JSON only — no live external API in
 * the demo hot path. Modifiers edit the world; agents react; carbon is emergent.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Partial<ScenarioRequest>;
  const {
    districtId = "jurong_east",
    startYear = 2026,
    endYear = 2036,
    modifiers = [],
    policyPathway = "target_achieved",
    shocks = [],
    evDisplacement = "base",
  } = body;
  const EV_LEVELS = new Set(["conservative", "base", "aggressive"]);
  const evLevel = EV_LEVELS.has(evDisplacement as string) ? evDisplacement : "base";

  if (!Array.isArray(modifiers) || modifiers.length > MAX_MODIFIERS) {
    return NextResponse.json({ error: `modifiers must be an array of ≤${MAX_MODIFIERS}` }, { status: 400 });
  }
  if (!PATHWAY_IDS.includes(policyPathway as PathwayId)) {
    return NextResponse.json({ error: `policyPathway must be one of ${PATHWAY_IDS.join(", ")}` }, { status: 400 });
  }
  if (!Array.isArray(shocks) || shocks.length > MAX_SHOCKS) {
    return NextResponse.json({ error: `shocks must be an array of ≤${MAX_SHOCKS}` }, { status: 400 });
  }
  for (const s of shocks as Shock[]) {
    if (!SHOCK_TYPES.has(s?.type) || !Number.isFinite(s?.startYear)) {
      return NextResponse.json({ error: "each shock needs a valid type and startYear" }, { status: 400 });
    }
  }
  if (endYear < startYear || endYear - startYear > 30) {
    return NextResponse.json({ error: "invalid year range" }, { status: 400 });
  }

  const sane: WorldModifier[] = [];
  for (const m of modifiers) {
    if (!m?.geometry?.type || !m?.effects) {
      return NextResponse.json({ error: "each modifier needs geometry and effects" }, { status: 400 });
    }
    sane.push({
      ...m,
      economics: {
        capexUsd: Number(m.economics?.capexUsd) || 0,
        annualOpexUsd: Number(m.economics?.annualOpexUsd) || 0,
        lifetimeYears: Number(m.economics?.lifetimeYears) || 15,
      },
      metadata: {
        createdBy: m.metadata?.createdBy ?? "user",
        confidence: m.metadata?.confidence ?? "calibrated proxy",
        builtYear: Number(m.metadata?.builtYear) || startYear,
        notes: m.metadata?.notes,
      },
    });
  }

  try {
    const world = await loadBaselineWorld(districtId, startYear);
    const result = simulateTimeline(
      world,
      sane,
      startYear,
      endYear,
      policyPathway as PathwayId,
      shocks as Shock[],
      evLevel as "conservative" | "base" | "aggressive"
    );
    // Placement plausibility screen — flag physically questionable sitings
    // (EV on a rail platform, path on a rail alignment, solar without a host).
    const geo = await loadFeasibilityGeo();
    const placementWarnings = sane
      .map((m) => {
        const fc = placementCheck(m, world, geo);
        return fc.severity === "ok"
          ? null
          : { modifierId: m.id, label: m.label, severity: fc.severity as "block" | "review", flags: fc.flags.map((f) => ({ code: f.code, message: f.message, fix: f.fix })) };
      })
      .filter(Boolean);
    return NextResponse.json({ ...result, placementWarnings });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
