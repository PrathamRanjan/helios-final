"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Search, Sun } from "lucide-react";
import Map3D, { type MapTarget, type LatLng } from "@/components/Map3D";
import DrawToolbar from "@/components/DrawToolbar";
import IndiaRoofExtras from "./IndiaRoofExtras";
import StatCard from "@/components/StatCard";
import { loadGoogleMaps } from "@/lib/google-maps";
import { DEFAULT_SOLAR_ASSUMPTIONS, solarSources, INDIA_GRID_CO2_KG_PER_KWH, solarFinancials, type IndiaSolarResult, type SolarAssumptions } from "@/lib/india/solar";
import { inCity, type IndiaCity } from "@/lib/india/cities";
import { roofPolygon } from "@/lib/india/geometry";
import SolarPanelLayout from "./SolarPanelLayout";

const money = (n: number, maximumFractionDigits = 0) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits }).format(n);
const number = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(n);
const INPUTS: { key: keyof SolarAssumptions; label: string; step: number; max?: number }[] = [
  { key: "tariff", label: "Avoided electricity rate (₹/kWh)", step: 0.1 },
  { key: "costPerKwp", label: "Installed cost (₹/kWp)", step: 1000 },
  { key: "selfConsumption", label: "Generation used on site (0–1)", step: 0.05, max: 1 },
  { key: "exportRate", label: "Export credit (₹/kWh)", step: 0.1 },
  { key: "acEfficiency", label: "DC-to-AC system efficiency (0–1)", step: 0.01, max: 1 },
];

