"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Sun } from "lucide-react";
import SearchBar from "./SearchBar";
import CountryToggle from "./CountryToggle";
import { COUNTRIES, type CountryCode, type DemoListItem } from "@/types";

interface Props {
  visible: boolean;
  demos: DemoListItem[];
  country: CountryCode;
  onPick: (t: { lat: number; lng: number; address: string }) => void;
  onPickDemo: (slug: string) => void;
  onCountryChange: (c: CountryCode) => void;
}

export default function Hero({ visible, demos, country, onPick, onPickDemo, onCountryChange }: Props) {
  const profile = COUNTRIES.find((c) => c.code === country)!;
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.5 }}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none"
        >
          {/* Sun */}
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
            className="absolute top-[10%] right-[8%] pointer-events-none"
          >
            <div className="relative w-[280px] h-[280px]">
              <div className="absolute inset-0 sun-glow opacity-90" />
              <div className="absolute inset-8 rounded-full bg-gradient-to-br from-solar-100 via-solar-400 to-solar-600 animate-pulse-soft" />
            </div>
          </motion.div>

          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full glass mb-6 pointer-events-auto"
          >
            <Sun className="w-3.5 h-3.5 text-solar-400" />
            <span className="text-[11px] tracking-[0.18em] uppercase text-white/65 font-medium">
              Solar intelligence for Southeast Asia
            </span>
          </motion.div>

          <motion.h1
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.25 }}
            className="text-center font-display text-[88px] leading-[0.95] tracking-[-0.02em] text-black mb-4 max-w-[10ch]"
          >
            Scan any rooftop in{" "}
            <span className="text-black italic">one click.</span>
          </motion.h1>

          <motion.p
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.35 }}
            className="text-center text-white/55 text-[17px] max-w-[50ch] mb-10 leading-relaxed"
          >
            HELIO Scout turns any rooftop into a 60-second solar pre-feasibility
            report — combining verified geospatial solar data where available
            with AI-assisted estimation and transparent confidence bands where
            data is missing.
          </motion.p>

          <motion.div
            initial={{ y: 14, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.55, delay: 0.45 }}
            className="pointer-events-auto mb-4"
          >
            <CountryToggle value={country} onChange={onCountryChange} />
          </motion.div>

          <motion.div
            initial={{ y: 14, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.55 }}
            className="pointer-events-auto"
          >
            <SearchBar onPick={onPick} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.65 }}
            className="mt-3 text-[11px] text-white/40"
          >
            {profile.solarApiCoverage === "real" ? (
              <span>
                <span className="text-emerald-400">●</span> Google Solar API covers {profile.label} — real per-panel data
              </span>
            ) : (
              <span>
                <span className="text-solar-400">●</span> Solar API has no coverage in {profile.label} — using Gemini Vision on satellite imagery
              </span>
            )}
          </motion.div>

          {/* Demo chips */}
          {demos.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.7 }}
              className="mt-6 flex items-center gap-2 pointer-events-auto flex-wrap justify-center max-w-[600px]"
            >
              <span className="text-[11px] uppercase tracking-[0.12em] text-white/35 mr-2">
                Try a demo:
              </span>
              {demos.map((d) => (
                <button
                  key={d.slug}
                  onClick={() => onPickDemo(d.slug)}
                  className="group flex items-center gap-1.5 px-3.5 py-2 rounded-full glass hover:bg-white/[0.06] transition-colors text-[12.5px] text-white/80"
                >
                  <span>{d.address.split(",")[0]}</span>
                  <ArrowRight className="w-3 h-3 opacity-50 group-hover:translate-x-0.5 transition-transform" />
                </button>
              ))}
            </motion.div>
          )}

          {/* Footer */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.9 }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-5 text-[10.5px] uppercase tracking-[0.15em] text-white/35"
          >
            <span>Google Solar API</span>
            <span className="w-1 h-1 rounded-full bg-white/20" />
            <span>Photorealistic 3D Tiles</span>
            <span className="w-1 h-1 rounded-full bg-white/20" />
            <span>Gemini 2.5 Flash</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}