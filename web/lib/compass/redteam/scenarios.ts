// Red-team / stress-test suite — deliberately BAD interventions that HELIO
// SHOULD reject, flag, or rate poorly. The point is to prove the tool does not
// just say "implement" to everything: it can defer a problem-shift, block a
// physically impossible siting, and expose a terrible cost-per-tonne.
//
// Each scenario declares what it expects. runRedTeam() runs the real engine +
// decision gate + substitution + placement check and reports whether the bad
// idea was caught. `critical` scenarios MUST be caught or the CLI fails the build.

import { loadBaselineWorld } from "@/lib/compass/world/buildWorld";
import { simulateTimeline } from "@/lib/compass/world/simulateTimeline";
import { buildModifier } from "@/lib/compass/flow/scenario";
import { decisionGate } from "@/lib/compass/act/decisionGate";
import { verdictFor } from "@/lib/compass/finance/verdict";
import { substitutionRisk } from "@/lib/compass/lifecycle/substitution";
import { placementCheck } from "@/lib/compass/feasibility/placementCheck";
import { loadFeasibilityGeo } from "@/lib/compass/feasibility/geoData";
import type { ModifierGeometry, WorldModifier } from "@/lib/compass/world/types";

const START = 2026;
const END = 2036;

// What we assert about a bad intervention.
type Expect =
  | { kind: "defer" } // decision gate should DEFER
  | { kind: "regrettable" } // substitution risk should flag it
  | { kind: "placement-block" } // placement check should hard-block
  | { kind: "placement-flag" } // placement check should at least flag (review/block)
  | { kind: "poor-carbon-value" }; // cost/tonne verdict should be POOR_VALUE (weak on carbon)

interface Scenario {
  id: string;
  label: string;
  whyBad: string;
  geometry: ModifierGeometry;
  caps: string[];
  circular?: { secondLifeBattery?: boolean; pvRecycling?: boolean; modular?: boolean };
  expect: Expect;
  critical: boolean; // if true, a miss fails the CLI build
}

const TOWER_PATH: [number, number][] = [[103.77777, 1.312503], [103.77857, 1.312503]]; // through the 144 m OSM building
const OPEN_FIELD: [number, number] = [103.715, 1.315]; // away from any host structure
const STUB: [number, number][] = [[103.742, 1.333], [103.7423, 1.3331]]; // ~30 m — trivial length, top-tier capex

const SCENARIOS: Scenario[] = [
  {
    id: "standalone_battery",
    label: "Standalone grid battery, no co-benefit",
    whyBad: "High embodied carbon to build, no solar/EV pairing and no heat/comfort benefit — shifts the burden to manufacturing.",
    geometry: { type: "Point", coordinates: OPEN_FIELD },
    caps: ["battery"],
    expect: { kind: "regrettable" },
    critical: true,
  },
  {
    id: "path_through_tower",
    label: "Sheltered path routed through a 144 m tower",
    whyBad: "The alignment runs straight through a real multi-storey building footprint — physically impossible.",
    geometry: { type: "LineString", coordinates: TOWER_PATH },
    caps: ["rain_protection", "adds_shade"],
    expect: { kind: "placement-block" },
    critical: true,
  },
  {
    id: "solar_no_host",
    label: "Solar canopy in an open field, no host structure",
    whyBad: "A canopy needs a roof/shelter/deck to mount on; sited in the open it has nothing to attach to.",
    geometry: { type: "Point", coordinates: OPEN_FIELD },
    caps: ["solar_canopy"],
    expect: { kind: "placement-flag" },
    critical: true,
  },
  {
    id: "gold_plated_car_restriction",
    label: "$2M car restriction on a 30 m stub",
    whyBad: "Top-tier capex to restrict cars on a trivial segment — a stupendous cost per tonne, weak on carbon and with no offsetting scale.",
    geometry: { type: "LineString", coordinates: STUB },
    caps: ["restricts_cars"],
    expect: { kind: "poor-carbon-value" },
    critical: true,
  },
];

export type RedTeamStatus = "caught" | "missed";

export interface RedTeamRow {
  id: string;
  label: string;
  whyBad: string;
  expected: string;
  observed: string;
  status: RedTeamStatus;
  critical: boolean;
}

export interface RedTeamReport {
  rows: RedTeamRow[];
  summary: { caught: number; total: number; criticalMissed: number };
}

function describeExpect(e: Expect): string {
  switch (e.kind) {
    case "defer": return "decision gate → DEFER";
    case "regrettable": return "flagged as regrettable substitution";
    case "placement-block": return "placement check → BLOCK";
    case "placement-flag": return "placement check → flag (review/block)";
    case "poor-carbon-value": return "cost/tonne verdict → POOR_VALUE";
  }
}

export async function runRedTeam(): Promise<RedTeamReport> {
  const world = await loadBaselineWorld("jurong_east", START);
  const geo = await loadFeasibilityGeo();
  const rows: RedTeamRow[] = [];

  for (const sc of SCENARIOS) {
    const mod: WorldModifier = buildModifier({
      geometry: sc.geometry,
      capabilityIds: sc.caps,
      costTier: "high",
      builtYear: 2027,
      circular: sc.circular,
    });
    const scen = simulateTimeline(world, [mod], START, END, "target_achieved", []);
    const gate = decisionGate(scen, [mod]);
    const sub = substitutionRisk(scen.summary);
    const place = placementCheck(mod, world, geo);
    const cpt = scen.summary.costPerTonneUsd;

    let status: RedTeamStatus = "missed";
    let observed = "";
    switch (sc.expect.kind) {
      case "defer":
        status = gate.gate === "DEFER" ? "caught" : "missed";
        observed = `gate ${gate.gate}`;
        break;
      case "regrettable":
        status = sub.regrettable ? "caught" : "missed";
        observed = sub.regrettable ? `regrettable: ${sub.reasons[0] ?? ""}` : `not flagged (gate ${gate.gate})`;
        break;
      case "placement-block":
        status = place.severity === "block" ? "caught" : "missed";
        observed = `placement ${place.severity}${place.flags[0] ? ` — ${place.flags[0].code}` : ""}`;
        break;
      case "placement-flag":
        status = place.severity === "block" || place.severity === "review" ? "caught" : "missed";
        observed = `placement ${place.severity}${place.flags[0] ? ` — ${place.flags[0].code}` : ""}`;
        break;
      case "poor-carbon-value": {
        const v = verdictFor(cpt);
        status = v.verdict === "POOR_VALUE" ? "caught" : "missed";
        observed = cpt === null
          ? "cost/tonne n/a (no CO₂ avoided)"
          : `cost/tonne $${Math.round(cpt).toLocaleString()} — ${v.label} (gate ${gate.gate})`;
        break;
      }
    }

    rows.push({
      id: sc.id,
      label: sc.label,
      whyBad: sc.whyBad,
      expected: describeExpect(sc.expect),
      observed,
      status,
      critical: sc.critical,
    });
  }

  return {
    rows,
    summary: {
      caught: rows.filter((r) => r.status === "caught").length,
      total: rows.length,
      criticalMissed: rows.filter((r) => r.critical && r.status === "missed").length,
    },
  };
}
