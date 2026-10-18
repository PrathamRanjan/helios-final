import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

/** HELIO-recommended EV charging opportunity zones (frozen offline artifact; Jurong East only so far). */
export async function GET(req: NextRequest) {
  const area = req.nextUrl.searchParams.get("area") || "jurong_east";
  if (area !== "jurong_east") return NextResponse.json({ sites: [], note: "EV site screening has only been run for Jurong East." });
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "data", "ev_candidate_sites.json"), "utf-8");
    return new NextResponse(raw, { headers: { "Content-Type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "ev_candidate_sites.json not found — run ingest/build_ev_candidate_sites.py" }, { status: 404 });
  }
}
