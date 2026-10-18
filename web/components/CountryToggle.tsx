"use client";

import { COUNTRIES, type CountryCode } from "@/types";
import { motion } from "framer-motion";

interface Props {
  value: CountryCode;
  onChange: (c: CountryCode) => void;
  compact?: boolean;
}

export default function CountryToggle({ value, onChange, compact = false }: Props) {
  return (
    <div className={`flex items-center gap-1 p-1 rounded-2xl glass ${compact ? "" : "shadow-panel"}`}>
      {COUNTRIES.map((c) => {
        const active = c.code === value;
        return (
          <button
            key={c.code}
            onClick={() => onChange(c.code)}
            className={`relative px-3 py-1.5 rounded-xl text-[12px] font-medium transition-colors ${
              active ? "text-white" : "text-white/55 hover:text-white/85"
            }`}
            title={`${c.label} · ${c.solarApiCoverage === "real" ? "Google Solar API coverage" : "AI vision (no Solar API)"}`}
          >
            {active && (
              <motion.div
                layoutId="country-pill"
                className="absolute inset-0 rounded-xl bg-gradient-to-br from-solar-400/30 to-solar-600/15 border border-solar-400/30"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              <span className="text-[13px]">{c.flag}</span>
              <span>{c.code}</span>
              <span
                className={`w-1 h-1 rounded-full ${
                  c.solarApiCoverage === "real" ? "bg-emerald-400" : "bg-solar-400"
                }`}
                title={c.solarApiCoverage === "real" ? "Solar API" : "Vision"}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}