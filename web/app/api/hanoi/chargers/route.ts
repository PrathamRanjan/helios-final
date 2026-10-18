import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

/** Serves the pre-ingested Hanoi charger dataset (existing + candidate sites). */
export async function GET() {
  try {
    const file = path.join(process.cwd(), "data", "hanoi", "chargers.json");
    const raw = await readFile(file, "utf-8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "charger data not found" }, { status: 404 });
  }
}
