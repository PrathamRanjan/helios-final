import type { DistrictBaseline, Mode, ModeSplit, MobilityResult, ODPair } from "./types";
import cfg from "@/config/compass_config.json";
import ef from "@/config/emission_factors.json";
import freq from "@/data/lta_frequencies.json";

const MC = cfg.mode_choice;
const MODES = MC.modes as Mode[];
const EF = ef.factors_gco2_per_pkm as Record<Mode, number>;

// Real measured bus wait (≈ half the LTA dispatch headway for district services),
// overriding the assumed config value when available.
const REAL_BUS_WAIT_MIN: number | null = (freq as any)?.peak_wait_min ?? null;

export interface ModeParams {
  beta_time: number;
  beta_cost: number;
  asc: Record<Mode, number>;
  speed: Record<Mode, number>;
  wait: Record<Mode, number>;
  costPerKm: Record<Mode, number>;
  fixedCost: Record<Mode, number>;
  walkMaxKm: number;
  cycleMaxKm: number;
  infeasiblePenalty: number;
  walkWeather: number; // disutility added to walk under the weather scenario
  cycleWeather: number;
}

export type WeatherScenario = "clear" | "hot" | "rain";

export function defaultParams(weather: WeatherScenario = "clear"): ModeParams {
  const wait = { ...(MC.access_wait_min as Record<Mode, number>) };
  if (REAL_BUS_WAIT_MIN) wait.bus = REAL_BUS_WAIT_MIN; // measured from LTA frequencies
  const w = (cfg as any).weather.scenarios[weather] ?? { walk_penalty: 0, cycle_penalty: 0 };
  return {
    beta_time: MC.beta_time_per_min,
    beta_cost: MC.beta_cost_per_usd,
    asc: { ...(MC.asc as Record<Mode, number>) },
    speed: { ...(MC.speed_kmh as Record<Mode, number>) },
    wait,
    costPerKm: { ...(MC.cost_per_km_usd as Record<Mode, number>) },
    fixedCost: { ...(MC.fixed_cost_usd as Record<Mode, number>) },
    walkMaxKm: MC.walk_max_km,
    cycleMaxKm: MC.cycle_max_km,
    infeasiblePenalty: MC.infeasible_penalty,
    walkWeather: w.walk_penalty,
    cycleWeather: w.cycle_penalty,
  };
}

/** Utility of a mode for a trip of the given distance. */
export function utility(mode: Mode, distKm: number, p: ModeParams): number {
  const timeMin = (distKm / p.speed[mode]) * 60 + p.wait[mode];
  const cost = distKm * p.costPerKm[mode] + p.fixedCost[mode];
  let u = p.beta_time * timeMin + p.beta_cost * cost + p.asc[mode];
  if (mode === "walk") u += p.walkWeather;
  if (mode === "cycle") u += p.cycleWeather;
  if (mode === "walk" && distKm > p.walkMaxKm) u += p.infeasiblePenalty;
  if (mode === "cycle" && distKm > p.cycleMaxKm) u += p.infeasiblePenalty;
  return u;
}

/** Multinomial logit shares for a trip of the given distance. */
export function modeShares(distKm: number, p: ModeParams): ModeSplit {
  const u = MODES.map((m) => utility(m, distKm, p));
  const maxU = Math.max(...u);
  const exps = u.map((x) => Math.exp(x - maxU));
  const sum = exps.reduce((a, b) => a + b, 0);
  const split: any = {};
  MODES.forEach((m, i) => (split[m] = exps[i] / sum));
  return split as ModeSplit;
}

function emptySplit(): ModeSplit {
  return { car: 0, bus: 0, mrt: 0, walk: 0, cycle: 0 };
}

function addScaled(acc: ModeSplit, s: ModeSplit, w: number) {
  for (const m of MODES) acc[m] += s[m] * w;
}

/**
 * Aggregate the OD matrix into representative distance buckets, weighted by the
 * total person-trips on each pair. Observed transit trips are scaled up by the
 * baseline PT share to recover total demand (LTA only sees fare-card taps).
 */
