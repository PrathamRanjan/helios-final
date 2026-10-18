"use client";

// Shared "back to the ASEAN hub" control, used on every city module
// (/helio-flow, /hanoi, /bangkok) so a planner can always return to Mission
// Control and switch cities. Links to "/" — the Mission Control globe page.

import Link from "next/link";
import { ArrowLeft, Globe2 } from "lucide-react";

export default function BackToMissionControl({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      title="Back to ASEAN Mission Control"
      className={`glass rounded-full pl-2.5 pr-3 py-1.5 flex items-center gap-1.5 text-[11px] text-white/70 hover:text-white transition-colors w-fit ${className}`}
    >
      <ArrowLeft size={12} />
      <Globe2 size={12} className="text-solar-400" />
      <span className="font-medium">Mission Control</span>
    </Link>
  );
}
