// HELIO — Hanoi EV Grid Decarbonization Engine
//
// Per-site carbon-shifting model. Each candidate site has a charging profile
// determined by its category (university=solar window, metro=commuter peaks,
// office=daytime). Deploying a site shifts its daily EVs from unmanaged
// home charging (evening coal peak) to managed charging at that site's profile.
//
// ── Data sources & confidence ──────────────────────────────────────────
//   Grid EF (annual avg):  681 gCO₂/kWh — HUST 2024 (literature)
//   Grid EF (hourly curve): Proxy — shaped from measured Polish grid data
//                           (Electricity Maps 2024/2025). Poland selected as
//                           proxy due to near-identical coal share (50.6% vs
//                           Vietnam 49.6%). Validated by Vietnam dispatch model
//                           (Calafiore et al. 2025, arXiv:2511.06131).
//   Baseline charging:    Literature-derived — 70-80% of residential charging
//                           between 17:00-02:00 (DTU Denmark 2020 measured;
//                           Shakti Foundation India 2024 survey).
//   Category profiles:    Literature-derived — workplace 60-70% between
//                           09:00-14:00 (23.9M measured transactions, Germany
//                           2023); commercial dual-peak 11:00-13:00 & 16:00-18:00
//                           (Shanghai spatial-temporal study).
//   Daily kWh per EV:      Scooter 1.5 kWh (3 kWh battery / 2-day cycle) — literature.
//                           Car 7.0 kWh (VinFast VF5 37 kWh / ~5-day cycle) — literature.
//                           Blended at 90% scooter / 10% car (Hanoi fleet ratio).
//   Daily EVs per site:    Estimated from POI density, campus enrolment,
//                           worker counts — assumed, not measured.
//   CAPEX:                 AC L2 $590-$1,970/unit, DC fast $7,600-$15,200/unit,
//                           V-Green 4-pole ~$79,000, solar carport $700-$1,100/kWp
//                           — EV Charging Infrastructure Catalogue 2026 (literature).
//   Asset life:            10 years (L2 AC), 12 years (DC fast), 25 years (solar).

export type Confidence = "measured" | "literature" | "proxy" | "assumed" | "illustrative";

export const CONFIDENCE: Record<string, { label: string; level: Confidence }> = {
  hourlyEF:        { label: "Proxy — measured Polish grid data (Electricity Maps 2025); validated by Vietnam dispatch model (Calafiore et al. 2025)", level: "proxy" },
  baselineWeights: { label: "Literature — 70-80% evening charging (DTU Denmark 2020 measured; Shakti Foundation India 2024)", level: "literature" },
  categoryProfiles:{ label: "Literature — workplace 60-70% daytime from 23.9M transactions (Germany 2023); commercial from Shanghai study", level: "literature" },
  dailyKwhScooter:  { label: "Literature — 3 kWh battery / 2-day charge cycle", level: "literature" },
  dailyKwhCar:      { label: "Literature — VinFast VF5 37 kWh / ~5-day cycle", level: "literature" },
  dailyEvs:         { label: "Assumed — estimated from POI density & campus/workers", level: "assumed" },
  capex:            { label: "Literature — EV Charging Infrastructure Catalogue 2026", level: "literature" },
  annualAvgEF:      { label: "Literature — HUST 2024 / MoNRE 2023 (659.2)", level: "literature" },
};

// Vietnam annual average grid emission factor (gCO₂/kWh)
// Source: HUST 2024 (681), MoNRE 2023 (659.2) — both are annual averages
export const ANNUAL_AVG_EF = 681;

// Asset life assumptions for levelized cost calculation (years)
export const ASSET_LIFE_YEARS: Record<InterventionType, number> = {
  ev_level_2: 10,
  dc_fast: 12,
  solar_canopy: 25,
};
const DEFAULT_ASSET_LIFE = 10;

// 24-hour grid emission factors (gCO₂/kWh), index = hour of day (0-23)
// PROXY: Shape derived from measured Polish hourly carbon intensity data
//   (Electricity Maps 2024/2025). Poland's coal share (50.6%) is near-identical
//   to Vietnam's (49.6%), making it the best available proxy. The shape —
//   coal peaks 18-21h, solar trough 10-14h — is validated by Vietnam-specific
//   dispatch modelling (Calafiore et al. 2025, arXiv:2511.06131, mean CI
//   360-466 gCO₂/kWh). Values scaled to Vietnam's annual avg of 681 gCO₂/kWh.
export const HOURLY_EF: number[] = [
  695, 685, 675, 670, 675, 695,   // 00-05: overnight, baseload coal dominance
  730, 755, 765, 725, 585, 505,   // 06-11: morning ramp → solar displaces coal
  480, 490, 540, 625, 690, 750,   // 12-17: midday solar trough → afternoon ramp
  785, 790, 780, 755, 725, 705,   // 18-23: evening coal peak → late taper
];

