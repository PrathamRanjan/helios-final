"use client";

// The living-world agent layer: a SMALL pool of scaled-up units (one unit ~ many
// trips) moving on real route polylines. Per-mode composition follows the
// selected year's simulated mode share, so scrubbing time visibly changes the
// street population. Visual layer only — the math lives in cohorts.
//
// All vehicles are procedural composite-box meshes (see vehicleMeshes.ts) drawn
// with SimpleMeshLayer. No GLB imports — reliable, fast, consistent.

import { useEffect, useMemo, useRef, useState } from "react";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import { ScatterplotLayer } from "@deck.gl/layers";
import {
  generateAgents,
  generateTrains,
  generateTrainsFromPaths,
  clipPathsNear,
  poseAt,
  MODE_COLOR,
  type RouteData,
  type Agent,
  type AgentMode,
  type ModeSplit,
} from "../agents";
import { buildVehicleMeshes } from "./vehicleMeshes";

// Meshes are true-to-scale in metres; boost so they read at district zoom.
const MODE_BOOST: Record<AgentMode, number> = {
  car: 4.5,
  bus: 3.2,
  mrt: 2.5,
  walk: 6.5,
  cycle: 5.5,
};

const TOTAL_UNITS = 120;
const TRAINS_PER_DIRECTION = 1;
const VIADUCT = 14; // legacy fallback height (station-to-station rail)

// Trains ride the SAME OSM polylines the rail layer draws (fetched from
// /api/compass/geo/rail), so they sit exactly on the visible track. The track
// is drawn at ground level, so trains run at ground level too — any elevation
// gap reads as lateral displacement under a tilted camera.
const RAIL_Z = 0.3;
const DISTRICT_CENTER: [number, number] = [103.742, 1.333]; // Jurong East stn
const RAIL_CLIP_RADIUS_M = 2600; // keep track within this radius of the district
const RAIL_MIN_RUN_M = 800; // drop OSM sidings/crossovers

// Trains render as articulated multi-car sets: each car is posed independently
// along the rail polyline so the train bends through curves instead of a single
// long rigid box overhanging the track.
const CARS_PER_TRAIN = 3;
const TRAIN_CAR_SPACING_S = 2.6; // seconds between car centres (~39 m at 15 m/s)

const ROAD_MODES: AgentMode[] = ["car", "bus", "walk", "cycle"];

// ── "Watch the city evolve" reaction ──────────────────────────────────────
// Each press of Simulate / Watch-evolve (with a non-bad verdict) fires a pulse.
// A pulse plays a long, DRAMATIC pulse-train across the 2026→2036 decade: one
// beat per year, each a smooth hump whose amplitude is RANDOMISED fresh on every
// press — so the rhythm looks different each time. During each beat vehicles rip
// faster and swell in size, then settle between beats. Repeated presses also
// build a lasting VITALITY so the street speeds up and grows over the session.
const PULSE_YEARS = 11; // 2026 … 2036 → 11 beats
const SECONDS_PER_BEAT = 1.4; // dwell per "year" beat (longer = more visible)
const PULSE_TOTAL_S = PULSE_YEARS * SECONDS_PER_BEAT; // ~15.4s — much longer than before
const SURGE_SPEED = 5.0; // peak extra speed multiplier at a beat's crest
const SURGE_SCALE = 1.0; // peak extra size multiplier (~2x at a crest)
const SURGE_FLASH = 0.7; // peak extra brightness at a crest
const VITALITY_STEP = 0.16; // lasting speed/size added per press…
const VITALITY_MAX = 1.3; // …capped so it never runs away

// ── Random appear / disappear ──────────────────────────────────────────────
// Each road vehicle winks out and pops back on its OWN random cycle, so the
// visible count keeps drifting up and down. A slow global "tide" pushes the
// whole population thinner or denser on top, for bigger swings. Returns a
// 0..1 presence factor: 1 = fully there, 0 = gone (culled). Vehicles fade by
// shrinking + dimming through the band, so it reads as organic, not a hard pop.
const APPEAR_BAND = 0.28; // width of the fade in/out band
function appearAt(id: number, time: number): number {
  const seed = (((id + 1) * 2654435761) >>> 0) % 1000 / 1000; // stable 0..1 per agent
  const freq = 0.18 + seed * 0.6; // each vehicle blinks at its own pace
  const phase = seed * 6.2831853;
  const blink = Math.sin(time * freq + phase); // -1..1
  // Global tide — the overall street population breathes in and out slowly.
  const tide = 0.15 * Math.sin(time * 0.11) + 0.1 * Math.sin(time * 0.037 + 1.3);
  const thr = -0.7 + tide; // moving visibility threshold
  return Math.max(0, Math.min(1, (blink - thr) / APPEAR_BAND));
}

/** A fresh randomised amplitude per year-beat — regenerated on every press. */
function makePulsePattern(): number[] {
  return Array.from({ length: PULSE_YEARS }, () => 0.25 + Math.random() * 0.75);
}

