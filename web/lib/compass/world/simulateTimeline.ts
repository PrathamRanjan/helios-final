// The HELIO Flow year loop: each year the city first evolves under the chosen
// Green Plan pathway (cleaner grid, cleaner fleets, growing cycling network),
// then user modifiers apply on top, then agents re-choose modes. Avoided CO₂ is
// measured against the policy-evolved baseline — your changes are credited only
// for what they add beyond Singapore's planned transition.

import type { Mode, ModeSplit } from "../types";
import type {
  WorldState,
  WorldModifier,
  ScenarioResult,
  YearResult,
  AssumptionEntry,
  Shock,
} from "./types";
import { cloneWorld, applyModifier } from "./modifiers";
import { modeShares, MODES, logsum, betaCostAbs } from "./agentChoice";
import {
  policyYear,
  applyPolicyToWorld,
  efWithGrid,
  pathwayLabel,
  type PathwayId,
  type PolicyYear,
} from "../policy/applyPolicy";
import {
  shockFactors,
  applyShockToWorld,
  shocksKey,
  type ShockFactors,
} from "../shocks/applyShock";
import { embodiedForModifier } from "../lifecycle/embodied";
import { financeSummary } from "../finance/intervention";
import mc from "@/data/assumptions/mode_choice.json";
import wd from "@/data/assumptions/world_defaults.json";
import evCfg from "@/data/assumptions/ev_charging.json";
import cal from "@/data/assumptions/calibrated/mode_choice_calibrated.json";
import fin from "@/data/assumptions/finance.json";

const BAND = (wd.economics as any).uncertainty_band as { low: number; high: number };

export interface YearMetrics {
  co2Tonnes: number;
  heatIndex: number;
  modeShare: ModeSplit;
  /** Daily traveller welfare in USD: Σ trips × logsum / |β_cost| (Small & Rosen 1981).
   *  Only DIFFERENCES are meaningful (the logsum has an arbitrary constant). */
  welfareUsdDaily: number;
  /** Per-edge daily welfare (same order as world.edges) — for benefit incidence (equity). */
  edgeWelfare: Float64Array;
}

const WEEKDAYS = (wd.annual as any).weekday_days.value as number;

