// Browser-side helpers for the HELIO Flow sandbox: capability presets that
// compose WorldModifier.effects, and the simulate fetch.
//
// Presets are the sandbox "physics vocabulary" — deltas the user assembles by
// choosing what a drawn object DOES. They are not hardcoded interventions.

import type {
  WorldModifier,
  ModifierGeometry,
  ScenarioResult,
  Shock,
} from "../world/types";
import { capexForModifier } from "../finance/intervention";
import fin from "@/data/assumptions/finance.json";

export interface Capability {
  id: string;
  label: string;
  hint: string;
  confidence: "literature-derived" | "calibrated proxy";
  effects: WorldModifier["effects"];
}

export const CAPABILITIES: Capability[] = [
  {
    id: "allows_cycling",
    label: "Cycling link",
    hint: "Protected route: +1.5 km cycle reach, safer + more comfortable cycling",
    confidence: "literature-derived",
    effects: { cycleMaxKmExtension: 1.5, safetyDelta: { cycle: 0.3 }, comfortDelta: { cycle: 0.2 } },
  },
  {
    id: "walk_link",
    label: "Walking link",
    hint: "Direct pedestrian connection: more comfortable walking",
    confidence: "calibrated proxy",
    effects: { comfortDelta: { walk: 0.25 } },
  },
  {
    id: "adds_shade",
    label: "Adds shade",
    hint: "Trees / canopy: shade +0.45 → lower effective heat (UTCI literature)",
    confidence: "literature-derived",
    effects: { shadeDelta: 0.45 },
  },
  {
    id: "rain_protection",
    label: "Rain protection",
    hint: "Covered link: rain exposure −0.5 on affected corridors",
    confidence: "calibrated proxy",
    effects: { rainProtectionDelta: 0.5 },
  },
  {
    id: "restricts_cars",
    label: "Restricts cars",
    hint: "Road-space reallocation: +3 min car access penalty",
    confidence: "literature-derived",
    effects: { carTimePenaltyMin: 3 },
  },
  {
    id: "faster_cycle",
    label: "Shortcut (cycle)",
    hint: "Bridge / direct link: cycle travel time ×0.75",
    confidence: "calibrated proxy",
    effects: { travelTimeMultiplier: { cycle: 0.75 } },
  },
  {
    id: "better_bus",
    label: "Better bus service",
    hint: "Frequency upgrade: −3 min bus wait (headway elasticity literature)",
    confidence: "literature-derived",
    effects: { busWaitDeltaMin: -3 },
  },
  {
    id: "solar_canopy",
    label: "Generates solar",
    hint: "≈100 kWp canopy → 120 MWh/yr at SG yield (1,200 kWh/kWp)",
    confidence: "literature-derived",
    effects: { solarAnnualKWhDelta: 120_000 },
  },
  {
    id: "ev_charging",
    label: "EV charging hub",
    hint: "8 × 22 kW ports; net CO₂ vs that year's car fleet & grid",
    confidence: "literature-derived",
    effects: { chargingCapacityKWDelta: 176 },
  },
  {
    id: "battery",
    label: "Stores energy",
    hint: "300 kWh battery (detailed dispatch arrives with the energy engine)",
    confidence: "literature-derived",
    effects: { batteryCapacityKWhDelta: 300 },
  },
];

export const COST_TIERS = [
  { id: "low", label: "Low (~$150k)", capexUsd: 150_000 },
  { id: "med", label: "Medium (~$500k)", capexUsd: 500_000 },
  { id: "high", label: "High (~$2M)", capexUsd: 2_000_000 },
] as const;

const OPEX_RATE = 0.02; // annual opex as share of capex (calibrated proxy)

// Mirrors the engine's 10-year adoption ramp (world_defaults.json) for visual fade-in.
const ADOPTION_RAMP = [0.1, 0.2, 0.32, 0.45, 0.58, 0.7, 0.8, 0.88, 0.95, 1.0];

export function rampFor(year: number, builtYear: number): number {
  const dy = year - builtYear;
  if (dy < 0) return 0;
  return ADOPTION_RAMP[Math.min(dy, ADOPTION_RAMP.length - 1)];
}

let counter = 0;

export interface CircularChoice {
  secondLifeBattery?: boolean;
  pvRecycling?: boolean;
  modular?: boolean;
}

