import { NextRequest } from "next/server";
import { fetchSatelliteTile } from "@/lib/vision";

export const runtime = "nodejs";
export const maxDuration = 15;

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get("lat") ?? "");
  const lng = parseFloat(searchParams.get("lng") ?? "");
  const zoom = parseInt(searchParams.get("zoom") ?? "19", 10);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return new Response("lat and lng required", { status: 400 });
  }
  const tile = await fetchSatelliteTile(lat, lng, GOOGLE_MAPS_KEY, zoom, 640);
  if (!tile) return new Response("static maps fetch failed", { status: 502 });
  return new Response(new Uint8Array(tile.pngBytes), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
  });
}
