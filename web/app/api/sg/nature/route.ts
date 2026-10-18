import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { screen, type NatureValues } from "@/lib/compass/nature/screen";

export const runtime = "nodejs";

// Server-only: per-building nature arrays (ingest/sg_nature.py) aligned to skyline.json.
type Cols = Record<string, any>;
let data: { sky: Cols; nat: Cols; areas: Cols; grid: Map<string, number[]> } | null = null;
const CELL = 0.002; // ~220 m grid for nearest-building lookup

async function load() {
  if (data) return data;
  const dir = path.join(process.cwd(), "data", "sg");
  const [sky, nat, areas] = await Promise.all([
    fs.readFile(path.join(dir, "skyline.json"), "utf-8").then(JSON.parse),
    fs.readFile(path.join(dir, "nature", "buildings.json"), "utf-8").then(JSON.parse),
    fs.readFile(path.join(dir, "nature", "areas.json"), "utf-8").then(JSON.parse),
  ]);
  const grid = new Map<string, number[]>();
  for (let i = 0; i < sky.lng.length; i++) {
    const k = `${Math.floor(sky.lng[i] / CELL)},${Math.floor(sky.lat[i] / CELL)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  }
  data = { sky, nat, areas, grid };
  return data;
}

function nearest(d: NonNullable<typeof data>, lng: number, lat: number): number | null {
  const cx = Math.floor(lng / CELL);
  const cy = Math.floor(lat / CELL);
  let best: number | null = null;
  let bd = Infinity;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (const i of d.grid.get(`${cx + dx},${cy + dy}`) ?? []) {
        const e = (d.sky.lng[i] - lng) * Math.cos((lat * Math.PI) / 180);
        const n = d.sky.lat[i] - lat;
        const dist = e * e + n * n;
        if (dist < bd) {
          bd = dist;
          best = i;
        }
      }
  return best;
}

/**
 *   GET /api/sg/nature?lng=..&lat=..   → nature + physical-risk screening for the building there
 *   GET /api/sg/nature?area=<id>       → planning-area summary (land cover, nature share, GBIF)
 *   GET /api/sg/nature                 → all areas + sources
 */
export async function GET(req: NextRequest) {
  let d;
  try {
    d = await load();
  } catch {
    return NextResponse.json({ error: "nature layer not built — run ingest/sg_nature.py" }, { status: 404 });
  }
  const q = req.nextUrl.searchParams;
  const area = q.get("area");
  if (area) {
    const a = d.areas.areas[area];
    return a ? NextResponse.json({ area: area, summary: a, sources: d.areas._sources, retrieved: d.areas.retrieved }) : NextResponse.json({ error: "unknown area" }, { status: 404 });
  }
  const lng = Number(q.get("lng"));
  const lat = Number(q.get("lat"));
  if (Number.isFinite(lng) && Number.isFinite(lat)) {
    const i = nearest(d, lng, lat);
    if (i == null) return NextResponse.json({ error: "no building near that point" }, { status: 404 });
    const n = d.nat;
    const v: NatureValues = {
      d_protected: n.d_protected[i],
      d_nature: n.d_nature[i],
      d_habitat: n.d_habitat[i],
      d_water: n.d_water[i],
      d_flood: n.d_flood[i],
      veg_100m: n.veg_100m[i],
      ground_m: n.ground_m[i],
      land_use: n.lu[i] >= 0 ? n.land_use[n.lu[i]] : null,
    };
    const areaId = d.sky.areas[d.sky.area[i]];
    return NextResponse.json({ index: i, areaId, values: v, ...screen(v), area: d.areas.areas[areaId] ?? null });
  }
  return NextResponse.json({ areas: d.areas.areas, sources: d.areas._sources, retrieved: d.areas.retrieved });
}
