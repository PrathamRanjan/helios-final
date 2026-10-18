"use client";

// Open intervention parser — the "describe anything" box. Type a free-text
// intervention; Gemini (or the rule-based fallback) maps it onto our effect
// primitives; we show exactly what it was read as, then drop a real, simulable
// modifier on the map. Honest by construction: the interpretation is visible and
// labelled, never silent.

import { useState } from "react";
import { Wand2, Loader2, Plus, X } from "lucide-react";
import { buildModifier, type WorldModifier, type ModifierGeometry } from "@/lib/compass/flow/scenario";
import type { ParsedIntervention } from "@/lib/compass/parser/interpretIntervention";

// District centre (Jurong East) — new interventions drop here, nudged apart.
const CENTRE: [number, number] = [103.7423, 1.3336];
const LINEAR = new Set(["allows_cycling", "walk_link", "adds_shade", "rain_protection", "restricts_cars", "faster_cycle", "better_bus"]);

const CONF_STYLE: Record<string, string> = {
  "calibrated proxy": "bg-amber-400/15 text-amber-300",
  speculative: "bg-rose-400/15 text-rose-300",
};

export default function InterventionParser({
  onAdd,
  placeIndex,
}: {
  onAdd: (m: WorldModifier) => void;
  placeIndex: number;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [parsed, setParsed] = useState<ParsedIntervention | null>(null);

  const interpret = async () => {
    const t = text.trim();
    if (t.length < 2 || loading) return;
    setLoading(true);
    setParsed(null);
    try {
      const r = await fetch("/api/compass/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t }),
      });
      const d = await r.json();
      if (!d.error) setParsed(d);
    } catch {
      /* ignore — user can retry */
    } finally {
      setLoading(false);
    }
  };

  const add = () => {
    if (!parsed) return;
    // Nudge each new drop apart so they don't stack on one pixel.
    const off = placeIndex * 0.003;
    const cx = CENTRE[0] + off;
    const cy = CENTRE[1] + off * 0.4;
    const isLinear = parsed.capabilityIds.some((id) => LINEAR.has(id));
    const geometry: ModifierGeometry = isLinear
      ? { type: "LineString", coordinates: [[cx, cy], [cx + 0.004, cy + 0.001]] }
      : { type: "Point", coordinates: [cx, cy] };
    const mod = buildModifier({
      geometry,
      capabilityIds: parsed.capabilityIds,
      costTier: parsed.costTier,
      builtYear: 2027,
      label: parsed.label,
      circular: parsed.circular,
    });
    // Carry the interpreter's confidence onto the modifier.
    mod.metadata.confidence = parsed.confidence;
    onAdd(mod);
    setParsed(null);
    setText("");
  };

  return (
    <div className="glass rounded-2xl p-3.5 w-[300px]">
      <div className="flex items-center gap-1.5 font-display text-sm text-white mb-1.5">
        <Wand2 size={13} className="text-solar-300" /> Describe any intervention
      </div>
      <div className="flex items-center gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && interpret()}
          placeholder="a shaded bike bridge with EV charging…"
          className="flex-1 rounded-lg bg-white/[0.06] border border-white/10 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/30 focus:border-solar-400/50 outline-none"
        />
        <button
          onClick={interpret}
          disabled={loading || text.trim().length < 2}
          className="shrink-0 rounded-lg bg-solar-400/90 hover:bg-solar-400 text-black px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-40"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : "Interpret"}
        </button>
      </div>

      {parsed && (
        <div className="mt-2 rounded-lg bg-white/[0.03] border border-white/10 px-2.5 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-white/85 truncate pr-2">{parsed.label}</span>
            <button onClick={() => setParsed(null)} className="text-white/40 hover:text-white shrink-0"><X size={12} /></button>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {parsed.matched.map((m) => (
              <span key={m} className="rounded-md bg-sky-400/10 text-sky-300 px-1.5 py-0.5 text-[9.5px]">{m}</span>
            ))}
            <span className="rounded-md bg-white/[0.06] text-white/60 px-1.5 py-0.5 text-[9.5px]">
              {parsed.costTier === "low" ? "~$150k" : parsed.costTier === "med" ? "~$500k" : "~$2M"}
            </span>
            <span className={`rounded-md px-1.5 py-0.5 text-[9.5px] ${CONF_STYLE[parsed.confidence] ?? "bg-white/10 text-white/60"}`}>
              {parsed.confidence}
            </span>
          </div>
          <div className="mt-1.5 text-[9.5px] text-white/45 leading-snug">
            {parsed.source === "ai" ? "AI-interpreted · " : "Keyword-mapped · "}{parsed.rationale}
          </div>
          <button
            onClick={add}
            className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/15 py-1.5 text-[11px] font-medium text-white"
          >
            <Plus size={12} /> Add to map & simulate
          </button>
        </div>
      )}
    </div>
  );
}
