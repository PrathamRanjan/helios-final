"use client";

// After drawing, the user declares what the object DOES — capabilities compose
// into WorldModifier.effects. No object menus, no hardcoded interventions.

import { useMemo, useState } from "react";
import { Check, Recycle } from "lucide-react";
import {
  CAPABILITIES,
  COST_TIERS,
  buildModifier,
  circularOptionsFor,
  type CircularChoice,
  type ModifierGeometry,
  type WorldModifier,
} from "@/lib/compass/flow/scenario";
import { embodiedForModifier } from "@/lib/compass/lifecycle/embodied";
import { capexForModifier } from "@/lib/compass/finance/intervention";
import { formatMoney, type CurrencyCode } from "@/lib/compass/finance/currency";
import CivicPulse from "./CivicPulse";

interface Props {
  geometry: ModifierGeometry;
  startYear: number;
  endYear: number;
  currency?: CurrencyCode;
  onConfirm: (m: WorldModifier) => void;
  onCancel: () => void;
}

export default function CapabilityPanel({ geometry, startYear, endYear, currency = "SGD", onConfirm, onCancel }: Props) {
  const [picked, setPicked] = useState<string[]>([]);
  const [costTier, setCostTier] = useState<(typeof COST_TIERS)[number]["id"]>("med");
  const [builtYear, setBuiltYear] = useState(startYear);
  const [label, setLabel] = useState("");
  const [circular, setCircular] = useState<CircularChoice>({});

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const circularOpts = circularOptionsFor(picked);
  const toggleCircular = (id: keyof CircularChoice) =>
    setCircular((c) => ({ ...c, [id]: !c[id] }));

  // Live embodied-carbon preview: standard vs the current circular choices.
  const embodiedPreview = useMemo(() => {
    if (picked.length === 0) return null;
    const base = buildModifier({ geometry, capabilityIds: picked, costTier, builtYear });
    const circ = buildModifier({ geometry, capabilityIds: picked, costTier, builtYear, circular });
    const stdKg = embodiedForModifier(base).totalKg;
    const circKg = embodiedForModifier(circ).totalKg;
    if (stdKg <= 0) return null;
    return { stdT: stdKg / 1000, circT: circKg / 1000, savedT: (stdKg - circKg) / 1000 };
  }, [picked, costTier, builtYear, circular, geometry]);

  // Live cost preview from real unit costs.
  const capexPreview = useMemo(() => {
    if (picked.length === 0) return null;
    const m = buildModifier({ geometry, capabilityIds: picked, costTier, builtYear });
    const c = capexForModifier(m);
    return c.totalUsd > 0 ? c.totalUsd : m.economics.capexUsd;
  }, [picked, costTier, builtYear, geometry]);

  const geomName =
    geometry.type === "Point" ? "point" : geometry.type === "LineString" ? "corridor" : "zone";

  return (
    <div className="glass rounded-2xl p-4 w-[300px] shadow-panel">
      <div className="font-display text-sm text-white">What does this {geomName} do?</div>
      <div className="text-white/45 text-[11px] mt-0.5 mb-3">
        Capabilities change the world — agents decide the outcome.
      </div>

      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Name it (optional)"
        className="w-full mb-3 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 outline-none focus:border-solar-400/50"
      />

      <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
        {CAPABILITIES.map((c) => {
          const on = picked.includes(c.id);
          return (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              className={`w-full text-left rounded-lg px-2.5 py-2 border transition-colors ${
                on
                  ? "border-solar-400/60 bg-solar-400/10"
                  : "border-white/10 bg-white/[0.03] hover:border-white/25"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs ${on ? "text-solar-200" : "text-white/80"}`}>{c.label}</span>
                {on && <Check size={12} className="text-solar-300" />}
              </div>
              <div className="text-[10px] text-white/40 mt-0.5 leading-snug">{c.hint}</div>
              <div className="text-[9px] text-white/30 mt-0.5 uppercase tracking-wide">{c.confidence}</div>
            </button>
          );
        })}
      </div>

      {capexPreview !== null && (
        <div className="mt-3 flex items-center justify-between text-[11px] bg-white/[0.04] rounded-lg px-2.5 py-1.5">
          <span className="text-white/45">Estimated build cost</span>
          <span className="text-white/85 font-medium">{formatMoney(capexPreview, currency)}</span>
        </div>
      )}

      {picked.length > 0 && (
        <div className="mt-2">
          <CivicPulse capabilityIds={picked} />
        </div>
      )}

      {/* Circular procurement — reduces embodied carbon, moves payback earlier. */}
      {circularOpts.length > 0 && (
        <div className="mt-2 rounded-lg bg-white/[0.03] border border-white/10 px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[10.5px] text-white/55 mb-1.5">
            <Recycle size={11} /> Circular procurement
          </div>
          <div className="space-y-1">
            {circularOpts.map((o) => (
              <button
                key={o.id}
                onClick={() => toggleCircular(o.id)}
                title={o.hint}
                className={`w-full flex items-center justify-between rounded-md px-2 py-1 border text-left ${
                  circular[o.id]
                    ? "border-emerald-400/50 bg-emerald-400/10"
                    : "border-white/10 hover:border-white/25"
                }`}
              >
                <span className={`text-[10.5px] ${circular[o.id] ? "text-emerald-300" : "text-white/70"}`}>{o.label}</span>
                {circular[o.id] && <Check size={11} className="text-emerald-300" />}
              </button>
            ))}
          </div>
          {embodiedPreview && (
            <div className="mt-1.5 text-[9.5px] text-white/45">
              Embodied carbon: {embodiedPreview.circT.toFixed(1)} t
              {embodiedPreview.savedT > 0.05 && (
                <span className="text-emerald-300"> · −{embodiedPreview.savedT.toFixed(1)} t vs standard</span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <span className="text-[11px] text-white/50 w-14">Cost</span>
        <div className="flex gap-1 flex-1">
          {COST_TIERS.map((t) => (
            <button
              key={t.id}
              onClick={() => setCostTier(t.id)}
              className={`flex-1 rounded-md px-1 py-1 text-[10px] border ${
                costTier === t.id
                  ? "border-solar-400/60 bg-solar-400/10 text-solar-200"
                  : "border-white/10 text-white/50 hover:border-white/25"
              }`}
            >
              {t.label.split(" ")[0]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="text-[11px] text-white/50 w-14">Built in</span>
        <input
          type="range"
          min={startYear}
          max={endYear - 1}
          value={builtYear}
          onChange={(e) => setBuiltYear(Number(e.target.value))}
          className="flex-1 accent-[#ffd24a]"
        />
        <span className="text-[11px] text-solar-300 w-9 text-right">{builtYear}</span>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 rounded-lg border border-white/10 py-1.5 text-[11px] text-white/60 hover:text-white"
        >
          Discard
        </button>
        <button
          disabled={picked.length === 0}
          onClick={() =>
            onConfirm(buildModifier({ geometry, capabilityIds: picked, costTier, builtYear, label, circular }))
          }
          className="flex-1 rounded-lg bg-solar-400/90 hover:bg-solar-400 py-1.5 text-[11px] font-medium text-black disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Add to world
        </button>
      </div>
    </div>
  );
}
