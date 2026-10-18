import { NextRequest } from "next/server";
import { fetchSatelliteTile } from "@/lib/vision";

export const runtime = "nodejs";

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get("lat") ?? "");
  const lng = parseFloat(searchParams.get("lng") ?? "");
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return new Response("lat and lng required", { status: 400 });
  }
  const result = await fetchSatelliteTile(lat, lng, GOOGLE_MAPS_KEY, 19, 640);
  if (!result) return new Response("no satellite imagery available", { status: 404 });
  return new Response(new Uint8Array(result.pngBytes), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
  });
}
