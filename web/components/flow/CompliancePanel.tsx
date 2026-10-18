"use client";

// Compliance panel — the policy-alignment view. Every badge comes from the
// deterministic rule engine (lib/compass/compliance), every finding shows the
// numbers compared, the margin, the clause it cites and how sure we are of the
// inputs. Change the "as of" date to see rules start, expire and flip.

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Scale, X, Building2, Car, Sun, ExternalLink, AlertTriangle, Factory, TrendingUp } from "lucide-react";
import CarbonBody from "@/components/v2/CarbonPanel";
import PolicyBody from "@/components/v2/PolicyPanel";
import { ReplacesStrip } from "@/components/v2/OpenStack";
import type { ScenarioResult } from "@/lib/compass/world/types";
import { DISTRICT_BUILDINGS, checkDistrictBuilding, checkVehicle, type DistrictBuilding, type VehicleInput } from "@/lib/compass/compliance/facts";
import { SOURCES } from "@/lib/compass/compliance/rules";
import type { Finding } from "@/lib/compass/compliance/types";

const TODAY = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
const OP: Record<string, string> = { "<=": "≤", ">=": "≥", "<": "<", ">": ">" };
const DATE_PRESETS = [
  { label: "Today", date: TODAY },
  { label: "2027", date: "2027-06-01" },
  { label: "2028", date: "2028-06-01" },
];

const TYPE_LABEL: Record<string, string> = {
  retail_mall: "Retail mall",
  mixed: "Mixed development",
  hospital: "Hospital",
  hotel_large: "Hotel (large)",
  civic: "Civic building",
  residential: "Residential",
  office_large: "Office (large)",
  office_small: "Office (small)",
  hotel_small: "Hotel (small)",
  unknown: "Certified building",
};

function tone(f: Finding): string {
  if (f.outcome === "pass") return "text-emerald-300 border-emerald-400/30 bg-emerald-400/10";
  if (f.outcome === "fail") return "text-rose-300 border-rose-400/30 bg-rose-400/10";
  if (f.outcome === "info") return (f.amountSgd ?? 0) <= 0 ? "text-emerald-300 border-emerald-400/30 bg-emerald-400/10" : "text-amber-300 border-amber-400/30 bg-amber-400/10";
  if (f.outcome === "needs_info") return "text-amber-200 border-amber-400/30 bg-amber-400/5";
  return "text-white/45 border-white/10 bg-white/5";
}

function badgeText(f: Finding): string {
  if (f.outcome === "pass" || (f.outcome === "info" && f.tier)) return f.tier ?? "Pass";
  if (f.outcome === "fail") return "Below";
  if (f.outcome === "info") return f.amountSgd !== undefined ? sgd(f.amountSgd) : "Info";
  if (f.outcome === "needs_info") return "Needs data";
  if (f.outcome === "not_in_force") return "Not in force";
  return "N/A";
}

