"use client";

// Carbon accounting (Scope 1 & 2) for any set of BCA-listed buildings, and the draft
// climate disclosure that falls out of it: obligations (ACRA/SGX roadmap), carbon tax
// test, Singapore-Asia Taxonomy alignment, and the gaps an assurer would ask about.

import { useEffect, useMemo, useState } from "react";
import { Factory, Download, Copy, Check, AlertTriangle, Loader2 } from "lucide-react";
import { Label, Stat, ConfChip, fmtInt, fmtPct } from "@/components/v2/ui";
import { draftDisclosure, scope2Trend, type EntityType, type DisclosureDraft } from "@/lib/compass/carbon/ghg";
import type { DistrictBuilding } from "@/lib/compass/compliance/facts";
import { provenanceLine } from "@/lib/compass/openStack";

const ENTITY: { id: EntityType; label: string }[] = [
  { id: "sti", label: "STI constituent" },
  { id: "listed_large", label: "Listed, cap ≥ S$1B" },
  { id: "listed_small", label: "Listed, cap < S$1B" },
  { id: "large_non_listed", label: "Large non-listed" },
  { id: "other", label: "Other" },
];

const t0 = (n: number) => fmtInt(n);

function toMarkdown(d: DisclosureDraft): string {
  const L: string[] = [];
  L.push(`# Draft climate disclosure — ${d.entity.name}`, "");
  L.push(`FY${d.entity.financial_year} · ${ENTITY.find((e) => e.id === d.entity.entity_type)?.label} · prepared ${d.asOf} by HELIOS (draft, not assured)`, "");
  L.push("## GHG emissions (GHG Protocol, operational control)", "");
  L.push("| Scope | tCO2e | Basis |", "|---|---:|---|");
  L.push(`| Scope 1 | ${d.scope1.t == null ? "not provided" : t0(d.scope1.t)} | ${d.scope1.t == null ? "owner input needed" : "owner-reported"} |`);
  L.push(`| Scope 2 (location-based) | ${t0(d.scope2.t)} | BCA measured EUI ${d.scope2.years.join("/")} × GFA × EMA grid factor |`);
  L.push("", `Electricity ${t0(d.scope2.kwh / 1000)} MWh over ${t0(d.scope2.gfa_m2)} m² GFA · intensity ${d.scope2.intensity_kg_m2.toFixed(1)} kgCO2/m² · ${d.scope2.covered} buildings covered, ${d.scope2.excluded.length} excluded.`, "");
  L.push("## Buildings", "", "| Building | EUI year | kWh/m²/yr | tCO2e | kgCO2/m² | Taxonomy (TSC 3.4) |", "|---|---|---:|---:|---:|---|");
  for (const b of d.perBuilding) L.push(`| ${b.name} | ${b.year} | ${b.eui.toFixed(0)} | ${t0(b.scope2_t)} | ${b.intensity_kg_m2.toFixed(0)} | ${b.sat?.tier ?? b.sat?.outcome ?? "—"} |`);
  L.push("", "## Obligations", "", `- ${d.obligations.summary}`);
  if (d.obligations.nextStep) L.push(`- ${d.obligations.nextStep}`);
  L.push(`- Carbon tax: ${d.carbonTax.summary}`, "");
  L.push("## Gaps before this can be filed", "", ...d.gaps.map((g) => `- ${g}`), "");
  L.push(provenanceLine("carbon_accounting"), "");
  L.push("Sources: BCA Building Energy Performance Data (data.gov.sg); EMA grid emission factors; Carbon Pricing Act 2018; ACRA/SGX climate reporting roadmap; MAS Singapore-Asia Taxonomy 2023.");
  return L.join("\n");
}

function toCsv(d: DisclosureDraft): string {
  const rows = [["building_id", "name", "eui_year", "eui_kwh_m2", "gfa_m2", "kwh", "grid_factor_kg_kwh", "grid_factor_year", "scope2_tco2e", "intensity_kgco2_m2", "sat_tsc34", "stock_percentile"]];
  for (const b of d.perBuilding)
    rows.push([b.id, b.name, b.year, b.eui.toFixed(2), String(b.gfa_m2), Math.round(b.kwh).toString(), String(b.factor.value), b.factor.year, b.scope2_t.toFixed(1), b.intensity_kg_m2.toFixed(1), b.sat?.tier ?? "", b.stock_percentile == null ? "" : String(b.stock_percentile)]);
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
}

export function useAreaBcaBuildings(areaId: string) {
  const [list, setList] = useState<DistrictBuilding[] | null>(null);
  useEffect(() => {
    setList(null);
    fetch(`/api/sg/buildings?area=${areaId}`)
      .then((r) => r.json())
      .then((d) => setList(d.buildings ?? []))
      .catch(() => setList([]));
  }, [areaId]);
  return list;
}

