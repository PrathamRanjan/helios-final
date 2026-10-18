import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const DEMO_DIR = path.join(process.cwd(), "data", "demo_data");

export async function GET(_req: Request, ctx: { params: { slug: string } }) {
  const p = path.join(DEMO_DIR, `${ctx.params.slug}.json`);
  try {
    const raw = await fs.readFile(p, "utf-8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ detail: "not found" }, { status: 404 });
  }
}
