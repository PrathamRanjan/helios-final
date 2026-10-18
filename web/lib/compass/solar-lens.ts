import {
  DEGRADATION_RATE,
  TARIFF_ESCALATION,
  DISCOUNT_RATE,
  getTariff,
} from "@/lib/finance";
import { nodesWithinKm } from "./data";
import type { DistrictBaseline, DistrictBuilding, SolarLensResult } from "./types";
import cfg from "@/config/compass_config.json";

const SOLAR_CFG = cfg.solar;

/**
 * 6A — Tropical solar generation bell shape (sum-normalized over 24h).
 * Daylight roughly 07:00–19:00, peaked at ~13:00.
 */
export function solarShape(): number[] {
  const shape = new Array(24).fill(0);
  const peak = 13;
  const width = 3.1;
  for (let h = 0; h < 24; h++) {
    const v = Math.exp(-((h - peak) ** 2) / (2 * width * width));
    // zero out night hours so we don't pretend there is generation
    shape[h] = h >= 6 && h <= 19 ? v : 0;
  }
  const total = shape.reduce((a, b) => a + b, 0);
  return shape.map((v) => v / total);
}

/**
 * 6A — Occupancy/demand load shape from real footfall: sum tap_out at nearby
 * transit nodes per hour, normalize to a 24h shape (sums to 1).
 * Falls back to a generic commercial daytime profile if no nodes are nearby.
 */
export function loadShapeFromFootfall(
  building: { lat: number; lng: number },
  baseline: DistrictBaseline,
  radiusKm = SOLAR_CFG.nearby_node_radius_km
): { shape: number[]; nodeCodes: string[] } {
  const nearby = nodesWithinKm(building, baseline.nodes, radiusKm);
  const occ = new Array(24).fill(0);
  for (const n of nearby) {
    for (let h = 0; h < 24; h++) occ[h] += n.hourly_weekday.tap_out[h] ?? 0;
  }
  const total = occ.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    // generic commercial profile (office/retail daytime), sums to 1
    const generic = [
      0.005, 0.004, 0.003, 0.003, 0.004, 0.012, 0.03, 0.055, 0.075, 0.085,
      0.088, 0.09, 0.088, 0.087, 0.085, 0.08, 0.07, 0.055, 0.04, 0.025, 0.015,
      0.01, 0.008, 0.006,
    ];
    const g = generic.reduce((a, b) => a + b, 0);
    return { shape: generic.map((v) => v / g), nodeCodes: [] };
  }
  return {
    shape: occ.map((v) => v / total),
    nodeCodes: nearby.map((n) => n.code),
  };
}

/**
 * 6B — Solar self-consumption overlay.
 * Demand is scaled to `demand_to_gen_ratio` x annual generation; self-consumption
 * is the fraction of generation consumed on-site hour by hour.
 */
export function selfConsumptionRatio(
  annualKwh: number,
  loadShape: number[],
  solarShapeArr: number[],
  demandToGenRatio = SOLAR_CFG.demand_to_gen_ratio
): number {
  const annualDemand = annualKwh * demandToGenRatio;
  let used = 0;
  for (let h = 0; h < 24; h++) {
    const gen = annualKwh * solarShapeArr[h];
    const dem = annualDemand * loadShape[h];
    used += Math.min(gen, dem);
  }
  return annualKwh > 0 ? Math.min(1, used / annualKwh) : 0;
}

/**
 * NPV of the solar lens given a blended effective value per kWh.
 * Mirrors lib/finance.ts conventions (20y, degradation, escalation, discount).
 */
function solarNpv(
  annualKwh: number,
  effectiveValuePerKwh: number,
  capex: number,
  omPerYear: number
): { npv: number; payback: number | null } {
  let cum = -capex;
  let payback: number | null = null;
  let npv = -capex;
  for (let y = 1; y <= SOLAR_CFG.lifetime_years; y++) {
    const energyY = annualKwh * Math.pow(1 - DEGRADATION_RATE, y - 1);
    const valueY = effectiveValuePerKwh * Math.pow(1 + TARIFF_ESCALATION, y - 1);
    const cashflow = energyY * valueY - omPerYear;
    npv += cashflow / Math.pow(1 + DISCOUNT_RATE, y);
    const prev = cum;
    cum += cashflow;
    if (payback === null && cum >= 0) {
      payback = cashflow > 0 ? y - 1 + -prev / cashflow : y;
    }
  }
  return { npv: Math.round(npv), payback: payback !== null ? Math.round(payback * 10) / 10 : null };
}

export function solarLens(
  building: DistrictBuilding,
  baseline: DistrictBaseline,
  opts: { withStorage?: boolean; country?: string } = {}
): SolarLensResult {
  const country = opts.country ?? "SG";
  const t = getTariff(country);
  const annualKwh = building.solar.annual_kwh ?? 0;
  const kwp = building.solar.kwp ?? 0;

  const sShape = solarShape();
  const { shape: lShape, nodeCodes } = loadShapeFromFootfall(building, baseline);

  let scr = selfConsumptionRatio(annualKwh, lShape, sShape);
  if (opts.withStorage) {
    scr = Math.min(1, scr + SOLAR_CFG.storage_self_consumption_bonus);
  }

  const retail = t.tariff_per_kwh;
  const feedIn = SOLAR_CFG.feed_in_rate_per_kwh_usd;
  const effectiveValue = scr * retail + (1 - scr) * feedIn;

  const capexPerKwp = opts.withStorage
    ? cfg.interventions.solar_storage_capex_per_kwp_usd
    : cfg.interventions.solar_capex_per_kwp_usd;
  const capex = Math.round(kwp * capexPerKwp);
  const omPerYear = kwp * (t.om_usd_per_kwp_year ?? 18);

  const annualSavings = Math.round(annualKwh * effectiveValue - omPerYear);
  const { npv, payback } = solarNpv(annualKwh, effectiveValue, capex, omPerYear);
  const co2Tpy = Math.round((annualKwh * t.grid_carbon_kg_per_kwh) / 1000 * 10) / 10;

  return {
    building_id: building.id,
    name: building.name,
    lat: building.lat,
    lng: building.lng,
    available: building.solar.available,
    kwp,
    annual_kwh: annualKwh,
    self_consumption_ratio: Math.round(scr * 1000) / 1000,
    effective_value_per_kwh_usd: Math.round(effectiveValue * 1000) / 1000,
    annual_savings_usd: annualSavings,
    capex_usd: capex,
    payback_years: payback,
    npv_usd: npv,
    co2_avoided_tpy: co2Tpy,
    load_shape: lShape.map((v) => Math.round(v * 1000) / 1000),
    solar_shape: sShape.map((v) => Math.round(v * 1000) / 1000),
    nearby_node_codes: nodeCodes,
    with_storage: !!opts.withStorage,
  };
}
