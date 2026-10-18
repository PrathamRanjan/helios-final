import { NextRequest, NextResponse } from "next/server";
import { loadBaseline, summarizeForClient } from "@/lib/compass/data";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const baseline = await loadBaseline(params.id);
    return NextResponse.json(summarizeForClient(baseline));
  } catch (e: any) {
    return NextResponse.json(
      { error: `district '${params.id}' not found: ${e?.message ?? e}` },
      { status: 404 }
    );
  }
}