export interface Corridor {
  distKm: number;
  totalTrips: number; // all modes
  observedTransit: number;
}

/** Count Mon–Fri days in a YYYYMM string. */
export function weekdaysInMonth(yyyymm: string): number {
  const year = parseInt(yyyymm.slice(0, 4), 10);
  const month = parseInt(yyyymm.slice(4, 6), 10); // 1-12
  if (!year || !month) return 21;
  const days = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= days; d++) {
    const dow = new Date(year, month - 1, d).getDay(); // 0=Sun..6=Sat
    if (dow >= 1 && dow <= 5) count++;
  }
  return count || 21;
}

export function buildCorridors(baseline: DistrictBaseline): Corridor[] {
  const ptShare = MC.baseline_pt_share;
  // The LTA PV CSV is a MONTHLY aggregate; convert weekday totals to an average
  // weekday by dividing by the number of weekdays in the data month.
  const wkdays = weekdaysInMonth(baseline.pv_month);
  // aggregate (o,d) over hours
  const agg = new Map<string, { trips: number; dist: number }>();
  for (const od of baseline.od) {
    if (od.o === od.d) continue;
    const key = `${od.o}->${od.d}`;
    const cur = agg.get(key);
    if (cur) cur.trips += od.trips;
    else agg.set(key, { trips: od.trips, dist: od.dist_km });
  }
  const corridors: Corridor[] = [];
  for (const { trips, dist } of agg.values()) {
    if (trips <= 0 || dist <= 0) continue;
    const dailyTransit = trips / wkdays;
    corridors.push({
      distKm: dist,
      observedTransit: dailyTransit,
      totalTrips: dailyTransit / ptShare,
    });
  }
  return corridors;
}

/** Weighted baseline mode split across all corridors. */
export function baselineSplit(corridors: Corridor[], p: ModeParams): ModeSplit {
  const acc = emptySplit();
  let totalW = 0;
  for (const c of corridors) {
    const s = modeShares(c.distKm, p);
    addScaled(acc, s, c.totalTrips);
    totalW += c.totalTrips;
  }
  if (totalW > 0) for (const m of MODES) acc[m] /= totalW;
  return acc;
}

const ANNUAL_WEEKDAYS = ef.annual.weekday_days;

/** Annual CO2 (tonnes) for a given per-corridor split snapshot. */
function annualCo2Tonnes(
  corridors: Corridor[],
  splitFor: (c: Corridor) => ModeSplit
): number {
  let dailyGrams = 0;
  for (const c of corridors) {
    const s = splitFor(c);
    for (const m of MODES) {
      const trips = c.totalTrips * s[m];
      dailyGrams += trips * c.distKm * EF[m];
    }
  }
  // grams/day -> tonnes/year over weekdays
  return (dailyGrams * ANNUAL_WEEKDAYS) / 1e6;
}

export type InterventionId =
  | "green_corridor"
  | "road_to_green"
  | "mobility_hub"
  | "sheltered_walkway"
  | "erp_parking"
  | "new_bus_stop";

/** Apply an intervention's parameter perturbation. */
export function applyIntervention(id: InterventionId, base: ModeParams): ModeParams {
  const p: ModeParams = {
    ...base,
    asc: { ...base.asc },
    speed: { ...base.speed },
    wait: { ...base.wait },
    costPerKm: { ...base.costPerKm },
    fixedCost: { ...base.fixedCost },
  };
  const iv = cfg.interventions as any;
  switch (id) {
    case "green_corridor":
      p.asc.cycle += iv.green_corridor.cycle_asc_bonus;
      p.asc.walk += iv.green_corridor.walk_asc_bonus;
      p.cycleMaxKm += iv.green_corridor.cycle_max_km_extension;
      break;
    case "road_to_green":
      // take capacity from cars (higher car time) and give it to active modes
      p.wait.car += iv.road_to_green.car_time_penalty_min;
      p.asc.cycle += iv.road_to_green.cycle_asc_bonus;
      p.asc.walk += iv.road_to_green.walk_asc_bonus;
      break;
    case "mobility_hub":
      p.asc.cycle += iv.mobility_hub.cycle_asc_bonus;
      break;
    case "sheltered_walkway":
      if (iv.sheltered_walkway.removes_walk_weather_penalty) p.walkWeather = 0;
      p.asc.walk += iv.sheltered_walkway.walk_asc_bonus;
      break;
    case "erp_parking":
      p.fixedCost.car += iv.erp_parking.car_cost_increase_usd;
      break;
    case "new_bus_stop":
      p.wait.bus = Math.max(1, p.wait.bus - iv.new_bus_stop.bus_wait_reduction_min);
      break;
  }
  return p;
}

