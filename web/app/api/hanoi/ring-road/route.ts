import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

/** Serves the Ring Road 1 boundary GeoJSON for the deck.gl PolygonLayer. */
export async function GET() {
  try {
    const file = path.join(process.cwd(), "data", "hanoi", "ring_road_1.geojson");
    const raw = await readFile(file, "utf-8");
    const geojson = JSON.parse(raw);
    // Return just the geometry so the client only gets what it needs
    return NextResponse.json(geojson.geometry);
  } catch {
    return NextResponse.json({ error: "ring road data not found" }, { status: 404 });
  }
}