// Baseline: unmanaged home charging — 80% of daily demand concentrated 6-10 PM
// LITERATURE-DERIVED: Matches measured residential profiles — 70-80% of load
//   between 17:00-02:00 (DTU Denmark 2020 measured meter data; Shakti Foundation
//   India 2024 survey of E2W/E3W/E4W charging patterns).
const BASELINE_WEIGHTS: number[] = [
  0.03, 0.02, 0.01, 0.01, 0.00, 0.00,
  0.00, 0.00, 0.00, 0.00, 0.00, 0.00,
  0.00, 0.00, 0.00, 0.00, 0.00, 0.01,
  0.20, 0.25, 0.20, 0.15, 0.08, 0.04,
];

// Per-category charging profiles: fraction of daily charging per hour
// LITERATURE-DERIVED: Workplace profiles match 60-70% of load 09:00-14:00
//   from 23.9M measured workplace charging transactions (Germany 2023).
//   Commercial profiles match dual-peak pattern from Shanghai spatial-temporal
//   study. Residential baseline matches DTU/Shakti measured evening surge.
//   Category-specific shapes adapted to Vietnamese building-type context.
const CATEGORY_PROFILES: Record<string, number[]> = {
  university: [
    0, 0, 0, 0, 0, 0,
    0, 0, 0.06, 0.14, 0.18, 0.18,
    0.16, 0.13, 0.08, 0.05, 0.02, 0,
    0, 0, 0, 0, 0, 0,
  ],
  office: [
    0, 0, 0, 0, 0, 0,
    0, 0, 0.04, 0.12, 0.17, 0.17,
    0.15, 0.12, 0.10, 0.07, 0.04, 0.02,
    0, 0, 0, 0, 0, 0,
  ],
  commercial: [
    0, 0, 0, 0, 0, 0,
    0, 0, 0.02, 0.06, 0.10, 0.12,
    0.12, 0.12, 0.12, 0.10, 0.10, 0.08,
    0.04, 0.02, 0, 0, 0, 0,
  ],
  metro_station: [
    0, 0, 0, 0, 0, 0,
    0.04, 0.12, 0.15, 0.10, 0.05, 0.04,
    0.04, 0.04, 0.05, 0.06, 0.08, 0.10,
    0.08, 0.04, 0.01, 0, 0, 0,
  ],
  transit_hub: [
    0, 0, 0, 0, 0, 0.02,
    0.06, 0.12, 0.12, 0.08, 0.05, 0.04,
    0.04, 0.04, 0.06, 0.08, 0.10, 0.10,
    0.06, 0.02, 0.01, 0, 0, 0,
  ],
  government_civic: [
    0, 0, 0, 0, 0, 0,
    0, 0, 0.06, 0.14, 0.17, 0.17,
    0.15, 0.13, 0.10, 0.06, 0.02, 0,
    0, 0, 0, 0, 0, 0,
  ],
  enforcement_checkpoint: [
    0, 0, 0, 0, 0, 0.02,
    0.06, 0.10, 0.12, 0.10, 0.06, 0.04,
    0.04, 0.04, 0.06, 0.08, 0.10, 0.08,
    0.06, 0.03, 0.01, 0, 0, 0,
  ],
  industrial: [
    0, 0, 0, 0, 0, 0,
    0.04, 0.10, 0.14, 0.16, 0.16, 0.14,
    0.10, 0.08, 0.06, 0.02, 0, 0,
    0, 0, 0, 0, 0, 0,
  ],
  commercial_residential: [
    0, 0, 0, 0, 0, 0,
    0, 0, 0.03, 0.08, 0.12, 0.12,
    0.12, 0.10, 0.10, 0.08, 0.08, 0.06,
    0.05, 0.04, 0.02, 0, 0, 0,
  ],
};

// Reference data for each intervention type. Used for:
//   - InterventionType union (keyof typeof INTERVENTIONS)
//   - ASSET_LIFE_YEARS mapping
//   - UI labels and source citations
// NOTE: costPerUnit is the per-unit literature cost. Actual per-site capex
//   comes from site.capex_usd in chargers.json (≈ deploy_units × costPerUnit
//   + installation overhead, set by ingest/hanoi_site_economics.py).
export const INTERVENTIONS = {
  ev_level_2: {
    label: "Commercial L2 AC Smart Charger",
    costPerUnit: 4_500,   // $590-$1,970/unit (EV Charging Catalogue 2026) — mid-range with install
    powerKw: 22,
    unitLabel: "ports",
    capexSource: "$590-$1,970/unit — EV Charging Infrastructure Catalogue 2026",
  },
  dc_fast: {
    label: "DC Fast Charging Hub",
    costPerUnit: 35_000,  // $7,600-$15,200/unit × 3-pole hub (V-Green 4-pole ~$79,000)
    powerKw: 50,
    unitLabel: "hubs",
    capexSource: "$7,600-$15,200/unit — EV Charging Infrastructure Catalogue 2026",
  },
  solar_canopy: {
    label: "Solar-Assisted Carport Canopy",
    costPerUnit: 145,    // $700-$1,100/kWp ÷ ~5 kWp per m² (carport density)
    powerKw: 0.15,
    unitLabel: "m²",
    capexSource: "$700-$1,100/kWp — EV Charging Infrastructure Catalogue 2026",
  },
} as const;