const LOW_CARBON: Mode[] = ["bus", "mrt", "walk", "cycle"];

export function simulateIntervention(
  id: InterventionId,
  baseline: DistrictBaseline,
  weather: WeatherScenario = "clear"
): MobilityResult {
  const base = defaultParams(weather);
  const corridors = buildCorridors(baseline);

  const baseSplits = new Map<Corridor, ModeSplit>();
  for (const c of corridors) baseSplits.set(c, modeShares(c.distKm, base));

  const newParams = applyIntervention(id, base);
  const newSplits = new Map<Corridor, ModeSplit>();
  for (const c of corridors) newSplits.set(c, modeShares(c.distKm, newParams));

  const co2Base = annualCo2Tonnes(corridors, (c) => baseSplits.get(c)!);
  const co2New = annualCo2Tonnes(corridors, (c) => newSplits.get(c)!);

  // trips shifted away from car (per day)
  let carBaseTrips = 0;
  let carNewTrips = 0;
  let lowBaseTrips = 0;
  let lowNewTrips = 0;
  let totalDaily = 0;
  for (const c of corridors) {
    const b = baseSplits.get(c)!;
    const n = newSplits.get(c)!;
    carBaseTrips += c.totalTrips * b.car;
    carNewTrips += c.totalTrips * n.car;
    for (const m of LOW_CARBON) {
      lowBaseTrips += c.totalTrips * b[m];
      lowNewTrips += c.totalTrips * n[m];
    }
    totalDaily += c.totalTrips;
  }
  const tripsShifted = Math.round(Math.max(0, lowNewTrips - lowBaseTrips));

  const toModeByIv: Record<InterventionId, string> = {
    green_corridor: "bike+walk",
    road_to_green: "bike+walk",
    mobility_hub: "cycle",
    sheltered_walkway: "walk",
    erp_parking: "transit",
    new_bus_stop: "bus",
  };

  const ivCfg = (cfg.interventions as any)[id];
  const label = ivCfg.label as string;

  return {
    intervention_id: id,
    label,
    baseline_split: roundSplit(weightedSplit(corridors, baseSplits)),
    new_split: roundSplit(weightedSplit(corridors, newSplits)),
    trips_shifted: tripsShifted,
    from_mode: "car",
    to_mode: toModeByIv[id],
    co2_avoided_tpy: Math.round((co2Base - co2New) * 10) / 10,
    affected_od_pairs: corridors.length,
    total_daily_trips: Math.round(totalDaily),
  };
}

function weightedSplit(corridors: Corridor[], splits: Map<Corridor, ModeSplit>): ModeSplit {
  const acc = emptySplit();
  let w = 0;
  for (const c of corridors) {
    addScaled(acc, splits.get(c)!, c.totalTrips);
    w += c.totalTrips;
  }
  if (w > 0) for (const m of MODES) acc[m] /= w;
  return acc;
}

function roundSplit(s: ModeSplit): ModeSplit {
  const out: any = {};
  for (const m of MODES) out[m] = Math.round(s[m] * 1000) / 1000;
  return out as ModeSplit;
}

export function interventionCapex(id: InterventionId): number {
  const c = (cfg.interventions as any)[id];
  if (c.capex_per_km_usd) return Math.round(c.capex_per_km_usd * c.corridor_km);
  return c.capex_usd;
}

export { MODES };
export type { ODPair };
