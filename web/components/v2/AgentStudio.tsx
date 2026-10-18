"use client";

// Agent Studio: tell the HELIOS agents an idea; six ADK agents design, simulate, check rules,
// screen sites and argue against it, live. The finished plan lands on the map and in Impact.

import { useEffect, useRef, useState } from "react";
import { Send, Loader2, Bot, Check, AlertTriangle, ShieldCheck, RotateCcw } from "lucide-react";
import { Label } from "@/components/v2/ui";
import type { Shock, WorldModifier } from "@/lib/compass/world/types";

const PIPELINE = [
  { id: "designer", label: "Designer", does: "turns the idea into costed changes" },
  { id: "analyst", label: "Analyst", does: "simulates 2026–2036" },
  { id: "compliance_officer", label: "Compliance", does: "checks Singapore rules" },
  { id: "site_analyst", label: "Sites", does: "nature, flood, heat" },
  { id: "red_team", label: "Red team", does: "argues against it" },
  { id: "narrator", label: "Narrator", does: "writes the answer" },
];

const TOOL_LABEL: Record<string, string> = {
  list_areas: "Looking up areas",
  area_profile: "Reading the area's census & environment",
  list_candidate_changes: "Listing costed changes",
  set_plan: "Setting the plan",
  live_air: "Reading today's air (NEA)",
  inject_haze: "Injecting haze",
  inject_shock: "Injecting a shock",
  clear_shocks: "Clearing shocks",
  simulate_current_plan: "Running the city simulation",
  check_current_plan_compliance: "Checking rules",
  screen_current_plan_sites: "Screening sites",
};

export const STUDIO_EXAMPLES = [
  "We have S$5M for Tampines. Make the walk to the MRT cooler and test it against today's haze.",
  "Get people in Woodlands out of cars with bus priority and cycle links, under S$4M.",
  "Put solar canopies at Jurong East's busiest stops and check the rules.",
];

type Ev =
  | { type: "start"; session_id: string }
  | { type: "call"; agent: string; tool: string; args: Record<string, unknown>; t: number }
  | { type: "result"; agent: string; tool: string; ok: boolean; summary: string; t: number }
  | { type: "say"; agent: string; text: string; t: number }
  | { type: "plan"; area: string | null; change_ids: string[]; shocks: Shock[]; guard?: { ok: boolean; unsupported_numbers: string[] } }
  | { type: "error"; message: string }
  | { type: "done"; seconds: number };

interface Turn {
  user: string;
  events: Ev[];
  running: boolean;
}

function Answer({ text }: { text: string }) {
  return (
    <div className="space-y-1 text-[12px] leading-snug text-white/85">
      {text
        .split("\n")
        .filter((l) => l.trim())
        .map((l, i) => {
          const t = l.replace(/\*\*/g, "");
          if (/^\s*[*-]\s/.test(t)) return <div key={i} className="pl-3 text-white/75">• {t.replace(/^\s*[*-]\s/, "")}</div>;
          if (/^(Plan|Impact|Rules|Sites|Watch out)\b/.test(t)) return <div key={i} className="mono text-[10px] uppercase tracking-wider text-signal-300 pt-1.5">{t}</div>;
          return <p key={i}>{t}</p>;
        })}
    </div>
  );
}

