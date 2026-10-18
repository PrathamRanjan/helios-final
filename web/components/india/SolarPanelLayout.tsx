"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps";
import type { IndiaSolarResult } from "@/lib/india/solar";

/** Google's potential panel locations; rectangles are a plan-view approximation. */
export default function SolarPanelLayout({ result }: { result: IndiaSolarResult }) {
  const element = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const polygons: any[] = [];
    setError("");
    (async () => {
      const g = await loadGoogleMaps();
      const { Map } = await g.maps.importLibrary("maps");
      const { spherical } = await g.maps.importLibrary("geometry");
      if (cancelled || !element.current) return;
      const map = new Map(element.current, { center: { lat: result.summary.center.lat, lng: result.summary.center.lng }, zoom: 20, mapTypeId: "satellite", tilt: 0, disableDefaultUI: true, zoomControl: true, gestureHandling: "cooperative" });
      const bounds = new g.maps.LatLngBounds();
      for (const p of result.panels) {
        if (!p || !Number.isFinite(p.center?.latitude) || !Number.isFinite(p.center?.longitude)) continue;
        const centre = new g.maps.LatLng(p.center.latitude, p.center.longitude);
        const segment = result.segments[p.segmentIndex];
        const azimuth = segment?.azimuthDegrees ?? 180;
        const pitch = ((segment?.pitchDegrees ?? 0) * Math.PI) / 180;
        const across = (p.orientation === "LANDSCAPE" ? result.summary.panel_height_m : result.summary.panel_width_m) / 2;
        const down = (p.orientation === "LANDSCAPE" ? result.summary.panel_width_m : result.summary.panel_height_m) * Math.cos(pitch) / 2;
        const path = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => spherical.computeOffset(spherical.computeOffset(centre, across * x, azimuth + 90), down * y, azimuth));
        const polygon = new g.maps.Polygon({ map, paths: path, strokeColor: "#a5e8ff", strokeWeight: 1, fillColor: "#1469a0", fillOpacity: 0.8, clickable: false });
        polygons.push(polygon);
        path.forEach((point: any) => bounds.extend(point));
      }
      if (!bounds.isEmpty()) map.fitBounds(bounds, 28);
    })().catch(() => { if (!cancelled) setError("Panel map unavailable. The roof assessment below is still available."); });
    return () => { cancelled = true; polygons.forEach((p) => p.setMap(null)); };
  }, [result]);
  if (!result.panels.length) return <p className="text-xs text-white/50">Google returned aggregate potential without individual panel positions.</p>;
  return <div><div ref={element} className="h-60 rounded-xl overflow-hidden bg-white/5" aria-label="Google satellite map with potential solar panel positions" />{error && <p role="status" className="mt-2 text-xs text-amber-200">{error}</p>}<p className="mt-2 text-[11px] text-white/45">Google&apos;s potential panel locations, with approximate plan-view rectangles. This is not an installation drawing.</p></div>;
}
