"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, MapPin, Zap, DollarSign, Sun, TrendingDown } from "lucide-react";
import type { CandidateSite, SiteResult } from "@/lib/hanoi/gridMath";
import { CONFIDENCE } from "@/lib/hanoi/gridMath";

interface Props {
  site: CandidateSite | null;
  siteResult: SiteResult | null;
  isDeployed: boolean;
  canDeploy: boolean;
  onDeploy: () => void;
  onClose: () => void;
}

const TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  dc_fast:      { label: "DC Fast",       color: "text-sky-300",    bg: "bg-sky-400/15 border-sky-400/25" },
  ev_level_2:   { label: "L2 AC",         color: "text-emerald-300", bg: "bg-emerald-400/15 border-emerald-400/25" },
  solar_canopy: { label: "Solar Canopy",  color: "text-amber-300",  bg: "bg-amber-400/15 border-amber-400/25" },
};

export default function SiteAnalysisPanel({ site, siteResult, isDeployed, canDeploy, onDeploy, onClose }: Props) {
  const [satLoaded, setSatLoaded] = useState(false);
  const [analysis, setAnalysis] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch Gemini analysis when site changes
  useEffect(() => {
    if (!site) return;
    setSatLoaded(false);
    setAnalysis("");
    setStreaming(true);

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    (async () => {
      try {
        const res = await fetch("/api/hanoi/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: site.lat, lng: site.lng, site }),
          signal: ctrl.signal,
        });
        if (!res.body) return;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") { setStreaming(false); continue; }
            try {
              const obj = JSON.parse(payload);
              if (obj.text) setAnalysis((prev) => prev + obj.text);
            } catch { /* skip */ }
          }
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") setStreaming(false);
      } finally {
        setStreaming(false);
      }
    })();

    return () => { ctrl.abort(); };
  }, [site?.id]);

  // v=19 busts the browser cache from the old zoom-18 imagery (24h max-age)
  const satUrl = site ? `/api/hanoi/satellite?lat=${site.lat}&lng=${site.lng}&v=19` : null;
  const typeInfo = TYPE_LABELS[site?.recommended_type ?? "ev_level_2"];
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

  return (
    <AnimatePresence>
      {site && siteResult && (
        <motion.div
          key={site.id}
          initial={{ opacity: 0, x: 32 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 32 }}
          transition={{ duration: 0.22 }}
          className="absolute top-5 right-5 bottom-5 z-30 w-[400px] flex flex-col gap-0 glass-strong rounded-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-start justify-between px-4 py-3 border-b border-white/[0.07]">
            <div className="min-w-0">
              <div className="text-sm font-medium text-white leading-tight truncate">{site.name}</div>
              <div className="text-[10px] text-white/40 mt-0.5 flex items-center gap-2">
                <span>{site.district}</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${typeInfo.bg} ${typeInfo.color}`}>
                  {typeInfo.label}
                </span>
              </div>
            </div>
            <button onClick={onClose} className="text-white/40 hover:text-white ml-3 mt-0.5 shrink-0">
              <X size={15} />
            </button>
          </div>

          {/* Deploy button + economics strip */}
          <div className="px-4 py-3 border-b border-white/[0.07] flex flex-col gap-3">
            {/* Deploy / Undeploy button */}
            <button
              onClick={onDeploy}
              disabled={!isDeployed && !canDeploy}
              className={`w-full py-2.5 rounded-xl text-[12px] font-semibold transition-all ${
                isDeployed
                  ? "bg-white/[0.08] text-white/70 hover:bg-red-400/15 hover:text-red-300 border border-white/10"
                  : canDeploy
                  ? "bg-emerald-400/20 text-emerald-300 hover:bg-emerald-400/30 border border-emerald-400/30"
                  : "bg-white/[0.04] text-white/25 cursor-not-allowed border border-white/[0.06]"
              }`}
            >
              {isDeployed ? "Undeploy Site" : canDeploy ? `Deploy — $${fmt(site.capex_usd)}` : "Over Budget"}
            </button>

            {/* Key economics — 4 mini stats */}
            <div className="grid grid-cols-4 gap-1.5">
              <MiniStat
                icon={<TrendingDown size={10} />}
                value={`${Math.round(siteResult.annualCO2SavedTonnes)}t`}
                label="CO₂/yr"
                accent="text-emerald-300"
              />
              <MiniStat
                icon={<DollarSign size={10} />}
                value={`$${fmt(Math.round(siteResult.costPerTonne))}`}
                label={`≈$${fmt(Math.round(siteResult.levelizedCostPerTonne))}/t lifecycle`}
                accent="text-sky-300"
              />
              <MiniStat
                icon={<Sun size={10} />}
                value={`${Math.round(siteResult.solarAlignmentPct)}%`}
                label="solar align"
                accent="text-amber-300"
              />
              <MiniStat
                icon={<MapPin size={10} />}
                value={`${site.coverage_gap_km}km`}
                label="gap"
                accent="text-white/60"
              />
            </div>
          </div>

          {/* Satellite image */}
          <div className="relative w-full aspect-video bg-white/[0.04] border-b border-white/[0.07]">
            {satUrl && (
              <img
                src={satUrl}
                alt="Satellite"
                className={`w-full h-full object-cover transition-opacity duration-300 ${satLoaded ? "opacity-100" : "opacity-0"}`}
                onLoad={() => setSatLoaded(true)}
              />
            )}
            {!satLoaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 size={14} className="animate-spin text-white/30" />
              </div>
            )}
            <div className="absolute bottom-1 left-1.5 text-[8px] text-white/40 bg-black/40 rounded px-1 py-0.5">
              {site.deploy_units} {site.deploy_unit_label} · {site.daily_evs} EVs/day
            </div>
          </div>

          {/* Gemini analysis */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <div className="text-[9.5px] uppercase tracking-wide text-white/35 mb-2 flex items-center gap-1.5">
              Site Analysis
              {streaming && <Loader2 size={9} className="animate-spin text-emerald-400" />}
            </div>
            {analysis ? (
              <p className="text-[11.5px] text-white/70 leading-relaxed whitespace-pre-wrap">
                {analysis}
                {streaming && <span className="inline-block w-1.5 h-3 bg-emerald-400/70 ml-0.5 animate-pulse" />}
              </p>
            ) : (
              <div className="text-[11px] text-white/25 italic">
                Analysing site imagery...
              </div>
            )}
          </div>

          {/* Rationale + confidence footer */}
          <div className="px-4 py-2.5 border-t border-white/[0.07] text-[9.5px] text-white/30 leading-snug space-y-1">
            <div>{site.rationale}</div>
            <div className="text-[8px] text-white/20 space-y-0.5">
              <div>Daily EVs: {CONFIDENCE.dailyEvs.level}</div>
              <div>CAPEX: {CONFIDENCE.capex.label}</div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MiniStat({ icon, value, label, accent }: {
  icon: React.ReactNode; value: string; label: string; accent: string;
}) {
  return (
    <div className="bg-white/[0.03] rounded-lg px-2 py-1.5 text-center">
      <div className={`flex items-center justify-center gap-0.5 text-[11px] font-medium ${accent}`}>
        {icon} {value}
      </div>
      <div className="text-[7.5px] text-white/30 mt-0.5">{label}</div>
    </div>
  );
}
