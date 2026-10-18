import { DEGRADATION_RATE, DISCOUNT_RATE, SYSTEM_LIFETIME_YEARS } from "../finance";
import type { BuildingInsightsSummary } from "../solar";
import { USABLE_FRACTION_BY_ROOF_TYPE } from "../vision";

import { BENGALURU, inCity, type IndiaCity } from "./cities";
export const BENGALURU_CENTER = BENGALURU.center;
export const BENGALURU_BOUNDS = BENGALURU.bounds;
export const inBengaluru = (lat: number, lng: number) => inCity(BENGALURU, lat, lng);

export interface PanelPosition {
  center: { latitude: number; longitude: number };
  orientation: "LANDSCAPE" | "PORTRAIT";
  segmentIndex: number;
}
export interface IndiaSolarResult {
  summary: BuildingInsightsSummary;
  panels: PanelPosition[];
  segments: { azimuthDegrees: number; pitchDegrees: number }[];
  source: "Google Solar API · buildingInsights" | "Gemini roof estimate" | "Drawn roof estimate";
  estimation?: { roofType: string; usableFraction: number; dcYieldPerKwp: number; notes: string; confidence?: number };
}
export interface SolarAssumptions {
  tariff: number;
  costPerKwp: number;
  selfConsumption: number;
  exportRate: number;
  acEfficiency: number;
}
export const DEFAULT_SOLAR_ASSUMPTIONS: SolarAssumptions = {
  tariff: 7, costPerKwp: 55000, selfConsumption: 0.7, exportRate: 0, acEfficiency: 0.85,
};

/** INR scenario, not a BESCOM tariff quote; export credits and subsidies are not assumed. */
export function solarFinancials(yearlyDcKwh: number, kwp: number, a: SolarAssumptions) {
  if (![yearlyDcKwh, kwp, a?.tariff, a?.costPerKwp, a?.selfConsumption, a?.exportRate, a?.acEfficiency].every((n) => Number.isFinite(n) && n >= 0) || a.selfConsumption > 1 || a.acEfficiency > 1) throw new Error("Enter valid non-negative solar assumptions; shares must be between 0 and 1.");
  const annualAcKwh = yearlyDcKwh * a.acEfficiency;
  const capex = kwp * a.costPerKwp;
  const annualOm = capex * 0.01;
  const annualValue = annualAcKwh * (a.selfConsumption * a.tariff + (1 - a.selfConsumption) * a.exportRate);
  const annualNetSavings = annualValue - annualOm;
  let cumulative = -capex;
  let npv = -capex;
  let lifetimeAcKwh = 0;
  let paybackYears: number | null = capex === 0 ? 0 : null;
  for (let year = 1; year <= SYSTEM_LIFETIME_YEARS; year++) {
    const degradation = (1 - DEGRADATION_RATE) ** (year - 1);
    lifetimeAcKwh += annualAcKwh * degradation;
    const cash = annualValue * degradation - annualOm;
    npv += cash / (1 + DISCOUNT_RATE) ** year;
    if (paybackYears === null && capex > 0 && cash > 0 && cumulative < 0 && cumulative + cash >= 0) paybackYears = year - 1 - cumulative / cash;
    cumulative += cash;
  }
  const lifetimeSavings20y = cumulative;
  const lifetimeCost = capex + annualOm * SYSTEM_LIFETIME_YEARS;
  const lcoeInrPerKwh = lifetimeAcKwh > 0 ? lifetimeCost / lifetimeAcKwh : null;
  if (![annualAcKwh, capex, annualOm, annualNetSavings, npv, lifetimeSavings20y, lifetimeAcKwh, lifetimeCost, ...(lcoeInrPerKwh === null ? [] : [lcoeInrPerKwh])].every(Number.isFinite)) throw new Error("Financial inputs are too large. Enter realistic bill and installation values.");
  return { annualAcKwh, capex, annualOm, annualNetSavings, paybackYears, npv, lifetimeSavings20y, lcoeInrPerKwh };
}


