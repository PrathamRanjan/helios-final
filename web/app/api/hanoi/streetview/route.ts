import { NextRequest } from "next/server";

export const runtime = "nodejs";

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get("lat") ?? "");
  const lng = parseFloat(searchParams.get("lng") ?? "");
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return new Response("lat and lng required", { status: 400 });
  }
  const params = new URLSearchParams({
    location: `${lat},${lng}`,
    size: "640x360",
    fov: "90",
    pitch: "5",
    source: "outdoor",   // avoids interior/wall shots
    radius: "50",        // only use panoramas within 50m of the coordinate
    key: GOOGLE_MAPS_KEY,
  });
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/streetview?${params}`,
    { cache: "no-store" }
  );
  if (!res.ok) return new Response("street view fetch failed", { status: 502 });
  const buf = Buffer.from(await res.arrayBuffer());
  // Google returns a grey placeholder image (~5kb) when no panorama is found
  if (buf.length < 5000) return new Response("no outdoor street view available", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
  });
}
