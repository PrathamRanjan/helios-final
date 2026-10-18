"use client";

// Baseline diagnosis: the district's measured state + HELIO-detected problems.
// This is the "insight" step — each detected corridor is an invitation to act
// (draw shade/cycling there), not a chart to stare at.

import { useState } from "react";
import { ChevronDown, ChevronUp, Flame } from "lucide-react";
import type { DetectedCorridor } from "./FlowMap";

export interface BaselineDiagnosis {
  districtId: string;
  baselineCO2Tpy: number;
  modeShare: Record<string, number>;
  totalDailyTrips: number;
  corridors: number;
  nodes: { mrt_stations: number; bus_stops: number };
  solar: { readyBuildings: number; totalKwp: number; annualKWh: number };
  detected: DetectedCorridor[];
  sources: string;
}

const MODE_LABEL: Record<string, string> = {
  car: "Car",
  bus: "Bus",
  mrt: "MRT",
  walk: "Walk",
  cycle: "Cycle",
};

interface Props {
  diagnosis: BaselineDiagnosis;
  onHoverCorridor: (id: string | null) => void;
}

export default function DiagnosisPanel({ diagnosis, onHoverCorridor }: Props) {
  const [open, setOpen] = useState(true);
  const d = diagnosis;

  return (
    <div className="glass rounded-2xl w-[290px] shadow-panel">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3.5 py-2.5"
      >
        <span className="font-display text-sm text-white">Baseline · {d.districtId.replace("_", " ")}</span>
        {open ? <ChevronUp size={13} className="text-white/40" /> : <ChevronDown size={13} className="text-white/40" />}
      </button>

      {open && (
        <div className="px-3.5 pb-3.5">
          <div className="grid grid-cols-2 gap-1.5 text-[10.5px]">
            <Stat label="Transport CO₂" value={`${d.baselineCO2Tpy.toLocaleString()} t/yr`} />
            <Stat label="Daily trips" value={d.totalDailyTrips.toLocaleString()} />
            <Stat label="Corridors (real OD)" value={d.corridors.toLocaleString()} />
            <Stat
              label="Solar-ready roofs"
              value={`${d.solar.readyBuildings} · ${(d.solar.totalKwp / 1000).toFixed(1)} MWp`}
            />
          </div>

          {/* Mode split mini-bars (illustrative calibrated reallocation). */}
          <div className="mt-2.5">
            <div className="text-[9.5px] uppercase tracking-wide text-white/40 mb-1">Mode split (modelled)</div>
            {Object.entries(d.modeShare).map(([m, v]) => (
              <div key={m} className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[9.5px] text-white/50 w-8">{MODE_LABEL[m] ?? m}</span>
                <div className="flex-1 h-1.5 bg-white/5 rounded overflow-hidden">
                  <div className="h-full rounded bg-white/35" style={{ width: `${v * 100}%` }} />
                </div>
                <span className="text-[9.5px] text-white/55 w-8 text-right">{(v * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>

          {/* Detected problems → the planner's starting moves. */}
          <div className="mt-2.5">
            <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-wide text-rose-300/80 mb-1">
              <Flame size={10} /> Heat-exposed, high-demand corridors
            </div>
            <div className="space-y-1">
              {d.detected.map((c, i) => (
                <div
                  key={c.id}
                  onMouseEnter={() => onHoverCorridor(c.id)}
                  onMouseLeave={() => onHoverCorridor(null)}
                  className="bg-white/[0.04] hover:bg-rose-400/10 rounded-md px-2 py-1.5 cursor-default transition-colors"
                >
                  <div className="text-[10px] text-white/75 leading-tight">
                    {i + 1}. {c.from} → {c.to}
                  </div>
                  <div className="text-[9px] text-white/40">
                    {c.tripsPerDay.toLocaleString()} trips/day · {c.distKm.toFixed(1)} km exposed
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[9px] text-white/35 mt-1.5 leading-snug">
              Draw a shaded corridor over one of these — agents will react.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/[0.04] rounded-lg px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="text-[11px] text-white/85 mt-0.5">{value}</div>
    </div>
  );
}
