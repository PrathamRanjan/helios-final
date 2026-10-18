// Pure agent-generation + motion math for the 3D world (client-safe, no deps).

export type AgentMode = "car" | "bus" | "mrt" | "walk" | "cycle";

export interface RoutePaths {
  walking?: [number, number][];
  driving?: [number, number][];
  transit?: [number, number][];
}

export interface Corridor {
  o: string;
  d: string;
  trips: number;
  o_name: string;
  d_name: string;
  o_type: string;
  d_type: string;
  ground_m: number;
  paths: RoutePaths;
}

export interface RailSegment {
  line: string;
  from: string;
  to: string;
  from_name: string;
  to_name: string;
  path: [number, number][];
}

export interface RouteData {
  district_id: string;
  district_ground_m: number;
  source: string;
  routes: Corridor[];
  rail?: RailSegment[];
}

export interface Agent {
  id: number;
  mode: AgentMode;
  path: [number, number][];
  cumul: number[]; // cumulative metres at each vertex
  length: number; // total metres
  ground: number;
  phase: number; // 0..1 start offset
  fracPerSec: number; // progress per second
}

// realistic mode speeds (m/s)
const SPEED_MPS: Record<AgentMode, number> = {
  walk: 1.3,
  cycle: 4.2,
  car: 11,
  bus: 7,
  mrt: 15,
};

export function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function cumulative(path: [number, number][]): { cumul: number[]; length: number } {
  const cumul = [0];
  for (let i = 1; i < path.length; i++) {
    cumul.push(cumul[i - 1] + haversineM(path[i - 1], path[i]));
  }
  return { cumul, length: cumul[cumul.length - 1] || 1 };
}

export function pathForMode(c: Corridor, mode: AgentMode): [number, number][] | null {
  if (mode === "walk" || mode === "cycle") return c.paths.walking ?? c.paths.driving ?? null;
  if (mode === "car") return c.paths.driving ?? c.paths.walking ?? null;
  if (mode === "bus") return c.paths.driving ?? c.paths.transit ?? null;
  if (mode === "mrt") return c.paths.transit ?? c.paths.driving ?? null;
  return null;
}

export interface ModeSplit {
  car: number;
  bus: number;
  mrt: number;
  walk: number;
  cycle: number;
}

const MODES: AgentMode[] = ["car", "bus", "mrt", "walk", "cycle"];

/**
 * Realistic per-corridor mode set: MRT only belongs on station↔station corridors
 * (which follow rail); bus-stop corridors get road/active modes (no MRT on roads).
 */
function localSplit(c: Corridor, split: ModeSplit): ModeSplit {
  const bothTrain = c.o_type === "TRAIN" && c.d_type === "TRAIN";
  const weights: ModeSplit = bothTrain
    ? { car: split.car, bus: 0, mrt: split.mrt + split.bus, walk: 0, cycle: 0 }
    : { car: split.car, bus: split.bus, mrt: 0, walk: split.walk, cycle: split.cycle };
  const sum = MODES.reduce((s, m) => s + weights[m], 0) || 1;
  return {
    car: weights.car / sum,
    bus: weights.bus / sum,
    mrt: weights.mrt / sum,
    walk: weights.walk / sum,
    cycle: weights.cycle / sum,
  };
}

/**
 * Generate a fixed pool of agents spread across corridors (∝ trips) and across
 * modes (∝ corridor-appropriate split). MRT agents only appear on rail corridors.
 */
export function generateAgents(
  data: RouteData,
  split: ModeSplit,
  total: number
): Agent[] {
  const routes = data.routes;
  const totalTrips = routes.reduce((s, r) => s + r.trips, 0) || 1;
  const agents: Agent[] = [];
  let id = 0;

  for (const c of routes) {
    const share = c.trips / totalTrips;
    const n = Math.max(1, Math.round(total * share));
    const ls = localSplit(c, split);
    for (let i = 0; i < n; i++) {
      const r = ((i + 1) * 0.6180339887) % 1; // golden-ratio low-discrepancy
      const mode = pickMode(ls, r);
      const path = pathForMode(c, mode);
      if (!path || path.length < 2) continue;
      const { cumul, length } = cumulative(path);
      agents.push({
        id: id++,
        mode,
        path,
        cumul,
        length,
        ground: c.ground_m,
        phase: (i * 0.382 + share) % 1,
        fracPerSec: SPEED_MPS[mode] / length,
      });
    }
  }
  return agents;
}