export function buildModifier(opts: {
  geometry: ModifierGeometry;
  capabilityIds: string[];
  costTier: (typeof COST_TIERS)[number]["id"];
  builtYear: number;
  label?: string;
  circular?: CircularChoice;
}): WorldModifier {
  const effects: WorldModifier["effects"] = {};
  const picked = CAPABILITIES.filter((c) => opts.capabilityIds.includes(c.id));
  for (const cap of picked) {
    for (const [k, v] of Object.entries(cap.effects)) {
      const key = k as keyof WorldModifier["effects"];
      if (typeof v === "number") {
        (effects as any)[key] = ((effects as any)[key] ?? (k.includes("Multiplier") ? 1 : 0));
        if (k.includes("Multiplier")) (effects as any)[key] *= v;
        else (effects as any)[key] += v;
      } else if (v && typeof v === "object") {
        const cur = ((effects as any)[key] ?? {}) as Record<string, number>;
        for (const [mode, mv] of Object.entries(v as Record<string, number>)) {
          if (k === "travelTimeMultiplier" || k === "costMultiplier") {
            cur[mode] = (cur[mode] ?? 1) * mv;
          } else {
            cur[mode] = (cur[mode] ?? 0) + mv;
          }
        }
        (effects as any)[key] = cur;
      }
    }
  }

  const tier = COST_TIERS.find((t) => t.id === opts.costTier) ?? COST_TIERS[0];
  const anyProxy = picked.some((c) => c.confidence === "calibrated proxy");
  const hasCircular = opts.circular && Object.values(opts.circular).some(Boolean);

  const draft: WorldModifier = {
    id: `mod_${++counter}_${Date.now().toString(36)}`,
    label: opts.label || picked.map((c) => c.label).join(" + ") || "Custom change",
    geometry: opts.geometry,
    effects,
    economics: { capexUsd: tier.capexUsd, annualOpexUsd: Math.round(tier.capexUsd * OPEX_RATE), lifetimeYears: 15 },
    metadata: {
      createdBy: "user",
      confidence: anyProxy ? "calibrated proxy" : "literature-derived",
      builtYear: opts.builtYear,
    },
    ...(hasCircular ? { lifecycle: { circular: opts.circular } } : {}),
  };

  // Real capex from official unit costs when the drawn quantities allow it;
  // the coarse tier is only a fallback for non-quantifiable changes (e.g. bus).
  const cap = capexForModifier(draft);
  if (cap.totalUsd > 0) {
    draft.economics = {
      capexUsd: Math.round(cap.totalUsd),
      annualOpexUsd: Math.round(cap.opexPerYearUsd),
      lifetimeYears: 15,
    };
  }
  return draft;
}

/** Which circular options are relevant for a given capability set. */
export function circularOptionsFor(capabilityIds: string[]): { id: keyof CircularChoice; label: string; hint: string }[] {
  const out: { id: keyof CircularChoice; label: string; hint: string }[] = [];
  if (capabilityIds.includes("battery") || capabilityIds.includes("ev_charging"))
    out.push({ id: "secondLifeBattery", label: "Second-life battery", hint: "Reuse retired EV cells — ~55% less embodied carbon" });
  if (capabilityIds.includes("solar_canopy"))
    out.push({ id: "pvRecycling", label: "Recycled-content PV", hint: "Design-for-recycling modules — ~15% less embodied carbon" });
  if (capabilityIds.includes("ev_charging"))
    out.push({ id: "modular", label: "Modular / repairable", hint: "Repairable hardware avoids ~one replacement over 10 yr" });
  return out;
}

export type PathwayId = "target_achieved" | "delayed" | "accelerated" | "frozen" | "lta_trend";

export const PATHWAYS: { id: PathwayId; label: string; hint: string }[] = [
  { id: "target_achieved", label: "Green Plan achieved", hint: "Singapore hits its 2030 targets" },
  { id: "delayed", label: "Delayed", hint: "Transition slips ~5 years" },
  { id: "accelerated", label: "Accelerated", hint: "Faster than target" },
  { id: "frozen", label: "Frozen", hint: "2026 city, no transition" },
  { id: "lta_trend", label: "LTA EV trend", hint: "Green Plan, but car fleet follows the real EV adoption curve" },
];

// ---- Shocks -----------------------------------------------------------------

export interface ShockPreset {
  id: string;
  label: string;
  hint: string;
  defaultYear: number;
  make: (startYear: number) => Shock;
}

