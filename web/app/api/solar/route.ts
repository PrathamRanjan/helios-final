import { NextRequest, NextResponse } from "next/server";
import { reverseCountry } from "@/lib/geocoder";
import { solarViaSolarApi, solarViaVision } from "@/lib/solar-service";
import { TARIFFS } from "@/lib/finance";

export const runtime = "nodejs";
export const maxDuration = 60;

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get("lat") ?? "");
  const lng = parseFloat(searchParams.get("lng") ?? "");
  const address = searchParams.get("address");
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json({ error: "lat and lng required" }, { status: 400 });
  }

  const geoCountry = await reverseCountry(lat, lng, GOOGLE_MAPS_KEY).catch(() => null);
  const country = geoCountry && geoCountry in TARIFFS ? geoCountry : geoCountry ?? "DEFAULT";

  let real: any = null;
  try {
    real = await solarViaSolarApi(lat, lng, address, country);
  } catch {
    real = null;
  }
  if (real) return NextResponse.json(real);

  const vision = await solarViaVision(lat, lng, address, country);
  return NextResponse.json(vision);
}
