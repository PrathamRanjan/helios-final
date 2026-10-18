"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sun,
  Zap,
  DollarSign,
  Leaf,
  Clock,
  X,
  Sparkles,
  Image as ImageIcon,
  CheckCircle2,
  Loader2,
  Layers,
  Compass,
  Pencil,
} from "lucide-react";
import type { ContextData, SolarData } from "@/types";
import StatCard from "./StatCard";
import ProposalStream from "./ProposalStream";
import BeforeAfterSlider from "./BeforeAfterSlider";
import ContextStrip from "./ContextStrip";
import AerialFlyby from "./AerialFlyby";
import { renderPair as fetchRenderPair, fetchDemoRenders, fetchContext, streetViewUrl } from "@/lib/client-api";

interface Props {
  solar: SolarData | null;
  loading: boolean;
  demoSlug?: string | null;
  onClose: () => void;
  onStartDrawing?: () => void;
}

interface PairState {
  before: string;
  after: string;
  imagery_source: "solar_rgb" | "static_maps" | "cached";
}

export default function Sidebar({ solar, loading, demoSlug, onClose, onStartDrawing }: Props) {
  const [showProposal, setShowProposal] = useState(false);
  const [showRender, setShowRender] = useState(false);
  const [pair, setPair] = useState<PairState | null>(null);
  const [pairLoading, setPairLoading] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [context, setContext] = useState<ContextData | null>(null);
  const [aerialPlaying, setAerialPlaying] = useState(false);
  const [streetFailed, setStreetFailed] = useState(false);

  useEffect(() => {
    setShowProposal(false);
    setShowRender(false);
    setPair(null);
    setPairError(null);
    setPairLoading(false);
    setContext(null);
    setStreetFailed(false);
    setAerialPlaying(false);
    if (demoSlug) {
      fetchDemoRenders(demoSlug).then((r) => {
        if (r.before && r.after) {
          setPair({ before: r.before, after: r.after, imagery_source: "cached" });
        }
      });
    }
    if (solar) {
      fetchContext(solar.lat, solar.lng, solar.address ?? undefined)
        .then(setContext)
        .catch(() => setContext(null));
    }
  }, [solar?.lat, solar?.lng, demoSlug]);

  const handleRenderClick = async () => {
    if (showRender) {
      setShowRender(false);
      return;
    }
    setShowRender(true);
    if (pair) return; // cached or already fetched
    if (!solar) return;
    setPairLoading(true);
    setPairError(null);
    try {
      const result = await fetchRenderPair({
        lat: solar.lat,
        lng: solar.lng,
        address: solar.address ?? undefined,
        country_code: solar.country_code,
      });
      setPair(result);
    } catch (e: any) {
      setPairError(e?.message ?? "render failed");
    } finally {
      setPairLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {(solar || loading) && (
        <motion.div
          initial={{ x: 480, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 480, opacity: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          data-tour="solar-sidebar"
          className="absolute top-24 right-6 bottom-6 w-[440px] z-10 flex flex-col"
        >
          <div className="glass-strong rounded-3xl shadow-panel flex flex-col flex-1 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/[0.05]">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Sun className="w-3.5 h-3.5 text-solar-400" />
                  <span className="text-[10.5px] uppercase tracking-[0.18em] text-white/55 font-medium">
                    HELIO Scout
                  </span>
                </div>
                <div className="text-[13px] text-white/90 leading-tight font-medium truncate max-w-[320px]">
                  {loading
                    ? "Analyzing rooftop…"
                    : solar?.address ?? "Selected location"}
                </div>
                {solar && (
                  <div className="text-[10.5px] text-white/40 mt-0.5 font-mono">
                    {solar.lat.toFixed(4)}°N · {solar.lng.toFixed(4)}°E · {solar.country}
                  </div>
                )}
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4 text-white/60" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto scroll-clean px-5 pt-5 pb-6">
              {loading && <LoadingState />}

              {solar && !loading && (
                <>
                  {/* Headline */}
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, duration: 0.6 }}
                    className="mb-5"
                  >
                    <div className="text-[10.5px] uppercase tracking-[0.14em] text-white/45 mb-1">
                      Annual generation potential
                    </div>
                    <div className="flex items-baseline gap-2">
                      <div className="stat-num text-[54px] leading-none text-solar-gradient font-medium">
                        {Math.round(solar.yearly_kwh).toLocaleString()}
                      </div>
                      <span className="text-base text-white/55">kWh / yr</span>
                    </div>
                    <SourceBadge solar={solar} />
                    <ContextStrip
                      context={context}
                      onPlayAerial={
                        context?.aerial_view
                          ? () => setAerialPlaying(true)
                          : undefined
                      }
                    />
                  </motion.div>

                  {!streetFailed && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.5, duration: 0.4 }}
                      className="mb-4 rounded-xl overflow-hidden border border-white/[0.06] relative"
                    >
                      <img
                        src={streetViewUrl(solar.lat, solar.lng)}
                        alt="Street view"
                        className="w-full h-[120px] object-cover bg-black/40"
                        onError={() => setStreetFailed(true)}
                      />
                      <div className="absolute bottom-1 right-2 text-[9.5px] text-white/80 bg-black/45 px-1.5 py-0.5 rounded font-mono uppercase tracking-wider">
                        Google Street View
                      </div>
                    </motion.div>
                  )}

                  {/* Stat grid */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <StatCard
                      label="Panels"
                      value={solar.panels}
                      delay={120}
                      icon={<Zap className="w-3.5 h-3.5" />}
                      hint={`${solar.panel_capacity_watts}W each · ${(solar.panel_area_m2 ?? 2).toFixed(2)} m²`}
                    />
                    <StatCard
                      label="System size"
                      value={solar.kwp}
                      unit="kWp"
                      precision={1}
                      delay={220}
                      accent="solar"
                      icon={<Sun className="w-3.5 h-3.5" />}
                    />
                    <StatCard
                      label="Annual savings"
                      value={solar.yearly_savings_usd}
                      prefix="$"
                      delay={320}
                      accent="solar"
                      icon={<DollarSign className="w-3.5 h-3.5" />}
                      hint={`@ $${solar.tariff_per_kwh_usd.toFixed(3)}/kWh · ${solar.utility}`}
                    />
                    <StatCard
                      label="Payback"
                      value={solar.payback_years ?? 0}
                      unit="yrs"
                      precision={1}
                      delay={420}
                      icon={<Clock className="w-3.5 h-3.5" />}
                      hint={`Install: $${(solar.install_cost_usd / 1000).toFixed(0)}k`}
                    />
                    <StatCard
                      label="CO₂ offset"
                      value={solar.co2_offset_tonnes_per_year}
                      unit="t / yr"
                      precision={1}
                      delay={520}
                      accent="green"
                      icon={<Leaf className="w-3.5 h-3.5" />}
                      hint={`${Math.round(solar.co2_offset_tonnes_per_year / 4.6)} cars off the road · EPA`}
                    />
                    <StatCard
                      label="Roof area"
                      value={solar.roof_area_m2}
                      unit="m²"
                      delay={620}
                      hint={`${Math.round(solar.usable_area_m2)} m² usable${
                        solar.usable_fraction_verified != null
                          ? ` · ${Math.round(solar.usable_fraction_verified * 100)}% verified`
                          : solar.usable_fraction_applied != null
                            ? ` · ${Math.round(solar.usable_fraction_applied * 100)}% (${solar.roof_type})`
                            : ""
                      }`}
                    />
                  </div>

                  <FinanceCards solar={solar} />
                  <RoofDetails solar={solar} />

                  {/* Tier C: invite the user to draw their actual roof */}
                  {onStartDrawing && solar.source !== "manual" && (
                    <motion.button
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.7, duration: 0.5 }}
                      onClick={onStartDrawing}
                      data-tour="draw-roof"
                      className="mt-3 w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-white/[0.04] hover:bg-solar-400/[0.08] border border-white/[0.06] hover:border-solar-400/30 transition-colors text-left group"
                    >
                      <Pencil className="w-3.5 h-3.5 text-solar-300/80 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] text-white/85 leading-tight">
                          {solar.source === "vision_estimate"
                            ? "Refine: draw your actual roof"
                            : "Override: draw your usable roof area"}
                        </div>
                        <div className="text-[10.5px] text-white/45 leading-tight mt-0.5">
                          Tier C result · ±10% · most defensible at panel
                        </div>
                      </div>
                      <span className="text-[10px] text-solar-300/80 group-hover:translate-x-0.5 transition-transform">
                        →
                      </span>
                    </motion.button>
                  )}

                  {/* Action buttons */}
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.7, duration: 0.5 }}
                    className="grid grid-cols-2 gap-2.5 mt-4"
                  >
                    <button
                      onClick={() => setShowProposal((v) => !v)}
                      className={`btn-solar flex items-center justify-center gap-2 text-sm ${showProposal ? "opacity-90" : ""}`}
                    >
                      {showProposal ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                      {showProposal ? "Hide proposal" : "Generate proposal"}
                    </button>
                    <button
                      onClick={handleRenderClick}
                      disabled={pairLoading}
                      className={`btn-ghost flex items-center justify-center gap-2 text-sm ${pairLoading ? "opacity-70 cursor-wait" : ""}`}
                    >
                      {pairLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ImageIcon className="w-4 h-4" />
                      )}
                      {pairLoading
                        ? "Rendering…"
                        : showRender
                          ? "Hide render"
                          : "See it installed"}
                    </button>
                  </motion.div>

                  {showProposal && (
                    <ProposalStream solar={solar} slug={demoSlug ?? undefined} />
                  )}

                  {showRender && pair && (
                    <>
                      <BeforeAfterSlider
                        beforeSrc={pair.before}
                        afterSrc={pair.after}
                        label={`${solar.address?.split(",")[0] ?? ""} · Photoreal render`}
                      />
                      <ImagerySourceTag source={pair.imagery_source} />
                    </>
                  )}
                  {showRender && !pair && pairLoading && (
                    <div className="mt-3 rounded-2xl glass-strong p-6 flex flex-col items-center gap-4">
                      <div className="relative w-12 h-12">
                        <div className="absolute inset-0 sun-glow" />
                        <div className="absolute inset-2 rounded-full bg-gradient-to-br from-solar-200 to-solar-500 animate-pulse-soft" />
                      </div>
                      <div className="text-center">
                        <div className="text-sm text-white/85 mb-1">
                          Painting your rooftop with panels…
                        </div>
                        <div className="text-[11px] text-white/45">
                          Fetching real aerial · Gemini 2.5 Flash Image edit · ~10s
                        </div>
                      </div>
                    </div>
                  )}
                  {showRender && !pair && pairError && (
                    <div className="mt-3 rounded-2xl glass-strong p-4 text-sm text-rose-300">
                      Render failed: {pairError}
                    </div>
                  )}

                  {/* Footer with full provenance */}
                  <div className="mt-5 pt-4 border-t border-white/[0.05] text-[10.5px] text-white/35 leading-relaxed space-y-1">
                    <div>
                      Model: <span className="text-white/65">{Math.round((solar.performance_ratio ?? 0.78) * 100)}%</span> PR
                      · <span className="text-white/65">{((solar.degradation_rate ?? 0) * 100).toFixed(1)}%/yr</span> degradation
                      · <span className="text-white/65">${solar.om_usd_per_kwp_year ?? 18}</span>/kWp/yr O&M
                      · NPV @ <span className="text-white/65">{Math.round((solar.discount_rate ?? 0.08) * 100)}%</span> discount, <span className="text-white/65">{Math.round((solar.tariff_escalation ?? 0.03) * 100)}%</span>/yr escalation
                    </div>
                    {solar.tariff_source && (
                      <div className="text-white/45">
                        Tariff: <span className="text-white/65">{solar.tariff_source}</span>
                      </div>
                    )}
                    {solar.co2_source && (
                      <div className="text-white/45">
                        Grid carbon: <span className="text-white/65">{solar.co2_source}</span>
                      </div>
                    )}
                    {solar.imagery_date && (
                      <div className="text-white/45">
                        Imagery: <span className="text-white/65">{solar.imagery_date}</span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </motion.div>
      )}
      {aerialPlaying && context?.aerial_view && (
        <AerialFlyby
          videoUrl={context.aerial_view.video_landscape}
          onClose={() => setAerialPlaying(false)}
        />
      )}
    </AnimatePresence>
  );
}

