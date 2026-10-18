import { NextRequest, NextResponse } from "next/server";
import { readAreaFile } from "@/lib/compass/data";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const raw = await readAreaFile(params.id, "routes");
    return new NextResponse(raw, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" } });
  } catch {
    return NextResponse.json({ error: `routes for '${params.id}' not built yet — run ingest/build_area.py ${params.id}` }, { status: 404 });
  }
}
