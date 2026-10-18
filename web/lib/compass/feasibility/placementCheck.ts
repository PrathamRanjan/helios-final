// Placement feasibility pre-check — a fast, rule-based sanity screen that runs
// BEFORE a drawn or suggested intervention is scored, so the tool never reviews
// a physically nonsensical placement (an EV charger on a rail platform, a cycle
// path drawn on top of a rail alignment or through a building).
//
// SCOPE: when real OSM geometry is supplied (see geoData.ts) this runs true
// footprint / track / height tests — building footprints (8k+), rail track
// polylines, and height-tagged footprints (2.5k, metres). Without that geometry
// it falls back to a proximity screen on the frozen world's station/building
// points. Either way it is a desk screen — it flags "that can't go there" and
// says what to verify; it is not a survey or a right-of-way clearance.

import type { WorldModifier, WorldState, WorldNode } from "../world/types";
import { distKm, pointToPolylineKm, pointInPolygon } from "../world/geo";

/** Optional real OSM geometry (loaded server-side) — upgrades the proximity
 *  screen to true footprint/track/height tests when supplied. */
export interface RealGeo {
  buildings: [number, number][][]; // polygon rings
  rail: [number, number][][]; // polylines
  buildingsH?: { h: number; ring: [number, number][] }[]; // height-tagged footprints (metres)
}

// A path overlapping a footprint this tall is a hard obstruction — you cannot
// route a shared path through a real multi-storey building.
const TALL_BLOCK_M = 12;

function bbox(pts: [number, number][]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}

/** True if a drawn path overlaps any real building footprint. */
function pathCrossesBuilding(pts: [number, number][], rings: [number, number][][]): boolean {
  const [px0, py0, px1, py1] = bbox(pts);
  const pad = 0.0003; // ~30 m
  for (const ring of rings) {
    const [rx0, ry0, rx1, ry1] = bbox(ring);
    if (rx1 < px0 - pad || rx0 > px1 + pad || ry1 < py0 - pad || ry0 > py1 + pad) continue; // bbox reject
    if (pts.some((p) => pointInPolygon(p, ring))) return true; // path vertex inside building
    if (ring.some((v) => pointToPolylineKm(v, pts) < 0.006)) return true; // building edge grazes path (~6 m)
  }
  return false;
}

/** Tallest height-tagged building (metres) whose footprint the path overlaps,
 *  or null if none. Same overlap test as pathCrossesBuilding. */
function tallestBuildingOnPath(pts: [number, number][], bh: { h: number; ring: [number, number][] }[]): number | null {
  const [px0, py0, px1, py1] = bbox(pts);
  const pad = 0.0003;
  let tallest: number | null = null;
  for (const { h, ring } of bh) {
    const [rx0, ry0, rx1, ry1] = bbox(ring);
    if (rx1 < px0 - pad || rx0 > px1 + pad || ry1 < py0 - pad || ry0 > py1 + pad) continue;
    const overlaps = pts.some((p) => pointInPolygon(p, ring)) || ring.some((v) => pointToPolylineKm(v, pts) < 0.006);
    if (overlaps && (tallest === null || h > tallest)) tallest = h;
  }
  return tallest;
}

/** Min distance (km) from a path to a set of rail polylines. */
function minPathToRailKm(pts: [number, number][], rail: [number, number][][]): number {
  let best = Infinity;
  for (const line of rail) {
    if (line.length < 2) continue;
    for (const p of pts) best = Math.min(best, pointToPolylineKm(p, line));
  }
  return best;
}

export type FeasibilitySeverity = "block" | "review" | "ok";

export interface FeasibilityFlag {
  code: string;
  severity: FeasibilitySeverity;
  message: string;
  fix: string;
}

export interface FeasibilityResult {
  severity: FeasibilitySeverity; // worst flag
  feasible: boolean; // false only when a "block" flag is present
  flags: FeasibilityFlag[];
  summary: string;
}

// Proximity thresholds (km), labelled proxies at Singapore district scale.
const ON_STATION_KM = 0.045; // ~45 m — effectively "on the station box"
const NEAR_BUILDING_KM = 0.025; // ~25 m — corridor grazes a building point
const NEAR_STATION_ENDPOINT_KM = 0.05; // ~50 m — path endpoint at a rail station
const SOLAR_HOST_KM = 0.08; // solar canopy needs a host structure within ~80 m

function pt(n: WorldNode): [number, number] {
  return [n.lng, n.lat];
}

/** Points of a modifier's geometry as [lng,lat] samples for proximity tests. */
function geomPoints(mod: WorldModifier): [number, number][] {
  const g = mod.geometry;
  if (g.type === "Point") return [g.coordinates];
  if (g.type === "LineString") return g.coordinates;
  if (g.type === "Polygon") return g.coordinates[0] ?? [];
  return [];
}

function nearestNode(
  p: [number, number],
  nodes: WorldNode[],
  type?: WorldNode["type"]
): { node: WorldNode; km: number } | null {
  let best: { node: WorldNode; km: number } | null = null;
  for (const n of nodes) {
    if (type && n.type !== type) continue;
    const km = distKm(p, pt(n));
    if (!best || km < best.km) best = { node: n, km };
  }
  return best;
}

/**
 * Screen one modifier for placement plausibility against the frozen world.
 * Returns a worst-severity verdict plus specific flags with fixes.
 */
