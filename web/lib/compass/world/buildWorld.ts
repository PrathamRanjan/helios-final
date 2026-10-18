// Builds the baseline WorldState from the frozen district baseline JSON.
// Real data in, world graph out: nodes from LTA stops/stations + solar buildings,
// corridor edges + agent cohorts from the fare-card OD matrix.

import type { DistrictBaseline } from "../types";
import { loadBaseline } from "../data";
import { weekdaysInMonth } from "../mobility";
import type { WorldState, WorldNode, CorridorEdge, AgentCohort, EdgeEnv } from "./types";
import mc from "@/data/assumptions/mode_choice.json";
import wd from "@/data/assumptions/world_defaults.json";

const PT_SHARE = (mc.baseline_pt_share as any).value as number;
const ENV = wd.edge_defaults as Record<string, { value: number }>;

function defaultEnv(): EdgeEnv {
  return {
    heatExposure: ENV.heatExposure.value,
    rainExposure: ENV.rainExposure.value,
    shadeScore: ENV.shadeScore.value,
    comfortScore: ENV.comfortScore.value,
    safetyScore: ENV.safetyScore.value,
    comfortBonus: {},
    safetyBonus: {},
    travelTimeMultiplier: {},
    costMultiplier: {},
    carTimePenaltyMin: 0,
    busWaitDeltaMin: 0,
    cycleMaxKmExtension: 0,
  };
}

export function worldFromBaseline(baseline: DistrictBaseline, year: number): WorldState {
  const nodes: WorldNode[] = [];
  const nodeById = new Map<string, WorldNode>();

  for (const n of baseline.nodes) {
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const node: WorldNode = {
      id: n.code,
      type: n.type === "TRAIN" ? "mrt_station" : "bus_stop",
      name: n.name,
      lat: n.lat,
      lng: n.lng,
      attrs: { footfallDaily: sum(n.hourly_weekday.tap_in) + sum(n.hourly_weekday.tap_out) },
    };
    nodes.push(node);
    nodeById.set(node.id, node);
  }

  for (const b of baseline.buildings) {
    nodes.push({
      id: b.id,
      type: "building",
      name: b.name,
      lat: b.lat,
      lng: b.lng,
      attrs: b.solar.available
        ? { solarAnnualKWh: b.solar.annual_kwh, solarKwp: b.solar.kwp }
        : {},
    });
  }

  // Aggregate the monthly OD matrix into corridor edges (V2 buildCorridors logic,
  // but keeping node identity so drawn geometry can target corridors).
  const wkdays = weekdaysInMonth(baseline.pv_month);
  const agg = new Map<string, { o: string; d: string; trips: number; dist: number }>();
  for (const od of baseline.od) {
    if (od.o === od.d) continue;
    const key = `${od.o}->${od.d}`;
    const cur = agg.get(key);
    if (cur) cur.trips += od.trips;
    else agg.set(key, { o: od.o, d: od.d, trips: od.trips, dist: od.dist_km });
  }

  const edges: CorridorEdge[] = [];
  const cohorts: AgentCohort[] = [];
  for (const { o, d, trips, dist } of agg.values()) {
    if (trips <= 0 || dist <= 0) continue;
    const from = nodeById.get(o);
    const to = nodeById.get(d);
    if (!from || !to) continue;
    const dailyTransit = trips / wkdays;
    const id = `${o}->${d}`;
    edges.push({
      id,
      from: o,
      to: d,
      distKm: dist,
      midLat: (from.lat + to.lat) / 2,
      midLng: (from.lng + to.lng) / 2,
      observedTransitDaily: dailyTransit,
      totalTripsDaily: dailyTransit / PT_SHARE,
      attrs: defaultEnv(),
    });
    cohorts.push({
      id: `cohort:${id}`,
      edgeId: id,
      tripsPerDay: dailyTransit / PT_SHARE,
      availableModes: ["car", "bus", "mrt", "walk", "cycle"],
    });
  }

  return {
    year,
    districtId: baseline.district_id,
    nodes,
    edges,
    cohorts,
    energy: { addedSolarAnnualKWh: 0, addedBatteryKWh: 0, addedChargingKW: 0 },
  };
}

// The baseline world is immutable at runtime; cache per district.
const cache = new Map<string, WorldState>();

/**
 * Prefer the frozen artifact from ingest/build_world_state.py; fall back to
 * building from district_baseline.json at runtime (identical logic) so the
 * demo never depends on the extra file existing.
 */
export async function loadBaselineWorld(districtId = "jurong_east", year = 2026): Promise<WorldState> {
  const key = `${districtId}:${year}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let world: WorldState | null = null;
  try {
    const { readAreaFile } = await import("../data");
    const raw = await readAreaFile(districtId, "world");
    const frozen = JSON.parse(raw) as WorldState;
    world = { ...frozen, year };
  } catch {
    /* no frozen artifact — build from the district baseline */
  }
  if (!world) {
    const baseline = await loadBaseline(districtId);
    world = worldFromBaseline(baseline, year);
  }
  cache.set(key, world);
  return world;
}
