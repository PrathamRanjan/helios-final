"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Globe2, MapPin, Sun } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps";
import { INDIA_CITIES } from "@/lib/india/cities";

const MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#151b27" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8d9cae" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#10141e" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#090e17" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#263041" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.locality", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.province", elementType: "labels", stylers: [{ visibility: "off" }] },
];

export default function IndiaExplorer() {
  const [selected, setSelected] = useState(INDIA_CITIES[0].slug);
  const [mapStatus, setMapStatus] = useState("Loading India map…");
  const element = useRef<HTMLDivElement>(null);
  const markers = useRef<any[]>([]);
  const city = INDIA_CITIES.find(c => c.slug === selected)!;

  useEffect(() => {
    let cancelled = false;
    let map: any;
    (async () => {
      const g = await loadGoogleMaps();
      const { Map } = await g.maps.importLibrary("maps");
      if (cancelled || !element.current) return;
      map = new Map(element.current, {
        center: { lat: 22.5, lng: 79 }, zoom: 4.7, minZoom: 3,
        styles: MAP_STYLE, disableDefaultUI: true, zoomControl: true,
        gestureHandling: "cooperative", clickableIcons: false,
      });
      const bounds = new g.maps.LatLngBounds();
      markers.current = INDIA_CITIES.map(c => {
        bounds.extend(c.center);
        const marker = new g.maps.Marker({ map, position: c.center, title: c.name, label: {text:c.name, color:"#ffffff",fontSize:"11px",fontWeight:"600"} });
        marker.addListener("click", () => setSelected(c.slug));
        return marker;
      });
      map.fitBounds(bounds, {top:185,right:45,bottom:100,left:45});
      setMapStatus("");
    })().catch(() => { if (!cancelled) setMapStatus("Map unavailable. Choose any city from the list to continue."); });
    return () => {
      cancelled = true;
      markers.current.forEach(marker => { window.google?.maps?.event.clearInstanceListeners(marker); marker.setMap(null); });
      markers.current = [];
      if (map) window.google?.maps?.event.clearInstanceListeners(map);
    };
  }, []);

  useEffect(() => {
    const g = window.google;
    if (!g?.maps || !markers.current.length) return;
    markers.current.forEach((marker, i) => {
      const active = INDIA_CITIES[i].slug === selected;
      const scale = active ? 10 : 6;
      const slug = INDIA_CITIES[i].slug;
      const labelX = slug === "mumbai" ? -40 : slug === "pune" ? 30 : slug === "bengaluru" ? -36 : slug === "chennai" ? 36 : 0;
      const labelY = slug === "pune" ? 14 : -24;
      marker.setIcon({
        path: g.maps.SymbolPath.CIRCLE, scale,
        fillColor: active ? "#ffb800" : "#92a2b8", fillOpacity: 1,
        strokeColor: active ? "#fff1b8" : "#182334", strokeWeight: active ? 3 : 2,
        labelOrigin: new g.maps.Point(labelX / scale, labelY / scale),
      });
      marker.setZIndex(active?100:1);
    });
  }, [selected, mapStatus]);

  return (
    <main className="min-h-[100dvh] bg-bg text-white grain lg:h-[100dvh] lg:overflow-hidden">
      <header className="relative z-10 flex items-center justify-between gap-4 px-5 py-5 sm:px-8 border-b border-white/10">
        <div className="flex items-center gap-3">
          <Link href="/" aria-label="Back to Mission Control" className="glass rounded-xl p-3 text-white/70 hover:text-solar-200"><ArrowLeft size={18} /></Link>
          <div><Link href="/" className="font-display text-lg text-solar-gradient flex items-center gap-2"><Globe2 size={19} className="text-solar-400" /> HELIO</Link><p className="mt-0.5 text-[11px] text-white/45">Mission Control / India</p></div>
        </div>
        <span className="rounded-full border border-solar-400/25 bg-solar-400/10 px-3 py-1.5 text-[11px] text-solar-200">🇮🇳 India · 8 cities</span>
      </header>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_390px] lg:h-[calc(100dvh-91px)]">
        <section className="relative h-[65dvh] min-h-[520px] lg:h-full" aria-label="India city selection map">
          <div ref={element} className="absolute inset-0" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-bg/90 via-transparent to-bg/30" />
          <div className="pointer-events-none absolute top-6 left-5 right-5 sm:left-8 sm:top-8 max-w-lg">
            <p className="text-[10px] uppercase tracking-[0.24em] text-solar-300">Urban sandbox + rooftop solar · India</p>
            <h1 className="font-display text-3xl sm:text-4xl leading-tight mt-3">Your city.<br /><span className="text-solar-gradient">A world of possibilities.</span></h1>
            <p className="mt-3 text-sm text-white/60 max-w-sm">Choose a city. Test shade, cool roofs and water interventions in the urban sandbox, or explore rooftop solar.</p>
          </div>
          {mapStatus && <p role="status" className="absolute left-5 right-5 bottom-24 rounded-xl glass p-3 text-xs text-white/65 sm:left-8 sm:right-auto">{mapStatus}</p>}
          <div className="absolute left-5 bottom-12 sm:left-8 glass rounded-2xl p-4 max-w-[calc(100%-2.5rem)] shadow-panel">
            <div className="flex items-center gap-2 text-solar-200"><MapPin size={15} /><span className="font-display">{city.name}</span></div>
            <p className="mt-1 text-xs text-white/50">{city.region}</p>
            <Link href={`/india/${city.slug}/sandbox`} className="mt-3 inline-flex items-center gap-2 text-xs text-solar-200 hover:text-white">Open urban sandbox <ArrowRight size={14} /></Link>
          </div>
        </section>
        <aside className="relative z-10 border-t lg:border-t-0 lg:border-l border-white/10 bg-bg/95 px-5 py-6 sm:px-7 lg:overflow-y-auto" aria-label="India cities">
          <div className="flex items-center gap-2 text-solar-300"><Sun size={17} /><h2 className="font-display text-lg text-white">Choose your city</h2></div>
          <p className="mt-2 text-xs leading-relaxed text-white/50">Two ways to explore each city: an urban sustainability sandbox and rooftop solar.</p>
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2.5">
            {INDIA_CITIES.map((c, i) => <div key={c.slug} className={`rounded-xl border transition-colors ${selected===c.slug?"border-solar-400/40 bg-gradient-to-br from-solar-400/15 to-solar-600/5":"border-white/10 bg-white/[0.025] hover:border-white/25"}`}>
              <div className="flex items-center gap-2 px-3 py-3">
                <button onClick={()=>setSelected(c.slug)} aria-pressed={selected===c.slug} aria-label={`Show ${c.name} on map`} className="flex flex-1 items-center gap-3 text-left rounded-lg focus-visible:outline focus-visible:outline-solar-300">
                  <span className={`text-[10px] font-mono ${selected===c.slug?"text-solar-300":"text-white/25"}`}>{String(i+1).padStart(2,"0")}</span>
                  <span><span className="block text-sm font-medium">{c.name}</span><span className="block mt-0.5 text-[10px] text-white/45">{c.region}</span></span>
                </button>
                <Link href={`/india/${c.slug}`} aria-label={`Explore ${c.name} rooftop solar`} className={`rounded-lg p-2 transition-colors ${selected===c.slug?"bg-solar-400 text-black":"bg-white/5 text-white/55 hover:bg-solar-400 hover:text-black"}`}><ArrowRight size={16} /></Link>
              </div>
              <div className="flex gap-3 px-3 pb-3 text-[11px]"><Link href={`/india/${c.slug}/sandbox`} className="text-solar-200 hover:text-white">Urban sandbox →</Link><Link href={`/india/${c.slug}`} className="text-white/50 hover:text-white">Rooftop solar →</Link></div>
            </div>)}
          </div>
          <p className="mt-5 text-[10px] leading-relaxed text-white/40">Urban scenarios use editable screening assumptions; they are not calibrated city forecasts. Google Solar coverage varies by roof. City screening extents are approximate metropolitan regions.</p>
        </aside>
      </div>
    </main>
  );
}
