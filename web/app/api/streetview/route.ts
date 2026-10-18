import { NextRequest } from "next/server";
import { streetViewBytes } from "@/lib/context";

export const runtime = "nodejs";
export const maxDuration = 15;

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get("lat") ?? "");
  const lng = parseFloat(searchParams.get("lng") ?? "");
  const size = searchParams.get("size") ?? "640x400";
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return new Response("lat and lng required", { status: 400 });
  }
  const img = await streetViewBytes(lat, lng, GOOGLE_MAPS_KEY, size);
  if (!img) return new Response("no street view available", { status: 404 });
  return new Response(new Uint8Array(img), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
  });
}
