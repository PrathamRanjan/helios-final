"use client";

// The strip every capability panel carries: what paid product this replaces, what it
// costs there, and the open data it is built from here. Purpose, not marketing copy:
// it reads data/open_stack.json, the same file the Open Stack page renders.

import { useState } from "react";
import Link from "next/link";
import { Unlock, ChevronDown } from "lucide-react";
import { capability, DATASETS } from "@/lib/compass/openStack";

export function ReplacesStrip({ id, className = "" }: { id: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const c = capability(id);
  if (!c) return null;
  const first = c.replaces[0];
  return (
    <div className={`rounded-[4px] border border-signal-400/25 bg-signal-400/[0.05] text-[11px] ${className}`}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left">
        <Unlock size={12} className="text-signal-300 shrink-0" />
        <span className="min-w-0 truncate text-white/75">
          Replaces <span className="text-white">{first.vendor}</span>
          {first.basis !== "not_published" && <span className="mono text-white/50"> · {first.price}</span>}
          {c.replaces.length > 1 && <span className="text-white/40"> +{c.replaces.length - 1}</span>}
        </span>
        <span className="ml-auto mono text-[10px] text-signal-300 whitespace-nowrap">{c.datasets.length} open sources · S$0</span>
        <ChevronDown size={12} className={`text-white/40 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 space-y-1.5 border-t border-signal-400/15 pt-2">
          {c.replaces.map((r) => (
            <div key={r.vendor} className="flex justify-between gap-2">
              <span className="text-white/70">{r.vendor}</span>
              <span className="mono text-white/50 text-right">
                {r.source ? (
                  <a href={r.source} target="_blank" rel="noreferrer" className="hover:text-white underline decoration-white/20">{r.price}</a>
                ) : (
                  r.price
                )}
                {r.basis === "third_party" && <span className="text-white/30"> (3rd-party)</span>}
              </span>
            </div>
          ))}
          <div className="text-white/45 leading-snug">
            Built from:{" "}
            {c.datasets.map((d, i) => (
              <span key={d}>
                {i > 0 && " · "}
                <a href={DATASETS[d]?.url} target="_blank" rel="noreferrer" className="text-white/65 hover:text-white">{DATASETS[d]?.publisher}</a>
              </span>
            ))}
          </div>
          <div className="text-white/40 leading-snug">Still worth paying for: {c.out_of_reach}</div>
          <Link href="/sg/open" className="inline-block text-signal-300 hover:text-signal-200">The open stack →</Link>
        </div>
      )}
    </div>
  );
}
