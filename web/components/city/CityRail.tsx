"use client";

// The persistent in-module city switcher. Shows the 3 ASEAN cities with the
// current one highlighted; clicking another triggers the globe swoop (via
// CityTransitionProvider) that flies out to orbit and lands in that module.

import { CITIES } from "@/lib/cities";
import { useCityTransition } from "./CityTransitionProvider";

export default function CityRail({ current, className = "" }: { current: string; className?: string }) {
  const { goToCity, transitioning } = useCityTransition();
  return (
    <div className={`glass rounded-full flex items-center gap-0.5 p-1 w-fit max-w-full flex-wrap ${className}`}>
      {CITIES.map((c) => {
        const active = c.code === current;
        return (
          <button
            key={c.code}
            disabled={active || transitioning}
            onClick={() => goToCity(current, c.code)}
            title={active ? `You are here: ${c.label}` : `Fly to ${c.label}`}
            className={`px-2.5 py-1 rounded-full text-[11px] flex items-center gap-1.5 transition-colors ${
              active ? "bg-white/10 text-white" : "text-white/55 hover:text-white"
            } ${transitioning && !active ? "opacity-40" : ""}`}
          >
            <span>{c.flag}</span>
            <span className="font-medium">{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}
