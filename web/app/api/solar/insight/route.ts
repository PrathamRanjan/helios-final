import { NextRequest, NextResponse } from "next/server";
import { loadBaseline } from "@/lib/compass/data";
import { solarLens } from "@/lib/compass/solar-lens";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { building_id, district_id = "jurong_east", with_storage = false } =
    await req.json();
  try {
    const baseline = await loadBaseline(district_id);
    const building = baseline.buildings.find((b) => b.id === building_id);
    if (!building) {
      return NextResponse.json({ error: `building '${building_id}' not found` }, { status: 404 });
    }
    return NextResponse.json(solarLens(building, baseline, { withStorage: with_storage }));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
