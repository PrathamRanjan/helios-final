"use client";

// Scenario A/B compare — save two packages and diff them side by side.
// The live-demo "watch what happens if…" beat: fund-vs-alternative in one view.

import { X, ArrowRight } from "lucide-react";
import type { ScenarioResult } from "@/lib/compass/flow/scenario";
import { formatMoney, type CurrencyCode } from "@/lib/compass/finance/currency";

export interface CompareSlot {
  label: string;
  count: number; // number of modifiers
  result: ScenarioResult;
}

type Dir = "up" | "down"; // which direction is "better"

export default function ScenarioCompare({
  a,
  b,
  currency = "SGD",
  onClose,
}: {
  a: CompareSlot;
  b: CompareSlot;
  currency?: CurrencyCode;
  onClose: () => void;
}) {
  const money = (usd: number) => formatMoney(usd, currency);
  const sa = a.result.summary;
  const sb = b.result.summary;

  const rows: { label: string; a: number | null; b: number | null; fmt: (n: number) => string; better: Dir }[] = [
    { label: "Net CO₂ avoided", a: sa.netCO2AvoidedTonnes, b: sb.netCO2AvoidedTonnes, fmt: (n) => `${money(n)} t`, better: "up" },
    { label: "Cost / tonne", a: sa.costPerTonneUsd, b: sb.costPerTonneUsd, fmt: (n) => money(n), better: "down" },
    { label: "Capex", a: sa.capexUsd, b: sb.capexUsd, fmt: (n) => money(n), better: "down" },
    { label: "Social NPV", a: sa.socialNpvUsd, b: sb.socialNpvUsd, fmt: (n) => money(n), better: "up" },
    { label: "Cash NPV", a: sa.cashNpvUsd, b: sb.cashNpvUsd, fmt: (n) => money(n), better: "up" },
    { label: "Heat exposure reduced", a: sa.heatExposureReducedPct, b: sb.heatExposureReducedPct, fmt: (n) => `${n}%`, better: "up" },
    { label: "Budget share", a: sa.budgetSharePct, b: sb.budgetSharePct, fmt: (n) => `${n}%`, better: "down" },
    { label: "Interventions", a: a.count, b: b.count, fmt: (n) => String(n), better: "up" },
  ];

  const winnerClass = (row: (typeof rows)[number], which: "a" | "b") => {
    if (row.a === null || row.b === null || row.a === row.b) return "text-white/85";
    const aWins = row.better === "up" ? row.a > row.b : row.a < row.b;
    const isWinner = which === "a" ? aWins : !aWins;
    return isWinner ? "text-emerald-300 font-medium" : "text-white/70";
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
      <div className="relative bg-[#0f1117] text-white rounded-2xl w-[620px] max-w-full max-h-[90vh] overflow-y-auto shadow-panel">
        <div className="sticky top-0 flex items-center justify-between px-5 py-3 bg-[#0f1117]/95 backdrop-blur border-b border-white/10">
          <span className="font-display text-sm text-solar-gradient">Compare scenarios — A vs B</span>
          <button onClick={onClose} className="text-white/50 hover:text-white p-1.5"><X size={16} /></button>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-2 items-center">
            <div />
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-wide text-sky-300">A</div>
              <div className="text-[10.5px] text-white/70 truncate" title={a.label}>{a.label}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-wide text-amber-300">B</div>
              <div className="text-[10.5px] text-white/70 truncate" title={b.label}>{b.label}</div>
            </div>

            {rows.map((row) => (
              <RowCells key={row.label} row={row} winnerClass={winnerClass} />
            ))}
          </div>

          <div className="mt-4 rounded-lg bg-white/[0.03] px-3 py-2 text-[10px] text-white/60 flex items-center gap-2">
            <span className="text-sky-300">A</span>
            <ArrowRight size={11} className="text-white/40" />
            <span className="text-amber-300">B</span>
            <span className="ml-1">
              {deltaSentence(sa.netCO2AvoidedTonnes, sb.netCO2AvoidedTonnes, "t net CO₂", money)} ·{" "}
              {deltaSentence(sa.capexUsd, sb.capexUsd, "capex", money, true)}
            </span>
          </div>
          <div className="mt-1 text-[8.5px] text-white/35">Green = the better value on that metric. Both are real joint simulations against the same policy baseline.</div>
        </div>
      </div>
    </div>
  );
}

function RowCells({
  row,
  winnerClass,
}: {
  row: { label: string; a: number | null; b: number | null; fmt: (n: number) => string; better: Dir };
  winnerClass: (row: any, which: "a" | "b") => string;
}) {
  return (
    <>
      <div className="text-[10px] text-white/45 py-1.5 border-t border-white/5">{row.label}</div>
      <div className={`text-center text-[11px] py-1.5 border-t border-white/5 ${winnerClass(row, "a")}`}>
        {row.a === null ? "—" : row.fmt(row.a)}
      </div>
      <div className={`text-center text-[11px] py-1.5 border-t border-white/5 ${winnerClass(row, "b")}`}>
        {row.b === null ? "—" : row.fmt(row.b)}
      </div>
    </>
  );
}

function deltaSentence(a: number, b: number, unit: string, money: (n: number) => string, moneyUnit = false): string {
  const d = b - a;
  const sign = d > 0 ? "+" : "";
  const val = moneyUnit ? money(Math.abs(d)) : `${sign}${money(d)}`;
  return moneyUnit ? `${d >= 0 ? "+" : "−"}${val} ${unit}` : `${val} ${unit}`;
}
