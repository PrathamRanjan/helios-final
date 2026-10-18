"use client";

// Air & haze: today's measured air quality, what a haze day does to people and rooftop
// solar (from the same physics the simulator uses), and one click to inject today's haze
// as a shock so the plan is tested against the air people are actually breathing.

import { useEffect, useState } from "react";
import { Wind, Loader2, AlertTriangle, Plus, Check } from "lucide-react";
import { Label, ConfChip } from "@/components/v2/ui";
import { hazeEffect, psiBand } from "@/lib/compass/air/haze";
import type { Shock } from "@/lib/compass/world/types";

export interface AirReading {
  city: string;
  source: string;
  sourceUrl: string;
  kind: "station" | "model";
  updated: string;
  pm25: number;
  psi?: number;
  aqi?: number;
  band: string;
  regions?: { name: string; psi?: number; pm25?: number }[];
  error?: string;
}

const BAND_TONE: Record<string, string> = {
  Good: "text-signal-300",
  Moderate: "text-white/80",
  Satisfactory: "text-white/80",
  Unhealthy: "text-warn-300",
  Poor: "text-warn-300",
  "Very unhealthy": "text-risk-300",
  "Very poor": "text-risk-300",
  Hazardous: "text-risk-400",
  Severe: "text-risk-400",
};

/** PM2.5 → an equivalent NEA PSI, so cities without PSI use the same haze physics. */
function pm25ToPsi(pm: number): number {
  const pts: [number, number][] = [[0, 0], [12, 50], [55, 100], [150, 200], [250, 300], [350, 400], [500, 500]];
  for (let i = 1; i < pts.length; i++) if (pm <= pts[i][0]) return pts[i - 1][1] + ((pm - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0])) * (pts[i][1] - pts[i - 1][1]);
  return 500;
}

export function useAir(city: string) {
  const [air, setAir] = useState<AirReading | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/air?city=${city}`)
        .then((r) => r.json())
        .then((d) => alive && setAir(d))
        .catch((e) => alive && setAir({ error: String(e) } as AirReading));
    load();
    const t = setInterval(load, 10 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [city]);
  return air;
}

/** Small command-bar chip: today's air at a glance. */
export function AirChip({ city, onClick }: { city: string; onClick?: () => void }) {
  const air = useAir(city);
  if (!air || air.error) return null;
  const label = air.psi != null ? `PSI ${air.psi}` : `PM2.5 ${Math.round(air.pm25)}`;
  return (
    <button onClick={onClick} data-tour="air" title={`${air.city}: ${air.band} · ${air.source}`} className={`mono hidden md:inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider whitespace-nowrap ${BAND_TONE[air.band] ?? "text-white/60"}`}>
      <Wind size={11} /> {label} · {air.band}
    </button>
  );
}

export default function HazePanel({ city, startYear, onInject, injected }: { city: string; startYear: number; onInject?: (s: Shock) => void; injected?: boolean }) {
  const air = useAir(city);
  const [days, setDays] = useState(30);

  if (!air)
    return (
      <div className="flex items-center gap-2 py-3 text-[11px] text-white/40">
        <Loader2 size={12} className="animate-spin" /> Reading today's air…
      </div>
    );
  if (air.error)
    return (
      <div className="rounded-[4px] border border-risk-400/30 bg-risk-400/[0.06] p-2.5 text-[11px] text-risk-300 flex items-start gap-1.5">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {air.error}
      </div>
    );

  const psi = air.psi ?? Math.round(pm25ToPsi(air.pm25));
  const fx = hazeEffect(psi, days);
  const hazy = psi > 100;
  const shock: Shock = { type: "haze", startYear, durationYears: 1, psi, daysPerYear: days };

  return (
    <div className="rounded-[4px] border border-line p-3 space-y-2.5" data-tour="haze">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[12.5px] text-white">
          <Wind size={14} className="text-sky-300" /> Air today · {air.city}
        </div>
        <ConfChip conf={air.kind === "station" ? "measured" : "calibrated proxy"} />
      </div>
      <div className="flex items-baseline gap-3">
        <div className={`mono text-[24px] leading-none ${BAND_TONE[air.band] ?? "text-white"}`}>{air.psi != null ? air.psi : Math.round(air.pm25)}</div>
        <div className="text-[11px] text-white/55 leading-tight">
          {air.psi != null ? "24-h PSI (worst region)" : "PM2.5 µg/m³"}
          <div className={BAND_TONE[air.band] ?? "text-white/70"}>{air.band}</div>
        </div>
      </div>
      {air.regions && air.psi != null && (
        <div className="grid grid-cols-5 gap-1">
          {air.regions.map((r) => (
            <div key={r.name} className="rounded-[3px] border border-line px-1 py-1 text-center">
              <div className="text-[9px] uppercase tracking-wider text-white/40">{r.name}</div>
              <div className={`mono text-[12px] ${BAND_TONE[psiBand(r.psi ?? 0)]}`}>{r.psi}</div>
            </div>
          ))}
        </div>
      )}

      <div>
        <Label>On a day like today</Label>
        <div className="grid grid-cols-3 gap-2 mt-1.5 text-[11px]">
          <div>
            <div className="text-white/45">Cycling trips</div>
            <div className="mono text-white/85">−{Math.round(fx.cycleDropOnHazeDay * 100)}%</div>
          </div>
          <div>
            <div className="text-white/45">Walking trips</div>
            <div className="mono text-white/85">−{Math.round(fx.cycleDropOnHazeDay * 50)}%</div>
          </div>
          <div>
            <div className="text-white/45">Rooftop solar</div>
            <div className="mono text-white/85">−{Math.round(fx.pvLossOnHazeDay * 100)}%</div>
          </div>
        </div>
        <div className="text-[10px] text-white/35 mt-1 leading-snug">
          Trips move to MRT, bus and car. Shade and shelters don't help: it's the air. PM2.5 ≈ {Math.round(fx.pm25)} µg/m³.
        </div>
      </div>

      {onInject && (
        <div className="flex items-center gap-2">
          <label className="text-[10.5px] text-white/50 whitespace-nowrap">Haze days / yr</label>
          <input type="number" min={1} max={180} value={days} onChange={(e) => setDays(Math.max(1, Math.min(180, Number(e.target.value) || 1)))} className="mono w-14 h-7 rounded-[4px] border border-line bg-ink-1 px-1.5 text-[11px] text-white/85" />
          <button onClick={() => onInject(shock)} disabled={!hazy || injected} className="v2-btn !h-7 flex-1 justify-center disabled:opacity-40" data-tour="inject-haze" title={hazy ? "Test the plan against today's haze" : "Air is not hazy today (PSI ≤ 100)"}>
            {injected ? <Check size={12} className="text-signal-300" /> : <Plus size={12} />} {injected ? "Haze injected" : "Inject today's haze"}
          </button>
        </div>
      )}
      <div className="text-[10px] text-white/35 leading-snug">
        <a href={air.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-white/70">{air.source}</a> · {air.updated}
        {air.kind === "model" && " · model estimate, not a station"}
      </div>
    </div>
  );
}
