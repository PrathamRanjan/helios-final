// Map a drawn/placed WorldModifier to a report ReportInput so the feasibility
// report (before → after + siting + pulse) works for ANY intervention type, not
// just EV sites. EV sites keep their own cached-report path (via siteId); this
// covers cycle corridors, sheltered walkways, shade/trees, solar canopies, bus
// priority, and anything else the sandbox can hold.

import type { ReportInput } from "./buildReport";
import type { InterventionSpec } from "./imagery";
import type { WorldModifier, ModifierGeometry } from "../world/types";

/** Centroid [lat, lng] of any modifier geometry — the report's map anchor. */
function centroid(g: ModifierGeometry): { lat: number; lng: number } {
  let pts: [number, number][];
  if (g.type === "Point") pts = [g.coordinates];
  else if (g.type === "LineString") pts = g.coordinates;
  else pts = g.coordinates[0] ?? [];
  if (pts.length === 0) return { lat: 1.333, lng: 103.742 }; // Jurong East fallback
  let sx = 0, sy = 0;
  for (const [lng, lat] of pts) { sx += lng; sy += lat; }
  return { lat: sy / pts.length, lng: sx / pts.length };
}

/** Classify a modifier into an imagery/civic kind from its effects. */
function specKind(m: WorldModifier): InterventionSpec["kind"] {
  const e = m.effects;
  if (e.chargingCapacityKWDelta) return "ev_charging";
  if (e.solarAnnualKWhDelta) return "solar_canopy";
  if (e.busWaitDeltaMin != null && e.busWaitDeltaMin !== 0) return "bus";
  const addsCycle =
    e.allowedModesAdd?.includes("cycle") ||
    e.cycleMaxKmExtension ||
    (e.comfortDelta?.cycle ?? 0) > 0 ||
    (e.safetyDelta?.cycle ?? 0) > 0;
  if (addsCycle) return "cycling";
  if (e.shadeDelta || e.rainProtectionDelta) return "shade";
  return "generic";
}

/** One-line physical-asset description from the modifier's dominant effects. */
function assetDescription(m: WorldModifier, kind: InterventionSpec["kind"]): string {
  const e = m.effects;
  switch (kind) {
    case "ev_charging":
      return `${Math.round(e.chargingCapacityKWDelta ?? 0)} kW of public charging${
        e.batteryCapacityKWhDelta ? ` + ${Math.round(e.batteryCapacityKWhDelta)} kWh battery` : ""
      }`;
    case "solar_canopy":
      return `~${Math.round((e.solarAnnualKWhDelta ?? 0) / 1000).toLocaleString()} MWh/yr solar canopy`;
    case "cycling":
      return e.cycleMaxKmExtension
        ? `Protected cycle corridor (+${e.cycleMaxKmExtension} km comfortable range)`
        : "Protected cycle corridor";
    case "shade":
      return e.rainProtectionDelta
        ? "Sheltered / covered walkway"
        : "Shade corridor (trees / canopy)";
    case "bus":
      return `Bus priority (${(e.busWaitDeltaMin ?? 0) < 0 ? "" : "+"}${e.busWaitDeltaMin} min wait)`;
    default:
      return m.label;
  }
}

/** Short human reasons pulled from the modifier's effects — the "why here" bullets. */
function reasons(m: WorldModifier): string[] {
  const e = m.effects;
  const out: string[] = [];
  if (e.shadeDelta) out.push(`Raises shade by ${Math.round(e.shadeDelta * 100)}% along the corridor`);
  if (e.rainProtectionDelta) out.push(`Adds ${Math.round(e.rainProtectionDelta * 100)}% rain protection`);
  if (e.carTimePenaltyMin) out.push(`Adds ${e.carTimePenaltyMin} min to car trips through here`);
  if (e.busWaitDeltaMin) out.push(`Changes bus wait by ${e.busWaitDeltaMin} min`);
  if (e.cycleMaxKmExtension) out.push(`Extends comfortable cycling range by ${e.cycleMaxKmExtension} km`);
  if (e.solarAnnualKWhDelta) out.push(`Generates ~${Math.round(e.solarAnnualKWhDelta / 1000).toLocaleString()} MWh/yr`);
  if (e.chargingCapacityKWDelta) out.push(`Adds ${Math.round(e.chargingCapacityKWDelta)} kW of charging capacity`);
  for (const n of m.metadata.notes ?? []) out.push(n);
  return out.length ? out : [m.label];
}

const KIND_TITLE: Record<InterventionSpec["kind"], string> = {
  ev_charging: "EV charging hub",
  solar_canopy: "Solar canopy",
  cycling: "Protected cycle corridor",
  shade: "Shade / sheltered corridor",
  bus: "Bus priority",
  generic: "Intervention",
};

/**
 * Build the report input for a drawn/placed modifier. Optional impact numbers
 * (cumulative CO₂ avoided, cost/tonne) can be threaded in from the scenario run.
 */
export function modifierToReportInput(
  m: WorldModifier,
  impact?: ReportInput["impact"]
): ReportInput {
  const kind = specKind(m);
  const { lat, lng } = centroid(m.geometry);
  return {
    id: m.id,
    spec: {
      kind,
      title: `${KIND_TITLE[kind]} · ${m.label}`,
      asset: assetDescription(m, kind),
    },
    lat,
    lng,
    computational: { reasons: reasons(m) },
    impact,
  };
}
