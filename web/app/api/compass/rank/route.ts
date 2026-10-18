import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { loadBaseline } from "@/lib/compass/data";
import { rankInterventions, type InterventionSpec } from "@/lib/compass/engine";

export const runtime = "nodejs";

const CACHE_DIR = path.join(process.cwd(), "data", "compass_cache");

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    district_id = "jurong_east",
    interventions,
    sort_by = "cost_per_tonne",
  }: {
    district_id?: string;
    interventions?: InterventionSpec[];
    sort_by?: "cost_per_tonne" | "co2";
  } = body;

  try {
    // Serve a pre-computed cache for the default demo catalogue when present —
    // nothing live can fail on stage.
    if (!interventions || interventions.length === 0) {
      try {
        const cached = await fs.readFile(
          path.join(CACHE_DIR, `${district_id}_rank.json`),
          "utf-8"
        );
        const data = JSON.parse(cached);
        // honor requested sort on the cached data
        data.ranked.sort((a: any, b: any) =>
          sort_by === "co2"
            ? b.co2_avoided_tpy - a.co2_avoided_tpy
            : a.cost_per_tonne_usd - b.cost_per_tonne_usd
        );
        return NextResponse.json({ ...data, cached: true });
      } catch {
        /* no cache — compute live */
      }
    }

    const baseline = await loadBaseline(district_id);
    return NextResponse.json(rankInterventions(baseline, interventions, sort_by));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