export type InterventionType = keyof typeof INTERVENTIONS;

// Daily kWh per EV — split by vehicle class
// Scooter: 3 kWh battery, charges every 2 days → 1.5 kWh/day (literature)
// Car: VinFast VF5 37 kWh battery, ~5-day cycle → ~7.0 kWh/day (literature)
// Hanoi fleet is ~90% e-scooters, ~10% e-cars (assumed mix)
const DAILY_KWH_SCOOTER = 1.5;
const DAILY_KWH_CAR = 7.0;
const CAR_FRACTION = 0.10; // 10% cars, 90% scooters — Hanoi 2026 fleet estimate (assumed)
const DAILY_KWH_PER_EV = DAILY_KWH_SCOOTER * (1 - CAR_FRACTION) + DAILY_KWH_CAR * CAR_FRACTION; // ≈ 2.05
const PEAK_HOURS = [18, 19, 20, 21];

// Weighted baseline EF (constant — all unmanaged charging looks the same)
export const BASELINE_EF_WEIGHTED = BASELINE_WEIGHTS.reduce(
  (sum, w, h) => sum + w * HOURLY_EF[h], 0
);

export interface CandidateSite {
  id: string;
  name: string;
  lat: number;
  lng: number;
  priority: number;
  district: string;
  zone: string;
  category: string;
  rationale: string;
  recommended_type: InterventionType;
  coverage_gap_km: number;
  nearest_existing: string;
  capex_usd: number;
  daily_evs: number;
  deploy_units: number;
  deploy_unit_label: string;
  poi_count_500m?: number;
}

export interface SiteResult {
  annualCO2SavedTonnes: number;
  costPerTonne: number;            // one-time capex / annual CO₂ ($/t-yr)
  levelizedCostPerTonne: number;   // capex / (annual CO₂ × asset life) ($/t over asset life)
  peakShavingKW: number;
  siteEFWeighted: number;       // gCO₂/kWh weighted average for this site's profile
  solarAlignmentPct: number;    // % of charging in 10AM-2PM solar window
}

export interface PortfolioResult {
  totalCO2SavedTonnes: number;
  totalCapexUSD: number;
  avgCostPerTonne: number;
  avgLevelizedCostPerTonne: number;
  totalPeakShavingMW: number;
  siteCount: number;
  portfolioEFWeighted: number;
  baselineEFWeighted: number;
  annualAvgEF: number;
}

function getProfile(category: string): number[] {
  return CATEGORY_PROFILES[category] ?? CATEGORY_PROFILES["commercial"];
}

export function solveSite(site: CandidateSite): SiteResult {
  const profile = getProfile(site.category);
  const dailyKwh = site.daily_evs * DAILY_KWH_PER_EV;

  // Weighted EF for this site's charging profile
  const siteEFWeighted = profile.reduce((sum, w, h) => sum + w * HOURLY_EF[h], 0);

  // Annual CO₂ saved = shifted from baseline to this site's profile
  const deltaEF = BASELINE_EF_WEIGHTED - siteEFWeighted; // gCO₂/kWh delta
  const annualCO2SavedTonnes = (dailyKwh * deltaEF * 365) / 1_000_000;

  // Cost per tonne (one-time capex / annual savings → $/tonne-per-year)
  const costPerTonne = annualCO2SavedTonnes > 0
    ? site.capex_usd / annualCO2SavedTonnes
    : Infinity;

  // Levelized cost per tonne over asset life ($/tonne over full lifecycle)
  const assetLife = ASSET_LIFE_YEARS[site.recommended_type] ?? DEFAULT_ASSET_LIFE;
  const levelizedCostPerTonne = annualCO2SavedTonnes > 0
    ? site.capex_usd / (annualCO2SavedTonnes * assetLife)
    : Infinity;

  // Peak shaving: kWh removed from 6-9 PM
  let baselinePeakKwh = 0;
  for (const h of PEAK_HOURS) {
    baselinePeakKwh += dailyKwh * BASELINE_WEIGHTS[h];
  }
  // Site may still have some evening charging
  let sitePeakKwh = 0;
  for (const h of PEAK_HOURS) {
    sitePeakKwh += dailyKwh * profile[h];
  }
  const peakShavingKW = (baselinePeakKwh - sitePeakKwh); // kW (1 hour = 1 kWh → kW)

  // Solar alignment: fraction of charging in 10AM-2PM
  const solarHours = [10, 11, 12, 13, 14];
  const solarAlignmentPct = solarHours.reduce((sum, h) => sum + profile[h], 0) * 100;

  return {
    annualCO2SavedTonnes,
    costPerTonne,
    levelizedCostPerTonne,
    peakShavingKW,
    siteEFWeighted,
    solarAlignmentPct,
  };
}

