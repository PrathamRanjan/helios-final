// Material passport + end-of-life engine.
//
// The embodied engine (embodied.ts) tells us the cradle-to-GATE carbon debt of
// building an intervention. This module answers the next two questions a
// circular-economy judge asks:
//   • "What is it physically made of, and how much of that is recoverable?"
//     → a material passport: tonnes by material + recyclable %.
//   • "What happens to it at end-of-life?"  → extends cradle-to-gate to
//     cradle-to-GRAVE for carbon (disposal/recycling emissions + in-horizon
//     replacements), shrunk when a supplier take-back clause is in play.
//
// Quantities come from the SAME driver units the effects imply (kWp, kWh,
// ports, km) so the passport reconciles with the embodied carbon numbers.

import type { WorldModifier } from "../world/types";
import { polylineLengthKm } from "../world/geo";
import mat from "@/data/assumptions/materials.json";
import emb from "@/data/assumptions/embodied.json";
import { embodiedForModifier } from "./embodied";

const RECYCLABILITY = (mat as any).recyclability as Record<string, number>;
const COMPOSITION = (mat as any).composition as Record<
  string,
  { material: string; kg: number }[]
>;

const EOL = {
  pv: (emb as any).eol_fraction_of_gate.pv.value as number,
  battery: (emb as any).eol_fraction_of_gate.battery.value as number,
  ev_charger: (emb as any).eol_fraction_of_gate.ev_charger.value as number,
  civil: (emb as any).eol_fraction_of_gate.civil.value as number,
  takebackCredit: (emb as any).eol_fraction_of_gate.recycling_credit_with_takeback
    .value as number,
};

const F_YIELD = (emb as any).solar_yield_kwh_per_kwp.value as number;

export interface MaterialLine {
  material: string;
  tonnes: number;
  recyclablePct: number; // 0..100
}

export interface PassportEntry {
  modifierId: string;
  label: string;
  category: "pv" | "battery" | "ev_charger" | "civil" | "greening";
  materials: MaterialLine[];
  totalTonnes: number;
  recyclablePct: number; // mass-weighted recyclable share
  gateTonnesCO2: number; // cradle-to-gate embodied (from embodied engine)
  eolTonnesCO2: number; // end-of-life carbon (disposal/recycling, net of take-back)
  takeback: boolean; // supplier take-back assumed for this asset
  eolPlan: string; // human-readable end-of-life plan
}

function geometryKm(mod: WorldModifier): number {
  const g = mod.geometry;
  if (g.type === "LineString") return polylineLengthKm(g.coordinates);
  if (g.type === "Polygon") return polylineLengthKm(g.coordinates[0] ?? []);
  return 0;
}

/** Scale a composition template (kg per driver unit) by the driver quantity. */
function scaled(
  template: { material: string; kg: number }[] | undefined,
  units: number
): MaterialLine[] {
  if (!template) return [];
  return template.map((c) => ({
    material: c.material,
    tonnes: (c.kg * units) / 1000,
    recyclablePct: Math.round((RECYCLABILITY[c.material] ?? 0.5) * 100),
  }));
}

function categoryOf(mod: WorldModifier): PassportEntry["category"] {
  const e = mod.effects;
  if (e.solarAnnualKWhDelta) return "pv";
  if (e.batteryCapacityKWhDelta) return "battery";
  if (e.chargingCapacityKWDelta) return "ev_charger";
  if (e.shadeDelta && !e.rainProtectionDelta && !e.cycleMaxKmExtension)
    return "greening";
  return "civil";
}

