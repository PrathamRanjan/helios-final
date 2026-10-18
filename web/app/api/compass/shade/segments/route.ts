import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { loadBaselineWorld } from "@/lib/compass/world/buildWorld";

export const runtime = "nodejs";

/**
 * Per-corridor shade + effective-heat segments for the UI heat layer. Jurong East
 * uses its sun ray-cast artifact; other areas derive segments from their world's
 * corridor shade (building-proximity proxy).
 */
export async function GET(req: NextRequest) {
  const area = req.nextUrl.searchParams.get("area") || "jurong_east";
  try {
    if (area === "jurong_east") {
      const raw = await fs.readFile(path.join(process.cwd(), "data", "shade_segments.json"), "utf-8");
      return new NextResponse(raw, { headers: { "Content-Type": "application/json" } });
    }
    const world = await loadBaselineWorld(area);
    const byId = new Map(world.nodes.map((n) => [n.id, n]));
    const segments = world.edges
      .filter((e) => e.distKm <= 3)
      .sort((a, b) => b.totalTripsDaily - a.totalTripsDaily)
      .slice(0, 400)
      .map((e) => {
        const f = byId.get(e.from)!;
        const t = byId.get(e.to)!;
        return {
          id: e.id,
          from: [f.lng, f.lat],
          to: [t.lng, t.lat],
          shade: e.attrs.shadeScore,
          effHeat: +(e.attrs.heatExposure * (1 - e.attrs.shadeScore)).toFixed(3),
          tripsPerDay: Math.round(e.totalTripsDaily),
        };
      });
    return NextResponse.json({ segments, source: "corridor shade proxy (OSM building proximity)" });
  } catch {
    return NextResponse.json({ error: `no world for '${area}' yet` }, { status: 404 });
  }
}
