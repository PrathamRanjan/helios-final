"use client";

// The master clock: scrub 2026–2036 (or press play for a time-lapse) and the
// whole world follows — agents, modifiers fading in, chart crosshair, KPIs.

import { useEffect, useMemo, useRef } from "react";
import { Pause, Play } from "lucide-react";
import type { ScenarioResult, WorldModifier, Shock } from "@/lib/compass/flow/scenario";
import { yearCaptions, type YearCaption } from "@/lib/compass/flow/yearCaptions";

const YEAR_SECONDS = 1.4; // time-lapse pace per simulated year

const CAPTION_TONE: Record<YearCaption["tone"], string> = {
  good: "text-emerald-300",
  shock: "text-rose-300",
  policy: "text-violet-300",
  neutral: "text-white/55",
};

interface Props {
  startYear: number;
  endYear: number;
  year: number;
  onYearChange: (y: number) => void;
  playing: boolean;
  onPlayingChange: (p: boolean) => void;
  result: ScenarioResult | null;
  modifiers?: WorldModifier[];
  shocks?: Shock[];
}

export default function WorldTimeline({
  startYear,
  endYear,
  year,
  onYearChange,
  playing,
  onPlayingChange,
  result,
  modifiers = [],
  shocks = [],
}: Props) {
  const yearRef = useRef(year);
  yearRef.current = year;

  const captions = useMemo(
    () => (result ? yearCaptions(result, { modifiers, shocks }) : null),
    [result, modifiers, shocks]
  );
  const caption = captions?.get(year) ?? null;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const next = yearRef.current + 1;
      if (next > endYear) {
        onYearChange(startYear); // loop the time-lapse
      } else {
        onYearChange(next);
      }
    }, YEAR_SECONDS * 1000);
    return () => clearInterval(id);
  }, [playing, startYear, endYear, onYearChange]);

  const idx = Math.max(0, Math.min(year - startYear, (result?.timeline.length ?? 1) - 1));
  const yr = result?.timeline[idx];
  const base = result?.baselineTimeline[idx];

  return (
    <div className="flex flex-col items-center gap-1.5 w-[620px]">
      {/* Year caption: the time-lapse narrates itself. */}
      {caption && (
        <div className="glass rounded-full px-3.5 py-1 text-[11px] leading-tight max-w-full">
          <span className="text-white/40 font-display mr-1.5">{caption.year}</span>
          <span className={CAPTION_TONE[caption.tone]}>{caption.text}</span>
        </div>
      )}

      <div className="glass rounded-2xl px-4 py-2.5 flex items-center gap-3 w-full shadow-panel">
      <button
        onClick={() => onPlayingChange(!playing)}
        className="w-8 h-8 rounded-full bg-solar-400/90 hover:bg-solar-400 text-black flex items-center justify-center shrink-0"
        title={playing ? "Pause" : "Play time-lapse"}
      >
        {playing ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}
      </button>

      <span className="font-display text-lg text-solar-300 w-14 text-center shrink-0">{year}</span>

      <input
        type="range"
        min={startYear}
        max={endYear}
        value={year}
        onChange={(e) => {
          onPlayingChange(false);
          onYearChange(Number(e.target.value));
        }}
        className="flex-1 accent-[#d97706]"
      />

      <div className="text-[10px] text-white/55 w-[170px] text-right leading-tight shrink-0">
        {yr && base ? (
          <>
            <span className="text-white/80">{fmt(yr.transportCO2Tonnes)} t CO₂</span>
            {" · "}
            <span className={yr.annualCO2AvoidedTonnes > 0 ? "text-emerald-300" : "text-white/45"}>
              −{fmt(yr.annualCO2AvoidedTonnes)} t/yr
            </span>
            <span className="block text-white/35">
              cum. {fmt(yr.cumulativeCO2AvoidedTonnes)} t avoided
            </span>
          </>
        ) : (
          <span className="text-white/35">simulate to see the city react</span>
        )}
      </div>
      </div>
    </div>
  );
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