function SourceBadge({ solar }: { solar: SolarData }) {
  const tier = solar.confidence_tier ?? (solar.source === "google_solar" ? "A" : "B");
  const band = solar.confidence_band_pct ?? (tier === "A" ? 5 : tier === "C" ? 10 : 30);
  const tone =
    tier === "A"
      ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
      : tier === "C"
        ? "bg-sky-500/15 text-sky-300 border border-sky-500/30"
        : "bg-solar-400/15 text-solar-200 border border-solar-400/30";
  const sourceLabel =
    solar.source === "google_solar"
      ? `Google Solar API ${solar.imagery_quality ?? "HIGH"}`
      : solar.source === "manual"
        ? "User-drawn polygon"
        : `Gemini Vision · ${solar.vision_confidence ? Math.round(solar.vision_confidence * 100) : "—"}%`;
  return (
    <div className="mt-2 flex items-center gap-2 text-[11px] flex-wrap">
      <span className={`px-2 py-0.5 rounded-md font-medium ${tone}`} title={solar.provenance ?? ""}>
        Tier {tier} · ±{band}%
      </span>
      <span className="text-white/55">{sourceLabel}</span>
      <span className="text-white/40">
        {solar.sunshine_hours_per_year.toLocaleString()} PSH/yr
      </span>
      {solar.source === "vision_estimate" && solar.building_type && (
        <span className="text-white/50">· {solar.building_type.replace(/_/g, " ")}</span>
      )}
      {solar.source === "manual" && solar.roof_type && (
        <span className="text-white/50">· {solar.roof_type.replace(/_/g, " ")}</span>
      )}
    </div>
  );
}

