import tariffsData from "@/data/tariffs.json";

export const TARIFFS: Record<string, TariffEntry> = tariffsData as any;

export interface TariffEntry {
  country: string;
  utility: string;
  currency: string;
  tariff_per_kwh: number;
  tariff_year: number;
  tariff_source: string;
  tariff_tier: string;
  grid_carbon_kg_per_kwh: number;
  co2_source: string;
  irradiance_kwh_m2_year: number;
  panel_wattage: number;
  panel_area_m2: number;
  install_cost_per_kwp: number;
  performance_ratio: number;
  om_usd_per_kwp_year: number;
  climate: string;
  verified_policy: string;
}

export const DEGRADATION_RATE = 0.007;
export const TARIFF_ESCALATION = 0.03;
export const DISCOUNT_RATE = 0.08;
export const SYSTEM_LIFETIME_YEARS = 20;

export function getTariff(countryCode: string): TariffEntry {
  return TARIFFS[countryCode] ?? TARIFFS.DEFAULT;
}

export interface FinancialsOutput {
  tariff_per_kwh_usd: number;
  tariff_year: number;
  tariff_source: string;
  tariff_tier: string;
  om_usd_per_kwp_year: number;
  om_usd_per_year: number;
  yearly_savings_usd: number;
  yearly_gross_revenue_y1_usd: number;
  install_cost_usd: number;
  payback_years: number | null;
  co2_offset_tonnes_per_year: number;
  co2_source: string;
  lifetime_savings_20y_usd: number;
  npv_usd: number;
  lcoe_usd_per_mwh: number | null;
  degradation_rate: number;
  tariff_escalation: number;
  discount_rate: number;
  performance_ratio: number;
  utility: string;
  country: string;
  grid_carbon_kg_per_kwh: number;
}

export function computeFinancials(
  yearlyKwh: number,
  kwp: number,
  countryCode: string
): FinancialsOutput {
  const t = getTariff(countryCode);
  const tariffY1 = t.tariff_per_kwh;
  const omPerKwp = t.om_usd_per_kwp_year ?? 18;
  const installCost = kwp * t.install_cost_per_kwp;
  const annualOm = kwp * omPerKwp;

  const cashflows: number[] = [];
  const discounted: number[] = [];
  let cumUndiscounted = -installCost;
  let simplePayback: number | null = null;
  let totalEnergy = 0;

  for (let y = 1; y <= SYSTEM_LIFETIME_YEARS; y++) {
    const energyY = yearlyKwh * Math.pow(1 - DEGRADATION_RATE, y - 1);
    const tariffY = tariffY1 * Math.pow(1 + TARIFF_ESCALATION, y - 1);
    const revenueY = energyY * tariffY;
    const cashflowY = revenueY - annualOm;
    cashflows.push(cashflowY);
    discounted.push(cashflowY / Math.pow(1 + DISCOUNT_RATE, y));
    totalEnergy += energyY;
    cumUndiscounted += cashflowY;
    if (simplePayback === null && cumUndiscounted >= 0) {
      const prev = cumUndiscounted - cashflowY;
      simplePayback =
        cashflowY > 0 ? y - 1 + -prev / cashflowY : y;
    }
  }

  const yearlySavingsY1 = yearlyKwh * tariffY1 - annualOm;
  const lifetimeSavings = cashflows.reduce((a, b) => a + b, 0) - installCost;
  const npv = discounted.reduce((a, b) => a + b, 0) - installCost;
  const co2Tonnes = (yearlyKwh * t.grid_carbon_kg_per_kwh) / 1000;
  const lcoe =
    totalEnergy > 0
      ? ((installCost + annualOm * SYSTEM_LIFETIME_YEARS) / totalEnergy) * 1000
      : null;

  return {
    tariff_per_kwh_usd: tariffY1,
    tariff_year: t.tariff_year,
    tariff_source: t.tariff_source,
    tariff_tier: t.tariff_tier,
    om_usd_per_kwp_year: omPerKwp,
    om_usd_per_year: Math.round(annualOm),
    yearly_savings_usd: Math.round(yearlySavingsY1),
    yearly_gross_revenue_y1_usd: Math.round(yearlyKwh * tariffY1),
    install_cost_usd: Math.round(installCost),
    payback_years: simplePayback !== null ? Math.round(simplePayback * 10) / 10 : null,
    co2_offset_tonnes_per_year: Math.round(co2Tonnes * 10) / 10,
    co2_source: t.co2_source,
    lifetime_savings_20y_usd: Math.round(lifetimeSavings),
    npv_usd: Math.round(npv),
    lcoe_usd_per_mwh: lcoe !== null ? Math.round(lcoe * 10) / 10 : null,
    degradation_rate: DEGRADATION_RATE,
    tariff_escalation: TARIFF_ESCALATION,
    discount_rate: DISCOUNT_RATE,
    performance_ratio: t.performance_ratio ?? 0.77,
    utility: t.utility,
    country: t.country,
    grid_carbon_kg_per_kwh: t.grid_carbon_kg_per_kwh,
  };
}
