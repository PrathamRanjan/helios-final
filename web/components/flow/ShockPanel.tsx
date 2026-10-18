"use client";

// Inject future shocks — they hit baseline AND scenario, so the question the
// panel answers is: "does my plan still deliver under disruption?"

import { Zap } from "lucide-react";
import { SHOCK_PRESETS, type Shock } from "@/lib/compass/flow/scenario";

interface ActiveShock {
  presetId: string;
  startYear: number;
  /** A fully specified shock (e.g. today's measured haze) instead of a preset. */
  custom?: Shock;
}

interface Props {
  active: ActiveShock[];
  onChange: (next: ActiveShock[]) => void;
  startYear: number;
  endYear: number;
}

export function shocksFromActive(active: ActiveShock[]): Shock[] {
  return active
    .map((a) => {
      if (a.custom) return a.custom;
      const p = SHOCK_PRESETS.find((x) => x.id === a.presetId);
      return p ? p.make(a.startYear) : null;
    })
    .filter((s): s is Shock => s !== null);
}

export default function ShockPanel({ active, onChange, startYear, endYear }: Props) {
  const toggle = (presetId: string, defaultYear: number) => {
    const found = active.find((a) => a.presetId === presetId);
    onChange(
      found
        ? active.filter((a) => a.presetId !== presetId)
        : [...active, { presetId, startYear: defaultYear }]
    );
  };

  const setYear = (presetId: string, year: number) =>
    onChange(active.map((a) => (a.presetId === presetId ? { ...a, startYear: year } : a)));

  return (
    <div className="glass rounded-2xl p-3 w-[290px]">
      <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-wide text-white/40 mb-1.5">
        <Zap size={10} className="text-solar-300" /> Inject shocks · resilience test
      </div>
      <div className="space-y-1">
        {SHOCK_PRESETS.map((p) => {
          const a = active.find((x) => x.presetId === p.id);
          return (
            <div
              key={p.id}
              className={`rounded-lg border px-2 py-1.5 transition-colors ${
                a ? "border-rose-400/50 bg-rose-400/10" : "border-white/10 bg-white/[0.03]"
              }`}
            >
              <button onClick={() => toggle(p.id, p.defaultYear)} className="w-full text-left">
                <div className={`text-[11px] ${a ? "text-rose-200" : "text-white/75"}`}>{p.label}</div>
                <div className="text-[9px] text-white/40 leading-snug">{p.hint}</div>
              </button>
              {a && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] text-white/45">starts</span>
                  <input
                    type="range"
                    min={startYear}
                    max={endYear - 1}
                    value={a.startYear}
                    onChange={(e) => setYear(p.id, Number(e.target.value))}
                    className="flex-1 accent-[#f43f5e]"
                  />
                  <span className="text-[10px] text-rose-300 w-9 text-right">{a.startYear}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { ActiveShock };
