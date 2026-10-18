import { promises as fs } from "fs";
import path from "path";
import type { DistrictBaseline, TransitNode, ODPair } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

// Cache the baseline in module scope — it's large (~9MB) and immutable at runtime.
const cache = new Map<string, DistrictBaseline>();

export type AreaFile = "baseline" | "world" | "vector" | "routes";

/**
 * Where an area's frozen data lives. Jurong East keeps its original hand-calibrated
 * files (Google routes, sun ray-cast shade); every other planning area is built by
 * ingest/build_area.py into data/areas/<id>/.
 */
export function areaDataPath(areaId: string, kind: AreaFile): string {
  if (!/^[a-z0-9_]+$/.test(areaId)) throw new Error(`bad area id '${areaId}'`);
  if (areaId === "jurong_east") {
    const legacy = { baseline: "district_baseline.json", world: "world_baseline_jurong_east.json", vector: "district_vector.json", routes: "district_routes.json" };
    return path.join(DATA_DIR, legacy[kind]);
  }
  return path.join(DATA_DIR, "areas", areaId, kind === "vector" ? "vector.json.gz" : `${kind}.json`);
}

/** Read an area file as text (transparently gunzips *.gz). */
export async function readAreaFile(areaId: string, kind: AreaFile): Promise<string> {
  const file = areaDataPath(areaId, kind);
  const buf = await fs.readFile(file);
  if (file.endsWith(".gz")) {
    const { gunzipSync } = await import("zlib");
    return gunzipSync(buf).toString("utf-8");
  }
  return buf.toString("utf-8");
}

export async function loadBaseline(districtId = "jurong_east"): Promise<DistrictBaseline> {
  const cached = cache.get(districtId);
  if (cached) return cached;
  const raw = await readAreaFile(districtId, "baseline");
  const data = JSON.parse(raw) as DistrictBaseline;
  cache.set(districtId, data);
  return data;
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function nodesWithinKm(
  point: { lat: number; lng: number },
  nodes: TransitNode[],
  radiusKm: number
): TransitNode[] {
  return nodes.filter((n) => haversineKm(point, n) <= radiusKm);
}

/**
 * Total weekday volume through a node (tap_in + tap_out), used for sizing on the map.
 */
export function nodeTotalVolume(node: TransitNode): number {
  const c = node.hourly_weekday;
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  return sum(c.tap_in) + sum(c.tap_out);
}

/**
 * Produce a browser-friendly slice of the baseline: full nodes, top-N OD flows
 * (the national OD matrix clipped to district is still tens of thousands of rows),
 * and buildings. Flows are aggregated across hours per (o,d) pair.
 */
export function summarizeForClient(baseline: DistrictBaseline, topFlows = 120) {
  const nodeByCode = new Map(baseline.nodes.map((n) => [n.code, n]));

  // Aggregate OD across hours.
  const agg = new Map<string, { o: string; d: string; trips: number; dist_km: number; mode: string }>();
  for (const od of baseline.od) {
    const key = `${od.o}->${od.d}`;
    const cur = agg.get(key);
    if (cur) {
      cur.trips += od.trips;
    } else {
      agg.set(key, { o: od.o, d: od.d, trips: od.trips, dist_km: od.dist_km, mode: od.mode });
    }
  }

  const flows = [...agg.values()]
    .filter((f) => nodeByCode.has(f.o) && nodeByCode.has(f.d) && f.o !== f.d)
    .sort((a, b) => b.trips - a.trips)
    .slice(0, topFlows)
    .map((f) => {
      const o = nodeByCode.get(f.o)!;
      const d = nodeByCode.get(f.d)!;
      return {
        o: f.o,
        d: f.d,
        trips: f.trips,
        dist_km: f.dist_km,
        mode: f.mode,
        from: { lat: o.lat, lng: o.lng, name: o.name },
        to: { lat: d.lat, lng: d.lng, name: d.name },
      };
    });

  const nodes = baseline.nodes.map((n) => ({
    code: n.code,
    type: n.type,
    name: n.name,
    road: n.road,
    lat: n.lat,
    lng: n.lng,
    volume: nodeTotalVolume(n),
    peak_hour_in: peakHour(n.hourly_weekday.tap_in),
    hourly_weekday: n.hourly_weekday,
  }));

  return {
    district: baseline.district,
    district_id: baseline.district_id,
    bbox: baseline.bbox,
    pv_month: baseline.pv_month,
    source: baseline.source,
    center: districtCenter(baseline),
    nodes,
    flows,
    buildings: baseline.buildings,
  };
}

function peakHour(arr: number[]): number {
  let best = 0;
  let bestV = -1;
  for (let h = 0; h < arr.length; h++) {
    if (arr[h] > bestV) {
      bestV = arr[h];
      best = h;
    }
  }
  return best;
}

export function districtCenter(baseline: DistrictBaseline): { lat: number; lng: number } {
  const [minLat, minLng, maxLat, maxLng] = baseline.bbox;
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

export type { ODPair };