export const SHOCK_PRESETS: ShockPreset[] = [
  {
    id: "heatwave",
    label: "Heatwave",
    hint: "3 severe years: heat exposure ×1.6 — shade cushions it",
    defaultYear: 2029,
    make: (y) => ({ type: "heatwave", startYear: y, durationYears: 3, severity: 0.6 }),
  },
  {
    id: "oil",
    label: "Oil price spike",
    hint: "+40% car cost for 3 years",
    defaultYear: 2028,
    make: (y) => ({ type: "oil_price_spike", startYear: y, durationYears: 3, carCostIncreasePct: 40 }),
  },
  {
    id: "pandemic",
    label: "Pandemic",
    hint: "−45% travel demand for 2 years, 3-year recovery",
    defaultYear: 2030,
    make: (y) => ({ type: "pandemic", startYear: y, durationYears: 2, demandDropPct: 45, recoveryYears: 3 }),
  },
  {
    id: "grid",
    label: "Grid carbon spike",
    hint: "Grid CI ×1.3 for 2 years — hits MRT, e-bus, EV; boosts solar value",
    defaultYear: 2031,
    make: (y) => ({ type: "grid_carbon_spike", startYear: y, durationYears: 2, gridFactorMultiplier: 1.3 }),
  },
  {
    id: "rain",
    label: "Monsoon intensification",
    hint: "Rain exposure ×1.5 for 3 years — covered links cushion it",
    defaultYear: 2027,
    make: (y) => ({ type: "heavy_rain", startYear: y, durationYears: 3, severity: 0.5 }),
  },
  {
    id: "haze",
    label: "Transboundary haze",
    hint: "PSI 200 for ~30 days a year, 3 years: cycling and walking fall on haze days, rooftop PV yield dips; shelters don't help",
    defaultYear: 2026,
    make: (y) => ({ type: "haze", startYear: y, durationYears: 3, psi: 200, daysPerYear: 30 }),
  },
  {
    id: "mrt_loop",
    label: "MRT Circle Line loop closes",
    hint: "Yellow-line loop shut → MRT ~18% faster on affected corridors; trips shift off car & bus",
    defaultYear: 2026,
    make: (y) => ({ type: "mrt_loop_closure", startYear: y, durationYears: 11, mrtSpeedupPct: 18 }),
  },
];

// ---- EV opportunity zones -----------------------------------------------------

export interface EvSite {
  id: string;
  name: string;
  lat: number;
  lng: number;
  score: number;
  reasons: string[];
  recommendedAsset: {
    ports: number;
    chargerPowerKW: number;
    chargingCapacityKW: number;
    batteryKWh: number;
    solarCanopyKWhYr: number;
    capexUsd: number;
  };
}

/** Accepting a HELIO-recommended site instantiates a normal WorldModifier. */
export function evSiteModifier(site: EvSite, builtYear: number): WorldModifier {
  const a = site.recommendedAsset;
  return {
    id: `mod_ev_${site.id}`,
    label: `EV hub · ${site.name}`,
    geometry: { type: "Point", coordinates: [site.lng, site.lat] },
    effects: {
      chargingCapacityKWDelta: a.chargingCapacityKW,
      batteryCapacityKWhDelta: a.batteryKWh,
      ...(a.solarCanopyKWhYr ? { solarAnnualKWhDelta: a.solarCanopyKWhYr } : {}),
    },
    economics: { capexUsd: a.capexUsd, annualOpexUsd: Math.round(a.capexUsd * 0.02), lifetimeYears: 15 },
    metadata: { createdBy: "optimizer", confidence: "literature-derived", builtYear },
  };
}

// ---- Optimizer ----------------------------------------------------------------

export interface Suggestion {
  modifier: WorldModifier;
  reason: string;
  aloneAvoidedT: number;
  aloneCostPerTonneUsd: number | null;
  aloneHeatReducedPct: number;
  utilityPerMillionUsd: number;
  selected: boolean;
  regrettable: boolean;
  regrettableReason?: string;
  feasibility?: {
    severity: "block" | "review" | "ok";
    feasible: boolean;
    flags: { code: string; message: string; fix: string }[];
    summary: string;
  };
}

export interface ParetoPackage {
  ids: string[];
  labels: string[];
  capexUsd: number;
  co2AvoidedT: number;
  heatReducedPct: number;
  costPerTonneUsd: number | null;
  builtFromWeight: number;
  onFrontier: boolean;
  isRecommended: boolean;
}

export interface OptimizeResult {
  budgetUsd: number;
  considered: number;
  suggestions: Suggestion[];
  package: {
    ids: string[];
    capexUsd: number;
    cumulativeCO2AvoidedTonnes: number;
    costPerTonneUsd: number | null;
    heatExposureReducedPct: number;
  } | null;
  paretoPackages?: ParetoPackage[];
  objective: string;
  note: string;
}

export async function fetchSuggestions(opts: {
  budgetUsd: number;
  policyPathway: PathwayId;
  shocks: Shock[];
  existingModifierIds: string[];
  districtId?: string;
}): Promise<OptimizeResult> {
  const r = await fetch("/api/compass/optimize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!r.ok) throw new Error(`optimize: ${r.status} ${await r.text()}`);
  return r.json();
}

export type EvDisplacementLevel = "conservative" | "base" | "aggressive";

export async function simulateScenario(
  modifiers: WorldModifier[],
  startYear = 2026,
  endYear = 2036,
  policyPathway: PathwayId = "target_achieved",
  shocks: Shock[] = [],
  evDisplacement: EvDisplacementLevel = "base",
  districtId = "jurong_east"
): Promise<ScenarioResult> {
  const r = await fetch("/api/compass/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modifiers, startYear, endYear, policyPathway, shocks, evDisplacement, districtId }),
  });
  if (!r.ok) throw new Error(`simulate: ${r.status} ${await r.text()}`);
  return r.json();
}

export type { Shock };

export type { WorldModifier, ModifierGeometry, ScenarioResult };
