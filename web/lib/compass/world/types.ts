// HELIO Flow world model — shared types.
//
// The philosophy (see v3/HELIO_FLOW_V3_MASTERPLAN.md §5): nothing is a hardcoded
// intervention. Users, policies and shocks produce generic WorldModifiers that edit
// graph attributes; agent cohorts re-choose modes; carbon change is emergent.

import type { Mode, ModeSplit } from "../types";

export type ConfidenceLabel =
  | "measured"
  | "literature-derived"
  | "calibrated proxy"
  | "speculative"
  | "policy pathway";

/** A node in the city graph (transit stop/station, building, or drawn asset). */
export interface WorldNode {
  id: string;
  type: "bus_stop" | "mrt_station" | "building" | "charging_node" | "solar_asset" | "battery_asset";
  name: string;
  lat: number;
  lng: number;
  attrs: {
    footfallDaily?: number; // tap_in + tap_out, measured (LTA PV)
    solarAnnualKWh?: number; // measured (Google Solar API)
    solarKwp?: number;
    chargingCapacityKW?: number;
  };
}

/**
 * A corridor edge: one aggregated OD pair carrying real transit demand
 * (LTA fare-card OD, measured) plus environmental attributes agents react to.
 */
export interface CorridorEdge {
  id: string;
  from: string; // node id
  to: string;
  distKm: number; // haversine x detour factor, from ingest (measured geometry)
  midLat: number;
  midLng: number;
  observedTransitDaily: number; // measured: LTA OD / weekdays-in-month
  /** Census planning-area name for area-specific mode constants (worlds from ingest/build_area.py). */
  pa?: string;
  totalTripsDaily: number; // scaled by baseline PT share (calibrated proxy)
  attrs: EdgeEnv;
}

/** Environmental attributes on a corridor (0..1 scales). */
export interface EdgeEnv {
  heatExposure: number;
  rainExposure: number;
  shadeScore: number;
  comfortScore: number;
  safetyScore: number;
  /** Per-mode additive comfort/safety bonuses from modifiers (a protected
   *  cycle lane raises cycle safety, not car). */
  comfortBonus: Partial<Record<Mode, number>>;
  safetyBonus: Partial<Record<Mode, number>>;
  /** Per-mode travel-time multiplier (1 = unchanged). */
  travelTimeMultiplier: Partial<Record<Mode, number>>;
  /** Per-mode monetary-cost multiplier (1 = unchanged). */
  costMultiplier: Partial<Record<Mode, number>>;
  /** Additive minutes on car access (e.g. road-space reallocation). */
  carTimePenaltyMin: number;
  /** Additive minutes off bus wait (e.g. frequency upgrades). */
  busWaitDeltaMin: number;
  /** Extra km of cycling feasibility (e.g. protected corridor). */
  cycleMaxKmExtension: number;
}

/** One weighted agent cohort = the travellers of one corridor. */
export interface AgentCohort {
  id: string;
  edgeId: string;
  tripsPerDay: number;
  availableModes: Mode[];
}

export interface WorldState {
  year: number;
  districtId: string;
  nodes: WorldNode[];
  edges: CorridorEdge[];
  cohorts: AgentCohort[];
  /** District-level energy additions from modifiers (kWh/yr of new solar etc.). */
  energy: { addedSolarAnnualKWh: number; addedBatteryKWh: number; addedChargingKW: number };
}

// ---- Modifiers ----------------------------------------------------------

export type ModifierGeometry =
  | { type: "Point"; coordinates: [number, number] } // [lng, lat]
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "Polygon"; coordinates: [number, number][][] };

/**
 * The generic world modifier. Every drawn object, policy step, or optimizer
 * suggestion becomes one of these. Agents never see "tree" or "bridge" —
 * they see changed edge attributes.
 */
export interface WorldModifier {
  id: string;
  label: string;
  geometry: ModifierGeometry;
  effects: {
    shadeDelta?: number;
    rainProtectionDelta?: number;
    comfortDelta?: Partial<Record<Mode, number>>;
    safetyDelta?: Partial<Record<Mode, number>>;
    travelTimeMultiplier?: Partial<Record<Mode, number>>;
    costMultiplier?: Partial<Record<Mode, number>>;
    carTimePenaltyMin?: number;
    busWaitDeltaMin?: number;
    cycleMaxKmExtension?: number;
    allowedModesAdd?: Mode[];
    // Energy effects (accumulated district-wide; dispatched in detail from M5).
    solarAnnualKWhDelta?: number;
    batteryCapacityKWhDelta?: number;
    chargingCapacityKWDelta?: number;
  };
  economics: {
    capexUsd: number;
    annualOpexUsd: number;
    lifetimeYears: number;
  };
  metadata: {
    createdBy: "user" | "policy" | "optimizer" | "preset";
    confidence: ConfidenceLabel;
    builtYear: number; // first year the modifier exists in the world
    notes?: string[];
    /** BCA building the change sits on (rooftop solar) — lets compliance re-check its Green Mark tier. */
    hostBuildingId?: string;
  };
  /** Circular-procurement choices that reduce embodied carbon (see lifecycle engine). */
  lifecycle?: {
    circular?: { secondLifeBattery?: boolean; pvRecycling?: boolean; modular?: boolean };
  };
}

// ---- Shocks ----------------------------------------------------------------

