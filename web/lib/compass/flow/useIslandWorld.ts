"use client";

// The island-wide living world. Every building in Singapore as a real oriented
// block (footprint × height), the drivable road network, trains on every rail
// line and ambient cars/buses on the roads — visible from the first frame.
// When the camera comes close, an area's exact OSM footprints stream in and the
// block skyline for that area steps aside.
//
// Ambient traffic is VISUAL: density follows each area's census car share, it is
// not an OD forecast. The calibrated agent simulation runs in areas whose LTA
// world is built (useAgents) and is drawn on top.

import { useEffect, useMemo, useRef, useState } from "react";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import { PathLayer, PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { cumulative, generateTrainsFromPaths, poseAt, type Agent } from "../agents";
import { buildUnitBlock, buildVehicleMeshes } from "./vehicleMeshes";
import { AREAS } from "../areas";

export interface IslandView {
  longitude: number;
  latitude: number;
  zoom: number;
}

interface Skyline {
  areas: string[];
  lng: number[];
  lat: number[];
  height: number[];
  size: [number, number][];
  angle: number[];
  area: number[];
  hdb?: number[]; // 1 = HDB block (real storeys)
}

interface Road {
  c: number; // 0 motorway … 4 tertiary
  a: number; // area index
  p: [number, number][];
}

export interface PickedBuilding {
  lng: number;
  lat: number;
  height: number;
  footprintM2: number;
  areaId: string;
  hdb?: boolean;
  polygon?: [number, number][];
}

const STREAM_ZOOM = 13.2; // load exact footprints for areas in view at this zoom
const MAX_STREAMED = 6;
const MESH_ZOOM = 13.2; // vehicles become 3D meshes (dots below)
const CAR_UNITS = 3200;
const BUS_UNITS = 360;
const WALKERS_PER_AREA = 260;
const CYCLISTS_PER_AREA = 50;
const SPEED = { car: 12, bus: 7.5, walk: 1.3, cycle: 4.2 }; // m/s
// Same visual boost as the original Jurong world so vehicles read at district zoom.
const BOOST = { car: 4.5, bus: 3.2, mrt: 2.5, walk: 6.5, cycle: 5.5 };
const ROAD_COLOR: [number, number, number, number][] = [
  [94, 234, 212, 120], // motorway — faint signal glow
  [120, 134, 156, 170],
  [100, 112, 132, 160],
  [84, 95, 113, 150],
  [70, 80, 97, 140],
];

/** Approximate visible bounds for a pitched camera (generous so nothing pops at edges). */
function boundsFor(v: IslandView) {
  const span = 360 / Math.pow(2, v.zoom) * 2.6; // degrees across ~1440 px with pitch slack
  return { w: v.longitude - span, e: v.longitude + span, s: v.latitude - span * 0.75, n: v.latitude + span * 0.9 };
}

export function useIslandWorld({
  enabled,
  view,
  carShareByArea,
  selectedAreaId,
  hideAreaIds = [],
  onPickBuilding,
}: {
  enabled: boolean;
  view: IslandView;
  carShareByArea?: Record<string, number>;
  selectedAreaId?: string | null;
  /** Areas drawn by their own detailed city (e.g. the legacy Jurong East vector). */
  hideAreaIds?: string[];
  onPickBuilding?: (b: PickedBuilding) => void;
}) {
  const [skyline, setSkyline] = useState<Skyline | null>(null);
  const [roads, setRoads] = useState<Road[]>([]);
  const [rail, setRail] = useState<[number, number][][]>([]);
  const [streamed, setStreamed] = useState<Record<string, any>>({});
  const loadingRef = useRef<Set<string>>(new Set());
  const [time, setTime] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    fetch("/api/sg/layer/skyline").then((r) => r.json()).then(setSkyline).catch(() => {});
    fetch("/api/sg/layer/roads").then((r) => r.json()).then((d) => setRoads(d.roads ?? [])).catch(() => {});
    fetch("/api/compass/geo/rail")
      .then((r) => r.json())
      .then((d) => setRail((d.lines ?? []).filter((l: any) => l.t !== "rail" && l.c.length >= 2).map((l: any) => l.c)))
      .catch(() => {});
  }, [enabled]);

  // Animation clock.
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let last = performance.now();
    let t = 0;
    const loop = (now: number) => {
      t += Math.min(0.1, (now - last) / 1000);
      last = now;
      setTime(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  // Stream exact footprints for areas in view.
  const bounds = boundsFor(view);
  const inView = useMemo(() => {
    if (view.zoom < STREAM_ZOOM) return [] as string[];
    return AREAS.filter((a) => a.bbox[3] >= bounds.w && a.bbox[1] <= bounds.e && a.bbox[2] >= bounds.s && a.bbox[0] <= bounds.n)
      .map((a) => ({ id: a.id, d: (a.centroid[0] - view.longitude) ** 2 + (a.centroid[1] - view.latitude) ** 2 }))
      .sort((x, y) => x.d - y.d)
      .slice(0, MAX_STREAMED)
      .map((x) => x.id)
      .filter((id) => !hideAreaIds.includes(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.zoom >= STREAM_ZOOM, Math.round(view.longitude * 200), Math.round(view.latitude * 200), hideAreaIds.join(",")]);

  useEffect(() => {
    for (const id of inView) {
      if (streamed[id] || loadingRef.current.has(id)) continue;
      loadingRef.current.add(id);
      fetch(`/api/district/${id}/vector`)
        .then((r) => (r.ok ? r.json() : null))
        .then((v) => v && setStreamed((s) => ({ ...s, [id]: v })))
        .catch(() => {})
        .finally(() => loadingRef.current.delete(id));
    }
  }, [inView, streamed]);

  const shownStreamed = inView.filter((id) => streamed[id]);
  const hiddenIdx = useMemo(() => {
    if (!skyline) return new Set<number>();
    return new Set([...shownStreamed, ...hideAreaIds].map((id) => skyline.areas.indexOf(id)));
  }, [skyline, shownStreamed.join(","), hideAreaIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocks = useMemo(() => {
    if (!skyline) return [];
    const out: { i: number }[] = [];
    for (let i = 0; i < skyline.lng.length; i++) if (!hiddenIdx.has(skyline.area[i])) out.push({ i });
    return out;
  }, [skyline, hiddenIdx]);

  // Ambient vehicles on the road network, weighted by road class × length × area car share.
  const vehicles = useMemo(() => {
    if (!roads.length) return { cars: [] as Agent[], buses: [] as Agent[] };
    const weighted = roads.map((r) => {
      const { cumul, length } = cumulative(r.p);
      const share = carShareByArea?.[AREAS[r.a]?.id ?? ""] ?? 0.2;
      const classW = [3, 2.4, 1.8, 1.2, 0.7][r.c] ?? 0.5;
      return { r, cumul, length, w: length * classW * (0.5 + share * 2.5) };
    }).filter((x) => x.length > 60);
    const total = weighted.reduce((s, x) => s + x.w, 0);
    const pick = (u: number) => {
      let acc = 0;
      for (const x of weighted) {
        acc += x.w;
        if (acc >= u * total) return x;
      }
      return weighted[weighted.length - 1];
    };
    const make = (n: number, mode: "car" | "bus", seed: number): Agent[] =>
      Array.from({ length: n }, (_, k) => {
        const x = pick(((k + 1) * 0.6180339887 + seed) % 1);
        const loop = [...x.r.p, ...[...x.r.p].reverse().slice(1)];
        const c = cumulative(loop);
        return { id: (mode === "car" ? 500000 : 600000) + k, mode, path: loop, cumul: c.cumul, length: c.length, ground: 0, phase: (k * 0.7548776662) % 1, fracPerSec: SPEED[mode] / c.length };
      });
    return { cars: make(CAR_UNITS, "car", 0.11), buses: make(BUS_UNITS, "bus", 0.53) };
  }, [roads, carShareByArea]);

  const trains = useMemo(() => (rail.length ? generateTrainsFromPaths(rail.filter((p) => p.length > 3), 0, 1) : []), [rail]);

  // People: walkers on footpaths and cyclists on cycle tracks of the areas streamed in up close.
  const streamedKey = shownStreamed.join(",");
  const people = useMemo(() => {
    const walk: Agent[] = [];
    const cycle: Agent[] = [];
    let id = 700000;
    for (const aid of shownStreamed) {
      const v = streamed[aid];
      const foot = v.roads.filter((r: any) => ["footway", "path", "pedestrian", "living_street", "residential"].includes(r.kind) && r.path.length >= 2);
      const cyc = (v.cycling ?? []).filter((r: any) => r.path.length >= 2);
      const spawn = (pool: any[], n: number, mode: "walk" | "cycle", out: Agent[]) => {
        if (!pool.length) return;
        for (let k = 0; k < n; k++) {
          const r = pool[Math.floor(((k + 1) * 0.6180339887 + aid.length * 0.13) % 1 * pool.length)];
          const loop = [...r.path, ...[...r.path].reverse().slice(1)] as [number, number][];
          const c = cumulative(loop);
          if (c.length < 20) continue;
          out.push({ id: id++, mode, path: loop, cumul: c.cumul, length: c.length, ground: 0, phase: (k * 0.7548776662) % 1, fracPerSec: SPEED[mode] / c.length });
        }
      };
      spawn(foot, WALKERS_PER_AREA, "walk", walk);
      spawn(cyc.length ? cyc : foot, CYCLISTS_PER_AREA, "cycle", cycle);
    }
    return { walk, cycle };
  }, [streamedKey, streamed]); // eslint-disable-line react-hooks/exhaustive-deps
  const meshes = useMemo(() => ({ ...buildVehicleMeshes(), block: buildUnitBlock() }), []);

  return useMemo(() => {
    if (!enabled) return [];
    const layers: any[] = [];

    // Roads first (under everything).
    if (roads.length) {
      layers.push(
        new PathLayer({
          id: "island-roads",
          data: roads,
          getPath: (d: Road) => d.p,
          getColor: (d: Road) => ROAD_COLOR[d.c] ?? ROAD_COLOR[4],
          getWidth: (d: Road) => [14, 11, 9, 7, 5][d.c] ?? 4,
          widthUnits: "meters",
          widthMinPixels: 0.6,
        })
      );
    }

    // Exact footprints for streamed areas.
    for (const id of shownStreamed) {
      const v = streamed[id];
      layers.push(
        new PathLayer({ id: `area-roads-${id}`, data: v.roads.filter((r: any) => !["motorway", "trunk", "primary", "secondary", "tertiary"].includes(r.kind)), getPath: (d: any) => d.path, getColor: (d: any) => (["footway", "path", "steps", "pedestrian"].includes(d.kind) ? [70, 80, 97, 110] : [70, 80, 97, 170]), getWidth: (d: any) => (["footway", "path", "steps", "pedestrian"].includes(d.kind) ? 1.2 : 3), widthUnits: "meters" }),
        new PathLayer({ id: `area-cycling-${id}`, data: v.cycling, getPath: (d: any) => d.path, getColor: [45, 212, 191, 120], getWidth: 2, widthUnits: "meters" }),
        new PolygonLayer({
          id: `area-buildings-${id}`,
          data: v.buildings,
          extruded: true,
          pickable: true,
          getPolygon: (d: any) => d.polygon,
          getElevation: (d: any) => d.height ?? 12,
          getFillColor: (d: any) => (id === selectedAreaId ? (d.hdb ? [64, 76, 92, 250] : [56, 66, 82, 250]) : [46, 54, 68, 245]),
          material: { ambient: 0.5, diffuse: 0.55, shininess: 24, specularColor: [50, 70, 80] },
          onClick: (info: any) => {
            const d = info.object;
            if (!d || !onPickBuilding) return false;
            const [lng, lat] = info.coordinate ?? d.polygon[0];
            onPickBuilding({ lng, lat, height: d.height ?? 12, footprintM2: polygonAreaM2(d.polygon), areaId: id, hdb: !!d.hdb, polygon: d.polygon });
            return true;
          },
          updateTriggers: { getFillColor: selectedAreaId },
        })
      );
    }

    // Island skyline: every building as an oriented block.
    if (skyline && blocks.length) {
      const sel = selectedAreaId ? skyline.areas.indexOf(selectedAreaId) : -1;
      layers.push(
        new SimpleMeshLayer({
          id: "island-skyline",
          data: blocks,
          mesh: meshes.block,
          pickable: true,
          getPosition: (d: any) => [skyline.lng[d.i], skyline.lat[d.i], 0],
          getOrientation: (d: any) => [0, skyline.angle[d.i] - 90, 0],
          getScale: (d: any) => [skyline.size[d.i][1], skyline.size[d.i][0], skyline.height[d.i]],
          getColor: (d: any) => {
            const h = skyline.height[d.i];
            const t = Math.min(1, h / 140);
            const base = skyline.area[d.i] === sel ? 12 : 0;
            return [44 + base + t * 40, 52 + base + t * 70, 66 + base + t * 64, 255];
          },
          onClick: (info: any) => {
            const d = info.object;
            if (!d || !onPickBuilding) return false;
            const [L, W] = skyline.size[d.i];
            onPickBuilding({ lng: skyline.lng[d.i], lat: skyline.lat[d.i], height: skyline.height[d.i], footprintM2: L * W * 0.85, areaId: skyline.areas[skyline.area[d.i]], hdb: skyline.hdb?.[d.i] === 1 });
            return true;
          },
          updateTriggers: { getColor: selectedAreaId },
        } as any)
      );
    }

    // Vehicles — dots far away, 3D meshes up close (only those in view).
    const carPoses = vehicles.cars.map((a) => poseAt(a, time));
    const busPoses = vehicles.buses.map((a) => poseAt(a, time));
    const trainPoses = trains.flatMap((a) => [0, 2.6, 5.2].map((dt) => poseAt(a, time + dt)));
    const inB = (p: { lng: number; lat: number }) => p.lng > bounds.w && p.lng < bounds.e && p.lat > bounds.s && p.lat < bounds.n;
    if (view.zoom < MESH_ZOOM) {
      layers.push(
        new ScatterplotLayer({
          id: "island-traffic-dots",
          data: [
            ...carPoses.map((p) => ({ p, c: [248, 113, 113, 220] })),
            ...busPoses.map((p) => ({ p, c: [94, 234, 212, 230] })),
            ...trainPoses.map((p) => ({ p, c: [245, 184, 61, 255] })),
          ],
          getPosition: (d: any) => [d.p.lng, d.p.lat, 4],
          getFillColor: (d: any) => d.c,
          getRadius: 18,
          radiusUnits: "meters",
          radiusMinPixels: 1.6,
          updateTriggers: { getPosition: time },
        })
      );
    } else {
      const mesh = (id: string, data: any[], m: any, color: [number, number, number], scale: number) =>
        new SimpleMeshLayer({
          id,
          data,
          mesh: m,
          getPosition: (p: any) => [p.lng, p.lat, 0.3],
          getOrientation: (p: any) => [0, -p.heading, 0],
          getColor: color,
          getScale: [scale, scale, scale],
          _lighting: "pbr",
          updateTriggers: { getPosition: time, getOrientation: time },
        } as any);
      layers.push(
        mesh("island-cars", carPoses.filter(inB), meshes.car, [255, 255, 255], BOOST.car),
        mesh("island-buses", busPoses.filter(inB), meshes.bus, [255, 255, 255], BOOST.bus),
        mesh("island-trains", trainPoses.filter(inB), meshes.mrt, [255, 255, 255], BOOST.mrt),
        mesh("island-walkers", people.walk.map((a) => poseAt(a, time)), meshes.walk, [167, 243, 228], BOOST.walk),
        mesh("island-cyclists", people.cycle.map((a) => poseAt(a, time)), meshes.cycle, [196, 181, 253], BOOST.cycle)
      );
    }
    return layers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, roads, skyline, blocks, time, vehicles, trains, people, view.zoom >= MESH_ZOOM, shownStreamed.join(","), selectedAreaId, Math.round(view.longitude * 100), Math.round(view.latitude * 100)]);
}

function polygonAreaM2(poly: [number, number][]): number {
  if (poly.length < 3) return 0;
  const lat0 = (poly[0][1] * Math.PI) / 180;
  const kx = 111320 * Math.cos(lat0);
  let a = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    a += poly[i][0] * kx * (poly[i + 1][1] * 111320) - poly[i + 1][0] * kx * (poly[i][1] * 111320);
  }
  return Math.abs(a / 2);
}
