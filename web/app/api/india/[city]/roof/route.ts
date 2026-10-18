import { NextRequest, NextResponse } from "next/server";
import { postRoof } from "@/lib/india/server";
import { indiaCityBySlug } from "@/lib/india/cities";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(req: NextRequest, { params }: { params: { city: string } }) {
  const city = indiaCityBySlug(params.city);
  if (!city) return NextResponse.json({ error: "Unknown India city." }, { status: 404 });
  return postRoof(req, city);
}
