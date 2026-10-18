"use client";

// Compliance badges on an intervention — taxonomy class, Green Mark effect, EV Charging
// Act status — from the deterministic engine (lib/compass/compliance/policy.ts).

import type { Badge } from "@/lib/compass/compliance/policy";

const TONE: Record<Badge["tone"], string> = {
  good: "border-signal-400/40 text-signal-300 bg-signal-400/[0.07]",
  warn: "border-warn-400/40 text-warn-300 bg-warn-400/[0.07]",
  bad: "border-risk-400/40 text-risk-300 bg-risk-400/[0.07]",
  info: "border-line text-white/50 bg-white/[0.03]",
};

export default function Badges({ badges, className = "" }: { badges: Badge[]; className?: string }) {
  if (!badges.length) return null;
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {badges.map((b) => (
        <span key={b.key} title={b.detail} className={`mono inline-flex items-center rounded-[3px] border px-1.5 py-[1px] text-[9.5px] tracking-wide cursor-help ${TONE[b.tone]}`}>
          {b.label}
        </span>
      ))}
    </div>
  );
}
