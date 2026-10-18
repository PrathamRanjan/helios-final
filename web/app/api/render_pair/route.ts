import { NextRequest, NextResponse } from "next/server";
import { dataLayers, fetchGeotiffAsPng } from "@/lib/solar";
import { fetchSatelliteTile } from "@/lib/vision";
import { editWithPanels } from "@/lib/render";

export const runtime = "nodejs";
export const maxDuration = 60;

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";
const GOOGLE_SOLAR_KEY = process.env.GOOGLE_SOLAR_API_KEY ?? GOOGLE_MAPS_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "";

async function baseImageFor(
  lat: number,
  lng: number
): Promise<{ png: Buffer; source: "solar_rgb" | "static_maps" } | null> {
  try {
    const layers = await dataLayers(lat, lng, GOOGLE_SOLAR_KEY);
    if (layers?.rgbUrl) {
      const png = await fetchGeotiffAsPng(layers.rgbUrl, GOOGLE_SOLAR_KEY);
      if (png) return { png, source: "solar_rgb" };
    }
  } catch {
    /* fall through */
  }
  const tile = await fetchSatelliteTile(lat, lng, GOOGLE_MAPS_KEY, 19, 640);
  if (tile) return { png: tile.pngBytes, source: "static_maps" };
  return null;
}

export async function POST(req: NextRequest) {
  const { lat, lng, country_code } = await req.json();
  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "lat and lng required" }, { status: 400 });
  }
  const base = await baseImageFor(lat, lng);
  if (!base) {
    return NextResponse.json({ error: "could not fetch base imagery" }, { status: 502 });
  }
  const after = await editWithPanels(base.png, GEMINI_KEY, country_code ?? null);
  if (!after) {
    return NextResponse.json({ error: "image edit failed" }, { status: 502 });
  }
  return NextResponse.json({
    before: base.png.toString("base64"),
    after: after.toString("base64"),
    imagery_source: base.source,
  });
}
