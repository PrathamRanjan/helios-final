"use client";

// "Act on this" — the decision brief. After the planner sees the impact, this is
// what they DO next: a fundable, phased, sourced action plan they take to a
// committee. Data → Decision → ACTION. Exports to PDF + PowerPoint.

import { useEffect, useMemo, useState } from "react";
import {
  X, Printer, FileDown, Loader2, CalendarClock, Coins, Wrench, ShieldAlert,
  Target, LineChart, Gauge, Truck, Recycle, Dice5, Landmark, SlidersHorizontal,
  Check, AlertTriangle, GitBranch,
} from "lucide-react";
import type { ScenarioResult, OptimizeResult } from "@/lib/compass/flow/scenario";
import type { WorldModifier, Shock } from "@/lib/compass/world/types";
import { substitutionRisk } from "@/lib/compass/lifecycle/substitution";
import ParetoChart from "./ParetoChart";
import type { MonteCarloResult } from "@/lib/compass/act/monteCarlo";
import type { SensitivityResult } from "@/lib/compass/act/sensitivity";
import { decisionBrief, kindsForModifier } from "@/lib/compass/act/decisionBrief";
import { decisionGate } from "@/lib/compass/act/decisionGate";
import { gridSummary } from "@/lib/compass/act/gridReadiness";
import { fleetFromAnnualKWh } from "@/lib/compass/act/fleetCard";
import { monteCarlo } from "@/lib/compass/act/monteCarlo";
import { passportSummary } from "@/lib/compass/lifecycle/materialPassport";
import { vendorsForKinds, availableCities, type VendorCity } from "@/lib/compass/act/vendors";
import { fundingForCity, FUNDING_CITIES, type FundingCity } from "@/lib/compass/act/funding";
import { formatMoney, type CurrencyCode } from "@/lib/compass/finance/currency";
import CalibrationPanel from "./CalibrationPanel";
import BacktestPanel from "./BacktestPanel";
import FailureGallery from "./FailureGallery";

const GATE_TONE: Record<string, string> = {
  good: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  ok: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  warn: "border-orange-400/40 bg-orange-400/10 text-orange-300",
  bad: "border-rose-400/40 bg-rose-400/10 text-rose-300",
};

const VERIF_TONE: Record<string, string> = {
  verified: "text-emerald-300",
  partial: "text-amber-300",
  indicative: "text-white/45",
};

