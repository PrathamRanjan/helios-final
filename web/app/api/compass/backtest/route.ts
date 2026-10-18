import { NextResponse } from "next/server";
import { runBacktests } from "@/lib/compass/backtest/runBacktest";

export const runtime = "nodejs";
export const maxDuration = 60;

// Back-test the live engine against real measured before/after outcomes.
// Deterministic (no randomness) — safe to run on stage.
export async function GET() {
  try {
    const report = await runBacktests();
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
