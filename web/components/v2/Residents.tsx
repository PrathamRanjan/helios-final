"use client";

// Synthetic residents voiced by local Gemma 4. Residents are sampled from the
// GHS 2025 census (ingest/sg_population.py); Gemma only voices them from the
// numbers HELIOS passes in. No fallbacks: if Gemma is off, we say so.

import { useEffect, useState } from "react";
import { Users, Loader2, AlertTriangle, MessageSquareQuote, Cpu, RefreshCw } from "lucide-react";
import { Label, ConfChip } from "@/components/v2/ui";

interface Resident {
  id: string;
  subzone: string;
  age: number;
  sex: "M" | "F";
  dwelling: string;
  hh_income: string;
  commute: string | null;
}

const SENT = ["very negative", "negative", "neutral", "positive", "very positive"];
const sentColor = (s: number) => (s > 0 ? "text-signal-300" : s < 0 ? "text-risk-300" : "text-white/50");

function ResidentLine({ r }: { r: Resident }) {
  return (
    <div className="mono text-[10px] text-white/45 leading-snug">
      {r.id} · {r.age} {r.sex} · {r.dwelling} · {r.hh_income}/mo · {r.commute ? `commutes by ${r.commute}` : "not commuting"} · {r.subzone}
    </div>
  );
}

function GemmaError({ msg }: { msg: string }) {
  const off = /not running|not answering/i.test(msg);
  const hosted = /Hosted model/i.test(msg);
  return (
    <div className="rounded-[4px] border border-risk-400/30 bg-risk-400/[0.06] p-2.5 text-[11px] text-risk-300 leading-snug">
      <div className="flex items-center gap-1.5">
        <AlertTriangle size={12} /> {off ? (hosted ? "Hosted model isn't answering" : "Local Gemma is off") : "Couldn't get resident reactions"}
      </div>
      <div className="text-white/50 mt-1">{off ? (hosted ? msg : "Start it (or set LLM_API_KEY for a hosted model), then try again:") : msg}</div>
      {off && !hosted && <pre className="mono mt-1.5 rounded-[3px] bg-ink-0 border border-line p-1.5 text-[10px] text-signal-200">helios/scripts/gemma-server.sh</pre>}
    </div>
  );
}

