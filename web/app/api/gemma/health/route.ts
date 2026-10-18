import { NextResponse } from "next/server";
import { gemmaHealth } from "@/lib/compass/llm/gemma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await gemmaHealth());
}
