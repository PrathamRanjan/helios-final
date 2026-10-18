import { NextRequest, NextResponse } from "next/server";
import { gatherContext } from "@/lib/context";

export const runtime = "nodejs";
export const maxDuration = 30;

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get("lat") ?? "");
  const lng = parseFloat(searchParams.get("lng") ?? "");
  const address = searchParams.get("address") ?? undefined;
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json({ error: "lat and lng required" }, { status: 400 });
  }
  const ctx = await gatherContext(lat, lng, GOOGLE_MAPS_KEY, address);
  return NextResponse.json(ctx);
}
