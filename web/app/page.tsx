"use client";

// HELIO — Mission Control connects city models and the India solar hub.
// The Google 3D globe flies between destinations with a cinematic swoop,
// then hands off into each city's specialised module. This is the demo's spine.

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Globe2 } from "lucide-react";
import MissionControlGlobe from "@/components/MissionControlGlobe";
import { CITIES } from "@/lib/cities";

export default function MissionControl() {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = CITIES[activeIndex];

  const selectCity = (i: number) => {
    if (i === activeIndex) return;
    setActiveIndex(i);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg grain">
      <MissionControlGlobe
        cities={CITIES}
        activeIndex={activeIndex}
      />

      {/* Brand */}
      <div className="absolute top-6 left-6 z-30 pointer-events-none">
        <div className="flex items-center gap-2">
          <Globe2 className="w-5 h-5 text-solar-400" />
          <span className="font-display text-lg text-solar-gradient leading-none">HELIO</span>
        </div>
        <div className="text-white/55 text-[12px] mt-1">Mission Control</div>
        <div className="text-white/35 text-[11px] mt-0.5 max-w-[240px]">
          Across Asia · local evidence · better climate decisions
        </div>
      </div>

      {/* Entry stays available while the globe loads or reports an error. */}
      <div className="absolute top-28 left-4 right-4 z-30 sm:top-6 sm:left-auto sm:right-6 sm:w-[340px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={active.code}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            className="glass rounded-2xl p-4 shadow-panel"
          >
            <div className="flex items-center gap-2">
              <span className="text-xl">{active.flag}</span>
              <div>
                <div className="font-display text-base text-white leading-none">{active.label}</div>
                <div className={`text-[11px] ${active.accent} mt-0.5`}>{active.lever}</div>
              </div>
            </div>
            <p className="text-[12px] text-white/70 mt-3 leading-snug">{active.hook}</p>
            <div className="text-[10.5px] text-white/40 mt-2 leading-snug">✓ {active.proves}</div>
            <AnimatePresence>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
                  <Link
                    href={active.route}
                    className="mt-3 w-full flex items-center justify-center gap-1.5 rounded-lg bg-solar-400/90 hover:bg-solar-400 py-2 text-[12px] font-medium text-black transition-colors"
                  >
                    {active.code === "IN" ? "Explore India cities" : `Enter ${active.label} model`} <ArrowRight size={14} />
                  </Link>
                </motion.div>
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* City rail */}
      <div className="absolute bottom-6 left-4 right-4 z-30 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-max sm:max-w-[calc(100vw-2rem)]">
        <div className="grid grid-cols-2 sm:flex overflow-x-auto items-center gap-2 p-1.5 rounded-2xl glass shadow-panel">
          {CITIES.map((c, i) => {
            const isActive = i === activeIndex;
            return (
              <button
                key={c.code}
                onClick={() => selectCity(i)}
                aria-pressed={isActive}
                className={`relative shrink-0 px-4 py-2.5 rounded-xl text-left transition-colors ${isActive ? "text-white" : "text-white/55 hover:text-white/85"}`}
              >
                {isActive && (
                  <motion.div
                    layoutId="city-pill"
                    className="absolute inset-0 rounded-xl bg-gradient-to-br from-solar-400/25 to-solar-600/10 border border-solar-400/30"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <span className="relative flex items-center gap-2">
                  <span className="text-base">{c.flag}</span>
                  <span className="flex flex-col leading-tight">
                    <span className="text-[13px] font-medium">{c.label}</span>
                    <span className={`text-[10px] ${isActive ? c.accent : "text-white/40"}`}>{c.lever}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="pointer-events-none absolute inset-0 z-[2]"
        style={{ background: "radial-gradient(circle at 50% 45%, transparent 55%, rgba(0,0,0,0.5) 100%)" }}
      />
    </div>
  );
}
