import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { stockPercentiles } from "@/lib/compass/carbon/ghg";

export const runtime = "nodejs";

let cache: { buildings: any[] } | null = null;

/** Island-wide BCA building profiles (ingest/sg_buildings.py), optionally filtered to one planning area. */
export async function GET(req: NextRequest) {
  try {
    if (!cache) {
      cache = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "sg", "buildings.json"), "utf-8")) as { buildings: any[] };
      // Rank each building's 2020 EUI against its peers in BCA's listing (SAT TSC 3.4 "top 15% of stock").
      const pct = stockPercentiles(cache.buildings);
      for (const b of cache.buildings) {
        const p = pct.get(b.id);
        b.stock_percentile = p ? p.pct : null;
        b.stock_peers = p ? p.n : null;
      }
    }
    const area = req.nextUrl.searchParams.get("area");
    const buildings = area ? cache!.buildings.filter((b) => b.area === area) : cache!.buildings;
    return NextResponse.json({ buildings }, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch {
    return NextResponse.json({ buildings: [], error: "buildings.json not built — run ingest/sg_buildings.py" }, { status: 404 });
  }
}
