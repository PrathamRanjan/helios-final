"use client";

// HELIOS V2 component kit — small, composable, token-driven. Everything new in
// V2 builds on these instead of ad-hoc Tailwind per panel.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Search, ChevronRight, Command } from "lucide-react";
import { AREAS, type Area } from "@/lib/compass/areas";

export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`v2-label ${className}`}>{children}</div>;
}

export function Panel({ children, className = "", ticks = false }: { children: ReactNode; className?: string; ticks?: boolean }) {
  return <div className={`v2-panel ${ticks ? "v2-ticks" : ""} ${className}`}>{children}</div>;
}

export function Stat({ label, value, unit, sub, tone = "default" }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; tone?: "default" | "signal" | "warn" | "risk" }) {
  const color = tone === "signal" ? "text-signal-300" : tone === "warn" ? "text-warn-400" : tone === "risk" ? "text-risk-400" : "text-white";
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <div className={`mono text-[20px] leading-tight mt-1 ${color}`}>
        {value}
        {unit && <span className="text-[11px] text-white/40 ml-1">{unit}</span>}
      </div>
      {sub && <div className="text-[10.5px] text-white/40 mt-0.5">{sub}</div>}
    </div>
  );
}

export type Conf = "measured" | "literature-derived" | "calibrated proxy" | "speculative" | "policy pathway" | "screening estimate" | "not built";

const CONF_TONE: Record<string, string> = {
  measured: "text-signal-300 border-signal-400/30",
  "literature-derived": "text-sky-300 border-sky-400/30",
  "calibrated proxy": "text-warn-300 border-warn-400/30",
  "screening estimate": "text-warn-300 border-warn-400/30",
  speculative: "text-risk-300 border-risk-400/30",
  "policy pathway": "text-violet-300 border-violet-400/30",
  "not built": "text-white/40 border-white/15",
};

export function ConfChip({ conf }: { conf: Conf }) {
  return <span className={`mono inline-flex items-center rounded-[3px] border px-1.5 py-[1px] text-[9.5px] uppercase tracking-wider ${CONF_TONE[conf] ?? CONF_TONE["not built"]}`}>{conf}</span>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; icon?: any; badge?: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex items-stretch border-b border-line">
      {tabs.map((t) => {
        const Icon = t.icon;
        const on = t.id === value;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`relative flex-1 flex items-center justify-center gap-1.5 h-10 text-[11.5px] transition-colors ${on ? "text-white" : "text-white/45 hover:text-white/80"}`}
          >
            {Icon && <Icon size={13} className={on ? "text-signal-300" : ""} />}
            {t.label}
            {t.badge}
            {on && <span className="absolute left-2 right-2 -bottom-px h-px bg-signal-300" />}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, size = "sm" }: { options: { id: T; label: string; title?: string }[]; value: T; onChange: (v: T) => void; size?: "sm" | "xs" }) {
  return (
    <div className="inline-flex rounded-[4px] border border-line p-0.5 bg-ink-1/60">
      {options.map((o) => (
        <button
          key={o.id}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={`rounded-[3px] ${size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]"} transition-colors ${value === o.id ? "bg-white/10 text-white" : "text-white/45 hover:text-white/80"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="mono rounded-[3px] border border-line bg-ink-2 px-1 text-[10px] text-white/50">{children}</kbd>;
}

export function Wordmark() {
  return (
    <Link href="/sg" className="flex items-center gap-2 shrink-0">
      <span className="relative inline-flex h-5 w-5 items-center justify-center">
        <span className="absolute inset-0 rounded-full border border-signal-300/60" />
        <span className="h-1.5 w-1.5 rounded-full bg-signal-300 shadow-[0_0_10px_#5eead4]" />
      </span>
      <span className="mono text-[13px] tracking-[0.22em] text-white">HELIOS</span>
      <span className="mono text-[9.5px] rounded-[3px] border border-signal-400/40 px-1 text-signal-300">V2</span>
    </Link>
  );
}

/** Breadcrumb + area switcher: Singapore › Region › Area, with ⌘K search across all 55 areas. */
export function AreaSwitcher({ current, onPick }: { current?: Area; onPick: (a: Area) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = AREAS.filter((a) => (a.population ?? 0) > 0 || a.simulation === "ready");
    return s ? list.filter((a) => a.name.toLowerCase().includes(s) || a.region.toLowerCase().includes(s)) : list;
  }, [q]);

  return (
    <>
      <div className="flex items-center gap-1.5 text-[12px] min-w-0">
        <Link href="/sg" className="text-white/50 hover:text-white">Singapore</Link>
        {current && (
          <>
            <ChevronRight size={12} className="text-white/25" />
            <span className="text-white/40 hidden xl:inline whitespace-nowrap">{current.region}</span>
            <ChevronRight size={12} className="text-white/25 hidden xl:inline" />
          </>
        )}
        <button onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-[4px] border border-line px-2 h-7 hover:border-white/20 shrink-0 whitespace-nowrap">
          <span className="truncate text-white">{current ? current.name : "Find a planning area"}</span>
          <span className="hidden sm:inline-flex items-center gap-0.5 text-white/35"><Command size={10} />K</span>
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/55 pt-[12vh] px-4" onClick={() => setOpen(false)}>
          <div className="v2-panel v2-ticks w-full max-w-[520px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-line px-3 h-11">
              <Search size={14} className="text-white/40" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") setIdx((i) => Math.min(i + 1, results.length - 1));
                  if (e.key === "ArrowUp") setIdx((i) => Math.max(i - 1, 0));
                  if (e.key === "Enter" && results[idx]) {
                    onPick(results[idx]);
                    setOpen(false);
                  }
                }}
                placeholder="Search 55 planning areas…"
                className="flex-1 bg-transparent text-[13px] text-white placeholder:text-white/30 outline-none"
              />
              <Kbd>esc</Kbd>
            </div>
            <div className="max-h-[50vh] overflow-y-auto v2-scroll py-1">
              {results.map((a, i) => (
                <button
                  key={a.id}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => {
                    onPick(a);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left ${i === idx ? "bg-white/[0.05]" : ""}`}
                >
                  <span>
                    <span className="text-[13px] text-white">{a.name}</span>
                    <span className="text-[11px] text-white/35 ml-2">{a.region}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {a.population ? <span className="mono text-[10.5px] text-white/40">{(a.population / 1000).toFixed(0)}k ppl</span> : null}
                    <SimStatus area={a} />
                  </span>
                </button>
              ))}
              {!results.length && <div className="px-3 py-6 text-center text-[12px] text-white/40">No planning area matches “{q}”.</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function SimStatus({ area }: { area: Area }) {
  const s = area.simulation;
  const tone = s === "ready" ? "text-signal-300" : s === "osm_only" ? "text-warn-400" : "text-white/30";
  const label = s === "ready" ? "simulation ready" : s === "osm_only" ? "3D city · sim pending" : "pending";
  return (
    <span className={`mono inline-flex items-center gap-1.5 text-[9.5px] uppercase tracking-wider ${tone}`}>
      <span className="v2-led" style={{ width: 5, height: 5 }} />
      {label}
    </span>
  );
}

export const fmtInt = (n: number | undefined | null) => (n == null ? "—" : Math.round(n).toLocaleString("en-SG"));
export const fmtPct = (n: number | undefined | null, d = 0) => (n == null ? "—" : `${(n * 100).toFixed(d)}%`);
