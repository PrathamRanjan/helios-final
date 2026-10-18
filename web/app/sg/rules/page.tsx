"use client";

// Rule drafting desk: local Gemma reads a policy document page by page and proposes
// checkable rules with a verbatim quote; HELIOS verifies the quote is on the page;
// a human approves or rejects each one. Drafts never change engine verdicts.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, X, RotateCcw, Loader2, FileText, Sparkles, ShieldCheck, ShieldAlert, ArrowLeft, GitMerge, Equal, CircleDashed } from "lucide-react";
import { Wordmark, Label, Segmented, ConfChip } from "@/components/v2/ui";
import { GemmaStatus } from "@/components/v2/Residents";
import { ReplacesStrip } from "@/components/v2/OpenStack";

interface Doc {
  slug: string;
  title: string;
  pages: number;
}
interface Draft {
  id: string;
  doc: string;
  docTitle: string;
  page: number;
  title: string;
  kind: string;
  metric?: string;
  operator?: string;
  value?: number | string | null;
  unit?: string;
  applies_to?: string;
  effective_from?: string | null;
  quote: string;
  quote_verified: boolean;
  status: "pending" | "approved" | "rejected";
  note?: string;
  engine?: { status: "matches_engine" | "not_in_engine" | "no_checkable_value"; matches: { ruleId: string; path: string; value: number }[]; sameDocRules: string[] };
  hint?: string;
}

type Filter = "pending" | "approved" | "rejected" | "all";

