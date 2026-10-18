import { NextRequest, NextResponse } from "next/server";
import { getSolar } from "@/lib/india/server";
import { indiaCityBySlug } from "@/lib/india/cities";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(req: NextRequest, { params }: { params: { city: string } }) {
  const city = indiaCityBySlug(params.city);
  if (!city) return NextResponse.json({ error: "Unknown India city." }, { status: 404 });
  return getSolar(req, city);
}