export default function AgentStudio({
  areaName,
  onPlan,
  prefill,
}: {
  areaName?: string;
  onPlan: (area: string, modifiers: WorldModifier[], shocks: Shock[]) => void;
  prefill?: { text: string; key: number } | null;
}) {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [session, setSession] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const running = turns.some((t) => t.running);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);
  useEffect(() => {
    if (prefill?.text) send(prefill.text);
  }, [prefill?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const push = (ev: Ev) =>
    setTurns((ts) => {
      const last = ts[ts.length - 1];
      return [...ts.slice(0, -1), { ...last, events: [...last.events, ev], running: ev.type !== "done" && last.running }];
    });

  async function applyPlan(p: Extract<Ev, { type: "plan" }>) {
    if (!p.area || !p.change_ids.length) return;
    const r = await fetch("/api/studio/tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: "get_modifiers", args: { area: p.area, change_ids: p.change_ids } }) });
    const d = await r.json();
    if (d.ok) onPlan(p.area, d.result.modifiers, p.shocks ?? []);
  }

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || running) return;
    setInput("");
    setTurns((ts) => [...ts, { user: msg, events: [], running: true }]);
    const withContext = areaName && !session ? `${msg}\n(The planner is currently looking at ${areaName}.)` : msg;
    try {
      const r = await fetch("/api/studio/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: withContext, sessionId: session }) });
      if (!r.body) throw new Error(`HTTP ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const ev = JSON.parse(line.slice(6)) as Ev;
          if (ev.type === "start") setSession(ev.session_id);
          if (ev.type === "plan") applyPlan(ev);
          push(ev);
        }
      }
    } catch (e: any) {
      push({ type: "error", message: e?.message ?? String(e) });
    }
    setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, running: false } : t)));
  }

  return (
    <div className="flex flex-col gap-3" data-tour="studio">
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[12.5px] text-white">
            <Bot size={14} className="text-signal-300" /> Agent Studio
          </div>
          {turns.length > 0 && !running && (
            <button
              onClick={() => {
                setTurns([]);
                setSession(null);
              }}
              className="text-[10.5px] text-white/40 hover:text-white flex items-center gap-1"
            >
              <RotateCcw size={11} /> New plan
            </button>
          )}
        </div>
        <p className="text-[11px] text-white/50 mt-1 leading-snug">
          Describe an idea. Six Google ADK agents build it from this city's costed options, simulate it, check the rules, screen the sites and argue against it. The plan then appears on the map.
        </p>
      </div>

      {turns.length === 0 && (
        <div className="space-y-1.5">
          <Label>Try</Label>
          {STUDIO_EXAMPLES.map((e) => (
            <button key={e} onClick={() => send(e)} className="w-full text-left rounded-[4px] border border-line px-2.5 py-1.5 text-[11.5px] text-white/70 hover:text-white hover:border-signal-400/40">
              {e}
            </button>
          ))}
        </div>
      )}

      {turns.map((t, ti) => {
        const agentsSeen = new Set(t.events.filter((e) => "agent" in e).map((e: any) => e.agent));
        const lastAgent = [...t.events].reverse().find((e) => "agent" in e) as any;
        const answer = [...t.events].reverse().find((e) => e.type === "say" && e.agent === "narrator") as any;
        const plan = t.events.find((e) => e.type === "plan") as Extract<Ev, { type: "plan" }> | undefined;
        const err = t.events.find((e) => e.type === "error") as any;
        const done = t.events.find((e) => e.type === "done") as any;
        return (
          <div key={ti} className="space-y-2">
            <div className="ml-6 rounded-[4px] bg-signal-400/[0.08] border border-signal-400/20 px-2.5 py-1.5 text-[12px] text-white/85">{t.user}</div>
            <div className="grid grid-cols-3 gap-1">
              {PIPELINE.map((p) => {
                const active = t.running && lastAgent?.agent === p.id;
                const seen = agentsSeen.has(p.id);
                return (
                  <div key={p.id} title={p.does} className={`rounded-[3px] border px-1.5 py-1 text-[10px] transition-colors ${active ? "border-signal-400/60 bg-signal-400/[0.12] text-signal-200" : seen ? "border-line text-white/70" : "border-line/50 text-white/30"}`}>
                    <div className="flex items-center gap-1">
                      {active ? <Loader2 size={9} className="animate-spin" /> : seen ? <Check size={9} className="text-signal-300" /> : <span className="w-[9px]" />}
                      {p.label}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="space-y-0.5 max-h-[150px] overflow-y-auto v2-scroll">
              {t.events
                .filter((e) => e.type === "call" || (e.type === "result" && !e.ok))
                .map((e: any, i) => (
                  <div key={i} className={`mono text-[10px] leading-snug ${e.type === "result" ? "text-risk-300" : "text-white/45"}`}>
                    <span className="text-white/30">{e.t?.toFixed?.(0)}s</span> {e.agent} · {e.type === "result" ? `✗ ${e.summary}` : TOOL_LABEL[e.tool] ?? e.tool}
                    {e.type === "call" && e.tool === "inject_haze" ? ` (PSI ${e.args.psi}, ${e.args.days_per_year} days/yr)` : ""}
                  </div>
                ))}
              {t.running && !t.events.length && (
                <div className="flex items-center gap-1.5 text-[11px] text-white/40">
                  <Loader2 size={11} className="animate-spin" /> Agents starting…
                </div>
              )}
            </div>
            {answer && (
              <div className="rounded-[4px] border border-line p-2.5">
                <Answer text={answer.text} />
              </div>
            )}
            {plan && plan.area && (
              <div className="flex items-center gap-1.5 text-[10.5px] text-white/50">
                <ShieldCheck size={11} className={plan.guard?.ok === false ? "text-warn-300" : "text-signal-300"} />
                {plan.guard?.ok === false ? `Guardrail: ${plan.guard.unsupported_numbers.length} number(s) not traced to a tool result` : "Every number traced to a tool result"}
                {done && ` · ${done.seconds}s`} · plan applied to the map
              </div>
            )}
            {err && (
              <div className="rounded-[4px] border border-risk-400/30 bg-risk-400/[0.06] p-2 text-[11px] text-risk-300 flex items-start gap-1.5">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {err.message}
              </div>
            )}
          </div>
        );
      })}
      <div ref={bottom} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-1.5 sticky bottom-0 bg-ink-1/95 pt-1"
      >
        <input
          id="studio-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={running}
          placeholder={turns.length ? "Edit the plan: swap a change, add a shock…" : "Describe your idea for an area…"}
          className="flex-1 h-9 rounded-[4px] border border-line bg-ink-0 px-2.5 text-[12px] text-white/90 placeholder:text-white/30 disabled:opacity-50"
        />
        <button type="submit" disabled={running || !input.trim()} className="v2-btn-primary !h-9 !px-3 disabled:opacity-40" aria-label="Send to agents">
          {running ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </form>
    </div>
  );
}
