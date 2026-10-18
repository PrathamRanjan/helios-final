"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface Props {
  label: string;
  value: number;
  unit?: string;
  prefix?: string;
  precision?: number;
  delay?: number;
  accent?: "solar" | "white" | "green";
  icon?: React.ReactNode;
  hint?: string;
}

function useCountUp(target: number, durationMs = 1100, delayMs = 0) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    let started = false;
    let startTime = 0;
    const timeout = setTimeout(() => {
      started = true;
      const tick = (t: number) => {
        if (!startTime) startTime = t;
        const p = Math.min(1, (t - startTime) / durationMs);
        const eased = 1 - Math.pow(1 - p, 3);
        setV(target * eased);
        if (p < 1) raf = requestAnimationFrame(tick);
        else setV(target);
      };
      raf = requestAnimationFrame(tick);
    }, delayMs);
    return () => {
      clearTimeout(timeout);
      if (raf) cancelAnimationFrame(raf);
      if (!started) setV(0);
    };
  }, [target, durationMs, delayMs]);
  return v;
}

function fmt(n: number, precision: number) {
  if (Math.abs(n) >= 1_000_000)
    return (n / 1_000_000).toFixed(precision || 2) + "M";
  if (Math.abs(n) >= 10_000)
    return (n / 1000).toFixed(precision || 1) + "k";
  if (precision === 0) return Math.round(n).toLocaleString();
  return n.toLocaleString(undefined, {
    maximumFractionDigits: precision,
    minimumFractionDigits: 0,
  });
}

export default function StatCard({
  label,
  value,
  unit,
  prefix,
  precision = 0,
  delay = 0,
  accent = "white",
  icon,
  hint,
}: Props) {
  const v = useCountUp(value, 1200, delay);
  const accentColor =
    accent === "solar"
      ? "text-solar-200"
      : accent === "green"
        ? "text-emerald-300"
        : "text-white";
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: delay / 1000 }}
      className="relative rounded-2xl glass px-4 py-3.5 overflow-hidden group"
    >
      <div className="flex items-start justify-between mb-1.5">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-white/45 font-medium">
          {label}
        </div>
        {icon && <div className="text-white/40">{icon}</div>}
      </div>
      <div className={`stat-num text-[26px] leading-none ${accentColor}`}>
        {prefix}
        {fmt(v, precision)}
        {unit && (
          <span className="text-[13px] ml-1 text-white/40 font-normal">
            {unit}
          </span>
        )}
      </div>
      {hint && (
        <div className="mt-1.5 text-[10.5px] text-white/35">{hint}</div>
      )}
      <div className="pointer-events-none absolute -right-8 -top-8 w-24 h-24 sun-glow opacity-0 group-hover:opacity-50 transition-opacity" />
    </motion.div>
  );
}