export function placementCheck(mod: WorldModifier, world: WorldState, geo?: RealGeo): FeasibilityResult {
  const e = mod.effects;
  const flags: FeasibilityFlag[] = [];
  const pts = geomPoints(mod);
  const isPath = Boolean(e.cycleMaxKmExtension || e.safetyDelta?.cycle || e.rainProtectionDelta || e.comfortDelta?.walk);
  const isEv = Boolean(e.chargingCapacityKWDelta);
  const isSolar = Boolean(e.solarAnnualKWhDelta);

  // 1. EV charger sited on a rail station box (not the adjacent car park).
  if (isEv && mod.geometry.type === "Point") {
    const nearRail = nearestNode(mod.geometry.coordinates, world.nodes, "mrt_station");
    if (nearRail && nearRail.km <= ON_STATION_KM) {
      flags.push({
        code: "ev_on_rail_platform",
        severity: "review",
        message: `EV charger sited on/at the rail station "${nearRail.node.name}" (~${Math.round(nearRail.km * 1000)} m). Chargers belong in the adjacent car park or kerbside, not the concourse/platform.`,
        fix: "Move the point ~50–100 m to a car-park lot or set-down bay, or confirm this is a park-and-ride car park.",
      });
    }
  }

  // 2. Path / cycleway overlapping a building. Uses REAL OSM footprints when
  //    available (true point-in-polygon); otherwise a building-point proximity.
  if (isPath && pts.length >= 2) {
    if (geo?.buildings?.length) {
      if (pathCrossesBuilding(pts, geo.buildings)) {
        // Quantify with real height where the overlapped building is tagged: a
        // tall structure is a hard block, a low/unknown one is a review flag.
        const tallM = geo.buildingsH?.length ? tallestBuildingOnPath(pts, geo.buildingsH) : null;
        if (tallM != null && tallM >= TALL_BLOCK_M) {
          flags.push({
            code: "path_through_building",
            severity: "block",
            message: `Corridor runs through a ~${Math.round(tallM)} m building (real OSM footprint + height) — a multi-storey structure sits on this alignment, so it cannot be built here.`,
            fix: "Realign around the building, or route through a confirmed existing underpass / through-block link.",
          });
        } else {
          flags.push({
            code: "path_through_building",
            severity: "review",
            message: tallM != null
              ? `Corridor overlaps a ~${Math.round(tallM)} m building footprint (real OSM) — a low structure sits on part of this alignment.`
              : "Corridor overlaps a building footprint (real OSM) — a structure sits on part of this alignment.",
            fix: "Realign around the building, or confirm an existing through-route / underpass.",
          });
        }
      }
    } else {
      const buildings = world.nodes.filter((n) => n.type === "building");
      const hit = buildings.find((b) => pointToPolylineKm(pt(b), pts) <= NEAR_BUILDING_KM);
      if (hit) {
        flags.push({
          code: "path_through_building",
          severity: "review",
          message: `Corridor runs within ~${Math.round(NEAR_BUILDING_KM * 1000)} m of a building ("${hit.name}") — a footprint or height obstruction may block it.`,
          fix: "Verify the right-of-way; realign around the structure or confirm an existing through-route/underpass.",
        });
      }
    }
  }

  // 3. Path on/beside a rail reserve. Uses REAL OSM rail track when available
  //    (distance to actual polyline); otherwise a station-endpoint heuristic.
  if (isPath && mod.geometry.type === "LineString" && pts.length >= 2) {
    if (geo?.rail?.length) {
      if (minPathToRailKm(pts, geo.rail) < 0.02) {
        flags.push({
          code: "path_on_rail_alignment",
          severity: "review",
          message: "Corridor runs within ~20 m of live rail/subway track (real OSM) — a shared path can't sit on the rail reserve.",
          fix: "Keep the path alongside the road/verge, clear of the track.",
        });
      }
    } else {
      const a = nearestNode(pts[0], world.nodes, "mrt_station");
      const b = nearestNode(pts[pts.length - 1], world.nodes, "mrt_station");
      if (a && b && a.node.id !== b.node.id && a.km <= NEAR_STATION_ENDPOINT_KM && b.km <= NEAR_STATION_ENDPOINT_KM) {
        flags.push({
          code: "path_on_rail_alignment",
          severity: "review",
          message: `Corridor connects two rail stations ("${a.node.name}" → "${b.node.name}") — it may trace a rail reserve, where a shared path can't run on the track.`,
          fix: "Confirm you're building alongside the road/verge, not on the rail alignment.",
        });
      }
    }
  }

  // 4. Solar canopy with no host structure nearby (needs a roof/shelter to sit on).
  if (isSolar && mod.geometry.type === "Point") {
    const host = nearestNode(mod.geometry.coordinates, world.nodes.filter((n) => n.type === "building" || n.type === "mrt_station" || n.type === "bus_stop"));
    if (!host || host.km > SOLAR_HOST_KM) {
      flags.push({
        code: "solar_no_host",
        severity: "review",
        message: `Solar canopy has no obvious host structure within ~${Math.round(SOLAR_HOST_KM * 1000)} m — a canopy needs a roof, shelter or car-park deck to mount on.`,
        fix: "Snap to a station, bus stop, building or car-park roof, or budget a new canopy structure.",
      });
    }
  }

  const severity: FeasibilitySeverity = flags.some((f) => f.severity === "block")
    ? "block"
    : flags.some((f) => f.severity === "review")
    ? "review"
    : "ok";
  const feasible = severity !== "block";
  const summary =
    flags.length === 0
      ? "No placement issues detected (proximity screen)."
      : flags.map((f) => f.message).join(" ");

  return { severity, feasible, flags, summary };
}