function FinanceCards({ solar }: { solar: SolarData }) {
  if (solar.npv_usd == null && solar.lcoe_usd_per_mwh == null) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.65, duration: 0.5 }}
      className="mt-2.5 grid grid-cols-2 gap-2.5"
    >
      {solar.npv_usd != null && (
        <div className="rounded-xl px-3 py-2.5 bg-emerald-500/[0.06] border border-emerald-500/20">
          <div className="text-[10px] uppercase tracking-[0.12em] text-emerald-300/70 mb-0.5">
            NPV · 8% discount
          </div>
          <div className="text-base font-medium text-emerald-200 font-mono">
            ${(solar.npv_usd / 1000).toFixed(0)}k
          </div>
          <div className="text-[10px] text-white/40 mt-0.5">
            net of CAPEX + O&M, 20-yr
          </div>
        </div>
      )}
      {solar.lcoe_usd_per_mwh != null && (
        <div className="rounded-xl px-3 py-2.5 bg-solar-400/[0.07] border border-solar-400/20">
          <div className="text-[10px] uppercase tracking-[0.12em] text-solar-300/70 mb-0.5">
            LCOE
          </div>
          <div className="text-base font-medium text-solar-200 font-mono">
            ${solar.lcoe_usd_per_mwh.toFixed(0)}<span className="text-[11px] text-white/55">/MWh</span>
          </div>
          <div className="text-[10px] text-white/40 mt-0.5">
            vs grid avg ${Math.round(solar.tariff_per_kwh_usd * 1000)}/MWh
          </div>
        </div>
      )}
    </motion.div>
  );
}

