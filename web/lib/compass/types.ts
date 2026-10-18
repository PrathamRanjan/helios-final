// Shared types for the HELIO Compass engine and API.

export interface HourlyCurve {
  tap_in: number[]; // length 24
  tap_out: number[]; // length 24
}

export interface TransitNode {
  code: string;
  type: "BUS" | "TRAIN";
  name: string;
  road: string;
  lat: number;
  lng: number;
  hourly_weekday: HourlyCurve;
}

export interface ODPair {
  o: string;
  d: string;
  mode: string; // "bus" | "train"
  hour: number;
  trips: number;
  dist_km: number;
}

export interface BuildingSolar {
  available: boolean;
  panels_count?: number;
  kwp?: number;
  annual_kwh?: number;
  roof_area_m2?: number;
  max_panels?: number;
  imagery_quality?: string;
}

export interface DistrictBuilding {
  id: string;
  name: string;
  lat: number;
  lng: number;
  solar: BuildingSolar;
}

export interface DistrictBaseline {
  district: string;
  district_id: string;
  bbox: [number, number, number, number];
  pv_month: string;
  source: string;
  nodes: TransitNode[];
  od: ODPair[];
  buildings: DistrictBuilding[];
}

// ---- Solar lens output (6B) ----
export interface SolarLensResult {
  building_id: string;
  name: string;
  lat: number;
  lng: number;
  available: boolean;
  kwp: number;
  annual_kwh: number;
  self_consumption_ratio: number;
  effective_value_per_kwh_usd: number;
  annual_savings_usd: number;
  capex_usd: number;
  payback_years: number | null;
  npv_usd: number;
  co2_avoided_tpy: number;
  load_shape: number[]; // 24h normalized demand
  solar_shape: number[]; // 24h normalized generation
  nearby_node_codes: string[];
  with_storage?: boolean;
}

// ---- Mobility lens output (6C/6D) ----
export type Mode = "car" | "bus" | "mrt" | "walk" | "cycle";

export interface ModeSplit {
  car: number;
  bus: number;
  mrt: number;
  walk: number;
  cycle: number;
}

export interface MobilityResult {
  intervention_id: string;
  label: string;
  baseline_split: ModeSplit;
  new_split: ModeSplit;
  trips_shifted: number;
  from_mode: string;
  to_mode: string;
  co2_avoided_tpy: number;
  affected_od_pairs: number;
  total_daily_trips: number;
}

// ---- Compass ranking (6E) ----
export interface RankedIntervention {
  id: string;
  intervention: string;
  type: "solar" | "mobility";
  co2_avoided_tpy: number;
  capex_usd: number;
  cost_per_tonne_usd: number;
  detail: Record<string, unknown>;
}

export interface CompassRanking {
  district: string;
  district_id: string;
  pv_month: string;
  baseline_co2_tpy: number;
  ranked: RankedIntervention[];
  sources: string;
}
