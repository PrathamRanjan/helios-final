// Server-only loader for real OSM geometry (Jurong East): building footprints
// and rail/subway track. Kept out of placementCheck (which stays pure) so the
// 2.6 MB building file never reaches the client bundle — routes load it here and
// pass it in. Cached at module scope after first read.

import { promises as fs } from "fs";
import path from "path";

export interface FeasibilityGeo {
  buildings: [number, number][][]; // polygon rings, [lng,lat]
  rail: [number, number][][]; // polylines, [lng,lat]
  buildingsH: { h: number; ring: [number, number][] }[]; // height-tagged footprints (metres)
}

let cache: FeasibilityGeo | null = null;

export async function loadFeasibilityGeo(): Promise<FeasibilityGeo> {
  if (cache) return cache;
  try {
    const dir = path.join(process.cwd(), "data", "geo");
    const [b, r, h] = await Promise.all([
      fs.readFile(path.join(dir, "building_footprints.json"), "utf-8"),
      fs.readFile(path.join(dir, "rail_lines.json"), "utf-8"),
      fs.readFile(path.join(dir, "building_heights.json"), "utf-8").catch(() => "{}"),
    ]);
    cache = {
      buildings: (JSON.parse(b).rings as [number, number][][]) ?? [],
      rail: ((JSON.parse(r).lines as { c: [number, number][] }[]) ?? []).map((l) => l.c),
      buildingsH: ((JSON.parse(h).buildings as { h: number; r: [number, number][] }[]) ?? []).map((x) => ({ h: x.h, ring: x.r })),
    };
  } catch {
    cache = { buildings: [], rail: [], buildingsH: [] };
  }
  return cache;
}
