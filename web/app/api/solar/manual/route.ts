import { NextRequest, NextResponse } from "next/server";
import { reverseCountry } from "@/lib/geocoder";
import { solarViaManual } from "@/lib/solar-service";
import { TARIFFS } from "@/lib/finance";

export const runtime = "nodejs";
export const maxDuration = 30;

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { lat, lng, roof_area_m2, roof_type, address } = body;
  let country = body.country_code as string | undefined;
  if (!country) {
    country = (await reverseCountry(lat, lng, GOOGLE_MAPS_KEY).catch(() => null)) ?? "DEFAULT";
  }
  if (!(country in TARIFFS)) country = "DEFAULT";

  const result = await solarViaManual(
    lat,
    lng,
    Number(roof_area_m2),
    String(roof_type ?? "flat"),
    address ?? null,
    country
  );
  return NextResponse.json(result);
}
