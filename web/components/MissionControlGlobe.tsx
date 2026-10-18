"use client";

// The ASEAN Mission Control globe. A single Google Photorealistic 3D map that
// flies between cities with a cinematic two-phase swoop: pull up to an orbital
// view that shows the region's curvature ("the world"), then dive down into the
// selected city. This is the connective tissue of the 3-city demo.

import { useEffect, useRef, useState } from "react";
import { importMaps3D, loadGoogleMaps } from "@/lib/google-maps";

export interface GlobeCity {
  code: string;
  label: string;
  center: { lat: number; lng: number };
  tilt?: number;
  heading?: number;
  range?: number; // arrival range (metres); smaller = closer
}

interface Props {
  cities: GlobeCity[];
  activeIndex: number;
  onArrive?: (index: number) => void;
  onDepart?: (index: number) => void;
}

// Orbital "show me the world" camera — high enough to reveal SE Asia's curvature.
const ORBIT_RANGE = 2_400_000; // ~2,400 km out
const ORBIT_TILT = 12;
const PHASE1_MS = 1500; // pull up to orbit
const PHASE2_MS = 2400; // dive into the city
const ORBIT_SPIN_MS = 26000; // slow hero orbit on arrival

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default function MissionControlGlobe({ cities, activeIndex, onArrive, onDepart }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapElRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const prevIndexRef = useRef<number | null>(null);
  const flightRef = useRef(0); // cancels a stale flight when a newer one starts
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- init the globe once, opening from an orbital reveal ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lib = await importMaps3D();
      await loadGoogleMaps();
      if (cancelled || !containerRef.current) return;

      const first = cities[Math.max(0, activeIndex)] ?? cities[0];
      const map = new lib.Map3DElement({
        // Start pulled back over the region so the opening is a descent from space.
        center: { lat: first.center.lat, lng: first.center.lng, altitude: 0 },
        tilt: ORBIT_TILT,
        heading: 0,
        range: ORBIT_RANGE,
        mode: "HYBRID",
      });
      map.style.width = "100%";
      map.style.height = "100%";
      map.style.display = "block";
      containerRef.current.appendChild(map);
      mapElRef.current = map;
      setReady(true);
    })().catch((e) => {
      console.error("globe init", e);
      setError(e?.message ?? "Failed to load 3D globe");
      setReady(true);
    });
    return () => { cancelled = true; flightRef.current++; mapElRef.current?.remove(); mapElRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- cinematic fly whenever the active city changes ----
  useEffect(() => {
    if (!ready || !mapElRef.current || error) return;
    const map = mapElRef.current;
    const to = cities[activeIndex];
    if (!to) return;
    const from = prevIndexRef.current != null ? cities[prevIndexRef.current] : null;
    const myFlight = ++flightRef.current;
    onDepart?.(activeIndex);

    (async () => {
      const lib = await importMaps3D();

      // Phase 1 — pull up to an orbital view over the midpoint of the journey
      // (or straight up on first load) so the globe/curvature is revealed.
      const midLat = from ? (from.center.lat + to.center.lat) / 2 : to.center.lat;
      const midLng = from ? (from.center.lng + to.center.lng) / 2 : to.center.lng;
      if (from) {
        map.flyCameraTo({
          endCamera: { center: { lat: midLat, lng: midLng, altitude: 0 }, tilt: ORBIT_TILT, heading: 0, range: ORBIT_RANGE },
          durationMillis: PHASE1_MS,
        });
        await wait(PHASE1_MS);
        if (myFlight !== flightRef.current) return; // superseded
      }

      // Phase 2 — dive into the city.
      map.flyCameraTo({
        endCamera: {
          center: { lat: to.center.lat, lng: to.center.lng, altitude: 200 },
          tilt: to.tilt ?? 55,
          heading: to.heading ?? 20,
          range: to.range ?? 1600,
        },
        durationMillis: PHASE2_MS,
      });
      await wait(PHASE2_MS);
      if (myFlight !== flightRef.current) return;

      // Drop a beacon on the city.
      try {
        if (markerRef.current) markerRef.current.remove();
        const marker = new lib.Marker3DElement({
          position: { lat: to.center.lat, lng: to.center.lng, altitude: 60 },
          altitudeMode: lib.AltitudeMode.RELATIVE_TO_GROUND,
          extruded: true,
          label: to.label,
        });
        map.appendChild(marker);
        markerRef.current = marker;
      } catch { /* ignore */ }

      onArrive?.(activeIndex);

      // Slow hero orbit while the planner reads the city card.
      try {
        map.flyCameraAround({
          camera: {
            center: { lat: to.center.lat, lng: to.center.lng, altitude: 200 },
            tilt: to.tilt ?? 55,
            range: to.range ?? 1600,
          },
          durationMillis: ORBIT_SPIN_MS,
          rounds: 1,
        });
      } catch { /* ignore */ }

      prevIndexRef.current = activeIndex;
    })().catch(() => { if (myFlight === flightRef.current) onArrive?.(activeIndex); });
    return () => { flightRef.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, ready]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg">
          <div className="flex flex-col items-center gap-4">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 sun-glow" />
              <div className="absolute inset-2 rounded-full bg-gradient-to-br from-solar-200 to-solar-500 animate-pulse-soft" />
            </div>
            <div className="text-sm text-white/60 tracking-wide">Loading Mission Control…</div>
          </div>
        </div>
      )}
      {ready && error && (
        <div className="absolute inset-0 flex items-center justify-center"
             style={{ background: "radial-gradient(circle at 30% 30%, rgba(255,184,0,0.18) 0%, rgba(10,11,15,1) 60%)" }}>
          <div className="text-center max-w-md px-6">
            <div className="text-solar-400 text-xs uppercase tracking-[0.18em] mb-2">Globe fallback</div>
            <div className="text-white/80 text-sm">3D tiles unavailable — pick a city to continue.</div>
          </div>
        </div>
      )}
      {/* cinematic vignette */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-bg to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-bg/95 to-transparent" />
    </div>
  );
}