/** Reaction state at a given warped-clock instant, following the beat pattern. */
function reactionAt(clock: number, pulseStart: number, vitality: number, pattern: number[]) {
  const u = clock - pulseStart;
  let burst = 0;
  if (u >= 0 && u < PULSE_TOTAL_S && pattern.length) {
    const idx = Math.min(pattern.length - 1, Math.floor(u / SECONDS_PER_BEAT));
    const phase = (u - idx * SECONDS_PER_BEAT) / SECONDS_PER_BEAT; // 0..1 within this beat
    const hump = Math.sin(Math.PI * phase); // smooth 0 → 1 → 0 crest
    const taper = 1 - (u / PULSE_TOTAL_S) * 0.3; // gently ease off across the decade
    burst = pattern[idx] * hump * taper;
  }
  return {
    speedMult: 1 + vitality * 0.9 + burst * SURGE_SPEED,
    scaleMult: 1 + vitality * 0.14 + burst * SURGE_SCALE,
    brightness: 1 + burst * SURGE_FLASH,
    swarmMult: 1 + burst * 1.6,
  };
}

/**
 * @param pulse increments on each "watch the city evolve" press (non-bad
 *   verdict). A change kicks off a dramatic surge in the living-world layer.
 */
export function useAgents(
  split: ModeSplit | null,
  enabled: boolean,
  demandFactor = 1,
  pulse = 0,
  areaId = "jurong_east",
  center: [number, number] = DISTRICT_CENTER
) {
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [railPaths, setRailPaths] = useState<[number, number][][]>([]);
  const [time, setTime] = useState(0);
  const rafRef = useRef<number>();
  // Warped simulation clock (fed to poseAt) — advances faster during a surge.
  const clockRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const pulseStartRef = useRef(-1e6); // warped-clock instant the last surge began
  const vitalityRef = useRef(0); // lasting escalation across presses
  const patternRef = useRef<number[]>([]); // random per-year amplitudes for the active pulse

  // A press kicks off the pulse-train from "now" with a fresh random pattern,
  // and nudges lasting vitality up.
  useEffect(() => {
    if (!enabled || pulse <= 0) return;
    patternRef.current = makePulsePattern();
    pulseStartRef.current = clockRef.current;
    vitalityRef.current = Math.min(vitalityRef.current + VITALITY_STEP, VITALITY_MAX);
  }, [pulse, enabled]);

  // Reset the street population when the area changes.
  useEffect(() => {
    setRouteData(null);
    setRailPaths([]);
  }, [areaId]);

  useEffect(() => {
    if (!enabled || routeData) return;
    fetch(`/api/district/${areaId}/routes`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && d.routes && setRouteData(d))
      .catch(() => {});
  }, [enabled, routeData, areaId]);

  // Real OSM track polylines — the same geometry FlowMap's rail layer draws.
  useEffect(() => {
    if (!enabled || railPaths.length) return;
    fetch("/api/compass/geo/rail")
      .then((r) => r.json())
      .then((d) => {
        const lines: [number, number][][] = (d.lines ?? []).map((l: any) => l.c);
        setRailPaths(clipPathsNear(lines, center, RAIL_CLIP_RADIUS_M, RAIL_MIN_RUN_M));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, railPaths.length, areaId]);

  // One warped animation clock for everything. Real elapsed time is scaled by
  // the current surge speed and integrated, so a surge smoothly accelerates
  // every vehicle at once and eases back — no teleporting.
  useEffect(() => {
    if (!enabled) return;
    const loop = (now: number) => {
      const last = lastFrameRef.current ?? now;
      let dt = (now - last) / 1000;
      lastFrameRef.current = now;
      if (dt > 0.1) dt = 0.1; // clamp tab-switch / stutter jumps
      const { speedMult } = reactionAt(
        clockRef.current,
        pulseStartRef.current,
        vitalityRef.current,
        patternRef.current
      );
      clockRef.current += dt * speedMult;
      setTime(clockRef.current);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastFrameRef.current = null;
    };
  }, [enabled]);

  // Quantise the split so agents only regenerate when shares change visibly.
  const splitKey = split
    ? (["car", "bus", "mrt", "walk", "cycle"] as AgentMode[])
        .map((m) => Math.round(split[m] * 50))
        .join(":")
    : "";

  // A pandemic year thins the visible street population (demandFactor < 1).
  const unitCount = Math.round(TOTAL_UNITS * Math.max(0.35, Math.min(1.2, demandFactor)));

  const agents: Agent[] = useMemo(() => {
    if (!routeData || !split || !enabled) return [];
    return generateAgents(routeData, split, unitCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeData, splitKey, enabled, unitCount]);

  const trains: Agent[] = useMemo(() => {
    if (!enabled) return [];
    // Preferred: ride the real OSM track (matches the drawn rail exactly).
    if (railPaths.length) return generateTrainsFromPaths(railPaths, 0, 1);
    // Fallback if OSM rail unavailable: legacy station-to-station paths.
    return routeData ? generateTrains(routeData, VIADUCT, TRAINS_PER_DIRECTION) : [];
  }, [railPaths, routeData, enabled]);

  const meshes = useMemo(() => buildVehicleMeshes(), []);

  const poses = useMemo(() => agents.map((a) => poseAt(a, time)), [agents, time]);
  const trainPoses = useMemo(
    () =>
      trains.flatMap((a) =>
        Array.from({ length: CARS_PER_TRAIN }, (_, k) =>
          poseAt(a, time + k * TRAIN_CAR_SPACING_S)
        )
      ),
    [trains, time]
  );

  return useMemo(() => {
    if (!enabled || !poses.length) return [];

    // Current surge intensity for this frame (drives size / brightness / dot size).
    const { scaleMult, brightness, swarmMult } = reactionAt(
      time,
      pulseStartRef.current,
      vitalityRef.current,
      patternRef.current
    );
    const flash = (c: [number, number, number]): [number, number, number] => [
      Math.min(255, c[0] * brightness),
      Math.min(255, c[1] * brightness),
      Math.min(255, c[2] * brightness),
    ];

    // Road agents grouped per mode (each mode has its own mesh). Each vehicle
    // carries an `appear` factor (0..1) from its own random blink — near-zero
    // ones are dropped entirely, so vehicles physically vanish and return.
    // "mrt" pool agents are excluded — trains render from the dedicated rail layer.
    const byMode: Record<string, any[]> = {};
    for (const p of poses) {
      if (p.mode === "mrt") continue;
      const appear = appearAt(p.id, time);
      if (appear < 0.03) continue; // gone this moment
      (byMode[p.mode] ??= []).push({
        position: [p.lng, p.lat, 0.3] as [number, number, number],
        heading: p.heading,
        color: flash(MODE_COLOR[p.mode]),
        appear,
      });
    }

    const trainData = trainPoses.map((p) => ({
      position: [p.lng, p.lat, RAIL_Z] as [number, number, number],
      heading: p.heading,
      color: flash(MODE_COLOR["mrt"]),
    }));

    const swarmData = [
      ...poses
        .filter((p) => p.mode !== "mrt")
        .map((p) => ({ pose: p, appear: appearAt(p.id, time) }))
        .filter((x) => x.appear >= 0.03)
        .map((x) => ({
          position: [x.pose.lng, x.pose.lat, 0.3],
          // Fade the dot out through the band via alpha.
          color: [...flash(MODE_COLOR[x.pose.mode]), Math.round(x.appear * 255)],
          appear: x.appear,
        })),
      ...trainData.map((t) => ({ position: t.position, color: [...t.color, 255], appear: 1 })),
    ];

    const layers = ROAD_MODES.filter((m) => byMode[m]?.length).map(
      (m) =>
        new SimpleMeshLayer({
          id: `agents-${m}`,
          data: byMode[m],
          mesh: meshes[m],
          getPosition: (d: any) => d.position,
          getOrientation: (d: any) => [0, -d.heading, 0],
          getColor: (d: any) => (m === "car" || m === "bus") ? [255, 255, 255, d.color[3] ?? 255] : d.color,
          // Per-vehicle scale shrinks it in/out as it appears/disappears.
          getScale: (d: any) => {
            const s = MODE_BOOST[m] * scaleMult * d.appear;
            return [s, s, s];
          },
          _lighting: "pbr",
          updateTriggers: {
            getPosition: time,
            getOrientation: time,
            getColor: brightness,
            getScale: time,
          },
        } as any)
    );

    return [
      ...layers,

      // Elevated trains — real rail-path pool at viaduct height
      new SimpleMeshLayer({
        id: "agents-trains",
        data: trainData,
        mesh: meshes.mrt,
        getPosition: (d: any) => d.position,
        getOrientation: (d: any) => [0, -d.heading, 0],
        getColor: [255, 255, 255],
        getScale: [MODE_BOOST.mrt * scaleMult, MODE_BOOST.mrt * scaleMult, MODE_BOOST.mrt * scaleMult],
        _lighting: "pbr",
        updateTriggers: { getPosition: time, getOrientation: time, getColor: brightness },
      } as any),

      // Zoomed-out swarm dots so life is visible at district scale
      new ScatterplotLayer({
        id: "agents-swarm",
        data: swarmData,
        getPosition: (d: any) => d.position,
        getFillColor: (d: any) => d.color,
        getRadius: (d: any) => 3.5 * swarmMult * d.appear,
        radiusUnits: "pixels",
        radiusMinPixels: 0,
        radiusMaxPixels: 6 * swarmMult,
        stroked: false,
        parameters: { depthTest: false },
        updateTriggers: { getPosition: time, getFillColor: time, getRadius: time },
      } as any),
    ];
  }, [enabled, poses, trainPoses, meshes, time]);
}
