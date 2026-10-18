import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";

let cached: object | null = null;

export async function GET() {
  if (!cached) {
    const filePath = join(process.cwd(), "data", "hanoi", "hanoi_vector.json");
    try {
      cached = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      return NextResponse.json({ buildings: [], roads: [], cycling: [], bbox: [] }, { status: 200 });
    }
  }
  return NextResponse.json(cached);
}
