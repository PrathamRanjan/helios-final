"use client";

// The globe used DURING an in-module city switch. It starts framed on the city
// you're leaving, pulls up to an orbital view (the "world" reveal), then dives
// into the destination. Mounted by CityTransitionProvider (which lives in the
// root layout), so it survives the route change underneath it — that's what
// makes the swoop feel continuous across two different map engines.

import { useEffect, useRef } from "react";
import { importMaps3D, loadGoogleMaps } from "@/lib/google-maps";
import type { City } from "@/lib/cities";

const ORBIT_RANGE = 2_400_000; // ~2,400 km out — reveals the region's curvature
const ORBIT_TILT = 12;
const PHASE1_MS = 1300; // pull up to orbit
const PHASE2_MS = 2100; // dive into the destination

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function TransitionGlobe({
  from,
  to,
  onMidpoint,
  onArrive,
}: {
  from: City;
  to: City;
  onMidpoint?: () => void; // fired at the top of the arc (route now, load behind)
  onArrive?: () => void; // fired once the dive completes
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lib = await importMaps3D();
      await loadGoogleMaps();
      if (cancelled || !ref.current) return;

      const map = new lib.Map3DElement({
        center: { lat: from.center.lat, lng: from.center.lng, altitude: 200 },
        tilt: from.tilt,
        heading: from.heading,
        range: from.range,
        mode: "HYBRID",
      });
      map.style.width = "100%";
      map.style.height = "100%";
      map.style.display = "block";
      ref.current.appendChild(map);
      mapRef.current = map;

      // Phase 1 — pull up to an orbital view over the midpoint of the journey.
      const midLat = (from.center.lat + to.center.lat) / 2;
      const midLng = (from.center.lng + to.center.lng) / 2;
      map.flyCameraTo({
        endCamera: { center: { lat: midLat, lng: midLng, altitude: 0 }, tilt: ORBIT_TILT, heading: 0, range: ORBIT_RANGE },
        durationMillis: PHASE1_MS,
      });
      await wait(PHASE1_MS);
      if (cancelled) return;
      onMidpoint?.();

      // Phase 2 — dive into the destination city.
      map.flyCameraTo({
        endCamera: {
          center: { lat: to.center.lat, lng: to.center.lng, altitude: 200 },
          tilt: to.tilt,
          heading: to.heading,
          range: to.range,
        },
        durationMillis: PHASE2_MS,
      });
      await wait(PHASE2_MS);
      if (cancelled) return;
      onArrive?.();
    })().catch(() => {
      // If the 3D globe can't load, don't strand the user — proceed anyway.
      if (cancelled) return;
      onMidpoint?.();
      setTimeout(() => { if (!cancelled) onArrive?.(); }, 400);
    });
    return () => {
      cancelled = true;
      try { mapRef.current?.remove?.(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={ref} className="absolute inset-0" />;
}