export default function RulesDesk() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [doc, setDoc] = useState("");
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(5);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");

  const load = () =>
    fetch("/api/rules/docs")
      .then((r) => r.json())
      .then((d) => {
        setDocs(d.docs ?? []);
        setDrafts(d.drafts ?? []);
        if (!doc && d.docs?.length) setDoc(d.docs[0].slug);
      });
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const current = docs.find((d) => d.slug === doc);
  const draft = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/rules/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc, from, to }) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`);
      setMsg(`Pages ${d.pages.join(", ") || "—"}: ${d.added} candidates, ${d.verified} with the quote verified on the page.`);
      setFilter("pending");
      await load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };
  const [promoting, setPromoting] = useState<string | null>(null);
  const promote = async (id: string) => {
    setPromoting(id);
    try {
      const r = await fetch("/api/rules/promote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const d = await r.json();
      setMsg(d.error ?? `Candidate rule written to ${d.file} — not used by the engine until mapped, tested and moved into rules/.`);
      await load();
    } finally {
      setPromoting(null);
    }
  };
  const review = async (id: string, status: Draft["status"]) => {
    setDrafts((ds) => ds.map((x) => (x.id === id ? { ...x, status } : x)));
    await fetch("/api/rules/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
  };

  const shown = useMemo(() => drafts.filter((d) => filter === "all" || d.status === filter).sort((a, b) => a.docTitle.localeCompare(b.docTitle) || a.page - b.page), [drafts, filter]);
  const counts = { pending: drafts.filter((d) => d.status === "pending").length, approved: drafts.filter((d) => d.status === "approved").length, rejected: drafts.filter((d) => d.status === "rejected").length };
  const agree = drafts.filter((d) => d.engine?.status === "matches_engine").length;
  const fresh = drafts.filter((d) => d.engine && d.engine.status !== "matches_engine").length;

  return (
    <main className="v2 min-h-screen v2-grid-bg">
      <header className="sticky top-0 z-50 h-12 flex items-center gap-3 px-3 border-b border-line bg-ink-0/90 backdrop-blur">
        <Wordmark />
        <span className="h-5 w-px bg-line" />
        <Link href="/sg" className="v2-btn !h-7"><ArrowLeft size={12} /> World</Link>
        <span className="text-[12px] text-white/70">Rule drafting desk</span>
        <div className="flex-1" />
        <GemmaStatus />
      </header>

      <div className="max-w-[1180px] mx-auto px-4 py-6 grid gap-6 lg:grid-cols-[340px_1fr]">
        <section className="space-y-4">
          <div className="v2-panel v2-ticks p-4 space-y-3">
            <Label>1 · Pick a document</Label>
            <select value={doc} onChange={(e) => setDoc(e.target.value)} className="w-full h-9 rounded-[4px] border border-line bg-ink-1 px-2 text-[12px] text-white/85">
              {docs.map((d) => (
                <option key={d.slug} value={d.slug}>{d.title} ({d.pages} pp)</option>
              ))}
            </select>
            {!docs.length && <div className="text-[11px] text-warn-300">Policy source pages are not installed. Document drafting is unavailable until the operator uploads authorised page extracts.</div>}
            <Label>2 · Pages (max 10 per run)</Label>
            <div className="flex items-center gap-2 text-[12px]">
              <input type="number" min={1} max={current?.pages} value={from} onChange={(e) => setFrom(Number(e.target.value))} className="mono w-20 h-8 rounded-[4px] border border-line bg-ink-1 px-2 text-white/85" />
              <span className="text-white/40">to</span>
              <input type="number" min={from} max={current?.pages} value={to} onChange={(e) => setTo(Number(e.target.value))} className="mono w-20 h-8 rounded-[4px] border border-line bg-ink-1 px-2 text-white/85" />
              <span className="text-white/35">of {current?.pages ?? "—"}</span>
            </div>
            <button disabled={busy || !doc} onClick={draft} className="v2-btn-primary w-full">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {busy ? "Gemma is reading…" : "Draft rules with local Gemma"}
            </button>
            {msg && <div className="text-[11px] text-white/60 leading-snug">{msg}</div>}
            {drafts.length > 0 && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="rounded-[4px] border border-signal-400/30 px-2 py-1.5">
                  <div className="mono text-[16px] text-signal-300">{agree}</div>
                  <div className="text-[10px] text-white/50">agree with the engine</div>
                </div>
                <div className="rounded-[4px] border border-warn-400/30 px-2 py-1.5">
                  <div className="mono text-[16px] text-warn-300">{fresh}</div>
                  <div className="text-[10px] text-white/50">not in the engine yet</div>
                </div>
              </div>
            )}
          </div>
          <ReplacesStrip id="rule_drafting" />
          <div className="v2-panel p-4 text-[11px] text-white/50 leading-relaxed space-y-2">
            <div className="flex items-center gap-1.5 text-white/75"><ShieldCheck size={13} className="text-signal-300" /> How this stays honest</div>
            <p>Gemma proposes; it never decides. Every candidate must carry a verbatim quote, and HELIOS checks that quote is really on the cited page (✓). Unverified quotes usually come from tables the PDF scrambles — check those against the page.</p>
            <p>Every draft is also checked against the engine's own rules. <span className="text-signal-300">Matches engine</span> means Gemma and the hand-built rule read the same number from the same document: two independent readings agree. <span className="text-warn-300">Not in engine</span> is new knowledge.</p>
            <p>Approved new drafts can be promoted to a candidate rule file in <span className="mono text-white/65">data/compliance/rules/candidates/</span>. A developer then maps it (rule kind + worked examples + tests). Until then it affects no verdict.</p>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <Segmented<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { id: "pending", label: `Pending ${counts.pending}` },
                { id: "approved", label: `Approved ${counts.approved}` },
                { id: "rejected", label: `Rejected ${counts.rejected}` },
                { id: "all", label: `All ${drafts.length}` },
              ]}
            />
            <ConfChip conf="speculative" />
          </div>
          {!shown.length && <div className="v2-panel p-6 text-center text-[12px] text-white/40">Nothing here yet — draft some pages on the left.</div>}
          {shown.map((d) => (
            <article key={d.id} className="v2-panel p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="mono rounded-[3px] border border-line px-1.5 text-[9.5px] uppercase tracking-wider text-white/50">{d.kind}</span>
                    <span className="text-[13px] text-white">{d.title}</span>
                  </div>
                  <div className="mono text-[10.5px] text-white/40 mt-1 flex items-center gap-1.5">
                    <FileText size={11} /> {d.docTitle} · p.{d.page}
                    {d.value != null && <> · <span className="text-signal-200">{d.operator ? `${d.operator} ` : ""}{String(d.value)} {d.unit ?? ""}</span></>}
                    {d.effective_from && <> · from {d.effective_from}</>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {d.status !== "approved" && (
                    <button onClick={() => review(d.id, "approved")} className="v2-btn !h-7" title="Approve"><Check size={13} className="text-signal-300" /></button>
                  )}
                  {d.status !== "rejected" && (
                    <button onClick={() => review(d.id, "rejected")} className="v2-btn !h-7" title="Reject"><X size={13} className="text-risk-300" /></button>
                  )}
                  {d.status !== "pending" && (
                    <button onClick={() => review(d.id, "pending")} className="v2-btn !h-7" title="Back to pending"><RotateCcw size={12} /></button>
                  )}
                  {d.status === "approved" && d.engine?.status !== "matches_engine" && !d.note?.startsWith("promoted") && (
                    <button onClick={() => promote(d.id)} disabled={promoting === d.id} className="v2-btn !h-7" title="Write a candidate rule file for a developer to map and test">
                      {promoting === d.id ? <Loader2 size={12} className="animate-spin" /> : <GitMerge size={12} className="text-signal-300" />} Promote
                    </button>
                  )}
                </div>
              </div>
              {d.engine && (
                <div className="mt-2 flex items-center gap-1.5 text-[10.5px] flex-wrap">
                  {d.engine.status === "matches_engine" ? (
                    <span className="inline-flex items-center gap-1 rounded-[3px] border border-signal-400/40 px-1.5 py-[1px] text-signal-300">
                      <Equal size={10} /> Matches engine
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-[3px] border border-warn-400/40 px-1.5 py-[1px] text-warn-300">
                      <CircleDashed size={10} /> Not in engine{d.engine.status === "no_checkable_value" ? " · text rule" : ""}
                    </span>
                  )}
                  {d.engine.matches.map((m) => (
                    <span key={m.ruleId + m.path} className="mono text-white/45">
                      {m.ruleId} → {m.path} = {m.value}
                    </span>
                  ))}
                  {d.engine.status !== "matches_engine" && d.hint && <span className="text-white/40">{d.hint}</span>}
                </div>
              )}
              <blockquote className={`mt-2.5 border-l-2 pl-2.5 text-[11.5px] leading-snug ${d.quote_verified ? "border-signal-400/50 text-white/75" : "border-warn-400/60 text-white/60"}`}>“{d.quote}”</blockquote>
              <div className={`mt-1.5 flex items-center gap-1.5 text-[10.5px] min-w-0 ${d.quote_verified ? "text-signal-300" : "text-warn-300"}`}>
                {d.quote_verified ? <ShieldCheck size={11} className="shrink-0" /> : <ShieldAlert size={11} className="shrink-0" />}
                <span className="whitespace-nowrap">{d.quote_verified ? "Quote found verbatim on the page" : "Quote not found verbatim — check the page before approving"}</span>
                {d.applies_to && <span className="text-white/40 truncate min-w-0">· applies to: {d.applies_to}</span>}
                {d.note?.startsWith("promoted") && <span className="mono text-signal-300/80 truncate min-w-0" title={d.note}>· {d.note}</span>}
                {d.status !== "pending" && <span className={`ml-auto mono uppercase ${d.status === "approved" ? "text-signal-300" : "text-risk-300"}`}>{d.status}</span>}
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
