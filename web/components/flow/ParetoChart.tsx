"use client";

// Pareto frontier scatter — the trade-off behind the single recommendation.
// x = capex (lower-left is cheaper), y = CO₂ avoided (higher is better).
// Prefers PACKAGE-level points (real joint simulations of different objective
// weightings) when the optimizer returns them; falls back to individual
// candidates otherwise. The recommended package/pick is ringed. Removes the
// "one arbitrary heat-weight" objection by showing the real trade-off.

import { useMemo, useState } from "react";
import { GitBranch, ChevronDown, ChevronUp } from "lucide-react";
import { paretoFrontier } from "@/lib/compass/act/pareto";
import type { Suggestion, ParetoPackage } from "@/lib/compass/flow/scenario";

const W = 300;
const H = 175;
const PAD = { l: 34, r: 10, t: 10, b: 26 };

interface Point {
  label: string;
  x: number; // capex
  y: number; // co2
  onFrontier: boolean;
  selected: boolean;
  detail: string;
}

export default function ParetoChart({
  suggestions,
  packages,
}: {
  suggestions: Suggestion[];
  packages?: ParetoPackage[];
}) {
  const [open, setOpen] = useState(false);
  const isPackages = Boolean(packages && packages.length >= 2);

  const points: Point[] = useMemo(() => {
    if (packages && packages.length >= 2) {
      return packages.map((p) => ({
        label: `${p.ids.length}-item package`,
        x: p.capexUsd,
        y: p.co2AvoidedT,
        onFrontier: p.onFrontier,
        selected: p.isRecommended,
        detail: `${p.labels.join(", ")}\n${p.co2AvoidedT} t CO₂ · heat −${p.heatReducedPct}% · $${(p.capexUsd / 1e6).toFixed(1)}M${p.costPerTonneUsd !== null ? ` · $${p.costPerTonneUsd.toLocaleString()}/t` : ""}${p.isRecommended ? " · RECOMMENDED" : ""}`,
      }));
    }
    const pareto = paretoFrontier(suggestions);
    return pareto.points.map((p) => ({
      label: p.label,
      x: p.capexUsd,
      y: p.co2AvoidedT,
      onFrontier: p.onFrontier,
      selected: p.selected,
      detail: `${p.label}\n${p.co2AvoidedT} t CO₂ · $${(p.capexUsd / 1000).toFixed(0)}k`,
    }));
  }, [suggestions, packages]);

  if (points.length < 2) return null;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const px = (v: number) => PAD.l + ((v - xMin) / Math.max(1, xMax - xMin)) * (W - PAD.l - PAD.r);
  const py = (v: number) => H - PAD.b - ((v - yMin) / Math.max(0.001, yMax - yMin)) * (H - PAD.t - PAD.b);

  const frontier = points.filter((p) => p.onFrontier).sort((a, b) => a.x - b.x);
  const frontierPath = frontier
    .map((p, i) => `${i === 0 ? "M" : "L"} ${px(p.x).toFixed(1)} ${py(p.y).toFixed(1)}`)
    .join(" ");

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-2.5 py-2 text-[10.5px] text-white/70 hover:text-white"
      >
        <span className="flex items-center gap-1.5">
          <GitBranch size={12} className="text-sky-300" />
          {isPackages ? "Package trade-off frontier (carbon vs cost)" : "Trade-off frontier (carbon vs cost)"}
        </span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div className="px-2 pb-2">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
            <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="rgba(255,255,255,0.15)" />
            <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="rgba(255,255,255,0.15)" />
            {frontier.length > 1 && (
              <path d={frontierPath} fill="none" stroke="rgba(125,211,252,0.7)" strokeWidth={1.5} strokeDasharray="3 2" />
            )}
            {points.map((p, i) => (
              <g key={i}>
                {p.selected && (
                  <circle cx={px(p.x)} cy={py(p.y)} r={7} fill="none" stroke="rgba(52,211,153,0.9)" strokeWidth={1.5} />
                )}
                <circle
                  cx={px(p.x)}
                  cy={py(p.y)}
                  r={isPackages ? 4 : 3.2}
                  fill={p.onFrontier ? "rgba(125,211,252,0.95)" : "rgba(255,255,255,0.28)"}
                >
                  <title>{p.detail}</title>
                </circle>
              </g>
            ))}
            <text x={(PAD.l + W - PAD.r) / 2} y={H - 4} textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.4)">capex →</text>
            <text x={9} y={(PAD.t + H - PAD.b) / 2} textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.4)" transform={`rotate(-90 9 ${(PAD.t + H - PAD.b) / 2})`}>CO₂ avoided →</text>
          </svg>
          <div className="flex items-center gap-3 text-[8.5px] text-white/45 px-1">
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: "rgba(125,211,252,0.95)" }} /> on frontier</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: "rgba(255,255,255,0.28)" }} /> dominated</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full border" style={{ borderColor: "rgba(52,211,153,0.9)" }} /> recommended</span>
          </div>
          <div className="text-[8.5px] text-white/35 mt-1 px-1 leading-snug">
            {isPackages
              ? "Each point is a whole package (a real joint simulation) built by sweeping the objective weight from carbon-only to heat-heavy. The frontier is where no package beats it on carbon, heat and cost at once — the recommendation sits on it."
              : "Each point is one intervention scored through the full simulation; the frontier is the non-dominated set."}
          </div>
        </div>
      )}
    </div>
  );
}
