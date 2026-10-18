"use client";

// Back-test evidence — runs the live HELIO engine against real measured
// before/after outcomes and shows, per project, whether the model moves the
// right way and how conservative it is vs the field result. The honest headline:
// HELIO reproduces the direction of every measured effect and under-claims by
// design (it models a whole-district elasticity, not a single treated segment).

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { BacktestReport, BacktestVerdict } from "@/lib/compass/backtest/runBacktest";

const VERDICT: Record<BacktestVerdict, { label: string; cls: string }> = {
  conservative: { label: "conservative", cls: "text-sky-300" },
  "in-range": { label: "in measured range", cls: "text-emerald-300" },
  overshoots: { label: "overshoots — review", cls: "text-amber-300" },
  "wrong-direction": { label: "wrong direction — FAIL", cls: "text-rose-300" },
};

export default function BacktestPanel({ compact = false }: { compact?: boolean }) {
  const [report, setReport] = useState<BacktestReport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/compass/backtest")
      .then((r) => r.json())
      .then((d) => live && (d.error ? setErr(d.error) : setReport(d)))
      .catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, []);

  if (err) return <div className="text-[10px] text-rose-300">Back-test error: {err}</div>;
  if (!report) return <div className="flex items-center gap-2 text-[10px] text-white/50 py-2"><Loader2 size={12} className="animate-spin" /> Running live engine against real projects…</div>;

  return (
    <div className="space-y-1.5">
      {!compact && (
        <div className="text-[10px] text-white/50 print:text-black/60">
          Each row runs the live HELIO engine on a representative corridor and compares to a real measured outcome.
        </div>
      )}
      <div className="text-[10px] text-white/70 print:text-black/70">
        <span className="text-emerald-300">{report.summary.directionMatches}/{report.summary.total}</span> move the correct direction ·{" "}
        <span className="text-sky-300">{report.summary.conservative}/{report.summary.total}</span> conservative or in-range vs field results.
      </div>
      {report.rows.map((r) => {
        const v = VERDICT[r.verdict];
        return (
          <div key={r.id} className="rounded-md bg-white/[0.03] print:bg-black/5 px-2 py-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] text-white/80 print:text-black/80">{r.project}</span>
              <span className={`text-[9px] ${v.cls}`}>{r.direction === "match" ? "✓" : "✗"} {v.label}</span>
            </div>
            <div className="text-[9.5px] text-white/55 print:text-black/60 mt-0.5">
              measured <span className="text-white/80 print:text-black">+{r.measuredLoPct}–{r.measuredHiPct}%</span> (corridor, {r.city}) · HELIO{" "}
              <span className="text-white/80 print:text-black">+{r.modelledUpliftPct}%</span> (district model) · {r.co2AvoidedT} t, {r.tripsShiftedPerDay.toLocaleString()} trips/day
            </div>
            <div className="text-[8.5px] text-white/35 print:text-black/45 mt-0.5">{r.metric} — {r.source}</div>
          </div>
        );
      })}
      <div className="text-[8.5px] text-white/40 print:text-black/50 leading-snug">
        Scope note: measured values are corridor/site field measurements; HELIO models a whole-district elasticity, so its uplift is
        expected to be smaller. Conservative = HELIO under-claims vs the field result (impact numbers are floors, not hype).
      </div>
    </div>
  );
}
