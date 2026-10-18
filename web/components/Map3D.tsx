"use client";

import { useEffect, useRef, useState } from "react";
import { importMaps3D, loadGoogleMaps } from "@/lib/google-maps";

export interface MapTarget {
  lat: number;
  lng: number;
  address?: string;
  range?: number;
  tilt?: number;
  heading?: number;
}

export type LatLng = { lat: number; lng: number };

interface Props {
  target: MapTarget | null;
  onPickLocation: (t: { lat: number; lng: number; address?: string }) => void;
  initialCenter?: { lat: number; lng: number };
  orbit?: boolean;
  resolveAddress?: boolean;
  cameraAltitudeMode?: "ABSOLUTE" | "RELATIVE_TO_GROUND";

  // Tier C drawing mode
  drawingMode?: boolean;
  polygonPath?: LatLng[];
  onDrawVertex?: (vertex: LatLng) => void;
}

const DEFAULT_CAMERA = {
  range: 4500,
  tilt: 62,
  heading: 25,
};

export default function Map3D({
  target,
  onPickLocation,
  initialCenter,
  cameraAltitudeMode = "ABSOLUTE",
  orbit = true,
  resolveAddress = true,
  drawingMode = false,
  polygonPath = [],
  onDrawVertex,
}: Props) {
  const startCenter: MapTarget = {
    lat: initialCenter?.lat ?? 21.0278,
    lng: initialCenter?.lng ?? 105.8342,
    ...DEFAULT_CAMERA,
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const mapElRef = useRef<any>(null);
  const markerElRef = useRef<any>(null);
  const polygonElRef = useRef<any>(null);
  const vertexMarkersRef = useRef<any[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // refs so the click handler (bound once at mount) sees latest values
  const drawingModeRef = useRef(drawingMode);
  const onDrawVertexRef = useRef(onDrawVertex);
  const pickSequence = useRef(0);
  const onPickLocationRef = useRef(onPickLocation);
  onPickLocationRef.current = onPickLocation;
  drawingModeRef.current = drawingMode;
  onDrawVertexRef.current = onDrawVertex;
  useEffect(() => { pickSequence.current++; }, [target, drawingMode, initialCenter?.lat, initialCenter?.lng]);
  useEffect(() => { onDrawVertexRef.current = onDrawVertex; }, [onDrawVertex]);

  // ---- init the Map3DElement once ----
  useEffect(() => {
    let cancelled = false;
    let dispose = () => {};
    let frame = 0;
    (async () => {
      const lib = await importMaps3D();
      await loadGoogleMaps();
      if (cancelled || !containerRef.current) return;

      const map = new lib.Map3DElement({
        center: { lat: startCenter.lat, lng: startCenter.lng, altitude: 200 },
        tilt: startCenter.tilt,
        heading: startCenter.heading,
        range: startCenter.range,
        mode: "HYBRID",
      });
      map.style.width = "100%";
      map.style.height = "100%";
      map.style.display = "block";

      containerRef.current.appendChild(map);
      mapElRef.current = map;

      const handleClick = async (ev: any) => {
        const pos = ev.position ?? ev.detail?.position ?? ev.latLng;
        if (!pos) return;
        const lat = typeof pos.lat === "function" ? pos.lat() : pos.lat;
        const lng = typeof pos.lng === "function" ? pos.lng() : pos.lng;
        if (typeof lat !== "number" || typeof lng !== "number") return;

        // Drawing mode: accumulate the vertex instead of picking a location
        if (drawingModeRef.current) {
          onDrawVertexRef.current?.({ lat, lng });
          return;
        }

        const sequence = ++pickSequence.current;
        let address: string | undefined;
        if (resolveAddress) {
          try {
            const g = await loadGoogleMaps();
            const response = await new g.maps.Geocoder().geocode({ location: { lat, lng } });
            address = response.results?.[0]?.formatted_address;
          } catch { /* Coordinates remain usable without an address. */ }
        }
        if (!cancelled && sequence === pickSequence.current) onPickLocationRef.current({ lat, lng, address });
      };
      map.addEventListener("gmp-click", handleClick);
      dispose = () => { map.removeEventListener("gmp-click", handleClick); map.remove(); if (mapElRef.current === map) mapElRef.current = null; };

      frame = requestAnimationFrame(() => {
        if (cancelled) return;
        map.flyCameraTo({
          endCamera: {
            altitudeMode: cameraAltitudeMode,
            center: { lat: startCenter.lat, lng: startCenter.lng, altitude: 200 },
            tilt: startCenter.tilt,
            heading: startCenter.heading,
            range: startCenter.range,
          },
          durationMillis: 1200,
        });
      });

      setReady(true);
    })().catch((e) => {
      console.error("map init", e);
      setError(e?.message ?? "Failed to load 3D map");
      setReady(true);
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); pickSequence.current++; dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- fly to new country center when initialCenter changes (no target) ----
  useEffect(() => {
    if (!ready || !initialCenter || !mapElRef.current || target) return;
    mapElRef.current.flyCameraTo({
      endCamera: {
        altitudeMode: cameraAltitudeMode,
        center: { lat: initialCenter.lat, lng: initialCenter.lng, altitude: 200 },
        tilt: DEFAULT_CAMERA.tilt,
        heading: DEFAULT_CAMERA.heading,
        range: DEFAULT_CAMERA.range,
      },
      durationMillis: 1800,
    });
  }, [initialCenter?.lat, initialCenter?.lng, ready, target, cameraAltitudeMode]);

  // ---- fly + glow marker when target changes ----
  useEffect(() => {
    if (!ready || !target || !mapElRef.current) return;
    const map = mapElRef.current;
    let cancelled = false;

    map.flyCameraTo({
      endCamera: {
        altitudeMode: cameraAltitudeMode,
        center: { lat: target.lat, lng: target.lng, altitude: 80 },
        tilt: target.tilt ?? 67,
        heading: target.heading ?? 35,
        range: target.range ?? 350,
      },
      durationMillis: 2200,
    });

    const t = orbit ? setTimeout(() => {
      try {
        map.flyCameraAround({
          camera: {
            altitudeMode: cameraAltitudeMode,
            center: { lat: target.lat, lng: target.lng, altitude: 80 },
            tilt: target.tilt ?? 67,
            range: target.range ?? 350,
          },
          durationMillis: 18000,
          rounds: 1,
        });
      } catch { /* ignore */ }
    }, 2400) : undefined;

    (async () => {
      const lib = await importMaps3D();
      if (cancelled) return;
      if (markerElRef.current) {
        try { markerElRef.current.remove(); } catch { /* ignore */ }
      }
      const marker = new lib.Marker3DElement({
        position: { lat: target.lat, lng: target.lng, altitude: 40 },
        altitudeMode: lib.AltitudeMode.RELATIVE_TO_GROUND,
        extruded: true,
        label: target.address?.split(",")[0] ?? "Selected",
      });
      map.appendChild(marker);
      markerElRef.current = marker;
    })();

    return () => { cancelled = true; clearTimeout(t); };
  }, [target, ready, cameraAltitudeMode, orbit]);

  // ---- Tier C: render the user-drawn polygon ----
  useEffect(() => {
    if (!ready || !mapElRef.current) return;
    let cancelled = false;
    (async () => {
      const lib = await importMaps3D();
      if (cancelled || !mapElRef.current) return;
      const map = mapElRef.current;

      // clear any previous polygon + vertex markers
      if (polygonElRef.current) {
        try { polygonElRef.current.remove(); } catch { /* ignore */ }
        polygonElRef.current = null;
      }
      for (const m of vertexMarkersRef.current) {
        try { m.remove(); } catch { /* ignore */ }
      }
      vertexMarkersRef.current = [];

      if (polygonPath.length === 0) return;

      // Small marker at each vertex so user sees their clicks
      for (let i = 0; i < polygonPath.length; i++) {
        const v = polygonPath[i];
        const mk = new lib.Marker3DElement({
          position: { lat: v.lat, lng: v.lng, altitude: 5 },
          altitudeMode: lib.AltitudeMode.RELATIVE_TO_GROUND,
          extruded: false,
          label: String(i + 1),
        });
        map.appendChild(mk);
        vertexMarkersRef.current.push(mk);
      }

      // Render the polygon outline once we have 2+ points; fill once we have 3+
      if (polygonPath.length >= 2) {
        const coords = polygonPath.map((p) => ({
          lat: p.lat,
          lng: p.lng,
          altitude: 2,
        }));
        // close the ring for the polygon
        if (polygonPath.length >= 3) {
          coords.push({ ...coords[0] });
        }
        const polygon = new lib.Polygon3DElement({
          outerCoordinates: coords,
          altitudeMode: lib.AltitudeMode.RELATIVE_TO_GROUND,
          strokeColor: "#ffb800",
          strokeWidth: 4,
          fillColor: "rgba(255, 184, 0, 0.28)",
          extruded: false,
        });
        map.appendChild(polygon);
        polygonElRef.current = polygon;
      }
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [polygonPath, ready]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div ref={containerRef} className={`absolute inset-0 ${drawingMode ? "cursor-crosshair" : ""}`} />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg">
          <div className="flex flex-col items-center gap-4">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 sun-glow" />
              <div className="absolute inset-2 rounded-full bg-gradient-to-br from-solar-200 to-solar-500 animate-pulse-soft" />
            </div>
            <div className="text-sm text-white/60 tracking-wide">
              Loading 3D photorealistic map…
            </div>
          </div>
        </div>
      )}
      {ready && error && (
        <div className="absolute inset-0 flex items-center justify-center"
             style={{ background:
               "radial-gradient(circle at 30% 30%, rgba(255,184,0,0.18) 0%, rgba(10,11,15,1) 60%)" }}>
          <div className="text-center max-w-md px-6">
            <div className="text-solar-400 text-xs uppercase tracking-[0.18em] mb-2">
              Map fallback
            </div>
            <div className="text-white/80 text-sm">
              3D tiles unavailable — search or pick a demo to continue.
            </div>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-bg to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-bg/90 to-transparent" />
    </div>
  );
}