export default function CarbonBody({ areaId, areaName, asOf }: { areaId: string; areaName: string; asOf: string }) {
  const all = useAreaBcaBuildings(areaId);
  const measured = useMemo(() => (all ?? []).filter((b) => b.gfa_m2 && Object.keys(b.eui ?? {}).length), [all]);
  const [entityType, setEntityType] = useState<EntityType>("listed_large");
  const [fy, setFy] = useState(2026);
  const [scope1, setScope1] = useState<string>("");
  const [facility, setFacility] = useState<string>("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const picked = measured.filter((b) => !excluded.has(b.id));
  const d = useMemo(
    () =>
      draftDisclosure(
        {
          name: `${areaName} — BCA-listed buildings`,
          entity_type: entityType,
          financial_year: fy,
          buildings: picked,
          scope1_t: scope1 === "" ? undefined : Number(scope1),
          largest_facility_scope1_t: facility === "" ? undefined : Number(facility),
        },
        asOf
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picked.map((b) => b.id).join(","), entityType, fy, scope1, facility, asOf, areaName]
  );

  // Like-for-like Scope 2 trend over buildings that report every year.
  const trend = useMemo(() => {
    const years = ["2017", "2018", "2019", "2020"];
    const full = picked.filter((b) => years.every((y) => b.eui?.[y] !== undefined));
    return { n: full.length, rows: years.map((y) => ({ y, t: full.reduce((s, b) => s + (scope2Trend(b).find((g) => g.year === y)?.scope2_t ?? 0), 0) })) };
  }, [picked]);

  if (!all)
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-[11.5px] text-white/40">
        <Loader2 size={13} className="animate-spin" /> Loading buildings…
      </div>
    );
  if (!measured.length) return <div className="text-[11.5px] text-white/50 py-4">BCA publishes no measured energy data for buildings in {areaName}, so there is nothing to account from open data here. Owners can still enter metered kWh.</div>;

  const tax = d.taxonomy;
  const taxTot = tax.green_m2 + tax.amber_m2 + tax.ineligible_m2 + tax.unknown_m2 || 1;
  const download = (name: string, body: string, type: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[12.5px] text-white">
          <Factory size={14} className="text-signal-300" /> Scope 1 & 2 · draft disclosure
        </div>
        <ConfChip conf="measured" />
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <label className="space-y-1">
          <Label>Reporting entity</Label>
          <select value={entityType} onChange={(e) => setEntityType(e.target.value as EntityType)} className="w-full h-8 rounded-[4px] border border-line bg-ink-1 px-2 text-white/85">
            {ENTITY.map((e) => (
              <option key={e.id} value={e.id}>{e.label}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <Label>Financial year</Label>
          <select value={fy} onChange={(e) => setFy(Number(e.target.value))} className="w-full h-8 rounded-[4px] border border-line bg-ink-1 px-2 text-white/85">
            {[2025, 2026, 2027, 2028, 2029, 2030].map((y) => (
              <option key={y} value={y}>FY{y}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <Label>Scope 1 (tCO₂e, owner input)</Label>
          <input value={scope1} onChange={(e) => setScope1(e.target.value.replace(/[^\d.]/g, ""))} placeholder="not provided" className="mono w-full h-8 rounded-[4px] border border-line bg-ink-1 px-2 text-white/85" />
        </label>
        <label className="space-y-1">
          <Label>Largest facility direct t</Label>
          <input value={facility} onChange={(e) => setFacility(e.target.value.replace(/[^\d.]/g, ""))} placeholder="for the carbon tax test" className="mono w-full h-8 rounded-[4px] border border-line bg-ink-1 px-2 text-white/85" />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Scope 2" value={t0(d.scope2.t)} unit="tCO₂e" tone="signal" sub={`EUI ${d.scope2.years.join("/")}`} />
        <Stat label="Intensity" value={d.scope2.intensity_kg_m2.toFixed(0)} unit="kg/m²" sub={`${t0(d.scope2.gfa_m2 / 1000)}k m² GFA`} />
        <Stat label="Scope 1" value={d.scope1.t == null ? "—" : t0(d.scope1.t)} unit={d.scope1.t == null ? undefined : "tCO₂e"} tone={d.scope1.t == null ? "warn" : "default"} sub={d.scope1.t == null ? "owner input needed" : "owner-reported"} />
      </div>

      {trend.n > 0 && (
        <div>
          <Label>Measured trend · {trend.n} buildings reporting every year</Label>
          <div className="grid grid-cols-4 gap-1.5 mt-1.5">
            {trend.rows.map((r, i) => (
              <div key={r.y} className="rounded-[3px] border border-line px-2 py-1">
                <div className="mono text-[10px] text-white/40">{r.y}</div>
                <div className="mono text-[12px] text-white/85">{t0(r.t)} t</div>
                {i > 0 && trend.rows[i - 1].t > 0 && (
                  <div className={`mono text-[9.5px] ${r.t <= trend.rows[i - 1].t ? "text-signal-300" : "text-risk-300"}`}>
                    {r.t <= trend.rows[i - 1].t ? "" : "+"}
                    {(((r.t - trend.rows[i - 1].t) / trend.rows[i - 1].t) * 100).toFixed(1)}%
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="text-[10px] text-white/35 mt-1">2020 includes COVID-19 occupancy effects.</div>
        </div>
      )}

      <div className="rounded-[4px] border border-line p-3 space-y-2 text-[11.5px]">
        <div>
          <Label>What this entity must disclose</Label>
          <div className="text-white/80 mt-1 leading-snug">{d.obligations.summary}</div>
          {d.obligations.nextStep && <div className="text-white/45 mt-0.5 leading-snug">{d.obligations.nextStep}</div>}
        </div>
        <div>
          <Label>Carbon tax</Label>
          <div className="text-white/80 mt-1 leading-snug">{d.carbonTax.summary}</div>
        </div>
        <div>
          <Label>Singapore-Asia Taxonomy · owned buildings (TSC 3.4)</Label>
          <div className="flex h-2 rounded-full overflow-hidden mt-1.5 bg-white/5">
            <div className="bg-signal-400" style={{ width: `${(tax.green_m2 / taxTot) * 100}%` }} />
            <div className="bg-warn-400" style={{ width: `${(tax.amber_m2 / taxTot) * 100}%` }} />
            <div className="bg-risk-400" style={{ width: `${(tax.ineligible_m2 / taxTot) * 100}%` }} />
          </div>
          <div className="mono text-[10px] text-white/50 mt-1">
            Green {fmtPct(tax.green_m2 / taxTot)} · Amber {fmtPct(tax.amber_m2 / taxTot)} · Ineligible {fmtPct(tax.ineligible_m2 / taxTot)}
            {tax.unknown_m2 ? ` · unclassified ${fmtPct(tax.unknown_m2 / taxTot)}` : ""} of GFA
          </div>
          <div className="text-[10px] text-white/35 mt-0.5">Green = valid Green Mark or top 15% by EUI among BCA-listed peers of the same type. Peer ranking is a modelled stand-in for "national stock".</div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <Label>Buildings ({picked.length} of {measured.length} included)</Label>
          {excluded.size > 0 && (
            <button onClick={() => setExcluded(new Set())} className="text-[10.5px] text-white/45 hover:text-white">
              include all
            </button>
          )}
        </div>
        <div className="max-h-[260px] overflow-y-auto v2-scroll border border-line rounded-[4px]">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-ink-1">
              <tr className="text-white/40 text-left">
                <th className="py-1 pl-2 font-normal w-5" />
                <th className="py-1 font-normal">Building</th>
                <th className="py-1 font-normal text-right">tCO₂e</th>
                <th className="py-1 font-normal text-right">kg/m²</th>
                <th className="py-1 pr-2 font-normal text-right">SAT</th>
              </tr>
            </thead>
            <tbody>
              {measured
                .map((b) => ({ b, g: d.perBuilding.find((p) => p.id === b.id) }))
                .sort((x, y) => (y.g?.scope2_t ?? -1) - (x.g?.scope2_t ?? -1))
                .map(({ b, g }) => (
                  <tr key={b.id} className={`border-t border-line/50 ${g ? "" : "opacity-40"}`}>
                    <td className="py-1 pl-2">
                      <input
                        type="checkbox"
                        checked={!excluded.has(b.id)}
                        onChange={() => setExcluded((s) => {
                          const n = new Set(s);
                          n.has(b.id) ? n.delete(b.id) : n.add(b.id);
                          return n;
                        })}
                        className="accent-teal-400"
                      />
                    </td>
                    <td className="py-1 text-white/80 truncate max-w-[150px]" title={b.name}>{b.name}</td>
                    <td className="py-1 text-right mono text-white/80">{g ? t0(g.scope2_t) : "—"}</td>
                    <td className="py-1 text-right mono text-white/55">{g ? g.intensity_kg_m2.toFixed(0) : "—"}</td>
                    <td className={`py-1 pr-2 text-right mono ${g?.sat?.tier === "Green" ? "text-signal-300" : g?.sat?.tier === "Amber" ? "text-warn-300" : g?.sat?.tier === "Ineligible" ? "text-risk-300" : "text-white/40"}`}>{g?.sat?.tier ?? "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-[4px] border border-warn-400/25 bg-warn-400/[0.05] p-2.5">
        <div className="flex items-center gap-1.5 text-[11px] text-warn-300">
          <AlertTriangle size={12} /> Before filing
        </div>
        <ul className="mt-1 space-y-0.5 text-[10.5px] text-white/55 leading-snug">
          {d.gaps.map((g) => (
            <li key={g}>· {g}</li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          className="v2-btn justify-center"
          onClick={() => {
            navigator.clipboard.writeText(toMarkdown(d)).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check size={13} className="text-signal-300" /> : <Copy size={13} />} {copied ? "Copied" : "Copy draft (Markdown)"}
        </button>
        <button className="v2-btn justify-center" onClick={() => download(`helios_scope2_${areaId}_FY${fy}.csv`, toCsv(d), "text/csv")}>
          <Download size={13} /> Working file (CSV)
        </button>
      </div>
      <div className="text-[10px] text-white/35 leading-snug">
        Method: GHG Protocol Corporate Standard; Scope 2 Guidance (location-based). kWh = BCA measured EUI × GFA; factor = EMA grid emission factor for the EUI year (2005–2020 from EMA on data.gov.sg; 2021–24 secondary).
      </div>
    </div>
  );
}

