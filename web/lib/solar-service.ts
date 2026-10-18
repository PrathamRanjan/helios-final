import { buildingInsights, summarizeBuildingInsights } from "./solar";
import { fetchSatelliteTile, visionEstimateRoof, USABLE_FRACTION_BY_ROOF_TYPE } from "./vision";
import { computeFinancials, getTariff } from "./finance";

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";
const GOOGLE_SOLAR_KEY = process.env.GOOGLE_SOLAR_API_KEY ?? GOOGLE_MAPS_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "";

export async function solarViaSolarApi(
  lat: number,
  lng: number,
  address: string | null,
  country: string
): Promise<any | null> {
  const bi = await buildingInsights(lat, lng, GOOGLE_SOLAR_KEY);
  if (!bi || !bi.solarPotential) return null;
  const s = summarizeBuildingInsights(bi);
  const fin = computeFinancials(s.yearly_kwh, s.kwp, country);
  const verifiedFraction =
    s.whole_roof_area_m2 > 0
      ? Math.round((s.max_array_area_m2 / s.whole_roof_area_m2) * 1000) / 1000
      : null;
  const band =
    s.imagery_quality === "HIGH"
      ? 5
      : s.imagery_quality === "MEDIUM"
        ? 10
        : 20;
  return {
    source: "google_solar",
    address,
    lat: s.center.lat ?? lat,
    lng: s.center.lng ?? lng,
    country_code: country,
    roof_area_m2: s.whole_roof_area_m2,
    usable_area_m2: s.max_array_area_m2,
    usable_fraction_verified: verifiedFraction,
    panels: s.panels,
    kwp: s.kwp,
    yearly_kwh: s.yearly_kwh,
    sunshine_hours_per_year: s.max_sunshine_hours_per_year,
    panel_capacity_watts: s.panel_capacity_watts,
    panel_area_m2: s.panel_area_m2,
    imagery_quality: s.imagery_quality,
    imagery_date: s.imagery_date,
    roof_segment_count: s.roof_segment_count,
    roof_segments: s.roof_segments,
    best_segment: s.best_segment,
    confidence_tier: "A",
    confidence_band_pct: band,
    provenance: "Google Solar API (buildingInsights + dataLayers)",
    ...fin,
  };
}

export async function solarViaVision(
  lat: number,
  lng: number,
  address: string | null,
  country: string
): Promise<any> {
  const t = getTariff(country);
  const panelArea = t.panel_area_m2;
  const panelW = t.panel_wattage;
  const irradiance = t.irradiance_kwh_m2_year;
  const perfRatio = t.performance_ratio ?? 0.77;

  const tile = await fetchSatelliteTile(lat, lng, GOOGLE_MAPS_KEY, 19, 640);
  let roofArea = 0;
  let usableRatio = 0;
  let confidence = 0;
  let notes: string | null = null;
  let buildingType: string | null = null;
  let roofType = "none";

  if (tile) {
    const est = await visionEstimateRoof(tile.pngBytes, tile.groundSideM, GEMINI_KEY);
    if (est && est.primary_roof_area_m2 > 50) {
      roofArea = est.primary_roof_area_m2;
      usableRatio = est.usable_fraction;
      confidence = est.confidence;
      notes = est.notes;
      buildingType = est.building_type;
      roofType = est.roof_type;
    }
  }

  const usable = roofArea * usableRatio;
  const panels = panelArea > 0 ? Math.floor(usable / panelArea) : 0;
  const kwp = Math.round((panels * panelW) / 100) / 10;
  const yearlyKwh = kwp > 0 ? Math.round(kwp * irradiance * perfRatio) : 0;
  const fin = computeFinancials(yearlyKwh, kwp, country);

  return {
    source: "vision_estimate",
    address,
    lat,
    lng,
    country_code: country,
    roof_area_m2: Math.round(roofArea),
    usable_area_m2: Math.round(usable),
    panels,
    kwp,
    yearly_kwh: yearlyKwh,
    sunshine_hours_per_year: Math.round(irradiance),
    panel_capacity_watts: panelW,
    panel_area_m2: panelArea,
    imagery_quality: "VISION_ESTIMATE",
    confidence_tier: "B",
    confidence_band_pct: 30,
    vision_confidence: confidence,
    vision_notes: notes,
    building_type: buildingType,
    roof_type: roofType,
    usable_fraction_applied: usableRatio,
    provenance: "Gemini 2.5 Flash vision estimate over Google Static Maps satellite tile",
    ...fin,
  };
}

export async function solarViaManual(
  lat: number,
  lng: number,
  roofAreaM2: number,
  roofType: string,
  address: string | null,
  country: string
): Promise<any> {
  const t = getTariff(country);
  const panelArea = t.panel_area_m2;
  const panelW = t.panel_wattage;
  const irradiance = t.irradiance_kwh_m2_year;
  const perfRatio = t.performance_ratio ?? 0.77;

  const finalRoofType =
    roofType in USABLE_FRACTION_BY_ROOF_TYPE ? roofType : "flat";
  const usableRatio = USABLE_FRACTION_BY_ROOF_TYPE[finalRoofType];

  const roofArea = Math.max(roofAreaM2, 0);
  const usable = roofArea * usableRatio;
  const panels = panelArea > 0 ? Math.floor(usable / panelArea) : 0;
  const kwp = Math.round((panels * panelW) / 100) / 10;
  const yearlyKwh = kwp > 0 ? Math.round(kwp * irradiance * perfRatio) : 0;
  const fin = computeFinancials(yearlyKwh, kwp, country);

  return {
    source: "manual",
    address,
    lat,
    lng,
    country_code: country,
    roof_area_m2: Math.round(roofArea),
    usable_area_m2: Math.round(usable),
    panels,
    kwp,
    yearly_kwh: yearlyKwh,
    sunshine_hours_per_year: Math.round(irradiance),
    panel_capacity_watts: panelW,
    panel_area_m2: panelArea,
    imagery_quality: "MANUAL_POLYGON",
    confidence_tier: "C",
    confidence_band_pct: 10,
    roof_type: finalRoofType,
    usable_fraction_applied: usableRatio,
    provenance: "User-drawn polygon · geodesic area via google.maps.geometry.spherical",
    ...fin,
  };
}