export default function IndiaSolar({ city }: { city: IndiaCity }) {
  const [target, setTarget] = useState<MapTarget | null>(null);
  const [result, setResult] = useState<IndiaSolarResult | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [assumptions, setAssumptions] = useState(DEFAULT_SOLAR_ASSUMPTIONS);
  const [status, setStatus] = useState("");
  const [drawingMode, setDrawingMode] = useState(false);
  const [polygonPath, setPolygonPath] = useState<LatLng[]>([]);
  const polygon = useMemo(() => {
    if (polygonPath.length < 3) return { areaM2: 0, error: "" };
    try { return { ...roofPolygon(polygonPath, city.bounds), error: "" }; }
    catch (e) { return { areaM2: 0, error: e instanceof Error ? e.message : "Invalid roof outline." }; }
  }, [polygonPath, city]);
  const polygonArea = polygon.areaM2;
  const [roofType, setRoofType] = useState("flat");
  const request = useRef<AbortController | null>(null);
  const selection = useRef(0);
  useEffect(() => () => { selection.current++; request.current?.abort(); }, []);


  const roofAction = async (body: object, signal: AbortSignal): Promise<IndiaSolarResult> => {
    const response = await fetch(`/api/india/${city.slug}/roof`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not assess this roof.");
    return data;
  };

  const pick = async (point: { lat: number; lng: number; address?: string }) => {
    selection.current++; setSearching(false);
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setError("");
    setDrawingMode(false); setPolygonPath([]);
    setStatus("Checking Google Solar coverage…");
    setResult(null);
    setBusy(false);
    if (!inCity(city, point.lat, point.lng)) { setTarget(null); setError(`Choose a rooftop inside the ${city.name} screening area.`); return; }
    setTarget({ ...point, range: 280, tilt: 50 });
    setBusy(true);
    try {
      const q = new URLSearchParams({ lat: String(point.lat), lng: String(point.lng) });
      const response = await fetch(`/api/india/${city.slug}/solar?${q}`, { signal: controller.signal });
      const data = await response.json();
      if (response.status === 404) {
        setStatus("No usable Google Solar coverage. Asking Gemini to estimate the roof…");
        const estimate = await roofAction({ action: "estimate", lat: point.lat, lng: point.lng }, controller.signal);
        if (!controller.signal.aborted) setResult(estimate);
      } else {
        if (!response.ok) throw new Error(data.error ?? "Could not assess this roof.");
        if (!controller.signal.aborted) setResult(data);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not assess this roof.");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };

  const cancelDrawing = () => {
    selection.current++; setSearching(false); request.current?.abort(); setBusy(false); setDrawingMode(false); setPolygonPath([]);
    if (target) setTarget({ ...target, tilt: 50, range: 280 });
  };
  const startDrawing = () => {
    if (!target) return;
    selection.current++; setSearching(false); request.current?.abort(); setBusy(false); setError("");
    setPolygonPath([]); setDrawingMode(true);
    setTarget({ ...target, tilt: 0, heading: 0, range: 350 });
  };
  const submitPolygon = async () => {
    if (polygonPath.length < 3 || polygonArea <= 0) return;
    request.current?.abort();
    const ctrl = new AbortController(); request.current = ctrl;
    setBusy(true); setError("");
    const lat = polygonPath.reduce((sum, p) => sum + p.lat, 0) / polygonPath.length;
    const lng = polygonPath.reduce((sum, p) => sum + p.lng, 0) / polygonPath.length;
    try {
      const data = await roofAction({ action: "manual", lat, lng, vertices: polygonPath, roofType }, ctrl.signal);
      if (!ctrl.signal.aborted) {
        setResult(data); setTarget({ lat, lng, tilt: 50, range: 280 });
        setDrawingMode(false); setPolygonPath([]);
      }
    } catch (e) { if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "Could not calculate this roof."); }
    finally { if (!ctrl.signal.aborted) setBusy(false); }
  };

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    const searchId = ++selection.current;
    request.current?.abort(); setBusy(false);
    setSearching(true);
    setError("");
    try {
      const g = await loadGoogleMaps();
      const { Geocoder } = await g.maps.importLibrary("geocoding");
      const response = await new Geocoder().geocode({ address: `${query.trim()}, ${city.searchLabel}, India`, componentRestrictions: { country: "IN" }, bounds: city.bounds });
      if (searchId !== selection.current) return;
      const place = response.results?.find((p: any) => inCity(city, p.geometry.location.lat(), p.geometry.location.lng()));
      if (!place) throw new Error(`No matching ${city.name} address. Try a building name or click its roof on the map.`);
      await pick({ lat: place.geometry.location.lat(), lng: place.geometry.location.lng(), address: place.formatted_address });
    } catch (e) { if (searchId === selection.current) setError(e instanceof Error ? e.message : "Address search is unavailable. Try selecting a roof on the map."); }
    finally { if (searchId === selection.current) setSearching(false); }
  };

  const s = result?.summary;
  let finance: ReturnType<typeof solarFinancials> | null = null;
  let financeError = "";
  if (s) { try { finance = solarFinancials(s.yearly_kwh, s.kwp, assumptions); } catch (e) { financeError = e instanceof Error ? e.message : "Invalid financial inputs."; } }
  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-bg text-white grain">
      {/* Ground-relative cameras also support elevated inland cities. */}
      <Map3D resolveAddress={false} target={target} initialCenter={city.center} cameraAltitudeMode="RELATIVE_TO_GROUND" orbit={!drawingMode} onPickLocation={pick}
        drawingMode={drawingMode} polygonPath={polygonPath} onDrawVertex={(point) => {
          if (busy) return;
          if (!inCity(city, point.lat, point.lng)) { setError(`All roof corners must be inside ${city.name}.`); return; }
          setPolygonPath((path) => path.length < 100 ? [...path, point] : path);
        }} />
      <header className="absolute top-4 left-4 right-4 z-30 flex flex-wrap items-center gap-3 md:right-[448px]">
        <Link href="/india" className="glass rounded-xl p-3" aria-label="Back to India cities"><ArrowLeft size={18} /></Link>
        <div className="glass rounded-xl px-4 py-2"><div className="flex items-center gap-2 font-display text-solar-200"><Sun size={18} /> HELIO · {city.name}</div><div className="text-[11px] text-white/55">Rooftop solar · Google Solar API</div></div>
        <Link href={`/india/${city.slug}/sandbox`} className="glass rounded-xl px-3 py-2 text-xs text-solar-200 hover:text-white">Urban sandbox →</Link>
        <form onSubmit={search} className="flex w-full gap-2 rounded-xl glass p-2">
          <label htmlFor="india-address" className="sr-only">Building name or address in {city.name}</label>
          <input id="india-address" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Find a ${city.name} building or address…`} className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none focus:ring-1 focus:ring-solar-400 rounded" />
          <button type="submit" disabled={searching || !query.trim()} className="btn-solar rounded-lg px-3 py-2 disabled:opacity-40" aria-label={`Search ${city.name}`}>{searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}</button>
        </form>
        {drawingMode && <p className="glass rounded-xl p-3 text-xs">Click each roof corner in order, then Calculate. Avoid crossing edges; include only this roof.</p>}
        {drawingMode && (error || polygon.error) && <p role="alert" className="glass rounded-xl p-3 text-xs text-amber-200">{error || polygon.error}</p>}
      </header>
      <DrawToolbar screening visible={drawingMode} vertexCount={polygonPath.length} areaM2={polygonArea} roofType={roofType} onRoofTypeChange={setRoofType} onUndo={() => setPolygonPath((path) => path.slice(0, -1))} onCancel={cancelDrawing} onCalculate={submitPolygon} loading={busy} />
      <aside hidden={drawingMode} className="absolute z-20 bottom-4 right-4 left-4 max-h-[65dvh] overflow-y-auto rounded-2xl glass-strong p-5 shadow-panel md:top-4 md:left-auto md:w-[412px] md:max-h-none" aria-label={`${city.name} rooftop assessment`}>
        <div className="text-[10px] uppercase tracking-[0.2em] text-solar-300">India · {city.region}</div>
        <h1 className="font-display text-2xl mt-1">Find your roof&apos;s potential.</h1>
        <p className="text-sm text-white/55 mt-2 leading-relaxed">Search an address, then click the centre of its roof. Google estimates the panel capacity, layout and annual generation.</p>
        {target && <p className="mt-3 text-xs text-white/65">{target.address ?? `${target.lat.toFixed(5)}, ${target.lng.toFixed(5)}`}</p>}
        {busy && <div role="status" className="my-6 flex items-center gap-2 text-solar-200"><Loader2 size={18} className="animate-spin" /> {status}</div>}
        {error && <div role="alert" className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">{error}</div>}
        {!target && !busy && <div className="mt-5 rounded-xl border border-white/10 p-4 text-xs text-white/55 leading-relaxed">Google Solar is checked for each roof. If no usable building data is available, Gemini can estimate the roof; you can also draw its outline.</div>}
        {target && <button onClick={startDrawing} className="mt-4 rounded-lg border border-solar-300/40 px-3 py-2 text-xs text-solar-200">Draw your own roof and recalculate</button>}
        {financeError && <p role="alert" className="mt-4 text-sm text-amber-200">{financeError}</p>}
        {result && s && finance && <div className="mt-5 space-y-5">
          <div className="flex flex-wrap gap-2 text-[10px] text-emerald-200"><span className="rounded border border-emerald-300/30 px-2 py-1">{result.source === "Google Solar API · buildingInsights" ? "Google Solar estimate" : result.source}</span>{!result.estimation && <span className="rounded border border-white/15 px-2 py-1">{s.imagery_quality} imagery · {s.imagery_date ?? "date unavailable"}</span>}</div>
          <div className="grid grid-cols-2 gap-2">
            <StatCard label="Potential panels" value={s.panels} />
            <StatCard label="System capacity" value={s.kwp} precision={1} unit="kWp" accent="solar" />
            <StatCard label="Generation · DC" value={s.yearly_kwh} unit="kWh/yr" />
            <StatCard label="Usable energy · AC" value={finance.annualAcKwh} unit="kWh/yr" accent="green" />
          </div>
          {result.estimation ? <div className="rounded-xl border border-amber-300/20 p-3 text-xs text-amber-100/80 space-y-2"><p>{result.estimation.notes}</p><p>Roof type: {result.estimation.roofType.replaceAll("_", " ")} · assumed usable area {number(result.estimation.usableFraction * 100)}% · illustrative DC yield {number(result.estimation.dcYieldPerKwp)} kWh/kWp/year. No measured panel positions or statistically validated uncertainty band.</p></div> : <SolarPanelLayout result={result} />}
          <div className="grid grid-cols-2 gap-2 text-xs text-white/60"><div>Roof area <b className="block text-white">{number(s.whole_roof_area_m2)} m²</b></div><div>Array area <b className="block text-white">{number(s.max_array_area_m2)} m²</b></div></div>
          <section className="rounded-xl border border-white/10 p-3 space-y-3">
            <h2 className="font-display text-sm">Your INR scenario</h2>
            <p className="text-[11px] text-white/45">Editable illustrative inputs—not a utility tariff or installer quote. Enter rates from your bill and quotation.</p>
            {INPUTS.map(({ key, label, step, max }) => <label key={key} className="flex items-center justify-between gap-3 text-xs text-white/65"><span>{label}</span><input type="number" min={0} max={max} step={step} value={assumptions[key]} onChange={(e) => { const value = Number(e.target.value); if (Number.isFinite(value) && value >= 0 && value <= 100000000 && (max === undefined || value <= max)) setAssumptions((a) => ({ ...a, [key]: value })); }} className="w-24 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-right text-white outline-none focus:border-solar-300" /></label>)}
          </section>
          <dl className="space-y-2 text-sm">
            {[['Installation', money(finance.capex)], ['Year-one net savings', money(finance.annualNetSavings)], ['Payback', finance.paybackYears === null ? 'Not reached within 20 years' : `${finance.paybackYears.toFixed(1)} years`], ['20-year NPV', money(finance.npv)], ['20-year lifetime savings', money(finance.lifetimeSavings20y)], ['LCOE', finance.lcoeInrPerKwh === null ? 'Unavailable (no AC generation)' : `${money(finance.lcoeInrPerKwh, 2)}/kWh`]].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-white/50">{label}</dt><dd className="text-right">{value}</dd></div>)}
          </dl>
          <p className="text-[11px] leading-relaxed text-white/45">Lifetime savings deduct installation and maintenance from 20 years of electricity savings and export value, without discounting. LCOE divides total installation and maintenance costs by lifetime AC generation, including degradation, without discounting. NPV uses the 8% discount rate.</p>
          <section className="rounded-xl border border-emerald-300/20 p-3 space-y-2">
            <h2 className="text-sm text-emerald-200">Estimated grid emissions displaced</h2>
            <p className="font-display text-xl">{number(finance.annualAcKwh * INDIA_GRID_CO2_KG_PER_KWH / 1000)} tCO₂ / year</p>
            <p className="text-[11px] text-white/50">AC generation × {INDIA_GRID_CO2_KG_PER_KWH} kg CO₂/kWh. Dated all-India grid average for FY2024–25, not a city-specific marginal factor or verified carbon credits. Actual displacement depends on usage, exports and the grid.</p>
          </section>
          <details className="text-xs text-white/50"><summary className="cursor-pointer text-white/70">Roof segments · {s.roof_segment_count}</summary><div className="mt-2 space-y-1">{s.roof_segments.map((segment, i) => <div key={i}>{number(segment.area_m2)} m² · pitch {segment.pitch_deg}° · azimuth {segment.azimuth_deg}°</div>)}{s.roof_segment_count > s.roof_segments.length && <p>Showing the six largest segments.</p>}</div></details>
          <section className="space-y-2 text-xs text-white/55">
            <h2 className="font-display text-sm text-white/80">India sources and tariff guidance</h2>
            {Object.entries(solarSources(city)).map(([id, source]) => <a key={id} href={source.url} target="_blank" rel="noreferrer" className="block text-solar-200 underline">{source.title}</a>)}
            <p>{city.guidance} Choose the energy charge applicable to your bill category. ₹7/kWh remains an illustrative scenario, not a quoted official rate. Fixed charges may remain payable; subsidies and bill support can reduce the energy savings you actually receive. Export credit depends on the applicable metering arrangement and agreement, so it defaults to ₹0.</p>
          </section>
          <IndiaRoofExtras city={city} result={result} assumptions={assumptions} />
          <p className="text-[11px] leading-relaxed text-white/40">Pre-feasibility only. Panel counts and generation are screening estimates, not an installation recommendation. AC generation applies your system efficiency once. Financials assume 1% of capex in annual maintenance, 0.7% annual degradation, an 8% discount rate and constant electricity prices over 20 years. No subsidies, financing, tax, fixed-charge savings or equipment replacements are included. Export credit defaults to zero; confirm eligibility and rates with your distribution company. Structural condition and site access need an installer survey.</p>
          <a href="https://developers.google.com/maps/documentation/solar/concepts" target="_blank" rel="noreferrer" className="block text-xs text-solar-200 underline">Google Solar methodology</a>
        </div>}
      </aside>
    </main>
  );
}
