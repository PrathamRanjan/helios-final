"use client";

// Building-level world engine: click ANY building in Singapore and ask "what if?".
// Geometry is measured (OSM footprint, HDB storeys); the solar what-if uses
// literature yields; the Green Mark effect runs the deterministic compliance
// engine on BCA's measured EUI when the building is in BCA's listing.

import { useMemo } from "react";
import { Sun, Building2, Leaf, Plus } from "lucide-react";
import { Label, Stat, ConfChip, fmtInt } from "@/components/v2/ui";
import { formatMoney, type CurrencyCode } from "@/lib/compass/finance/currency";
import { checkDistrictBuilding, type DistrictBuilding } from "@/lib/compass/compliance/facts";
import type { PickedBuilding } from "@/lib/compass/flow/useIslandWorld";
import type { WorldModifier } from "@/lib/compass/world/types";
import fin from "@/data/assumptions/finance.json";
import { SiteResidents } from "@/components/v2/Residents";
import { SiteNature } from "@/components/v2/NaturePanel";
import Badges from "@/components/v2/Badges";
import { ReplacesStrip } from "@/components/v2/OpenStack";
import { badgesForModifier } from "@/lib/compass/compliance/policy";

const USABLE_ROOF = 0.6; // share of roof usable for PV after plant, setbacks, access (literature 0.5–0.7)
const KWP_PER_M2 = 0.17; // modern 400–450 W modules at ~2.3 m² incl. spacing
const YIELD = 1250; // kWh/kWp/yr — SERIS Singapore typical rooftop yield
const GRID_EF = 0.402; // kg CO₂/kWh — EMA grid emission factor 2024
const COST_PER_KWP = (fin as any).unit_costs_usd.solar_per_kwp.value as number;
const TARIFF = (fin as any).energy_value_usd_per_kwh.electricity_tariff.value as number;

function metres(a: [number, number], b: [number, number]) {
  const kx = 111320 * Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 111320);
}

