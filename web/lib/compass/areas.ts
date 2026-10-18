// Singapore planning-area index (client-safe). Built by ingest/sg_geography.py
// from URA MP2019 boundaries + GHS 2025 census; ingest/build_area.py flips
// `simulation` to "ready" once an area's LTA world has been built.

import areasJson from "@/data/sg/areas.json";

export type AreaSimulation = "ready" | "osm_only" | "pending";

export interface Area {
  id: string;
  name: string;
  code: string;
  region: string;
  centroid: [number, number]; // [lng, lat]
  bbox: [number, number, number, number]; // [min_lat, min_lng, max_lat, max_lng]
  area_km2: number;
  population?: number;
  share_65_plus?: number;
  share_under_15?: number;
  share_hdb?: number;
  share_condo?: number;
  share_landed?: number;
  commuters?: number;
  pt_share?: number;
  car_share?: number;
  taxi_share?: number;
  households?: number;
  share_hh_income_10k_plus?: number;
  share_hh_income_below_3k?: number;
  bus_stops: number;
  stations: number;
  subzones: number;
  simulation: AreaSimulation;
  osm?: { buildings: number; roads: number };
}

export const AREAS: Area[] = (areasJson as unknown as { areas: Area[] }).areas;
export const DEFAULT_AREA = "jurong_east";

export function areaById(id: string): Area | undefined {
  return AREAS.find((a) => a.id === id);
}

/** Populated areas — the ones a planner can act in. */
export const POPULATED_AREAS = AREAS.filter((a) => (a.population ?? 0) > 0);

/** Camera framing for an area: zoom from its bbox span. */
export function areaView(a: Area) {
  const span = Math.max(a.bbox[2] - a.bbox[0], a.bbox[3] - a.bbox[1]);
  const zoom = span > 0.12 ? 12.9 : span > 0.07 ? 13.5 : span > 0.04 ? 14 : 14.6;
  return { longitude: a.centroid[0], latitude: a.centroid[1], zoom, pitch: 50, bearing: 20 };
}

/**
 * Screening score for "where to act" — census-only, so it works for every
 * area before any simulation. Car commuters = the CO₂ lever; seniors + low
 * PT share = the heat/access lever. Labelled "screening estimate" in the UI.
 */
export function screening(a: Area) {
  const commuters = a.commuters ?? 0;
  const carCommuters = Math.round(commuters * ((a.car_share ?? 0) + (a.taxi_share ?? 0)));
  const seniors = Math.round((a.population ?? 0) * (a.share_65_plus ?? 0));
  return { carCommuters, seniors, ptGap: 1 - (a.pt_share ?? 0) };
}
