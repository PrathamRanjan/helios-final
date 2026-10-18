export interface RoofSegment {
  pitch_deg: number;
  azimuth_deg: number;
  area_m2: number;
  sunshine_kwh_m2_yr: number;
}

export interface SolarData {
  source: "google_solar" | "vision_estimate" | "manual";
  address: string | null;
  lat: number;
  lng: number;
  country_code: string;
  roof_area_m2: number;
  usable_area_m2: number;
  panels: number;
  kwp: number;
  yearly_kwh: number;
  sunshine_hours_per_year: number;
  panel_capacity_watts: number;
  panel_area_m2: number;
  tariff_per_kwh_usd: number;
  yearly_savings_usd: number;
  install_cost_usd: number;
  payback_years: number | null;
  co2_offset_tonnes_per_year: number;
  lifetime_savings_20y_usd: number;
  utility: string;
  country: string;
  grid_carbon_kg_per_kwh: number;
  imagery_quality?: string;
  imagery_date?: string | null;
  headline?: string;
  provenance?: string;

  // New finance model fields
  npv_usd?: number;
  lcoe_usd_per_mwh?: number | null;
  om_usd_per_year?: number;
  om_usd_per_kwp_year?: number;
  degradation_rate?: number;
  tariff_escalation?: number;
  discount_rate?: number;
  performance_ratio?: number;
  tariff_year?: number;
  tariff_source?: string;
  tariff_tier?: string;
  co2_source?: string;

  // Confidence tier
  confidence_tier?: "A" | "B" | "C";
  confidence_band_pct?: number;

  // google_solar only
  roof_segment_count?: number;
  roof_segments?: RoofSegment[];
  best_segment?: RoofSegment | null;
  usable_fraction_verified?: number | null;

  // vision_estimate only
  vision_confidence?: number;
  vision_notes?: string | null;
  building_type?: string | null;
  roof_type?: "flat" | "pitched_simple" | "pitched_complex" | "partial_obstructed" | "none";
  usable_fraction_applied?: number;
}

export interface ContextElevation { elevation_m: number; resolution_m: number; }
export interface ContextTimezone {
  time_zone_id: string;
  time_zone_name: string;
  utc_offset_hours: number;
  dst_offset_hours: number;
  solar_noon_local: string;
}
export interface ContextAirQuality {
  aqi: number;
  category: string;
  dominant_pollutant: string;
  region_code: string;
}
export interface ContextWeather {
  description: string;
  type: string;
  icon_uri: string;
  temp_c: number;
  feels_like_c: number;
  cloud_cover_pct: number | null;
  is_daytime: boolean;
}
export interface ContextAerial {
  state: string;
  video_landscape: string;
  video_portrait: string;
  thumb_landscape: string;
  thumb_portrait: string;
}
export interface ContextData {
  elevation: ContextElevation | null;
  timezone: ContextTimezone | null;
  air_quality: ContextAirQuality | null;
  weather: ContextWeather | null;
  aerial_view: ContextAerial | null;
}

export interface DemoListItem {
  slug: string;
  address: string;
  lat: number;
  lng: number;
  country_code?: string;
  headline: string;
}

export type CountryCode = "VN" | "SG" | "PH" | "TH" | "ID" | "MY";

export interface CountryProfile {
  code: CountryCode;
  label: string;
  flag: string;
  center: { lat: number; lng: number };
  solarApiCoverage: "real" | "vision";
}

export const COUNTRIES: CountryProfile[] = [
  { code: "VN", label: "Vietnam", flag: "🇻🇳", center: { lat: 21.0278, lng: 105.8342 }, solarApiCoverage: "vision" },
  { code: "SG", label: "Singapore", flag: "🇸🇬", center: { lat: 1.2830, lng: 103.8607 }, solarApiCoverage: "real" },
  { code: "PH", label: "Philippines", flag: "🇵🇭", center: { lat: 14.5995, lng: 120.9842 }, solarApiCoverage: "real" },
  { code: "TH", label: "Thailand", flag: "🇹🇭", center: { lat: 13.7563, lng: 100.5018 }, solarApiCoverage: "real" },
  { code: "ID", label: "Indonesia", flag: "🇮🇩", center: { lat: -6.2088, lng: 106.8456 }, solarApiCoverage: "vision" },
  { code: "MY", label: "Malaysia", flag: "🇲🇾", center: { lat: 3.1390, lng: 101.6869 }, solarApiCoverage: "vision" },
];
