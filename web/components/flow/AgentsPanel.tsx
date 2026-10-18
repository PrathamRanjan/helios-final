"use client";

// "Under the hood" — the multi-agent system view. Makes the AI agents legible
// and honest: each is tagged live (real & running), partial, or mock (framed
// for now). This is the slide-deck artifact — the keywords, grounded.

import { useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Cpu, X, MessageSquareText, Sparkles, FileText, Eye, ShieldAlert, LineChart, Users, Newspaper, Network } from "lucide-react";

type Status = "live" | "partial" | "keyed" | "mock";

const STATUS: Record<Status, { label: string; cls: string }> = {
  live: { label: "live · real", cls: "bg-emerald-400/12 text-emerald-300 border-emerald-400/30" },
  partial: { label: "real data · light", cls: "bg-amber-400/12 text-amber-300 border-amber-400/30" },
  keyed: { label: "built · runs with Gemini key", cls: "bg-sky-400/12 text-sky-300 border-sky-400/30" },
  mock: { label: "framed · mock feed", cls: "bg-white/8 text-white/50 border-white/15" },
};

const AGENTS: { icon: any; name: string; role: string; tech: string; status: Status }[] = [
  { icon: MessageSquareText, name: "Parser Agent", role: "Turns free-text (\"shaded bike bridge with EV charging\") into real world-modifiers.", tech: "NLP · Gemini 2.5 Flash", status: "live" },
  { icon: Sparkles, name: "Planning / Optimiser Agent", role: "Given a budget, simulates 18 candidates and knapsacks the best package.", tech: "Combinatorial search over the sim", status: "live" },
  { icon: ShieldAlert, name: "Red-team Agent", role: "\"Does this make anything else worse?\" — flags regrettable substitutions.", tech: "Systems / LCA logic", status: "live" },
  { icon: LineChart, name: "Back-test Agent", role: "Re-runs the engine against real built projects to check direction & magnitude.", tech: "Validation harness", status: "live" },
  { icon: FileText, name: "Report Agent", role: "Streams the written Fund/Study/Defer decision memo.", tech: "Gemini · streaming", status: "live" },
  { icon: Eye, name: "Vision Agent", role: "Reads rooftops for solar potential (the Bangkok B2C flow).", tech: "Gemini vision", status: "live" },
  { icon: Users, name: "Civic-Pulse Agent", role: "Grounds public sentiment from real community feedback.", tech: "Reddit ingest", status: "partial" },
  { icon: Newspaper, name: "News Scout + Shock Parser", role: "Reads live Singapore news (Google Search grounding), turns a relevant event into ONE simulator shock, validated against a strict schema before it can touch the model.", tech: "ADK · Gemini · Search grounding · structured output", status: "keyed" },
  { icon: Network, name: "Data Librarian", role: "Finds and cites any of 7,489 public datasets (data.gov.sg + SingStat) to answer \"what data backs this?\"", tech: "Hybrid retrieval: TF-IDF offline + Gemini embeddings re-rank", status: "partial" },
  { icon: ShieldAlert, name: "Value-of-Information Red Team", role: "Prices uncertainty: which parameter could change the decision, what study resolves it, and whether that study pays for itself.", tech: "EVPI / EVPPI over 120 simulator draws · ADK", status: "keyed" },
  { icon: Sparkles, name: "Portfolio Planner", role: "Best package within a budget at a chosen risk attitude, robust across Green Plan pathways.", tech: "Mean–CVaR MILP (HiGHS) · minimax regret · ADK", status: "keyed" },
];

