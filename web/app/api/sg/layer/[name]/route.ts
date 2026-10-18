import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const FILES: Record<string, string[]> = { skyline: ["skyline.json"], roads: ["roads.json"], nature: ["nature", "layer.json"] };

/** Island-wide world layers built by ingest/sg_skyline.py (served compressed by Next). */
export async function GET(_req: NextRequest, { params }: { params: { name: string } }) {
  const file = FILES[params.name];
  if (!file) return NextResponse.json({ error: "unknown layer" }, { status: 404 });
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "data", "sg", ...file), "utf-8");
    return new NextResponse(raw, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" } });
  } catch {
    return NextResponse.json({ error: `${params.name}.json not built — run ingest/${params.name === "nature" ? "sg_nature" : "sg_skyline"}.py` }, { status: 404 });
  }
}
