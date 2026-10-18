"use client";

// Island-level inspector: before you pick an area, "where should Singapore act first?"
// Census screening lenses rank all populated planning areas; picking one flies the
// world camera there and opens its workspace.

import { useMemo, useState } from "react";
import Link from "next/link";
import { MousePointerClick, Unlock, ArrowUpRight } from "lucide-react";
import { CAPABILITIES, DATASETS } from "@/lib/compass/openStack";
import HazePanel from "@/components/v2/HazePanel";
import { Label, Stat, ConfChip, Segmented, fmtInt, fmtPct } from "@/components/v2/ui";
import { POPULATED_AREAS, screening, type Area } from "@/lib/compass/areas";

type Lens = "car" | "seniors" | "transit" | "residents";

export default function IslandPanel({ onPick }: { onPick: (a: Area) => void }) {
  const [lens, setLens] = useState<Lens>("car");
  const raw = (a: Area): number | null => {
    if (lens === "car") return a.car_share == null ? null : screening(a).carCommuters;
    if (lens === "seniors") return a.share_65_plus == null ? null : screening(a).seniors;
    if (lens === "transit") return a.pt_share == null ? null : 1 - a.pt_share;
    return a.population ?? null;
  };
  const ranked = useMemo(() => [...POPULATED_AREAS].sort((x, y) => (raw(y) ?? -1) - (raw(x) ?? -1)), [lens]); // eslint-disable-line react-hooks/exhaustive-deps
  const max = Math.max(1e-9, ...ranked.map((a) => raw(a) ?? 0));
  const fmt = (a: Area) => (raw(a) == null ? "n/a" : lens === "transit" ? fmtPct(raw(a)) : fmtInt(raw(a)));
  const pop = POPULATED_AREAS.reduce((s, a) => s + (a.population ?? 0), 0);
  const car = POPULATED_AREAS.reduce((s, a) => s + screening(a).carCommuters, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Residents" value={`${(pop / 1e6).toFixed(2)}M`} />
        <Stat label="Car commuters" value={`${(car / 1000).toFixed(0)}k`} tone="warn" />
        <Stat label="Areas" value="55" />
      </div>
      <Link href="/sg/open" className="block rounded-[4px] border border-signal-400/30 bg-signal-400/[0.06] p-3 hover:bg-signal-400/[0.1] transition-colors">
        <div className="flex items-center gap-1.5 text-[12.5px] text-white">
          <Unlock size={13} className="text-signal-300" /> The open sustainability stack
          <ArrowUpRight size={12} className="ml-auto text-signal-300" />
        </div>
        <p className="text-[11.5px] text-white/60 mt-1 leading-snug">
          Nature risk, carbon accounting, taxonomy compliance, physical risk and solar feasibility usually cost thousands a year per product. HELIOS rebuilds {CAPABILITIES.length} of them from {Object.keys(DATASETS).length} open sources, with every number cited.
        </p>
      </Link>
      <HazePanel city="singapore" startYear={2026} />
      <div className="flex items-start gap-2 rounded-[4px] border border-signal-400/25 bg-signal-400/[0.05] p-2.5 text-[11.5px] text-white/70 leading-snug">
        <MousePointerClick size={14} className="text-signal-300 mt-0.5 shrink-0" />
        Click any building to ask what-if questions about it, or pick an area below to fly in, draw changes and simulate 2026–2036.
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>Where should Singapore act first?</Label>
          <ConfChip conf="screening estimate" />
        </div>
        <Segmented<Lens>
          size="xs"
          value={lens}
          onChange={setLens}
          options={[
            { id: "car", label: "Car commuters" },
            { id: "seniors", label: "Seniors 65+" },
            { id: "transit", label: "Transit gap" },
            { id: "residents", label: "Residents" },
          ]}
        />
      </div>
      <div className="-mx-4">
        {ranked.map((a, i) => (
          <button key={a.id} onClick={() => onPick(a)} className="w-full text-left px-4 py-1.5 border-b border-line/60 hover:bg-white/[0.03]">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <span className="mono text-[10px] text-white/30 w-5">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-[12px] text-white/85 truncate">{a.name}</span>
                {a.simulation === "ready" && <span className="v2-led text-signal-300" title="simulation ready" style={{ width: 5, height: 5 }} />}
              </span>
              <span className="mono text-[11px] text-white/65">{fmt(a)}</span>
            </div>
            <div className="ml-7 mt-1 h-[2px] rounded bg-white/[0.05] overflow-hidden">
              <div className="h-full bg-signal-400/70" style={{ width: `${((raw(a) ?? 0) / max) * 100}%` }} />
            </div>
          </button>
        ))}
      </div>
      <div className="text-[10px] text-white/30">Census GHS 2025 · n/a = suppressed by the census for small areas</div>
    </div>
  );
}
