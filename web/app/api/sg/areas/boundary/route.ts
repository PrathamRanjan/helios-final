import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

let fc: any = null;

/** Planning-area boundary rings ([lng,lat][]) for one area, or the full FeatureCollection. */
export async function GET(req: NextRequest) {
  if (!fc) fc = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "sg", "planning_areas.geojson"), "utf-8"));
  const area = req.nextUrl.searchParams.get("area");
  if (!area) return NextResponse.json(fc, { headers: { "Cache-Control": "public, max-age=86400" } });
  const f = fc.features.find((x: any) => x.properties.id === area);
  if (!f) return NextResponse.json({ error: "unknown area" }, { status: 404 });
  const g = f.geometry;
  const rings = g.type === "Polygon" ? [g.coordinates[0]] : g.coordinates.map((p: any) => p[0]);
  return NextResponse.json({ rings }, { headers: { "Cache-Control": "public, max-age=86400" } });
}
