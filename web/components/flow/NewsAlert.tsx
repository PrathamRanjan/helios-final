"use client";

// The News / Event Agent, surfaced. A scripted live-events feed that pushes a
// real shock into the running world. (Feed is mock for now — the injection it
// triggers is the real shock engine.) Appears once after onboarding; a 📡 pill
// re-opens it. onApply hands a shock preset + year up to the page.

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Radio, X, Zap } from "lucide-react";

export interface NewsEvent {
  id: string;
  tag: string;
  headline: string;
  detail: string;
  presetId: string; // maps to a SHOCK_PRESET
  year: number;
}

const EVENTS: NewsEvent[] = [
  {
    id: "mrt",
    tag: "TRANSPORT",
    headline: "MRT Circle Line loop closes this weekend",
    detail: "The yellow-line loop connects two long-missing links — rail journeys get ~18% faster on affected corridors. Expect a jump in MRT usage.",
    presetId: "mrt_loop",
    year: 2026,
  },
  {
    id: "oil",
    tag: "ENERGY",
    headline: "Oil price spikes 40% on Hormuz tension",
    detail: "Sustained fuel-cost shock makes driving materially dearer for ~3 years — a live stress test for your plan.",
    presetId: "oil",
    year: 2028,
  },
];

export default function NewsAlert({ onApply, inline = false }: { onApply: (presetId: string, year: number) => void; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [applied, setApplied] = useState(false);

  // Auto-surface once, after the tour has had its moment.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem("helio-news-seen")) return;
    const t = setTimeout(() => {
      setOpen(true);
      localStorage.setItem("helio-news-seen", "1");
    }, 6500);
    return () => clearTimeout(t);
  }, []);

  const ev = EVENTS[idx];

  const apply = () => {
    onApply(ev.presetId, ev.year);
    setApplied(true);
    setTimeout(() => {
      setApplied(false);
      if (idx < EVENTS.length - 1) setIdx(idx + 1);
      else setOpen(false);
    }, 1400);
  };

  return (
    <>
      <button
        onClick={() => { setOpen(true); setApplied(false); }}
        title="Live events feed"
        className={inline ? "v2-btn" : "fixed bottom-[68px] right-5 z-50 flex items-center gap-1.5 rounded-full glass px-3.5 py-2 text-[12px] text-white/80 hover:text-white transition-colors shadow-panel"}
      >
        <Radio size={15} className="text-rose-300" />
        Live feed
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
            className="fixed top-5 left-1/2 -translate-x-1/2 z-[65] w-[420px] max-w-[92vw] glass-strong rounded-2xl shadow-panel border border-rose-400/25 overflow-hidden"
          >
            <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 bg-rose-400/10">
              <Radio size={13} className="text-rose-300 animate-pulse" />
              <span className="text-[10px] uppercase tracking-widest text-rose-200">News Agent · live event</span>
              <span className="ml-auto text-[9px] text-white/35">{idx + 1}/{EVENTS.length}</span>
              <button onClick={() => setOpen(false)} className="text-white/45 hover:text-white"><X size={14} /></button>
            </div>
            <div className="p-4">
              <div className="text-[9px] uppercase tracking-wide text-white/40">{ev.tag}</div>
              <div className="font-display text-[15px] text-white leading-tight mt-0.5">{ev.headline}</div>
              <p className="text-[11.5px] text-white/60 leading-snug mt-2">{ev.detail}</p>
              {applied ? (
                <div className="mt-3 text-[12px] text-emerald-300 flex items-center gap-1.5">
                  <Zap size={13} /> Injected into {ev.year} — re-simulating the world…
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={apply}
                    className="flex items-center gap-1.5 rounded-lg bg-rose-400/90 hover:bg-rose-400 text-black px-3 py-1.5 text-[11.5px] font-medium"
                  >
                    <Zap size={13} /> Apply to {ev.year}
                  </button>
                  <button onClick={() => setOpen(false)} className="text-white/50 hover:text-white text-[11.5px] px-2">Not now</button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
