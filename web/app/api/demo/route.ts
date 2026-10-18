import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const DEMO_DIR = path.join(process.cwd(), "data", "demo_data");

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const country = searchParams.get("country")?.toUpperCase();
  let files: string[];
  try {
    files = await fs.readdir(DEMO_DIR);
  } catch {
    return NextResponse.json({ buildings: [] });
  }
  const out: any[] = [];
  for (const f of files.sort()) {
    if (!f.endsWith(".json")) continue;
    if (f.endsWith("-proposal.json")) continue;
    const slug = f.replace(/\.json$/, "");
    try {
      const raw = await fs.readFile(path.join(DEMO_DIR, f), "utf-8");
      const data = JSON.parse(raw);
      if (country && (data.country_code ?? "").toUpperCase() !== country) continue;
      out.push({
        slug,
        address: data.address,
        lat: data.lat,
        lng: data.lng,
        country_code: data.country_code,
        headline: data.headline ?? "",
      });
    } catch {
      continue;
    }
  }
  return NextResponse.json({ buildings: out });
}