function RoofDetails({ solar }: { solar: SolarData }) {
  if (solar.source === "google_solar" && solar.best_segment && solar.roof_segment_count) {
    const s = solar.best_segment;
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.65, duration: 0.5 }}
        className="mt-3 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05] flex items-center gap-3 text-[11px]"
      >
        <Layers className="w-3.5 h-3.5 text-emerald-300/80 flex-shrink-0" />
        <div className="flex-1 leading-snug">
          <div className="text-white/80">
            {solar.roof_segment_count} roof segment{solar.roof_segment_count === 1 ? "" : "s"} detected
          </div>
          <div className="text-white/45 font-mono">
            best: {s.area_m2.toLocaleString()} m² · {s.pitch_deg}° pitch · {azimuthLabel(s.azimuth_deg)}
          </div>
        </div>
      </motion.div>
    );
  }
  if (solar.source === "vision_estimate" && solar.vision_notes) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.65, duration: 0.5 }}
        className="mt-3 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05] flex items-start gap-3 text-[11px]"
      >
        <Compass className="w-3.5 h-3.5 text-solar-300/80 flex-shrink-0 mt-0.5" />
        <div className="flex-1 leading-snug">
          <div className="text-white/75 italic">"{solar.vision_notes}"</div>
          <div className="text-white/40 mt-0.5">— Gemini 2.5 Flash, on satellite tile</div>
        </div>
      </motion.div>
    );
  }
  return null;
}

function ImagerySourceTag({ source }: { source: PairState["imagery_source"] }) {
  const label =
    source === "solar_rgb"
      ? "Real aerial: Google Solar API rgbUrl · edited by Gemini 2.5 Flash Image"
      : source === "static_maps"
        ? "Real satellite: Google Static Maps · edited by Gemini 2.5 Flash Image"
        : "Pre-cached render";
  return (
    <div className="mt-2 text-[10px] text-white/40 text-center font-mono">{label}</div>
  );
}

function azimuthLabel(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return `${Math.round(deg)}° ${dirs[idx]}`;
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-5">
      <div className="relative w-14 h-14">
        <div className="absolute inset-0 sun-glow" />
        <div className="absolute inset-2 rounded-full bg-gradient-to-br from-solar-200 to-solar-500 animate-pulse-soft" />
      </div>
      <div className="text-center">
        <div className="text-sm text-white/80 mb-1">Scanning rooftop</div>
        <div className="text-[11px] text-white/40">
          Google Solar API → Gemini Vision fallback
        </div>
      </div>
      <div className="w-full max-w-[260px] space-y-2 mt-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-2 rounded-full bg-white/[0.05] overflow-hidden"
          >
            <div
              className="h-full bg-gradient-to-r from-transparent via-solar-400/40 to-transparent"
              style={{
                width: "30%",
                animation: `shimmer 2.4s ${i * 0.3}s linear infinite`,
                backgroundSize: "200% 100%",
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}