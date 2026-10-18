"use client";

// Scenario results: the three impact metrics as stat tiles, the CO₂ timeline
// (baseline vs scenario), and the 4-label assumptions ledger.
// Series colors #d97706 / #0284c7 validated for the dark surface (dataviz checks).

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ScenarioResult } from "@/lib/compass/flow/scenario";
import { formatMoney, type CurrencyCode } from "@/lib/compass/finance/currency";
import { substitutionRisk } from "@/lib/compass/lifecycle/substitution";
import VerdictBadge from "./VerdictBadge";
import CalibrationPanel from "./CalibrationPanel";

const SCENARIO_COLOR = "#d97706";
const BASELINE_COLOR = "#0284c7";

const LABEL_STYLE: Record<string, string> = {
  measured: "bg-emerald-400/15 text-emerald-300",
  "literature-derived": "bg-sky-400/15 text-sky-300",
  "calibrated proxy": "bg-amber-400/15 text-amber-300",
  speculative: "bg-rose-400/15 text-rose-300",
  "policy pathway": "bg-violet-400/15 text-violet-300",
};

export default function TimelinePanel({
  result,
  yearIdx,
  currency = "SGD",
}: {
  result: ScenarioResult;
  yearIdx: number;
  currency?: CurrencyCode;
}) {
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [showCalibration, setShowCalibration] = useState(false);
  const [showMethod, setShowMethod] = useState(false);
  const s = result.summary;
  const money = (usd: number) => formatMoney(usd, currency);

  return (
    <div className="glass rounded-2xl p-4 w-[440px] shadow-panel">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-white/50">
          vs <span className="text-violet-300">{result.policyPathway.label}</span> baseline —
          credited only beyond the planned transition
        </span>
      </div>
      {/* The three impact metrics — golden-focus: put them everywhere. */}
      <div className="grid grid-cols-3 gap-2">
        <Kpi
          label="CO₂ avoided (10 yr)"
          value={`${fmt(s.cumulativeCO2AvoidedTonnes)} t`}
          sub={`${fmt(s.cumulativeCO2AvoidedLow)}–${fmt(s.cumulativeCO2AvoidedHigh)} t · weekday-yr`}
        />
        <Kpi
          label="Cost per tonne"
          value={s.costPerTonneUsd !== null ? money(s.costPerTonneUsd) : "—"}
          sub={`capex ${money(s.capexUsd)}`}
        />
        <Kpi
          label="Heat exposure"
          value={`−${s.heatExposureReducedPct}%`}
          sub={`${fmt(s.tripsShiftedPerDay)} trips/day shift`}
        />
      </div>

      {/* The decision moment: cost-per-tonne → verdict at a glance. */}
      <div className="mt-2 flex items-center justify-between gap-2 bg-white/[0.03] rounded-lg px-2.5 py-1.5">
        <span className="text-[10px] text-white/45">Carbon value of this plan</span>
        <VerdictBadge costPerTonneUsd={s.costPerTonneUsd} />
      </div>

      {/* Lifecycle: net after embodied build carbon + payback year. */}
      {s.embodiedCO2Tonnes > 0 && (
        <div className="mt-2 rounded-lg bg-white/[0.03] px-2.5 py-2">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-white/45">Lifecycle · net after build carbon</span>
            <span className={s.netNegativeOnCarbon ? "text-rose-300" : "text-emerald-300"}>
              {s.netCO2AvoidedTonnes >= 0 ? "+" : ""}{fmt(s.netCO2AvoidedTonnes)} t net
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[9.5px] text-white/40">
            <span>embodied −{fmt(s.embodiedCO2Tonnes)} t (cradle-to-gate)</span>
            <span>
              {s.carbonPaybackYear
                ? `carbon payback ${s.carbonPaybackYear}`
                : s.netNegativeOnCarbon
                  ? "no carbon payback in 10 yr"
                  : "—"}
            </span>
          </div>
          {(() => {
            const risk = substitutionRisk(s);
            if (risk.regrettable)
              return (
                <div className="mt-1.5 rounded-md bg-rose-400/10 border border-rose-400/30 px-2 py-1.5 text-[9px] text-rose-300 leading-snug">
                  ⚠ Regrettable substitution — this shifts the problem, it doesn&apos;t solve it. {risk.reasons[0]}
                </div>
              );
            if (risk.tradeoffNote)
              return (
                <div className="mt-1 text-[9px] text-amber-300/80 leading-snug">{risk.tradeoffNote}</div>
              );
            return null;
          })()}
        </div>
      )}

      {/* Finance (B2G): does it pay back, is it a good deal, does it fit budget. */}
      {s.capexUsd > 0 && (
        <div className="mt-2 rounded-lg bg-white/[0.03] px-2.5 py-2">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-white/45">Finance · {currency}</span>
            <span className={s.socialNpvUsd >= 0 ? "text-emerald-300" : "text-white/60"} title="Social NPV: priced carbon + energy value − capex − O&M, discounted at 4%. Not private-investor NPV.">
              Social NPV {money(s.socialNpvUsd)} @ 4%
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[9.5px] text-white/40">
            <span>build {money(s.capexUsd)} · {s.budgetSharePct}% of budget</span>
            <span className={s.moneyPaybackYear ? "text-emerald-300/80" : ""}>
              {s.moneyPaybackYear ? `pays back ${s.moneyPaybackYear}` : "no cash payback in 10 yr"}
            </span>
          </div>
          {typeof s.benefitCostRatio === "number" && (
            <div className="mt-1 flex items-center justify-between text-[9.5px]" title="Traveller benefit = change in nested-logit logsum ÷ |β_cost| (Small & Rosen 1981): the dollar value of time, cost, comfort and shade gains to people travelling. Benefit–cost ratio = (social NPV + PV traveller benefit + PV cost) ÷ PV cost, all at 4%.">
              <span className="text-white/45">traveller benefit {money(s.userBenefitUsdPerYear ?? 0)}/yr</span>
              <span className={s.benefitCostRatio >= 1 ? "text-emerald-300" : "text-rose-300"}>benefit–cost ratio {s.benefitCostRatio.toFixed(1)}</span>
            </div>
          )}
          {s.equity && (
            <div className="mt-1 flex items-center justify-between text-[9.5px]" title="Who benefits: share of the traveller benefit landing in planning areas weighted by their residents aged 65+ and low-income households (GHS 2025), compared with those groups' share of all trips. ×1.0 = proportional. Area-level attribution, not individuals.">
              <span className="text-white/45">who benefits</span>
              <span className="text-white/70">
                seniors ×{s.equity.seniorIncidenceRatio.toFixed(2)} · low-income ×{s.equity.lowIncomeIncidenceRatio.toFixed(2)}
              </span>
            </div>
          )}
          {!s.moneyPaybackYear && (
            <div className="mt-1 text-[9px] text-white/35 leading-snug">
              Public-good spend — returns are heat/comfort/access, not cash. Solar & EV self-fund; walkways don&apos;t.
            </div>
          )}
        </div>
      )}

      <Chart result={result} yearIdx={yearIdx} />

      <div className="mt-2 flex items-center justify-between text-[10px] text-white/45">
        <span>
          Corridors touched: <span className="text-white/70">{result.affectedEdges}</span> · baseline{" "}
          <span className="text-white/70">{fmt(result.baselineCO2Tpy)} tCO₂/yr</span>
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCalibration(!showCalibration)}
            className="flex items-center gap-1 text-emerald-300/80 hover:text-emerald-300"
            title="HELIO parameters checked against measured Singapore outcomes"
          >
            ✓ Validated {showCalibration ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
          <button
            onClick={() => setShowAssumptions(!showAssumptions)}
            className="flex items-center gap-1 text-white/55 hover:text-white"
          >
            Assumptions {showAssumptions ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
          <button
            onClick={() => setShowMethod(!showMethod)}
            className="flex items-center gap-1 text-white/55 hover:text-white"
            title="How avoided CO₂ is measured + data provenance"
          >
            Method {showMethod ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>
      </div>

      {showCalibration && (
        <div className="mt-2">
          <CalibrationPanel />
        </div>
      )}

      {showAssumptions && (
        <div className="mt-2 max-h-44 overflow-y-auto space-y-1 pr-1">
          {result.assumptions.map((a) => (
            <div key={a.name} className="flex items-start gap-2 text-[10px] bg-white/[0.03] rounded-md px-2 py-1.5">
              <span className={`shrink-0 rounded px-1.5 py-0.5 ${LABEL_STYLE[a.label] ?? "bg-white/10 text-white/60"}`}>
                {a.label}
              </span>
              <span className="text-white/70">
                {a.name}: <span className="text-white/45">{a.value}</span>
                <span className="block text-white/30">{a.source}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {showMethod && (
        <div className="mt-2 text-[9.5px] leading-snug text-white/35 border-t border-white/10 pt-2">
          {result.caveat}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-white/[0.04] rounded-xl px-2.5 py-2">
      <div className="text-[9.5px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="font-display text-lg text-white leading-tight mt-0.5">{value}</div>
      <div className="text-[9.5px] text-white/40 mt-0.5">{sub}</div>
    </div>
  );
}

/** Annual district transport CO₂: baseline vs scenario. The crosshair follows
 *  the global world clock; hovering temporarily inspects other years. */
function Chart({ result, yearIdx }: { result: ScenarioResult; yearIdx: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 408;
  const H = 130;
  const PAD = { l: 40, r: 10, t: 12, b: 18 };

  const geom = useMemo(() => {
    const years = result.timeline.map((t) => t.year);
    const scen = result.timeline.map((t) => t.transportCO2Tonnes);
    const base = result.baselineTimeline.map((t) => t.transportCO2Tonnes);
    const all = [...scen, ...base];
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const span = Math.max(hi - lo, 1);
    const yLo = lo - span * 0.15;
    const yHi = hi + span * 0.15;
    const x = (i: number) => PAD.l + (i / Math.max(years.length - 1, 1)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - yLo) / (yHi - yLo)) * (H - PAD.t - PAD.b);
    const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("");
    return { years, scen, base, x, y, path, yLo, yHi };
  }, [result]);

  const n = geom.years.length;
  const idx = hover ?? Math.max(0, Math.min(yearIdx, n - 1));
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-white/50">District transport CO₂ · tonnes/yr</div>
        <div className="flex items-center gap-3 text-[10px] text-white/55">
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 rounded" style={{ background: BASELINE_COLOR }} /> Baseline
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 rounded" style={{ background: SCENARIO_COLOR }} /> Your scenario
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full mt-1"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* recessive grid */}
        {[0.25, 0.5, 0.75].map((f) => {
          const yy = PAD.t + f * (H - PAD.t - PAD.b);
          return <line key={f} x1={PAD.l} x2={W - PAD.r} y1={yy} y2={yy} stroke="rgba(255,255,255,0.06)" />;
        })}
        {/* axis labels */}
        <text x={PAD.l - 4} y={geom.y(geom.yHi) + 8} textAnchor="end" fontSize="8.5" fill="rgba(255,255,255,0.4)">
          {fmt(Math.round(geom.yHi))}
        </text>
        <text x={PAD.l - 4} y={geom.y(geom.yLo)} textAnchor="end" fontSize="8.5" fill="rgba(255,255,255,0.4)">
          {fmt(Math.round(geom.yLo))}
        </text>
        {geom.years.map((yr, i) =>
          i % 2 === 0 ? (
            <text key={yr} x={geom.x(i)} y={H - 4} textAnchor="middle" fontSize="8.5" fill="rgba(255,255,255,0.4)">
              {yr}
            </text>
          ) : null
        )}
        <path d={geom.path(geom.base)} fill="none" stroke={BASELINE_COLOR} strokeWidth={2} />
        <path d={geom.path(geom.scen)} fill="none" stroke={SCENARIO_COLOR} strokeWidth={2} />
        <g>
          <line
            x1={geom.x(idx)}
            x2={geom.x(idx)}
            y1={PAD.t}
            y2={H - PAD.b}
            stroke="rgba(255,255,255,0.25)"
            strokeDasharray="3 3"
          />
          <circle cx={geom.x(idx)} cy={geom.y(geom.base[idx])} r={3.5} fill={BASELINE_COLOR} stroke="#0a0b0f" strokeWidth={1.5} />
          <circle cx={geom.x(idx)} cy={geom.y(geom.scen[idx])} r={3.5} fill={SCENARIO_COLOR} stroke="#0a0b0f" strokeWidth={1.5} />
          <g transform={`translate(${Math.min(geom.x(idx) + 8, W - 118)}, ${PAD.t + 2})`}>
            <rect width="110" height="42" rx="6" fill="rgba(10,11,15,0.92)" stroke="rgba(255,255,255,0.12)" />
            <text x="8" y="13" fontSize="9" fill="rgba(255,255,255,0.85)" fontWeight="600">
              {geom.years[idx]}
            </text>
            <text x="8" y="25" fontSize="8.5" fill="rgba(255,255,255,0.6)">
              Baseline {fmt(geom.base[idx])} t
            </text>
            <text x="8" y="36" fontSize="8.5" fill="rgba(255,255,255,0.6)">
              Scenario {fmt(geom.scen[idx])} t · −{fmt(Math.round(geom.base[idx] - geom.scen[idx]))}
            </text>
          </g>
        </g>
      </svg>
    </div>
  );
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