/**
 * External events that hit the world regardless of the user's plan — they apply
 * to BOTH baseline and scenario, so results answer: "does my plan still deliver
 * under disruption?" Effects flow through the same physics agents already react
 * to (a heatwave raises heatExposure; shade cushions it automatically).
 */
export type Shock =
  | { type: "heatwave"; startYear: number; durationYears: number; severity: number }
  | { type: "heavy_rain"; startYear: number; durationYears: number; severity: number }
  | { type: "oil_price_spike"; startYear: number; durationYears: number; carCostIncreasePct: number }
  | { type: "pandemic"; startYear: number; durationYears: number; demandDropPct: number; recoveryYears: number }
  | { type: "grid_carbon_spike"; startYear: number; durationYears: number; gridFactorMultiplier: number }
  // A positive event: the Circle Line loop closes → MRT becomes materially faster/
  // more attractive on affected corridors, pulling trips off car & bus (mode shift
  // is emergent — agents just see a lower MRT travel-time multiplier).
  | { type: "mrt_loop_closure"; startYear: number; durationYears: number; mrtSpeedupPct: number }
  // Transboundary smoke haze: outdoor walking/cycling falls and PV yield drops on haze days.
  // Shelters don't help (it's the air, not the sun or rain); enclosed modes absorb the trips.
  | { type: "haze"; startYear: number; durationYears: number; psi: number; daysPerYear: number };

// ---- Simulation I/O ------------------------------------------------------

export interface ScenarioRequest {
  districtId?: string;
  startYear?: number;
  endYear?: number;
  modifiers: WorldModifier[];
  /** Green Plan pathway the city evolves under (default: target_achieved). */
  policyPathway?: "target_achieved" | "delayed" | "accelerated" | "frozen" | "lta_trend";
  shocks?: Shock[];
  /** EV displacement sensitivity level (default: base = 50%). */
  evDisplacement?: "conservative" | "base" | "aggressive";
}

export interface YearResult {
  year: number;
  modeShare: ModeSplit;
  transportCO2Tonnes: number;
  annualCO2AvoidedTonnes: number;
  cumulativeCO2AvoidedTonnes: number;
  heatExposureIndex: number; // person-km-weighted exposed active travel
  solarKWh: number;
  evChargingKWh: number;
  evCO2AvoidedTonnes: number;
  /** Total travel demand vs normal (pandemic shocks pull this below 1). */
  demandFactor: number;
  capexSpentUsd: number;
  cumulativeCostUsd: number;
  /** Traveller welfare gain this year (USD, logsum ΔCS). Absent on the baseline timeline. */
  userBenefitUsd?: number;
}

export interface AssumptionEntry {
  name: string;
  value: string;
  label: ConfidenceLabel;
  source: string;
}

export interface ScenarioResult {
  districtId: string;
  startYear: number;
  endYear: number;
  policyPathway: { id: string; label: string };
  baselineCO2Tpy: number;
  summary: {
    cumulativeCO2AvoidedTonnes: number;
    cumulativeCO2AvoidedLow: number; // Monte Carlo approximation band
    cumulativeCO2AvoidedHigh: number;
    costPerTonneUsd: number | null;
    totalCapexUsd: number;
    heatExposureReducedPct: number;
    modeShareChange: Partial<ModeSplit>;
    tripsShiftedPerDay: number;
    solarKWhOverHorizon: number;
    evChargingKWhOverHorizon: number;
    // Lifecycle (embodied-carbon) accounting.
    embodiedCO2Tonnes: number;
    netCO2AvoidedTonnes: number; // operational avoided − embodied debt
    carbonPaybackYear: number | null; // null = not repaid within horizon
    netNegativeOnCarbon: boolean;
    // Finance (B2G), USD. Social NPV blends priced carbon + energy value − cost.
    capexUsd: number;
    opexPerYearUsd: number;
    socialNpvUsd: number;
    cashNpvUsd: number; // private-operator view: energy/EV margin only, no carbon credit
    cashPaybackYear: number | null;
    moneyPaybackYear: number | null;
    budgetSharePct: number;
    /** Traveller welfare (time/cost/comfort/shade) from the logsum, USD. */
    userBenefitUsdPerYear?: number;
    userBenefitPvUsd?: number;
    /** (PV cost + social NPV + PV traveller benefit) / PV cost. >1 = benefits exceed costs. */
    benefitCostRatio?: number | null;
    /** Who benefits: share of traveller benefit landing on senior-heavy / low-income areas vs their trip share. */
    equity?: {
      seniorBenefitShare: number;
      seniorTripShare: number;
      seniorIncidenceRatio: number;
      lowIncomeBenefitShare: number;
      lowIncomeTripShare: number;
      lowIncomeIncidenceRatio: number;
      label: string;
    } | null;
  };
  /** Embodied-carbon breakdown by asset (for the report / detail panel). */
  lifecycle: { embodiedLines: { item: string; kg: number; detail: string }[] };
  /** Capex breakdown by asset, USD (for the report / detail panel). */
  finance: { capexLines: { item: string; usd: number; detail: string }[] };
  timeline: YearResult[];
  baselineTimeline: YearResult[];
  affectedEdges: number;
  assumptions: AssumptionEntry[];
  caveat: string;
  /** Placement plausibility flags per modifier (proximity screen; optional — added by the API). */
  placementWarnings?: { modifierId: string; label: string; severity: "block" | "review"; flags: { code: string; message: string; fix: string }[] }[];
}

export type { Mode, ModeSplit };