export default function SiteInspector({
  site,
  areaName,
  bcaBuildings,
  currency,
  canSimulate,
  onAddToWorld,
}: {
  site: PickedBuilding;
  areaName: string;
  bcaBuildings: DistrictBuilding[];
  currency: CurrencyCode;
  canSimulate: boolean;
  onAddToWorld: (m: WorldModifier) => void;
}) {
  const floors = Math.max(1, Math.round(site.hdb ? (site.height - 2) / 2.8 : site.height / 3.6));
  const gfa = site.footprintM2 * floors;
  const kwp = site.footprintM2 * USABLE_ROOF * KWP_PER_M2;
  const kwh = kwp * YIELD;
  const co2 = (kwh * GRID_EF) / 1000;
  const capex = kwp * COST_PER_KWP;
  const saving = kwh * TARIFF;
  const payback = saving > 0 ? capex / saving : null;

  // Is this building in BCA's measured listing? (nearest within 80 m)
  const bca = useMemo(() => {
    let best: DistrictBuilding | null = null;
    let bd = 80;
    for (const b of bcaBuildings) {
      if (b.lat == null || b.lng == null) continue;
      const d = metres([b.lng, b.lat], [site.lng, site.lat]);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }, [bcaBuildings, site.lng, site.lat]);

  const today = new Date().toLocaleDateString("en-CA");
  const gm = bca && Object.keys(bca.eui).length ? { before: checkDistrictBuilding(bca, today), after: checkDistrictBuilding(bca, today, { addSolarKwh: kwh }) } : null;

  const solarMod: WorldModifier = {
      id: `mod_site_solar_${Math.round(site.lng * 1e5)}_${Math.round(site.lat * 1e5)}`,
      label: `Rooftop solar · ${bca?.name ?? `${site.hdb ? "HDB block" : "building"} in ${areaName}`}`,
      geometry: { type: "Point", coordinates: [site.lng, site.lat] },
      effects: { solarAnnualKWhDelta: Math.round(kwh) },
      economics: { capexUsd: Math.round(capex), annualOpexUsd: Math.round(capex * 0.01), lifetimeYears: 25 },
      metadata: { createdBy: "user", confidence: "literature-derived", builtYear: 2027, notes: [`${Math.round(kwp)} kWp on ${Math.round(site.footprintM2)} m² roof (${USABLE_ROOF * 100}% usable, ${YIELD} kWh/kWp)`], hostBuildingId: bca?.id },
  };
  const addSolar = () => onAddToWorld(solarMod);
  const badges = badgesForModifier(solarMod, { asOf: today, host: bca });

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <Label>{areaName}</Label>
          <ConfChip conf="measured" />
        </div>
        <div className="text-[16px] text-white mt-1 flex items-center gap-2">
          <Building2 size={15} className="text-signal-300" />
          {bca?.name ?? (site.hdb ? "HDB block" : "Building")}
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <Stat label="Height" value={Math.round(site.height)} unit="m" />
          <Stat label="Floors (est.)" value={floors} />
          <Stat label="Footprint" value={fmtInt(site.footprintM2)} unit="m²" />
        </div>
        <div className="text-[10.5px] text-white/35 mt-1.5">
          {site.hdb ? "HDB storeys from HDB Property Information" : "Height from OSM tags (12 m default where untagged)"} · GFA ≈ {fmtInt(gfa)} m² (estimate)
        </div>
      </div>

      <div className="rounded-[4px] border border-line p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[12.5px] text-white">
            <Sun size={14} className="text-warn-400" /> What if this roof went solar?
          </div>
          <ConfChip conf="literature-derived" />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Stat label="System" value={fmtInt(kwp)} unit="kWp" />
          <Stat label="Generation" value={(kwh / 1000).toFixed(0)} unit="MWh/yr" tone="signal" />
          <Stat label="CO₂ avoided" value={co2.toFixed(0)} unit="t/yr" tone="signal" />
          <Stat label="Payback" value={payback ? payback.toFixed(1) : "—"} unit="yr" />
        </div>
        <div className="text-[10.5px] text-white/40 mt-2 leading-snug">
          Build {formatMoney(capex, currency)} · saves {formatMoney(saving, currency)}/yr at today's tariff. {USABLE_ROOF * 100}% of roof usable, {YIELD} kWh/kWp/yr (SERIS typical), grid {GRID_EF} kg/kWh (EMA 2024).
        </div>
        <Badges badges={badges} className="mt-2.5" />
        <ReplacesStrip id="solar_feasibility" className="mt-2.5" />
        <button onClick={addSolar} className="v2-btn-primary w-full mt-3" title={canSimulate ? "Add to the world and re-simulate 2026–2036" : "Adds to your plan; full simulation needs this area's LTA world"}>
          <Plus size={14} /> Add to the world {canSimulate ? "& simulate" : "(plan)"}
        </button>
      </div>

      <SiteNature lng={site.lng} lat={site.lat} />

      <SiteResidents
        key={`${site.lng},${site.lat}`}
        body={{
          areaId: site.areaId,
          areaName,
          building: { hdb: !!site.hdb, floors, footprintM2: site.footprintM2 },
          change: {
            label: `Rooftop solar on this ${site.hdb ? "HDB block" : "building"}`,
            facts: [
              `System about ${Math.round(kwp)} kWp, generating about ${Math.round(kwh / 1000)} MWh a year`,
              `Avoids about ${Math.round(co2)} t CO₂ a year`,
              `Build cost about ${formatMoney(capex, "SGD")}; saves about ${formatMoney(saving, "SGD")} a year at today's tariff${payback ? `, paying back in about ${payback.toFixed(0)} years` : ""}`,
            ],
          },
        }}
      />

      {bca && (
        <div className="rounded-[4px] border border-line p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[12.5px] text-white">
              <Leaf size={14} className="text-signal-300" /> Green Mark 2021
            </div>
            <ConfChip conf="measured" />
          </div>
          {gm ? (
            <div className="mt-2 space-y-1.5 text-[11.5px]">
              <div className="flex justify-between">
                <span className="text-white/50">Measured EUI ({gm.before.euiYear})</span>
                <span className="mono text-white/85">{gm.before.measuredEui} kWh/m²/yr</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">GM2021 today</span>
                <span className={`mono ${gm.before.findings[0].outcome === "fail" ? "text-risk-300" : "text-signal-300"}`}>{gm.before.findings[0].tier ?? (gm.before.findings[0].outcome === "fail" ? "below Gold" : "n/a")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">With this solar (EUI {gm.after.eui})</span>
                <span className={`mono ${gm.after.findings[0].outcome === "fail" ? "text-risk-300" : "text-signal-300"}`}>{gm.after.findings[0].tier ?? (gm.after.findings[0].outcome === "fail" ? "below Gold" : "n/a")}</span>
              </div>
              {bca.certificate && (
                <div className="text-[10.5px] text-white/40">
                  Current certificate {bca.certificate.rating} · {bca.certificate.expires && bca.certificate.expires < today ? "expired" : "to"} {bca.certificate.expires}
                </div>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-white/45 mt-2">
              {bca.certificate ? `Certified ${bca.certificate.rating} (${bca.certificate.scheme}). No measured EUI published.` : "In BCA's register; no measured EUI published."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
