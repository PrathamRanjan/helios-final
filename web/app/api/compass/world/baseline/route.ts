import { NextRequest, NextResponse } from "next/server";
import { loadBaselineWorld } from "@/lib/compass/world/buildWorld";
import { evaluateWorld } from "@/lib/compass/world/simulateTimeline";
import { modeShares } from "@/lib/compass/world/agentChoice";
import { policyYear } from "@/lib/compass/policy/applyPolicy";

export const runtime = "nodejs";

/**
 * Baseline diagnosis: the district's measured state plus HELIO's detected
 * problems — the "insight" that precedes the planner's action. Cached in
 * module scope; frozen JSON only.
 */
const cache = new Map<string, any>();

export async function GET(req: NextRequest) {
  const area = req.nextUrl.searchParams.get("area") || "jurong_east";
  if (cache.has(area)) return NextResponse.json(cache.get(area));
  try {
    const world = await loadBaselineWorld(area);
    // Diagnosis = the measured city today: 2026 physics before any transition.
    const m = evaluateWorld(world, policyYear("frozen", 2026).efByMode);

    const nodeById = new Map(world.nodes.map((n) => [n.id, n]));
    const mrt = world.nodes.filter((n) => n.type === "mrt_station").length;
    const bus = world.nodes.filter((n) => n.type === "bus_stop").length;
    const solarReady = world.nodes.filter((n) => (n.attrs.solarKwp ?? 0) > 0);
    const solarKwp = solarReady.reduce((s, n) => s + (n.attrs.solarKwp ?? 0), 0);
    const solarKWh = solarReady.reduce((s, n) => s + (n.attrs.solarAnnualKWh ?? 0), 0);
    const totalDailyTrips = world.edges.reduce((s, e) => s + e.totalTripsDaily, 0);

    // Detected problems: high-demand corridors where exposed active travel is
    // being suppressed — shade/comfort interventions have the most leverage here.
    const exposed = world.edges
      .map((e) => {
        const s = modeShares(e);
        const effHeat = e.attrs.heatExposure * (1 - e.attrs.shadeScore);
        return {
          id: e.id,
          from: nodeById.get(e.from)?.name ?? e.from,
          to: nodeById.get(e.to)?.name ?? e.to,
          fromPos: [nodeById.get(e.from)?.lng, nodeById.get(e.from)?.lat],
          toPos: [nodeById.get(e.to)?.lng, nodeById.get(e.to)?.lat],
          tripsPerDay: Math.round(e.totalTripsDaily),
          distKm: e.distKm,
          shadeDeficit: Math.round(e.totalTripsDaily * e.distKm * effHeat),
        };
      })
      .sort((a, b) => b.shadeDeficit - a.shadeDeficit)
      .slice(0, 5);

    const cached = {
      districtId: world.districtId,
      baselineCO2Tpy: Math.round(m.co2Tonnes * 10) / 10,
      modeShare: m.modeShare,
      heatExposureIndex: Math.round(m.heatIndex),
      totalDailyTrips: Math.round(totalDailyTrips),
      corridors: world.edges.length,
      nodes: { mrt_stations: mrt, bus_stops: bus },
      solar: {
        readyBuildings: solarReady.length,
        totalKwp: Math.round(solarKwp),
        annualKWh: Math.round(solarKWh),
      },
      detected: exposed,
      sources:
        "LTA DataMall OD + PV (measured) · Google Solar (measured) · mode split is an illustrative calibrated reallocation",
    };
    cache.set(area, cached);
    return NextResponse.json(cached);
  } catch (e: any) {
    const missing = e?.code === "ENOENT";
    return NextResponse.json({ error: missing ? `Simulation for '${area}' not built yet` : e?.message ?? String(e), notBuilt: missing }, { status: missing ? 404 : 500 });
  }
}
