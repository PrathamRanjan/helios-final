import { NextResponse } from "next/server";
import { runRedTeam } from "@/lib/compass/redteam/scenarios";

export const runtime = "nodejs";
export const maxDuration = 60;

// Run the red-team suite (deliberately bad interventions) and report which were
// correctly rejected. Deterministic — safe on stage.
export async function GET() {
  try {
    const report = await runRedTeam();
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
