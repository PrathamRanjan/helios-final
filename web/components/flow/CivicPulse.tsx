"use client";

// "Public pulse" — what residents actually say about this kind of change, from
// the frozen Reddit discourse store. Shows a 0-100 civic score, the sample size,
// and expandable real quotes. Always labelled as a discourse proxy.

import { useState } from "react";
import { ChevronDown, ChevronUp, Users } from "lucide-react";
import { civicFor, type CivicCity } from "@/lib/compass/civic/civicScore";

const TONE: Record<string, string> = {
  supportive: "text-emerald-300",
  mixed: "text-amber-300",
  opposed: "text-rose-300",
};

export default function CivicPulse({
  capabilityIds,
  city = "singapore",
  compact = false,
}: {
  capabilityIds: string[];
  city?: CivicCity;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const civic = civicFor(capabilityIds, city);
  if (!civic) return null;

  const tone = TONE[civic.sentimentWord];

  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/10 px-2.5 py-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2"
      >
        <span className="flex items-center gap-1.5 text-[10.5px] text-white/55">
          <Users size={11} /> Public pulse
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`font-display text-sm ${tone}`}>{civic.civicScore}</span>
          <span className="text-[9px] text-white/35">/100</span>
          {civic.quotes.length > 0 &&
            (open ? <ChevronUp size={11} className="text-white/40" /> : <ChevronDown size={11} className="text-white/40" />)}
        </span>
      </button>
      <div className="mt-0.5 flex items-center justify-between text-[9px] text-white/35">
        <span className={tone}>{civic.sentimentWord}</span>
        <span>n={civic.nPosts} posts · {civic.nComments} comments</span>
      </div>

      {open && civic.quotes.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {civic.quotes.map((q, i) => (
            <a
              key={i}
              href={q.source}
              target="_blank"
              rel="noreferrer"
              className="block text-[10px] text-white/60 leading-snug bg-white/[0.03] rounded-md px-2 py-1.5 hover:bg-white/[0.06]"
            >
              <span className="text-white/30">“</span>
              {q.text}
              <span className="text-white/30">”</span>
            </a>
          ))}
        </div>
      )}

      {!compact && (
        <div className="mt-1.5 text-[8.5px] text-white/30 leading-tight">{civic.label}</div>
      )}
    </div>
  );
}
