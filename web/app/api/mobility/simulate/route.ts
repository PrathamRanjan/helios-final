import { NextRequest, NextResponse } from "next/server";
import { loadBaseline } from "@/lib/compass/data";
import { simulateIntervention, type InterventionId } from "@/lib/compass/mobility";

export const runtime = "nodejs";

const VALID: InterventionId[] = ["green_corridor", "road_to_green", "mobility_hub", "sheltered_walkway", "erp_parking", "new_bus_stop"];

export async function POST(req: NextRequest) {
  const { intervention, district_id = "jurong_east", weather = "clear" } = await req.json();
  if (!VALID.includes(intervention)) {
    return NextResponse.json(
      { error: `intervention must be one of ${VALID.join(", ")}` },
      { status: 400 }
    );
  }
  try {
    const baseline = await loadBaseline(district_id);
    return NextResponse.json(simulateIntervention(intervention, baseline, weather));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