/** Emissions + heat exposure for one world snapshot under one year's physics. */
export function evaluateWorld(world: WorldState, ef: Record<Mode, number>): YearMetrics {
  let dailyGrams = 0;
  let heatIndex = 0;
  const shareAcc: any = { car: 0, bus: 0, mrt: 0, walk: 0, cycle: 0 };
  let totalTrips = 0;
  let welfare = 0;
  const edgeWelfare = new Float64Array(world.edges.length);

  for (let ei = 0; ei < world.edges.length; ei++) {
    const edge = world.edges[ei];
    const s = modeShares(edge);
    const w = (edge.totalTripsDaily * logsum(edge)) / betaCostAbs();
    edgeWelfare[ei] = w;
    welfare += w;
    for (const m of MODES) {
      dailyGrams += edge.totalTripsDaily * s[m] * edge.distKm * ef[m];
      shareAcc[m] += s[m] * edge.totalTripsDaily;
    }
    const effHeat = edge.attrs.heatExposure * (1 - edge.attrs.shadeScore);
    heatIndex += (s.walk + s.cycle) * edge.totalTripsDaily * edge.distKm * effHeat;
    totalTrips += edge.totalTripsDaily;
  }

  if (totalTrips > 0) for (const m of MODES) shareAcc[m] /= totalTrips;
  return {
    co2Tonnes: (dailyGrams * WEEKDAYS) / 1e6,
    heatIndex,
    modeShare: shareAcc as ModeSplit,
    welfareUsdDaily: welfare,
    edgeWelfare,
  };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

interface PolicyBaseYear {
  metrics: YearMetrics;
  py: PolicyYear;
  f: ShockFactors;
  gridYear: number; // grid factor incl. any grid-carbon shock
  ef: Record<Mode, number>; // EFs incl. any grid-carbon shock
}

// The policy+shock-evolved "do nothing" run is identical for every user scenario
// on the same pathway+shocks — memoize it (worlds are immutable at the baseline).
const baselineRunCache = new Map<string, PolicyBaseYear[]>();
/** Drop memoised baselines (call after setParamOverrides). */
export function clearBaselineCache() {
  baselineRunCache.clear();
}

function policyBaselineRun(
  baselineWorld: WorldState,
  pathway: PathwayId,
  shocks: Shock[],
  startYear: number,
  endYear: number
): PolicyBaseYear[] {
  const key = `${baselineWorld.districtId}:${pathway}:${startYear}:${endYear}:${shocksKey(shocks)}`;
  const cached = baselineRunCache.get(key);
  if (cached) return cached;
  const run: PolicyBaseYear[] = [];
  for (let year = startYear; year <= endYear; year++) {
    const py = policyYear(pathway, year);
    const f = shockFactors(shocks, year);
    const gridYear = py.gridKgPerKWh * f.gridMultiplier;
    const ef = efWithGrid(py, gridYear);
    const world = cloneWorld(baselineWorld, year);
    applyPolicyToWorld(world, py);
    applyShockToWorld(world, f);
    run.push({ metrics: evaluateWorld(world, ef), py, f, gridYear, ef });
  }
  baselineRunCache.set(key, run);
  return run;
}

const EV = {
  kwhPerKm: (evCfg as any).ev_kwh_per_km.value as number,
  kwhPerKwYear: (evCfg as any).kwh_per_kw_year.value as number,
  solarPairedCiFactor: (evCfg as any).solar_paired_ci_factor.value as number,
};

export type EvDisplacementLevel = "conservative" | "base" | "aggressive";
const EV_DISPLACEMENT = (evCfg as any).displacement_scenarios as Record<EvDisplacementLevel, number>;
export function evDisplacementFactor(level: EvDisplacementLevel = "base"): number {
  return EV_DISPLACEMENT[level] ?? EV_DISPLACEMENT.base;
}

export function simulateTimeline(
  baselineWorld: WorldState,
  modifiers: WorldModifier[],
  startYear: number,
  endYear: number,
  pathway: PathwayId = "target_achieved",
  shocks: Shock[] = [],
  evDisplacement: EvDisplacementLevel = "base",
  /** Continuous EV-displacement override (0..1) — used by Monte Carlo sampling
   *  to sweep the displacement fraction beyond the three discrete levels. */
  displaceFactorOverride?: number
): ScenarioResult {
  const baseRun = policyBaselineRun(baselineWorld, pathway, shocks, startYear, endYear);
  const displaceFactor =
    displaceFactorOverride !== undefined ? displaceFactorOverride : evDisplacementFactor(evDisplacement);

  const timeline: YearResult[] = [];
  const baselineTimeline: YearResult[] = [];
  let cumAvoided = 0;
  let cumCost = 0;
  let solarOverHorizon = 0;
  let evKWhOverHorizon = 0;
  let affectedEdges = 0;
  let lastShare: ModeSplit = baseRun[0].metrics.modeShare;
  // Same public-sector social discount rate as financeSummary (finance.json, 4%), so traveller
  // benefit and social NPV are commensurable inside the benefit–cost ratio.
  const DISC = (fin as any).discount_rate_social.value as number;
  let userBenefitPv = 0;
  let costPv = 0;
  let lastUserBenefit = 0;
  let lastEdgeGain: Float64Array | null = null;

  for (let year = startYear; year <= endYear; year++) {
    const { metrics: base, py, f, gridYear, ef } = baseRun[year - startYear];

    const world = cloneWorld(baselineWorld, year);
    applyPolicyToWorld(world, py);
    applyShockToWorld(world, f);
    for (const mod of modifiers) {
      affectedEdges = Math.max(affectedEdges, applyModifier(world, mod, year));
    }
    const m = evaluateWorld(world, ef);
    lastShare = m.modeShare;

    // Solar added by modifiers avoids grid emissions at THIS year's grid factor
    // — a decarbonising grid honestly shrinks solar's marginal benefit (and a
    // grid-carbon shock temporarily raises it).
    const solarKWh = world.energy.addedSolarAnnualKWh * f.solarMultiplier;
    const solarAvoidedT = (solarKWh * gridYear) / 1000;
    solarOverHorizon += solarKWh;

    // EV charging: capacity → charged kWh → EV-km enabled → net CO₂ vs THIS
    // year's car fleet and grid. Solar-paired hubs charge in the midday window.
    const evChargingKWh = world.energy.addedChargingKW * EV.kwhPerKwYear;
    let evAvoidedT = 0;
    if (evChargingKWh > 0) {
      const chargingCI =
        world.energy.addedSolarAnnualKWh > 0 ? gridYear * EV.solarPairedCiFactor : gridYear;
      const evKm = evChargingKWh / EV.kwhPerKm;
      const evEFg = EV.kwhPerKm * chargingCI * 1000; // gCO₂/km
      // Only the displaced fraction actually replaces ICE car-km (the rest would
      // have charged elsewhere) — sensitivity band, honestly speculative.
      evAvoidedT = (displaceFactor * evKm * Math.max(0, ef.car - evEFg)) / 1e6;
      evKWhOverHorizon += evChargingKWh;
    }

    const avoided = base.co2Tonnes - m.co2Tonnes + solarAvoidedT + evAvoidedT;
    cumAvoided += avoided;

    let capexThisYear = 0;
    let opexThisYear = 0;
    for (const mod of modifiers) {
      if (mod.metadata.builtYear === year) capexThisYear += mod.economics.capexUsd;
      if (mod.metadata.builtYear <= year) opexThisYear += mod.economics.annualOpexUsd;
    }
    cumCost += capexThisYear + opexThisYear;

    // Traveller benefit (time, cost, comfort, shade) from the nested-logit logsum, valued in
    // dollars via |β_cost|. Measured against the same policy-evolved baseline as CO₂.
    const userBenefit = (m.welfareUsdDaily - base.welfareUsdDaily) * WEEKDAYS;
    const df = Math.pow(1 + DISC, -(year - startYear));
    userBenefitPv += userBenefit * df;
    costPv += (capexThisYear + opexThisYear) * df;
    lastUserBenefit = userBenefit;
    lastEdgeGain = m.edgeWelfare.map((v, i) => v - base.edgeWelfare[i]);

    timeline.push({
      year,
      modeShare: roundSplit(m.modeShare),
      transportCO2Tonnes: round1(m.co2Tonnes),
      annualCO2AvoidedTonnes: round1(avoided),
      cumulativeCO2AvoidedTonnes: round1(cumAvoided),
      heatExposureIndex: round1(m.heatIndex),
      solarKWh: Math.round(solarKWh),
      evChargingKWh: Math.round(evChargingKWh),
      evCO2AvoidedTonnes: round1(evAvoidedT),
      demandFactor: Math.round(f.demandFactor * 100) / 100,
      capexSpentUsd: Math.round(capexThisYear),
      cumulativeCostUsd: Math.round(cumCost),
      userBenefitUsd: Math.round(userBenefit),
    });
    baselineTimeline.push({
      year,
      modeShare: roundSplit(base.modeShare),
      transportCO2Tonnes: round1(base.co2Tonnes),
      annualCO2AvoidedTonnes: 0,
      cumulativeCO2AvoidedTonnes: 0,
      heatExposureIndex: round1(base.heatIndex),
      solarKWh: 0,
      evChargingKWh: 0,
      evCO2AvoidedTonnes: 0,
      demandFactor: Math.round(f.demandFactor * 100) / 100,
      capexSpentUsd: 0,
      cumulativeCostUsd: 0,
    });
  }

  const finalBase = baseRun[baseRun.length - 1].metrics;
  const last = timeline[timeline.length - 1];
  const heatReducedPct =
    finalBase.heatIndex > 0
      ? Math.round(((finalBase.heatIndex - last.heatExposureIndex) / finalBase.heatIndex) * 100)
      : 0;

  const modeShareChange: any = {};
  for (const m of MODES) {
    modeShareChange[m] = Math.round((lastShare[m] - finalBase.modeShare[m]) * 1000) / 1000;
  }

  const totalTrips = baselineWorld.edges.reduce((s, e) => s + e.totalTripsDaily, 0);
  const tripsShifted = Math.round(
    Math.max(0, (finalBase.modeShare.car - lastShare.car) * totalTrips)
  );

  // Lifecycle: embodied-carbon debt of building the modifiers, netted against
  // the operational avoided timeline. Payback = first year cumulative avoided
  // overtakes the embodied debt.
  const embodiedLineMap = new Map<string, { item: string; kg: number; detail: string }>();
  let embodiedKg = 0;
  for (const mod of modifiers) {
    const b = embodiedForModifier(mod);
    embodiedKg += b.totalKg;
    for (const l of b.lines) {
      const cur = embodiedLineMap.get(l.item);
      if (cur) cur.kg += l.kg;
      else embodiedLineMap.set(l.item, { ...l });
    }
  }
  const embodiedTonnes = embodiedKg / 1000;
  let carbonPaybackYear: number | null = null;
  for (const y of timeline) {
    if (y.cumulativeCO2AvoidedTonnes >= embodiedTonnes && embodiedTonnes > 0) {
      carbonPaybackYear = y.year;
      break;
    }
  }

  // Finance (B2G): real capex/O&M, carbon value, NPV, money payback, budget share.
  const finance = financeSummary(timeline, startYear, modifiers);
  const equity = lastEdgeGain ? benefitIncidence(baselineWorld, lastEdgeGain) : null;

  return {
    districtId: baselineWorld.districtId,
    startYear,
    endYear,
    policyPathway: { id: pathway, label: pathwayLabel(pathway) },
    baselineCO2Tpy: round1(baseRun[0].metrics.co2Tonnes),
    summary: {
      cumulativeCO2AvoidedTonnes: round1(cumAvoided),
      cumulativeCO2AvoidedLow: round1(cumAvoided * BAND.low),
      cumulativeCO2AvoidedHigh: round1(cumAvoided * BAND.high),
      costPerTonneUsd: cumAvoided > 0.05 ? Math.round(cumCost / cumAvoided) : null,
      totalCapexUsd: Math.round(modifiers.reduce((s, m) => s + m.economics.capexUsd, 0)),
      heatExposureReducedPct: heatReducedPct,
      modeShareChange,
      tripsShiftedPerDay: tripsShifted,
      solarKWhOverHorizon: Math.round(solarOverHorizon),
      evChargingKWhOverHorizon: Math.round(evKWhOverHorizon),
      embodiedCO2Tonnes: round1(embodiedTonnes),
      netCO2AvoidedTonnes: round1(cumAvoided - embodiedTonnes),
      carbonPaybackYear,
      netNegativeOnCarbon: embodiedTonnes > cumAvoided,
      capexUsd: finance.capexUsd,
      opexPerYearUsd: finance.opexPerYearUsd,
      socialNpvUsd: finance.socialNpvUsd,
      cashNpvUsd: finance.cashNpvUsd,
      cashPaybackYear: finance.cashPaybackYear,
      moneyPaybackYear: finance.moneyPaybackYear,
      budgetSharePct: finance.budgetSharePct,
      userBenefitUsdPerYear: Math.round(lastUserBenefit),
      userBenefitPvUsd: Math.round(userBenefitPv),
      // Full appraisal: social NPV (carbon + energy − cost) PLUS traveller welfare, over cost.
      benefitCostRatio: costPv > 0 ? Math.round(((costPv + finance.socialNpvUsd + userBenefitPv) / costPv) * 100) / 100 : null,
      equity,
    },
    lifecycle: {
      embodiedLines: [...embodiedLineMap.values()].map((l) => ({ ...l, kg: Math.round(l.kg) })),
    },
    finance: { capexLines: finance.capexLines },
    timeline,
    baselineTimeline,
    affectedEdges,
    assumptions: assumptionLedger(pathway, startYear, endYear, shocks, evKWhOverHorizon > 0, evDisplacement, displaceFactor),
    caveat:
      "Mode-share response is an illustrative, calibrated reallocation (nested logit, constants calibrated to GHS 2025 census by planning area) — not a ridership forecast. " +
      "Avoided CO₂ is measured against the policy-evolved baseline: your changes are credited only for " +
      "what they add beyond Singapore's planned transition, on a weekday operational year (×250 days, " +
      "excludes weekends/off-peak). Net CO₂ subtracts cradle-to-gate embodied carbon of building the " +
      "intervention. Demand, footfall, headways, solar potential and emission factors are measured " +
      "(LTA / Google Solar / EMA); behavioural coefficients are literature-calibrated assumptions.",
  };
}

/**
 * Spatial benefit incidence: who receives the traveller-welfare gain. Each corridor's gain is
 * attributed to the demographics of its planning area (GHS 2025). Compares the share of benefit
 * landing on seniors / low-income households with their share of all trips. Ratio > 1 = the plan
 * favours that group. Area-level attribution (not individual) — labelled accordingly.
 */
function benefitIncidence(world: WorldState, gain: Float64Array) {
  const rt = (cal as any).runtime;
  const demo = rt?.pa_demographics as Record<string, { senior_share: number; low_income_share: number }> | undefined;
  if (!demo) return null;
  let g = 0, gS = 0, gL = 0, t = 0, tS = 0, tL = 0;
  world.edges.forEach((e, i) => {
    const d = demo[rt.edge_pa[e.id]];
    if (!d) return;
    const gi = Math.max(0, gain[i]);
    g += gi; gS += gi * d.senior_share; gL += gi * d.low_income_share;
    t += e.totalTripsDaily; tS += e.totalTripsDaily * d.senior_share; tL += e.totalTripsDaily * d.low_income_share;
  });
  if (g <= 0 || t <= 0) return null;
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return {
    seniorBenefitShare: r(gS / g),
    seniorTripShare: r(tS / t),
    seniorIncidenceRatio: r(gS / g / (tS / t)),
    lowIncomeBenefitShare: r(gL / g),
    lowIncomeTripShare: r(tL / t),
    lowIncomeIncidenceRatio: r(gL / g / (tL / t)),
    label: "area-level attribution (GHS 2025 by planning area)",
  };
}

function roundSplit(s: ModeSplit): ModeSplit {
  const out: any = {};
  for (const m of MODES) out[m] = Math.round(s[m] * 1000) / 1000;
  return out as ModeSplit;
}

const SHOCK_LEDGER: Record<Shock["type"], AssumptionEntry> = {
  heatwave: { name: "Heatwave shock", value: "heat exposure × (1+severity); shade cushions it", label: "calibrated proxy", source: "Heat cuts active travel 20–40% >35°C (arXiv:2501.03978)" },
  heavy_rain: { name: "Heavy rain shock", value: "rain exposure × (1+severity); covered links cushion it", label: "calibrated proxy", source: "Rain-cycling elasticity −0.3..−0.5" },
  oil_price_spike: { name: "Oil price shock", value: "car cost × (1+%)", label: "literature-derived", source: "VTPI fuel-price elasticity: −0.1 SR / −0.3 LR" },
  pandemic: { name: "Pandemic shock", value: "total demand drop + linear recovery", label: "literature-derived", source: "Transit −50–90% wave 1, 12–24 mo recovery (FTA 2024)" },
  grid_carbon_spike: { name: "Grid carbon shock", value: "grid factor × multiplier (hits MRT, e-bus, EV, solar value)", label: "literature-derived", source: "Hourly/marginal CI literature (Brockway et al. 2022)" },
  haze: { name: "Transboundary haze", value: "on haze days: cycling −11% per +10 µg/m³ PM2.5 (walking half), PV yield −20% at PSI 250; annualised by haze days; shelters don't cushion it", label: "literature-derived", source: "NEA PSI bands; bike-trip PM2.5 panel study (TRID 2709590); Nobre et al. 2016 (2013 SG haze, PV −15–25%)" },
  mrt_loop_closure: { name: "MRT loop-closure event", value: "MRT travel time × (1−speedup%) on affected corridors → emergent mode shift", label: "calibrated proxy", source: "Circle Line Stage 6 closes the loop; rail IVTT ~15–20% lower on connected ODs (LTA)" },
};

/** The labelled ledger surfaced with every result (golden-focus: honesty). */
function assumptionLedger(
  pathway: PathwayId,
  startYear: number,
  endYear: number,
  shocks: Shock[],
  hasEV: boolean,
  evDisplacement: EvDisplacementLevel = "base",
  displaceFactor = 0.5
): AssumptionEntry[] {
  const py0 = policyYear(pathway, startYear);
  const pyN = policyYear(pathway, endYear);
  const g = (x: number) => Math.round(x * 1000) / 1000;
  const e = (x: number) => Math.round(x);
  const shockEntries = [...new Set(shocks.map((s) => s.type))].map((t) => SHOCK_LEDGER[t]);
  const evEntries: AssumptionEntry[] = hasEV
    ? [
        { name: "EV consumption", value: `${(evCfg as any).ev_kwh_per_km.value} kWh/km`, label: "measured", source: "LTA EV Guide 2024 (16 kWh/100km); Thai urban real-world 0.160 (2023)" },
        { name: "Charger utilisation", value: `${(evCfg as any).utilization.value * 100}% → ${(evCfg as any).kwh_per_kw_year.value} kWh/kW·yr`, label: "measured", source: "MOT parliamentary reply 7 May 2026: 20% HDB (9% JTC)" },
        { name: "EV displacement", value: `${Math.round(displaceFactor * 100)}% of charged kWh replace ICE car-km (${evDisplacement} scenario)`, label: "speculative", source: "Sensitivity band 20/50/80% — no fleet tied to sites; at conservative, read as 'EV-km enabled potential'" },
      ]
    : [];
  return [
    ...shockEntries,
    ...evEntries,
    { name: "Annualisation basis", value: "daily → yearly × 250 (weekday operational year)", label: "measured", source: "Excludes weekend/off-peak travel — CO2/yr is a weekday-commute basis, not full 365-day activity" },
    { name: "OD travel demand", value: "LTA fare-card OD, monthly → avg weekday", label: "measured", source: "LTA DataMall PV/ODBus + PV/ODTrain" },
    { name: "Bus wait time", value: "measured headway override", label: "measured", source: "LTA BusServices dispatch frequencies" },
    { name: "Grid carbon factor", value: `${g(py0.gridKgPerKWh)} → ${g(pyN.gridKgPerKWh)} kgCO₂/kWh (${startYear}→${endYear})`, label: "policy pathway", source: "EMA 2024 base · 2 GWp solar 2030 + 4 GW low-carbon imports 2035" },
    { name: "Car fleet EF", value: `${e(py0.efByMode.car)} → ${e(pyN.efByMode.car)} gCO₂/pkm`, label: "policy pathway", source: "LTA fleet mix 2025 + all-new-clean registrations from 2030" },
    { name: "Bus fleet EF", value: `${e(py0.efByMode.bus)} → ${e(pyN.efByMode.bus)} gCO₂/pkm (electric share ${Math.round(py0.busElectricShare * 100)}%→${Math.round(pyN.busElectricShare * 100)}%)`, label: "policy pathway", source: "Green Plan: half of bus fleet electric by 2030; e-bus 0.065 kWh/pkm × grid" },
    { name: "Cycling network rollout", value: `district proportional share (comfort +${g(pyN.cycleComfortBonus)}, reach +${g(pyN.cycleMaxKmExtension)} km by ${endYear})`, label: "policy pathway", source: "Green Plan ~1,300 km cycling paths by 2030" },
    { name: "PT share expansion", value: `observed transit ÷ ${(mc.baseline_pt_share as any).value}`, label: "calibrated proxy", source: "LTA Household Travel Survey (~65% peak PT share)" },
    { name: "Mode-choice structure", value: `nested logit: PT nest λ=${(cal as any).runtime?.lambda?.pt}, active nest λ=${(cal as any).runtime?.lambda?.active}; planning-area constants`, label: "calibrated proxy", source: "Constants fitted by BLP contraction to GHS 2025 mode-to-work by planning area (SingStat C020139); out-of-sample 2020→2025 error 1.05pp vs 2.22pp uncalibrated; λ from Ortúzar & Willumsen" },
    { name: "Traveller benefit (ΔCS)", value: "Δlogsum ÷ |β_cost| × trips × 250", label: "literature-derived", source: "Small & Rosen (1981) consumer surplus; standard in UK TAG / ADB appraisal" },
    { name: "β time / cost", value: `${(mc.betas as any).time_per_min.value} /min, ${(mc.betas as any).cost_per_usd.value} /USD`, label: "literature-derived", source: "Rahman et al. IJTTE 2020; Bierlaire MNL" },
    { name: "β heat / rain / comfort / safety", value: `${(mc.betas as any).heat.value} / ${(mc.betas as any).rain.value} / ${(mc.betas as any).comfort.value} / ${(mc.betas as any).safety.value}`, label: "calibrated proxy", source: "UTCI + active-travel literature; plausible SG baseline" },
    { name: "Baseline heat exposure", value: "0.48 = daylight-mean normalised UTCI in full sun (noon: UTCI 38.5 °C sun vs 33.0 °C shade)", label: "measured", source: "NEA 2024 hourly temp/RH/wind (17 stations) → SolarCal mean radiant temperature → UTCI (Bröde 2012); inputs validated vs NEA wet-bulb, MAE 0.37 °C" },
    { name: "Existing shade (per corridor)", value: "fraction of daylight hours in building shadow (district mean 0.37, p10–p90 0.14–0.59)", label: "measured", source: "Sun-position ray-cast (NREL SPA via pvlib) over HDB footprints × town-median storeys + OSM height tags; trees not yet included" },
    { name: "Baseline rain exposure", value: "0.6", label: "calibrated proxy", source: "SG ~167 rain days/yr; most footpaths uncovered outside station catchments" },
    { name: "Adoption ramp", value: "10/20/…/95/100% over 10 years", label: "calibrated proxy", source: "Logistic behaviour-adoption S-curve (EWI 2023); habit + network effects accrue over the decade" },
    { name: "Embodied carbon", value: "PV 700 kg/kWp · battery 75 kg/kWh · walkway 320 t/km · cycle lane 90 t/km", label: "literature-derived", source: "IEA PVPS T12, GREET, roadworks LCA — cradle-to-gate; net avoided = operational − embodied" },
    { name: "Uncertainty band", value: "low ×0.7 / high ×1.35", label: "speculative", source: "Monte Carlo approximation (TREMOVE ranges)" },
  ];
}
