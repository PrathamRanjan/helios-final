"use client";

// Intervention feasibility report — the takeaway artifact. Shows the real
// before / AI-rendered after pair (the hero), the two feasibilities
// (computational + visual), public pulse, impact numbers, and honesty labels.
// "Print / PDF" uses the browser print dialog against a print stylesheet.

import { useEffect, useState } from "react";
import { X, Printer, Loader2, MapPin } from "lucide-react";
import type { InterventionReport, ReportInput } from "@/lib/compass/report/buildReport";
import type { CivicResult } from "@/lib/compass/civic/civicScore";

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

// Open a report either for a cached EV candidate site (siteId) OR for any drawn
// intervention (a ReportInput mapped from a WorldModifier). Exactly one is set.
export default function ReportView({
  siteId,
  intervention,
  onClose,
}: {
  siteId?: string;
  intervention?: ReportInput;
  onClose: () => void;
}) {
  const [report, setReport] = useState<InterventionReport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const body = siteId ? { siteId } : { intervention };
    fetch("/api/compass/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((d) => live && (d.error ? setErr(d.error) : setReport(d)))
      .catch((e) => live && setErr(String(e)));
    return () => {
      live = false;
    };
  }, [siteId, intervention]);

  const civic = report?.civic as CivicResult | undefined;

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4 print:p-0 print:bg-white">
      <div className="report-sheet relative bg-[#0f1117] print:bg-white text-white print:text-black rounded-2xl print:rounded-none w-[820px] max-w-full max-h-[92vh] overflow-y-auto shadow-panel">
        {/* toolbar (hidden in print) */}
        <div className="print:hidden sticky top-0 z-10 flex items-center justify-between px-5 py-3 bg-[#0f1117]/95 backdrop-blur border-b border-white/10">
          <span className="font-display text-sm text-solar-gradient">HELIO feasibility report</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              disabled={!report}
              className="flex items-center gap-1.5 rounded-lg bg-solar-400/90 hover:bg-solar-400 text-black px-3 py-1.5 text-[11px] font-medium disabled:opacity-40"
            >
              <Printer size={12} /> Print / PDF
            </button>
            <button onClick={onClose} className="text-white/50 hover:text-white p-1.5">
              <X size={16} />
            </button>
          </div>
        </div>

        {!report && !err && (
          <div className="flex items-center justify-center gap-2 py-24 text-white/50 text-sm">
            <Loader2 size={16} className="animate-spin" /> Generating report…
          </div>
        )}
        {err && <div className="p-8 text-rose-300 text-sm">Report error: {err}</div>}

        {report && (
          <div className="p-6 print:p-8 space-y-5">
            {/* header */}
            <div>
              <h1 className="font-display text-xl print:text-black">{report.title}</h1>
              <div className="flex items-center gap-1.5 text-[11px] text-white/45 print:text-black/50 mt-1">
                <MapPin size={11} /> {report.location.lat.toFixed(5)}, {report.location.lng.toFixed(5)}
                <span className="ml-2">· {report.generatedAtNote}</span>
              </div>
            </div>

            {/* computational feasibility */}
            {report.computational && (
              <Section title="1 · Why here (computational feasibility)">
                <div className="flex items-center gap-4">
                  {typeof report.computational.score === "number" && (
                    <div className="shrink-0">
                      <div className="font-display text-2xl text-solar-300 print:text-black">
                        {Math.round(report.computational.score * 100)}
                        <span className="text-sm text-white/40 print:text-black/40">/100</span>
                      </div>
                      <div className="text-[9px] uppercase tracking-wide text-white/40 print:text-black/40">site score</div>
                    </div>
                  )}
                  <ul className="text-[11px] text-white/70 print:text-black/70 space-y-0.5 list-disc pl-4">
                    {(report.computational.reasons ?? []).map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
                {report.computational.assetSpec && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(report.computational.assetSpec).map(([k, v]) => (
                      <span key={k} className="rounded-md bg-white/[0.05] print:bg-black/5 px-2 py-0.5 text-[10px] text-white/60 print:text-black/60">
                        {k}: <span className="text-white/85 print:text-black">{String(v)}</span>
                      </span>
                    ))}
                  </div>
                )}
              </Section>
            )}

            {/* before / after — the hero */}
            <Section title="2 · How it would look (before → after)">
              <div className="grid grid-cols-2 gap-3">
                <figure>
                  {report.images.before ? (
                    <img src={report.images.before} alt="before" className="w-full rounded-lg border border-white/10" />
                  ) : (
                    <Placeholder label="no street imagery" />
                  )}
                  <figcaption className="text-[10px] text-white/40 print:text-black/50 mt-1">Today — Google Street View</figcaption>
                </figure>
                <figure>
                  {report.images.after ? (
                    <img src={report.images.after} alt="after" className="w-full rounded-lg border border-solar-400/30" />
                  ) : (
                    <Placeholder label="no render" />
                  )}
                  <figcaption className="text-[10px] text-white/40 print:text-black/50 mt-1">
                    With the intervention — AI visualization
                  </figcaption>
                </figure>
              </div>
            </Section>

            {/* visual feasibility */}
            {report.siting && (
              <Section title="3 · Does it fit (visual feasibility)">
                <div className="flex items-center gap-3 mb-2">
                  <span className="font-display text-lg print:text-black">
                    {Math.round(report.siting.visualFeasibility * 100)}%
                  </span>
                  <span className="text-[11px] text-white/60 print:text-black/70">{report.siting.bestPlacement}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-[11px]">
                  <div>
                    <div className="text-white/40 print:text-black/50 mb-1">Usable space</div>
                    <ul className="space-y-0.5 text-white/70 print:text-black/70">
                      {report.siting.usableSpots.map((s, i) => (
                        <li key={i}>• {s.where} <span className="text-white/35 print:text-black/40">({s.type}{s.estWidthM ? `, ~${s.estWidthM} m` : ""})</span></li>
                      ))}
                      {report.siting.usableSpots.length === 0 && <li className="text-white/35">—</li>}
                    </ul>
                  </div>
                  <div>
                    <div className="text-white/40 print:text-black/50 mb-1">Watch-outs</div>
                    <ul className="space-y-0.5 text-white/70 print:text-black/70">
                      {report.siting.obstructions.map((o, i) => (
                        <li key={i}>• {o}</li>
                      ))}
                      {report.siting.obstructions.length === 0 && <li className="text-white/35">none noted</li>}
                    </ul>
                    <div className="mt-1 text-white/50 print:text-black/60">
                      Pedestrian clearance: {report.siting.pedestrianClearanceOk ? "OK" : "check"}
                    </div>
                  </div>
                </div>
              </Section>
            )}

            {/* public pulse */}
            {civic && (
              <Section title="4 · What residents say (public pulse)">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="font-display text-lg print:text-black">{civic.civicScore}<span className="text-xs text-white/40">/100</span></span>
                  <span className="text-[11px] text-white/60 print:text-black/70">{civic.sentimentWord} · n={civic.nPosts} posts</span>
                </div>
                <div className="space-y-1">
                  {civic.quotes.slice(0, 2).map((q, i) => (
                    <div key={i} className="text-[10.5px] text-white/60 print:text-black/70 italic">“{q.text}”</div>
                  ))}
                </div>
                <div className="text-[9px] text-white/30 print:text-black/40 mt-1">{civic.label}</div>
              </Section>
            )}

            {/* impact */}
            {report.impact && (report.impact.cumulativeCO2AvoidedTonnes ?? 0) > 0 && (
              <Section title="5 · Impact if built">
                <div className="flex gap-6 text-[12px]">
                  <div>
                    <div className="font-display text-lg text-emerald-300 print:text-black">
                      {fmt(report.impact.cumulativeCO2AvoidedTonnes!)} t
                    </div>
                    <div className="text-[9px] uppercase tracking-wide text-white/40 print:text-black/40">
                      CO₂ avoided / {report.impact.horizonYears ?? 10} yr
                    </div>
                  </div>
                  {report.impact.costPerTonneUsd != null && (
                    <div>
                      <div className="font-display text-lg print:text-black">${fmt(report.impact.costPerTonneUsd)}</div>
                      <div className="text-[9px] uppercase tracking-wide text-white/40 print:text-black/40">per tonne</div>
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* provenance footer */}
            <div className="border-t border-white/10 print:border-black/20 pt-3 space-y-0.5">
              {report.labels.map((l, i) => (
                <div key={i} className="text-[9px] text-white/35 print:text-black/50">• {l}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        @media print {
          body * { visibility: hidden; }
          .report-sheet, .report-sheet * { visibility: visible; }
          .report-sheet { position: absolute; left: 0; top: 0; max-height: none !important; box-shadow: none; }
        }
      `}</style>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[10px] uppercase tracking-widest text-white/40 print:text-black/50 mb-1.5">{title}</h2>
      {children}
    </section>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="w-full aspect-[16/10] rounded-lg border border-white/10 bg-white/[0.03] flex items-center justify-center text-[10px] text-white/30">
      {label}
    </div>
  );
}
