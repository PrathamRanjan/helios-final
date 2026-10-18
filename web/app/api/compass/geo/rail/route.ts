import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

/** Island-wide OSM rail/subway track polylines (Geofabrik extract, ingest/sg_osm_extract.py).
 *  Clients clip to the area they are viewing. Shape: { lines: [{ t, c: [[lng,lat], ...] }] }. */
export async function GET() {
  for (const f of [path.join("data", "sg", "rail_lines.json"), path.join("data", "geo", "rail_lines.json")]) {
    try {
      const raw = await fs.readFile(path.join(process.cwd(), f), "utf-8");
      return new NextResponse(raw, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" } });
    } catch {}
  }
  return NextResponse.json({ error: "rail_lines.json not found" }, { status: 404 });
}
