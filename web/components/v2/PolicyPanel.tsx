"use client";

// "What flips if policy changes?" — the carbon price under the law vs the Government's
// stated 2030 range, applied to (1) a facility's carbon tax, (2) the carbon cost passed
// through in this area's building electricity, and (3) the plan's cost per tonne.
// Every price comes from the rule JSONs; proposed rates are labelled proposed.

import { useMemo, useState } from "react";
import { TrendingUp, Scale, Building2, Loader2 } from "lucide-react";
import { Label, ConfChip, Segmented, fmtInt } from "@/components/v2/ui";
import { carbonPrice, carbonValue, passThroughSgd, PRICE_SCENARIOS, type PriceScenario } from "@/lib/compass/compliance/policy";
import { buildingScope2 } from "@/lib/compass/carbon/ghg";
import { evaluate } from "@/lib/compass/compliance/evaluate";
import { ruleById } from "@/lib/compass/compliance/rules";
import type { ScenarioResult } from "@/lib/compass/world/types";
import { useAreaBcaBuildings } from "@/components/v2/CarbonPanel";

const YEARS = [2026, 2028, 2030, 2032, 2035];
const sgd = (n: number) => `S$${n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : Math.round(n)}`;

export default function PolicyBody({ areaId, areaName, asOf, result, planCount }: { areaId: string; areaName: string; asOf: string; result: ScenarioResult | null; planCount: number }) {
  const [scen, setScen] = useState<PriceScenario>("high");
  const [facility, setFacility] = useState(30000);
  const buildings = useAreaBcaBuildings(areaId);

  const priceGrid = useMemo(() => PRICE_SCENARIOS.map((s) => ({ ...s, row: YEARS.map((y) => carbonPrice(y, s.id)) })), []);

  // Facility carbon tax: the law from the evaluator; the scenario at the rule-file price.
  const facilityRows = useMemo(() => {
    const law = ruleById("sg.carbon_tax.cpa2018");
    const taxable = law ? facility >= ((law.thresholds as any)?.taxable_tco2e ?? Infinity) : false;
    return YEARS.map((y) => {
      const a = law ? evaluate({ facility_tco2e: facility, emissions_year: y }, [law], { asOf: `${y}-06-01` })[0] : null;
      return { y, law: a?.amountSgd ?? 0, scenario: taxable ? facility * carbonPrice(y, scen).sgd : 0, lawSummary: a?.summary };
    });
  }, [facility, scen]);

  // Area buildings: carbon cost embedded in electricity at 2030 prices.
  const pass = useMemo(() => {
    if (!buildings) return null;
    const rows = buildings
      .map((b) => ({ b, g: buildingScope2(b) }))
      .filter((x) => x.g)
      .map(({ b, g }) => ({ name: b.name, t: g!.scope2_t, law: passThroughSgd(g!.scope2_t, 2030, "law"), alt: passThroughSgd(g!.scope2_t, 2030, scen) }));
    const tot = rows.reduce((s, r) => ({ t: s.t + r.t, law: s.law + r.law, alt: s.alt + r.alt }), { t: 0, law: 0, alt: 0 });
    return { rows: rows.sort((a, b) => b.alt - b.law - (a.alt - a.law)).slice(0, 5), tot, n: rows.length };
  }, [buildings, scen]);

  const plan = useMemo(() => (result && planCount ? carbonValue(result) : null), [result, planCount]);
  const sLabel = PRICE_SCENARIOS.find((s) => s.id === scen)!;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[12.5px] text-white">
          <TrendingUp size={14} className="text-warn-400" /> What flips if the carbon price rises
        </div>
        <ConfChip conf="policy pathway" />
      </div>
      <Segmented<PriceScenario> size="xs" options={PRICE_SCENARIOS.map((s) => ({ id: s.id, label: s.label, title: s.hint }))} value={scen} onChange={setScen} />
      <div className="text-[10.5px] text-white/45 leading-snug -mt-2">{sLabel.hint}</div>

      <div>
        <Label>Carbon tax, S$/tCO₂e</Label>
        <table className="w-full text-[11px] mt-1.5">
          <thead>
            <tr className="text-white/40">
              <th className="text-left font-normal py-0.5" />
              {YEARS.map((y) => (
                <th key={y} className="text-right font-normal mono">{y}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {priceGrid.map((s) => (
              <tr key={s.id} className={`border-t border-line/50 ${s.id === scen ? "text-white" : "text-white/55"}`}>
                <td className="py-1">{s.label}</td>
                {s.row.map((p, i) => (
                  <td key={i} className={`py-1 text-right mono ${p.status === "proposed" ? "text-warn-300" : ""}`}>{p.sgd}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-[10px] text-white/35 mt-1">Amber = proposed, not law. The Act sets S$45 from 2026 with no later rate.</div>
      </div>

      <div className="rounded-[4px] border border-line p-3">
        <div className="flex items-center gap-1.5 text-[12px] text-white">
          <Scale size={13} className="text-signal-300" /> A facility's tax bill
        </div>
        <div className="flex items-center gap-2 mt-2 text-[11px]">
          <span className="text-white/50">Direct emissions</span>
          <input type="number" value={facility} step={5000} min={0} onChange={(e) => setFacility(Math.max(0, Number(e.target.value)))} className="mono w-24 h-7 rounded-[4px] border border-line bg-ink-1 px-2 text-white/85" />
          <span className="text-white/40">tCO₂e/yr</span>
        </div>
        <table className="w-full text-[11px] mt-2">
          <thead>
            <tr className="text-white/40">
              <th className="text-left font-normal py-0.5">Year</th>
              <th className="text-right font-normal">Law</th>
              <th className="text-right font-normal">{sLabel.label}</th>
              <th className="text-right font-normal">Change</th>
            </tr>
          </thead>
          <tbody>
            {facilityRows.map((r) => (
              <tr key={r.y} className="border-t border-line/50">
                <td className="py-1 mono text-white/60">{r.y}</td>
                <td className="py-1 text-right mono text-white/80">{sgd(r.law)}</td>
                <td className="py-1 text-right mono text-white/80">{sgd(r.scenario)}</td>
                <td className={`py-1 text-right mono ${r.scenario > r.law ? "text-risk-300" : "text-white/35"}`}>{r.scenario > r.law ? `+${sgd(r.scenario - r.law)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-[10px] text-white/35 mt-1.5 leading-snug">Facilities ≥ 2,000 t must report; ≥ 25,000 t pay. {facilityRows[0]?.lawSummary}</div>
      </div>

      <div className="rounded-[4px] border border-line p-3">
        <div className="flex items-center gap-1.5 text-[12px] text-white">
          <Building2 size={13} className="text-signal-300" /> Carbon cost inside {areaName}'s electricity, 2030
        </div>
        {!pass ? (
          <div className="flex items-center gap-2 py-3 text-[11px] text-white/40">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </div>
        ) : pass.n === 0 ? (
          <div className="text-[11px] text-white/45 mt-2">No BCA-measured buildings here.</div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
              <div>
                <Label>Scope 2</Label>
                <div className="mono text-white/85 mt-0.5">{fmtInt(pass.tot.t)} t</div>
              </div>
              <div>
                <Label>At law</Label>
                <div className="mono text-white/85 mt-0.5">{sgd(pass.tot.law)}/yr</div>
              </div>
              <div>
                <Label>{sLabel.label}</Label>
                <div className={`mono mt-0.5 ${pass.tot.alt > pass.tot.law ? "text-risk-300" : "text-white/85"}`}>{sgd(pass.tot.alt)}/yr</div>
              </div>
            </div>
            {pass.tot.alt > pass.tot.law && (
              <div className="mt-2 space-y-0.5">
                {pass.rows.map((r) => (
                  <div key={r.name} className="flex justify-between text-[11px]">
                    <span className="text-white/65 truncate">{r.name}</span>
                    <span className="mono text-risk-300 shrink-0 ml-2">+{sgd(r.alt - r.law)}/yr</span>
                  </div>
                ))}
              </div>
            )}
            <div className="text-[10px] text-white/35 mt-1.5 leading-snug">
              Approximate: power stations pay the tax and pass it through tariffs, so a building's exposure ≈ its Scope 2 × the price. {pass.n} BCA-measured buildings.
            </div>
          </>
        )}
      </div>

      <div className="rounded-[4px] border border-line p-3">
        <Label>Your plan's cost per tonne, net of carbon value</Label>
        {!plan ? (
          <div className="text-[11px] text-white/45 mt-1.5">Add changes in Plan and simulate to see whether any carbon price makes the plan pay for itself.</div>
        ) : (
          <>
            <table className="w-full text-[11px] mt-1.5">
              <tbody>
                {plan.map((r) => (
                  <tr key={r.scenario} className={`border-t border-line/50 ${r.scenario === scen ? "text-white" : "text-white/55"}`}>
                    <td className="py-1">{r.label}</td>
                    <td className="py-1 text-right mono">avg S${r.avgPriceSgd.toFixed(0)}/t</td>
                    <td className={`py-1 text-right mono ${r.flips ? "text-signal-300" : ""}`}>{r.netCostPerTonneSgd == null ? "—" : `${sgd(r.netCostPerTonneSgd)}/t`}</td>
                    <td className="py-1 text-right text-[10px]">{r.flips ? <span className="text-signal-300">pays for itself</span> : <span className="text-white/35">no flip</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[10px] text-white/35 mt-1.5 leading-snug">
              Carbon value = avoided tonnes each year × that year's price (a shadow value to the economy). Street-level mobility and shade rarely flip on carbon alone; their case is heat, time and health.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
