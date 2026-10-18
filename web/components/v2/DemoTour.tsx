"use client";

// Guided demo tours that drive the real app: each step can run an action first (fly the
// camera, open a tab, inject today's haze), then spotlights an element and explains it.
// One engine, three city scripts (Singapore, Bangkok, India) — see the pages for steps.

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PlayCircle, X, ChevronLeft, ChevronRight } from "lucide-react";

export interface DemoStep {
  /** CSS selector to spotlight (omit for a centred card). */
  element?: string;
  title: string;
  body: string;
  /** Runs before the step is shown (navigate, open a tab, start a simulation…). */
  before?: () => void | Promise<void>;
  /** ms to wait after `before` so the UI settles (camera flights, data loads). */
  wait?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function useRect(selector: string | undefined, tick: number) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!selector) {
      setRect(null);
      return;
    }
    let raf = 0;
    const measure = () => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (el) {
        const r = el.getBoundingClientRect();
        setRect(r.width && r.height ? r : null);
      } else setRect(null);
      raf = requestAnimationFrame(measure);
    };
    const el = document.querySelector(selector) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    measure();
    return () => cancelAnimationFrame(raf);
  }, [selector, tick]);
  return rect;
}

export default function DemoTour({ steps, label = "Demo", storageKey, autoStart = false, className = "" }: { steps: DemoStep[]; label?: string; storageKey: string; autoStart?: boolean; className?: string }) {
  const [i, setI] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const go = useCallback(
    async (n: number) => {
      if (n < 0 || n >= steps.length) {
        setI(null);
        return;
      }
      setBusy(true);
      try {
        await steps[n].before?.();
        if (steps[n].wait) await sleep(steps[n].wait!);
      } catch {}
      setI(n);
      setTick((t) => t + 1);
      setBusy(false);
    },
    [steps]
  );

  useEffect(() => {
    if (!autoStart) return;
    try {
      if (localStorage.getItem(storageKey)) return;
      localStorage.setItem(storageKey, "1");
    } catch {}
    const t = setTimeout(() => go(0), 1200);
    return () => clearTimeout(t);
  }, [autoStart, storageKey, go]);

  useEffect(() => {
    if (i == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setI(null);
      if (e.key === "ArrowRight" && !busy) go(i + 1);
      if (e.key === "ArrowLeft" && !busy) go(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, busy, go]);

  const step = i != null ? steps[i] : null;
  const rect = useRect(step?.element, tick);
  const pad = 6;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const cardW = Math.min(340, vw - 32);
  let cardStyle: React.CSSProperties = { left: (vw - cardW) / 2, top: vh / 2 - 110 };
  if (rect) {
    const spaceRight = vw - rect.right;
    const left = spaceRight > cardW + 24 ? rect.right + 14 : rect.left > cardW + 24 ? rect.left - cardW - 14 : Math.max(16, Math.min(vw - cardW - 16, rect.left));
    const top = spaceRight > cardW + 24 || rect.left > cardW + 24 ? Math.max(16, Math.min(vh - 240, rect.top)) : rect.bottom + 14 < vh - 220 ? rect.bottom + 14 : Math.max(16, rect.top - 230);
    cardStyle = { left, top };
  }

  return (
    <>
      <button onClick={() => go(0)} disabled={busy} className={`v2-btn ${className}`} data-tour="demo-button" title={`Guided ${label.toLowerCase()} — drives the app for you`}>
        <PlayCircle size={13} className="text-signal-300" /> {label}
      </button>
      {mounted &&
        step &&
        createPortal(
          <div className="fixed inset-0 z-[1000] pointer-events-none">
            {rect ? (
              <div
                className="absolute rounded-[6px] transition-all duration-300"
                style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: "0 0 0 9999px rgba(3,6,10,0.62), 0 0 0 2px #5eead4, 0 0 24px rgba(94,234,212,0.35)" }}
              />
            ) : (
              <div className="absolute inset-0 bg-[rgba(3,6,10,0.55)]" />
            )}
            <div className="v2 absolute pointer-events-auto v2-panel v2-ticks p-4 shadow-2xl transition-all duration-300" style={{ ...cardStyle, width: cardW }} role="dialog" aria-label={step.title}>
              <div className="flex items-center justify-between gap-2">
                <span className="mono text-[9.5px] uppercase tracking-[0.16em] text-signal-300">
                  {label} · {i! + 1}/{steps.length}
                </span>
                <button onClick={() => setI(null)} className="text-white/40 hover:text-white" aria-label="Close tour">
                  <X size={14} />
                </button>
              </div>
              <div className="text-[15px] text-white mt-1.5">{step.title}</div>
              <p className="text-[12.5px] text-white/70 mt-1.5 leading-relaxed" dangerouslySetInnerHTML={{ __html: step.body }} />
              <div className="flex items-center justify-between mt-3.5">
                <button onClick={() => go(i! - 1)} disabled={busy || i === 0} className="v2-btn !h-7 disabled:opacity-30">
                  <ChevronLeft size={13} /> Back
                </button>
                <div className="h-1 flex-1 mx-3 rounded bg-white/10 overflow-hidden">
                  <div className="h-full bg-signal-400 transition-all" style={{ width: `${((i! + 1) / steps.length) * 100}%` }} />
                </div>
                <button onClick={() => go(i! + 1)} disabled={busy} className="v2-btn-primary !h-7">
                  {busy ? "…" : i === steps.length - 1 ? "Finish" : "Next"} {i !== steps.length - 1 && <ChevronRight size={13} />}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
