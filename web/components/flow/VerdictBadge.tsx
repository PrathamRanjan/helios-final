"use client";

// The decision moment: a scenario's cost-per-tonne, translated into an instant
// verdict the planner reads in half a second. Bands + carbon-price context come
// from lib/compass/finance/verdict.ts (honesty note lives there).

import { verdictFor } from "@/lib/compass/finance/verdict";

const TONE: Record<string, { dot: string; text: string; ring: string }> = {
  good: { dot: "bg-emerald-400", text: "text-emerald-300", ring: "ring-emerald-400/30" },
  ok: { dot: "bg-sky-400", text: "text-sky-300", ring: "ring-sky-400/30" },
  warn: { dot: "bg-amber-400", text: "text-amber-300", ring: "ring-amber-400/30" },
  bad: { dot: "bg-rose-400", text: "text-rose-300", ring: "ring-rose-400/30" },
};

export default function VerdictBadge({
  costPerTonneUsd,
  size = "md",
}: {
  costPerTonneUsd: number | null;
  size?: "sm" | "md";
}) {
  const v = verdictFor(costPerTonneUsd);
  const tone = TONE[v.tone];
  const context =
    v.carbonPriceMultiple !== null
      ? `≈${v.carbonPriceMultiple}× the 2030 carbon price — ${v.blurb.toLowerCase()}`
      : v.blurb;

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full ring-1 ${tone.ring} bg-white/[0.04] ${
        size === "sm" ? "px-2 py-0.5" : "px-2.5 py-1"
      }`}
      title={context}
    >
      <span className={`inline-block rounded-full ${tone.dot} ${size === "sm" ? "w-1.5 h-1.5" : "w-2 h-2"}`} />
      <span className={`font-medium ${tone.text} ${size === "sm" ? "text-[10px]" : "text-[11px]"}`}>
        {v.label}
      </span>
    </div>
  );
}