const sgd = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""}S$${Math.abs(Math.round(n)).toLocaleString("en-SG")}`;

const CONF_LABEL: Record<string, string> = {
  measured: "measured inputs",
  user_input: "your inputs",
  modelled: "modelled input — likely, not certain",
  assumed: "assumed input",
};

function FindingCard({ f }: { f: Finding }) {
  const [open, setOpen] = useState(false);
  const src = SOURCES[f.citation.source];
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
      <button onClick={() => setOpen(!open)} className="w-full text-left flex items-start gap-2">
        <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium ${tone(f)}`}>{badgeText(f)}</span>
        <span className="min-w-0">
          <span className="block text-[11.5px] text-white/85 leading-snug">{f.title}</span>
          <span className="block text-[11px] text-white/55 leading-snug mt-0.5">{f.summary}</span>
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 pl-1">
          {f.comparisons.length > 0 && (
            <table className="w-full text-[10.5px]">
              <tbody>
                {f.comparisons.map((c, i) => (
                  <tr key={i} className={c.met ? "text-white/70" : "text-rose-200/80"}>
                    <td className="py-0.5 pr-2">{c.label}</td>
                    <td className="py-0.5 text-right tabular-nums">
                      {c.value} {OP[c.op]} {c.threshold} {c.unit}
                    </td>
                    <td className="py-0.5 pl-2 text-right tabular-nums">{c.met ? "✓" : "✗"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {f.nextStep && <div className="text-[11px] text-sky-200/90">→ {f.nextStep}</div>}
          <div className="text-[10.5px] text-white/45 leading-snug">
            <span className="text-white/60">{src?.issuer ?? f.instrument}</span> · {f.citation.clause}
            {f.citation.pages.length > 0 && <> · p.{f.citation.pages.join(", ")}</>}{" "}
            {src?.url && (
              <a href={src.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 ml-1 text-sky-300/80 hover:text-sky-200">
                source <ExternalLink size={10} />
              </a>
            )}
            <div className="italic mt-0.5">“{f.citation.quote}”</div>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-white/50">{CONF_LABEL[f.inputConfidence]}</span>
            <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-white/50">rule: {f.ruleConfidence.replace("_", " ")}</span>
            <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-white/50">as of {f.asOf}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Buildings for an area: Jurong East keeps its 8 curated profiles (with measured rooftop solar);
 *  every area gets BCA's island-wide listing (measured EUI + Green Mark certificates). */
function useAreaBuildings(areaId: string) {
  const [island, setIsland] = useState<DistrictBuilding[] | null>(null);
  useEffect(() => {
    setIsland(null);
    fetch(`/api/sg/buildings?area=${areaId}`)
      .then((r) => (r.ok ? r.json() : { buildings: [] }))
      .then((d) => setIsland(d.buildings ?? []))
      .catch(() => setIsland([]));
  }, [areaId]);
  return useMemo(() => {
    if (areaId !== "jurong_east") return island;
    if (!island) return DISTRICT_BUILDINGS;
    const curated = DISTRICT_BUILDINGS.map((b) => b.name.toLowerCase().split(" ")[0]);
    return [...DISTRICT_BUILDINGS, ...island.filter((b) => !curated.some((c) => b.name.toLowerCase().startsWith(c)))];
  }, [areaId, island]);
}

const RANK: Record<string, number> = { fail: 0, pass: 1, needs_info: 2, not_applicable: 3, not_in_force: 4, info: 5 };

function BuildingsTab({ asOf, areaId }: { asOf: string; areaId: string }) {
  const [solar, setSolar] = useState<Record<string, boolean>>({});
  const [euiYear, setEuiYear] = useState<"2019" | "2020">("2020");
  const [openId, setOpenId] = useState<string | null>(null);
  const [onlyMeasured, setOnlyMeasured] = useState(true);
  const buildings = useAreaBuildings(areaId);

  const rows = useMemo(() => {
    if (!buildings) return [];
    return buildings
      .filter((b) => !onlyMeasured || Object.keys(b.eui).length > 0 || b.rooftop_solar)
      .map((b) => {
        const withSolar = !!solar[b.id] && !!b.rooftop_solar;
        const r = checkDistrictBuilding(b, asOf, { euiYear, addSolarKwh: withSolar ? b.rooftop_solar!.annual_kwh : 0 });
        return { b, r, withSolar };
      })
      .sort((x, y) => (RANK[x.r.findings[0].outcome] ?? 9) - (RANK[y.r.findings[0].outcome] ?? 9) || (y.b.gfa_m2 ?? 0) - (x.b.gfa_m2 ?? 0));
  }, [buildings, solar, euiYear, asOf, onlyMeasured]);

  if (!buildings) return <div className="text-[11px] text-white/40 py-6 text-center">Loading BCA building data…</div>;

  const counts = rows.reduce(
    (c, { r }) => {
      const o = r.findings[0].outcome;
      if (o === "fail") c.below++;
      else if (o === "pass") c.rated++;
      if (r.certStatus === "expired") c.expired++;
      return c;
    },
    { below: 0, rated: 0, expired: 0 }
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {[
          { k: "Below GM2021 Gold", v: counts.below, tone: "text-rose-300" },
          { k: "Rated under GM2021", v: counts.rated, tone: "text-emerald-300" },
          { k: "Certificates expired", v: counts.expired, tone: "text-amber-300" },
        ].map((x) => (
          <div key={x.k} className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-1.5">
            <div className={`text-[17px] tabular-nums ${x.tone}`}>{x.v}</div>
            <div className="text-[9.5px] text-white/45 leading-tight">{x.k}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-[11px] text-white/55">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={onlyMeasured} onChange={(e) => setOnlyMeasured(e.target.checked)} className="accent-teal-400" />
          Only buildings with measured EUI
        </label>
        <div className="flex gap-1">
          {(["2019", "2020"] as const).map((y) => (
            <button key={y} onClick={() => setEuiYear(y)} className={`rounded px-2 py-0.5 ${euiYear === y ? "bg-white/15 text-white" : "text-white/50 hover:text-white"}`}>
              {y}
            </button>
          ))}
        </div>
      </div>
      {euiYear === "2020" && <div className="text-[10.5px] text-white/40 -mt-2">2020 is BCA's latest published year but occupancy was COVID-depressed; 2019 is the pre-COVID reference.</div>}
      {rows.length === 0 && (
        <div className="text-[11px] text-white/40 py-4 text-center">
          No buildings in BCA's public energy listing for this area{onlyMeasured ? " — untick the filter to see certificate-only buildings" : ""}.
        </div>
      )}
      {rows.map(({ b, r, withSolar }) => {
        const gm = r.findings[0];
        const cert = b.certificate;
        const open = openId === b.id;
        return (
          <div key={b.id} className="rounded-md border border-white/10 bg-white/[0.02]">
            <button onClick={() => setOpenId(open ? null : b.id)} className="w-full text-left p-2.5 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[12.5px] text-white/90 truncate">{b.name}</div>
                <div className="text-[10.5px] text-white/45 truncate">
                  {TYPE_LABEL[b.building_type] ?? b.bca_function ?? b.building_type}
                  {b.gfa_m2 ? ` · ${Math.round(b.gfa_m2).toLocaleString("en-SG")} m²` : ""}
                  {r.measuredEui !== undefined ? ` · EUI ${r.measuredEui} (${r.euiYear})` : ""}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${tone(gm)}`}>GM2021 {gm.outcome === "fail" ? "below Gold" : badgeText(gm)}</span>
                {cert && (
                  <span className={`text-[9.5px] ${r.certStatus === "expired" ? "text-rose-300" : "text-white/40"}`}>
                    {cert.rating} cert · {r.certStatus === "expired" ? "expired" : "to"} {cert.expires ?? "—"}
                  </span>
                )}
              </div>
            </button>
            {open && (
              <div className="px-2.5 pb-2.5 space-y-2">
                {cert ? (
                  <div className="text-[10.5px] text-white/50">
                    Current certificate: <span className="text-white/80">{cert.rating}</span> · {cert.scheme}
                  </div>
                ) : (
                  <div className="text-[10.5px] text-white/40">No whole-building Green Mark certificate in BCA's public register.</div>
                )}
                {cert && r.certStatus !== "none" && /2017|Version [1-4]/.test(cert.scheme) && gm.outcome !== "not_applicable" && gm.outcome !== "needs_info" && (
                  <div className="flex items-start gap-1.5 text-[11px] text-amber-200/90">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    Certified under an older scheme. Re-certification is assessed under GM2021, where {withSolar ? "the EUI with solar" : "this measured EUI"} rates <b className="font-medium">{gm.tier ?? "below Gold"}</b>.
                  </div>
                )}
                {b.note && <div className="text-[10.5px] text-white/40">{b.note}</div>}
                {b.rooftop_solar && r.measuredEui !== undefined && b.gfa_m2 && (
                  <label className="flex items-center gap-2 text-[11px] text-white/65 cursor-pointer">
                    <input type="checkbox" checked={withSolar} onChange={(e) => setSolar({ ...solar, [b.id]: e.target.checked })} className="accent-amber-400" />
                    <Sun size={12} className="text-amber-200" />
                    Add measured rooftop solar ({Math.round(b.rooftop_solar.kwp).toLocaleString("en-SG")} kWp ≈ {(b.rooftop_solar.annual_kwh / 1e6).toFixed(2)} GWh/yr)
                    {withSolar && r.eui !== undefined && <span className="text-white/45">→ EUI {r.eui}</span>}
                  </label>
                )}
                {r.findings.map((f) => (
                  <FindingCard key={f.ruleId} f={f} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const VEHICLE_PRESETS: { label: string; v: VehicleInput }[] = [
  { label: "EV car", v: { vehicle_class: "car", fuel: "electric", whPerKm: 150, arf_sgd: 40000 } },
  { label: "Hybrid car", v: { vehicle_class: "car", fuel: "hybrid", co2_g_km: 105, hc_g_km: 0.01, co_g_km: 0.1, nox_g_km: 0.005, pm_mg_km: 0.1, arf_sgd: 40000 } },
  { label: "Petrol car", v: { vehicle_class: "car", fuel: "petrol", co2_g_km: 150, hc_g_km: 0.02, co_g_km: 0.2, nox_g_km: 0.01, pm_mg_km: 0.3, arf_sgd: 40000 } },
  { label: "Petrol taxi", v: { vehicle_class: "taxi", fuel: "petrol", co2_g_km: 190, hc_g_km: 0.03, co_g_km: 0.3, nox_g_km: 0.02, pm_mg_km: 0.5, arf_sgd: 40000 } },
];

const NUM_FIELDS: { key: keyof VehicleInput; label: string; ev?: boolean; ice?: boolean }[] = [
  { key: "whPerKm", label: "Energy use (Wh/km)", ev: true },
  { key: "co2_g_km", label: "CO₂ (g/km)", ice: true },
  { key: "hc_g_km", label: "HC (g/km)", ice: true },
  { key: "co_g_km", label: "CO (g/km)", ice: true },
  { key: "nox_g_km", label: "NOx (g/km)", ice: true },
  { key: "pm_mg_km", label: "PM (mg/km)", ice: true },
  { key: "arf_sgd", label: "ARF before rebates (S$)", ev: true, ice: true },
];

function VehiclesTab({ asOf }: { asOf: string }) {
  const [v, setV] = useState<VehicleInput>(VEHICLE_PRESETS[0].v);
  const r = useMemo(() => checkVehicle(v, asOf), [v, asOf]);
  const isEv = v.fuel === "electric";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {VEHICLE_PRESETS.map((p) => (
          <button key={p.label} onClick={() => setV(p.v)} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/70 hover:text-white hover:border-white/25">
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <label className="text-white/55">
          Class
          <select value={v.vehicle_class} onChange={(e) => setV({ ...v, vehicle_class: e.target.value as VehicleInput["vehicle_class"] })} className="mt-0.5 w-full rounded bg-white/5 border border-white/10 px-1.5 py-1 text-white/85">
            <option value="car">Car</option>
            <option value="taxi">Taxi</option>
          </select>
        </label>
        <label className="text-white/55">
          Fuel
          <select value={v.fuel} onChange={(e) => setV({ ...v, fuel: e.target.value as VehicleInput["fuel"] })} className="mt-0.5 w-full rounded bg-white/5 border border-white/10 px-1.5 py-1 text-white/85">
            <option value="electric">Electric</option>
            <option value="hybrid">Hybrid</option>
            <option value="petrol">Petrol</option>
            <option value="diesel">Diesel</option>
          </select>
        </label>
        {NUM_FIELDS.filter((f) => (isEv ? f.ev : f.ice)).map((f) => (
          <label key={f.key} className="text-white/55">
            {f.label}
            <input
              type="number"
              value={(v[f.key] as number | undefined) ?? ""}
              onChange={(e) => setV({ ...v, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) })}
              className="mt-0.5 w-full rounded bg-white/5 border border-white/10 px-1.5 py-1 text-white/85 tabular-nums"
            />
          </label>
        ))}
      </div>
      {isEv && r.facts.co2_g_km !== undefined && (
        <div className="text-[10.5px] text-white/45">VES counts EV CO₂ from electricity at 0.4 g/Wh → {String(r.facts.co2_g_km)} g/km.</div>
      )}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="text-[11px] text-white/55">Net effect on upfront registration cost</div>
        <div className={`text-[20px] font-display tabular-nums ${r.netSgd <= 0 ? "text-emerald-300" : "text-amber-300"}`}>{sgd(r.netSgd)}</div>
        {r.floored && <div className="text-[10.5px] text-white/45">Limited by the S$0 ARF floor for EVs (rebates can't push ARF below zero).</div>}
      </div>
      <div className="space-y-1.5">
        {r.findings.map((f) => (
          <FindingCard key={f.ruleId} f={f} />
        ))}
      </div>
    </div>
  );
}

/** The compliance view without chrome — embedded in the V2 inspector or the slide-out panel. */
export function ComplianceBody({
  areaId = "jurong_east",
  areaName = "Jurong East",
  result = null,
  planCount = 0,
}: {
  areaId?: string;
  areaName?: string;
  result?: ScenarioResult | null;
  planCount?: number;
}) {
  const [tab, setTab] = useState<"buildings" | "carbon" | "policy" | "vehicles">("buildings");
  const [asOf, setAsOf] = useState(TODAY);
  return (
    <div data-tour="comply">
      <div className="space-y-2.5 pb-3 border-b border-white/10">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-white/50 mr-1">As of</span>
          {DATE_PRESETS.map((p) => (
            <button key={p.label} onClick={() => setAsOf(p.date)} className={`rounded px-2 py-0.5 ${asOf === p.date ? "bg-white/15 text-white" : "text-white/50 hover:text-white"}`}>
              {p.label}
            </button>
          ))}
          <input type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} className="ml-auto rounded bg-white/5 border border-white/10 px-1.5 py-0.5 text-white/80" />
        </div>
        <div className="flex gap-1">
          {([
            ["buildings", "Buildings", Building2],
            ["carbon", "Carbon", Factory],
            ["policy", "What-if", TrendingUp],
            ["vehicles", "Vehicles", Car],
          ] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] ${tab === id ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      </div>
      <div className="pt-3">
        <ReplacesStrip key={tab} className="mb-3" id={{ buildings: "building_benchmarking", carbon: "carbon_accounting", policy: "carbon_price", vehicles: "taxonomy_compliance" }[tab]} />
        {tab === "buildings" && <BuildingsTab asOf={asOf} areaId={areaId} />}
        {tab === "carbon" && <CarbonBody areaId={areaId} areaName={areaName} asOf={asOf} />}
        {tab === "policy" && <PolicyBody areaId={areaId} areaName={areaName} asOf={asOf} result={result} planCount={planCount} />}
        {tab === "vehicles" && <VehiclesTab asOf={asOf} />}
      </div>
      <div className="pt-4 text-[10.5px] text-white/35 leading-snug">
        Policy-alignment indicator, not legal or certification advice. Rules: Green Mark 2021 (BCA), VES 2026–27 and EEAI 2026 (LTA/NEA), Carbon Pricing Act 2018, EV Charging Act 2022, Singapore-Asia Taxonomy 2023, ACRA/SGX climate reporting roadmap. Building data: BCA Building Energy Performance Data and Green Mark Buildings (data.gov.sg). Tap any finding for the clause, numbers and source.
      </div>
    </div>
  );
}

export default function CompliancePanel({ inline = false, areaId = "jurong_east" }: { inline?: boolean; areaId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Policy compliance: Green Mark, VES, EEAI"
        className={inline ? "v2-btn" : "fixed bottom-5 right-[416px] z-50 flex items-center gap-1.5 rounded-full glass px-3.5 py-2 text-[12px] text-white/80 hover:text-white transition-colors shadow-panel"}
      >
        <Scale size={15} className="text-violet-300" />
        Compliance
      </button>
      <AnimatePresence>
        {open && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] bg-black/50" onClick={() => setOpen(false)} />
            <motion.aside
              initial={{ x: 460 }}
              animate={{ x: 0 }}
              exit={{ x: 460 }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="fixed top-0 right-0 h-full w-[440px] max-w-full z-[71] bg-[#0f1117] border-l border-white/10 shadow-panel overflow-y-auto"
            >
              <div className="sticky top-0 z-10 bg-[#0f1117]/95 backdrop-blur border-b border-white/10 px-4 py-3 flex items-center justify-between">
                <span className="font-display text-sm text-solar-gradient">Policy compliance</span>
                <button onClick={() => setOpen(false)} className="text-white/50 hover:text-white p-1">
                  <X size={16} />
                </button>
              </div>
              <div className="p-4">
                <ComplianceBody areaId={areaId} />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
