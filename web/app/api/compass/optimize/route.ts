import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { loadBaselineWorld } from "@/lib/compass/world/buildWorld";
import { suggestModifiers } from "@/lib/compass/optimizer/suggestModifiers";
import { PATHWAY_IDS, type PathwayId } from "@/lib/compass/policy/applyPolicy";
import type { Shock } from "@/lib/compass/world/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * HELIO Suggest-Changes: engine-scored recommendations under a budget.
 * Frozen JSON only; every candidate goes through the real simulation.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    districtId = "jurong_east",
    budgetUsd = 2_000_000,
    startYear = 2026,
    endYear = 2036,
    policyPathway = "target_achieved",
    shocks = [],
    existingModifierIds = [],
  } = body;

  if (!PATHWAY_IDS.includes(policyPathway as PathwayId)) {
    return NextResponse.json({ error: "invalid policyPathway" }, { status: 400 });
  }
  if (!Number.isFinite(budgetUsd) || budgetUsd < 100_000 || budgetUsd > 50_000_000) {
    return NextResponse.json({ error: "budgetUsd must be between 100k and 50M" }, { status: 400 });
  }

  try {
    const world = await loadBaselineWorld(districtId, startYear);
    let evSites: any[] = [];
    // The EV site shortlist has only been screened for Jurong East; elsewhere the optimizer skips that family.
    if (districtId === "jurong_east") try {
      const raw = await fs.readFile(
        path.join(process.cwd(), "data", "ev_candidate_sites.json"),
        "utf-8"
      );
      evSites = JSON.parse(raw).sites ?? [];
    } catch {
      /* no EV shortlist — optimizer just skips that family */
    }

    const result = suggestModifiers(world, {
      budgetUsd,
      startYear,
      endYear,
      pathway: policyPathway as PathwayId,
      shocks: shocks as Shock[],
      evSites,
      existingModifierIds,
    });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