function pickMode(split: ModeSplit, r: number): AgentMode {
  let acc = 0;
  for (const m of MODES) {
    acc += split[m];
    if (r <= acc) return m;
  }
  return "car";
}

/**
 * Trains gliding along the real rail segments (elevated viaduct). A few per
 * segment per direction, staggered. Returned as mrt-mode agents with an elevated
 * `ground` (viaduct height baked in).
 */
export function generateTrains(
  data: RouteData,
  viaductM: number,
  perDirection = 2
): Agent[] {
  const out: Agent[] = [];
  let id = 100000;
  for (const seg of data.rail ?? []) {
    for (const reversed of [false, true]) {
      const path = (reversed ? [...seg.path].reverse() : seg.path) as [number, number][];
      const { cumul, length } = cumulative(path);
      for (let k = 0; k < perDirection; k++) {
        out.push({
          id: id++,
          mode: "mrt",
          path,
          cumul,
          length,
          ground: data.district_ground_m + viaductM,
          phase: (k / perDirection + (reversed ? 0.5 : 0)) % 1,
          fracPerSec: SPEED_MPS.mrt / length,
        });
      }
    }
  }
  return out;
}

/**
 * Keep the contiguous runs of each polyline that lie within radiusM of center,
 * dropping fragments shorter than minLenM (OSM sidings/crossovers).
 */
export function clipPathsNear(
  lines: [number, number][][],
  center: [number, number],
  radiusM: number,
  minLenM: number
): [number, number][][] {
  const out: [number, number][][] = [];
  for (const line of lines) {
    let run: [number, number][] = [];
    const flush = () => {
      if (run.length >= 2 && cumulative(run).length >= minLenM) out.push(run);
      run = [];
    };
    for (const p of line) {
      if (haversineM(p, center) <= radiusM) run.push(p);
      else flush();
    }
    flush();
  }
  return out;
}

/**
 * Trains riding raw track polylines (e.g. real OSM alignment — the SAME
 * geometry the rail layer draws, so trains sit exactly on the visible track).
 * Each path is ping-ponged (out-and-back) so the loop wrap never teleports.
 */
export function generateTrainsFromPaths(
  paths: [number, number][][],
  ground: number,
  perLine = 1
): Agent[] {
  const out: Agent[] = [];
  let id = 200000;
  paths.forEach((path, li) => {
    if (path.length < 2) return;
    const loop = [...path, ...[...path].reverse().slice(1)];
    const { cumul, length } = cumulative(loop);
    for (let k = 0; k < perLine; k++) {
      out.push({
        id: id++,
        mode: "mrt",
        path: loop,
        cumul,
        length,
        ground,
        phase: (li * 0.37 + k / perLine) % 1,
        fracPerSec: SPEED_MPS.mrt / length,
      });
    }
  });
  return out;
}

export interface AgentPose {
  lng: number;
  lat: number;
  ground: number;
  heading: number; // degrees
  mode: AgentMode;
  id: number;
}

/** Interpolate an agent's pose along its real polyline at the given time. */
export function poseAt(a: Agent, timeSec: number): AgentPose {
  const f = (a.phase + timeSec * a.fracPerSec) % 1;
  const target = f * a.length;
  // find segment
  let i = 1;
  while (i < a.cumul.length && a.cumul[i] < target) i++;
  const i0 = Math.max(0, i - 1);
  const i1 = Math.min(a.path.length - 1, i);
  const segLen = a.cumul[i1] - a.cumul[i0] || 1;
  const t = (target - a.cumul[i0]) / segLen;
  const p0 = a.path[i0];
  const p1 = a.path[i1];
  const lng = p0[0] + (p1[0] - p0[0]) * t;
  const lat = p0[1] + (p1[1] - p0[1]) * t;
  const heading = (Math.atan2(p1[0] - p0[0], p1[1] - p0[1]) * 180) / Math.PI;
  return { lng, lat, ground: a.ground, heading, mode: a.mode, id: a.id };
}

export const MODE_COLOR: Record<AgentMode, [number, number, number]> = {
  car: [239, 68, 68],
  bus: [56, 189, 248],
  mrt: [255, 184, 0],
  walk: [52, 211, 153],
  cycle: [167, 139, 250],
};