/** Build the material passport for one modifier. */
export function passportForModifier(mod: WorldModifier): PassportEntry {
  const e = mod.effects;
  const circ = (mod as any).lifecycle?.circular ?? {};
  const km = geometryKm(mod);
  const category = categoryOf(mod);
  let materials: MaterialLine[] = [];

  // Derive driver units the same way the embodied engine does.
  if (e.solarAnnualKWhDelta) {
    const kwp = e.solarAnnualKWhDelta / F_YIELD;
    materials = materials.concat(scaled(COMPOSITION.solar_per_kwp, kwp));
  }
  if (e.batteryCapacityKWhDelta) {
    materials = materials.concat(
      scaled(COMPOSITION.battery_per_kwh, e.batteryCapacityKWhDelta)
    );
  }
  if (e.chargingCapacityKWDelta) {
    const ports = Math.max(1, Math.round(e.chargingCapacityKWDelta / 22));
    materials = materials.concat(scaled(COMPOSITION.ev_port, ports));
  }
  if (km > 0) {
    if (e.rainProtectionDelta) {
      materials = materials.concat(scaled(COMPOSITION.covered_walkway_per_km, km));
    } else if (e.cycleMaxKmExtension || e.safetyDelta?.cycle) {
      materials = materials.concat(scaled(COMPOSITION.cycle_lane_per_km, km));
    }
    if (e.shadeDelta) {
      materials = materials.concat(scaled(COMPOSITION.shade_trees_per_km, km));
    }
  }

  // Merge duplicate materials (e.g. copper from both battery and charger).
  const merged = new Map<string, MaterialLine>();
  for (const m of materials) {
    const cur = merged.get(m.material);
    if (cur) cur.tonnes += m.tonnes;
    else merged.set(m.material, { ...m });
  }
  const lines = [...merged.values()].map((l) => ({
    ...l,
    tonnes: Math.round(l.tonnes * 100) / 100,
  }));

  const totalTonnes = lines.reduce((s, l) => s + l.tonnes, 0);
  const recyclablePct =
    totalTonnes > 0
      ? Math.round(
          lines.reduce((s, l) => s + l.tonnes * (l.recyclablePct / 100), 0) /
            totalTonnes *
            100
        )
      : 0;

  // End-of-life carbon = fraction of gate embodied, halved if take-back is on.
  const gateTonnesCO2 = embodiedForModifier(mod).totalKg / 1000;
  const eolFrac =
    category === "pv"
      ? EOL.pv
      : category === "battery"
      ? EOL.battery
      : category === "ev_charger"
      ? EOL.ev_charger
      : EOL.civil; // greening ≈ civil (near-zero, mostly organic)
  const takeback = Boolean(
    circ.secondLifeBattery || circ.pvRecycling || circ.modular
  );
  const eolTonnesCO2 =
    Math.round(
      gateTonnesCO2 * eolFrac * (takeback ? EOL.takebackCredit : 1) * 100
    ) / 100;

  const eolPlan = buildEolPlan(category, recyclablePct, takeback);

  return {
    modifierId: mod.id,
    label: mod.label,
    category,
    materials: lines,
    totalTonnes: Math.round(totalTonnes * 100) / 100,
    recyclablePct,
    gateTonnesCO2: Math.round(gateTonnesCO2 * 10) / 10,
    eolTonnesCO2,
    takeback,
    eolPlan,
  };
}

function buildEolPlan(
  category: PassportEntry["category"],
  recyclablePct: number,
  takeback: boolean
): string {
  const base: Record<PassportEntry["category"], string> = {
    pv: "Panels de-framed at ~25-30 yr; glass, aluminium and silicon recovered via a PV take-back stream.",
    battery:
      "Cells assessed at ~12-15 yr; healthy modules go to second-life storage, spent actives to hydromet recycling.",
    ev_charger:
      "Charger hardware (~10-12 yr) dismantled; steel and copper recovered, electronics to WEEE recycling.",
    civil:
      "Concrete crushed and downcycled to aggregate; steel reinforcement recovered at demolition.",
    greening:
      "Planting is carbon-storing and compostable; no disposal burden at end-of-life.",
  };
  const takebackNote = takeback
    ? " Supplier take-back clause in place — vendor collects and recycles the asset (net end-of-life carbon roughly halved)."
    : " No take-back clause yet — add one at procurement to cut end-of-life carbon.";
  return `${base[category]} ~${recyclablePct}% recyclable by mass.${takebackNote}`;
}

export interface PassportSummary {
  entries: PassportEntry[];
  totalTonnesMaterial: number;
  avgRecyclablePct: number;
  totalGateTonnesCO2: number;
  totalEolTonnesCO2: number;
  totalCradleToGraveTonnesCO2: number; // gate + eol
}

/** Whole-package material passport across all modifiers. */
export function passportSummary(modifiers: WorldModifier[]): PassportSummary {
  const entries = modifiers.map(passportForModifier);
  const totalTonnesMaterial = entries.reduce((s, e) => s + e.totalTonnes, 0);
  const totalGateTonnesCO2 = entries.reduce((s, e) => s + e.gateTonnesCO2, 0);
  const totalEolTonnesCO2 = entries.reduce((s, e) => s + e.eolTonnesCO2, 0);
  const avgRecyclablePct =
    totalTonnesMaterial > 0
      ? Math.round(
          entries.reduce((s, e) => s + e.totalTonnes * e.recyclablePct, 0) /
            totalTonnesMaterial
        )
      : 0;
  return {
    entries,
    totalTonnesMaterial: Math.round(totalTonnesMaterial * 10) / 10,
    avgRecyclablePct,
    totalGateTonnesCO2: Math.round(totalGateTonnesCO2 * 10) / 10,
    totalEolTonnesCO2: Math.round(totalEolTonnesCO2 * 10) / 10,
    totalCradleToGraveTonnesCO2:
      Math.round((totalGateTonnesCO2 + totalEolTonnesCO2) * 10) / 10,
  };
}