/** Command-bar status light for the model (local Gemma or a hosted endpoint). */
export function GemmaStatus() {
  const [ok, setOk] = useState<boolean | null>(null);
  const [info, setInfo] = useState<{ mode?: string; model?: string; detail?: string }>({});
  useEffect(() => {
    let alive = true;
    const check = () =>
      fetch("/api/gemma/health")
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          setOk(!!d.ok);
          setInfo({ mode: d.mode, model: d.model, detail: d.detail });
        })
        .catch(() => alive && setOk(false));
    check();
    const t = setInterval(check, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return (
    <span
      className={`mono hidden xl:inline-flex items-center gap-1.5 text-[9.5px] uppercase tracking-wider whitespace-nowrap ${ok ? "text-signal-300" : "text-white/35"}`}
      title={
        info.mode === "hosted"
          ? `Hosted model ${info.model} — ${ok ? "answering" : `not answering (${info.detail ?? "check LLM_API_KEY"})`}`
          : ok
            ? "Local Gemma 4 is running — resident voices and rule drafting available"
            : "Local Gemma 4 is off — start helios/scripts/gemma-server.sh, or set LLM_API_KEY to use a hosted model"
      }
    >
      <Cpu size={11} /> {info.mode === "hosted" ? "Model (hosted)" : "Gemma"} {ok == null ? "…" : ok ? "on" : "off"}
    </span>
  );
}

/** "Who lives here?" — three residents react to a building-level change. */
export function SiteResidents({ body }: { body: Record<string, unknown> }) {
  const [state, setState] = useState<{ loading: boolean; data?: any; error?: string }>({ loading: false });
  const [seed, setSeed] = useState(1);
  const run = (s = seed) => {
    setState({ loading: true });
    fetch("/api/persona/site", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, seed: s }) })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`);
        setState({ loading: false, data: d });
      })
      .catch((e) => setState({ loading: false, error: e.message }));
  };
  return (
    <div className="rounded-[4px] border border-line p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[12.5px] text-white">
          <Users size={14} className="text-signal-300" /> Who lives here?
        </div>
        <ConfChip conf="speculative" />
      </div>
      <p className="text-[10.5px] text-white/40 mt-1 leading-snug">Three synthetic residents sampled from this area's census mix react to the change above. Voices by local Gemma 4; numbers by HELIOS.</p>
      {!state.data && !state.loading && (
        <button onClick={() => run()} className="v2-btn w-full justify-center mt-2.5">
          <MessageSquareQuote size={13} className="text-signal-300" /> Ask three residents
        </button>
      )}
      {state.loading && (
        <div className="flex items-center gap-2 text-[11px] text-white/45 mt-3">
          <Loader2 size={12} className="animate-spin" /> Residents are thinking…
        </div>
      )}
      {state.error && <div className="mt-2.5"><GemmaError msg={state.error} /></div>}
      {state.data && (
        <div className="mt-2.5 space-y-2.5">
          {state.data.panel.map((p: any) => (
            <div key={p.resident.id} className="border-l-2 border-signal-400/40 pl-2.5">
              <div className="text-[12px] text-white/85 leading-snug">“{p.reaction}”</div>
              <div className="flex items-center gap-2 mt-1 text-[10px]">
                <span className={sentColor(p.sentiment)}>{SENT[p.sentiment + 2]}</span>
                {p.main_concern && <span className="text-white/40">· worry: {p.main_concern}</span>}
              </div>
              <ResidentLine r={p.resident} />
            </div>
          ))}
          <button
            onClick={() => {
              const s = seed + 1;
              setSeed(s);
              run(s);
            }}
            className="v2-btn !h-7 text-[11px]"
          >
            <RefreshCw size={11} /> Ask three others
          </button>
        </div>
      )}
    </div>
  );
}

/** Area reaction panel — a stratified census sample reacts to the simulated plan. */
export function AreaResidents({ body, planKey }: { body: Record<string, unknown>; planKey: string }) {
  const [state, setState] = useState<{ loading: boolean; data?: any; error?: string; key?: string }>({ loading: false });
  const stale = state.data && state.key !== planKey;
  const run = () => {
    setState({ loading: true });
    fetch("/api/persona/area", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, n: 24 }) })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`);
        setState({ loading: false, data: d, key: planKey });
      })
      .catch((e) => setState({ loading: false, error: e.message }));
  };
  const g = state.data?.aggregate;
  const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);
  return (
    <div className="mt-4 pt-4 border-t border-line">
      <div className="flex items-center justify-between mb-2">
        <Label>Residents' reaction</Label>
        <ConfChip conf="speculative" />
      </div>
      {(!state.data || stale) && !state.loading && (
        <button onClick={run} className="v2-btn w-full justify-center">
          <Users size={13} className="text-signal-300" /> {stale ? "Plan changed — ask residents again" : "Hear from 24 residents"}
        </button>
      )}
      {state.loading && (
        <div className="flex items-center gap-2 text-[11px] text-white/45 py-2">
          <Loader2 size={12} className="animate-spin" /> 24 residents reacting (≈30 s on local Gemma)…
        </div>
      )}
      {state.error && <GemmaError msg={state.error} />}
      {g && !stale && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-[4px] border border-line p-2">
              <div className={`mono text-[16px] ${sentColor(g.sentiment)}`}>{g.sentiment >= 0 ? "+" : ""}{g.sentiment.toFixed(2)}</div>
              <div className="text-[9.5px] text-white/40">mood (−2…+2)</div>
            </div>
            <div className="rounded-[4px] border border-line p-2">
              <div className="mono text-[16px] text-white">{pct(g.statedDriverSwitch)}</div>
              <div className="text-[9.5px] text-white/40">drivers who say they'd switch ({g.drivers})</div>
            </div>
            <div className="rounded-[4px] border border-line p-2">
              <div className="mono text-[16px] text-white">{pct(g.modelledDriverSwitch)}</div>
              <div className="text-[9.5px] text-white/40">drivers the model switches</div>
            </div>
          </div>
          {g.flag ? (
            <div className="flex items-start gap-1.5 text-[11px] text-warn-300 leading-snug">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              Residents and model disagree by {Math.round(Math.abs(g.gap) * 100)} points on driver switching — treat the mode-shift result as uncertain.
            </div>
          ) : (
            <div className="text-[10.5px] text-white/40 leading-snug">Stated intentions and the modelled shift broadly agree (small panel — indicative only).</div>
          )}
          <div className="grid grid-cols-2 gap-3 text-[10.5px]">
            {[["By age", g.byAge], ["By household income", g.byIncome]].map(([t, rows]: any) => (
              <div key={t}>
                <div className="text-white/45 mb-1">{t}</div>
                {rows.map((x: any) => (
                  <div key={x.group} className="flex justify-between">
                    <span className="text-white/60">{x.group} <span className="text-white/30">({x.n})</span></span>
                    <span className={`mono ${sentColor(x.sentiment)}`}>{x.sentiment >= 0 ? "+" : ""}{x.sentiment.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="space-y-2.5 max-h-[340px] overflow-y-auto v2-scroll pr-1">
            {state.data.panel.map((p: any) => (
              <div key={p.resident.id} className="border-l-2 border-line pl-2.5">
                <div className="text-[11.5px] text-white/80 leading-snug">“{p.reaction}”</div>
                <div className="text-[10px] mt-0.5">
                  <span className={sentColor(p.sentiment)}>{SENT[p.sentiment + 2]}</span>
                  <span className="text-white/40"> · {p.stated_change.replace(/_/g, " ")}</span>
                </div>
                <ResidentLine r={p.resident} />
              </div>
            ))}
          </div>
          <div className="text-[10px] text-white/30 leading-snug">{state.data.note}</div>
        </div>
      )}
    </div>
  );
}