export const INDIA_SOLAR_SOURCES = {
  tariff: { title: "KERC retail tariff order · 27 March 2025 · FY2025–28", url: "https://kerc.karnataka.gov.in/uploads/96731743148968.pdf" },
  export: { title: "BESCOM rooftop solar · applicable tariff orders and PPA", url: "https://srtpv.bescom.org/SRTPV/" },
  carbon: { title: "CEA v21 · FY2024–25 · reproduced by NITI Aayog (2026), Annexure E", url: "https://www.niti.gov.in/sites/default/files/2026-02/Scenarios-Towards-Viksit-Bharat-and-Net-Zero-Sectoral-Insights-Power.pdf#page=118" },
};
export const INDIA_GRID_CO2_KG_PER_KWH = 0.71;

/** Area-based screening, not a measured panel layout or a shading simulation. */
export function estimatedRoof(lat: number, lng: number, area: number, roofType: string, source: "Gemini roof estimate" | "Drawn roof estimate", city: IndiaCity = BENGALURU): IndiaSolarResult {
  if (!inCity(city, lat, lng) || !Number.isFinite(area) || area < 2.6 || area > 100000 || !Object.hasOwn(USABLE_FRACTION_BY_ROOF_TYPE, roofType) || roofType === "none") throw new Error("Select a roof in this city between 2.6 and 100,000 m² and a supported roof type.");
  const usableFraction = USABLE_FRACTION_BY_ROOF_TYPE[roofType];
  const panels = Math.floor(area * usableFraction / 2.6);
  if (panels < 1) throw new Error("The selected usable area is too small for one panel.");
  const kwp = panels * 550 / 1000;
  // shortcut: generic 1,800 DC kWh/kWp/year, replace with site-specific irradiance and shading modelling for design work.
  const dcYieldPerKwp = 1800;
  return {
    source, panels: [], segments: [],
    estimation: { roofType, usableFraction, dcYieldPerKwp, notes: "Area-based estimate using 550 W panels at 2.6 m² each. Usable area reserves space for access and obstructions; no site shading or structural assessment." },
    summary: {
      panels, kwp, yearly_kwh: kwp * dcYieldPerKwp, panel_capacity_watts: 550,
      panel_height_m: 2, panel_width_m: 1.3, panel_area_m2: 2.6,
      whole_roof_area_m2: area, max_array_area_m2: panels * 2.6,
      max_sunshine_hours_per_year: dcYieldPerKwp, carbon_offset_factor_kg_per_mwh: null,
      roof_segment_count: 0, roof_segments: [], best_segment: null,
      imagery_date: null, imagery_quality: "NOT_MEASURED", imagery_processed_date: null,
      center: { lat, lng },
    },
  };
}

export function proposalFacts(result: IndiaSolarResult, assumptions: SolarAssumptions, city: IndiaCity = BENGALURU) {
  const s = result.summary;
  const finance = solarFinancials(s.yearly_kwh, s.kwp, assumptions);
  return {
    location: `${city.name}, ${city.region}, India`, currency: "INR", utility: city.slug === "bengaluru" ? "BESCOM — verify against your bill" : "Confirm distribution company from electricity bill", guidance: city.guidance,
    source: result.source, estimation: result.estimation ?? null,
    panels: s.panels, kwp: s.kwp, roofAreaM2: s.whole_roof_area_m2,
    annualDcKwh: s.yearly_kwh, ...finance,
    co2TonnesPerYear: finance.annualAcKwh * INDIA_GRID_CO2_KG_PER_KWH / 1000,
    gridCarbonKgPerKwh: INDIA_GRID_CO2_KG_PER_KWH,
    assumptions, sources: solarSources(city),
    limitations: "Pre-feasibility estimate. Lifetime savings are undiscounted net cash flow after installation and maintenance over 20 years. LCOE is undiscounted installation plus maintenance cost divided by degraded lifetime AC generation, in INR/kWh. Constant tariffs, 1% annual maintenance, 0.7% degradation, 8% discount, 20 years. Tariff and installation inputs are user scenarios, not official quotes. No subsidy, financing, tax, fixed-charge savings, replacements or verified carbon credits. Export compensation and eligibility must be checked against the applicable distribution-company agreement. Carbon uses a dated all-India average, not a city-specific marginal factor.",
  };
}

export type BengaluruSolarResult = IndiaSolarResult;
export function solarSources(city: IndiaCity) {
  return city.slug === "bengaluru" ? INDIA_SOLAR_SOURCES : {
    rooftop: {title:"MNRE national rooftop solar portal · select your state and distribution company",url:"https://solarrooftop.pmsuryaghar.gov.in/"},
    carbon: INDIA_SOLAR_SOURCES.carbon,
  };
}
