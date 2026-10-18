"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2 } from "lucide-react";
import BeforeAfterSlider from "@/components/BeforeAfterSlider";
import ContextStrip from "@/components/ContextStrip";
import type { ContextData } from "@/types";
import type { IndiaCity } from "@/lib/india/cities";
import { type IndiaSolarResult, type SolarAssumptions } from "@/lib/india/solar";

export default function IndiaRoofExtras({ city, result, assumptions }: { city: IndiaCity; result: IndiaSolarResult; assumptions: SolarAssumptions }) {
  const [context, setContext] = useState<ContextData | null>(null);
  const [contextStatus, setContextStatus] = useState("Loading environmental context…");
  const [streetUnavailable, setStreetUnavailable] = useState(false);
  const [proposal, setProposal] = useState("");
  const [pair, setPair] = useState<{ before: string; after: string } | null>(null);
  const [pending, setPending] = useState<"proposal" | "render" | null>(null);
  const [error, setError] = useState("");
  const actionRequest = useRef<AbortController | null>(null);
  const lat = result.summary.center.lat!, lng = result.summary.center.lng!;
  const location = new URLSearchParams({ lat: String(lat), lng: String(lng) }).toString();
  useEffect(() => {
    const ctrl = new AbortController();
    setContext(null);
    setContextStatus("Loading environmental context…");
    setStreetUnavailable(false);
    fetch(`/api/india/${city.slug}/context?${location}`, { signal: ctrl.signal })
      .then(async (r) => { const data = await r.json(); if (!r.ok) throw new Error(data.error); return data as ContextData; })
      .then((data) => { if (!ctrl.signal.aborted) { setContext(data); setContextStatus(data.elevation || data.timezone || data.air_quality || data.weather ? "" : "Google returned no environmental context. Enable Elevation, Time Zone, Air Quality and Weather APIs on the server key’s project to populate these fields."); } })
      .catch((e) => { if (!ctrl.signal.aborted) setContextStatus(e.message ?? "Environmental context unavailable."); });
    return () => { ctrl.abort(); actionRequest.current?.abort(); };
  }, [location, city.slug]);
  useEffect(() => {
    actionRequest.current?.abort();
    setProposal(""); setPending(null); setError("");
  }, [assumptions]);

  useEffect(() => {
    actionRequest.current?.abort();
    setProposal(""); setPair(null); setPending(null); setError("");
  }, [result]);

  const generate = async (action: "proposal" | "render") => {
    actionRequest.current?.abort();
    const ctrl = new AbortController(); actionRequest.current = ctrl;
    setPending(action); setError("");
    try {
      const response = await fetch(`/api/india/${city.slug}/roof`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal, body: JSON.stringify({ action, lat, lng, result, assumptions }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Generation failed. Please retry.");
      if (!ctrl.signal.aborted) { if (action === "proposal") setProposal(data.text); else setPair(data); }
    } catch (e) { if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "Generation failed."); }
    finally { if (!ctrl.signal.aborted) setPending(null); }
  };
  return <div className="space-y-5">
    <section aria-label="Street View and environmental context" className="space-y-2 border-t border-white/10 pt-4">
      <h2 className="font-display text-sm">Around this roof</h2>
      <ContextStrip context={context} />
      {contextStatus && <p role="status" className="text-xs text-white/50">{contextStatus}</p>}
      {!streetUnavailable ? <img src={`/api/india/${city.slug}/context?${location}&view=street`} alt={`Google Street View near the selected ${city.name} building`} className="w-full h-36 rounded-xl object-cover" onError={() => setStreetUnavailable(true)} /> : <p className="text-xs text-white/45">Street View unavailable here or Street View Static API access is disabled for the server key.</p>}
      <p className="text-[10px] text-white/40">Google environmental observations are contextual; current weather and air quality do not change the annual generation model.</p>
    </section>
    <section className="space-y-3 border-t border-white/10 pt-4">
      <h2 className="font-display text-sm">Explore the installation</h2>
      <div className="flex flex-wrap gap-2">
        <button disabled={pending !== null} onClick={() => generate("proposal")} className="btn-solar rounded-lg px-3 py-2 text-xs disabled:opacity-40">Generate solar proposal</button>
        <button disabled={pending !== null} onClick={() => generate("render")} className="rounded-lg border border-white/20 px-3 py-2 text-xs disabled:opacity-40">Generate before / after</button>
      </div>
      {pending && <p role="status" className="flex items-center gap-2 text-xs text-solar-200"><Loader2 size={14} className="animate-spin" />{pending === "proposal" ? "Writing your INR proposal…" : "Generating an illustrative rooftop image…"}</p>}
      {error && <p role="alert" className="text-xs text-amber-200">{error}</p>}
      {proposal && <article aria-label={`${city.name} solar proposal`} className="prose-solar text-sm rounded-xl border border-white/10 p-3"><ReactMarkdown remarkPlugins={[remarkGfm]}>{proposal}</ReactMarkdown></article>}
      {pair && <><BeforeAfterSlider beforeSrc={`data:image/png;base64,${pair.before}`} afterSrc={`data:image/png;base64,${pair.after}`} label={`${city.name} rooftop · AI illustration`} /><p className="text-[11px] text-white/50">The after image is AI-generated and may change details or panel counts. It is not a prediction, structural design or the Google Solar panel layout.</p></>}
    </section>
  </div>;
}
