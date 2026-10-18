"use client";

// Evidence — how we know HELIO's numbers. Out-of-sample validation of the behaviour model,
// physics checks, estimated adoption curves, the value-of-information decision gate, and the
// provenance of every source. Every figure here is produced by the engine (engine/helios_engine).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, AlertTriangle, PauseCircle, Database, ShieldCheck } from "lucide-react";

// Validated categorical pair for the dark surface (#0f1117): OKLCH L in band, CVD ΔE 23.2.
const C_A = "#b97f00"; // series A — gold
const C_B = "#2a86c8"; // series B — sky

type Tip = { x: number; y: number; lines: string[] } | null;

const usd = (x: number) => {
  const a = Math.abs(x);
  const body = a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${Math.round(a / 1e3)}k` : `$${Math.round(a)}`;
  return x < 0 ? `−${body}` : body;
};
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#0f1117] p-5 shadow-panel">
      <h2 className="font-display text-[17px] text-white">{title}</h2>
      {sub && <p className="mt-1 text-[12.5px] text-white/55 leading-relaxed">{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Stat({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="font-display text-[26px] leading-none text-white">{value}</div>
      <div className="mt-1.5 text-[12px] text-white/70">{label}</div>
      {note && <div className="mt-0.5 text-[11px] text-white/45">{note}</div>}
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex gap-4 text-[11.5px] text-white/70">
      {items.map(([c, l]) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
          {l}
        </span>
      ))}
    </div>
  );
}

function TipBox({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div className="pointer-events-none absolute z-10 rounded-lg border border-white/15 bg-[#151821] px-2.5 py-1.5 text-[11.5px] text-white/85 shadow-panel" style={{ left: tip.x + 12, top: tip.y - 8 }}>
      {tip.lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

/** Grouped bars: calibrated vs baseline error by mode. */
function ErrorBars({ cal, base }: { cal: Record<string, number>; base: Record<string, number> }) {
  const [tip, setTip] = useState<Tip>(null);
  const modes = ["car", "bus", "mrt", "walk", "cycle"];
  const W = 520, H = 200, pad = { l: 34, b: 26, t: 8 };
  const max = Math.max(...modes.map((m) => Math.max(cal[m], base[m]))) * 1.15;
  const gw = (W - pad.l) / modes.length;
  const bw = Math.min(26, gw / 3);
  const y = (v: number) => pad.t + (H - pad.b - pad.t) * (1 - v / max);
  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[0, 1, 2, 3, 4, 5].filter((t) => t <= max).map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W} y1={y(t)} y2={y(t)} stroke="white" strokeOpacity={0.07} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="rgba(255,255,255,0.45)">{t}</text>
          </g>
        ))}
        {modes.map((m, i) => {
          const x0 = pad.l + gw * i + gw / 2 - bw - 1;
          const bars: [number, string, string][] = [[cal[m], C_A, "Calibrated (out-of-sample)"], [base[m], C_B, "Uncalibrated (national share)"]];
          return (
            <g key={m}>
              {bars.map(([v, c, l], k) => {
                const x = x0 + k * (bw + 2);
                const top = y(v);
                const h = Math.max(1, H - pad.b - top);
                return (
                  <g key={k}>
                    <path d={`M${x},${H - pad.b} V${top + 4} Q${x},${top} ${x + 4},${top} H${x + bw - 4} Q${x + bw},${top} ${x + bw},${top + 4} V${H - pad.b} Z`} fill={c} />
                    <rect x={x - 3} y={pad.t} width={bw + 6} height={H - pad.b - pad.t} fill="transparent"
                      onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, lines: [`${m.toUpperCase()} · ${l}`, `${v.toFixed(2)} pp mean abs. error`] })} />
                  </g>
                );
              })}
              <text x={pad.l + gw * i + gw / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="rgba(255,255,255,0.7)">{m}</text>
            </g>
          );
        })}
        <text x={4} y={12} fontSize={10} fill="rgba(255,255,255,0.45)">pp</text>
      </svg>
      <TipBox tip={tip} />
    </div>
  );
}

/** Two-line chart with crosshair: UTCI in sun vs shade by hour of day. */
function UtciChart({ rows }: { rows: any[] }) {
  const [tip, setTip] = useState<Tip>(null);
  const [hi, setHi] = useState<number | null>(null);
  const W = 520, H = 210, pad = { l: 34, r: 14, t: 16, b: 26 };
  const hours = rows.map((r) => r.hour);
  const vals = rows.flatMap((r) => [r.utci_sun, r.utci_shade]);
  const lo = Math.floor(Math.min(...vals) - 1), hiV = Math.ceil(Math.max(...vals) + 1);
  const x = (h: number) => pad.l + ((h - hours[0]) / (hours[hours.length - 1] - hours[0])) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hiV - lo));
  const line = (k: string) => rows.map((r, i) => `${i ? "L" : "M"}${x(r.hour)},${y(r[k])}`).join(" ");
  const bands = [[32, "strong"], [38, "very strong"]] as const;
  const peak = rows.reduce((a, b) => (b.utci_sun > a.utci_sun ? b : a), rows[0]);
  return (
    <div className="relative" onMouseLeave={() => { setTip(null); setHi(null); }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full"
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          let best = rows[0];
          for (const r of rows) if (Math.abs(x(r.hour) - px) < Math.abs(x(best.hour) - px)) best = r;
          setHi(best.hour);
          setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, lines: [`${best.hour}:00 · air ${best.temp_c.toFixed(1)} °C`, `Sun: UTCI ${best.utci_sun.toFixed(1)} °C (MRT ${best.mrt_sun.toFixed(0)})`, `Shade: UTCI ${best.utci_shade.toFixed(1)} °C (MRT ${best.mrt_shade.toFixed(0)})`] });
        }}>
        {bands.map(([v, l]) => v > lo && v < hiV && (
          <g key={l}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="white" strokeOpacity={0.18} strokeDasharray="3 4" />
            <text x={W - pad.r} y={y(v) - 4} textAnchor="end" fontSize={9.5} fill="rgba(255,255,255,0.5)">{l} heat stress ≥ {v} °C</text>
          </g>
        ))}
        {[lo, Math.round((lo + hiV) / 2), hiV].map((t) => (
          <text key={t} x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="rgba(255,255,255,0.45)">{t}</text>
        ))}
        {hours.filter((h) => h % 3 === 1).map((h) => (
          <text key={h} x={x(h)} y={H - 8} textAnchor="middle" fontSize={10.5} fill="rgba(255,255,255,0.6)">{h}:00</text>
        ))}
        {hi !== null && <line x1={x(hi)} x2={x(hi)} y1={pad.t} y2={H - pad.b} stroke="white" strokeOpacity={0.25} />}
        <path d={line("utci_sun")} fill="none" stroke={C_A} strokeWidth={2} />
        <path d={line("utci_shade")} fill="none" stroke={C_B} strokeWidth={2} />
        <text x={x(peak.hour)} y={y(peak.utci_sun) - 7} textAnchor="middle" fontSize={10.5} fill="rgba(255,255,255,0.8)">in sun {peak.utci_sun.toFixed(1)} °C</text>
        <text x={x(peak.hour)} y={y(peak.utci_shade) + 15} textAnchor="middle" fontSize={10.5} fill="rgba(255,255,255,0.8)">in shade {peak.utci_shade.toFixed(1)} °C</text>
      </svg>
      <TipBox tip={tip} />
    </div>
  );
}

/** Observed solar capacity (dots) vs Bass fit (line); held-out years ringed. */
function BassChart({ solar }: { solar: any }) {
  const [tip, setTip] = useState<Tip>(null);
  const obs = Object.entries(solar.observed as Record<string, number>).map(([k, v]) => [Number(k), v] as [number, number]);
  const pop = 6.04;
  const proj = Object.entries(solar.projection_mwp as Record<string, number>).map(([k, v]) => [Number(k), v / pop] as [number, number]).filter(([yr]) => yr <= 2032);
  const holdout = new Set<number>(solar.fit.holdout_years ?? []);
  const W = 520, H = 210, pad = { l: 40, r: 14, t: 10, b: 26 };
  const xs = [...obs.map((d) => d[0]), ...proj.map((d) => d[0])];
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ymax = Math.max(...obs.map((d) => d[1]), ...proj.map((d) => d[1])) * 1.08;
  const x = (v: number) => pad.l + ((v - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / ymax);
  const target = 2000 / pop;
  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <line x1={pad.l} x2={W - pad.r} y1={y(target)} y2={y(target)} stroke="white" strokeOpacity={0.25} strokeDasharray="3 4" />
        <text x={pad.l + 4} y={y(target) - 4} fontSize={9.5} fill="rgba(255,255,255,0.55)">2 GWp Green Plan target (≈{Math.round(target)} W/person)</text>
        {[0, 200, 400].filter((t) => t <= ymax).map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="white" strokeOpacity={0.06} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="rgba(255,255,255,0.45)">{t}</text>
          </g>
        ))}
        {xs.filter((v, i, a) => a.indexOf(v) === i && v % 4 === 0).map((v) => (
          <text key={v} x={x(v)} y={H - 8} textAnchor="middle" fontSize={10.5} fill="rgba(255,255,255,0.6)">{v}</text>
        ))}
        <path d={proj.map(([a, b], i) => `${i ? "L" : "M"}${x(a)},${y(b)}`).join(" ")} fill="none" stroke={C_B} strokeWidth={2} />
        {obs.map(([a, b]) => (
          <g key={a}>
            <circle cx={x(a)} cy={y(b)} r={4.5} fill={C_A} stroke="#0f1117" strokeWidth={2} />
            {holdout.has(a) && <circle cx={x(a)} cy={y(b)} r={8} fill="none" stroke="white" strokeOpacity={0.6} />}
            <circle cx={x(a)} cy={y(b)} r={11} fill="transparent"
              onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, lines: [`${a}: ${b.toFixed(1)} W/person observed (EMA)`, `≈ ${Math.round(b * pop)} MWp`, holdout.has(a) ? "held out of the fit" : "used in the fit"] })} />
          </g>
        ))}
        <text x={4} y={12} fontSize={10} fill="rgba(255,255,255,0.45)">W/person</text>
      </svg>
      <TipBox tip={tip} />
    </div>
  );
}

function Verdict({ v }: { v: string }) {
  const map: Record<string, [React.ElementType, string]> = {
    FUND: [CheckCircle2, "text-emerald-300"],
    STUDY: [AlertTriangle, "text-amber-300"],
    DEFER: [PauseCircle, "text-rose-300"],
  };
  const [Icon, cls] = map[v] ?? [PauseCircle, "text-white/60"];
  return (
    <span className={`inline-flex items-center gap-1 ${cls}`}>
      <Icon size={13} /> {v}
    </span>
  );
}

export default function EvidencePage() {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    fetch("/api/compass/evidence").then((r) => r.json()).then(setD).catch(() => setD({}));
  }, []);

  const temporal = d?.modeChoice?.validation?.temporal_holdout_2020_to_2025;
  const spatial = d?.modeChoice?.validation?.spatial_5fold_from_covariates;
  const cal = temporal?.calibrated_persistence_plus_national_trend;
  const base = temporal?.baseline_national_share;
  const cands = useMemo(() => [...(d?.decision?.candidates ?? [])].sort((a: any, b: any) => b.netBenefit.mean - a.netBenefit.mean), [d]);
  const port = d?.decision?.portfolios?.["w=0.5"];

  return (
    <div className="min-h-screen bg-bg text-white">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Link href="/helio-flow" className="inline-flex items-center gap-1.5 text-[12.5px] text-white/60 hover:text-white">
          <ArrowLeft size={14} /> Back to the sandbox
        </Link>
        <h1 className="mt-3 font-display text-[30px] leading-tight">Evidence</h1>
        <p className="mt-1 max-w-3xl text-[13.5px] text-white/60">
          How we know HELIO&apos;s numbers. Models are fitted on one dataset and tested on another they never saw;
          physics is checked against measurements; every source is listed with its date.
        </p>

        {!d && <p className="mt-10 text-white/50">Loading…</p>}

        {d && (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat value={cal ? `${cal.weighted_mae_pp.toFixed(2)} pp` : "—"} label="Mode-share error, out of sample" note={base ? `vs ${base.weighted_mae_pp.toFixed(2)} pp uncalibrated (2020 → 2025)` : undefined} />
              <Stat value={d.heat?.validation ? `${d.heat.validation.mae_c} °C` : "—"} label="Weather-input error" note={d.heat?.validation ? `wet-bulb vs NEA, ${d.heat.validation.n_hours.toLocaleString()} hours` : undefined} />
              <Stat value={d.energy?.solar ? `${d.energy.solar.fit.holdout_mape.toFixed(0)}%` : "—"} label="Solar adoption forecast error" note="3 held-out years (fit to 2022)" />
              <Stat value={d.decision ? usd(d.decision.evpiAll) : "—"} label="Value of perfect information" note={d.decision ? (d.decision.evpiAll > 1 ? `what removing all model uncertainty is worth to the choice (${d.decision.nSamples} draws)` : `$0 = no plausible parameter changes the best choice (${d.decision.nSamples} draws)`) : undefined} />
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              {cal && base && (
                <Card title="Behaviour model: fitted on 2020, tested on 2025" sub={`Nested logit with planning-area constants fitted to Census 2020, then asked to predict the 2025 General Household Survey. Mean absolute error in mode share by mode, weighted by workers across ${cal.n_areas} planning areas. Rank correlation across areas: car ${cal.car_rank_corr?.toFixed(2)}, MRT ${cal.mrt_rank_corr?.toFixed(2)}.`}>
                  <Legend items={[[C_A, "Calibrated, out of sample"], [C_B, "Uncalibrated (national share everywhere)"]]} />
                  <ErrorBars cal={cal.by_mode_mae_pp} base={base.by_mode_mae_pp} />
                  {spatial && <p className="mt-2 text-[11.5px] text-white/50">Spatial check (5-fold, areas predicted from income, dwelling mix, seniors, commute time and rail access only): {spatial.calibrated.weighted_mae_pp.toFixed(2)} pp vs {spatial.baseline_national_share.weighted_mae_pp.toFixed(2)} pp.</p>}
                </Card>
              )}

              {d.heat?.utciByHour && (
                <Card title="Heat physics: what a pedestrian feels, sun vs shade" sub={`UTCI from NEA 2024 hourly temperature, humidity and wind plus solar radiant load (SolarCal). Shade per corridor from a sun-position ray-cast over ${d.heat.buildings.toLocaleString()} buildings (${d.heat.osmHeights.toLocaleString()} with measured heights). Corridor shade: median ${d.heat.shadeStats ? pct(d.heat.shadeStats.p50) : "—"}, P10–P90 ${d.heat.shadeStats ? `${pct(d.heat.shadeStats.p10)}–${pct(d.heat.shadeStats.p90)}` : "—"}.`}>
                  <Legend items={[[C_A, "UTCI in full sun"], [C_B, "UTCI in building shade"]]} />
                  <UtciChart rows={d.heat.utciByHour} />
                </Card>
              )}

              {d.energy?.solar && (
                <Card title="Solar adoption: estimated, not assumed" sub={`Bass diffusion fitted to EMA installed capacity (p = ${d.energy.solar.fit.p.toFixed(4)}, q = ${d.energy.solar.fit.q.toFixed(2)}). Ringed years were held out: the curve fitted to 2022 under-predicted the recent surge, so Singapore is adopting faster than its earlier S-curve implied. 2025 observed ≈ ${Math.round(d.energy.solar.observed["2025"] * 6.04)} MWp.`}>
                  <Legend items={[[C_A, "Observed (EMA)"], [C_B, "Bass fit and projection"]]} />
                  <BassChart solar={d.energy.solar} />
                </Card>
              )}

              {d.energy?.pv && (
                <Card title="Energy: physics-grade PV and charging time" sub="Temperature-corrected PV from NEA 2024 hourly temperatures, calibrated to SolarNova measured yield.">
                  <div className="grid grid-cols-3 gap-3">
                    <Stat value={`${d.energy.pv.annual_kwh_per_kwp}`} label="kWh per kWp a year" note="matches SolarNova measured" />
                    <Stat value={`${d.energy.pv.temperature_loss_pct}%`} label="Lost to tropical heat" note={`cells peak ~${d.energy.pv.peak_cell_temp_c} °C`} />
                    <Stat value={d.energy.dispatchVn ? `${d.energy.dispatchVn.atStakePct.toFixed(1)}%` : "—"} label="Charging carbon set by timing" note={`coal grid; ${d.energy.dispatchSg?.atStakePct.toFixed(1)}% on SG gas grid`} />
                  </div>
                  <p className="mt-3 text-[12px] leading-relaxed text-white/60">{d.energy.dispatchInsight}</p>
                  {d.energy.ev && (
                    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[12px] leading-relaxed text-white/70">
                      <b className="text-white">EVs are arriving faster than the plan assumes.</b> LTA counts {d.energy.ev.latest.electric.toLocaleString()} electric vehicles ({pct(d.energy.ev.latest.electric / d.energy.ev.latest.total, 1)} of the fleet, {d.energy.ev.latest.date}).
                      Fitted adoption puts the EV share at {pct(d.energy.ev.band.central.share_2030)} in 2030 (band {pct(d.energy.ev.band.low.share_2030)}–{pct(d.energy.ev.band.high.share_2030)}), which implies a car emission factor of {d.energy.ev.carEfData["2030"]} g/pkm in 2030 against the pathway&apos;s {d.energy.ev.carEfPathway["2030"]}.
                      Cleaner cars mean mode shift saves somewhat less carbon, so HELIO offers an <b className="text-white">LTA EV trend</b> pathway alongside the Green Plan ones.
                    </div>
                  )}
                </Card>
              )}
            </div>

            {cands.length > 0 && (
              <div className="mt-5">
                <Card title="Decision gate: FUND · STUDY · DEFER with a dollar value on uncertainty" sub={`Each option run through the full simulator ${d.decision.nSamples} times while six uncertain model parameters vary together (Latin hypercube with correlation). Net benefit = carbon + energy value + traveller welfare − cost (present value). STUDY appears only when resolving a parameter is worth more than the study that would resolve it.`}>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-[12.5px]">
                      <thead className="text-[11px] uppercase tracking-wide text-white/45">
                        <tr className="border-b border-white/10">
                          <th className="py-2 pr-3 font-normal">Option</th>
                          <th className="py-2 pr-3 font-normal">Verdict</th>
                          <th className="py-2 pr-3 text-right font-normal">Capex</th>
                          <th className="py-2 pr-3 text-right font-normal">Expected net benefit</th>
                          <th className="py-2 pr-3 text-right font-normal">P10 to P90</th>
                          <th className="py-2 pr-3 text-right font-normal">Chance of loss</th>
                          <th className="py-2 font-normal">What it hinges on</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cands.map((c: any) => {
                          const top = Object.entries(c.sobol as Record<string, { ST: number }>).sort((a, b) => b[1].ST - a[1].ST)[0];
                          return (
                            <tr key={c.id} className="border-b border-white/5 align-top">
                              <td className="py-2 pr-3 text-white/85">{c.label}</td>
                              <td className="py-2 pr-3"><Verdict v={c.gate.verdict} /></td>
                              <td className="py-2 pr-3 text-right text-white/70">{usd(c.capexUsd)}</td>
                              <td className="py-2 pr-3 text-right text-white">{usd(c.netBenefit.mean)}</td>
                              <td className="py-2 pr-3 text-right text-white/60">{usd(c.netBenefit.p10)} to {usd(c.netBenefit.p90)}</td>
                              <td className="py-2 pr-3 text-right text-white/70">{pct(c.gate.p_net_loss)}</td>
                              <td className="py-2 text-white/60">{top ? `${top[0]} (${pct(top[1].ST)} of variance)` : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {d.decision.evpiAll > 0 && (() => {
                    const [p, v] = Object.entries(d.decision.evppiAll as Record<string, number>).sort((a, b) => b[1] - a[1])[0];
                    const cost = d.decision.studyCost?.[p];
                    return (
                      <div className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/[0.05] px-4 py-3 text-[12.5px] leading-relaxed text-white/80">
                        <span className="inline-flex items-center gap-1 text-amber-300"><AlertTriangle size={13} /> STUDY before choosing between options.</span>{" "}
                        Perfect information about all six parameters would be worth {usd(d.decision.evpiAll)} to this choice. Most of it, {usd(v)}, comes from one: <b className="text-white">{p}</b>.
                        {cost ? ` A study that resolves it costs about ${usd(cost)}, so it pays for itself ${(v / cost).toFixed(1)}× over.` : ""}
                      </div>
                    );
                  })()}
                  {port && (
                    <p className="mt-3 text-[12px] leading-relaxed text-white/60">
                      Risk-aware package (mean–CVaR, budget {usd(d.decision.budgetUsd)}): {port.ids.length} options, expected {usd(port.expected_net_benefit)}, worst-10% average {usd(port.cvar)}.
                      {port.joint_check && ` Re-simulated together, the package differs from the sum of its parts by ${port.joint_check.interaction_pct.toFixed(1)}%, so interactions are small.`}
                      {d.decision.regret && ` Across the four Green Plan pathways, the minimum-regret first pick is ${cands.find((c: any) => c.id === d.decision.regret.minimaxChoice)?.label ?? d.decision.regret.minimaxChoice}.`}
                    </p>
                  )}
                </Card>
              </div>
            )}

            <div className="mt-5">
              <Card title="Sources" sub="Every dataset the engine ingested, with the period it covers. Anything more than 3 years old is flagged.">
                <ul className="grid gap-1.5 text-[12.5px] sm:grid-cols-2">
                  {(d.provenance ?? []).map((p: any) => (
                    <li key={p.key} className="flex items-start gap-2">
                      <Database size={13} className="mt-0.5 shrink-0 text-white/40" />
                      <span>
                        <a href={p.url} target="_blank" rel="noreferrer" className="text-white/85 hover:text-white">{p.title || p.key}</a>
                        <span className="text-white/45"> · {p.source}{p.asOf ? ` · to ${p.asOf}` : ""}</span>
                        {p.stale && <span className="ml-1 text-amber-300">· stale</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] text-white/45"><ShieldCheck size={13} /> Engine checks: 50 simulator invariants · Python unit and reference tests run on every change.</p>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