function AskTeam() {
  const [q, setQ] = useState("We have US$1.5M for Jurong East. What should we fund, and what could make that wrong?");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const ask = async () => {
    setBusy(true);
    setRes(null);
    try {
      const r = await fetch("/api/compass/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }) });
      setRes(await r.json());
    } catch (e: any) {
      setRes({ error: String(e) });
    }
    setBusy(false);
  };
  return (
    <div className="px-5 pt-4">
      <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">Ask the HELIOS team</div>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !busy && ask()}
          className="flex-1 rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2 text-[12px] text-white/90 outline-none focus:border-white/25" />
        <button onClick={ask} disabled={busy} aria-label="Ask the HELIOS team" title="Ask" className="rounded-lg bg-violet-500/20 border border-violet-400/30 px-3 text-violet-200 disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
      {res?.error && <div className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-200/90">{res.error}</div>}
      {res?.answer && (
        <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
          {res.trace?.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {res.trace.map((t: any, i: number) => (
                <span key={i} className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[9.5px] text-white/55">{t.agent} → {t.call}</span>
              ))}
            </div>
          )}
          <div className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-white/80">{res.answer}</div>
          {res.guard && (
            <div className={`mt-2 text-[10px] ${res.guard.ok ? "text-emerald-300/80" : "text-amber-300/90"}`}>
              {res.guard.ok ? "✓ Guardrail: every number traced to a tool result" : `⚠ Guardrail: unverified ${res.guard.unsupported_numbers?.join(", ")} ${res.guard.overclaims?.join(", ")}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentsPanel({ inline = false }: { inline?: boolean }) {
  const [open, setOpen] = useState(false);
  const live = AGENTS.filter((a) => a.status === "live").length;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="The multi-agent system"
        className={inline ? "v2-btn" : "fixed bottom-5 right-[188px] z-50 flex items-center gap-1.5 rounded-full glass px-3.5 py-2 text-[12px] text-white/80 hover:text-white transition-colors shadow-panel"}
      >
        <Cpu size={15} className="text-violet-300" />
        Agents
      </button>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 14 }}
              className="relative bg-[#0f1117] border border-white/10 rounded-2xl shadow-panel w-[760px] max-w-full max-h-[88vh] overflow-y-auto"
            >
              <div className="sticky top-0 bg-[#0f1117]/95 backdrop-blur border-b border-white/10 px-5 py-3 flex items-center justify-between">
                <div>
                  <span className="font-display text-sm text-solar-gradient">HELIO multi-agent system</span>
                  <span className="text-[11px] text-white/45 ml-2">{live} live · {AGENTS.filter((a) => a.status === "keyed").length} built on Google ADK (run with a Gemini key)</span>
                </div>
                <button onClick={() => setOpen(false)} className="text-white/50 hover:text-white p-1"><X size={16} /></button>
              </div>

              <AskTeam />

              {/* pipeline strip */}
              <div className="px-5 pt-4">
                <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">The loop</div>
                <div className="flex items-center gap-1.5 text-[10.5px] flex-wrap">
                  {["Parse", "Simulate", "Red-team", "Optimise", "Back-test", "Report"].map((s, i, arr) => (
                    <span key={s} className="flex items-center gap-1.5">
                      <span className="rounded-md bg-white/[0.05] border border-white/10 px-2 py-1 text-white/75">{s}</span>
                      {i < arr.length - 1 && <span className="text-white/25">→</span>}
                    </span>
                  ))}
                </div>
              </div>

              <div className="p-5 grid grid-cols-2 gap-2.5">
                {AGENTS.map((a) => {
                  const Icon = a.icon;
                  const st = STATUS[a.status];
                  return (
                    <div key={a.name} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Icon size={15} className="text-white/70 shrink-0" />
                          <span className="text-[12.5px] text-white/90 font-medium leading-tight">{a.name}</span>
                        </div>
                        <span className={`text-[8.5px] rounded-full border px-1.5 py-0.5 whitespace-nowrap ${st.cls}`}>{st.label}</span>
                      </div>
                      <div className="text-[11px] text-white/55 leading-snug mt-1.5">{a.role}</div>
                      <div className="text-[9.5px] text-white/35 mt-1.5">{a.tech}</div>
                    </div>
                  );
                })}
              </div>

              <div className="px-5 pb-5 text-[10px] text-white/35 leading-snug">
                Honest labelling is deliberate: blue-tagged agents are fully built on Google ADK with tests and a numeric-citation guardrail, and switch on when a Gemini key is set on the engine. The "agents" moving on the map are <b className="text-white/60">simulation agents</b> (residents re-choosing modes) — a different thing from these backend AI agents.
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
