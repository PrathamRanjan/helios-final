import type { DistrictBaseline, CompassRanking, RankedIntervention } from "./types";
import { solarLens } from "./solar-lens";
import {
  simulateIntervention,
  interventionCapex,
  buildCorridors,
  baselineSplit,
  defaultParams,
  type InterventionId,
} from "./mobility";
import cfg from "@/config/compass_config.json";
import ef from "@/config/emission_factors.json";

const SOLAR_LIFETIME = cfg.solar.lifetime_years;
const MOBILITY_LIFETIME = cfg.interventions.lifetime_years;

export interface InterventionSpec {
  id: string;
  type: "solar" | "mobility";
  // solar
  building_id?: string;
  with_storage?: boolean;
  // mobility
  mobility_id?: InterventionId;
}

/** The default demo catalogue: top solar buildings + the four mobility levers. */
export function defaultCatalogue(baseline: DistrictBaseline): InterventionSpec[] {
  const solarBuildings = baseline.buildings
    .filter((b) => b.solar.available && (b.solar.kwp ?? 0) > 50)
    .sort((a, b) => (b.solar.kwp ?? 0) - (a.solar.kwp ?? 0))
    .slice(0, 3);

  const specs: InterventionSpec[] = solarBuildings.map((b) => ({
    id: `solar:${b.id}`,
    type: "solar",
    building_id: b.id,
  }));

  // one storage variant on the biggest building
  if (solarBuildings[0]) {
    specs.push({
      id: `solar_storage:${solarBuildings[0].id}`,
      type: "solar",
      building_id: solarBuildings[0].id,
      with_storage: true,
    });
  }

  (["green_corridor", "road_to_green", "mobility_hub", "sheltered_walkway", "erp_parking", "new_bus_stop"] as InterventionId[]).forEach(
    (m) => specs.push({ id: `mobility:${m}`, type: "mobility", mobility_id: m })
  );

  return specs;
}

export function evaluateIntervention(
  spec: InterventionSpec,
  baseline: DistrictBaseline
): RankedIntervention | null {
  if (spec.type === "solar") {
    const building = baseline.buildings.find((b) => b.id === spec.building_id);
    if (!building || !building.solar.available) return null;
    const r = solarLens(building, baseline, { withStorage: spec.with_storage });
    const co2 = r.co2_avoided_tpy;
    const costPerTonne = co2 > 0 ? Math.round(r.capex_usd / (co2 * SOLAR_LIFETIME)) : Infinity;
    return {
      id: spec.id,
      intervention: spec.with_storage
        ? `Solar + storage on ${r.name}`
        : `Solar on ${r.name} roof`,
      type: "solar",
      co2_avoided_tpy: co2,
      capex_usd: r.capex_usd,
      cost_per_tonne_usd: costPerTonne,
      detail: {
        kwp: r.kwp,
        self_consumption_ratio: r.self_consumption_ratio,
        annual_savings_usd: r.annual_savings_usd,
        payback_years: r.payback_years,
        npv_usd: r.npv_usd,
        with_storage: r.with_storage,
        nearby_node_codes: r.nearby_node_codes,
      },
    };
  }

  // mobility
  const r = simulateIntervention(spec.mobility_id!, baseline);
  const capex = interventionCapex(spec.mobility_id!);
  const co2 = r.co2_avoided_tpy;
  const costPerTonne = co2 > 0 ? Math.round(capex / (co2 * MOBILITY_LIFETIME)) : Infinity;
  return {
    id: spec.id,
    intervention: r.label,
    type: "mobility",
    co2_avoided_tpy: co2,
    capex_usd: capex,
    cost_per_tonne_usd: costPerTonne,
    detail: {
      trips_shifted: r.trips_shifted,
      from_mode: r.from_mode,
      to_mode: r.to_mode,
      baseline_split: r.baseline_split,
      new_split: r.new_split,
      total_daily_trips: r.total_daily_trips,
    },
  };
}

/**
 * District baseline annual CO2 from observed mobility (the "do nothing" number),
 * for context on the leaderboard.
 */
export function baselineMobilityCo2Tpy(baseline: DistrictBaseline): number {
  const corridors = buildCorridors(baseline);
  const split = baselineSplit(corridors, defaultParams());
  const EF = ef.factors_gco2_per_pkm as Record<string, number>;
  let dailyGrams = 0;
  for (const c of corridors) {
    for (const m of Object.keys(EF)) {
      dailyGrams += c.totalTrips * (split as any)[m] * c.distKm * EF[m];
    }
  }
  return Math.round((dailyGrams * ef.annual.weekday_days) / 1e6);
}

export function rankInterventions(
  baseline: DistrictBaseline,
  specs?: InterventionSpec[],
  sortBy: "cost_per_tonne" | "co2" = "cost_per_tonne"
): CompassRanking {
  const catalogue = specs && specs.length ? specs : defaultCatalogue(baseline);
  const ranked = catalogue
    .map((s) => evaluateIntervention(s, baseline))
    .filter((r): r is RankedIntervention => r !== null);

  ranked.sort((a, b) =>
    sortBy === "co2"
      ? b.co2_avoided_tpy - a.co2_avoided_tpy
      : a.cost_per_tonne_usd - b.cost_per_tonne_usd
  );

  return {
    district: baseline.district,
    district_id: baseline.district_id,
    pv_month: baseline.pv_month,
    baseline_co2_tpy: baselineMobilityCo2Tpy(baseline),
    ranked,
    sources:
      "LTA DataMall passenger volumes; Google Solar API; DEFRA 2024 + EMA 2024 emission factors",
  };
}
