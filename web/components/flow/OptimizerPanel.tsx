"use client";

// HELIO Suggest-Changes: engine-scored recommendations under a budget.
// Recommendation → decision → action: every item is accept / reject.

import { Plus, Sparkles, X, ShieldAlert } from "lucide-react";
import type { OptimizeResult, Suggestion, WorldModifier } from "@/lib/compass/flow/scenario";
import ParetoChart from "./ParetoChart";

interface Props {
  result: OptimizeResult;
  acceptedIds: Set<string>;
  onAccept: (mods: WorldModifier[]) => void;
  onClose: () => void;
}

export default function OptimizerPanel({ result, acceptedIds, onAccept, onClose }: Props) {
  const pkg = result.package;
  const selected = result.suggestions.filter((s) => s.selected && !acceptedIds.has(s.modifier.id));
  // Candidates HELIO refused to recommend because they shift the problem.
  const rejected = result.suggestions.filter((s) => s.regrettable);

  return (
    <div className="glass rounded-2xl p-4 w-[340px] shadow-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-display text-sm text-white">
          <Sparkles size={13} className="text-solar-300" /> Recommended package
        </div>
        <button onClick={onClose} className="text-white/40 hover:text-white">
          <X size={13} />
        </button>
      </div>

      {pkg && (
        <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
          <PkgStat label="CO₂ avoided" value={`${fmt(pkg.cumulativeCO2AvoidedTonnes)} t`} />
          <PkgStat label="Cost / tonne" value={pkg.costPerTonneUsd !== null ? `$${fmt(pkg.costPerTonneUsd)}` : "—"} />
          <PkgStat label="Capex" value={`$${(pkg.capexUsd / 1e6).toFixed(1)}M / $${(result.budgetUsd / 1e6).toFixed(0)}M`} />
        </div>
      )}

      <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto pr-1">
        {result.suggestions
          .filter((s) => s.selected)
          .map((s) => (
            <SuggestionRow
              key={s.modifier.id}
              s={s}
              accepted={acceptedIds.has(s.modifier.id)}
              onAccept={() => onAccept([s.modifier])}
            />
          ))}
      </div>

      {selected.length > 0 && (
        <button
          onClick={() => onAccept(selected.map((s) => s.modifier))}
          className="mt-3 w-full flex items-center justify-center gap-1.5 rounded-lg bg-solar-400/90 hover:bg-solar-400 py-2 text-[11.5px] font-medium text-black"
        >
          <Plus size={13} /> Accept package ({selected.length})
        </button>
      )}

      {/* Trade-off frontier — the recommendation is one point on it. */}
      <ParetoChart suggestions={result.suggestions} packages={result.paretoPackages} />

      {/* Showcase the avoidance: what HELIO refused to recommend, and why. */}
      {rejected.length > 0 && (
        <div className="mt-3 rounded-lg border border-rose-400/30 bg-rose-400/[0.06] px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[10.5px] text-rose-300 mb-1">
            <ShieldAlert size={12} /> Not recommended — would shift the problem ({rejected.length})
          </div>
          <div className="space-y-1.5">
            {rejected.slice(0, 3).map((s) => (
              <div key={s.modifier.id} className="text-[9.5px] text-white/55 leading-snug">
                <span className="text-white/75">{s.modifier.label}</span> — {s.regrettableReason}
              </div>
            ))}
          </div>
          <div className="mt-1 text-[8.5px] text-white/35">
            HELIO won&apos;t recommend solving one problem by creating another.
          </div>
        </div>
      )}

      <div className="mt-2 text-[9px] leading-snug text-white/35 border-t border-white/10 pt-1.5">
        {result.note} Objective: {result.objective}.
      </div>
    </div>
  );
}

function SuggestionRow({ s, accepted, onAccept }: { s: Suggestion; accepted: boolean; onAccept: () => void }) {
  return (
    <div className={`rounded-lg px-2.5 py-2 border ${accepted ? "border-emerald-400/40 bg-emerald-400/5" : "border-white/10 bg-white/[0.03]"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] text-white/85 leading-tight">{s.modifier.label}</div>
          <div className="text-[9px] text-white/40 mt-0.5 leading-snug">{s.reason}</div>
          <div className="text-[9.5px] text-white/55 mt-1">
            <span className="text-emerald-300">{fmt(s.aloneAvoidedT)} t</span>
            {" · "}
            {s.aloneCostPerTonneUsd !== null ? `$${fmt(s.aloneCostPerTonneUsd)}/t` : "—"}
            {s.aloneHeatReducedPct > 0 && <> · heat −{s.aloneHeatReducedPct}%</>}
            {" · "}${(s.modifier.economics.capexUsd / 1000).toFixed(0)}k
          </div>
          {s.feasibility && s.feasibility.severity !== "ok" && (
            <div className="mt-1 text-[9px] leading-snug text-amber-300/90" title={s.feasibility.flags.map((f) => f.fix).join(" ")}>
              ⚠ {s.feasibility.flags[0].message}
            </div>
          )}
        </div>
        <button
          onClick={onAccept}
          disabled={accepted}
          className={`shrink-0 rounded-md px-2 py-1 text-[10px] border ${
            accepted
              ? "border-emerald-400/40 text-emerald-300 cursor-default"
              : "border-solar-400/50 text-solar-200 hover:bg-solar-400/10"
          }`}
        >
          {accepted ? "Added" : "+ Add"}
        </button>
      </div>
    </div>
  );
}

function PkgStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/[0.04] rounded-lg px-1.5 py-1.5">
      <div className="text-[8.5px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="text-[11px] text-white/85 mt-0.5">{value}</div>
    </div>
  );
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