export function solvePortfolio(deployedSites: CandidateSite[]): PortfolioResult {
  if (deployedSites.length === 0) {
    return {
      totalCO2SavedTonnes: 0,
      totalCapexUSD: 0,
      avgCostPerTonne: 0,
      avgLevelizedCostPerTonne: 0,
      totalPeakShavingMW: 0,
      siteCount: 0,
      portfolioEFWeighted: 0,
      baselineEFWeighted: BASELINE_EF_WEIGHTED,
      annualAvgEF: ANNUAL_AVG_EF,
    };
  }

  let totalCO2 = 0;
  let totalCapex = 0;
  let totalPeakKW = 0;
  let totalDailyKwh = 0;
  let weightedEFSum = 0;
  let totalLifetimeCO2 = 0;

  for (const site of deployedSites) {
    const r = solveSite(site);
    totalCO2 += r.annualCO2SavedTonnes;
    totalCapex += site.capex_usd;
    totalPeakKW += r.peakShavingKW;

    const assetLife = ASSET_LIFE_YEARS[site.recommended_type] ?? DEFAULT_ASSET_LIFE;
    totalLifetimeCO2 += r.annualCO2SavedTonnes * assetLife;

    const dailyKwh = site.daily_evs * DAILY_KWH_PER_EV;
    totalDailyKwh += dailyKwh;
    weightedEFSum += dailyKwh * r.siteEFWeighted;
  }

  const portfolioEFWeighted = totalDailyKwh > 0 ? weightedEFSum / totalDailyKwh : 0;
  const avgCostPerTonne = totalCO2 > 0 ? totalCapex / totalCO2 : 0;
  const avgLevelizedCostPerTonne = totalLifetimeCO2 > 0 ? totalCapex / totalLifetimeCO2 : 0;

  return {
    totalCO2SavedTonnes: totalCO2,
    totalCapexUSD: totalCapex,
    avgCostPerTonne,
    avgLevelizedCostPerTonne,
    totalPeakShavingMW: totalPeakKW / 1_000,
    siteCount: deployedSites.length,
    portfolioEFWeighted,
    baselineEFWeighted: BASELINE_EF_WEIGHTED,
    annualAvgEF: ANNUAL_AVG_EF,
  };
}

// Greedy optimizer: pick sites by best cost/tonne until budget exhausted
export function optimizePortfolio(
  candidates: CandidateSite[],
  budgetUSD: number
): Set<string> {
  const ranked = candidates
    .map((site) => ({ site, result: solveSite(site) }))
    .filter((x) => x.result.annualCO2SavedTonnes > 0)
    .sort((a, b) => a.result.costPerTonne - b.result.costPerTonne);

  const deployed = new Set<string>();
  let spent = 0;
  for (const { site } of ranked) {
    if (spent + site.capex_usd > budgetUSD) continue;
    deployed.add(site.id);
    spent += site.capex_usd;
  }
  return deployed;
}

// Export for EmissionChart — get the blended charging profile for deployed sites only.
// Shows WHERE your chargers' users charge (daytime) vs baseline (evening).
export function getPortfolioProfile(
  deployedSites: CandidateSite[],
  allSitesCount: number
): number[] {
  if (deployedSites.length === 0) return BASELINE_WEIGHTS;

  const totalDailyEvs = deployedSites.reduce((s, site) => s + site.daily_evs, 0);
  if (totalDailyEvs === 0) return BASELINE_WEIGHTS;

  // Blend only the deployed sites' profiles, weighted by their daily EVs.
  // This shows what YOUR investment does, not the whole 450K fleet.
  const blended: number[] = new Array(24).fill(0);
  for (let h = 0; h < 24; h++) {
    let weightedSum = 0;
    for (const site of deployedSites) {
      const profile = getProfile(site.category);
      weightedSum += site.daily_evs * profile[h];
    }
    blended[h] = weightedSum / totalDailyEvs;
  }

  return blended;
}

export { BASELINE_WEIGHTS };