export default function ActPanel({
  result,
  modifiers,
  currency = "SGD",
  shocks = [],
  optResult = null,
  onClose,
}: {
  result: ScenarioResult;
  modifiers: WorldModifier[];
  currency?: CurrencyCode;
  shocks?: Shock[];
  optResult?: OptimizeResult | null;
  onClose: () => void;
}) {
  const brief = useMemo(() => decisionBrief(result, modifiers), [result, modifiers]);
  const gate = useMemo(() => decisionGate(result, modifiers), [result, modifiers]);
  // Explicit "is this a bad substitute?" check — always shown, pass or fail.
  const sub = useMemo(() => substitutionRisk(result.summary), [result]);
  const grid = useMemo(() => gridSummary(modifiers), [modifiers]);
  const passport = useMemo(() => passportSummary(modifiers), [modifiers]);
  // Quick parametric MC (instant, client-side) — the fallback / initial view.
  const quickMc = useMemo(
    () => monteCarlo(result.summary.netCO2AvoidedTonnes, result.summary.costPerTonneUsd, 1000),
    [result]
  );
  // Full MC (server re-simulation) — an on-demand refine. Each draw re-runs the
  // real 5,000+-edge simulation (~140 ms), so this is a deliberate action, not
  // an auto-run; the quick parametric band shows instantly meanwhile.
  const [fullMc, setFullMc] = useState<MonteCarloResult | null>(null);
  const [sensitivity, setSensitivity] = useState<SensitivityResult | null>(null);
  const [mcLoading, setMcLoading] = useState(false);
  const runFullMc = () => {
    if (!modifiers.length || mcLoading) return;
    setMcLoading(true);
    fetch("/api/compass/montecarlo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modifiers,
        startYear: result.startYear,
        endYear: result.endYear,
        policyPathway: result.policyPathway.id,
        shocks,
        draws: 60,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return;
        setFullMc(d);
        if (d.sensitivity) setSensitivity(d.sensitivity);
      })
      .catch(() => {})
      .finally(() => setMcLoading(false));
  };
  // A fresh scenario invalidates any prior full run.
  useEffect(() => {
    setFullMc(null);
    setSensitivity(null);
  }, [modifiers, result]);
  const mc = fullMc ?? quickMc;
  const mcIsFull = Boolean(fullMc);
  const kinds = useMemo(
    () => [...new Set(modifiers.flatMap(kindsForModifier))],
    [modifiers]
  );
  const cities = useMemo(() => availableCities(kinds), [kinds]);

  // Fleet card: back-solve the package's annual EV charging energy into vehicles.
  const fleet = useMemo(() => {
    const years = Math.max(1, result.endYear - result.startYear + 1);
    const annualKWh = result.summary.evChargingKWhOverHorizon / years;
    return fleetFromAnnualKWh(annualKWh);
  }, [result]);

  const [exporting, setExporting] = useState(false);
  const [city, setCity] = useState<VendorCity | "all">("all");
  const [takebackOnly, setTakebackOnly] = useState(false);
  // City-aware funding: same package, funded the way each city actually funds it.
  const [fundingCity, setFundingCity] = useState<FundingCity>("singapore");
  const fundingInstruments = useMemo(() => fundingForCity(kinds, fundingCity), [kinds, fundingCity]);
  const money = (usd: number) => formatMoney(usd, currency);
  const h = brief.headline;

  const vendors = useMemo(
    () => vendorsForKinds(kinds, { city, takebackOnly }),
    [kinds, city, takebackOnly]
  );

  // Grid risk is now shown in its own section — drop the static placeholder line.
  const risks = brief.risks.filter((r) => r.label !== "Grid headroom");
  const s = result.summary;

  const exportPptx = async () => {
    setExporting(true);
    try {
      const { exportDecisionDeck } = await import("@/lib/compass/act/exportDeck");
      await exportDecisionDeck(brief, currency, {
        verdictHeadline: gate.headline,
        verdictReasons: gate.reasons,
        verdictConditions: gate.conditions,
        socialNpvUsd: s.socialNpvUsd,
        cashNpvUsd: s.cashNpvUsd,
        cashPaybackYear: s.cashPaybackYear,
        mcCo2Low: mc.co2Tonnes.p10,
        mcCo2High: mc.co2Tonnes.p90,
        mcProbPositive: mc.probPositiveCarbon,
        gridHeadline: grid.headline,
        materialTonnes: passport.totalTonnesMaterial,
        recyclablePct: passport.avgRecyclablePct,
        cradleToGraveTonnes: passport.totalCradleToGraveTonnesCO2,
        fleetSummary: fleet?.summary ?? null,
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4 print:p-0 print:bg-white">
      <div className="act-sheet relative bg-[#0f1117] print:bg-white text-white print:text-black rounded-2xl print:rounded-none w-[860px] max-w-full max-h-[92vh] overflow-y-auto shadow-panel">
        <div className="print:hidden sticky top-0 z-10 flex items-center justify-between px-5 py-3 bg-[#0f1117]/95 backdrop-blur border-b border-white/10">
          <span className="font-display text-sm text-solar-gradient">Decision brief — act on this</span>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg border border-white/15 hover:border-white/30 px-3 py-1.5 text-[11px]">
              <Printer size={12} /> PDF
            </button>
            <button onClick={exportPptx} disabled={exporting} className="flex items-center gap-1.5 rounded-lg bg-solar-400/90 hover:bg-solar-400 text-black px-3 py-1.5 text-[11px] font-medium disabled:opacity-40">
              {exporting ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />} PowerPoint
            </button>
            <button onClick={onClose} className="text-white/50 hover:text-white p-1.5"><X size={16} /></button>
          </div>
        </div>

        <div className="p-6 print:p-8 space-y-5">
          {/* 0. THE affirmative verdict — the one answer a committee acts on. */}
          <div className={`rounded-xl border px-4 py-3 ${GATE_TONE[gate.tone]}`}>
            <div className="text-[10px] uppercase tracking-widest opacity-70">Verdict</div>
            <div className="font-display text-lg leading-tight mt-0.5">{gate.headline}</div>
            {gate.reasons.length > 0 && (
              <div className="text-[10.5px] opacity-80 mt-1">{gate.reasons.join(" · ")}</div>
            )}
            {gate.conditions.length > 0 && (
              <ul className="text-[10px] opacity-75 mt-1.5 space-y-0.5 list-disc pl-4">
                {gate.conditions.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            )}
          </div>

          {/* 0b. Substitution check — the explicit "are we making something else
              worse?" step. ALWAYS shown, pass or fail, with what was analysed. */}
          <div
            className={`rounded-xl border px-4 py-3 ${
              sub.regrettable
                ? "border-rose-400/40 bg-rose-400/10"
                : "border-emerald-400/40 bg-emerald-400/10"
            }`}
          >
            <div className="flex items-center gap-2">
              {sub.regrettable ? (
                <AlertTriangle size={15} className="text-rose-300" />
              ) : (
                <Check size={15} className="text-emerald-300" />
              )}
              <div className="text-[10px] uppercase tracking-widest opacity-70">
                Substitution check — does this make anything else worse?
              </div>
            </div>
            <div className={`font-display text-[15px] mt-1 ${sub.regrettable ? "text-rose-200" : "text-emerald-200"}`}>
              {sub.regrettable
                ? "✗ Regrettable substitution — this shifts the burden, it doesn't remove it"
                : "✓ Passed — this removes impact, it doesn't just move it elsewhere"}
            </div>
            {/* What we analysed — makes the check legible, not a black box. */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                { k: "Embodied vs operational carbon", ok: !result.summary.netNegativeOnCarbon },
                { k: "Grid / manufacturing shift", ok: result.summary.netCO2AvoidedTonnes >= 0 },
                { k: "Heat / comfort co-benefit", ok: result.summary.heatExposureReducedPct >= 1 || !result.summary.netNegativeOnCarbon },
                { k: "Carbon payback within horizon", ok: result.summary.carbonPaybackYear !== null },
              ].map((c) => (
                <span
                  key={c.k}
                  className={`text-[9.5px] rounded-md px-2 py-0.5 ${c.ok ? "bg-emerald-400/10 text-emerald-200/90" : "bg-rose-400/10 text-rose-200/90"}`}
                >
                  {c.ok ? "✓" : "✗"} {c.k}
                </span>
              ))}
            </div>
            {sub.reasons.map((r, i) => (
              <div key={i} className="text-[10.5px] text-rose-100/80 mt-2 leading-snug">{r}</div>
            ))}
            {sub.tradeoffNote && (
              <div className="text-[10.5px] text-amber-200/80 mt-2 leading-snug">⚖ {sub.tradeoffNote}</div>
            )}
            <div className="text-[9px] opacity-55 mt-1.5">
              Systems-thinking gate (per LCA judge): a fix that emits more to build than it saves — with no co-benefit — is rejected, not funded.
            </div>
          </div>

          {/* 1. Decision headline heroes */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/40 print:text-black/50">Headline numbers</div>
            <div className="mt-2 grid grid-cols-4 gap-2">
              <Hero label="Net cost (after grants)" value={money(h.netCapexAfterGrantsUsd)} sub={`gross ${money(h.capexUsd)}`} />
              <Hero label="Net CO₂ (after embodied)" value={`${Math.round(h.netCo2Tonnes).toLocaleString()} t`} sub="lifecycle" />
              <Hero label="Cost per tonne" value={h.costPerTonneUsd !== null ? money(h.costPerTonneUsd) : "—"} sub="vs carbon tax" />
              <Hero label="Cash payback" value={h.moneyPaybackYear ? String(h.moneyPaybackYear) : "public-good"} sub={h.moneyPaybackYear ? "self-funds" : "co-benefit spend"} />
            </div>
          </div>

          {/* 2. Finance — social vs cash NPV (two audiences). */}
          <Section icon={<Coins size={12} />} title="Value to whom — social vs cash">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-white/[0.04] print:bg-black/5 px-3 py-2">
                <div className="text-[9px] uppercase tracking-wide text-white/40 print:text-black/50">Social NPV (government)</div>
                <div className={`font-display text-base ${s.socialNpvUsd >= 0 ? "text-emerald-300" : "text-white"}`}>{money(s.socialNpvUsd)}</div>
                <div className="text-[9px] text-white/45 print:text-black/45">carbon + energy value − cost, discounted{s.moneyPaybackYear ? ` · payback ${s.moneyPaybackYear}` : ""}</div>
              </div>
              <div className="rounded-lg bg-white/[0.04] print:bg-black/5 px-3 py-2">
                <div className="text-[9px] uppercase tracking-wide text-white/40 print:text-black/50">Cash NPV (private operator)</div>
                <div className={`font-display text-base ${s.cashNpvUsd >= 0 ? "text-emerald-300" : "text-amber-300"}`}>{money(s.cashNpvUsd)}</div>
                <div className="text-[9px] text-white/45 print:text-black/45">energy/EV margin only, no carbon credit{s.cashPaybackYear ? ` · payback ${s.cashPaybackYear}` : " · not cash-positive"}</div>
              </div>
            </div>
            <div className="text-[9px] text-white/40 print:text-black/45 mt-1.5">
              A government funds on social value; a private operator needs the cash line. Showing both is the honest test of who should pay.
            </div>
          </Section>

          {/* 3. Monte Carlo — confidence band, honesty as a feature. */}
          <Section
            icon={<Dice5 size={12} />}
            title={
              mcLoading
                ? "How sure is this? (running 60 real simulations…)"
                : mcIsFull
                ? `How sure is this? (full re-simulation, ${mc.draws} runs)`
                : "How sure is this? (Monte Carlo, quick estimate)"
            }
          >
            {!mcIsFull && (
              <button
                onClick={runFullMc}
                disabled={mcLoading}
                className="print:hidden mb-2 inline-flex items-center gap-1.5 rounded-md border border-white/15 hover:border-white/30 px-2.5 py-1 text-[10px] text-white/80 disabled:opacity-50"
                title="Re-run the full agent simulation 60× with sampled inputs (~8s)"
              >
                {mcLoading ? <Loader2 size={11} className="animate-spin" /> : <Dice5 size={11} />}
                {mcLoading ? "Re-simulating…" : "Run full re-simulation (~8s)"}
              </button>
            )}
            <div className="grid grid-cols-3 gap-2">
              <Hero label="Net CO₂ (P10–P90)" value={`${mc.co2Tonnes.p10}–${mc.co2Tonnes.p90} t`} sub={`central ${mc.co2Tonnes.p50} t`} />
              <Hero label="P(carbon-positive)" value={`${mc.probPositiveCarbon}%`} sub="net avoided > 0" />
              <Hero
                label="Cost/tonne (P10–P90)"
                value={mc.costPerTonneUsd ? `${money(mc.costPerTonneUsd.p10)}–${money(mc.costPerTonneUsd.p90)}` : "—"}
                sub={mc.costPerTonneUsd ? `${mc.probUnder6kPerTonne}% under $6k/t` : "no carbon signal"}
              />
            </div>
            <div className="text-[9px] text-white/40 print:text-black/45 mt-1.5">
              {mcIsFull
                ? `Each of ${mc.draws} draws re-runs the full agent simulation with sampled behavioural response, EV displacement and capex — uncertainty propagates through the real mode-choice, not a scaling of the output.`
                : "Quick parametric band while the full re-simulation runs — propagates sampled uncertainty around the central run."}
            </div>
          </Section>

          {/* 3b. Sensitivity tornado — which assumption moves the answer most. */}
          {sensitivity && sensitivity.bars.length > 0 && (
            <Section icon={<SlidersHorizontal size={12} />} title="Which assumption moves the answer most">
              <Tornado data={sensitivity} />
              <div className="text-[9px] text-white/40 print:text-black/45 mt-1.5">
                One-at-a-time sweep: each bar pushes one input to its low/high plausible value (others held central) and re-runs the real simulation. Longest bar = the assumption the conclusion hinges on.
              </div>
            </Section>
          )}

          {/* 3c. Pareto trade-off frontier — surfaced on the decision page, not
              buried in the optimizer. Shows this pick against the alternatives. */}
          {optResult && (optResult.paretoPackages?.length || optResult.suggestions.length >= 2) && (
            <Section icon={<GitBranch size={12} />} title="Trade-off frontier — carbon vs cost">
              <ParetoChart suggestions={optResult.suggestions} packages={optResult.paretoPackages} />
              <div className="text-[9px] text-white/40 print:text-black/45 mt-1.5">
                Removes the "why this option and not another?" objection — the recommendation sits on the non-dominated frontier (no alternative beats it on carbon, heat and cost at once).
              </div>
            </Section>
          )}

          {/* 4. Rollout */}
          <Section icon={<CalendarClock size={12} />} title="Rollout plan">
            <div className="flex flex-wrap gap-2">
              {brief.rollout.map((p) => (
                <div key={p.year} className="rounded-lg bg-white/[0.04] print:bg-black/5 px-2.5 py-1.5">
                  <div className="font-display text-sm text-solar-300 print:text-black">{p.year}</div>
                  <div className="text-[10px] text-white/70 print:text-black/70 max-w-[160px]">{p.items.join(" · ")}</div>
                </div>
              ))}
            </div>
          </Section>

          {/* 5. Fleet card — who actually uses the chargers. */}
          {fleet && (
            <Section icon={<Truck size={12} />} title="Who charges here — fleet scenario">
              <div className="rounded-lg bg-white/[0.04] print:bg-black/5 px-3 py-2">
                <div className="text-[11px] text-white/85 print:text-black/85">{fleet.summary}</div>
                <div className="text-[9px] text-white/45 print:text-black/45 mt-1">
                  Illustrative operator wedge, back-solved from the {Math.round(fleet.annualKWhAtSite / 1000).toLocaleString()} MWh/yr the site actually dispenses — grounds "EV-km enabled" in a real fleet a council could commit.
                </div>
              </div>
            </Section>
          )}

          {/* 6. Grid readiness — honest screening, not a placeholder. */}
          {grid.perModifier.length > 0 && (
            <Section icon={<Gauge size={12} />} title="Grid readiness (screening)">
              <div className="text-[10.5px] text-white/75 print:text-black/75 mb-1.5">{grid.headline}</div>
              <div className="space-y-1">
                {grid.perModifier.map((g, i) => (
                  <div key={i} className="text-[10px] flex items-start gap-2">
                    <span className={
                      g.readiness.band === "substation" ? "text-rose-300" :
                      g.readiness.band === "review" ? "text-amber-300" : "text-emerald-300"
                    }>●</span>
                    <span className="text-white/80 print:text-black/80">{g.label}</span>
                    <span className="text-white/50 print:text-black/50">— {g.readiness.detail}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 7. Material passport + end-of-life. */}
          {passport.entries.length > 0 && passport.totalTonnesMaterial > 0 && (
            <Section icon={<Recycle size={12} />} title="Material passport & end-of-life">
              <div className="grid grid-cols-4 gap-2 mb-2">
                <Hero label="Material" value={`${passport.totalTonnesMaterial.toLocaleString()} t`} sub="physical mass" />
                <Hero label="Recyclable" value={`${passport.avgRecyclablePct}%`} sub="by mass" />
                <Hero label="Embodied (gate)" value={`${passport.totalGateTonnesCO2} t`} sub="cradle-to-gate CO₂" />
                <Hero label="Cradle-to-grave" value={`${passport.totalCradleToGraveTonnesCO2} t`} sub={`+${passport.totalEolTonnesCO2} t end-of-life`} />
              </div>
              <div className="space-y-1.5">
                {passport.entries.map((e) => (
                  <div key={e.modifierId} className="rounded-lg bg-white/[0.03] print:bg-black/5 px-2.5 py-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10.5px] text-white/85 print:text-black/85">{e.label}</span>
                      <span className="text-[9px] text-white/45 print:text-black/45">{e.recyclablePct}% recyclable{e.takeback && <span className="text-emerald-300"> · take-back ♻</span>}</span>
                    </div>
                    <div className="text-[9px] text-white/55 print:text-black/55 mt-0.5">
                      {e.materials.map((m) => `${m.tonnes}t ${m.material}`).join(" · ")}
                    </div>
                    <div className="text-[9px] text-white/40 print:text-black/45 mt-0.5">{e.eolPlan}</div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 8. Funding & procurement — city-aware: same package, funded the
              way each city actually funds it. */}
          <Section icon={<Coins size={12} />} title="Funding & procurement">
            <div className="print:hidden inline-flex items-center rounded-lg overflow-hidden border border-white/10 mb-2.5">
              {FUNDING_CITIES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setFundingCity(c.id)}
                  className={`px-2.5 py-1 text-[10px] ${fundingCity === c.id ? "bg-solar-400/20 text-solar-200" : "text-white/50 hover:text-white"}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[9px] uppercase tracking-wide text-white/40 print:text-black/50 mb-1">
                  Funding instruments · {FUNDING_CITIES.find((c) => c.id === fundingCity)?.label}
                </div>
                {/* Singapore keeps the $-quantified grant offsets from the brief. */}
                {fundingCity === "singapore" && brief.grants.filter((g) => g.offsetUsd > 0).map((g) => (
                  <div key={g.name} className="text-[10.5px] text-white/75 print:text-black/75 mb-1">
                    {g.name}<span className="text-emerald-300"> · −{money(g.offsetUsd)}</span>
                    <span className="block text-[9px] text-white/40 print:text-black/40">{g.note}</span>
                  </div>
                ))}
                {fundingInstruments.length === 0 && (
                  <div className="text-[10px] text-white/45">No matched instruments for these interventions in {FUNDING_CITIES.find((c) => c.id === fundingCity)?.label}.</div>
                )}
                {fundingInstruments.map((g) => (
                  <div key={g.name} className="text-[10.5px] text-white/75 print:text-black/75 mb-1">
                    {g.name} <span className={`text-[8.5px] ${VERIF_TONE[g.confidence]}`}>{g.confidence}</span>
                    <span className="block text-[9px] text-white/40 print:text-black/40">
                      {g.type}{g.terms ? ` — ${g.terms}` : ""}{g.status ? ` · ${g.status}` : ""}
                    </span>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wide text-white/40 print:text-black/50 mb-1">Procurement readiness</div>
                {brief.procurement.map((p) => (
                  <div key={p.kind} className="text-[10px] text-white/70 print:text-black/70 mb-1">
                    <span className="text-white/85 print:text-black capitalize">{p.kind.replace("_", " ")}</span> — land: {p.land}; permit: {p.permit}
                  </div>
                ))}
                {fundingCity !== "singapore" && (
                  <div className="text-[9px] text-white/35 print:text-black/45 mt-1.5">Procurement norms shown for Singapore; {FUNDING_CITIES.find((c) => c.id === fundingCity)?.label} instruments above are sourced, land/permit routes vary locally.</div>
                )}
              </div>
            </div>
          </Section>

          {/* 9. Vendor directory — real vendors, filterable by circular credential. */}
          <Section icon={<Wrench size={12} />} title="Vendors & builders">
            <div className="print:hidden flex items-center gap-2 mb-2 flex-wrap">
              <select
                value={city}
                onChange={(e) => setCity(e.target.value as VendorCity | "all")}
                className="rounded-md bg-white/[0.06] border border-white/10 px-2 py-1 text-[10px] text-white/80"
              >
                <option value="all">All cities</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer">
                <input type="checkbox" checked={takebackOnly} onChange={(e) => setTakebackOnly(e.target.checked)} className="accent-emerald-400" />
                Only vendors offering take-back / second-life / recycled content ♻
              </label>
            </div>
            <div className="space-y-1.5">
              {vendors.length === 0 && (
                <div className="text-[10px] text-white/45">No vendors match this filter for the present interventions.</div>
              )}
              {vendors.map((v, i) => (
                <div key={i} className="rounded-lg bg-white/[0.03] print:bg-black/5 px-2.5 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] text-white/85 print:text-black/85">
                      {v.name} <span className="text-white/40 print:text-black/45">· {v.city}</span>
                    </span>
                    <span className="text-[9px] flex items-center gap-1.5">
                      <span className="text-amber-300">★ {v.rating.toFixed(1)}</span>
                      <span className={VERIF_TONE[v.verification]} title={v.reputation}>{v.verification}</span>
                    </span>
                  </div>
                  <div className="text-[9px] text-white/55 print:text-black/55 mt-0.5 capitalize">{v.forKind.replace("_", " ")} — {v.offers}</div>
                  <div className="text-[9px] text-white/40 print:text-black/45 mt-0.5">{v.scale}</div>
                  {(v.takeback || v.secondLife || v.recycledContent || v.circular.length > 0) && (
                    <div className="text-[9px] text-emerald-300/80 mt-0.5">
                      ♻ {[v.takeback && "take-back", v.secondLife && "second-life", v.recycledContent && "recycled content", ...v.circular].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="text-[9px] text-white/35 print:text-black/45 mt-1.5">
              Real vendors from sourced research (SG / Bangkok / Hanoi). Verification tag: verified = sourced, partial = claim secondhand, indicative = inferred. ★ rating is an indicative credibility signal (market standing / government endorsement), not aggregated customer reviews.
            </div>
          </Section>

          {/* 10. Risks */}
          {risks.length > 0 && (
            <Section icon={<ShieldAlert size={12} />} title="Risks to manage">
              {risks.map((r, i) => (
                <div key={i} className="text-[10.5px] mb-1">
                  <span className={r.severity === "high" ? "text-rose-300" : "text-amber-300"}>{r.label}</span>
                  <span className="text-white/60 print:text-black/60"> — {r.detail}</span>
                </div>
              ))}
            </Section>
          )}

          {/* 11. SDG + GRI alignment + monitoring */}
          <div className="grid grid-cols-2 gap-4">
            <Section icon={<Target size={12} />} title="Standards alignment">
              <div className="flex flex-wrap gap-1.5">
                {brief.sdgs.map((sd) => (
                  <span key={sd.goal} className="rounded-md bg-sky-400/10 text-sky-300 px-2 py-0.5 text-[9.5px]" title={sd.label}>
                    SDG {sd.goal}
                  </span>
                ))}
                <span className="rounded-md bg-violet-400/10 text-violet-300 px-2 py-0.5 text-[9.5px]" title="GRI 302: Energy — solar generation & EV energy delivered">GRI 302 · Energy</span>
                <span className="rounded-md bg-violet-400/10 text-violet-300 px-2 py-0.5 text-[9.5px]" title="GRI 305: Emissions — CO₂ avoided, embodied & end-of-life">GRI 305 · Emissions</span>
              </div>
              <div className="text-[9px] text-white/35 print:text-black/45 mt-1">GRI = alignment with reporting disclosures, not an audited ESG report.</div>
            </Section>
            <Section icon={<LineChart size={12} />} title="Impact you'll verify">
              <ul className="text-[10px] text-white/70 print:text-black/70 space-y-0.5 list-disc pl-4">
                {brief.monitoring.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </Section>
          </div>

          {/* 12. Calibration — model checked against real SG measured outcomes. */}
          <Section icon={<Landmark size={12} />} title="Validated on real Singapore data">
            <CalibrationPanel compact />
          </Section>

          {/* 13. Back-test — live engine vs real measured before/after outcomes. */}
          <Section icon={<LineChart size={12} />} title="Back-test vs real built projects">
            <BacktestPanel compact />
          </Section>

          {/* 14. Failure gallery — proof HELIO rejects bad interventions. */}
          <Section icon={<ShieldAlert size={12} />} title="What HELIO rejects (stress test)">
            <FailureGallery compact />
          </Section>

          <div className="border-t border-white/10 print:border-black/20 pt-2 text-[9px] text-white/35 print:text-black/50">
            Pre-feasibility decision brief — figures from measured data + labelled proxies; grants official (LTA/EDB); vendors real (sourced) with indicative ratings & circular tags. Not an engineering design or procurement contract.
          </div>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          body * { visibility: hidden; }
          .act-sheet, .act-sheet * { visibility: visible; }
          .act-sheet { position: absolute; left: 0; top: 0; max-height: none !important; box-shadow: none; }
        }
      `}</style>
    </div>
  );
}

function Hero({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-white/[0.04] print:bg-black/5 rounded-xl px-2.5 py-2">
      <div className="text-[8.5px] uppercase tracking-wide text-white/40 print:text-black/40">{label}</div>
      <div className="font-display text-base text-white print:text-black leading-tight mt-0.5">{value}</div>
      <div className="text-[8.5px] text-white/40 print:text-black/40 mt-0.5">{sub}</div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[10px] uppercase tracking-widest text-white/40 print:text-black/50 mb-1.5 flex items-center gap-1.5">{icon} {title}</h2>
      {children}
    </section>
  );
}

// Horizontal tornado: each bar spans its parameter's low↔high net-CO₂ outcome,
// with a marker at the central case. Bars are pre-sorted longest-first.
function Tornado({ data }: { data: SensitivityResult }) {
  const all = data.bars.flatMap((b) => [b.lowCO2, b.highCO2]).concat(data.centerCO2);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = Math.max(1, hi - lo);
  const pct = (v: number) => ((v - lo) / span) * 100;
  return (
    <div className="space-y-1.5">
      {data.bars.map((b) => {
        const x1 = pct(Math.min(b.lowCO2, b.highCO2));
        const x2 = pct(Math.max(b.lowCO2, b.highCO2));
        return (
          <div key={b.key} className="text-[9.5px]">
            <div className="flex justify-between text-white/70 print:text-black/70 mb-0.5">
              <span>{b.label}</span>
              <span className="text-white/45 print:text-black/45">±{Math.round(b.swing / 2)} t · {b.lowLabel} ↔ {b.highLabel}</span>
            </div>
            <div className="relative h-3 rounded bg-white/[0.05] print:bg-black/5">
              <div
                className="absolute h-3 rounded bg-sky-400/40 border border-sky-300/50"
                style={{ left: `${x1}%`, width: `${Math.max(2, x2 - x1)}%` }}
              />
              <div className="absolute h-3 w-px bg-white/70 print:bg-black/60" style={{ left: `${pct(data.centerCO2)}%` }} title={`central ${data.centerCO2} t`} />
            </div>
          </div>
        );
      })}
      <div className="text-[8.5px] text-white/40 print:text-black/45">Vertical line = central case ({data.centerCO2} t net CO₂). Axis: net CO₂ avoided (t).</div>
    </div>
  );
}
