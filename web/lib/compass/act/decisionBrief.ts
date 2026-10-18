// "Act on this" decision brief — turns a funded scenario into next-step actions:
// rollout phasing, grant offsets, real suppliers, procurement readiness, SDG
// alignment, risks to manage, and monitoring KPIs. All from frozen data + the
// scenario the planner already ran. This is the Data→Decision→ACTION link.

import type { ScenarioResult, WorldModifier } from "../world/types";
import { substitutionRisk } from "../lifecycle/substitution";
import { civicForModifierEffects } from "../civic/civicScore";
import dir from "@/data/act_directory.json";

export type AssetKind = "ev_charging" | "solar" | "cycling" | "walkway" | "greenery" | "battery";

/** Which directory asset kinds a modifier's effects touch. */
export function kindsForModifier(mod: WorldModifier): AssetKind[] {
  const e = mod.effects;
  const kinds: AssetKind[] = [];
  if (e.chargingCapacityKWDelta) kinds.push("ev_charging");
  if (e.batteryCapacityKWhDelta) kinds.push("battery");
  if (e.solarAnnualKWhDelta) kinds.push("solar");
  if (e.cycleMaxKmExtension || e.safetyDelta?.cycle) kinds.push("cycling");
  if (e.rainProtectionDelta) kinds.push("walkway");
  if (e.shadeDelta) kinds.push("greenery");
  return kinds;
}

export interface GrantLine { name: string; offsetUsd: number; note: string }
export interface SupplierLine { name: string; type: string; circular: string[]; forKind: string }
export interface RolloutPhase { year: number; items: string[] }
export interface RiskLine { label: string; detail: string; severity: "high" | "med" }
export interface DecisionBrief {
  headline: { capexUsd: number; netCapexAfterGrantsUsd: number; co2Tonnes: number; netCo2Tonnes: number; costPerTonneUsd: number | null; moneyPaybackYear: number | null };
  rollout: RolloutPhase[];
  grants: GrantLine[];
  suppliers: SupplierLine[];
  procurement: { kind: string; land: string; grid: string; permit: string }[];
  sdgs: { goal: number; label: string }[];
  risks: RiskLine[];
  monitoring: string[];
}

const D = dir as any;

export function decisionBrief(result: ScenarioResult, modifiers: WorldModifier[]): DecisionBrief {
  const s = result.summary;
  const kindsPresent = new Set<AssetKind>();
  modifiers.forEach((m) => kindsForModifier(m).forEach((k) => kindsPresent.add(k)));

  // --- Grants (offset where computable, notably EV per-port cap) ---
  const grants: GrantLine[] = [];
  let grantOffset = 0;
  const grantSeen = new Set<string>();
  for (const mod of modifiers) {
    for (const k of kindsForModifier(mod)) {
      const g = D.grants[k];
      if (!g || grantSeen.has(g.name)) {
        if (g && k === "ev_charging") {
          // still accumulate offset per EV modifier even if name already listed
        } else {
          continue;
        }
      }
      let offset = 0;
      if (k === "ev_charging" && mod.effects.chargingCapacityKWDelta) {
        const ports = Math.max(1, Math.round(mod.effects.chargingCapacityKWDelta / 22));
        offset = Math.min(g.co_fund_pct * mod.economics.capexUsd, ports * g.cap_usd_per_port);
        grantOffset += offset;
      }
      if (!grantSeen.has(g.name)) {
        grantSeen.add(g.name);
        grants.push({
          name: g.name,
          offsetUsd: Math.round(offset),
          note: offset > 0 ? `~${Math.round((offset / mod.economics.capexUsd) * 100)}% of build cost co-funded` : "programme-level support (procurement / co-funding)",
        });
      }
    }
  }

  // --- Suppliers (deduped, by present kinds) ---
  const suppliers: SupplierLine[] = [];
  const supSeen = new Set<string>();
  for (const k of kindsPresent) {
    for (const sup of D.suppliers[k] ?? []) {
      const key = `${sup.name}:${k}`;
      if (supSeen.has(key)) continue;
      supSeen.add(key);
      suppliers.push({ name: sup.name, type: sup.type, circular: sup.circular ?? [], forKind: k });
    }
  }

  // --- Procurement readiness (per present kind) ---
  const procurement = [...kindsPresent].map((k) => ({ kind: k, ...D.procurement[k] }));

  // --- SDG alignment (union) ---
  const goals = new Set<number>();
  for (const k of kindsPresent) (D.sdg[k] ?? []).forEach((g: number) => goals.add(g));
  const sdgs = [...goals].sort((a, b) => a - b).map((g) => ({ goal: g, label: D.sdg_labels[String(g)] }));

  // --- Rollout phasing (by build year) ---
  const byYear = new Map<number, string[]>();
  for (const m of modifiers) {
    const y = m.metadata.builtYear;
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(m.label);
  }
  const rollout = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, items]) => ({ year, items }));

  // --- Risks to manage ---
  const risks: RiskLine[] = [];
  const sub = substitutionRisk(s);
  if (sub.regrettable) risks.push({ label: "Regrettable substitution", detail: sub.reasons[0], severity: "high" });
  else if (s.netNegativeOnCarbon) risks.push({ label: "Carbon-negative on build", detail: "Justified by heat/comfort, not carbon — confirm the co-benefit is wanted.", severity: "med" });
  if (kindsPresent.has("ev_charging")) risks.push({ label: "Grid headroom", detail: "Charger load vs local grid capacity is not modelled — verify before commissioning.", severity: "med" });
  // Top civic concern across interventions.
  for (const m of modifiers) {
    const civic = civicForModifierEffects(m.effects as any);
    if (civic && civic.sentimentWord === "opposed") {
      risks.push({ label: "Public acceptance", detail: `Residents lean opposed on ${civic.topics.join("/")} (Reddit discourse proxy, n=${civic.nPosts}).`, severity: "med" });
      break;
    }
  }

  // --- Monitoring KPIs (what to measure to confirm the modelled impact) ---
  const monitoring: string[] = [];
  if (kindsPresent.has("solar")) monitoring.push("Metered annual kWh generated vs modelled");
  if (kindsPresent.has("ev_charging")) monitoring.push("Charger utilisation % and kWh dispensed");
  if (kindsPresent.has("cycling") || kindsPresent.has("walkway") || kindsPresent.has("greenery"))
    monitoring.push("Corridor pedestrian/cycle counts before vs after");
  monitoring.push("Bus/MRT ridership on affected corridors (LTA fare-card)");

  const netCapex = Math.max(0, s.capexUsd - grantOffset);

  return {
    headline: {
      capexUsd: s.capexUsd,
      netCapexAfterGrantsUsd: netCapex,
      co2Tonnes: s.cumulativeCO2AvoidedTonnes,
      netCo2Tonnes: s.netCO2AvoidedTonnes,
      costPerTonneUsd: s.costPerTonneUsd,
      moneyPaybackYear: s.moneyPaybackYear,
    },
    rollout,
    grants,
    suppliers,
    procurement,
    sdgs,
    risks,
    monitoring,
  };
}
