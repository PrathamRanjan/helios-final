import sharp from "sharp";

const SOLAR_BASE = "https://solar.googleapis.com/v1";

export interface RoofSegment {
  pitch_deg: number;
  azimuth_deg: number;
  area_m2: number;
  sunshine_kwh_m2_yr: number;
}

export interface BuildingInsightsSummary {
  panels: number;
  yearly_kwh: number;
  panel_capacity_watts: number;
  panel_height_m: number;
  panel_width_m: number;
  panel_area_m2: number;
  kwp: number;
  max_sunshine_hours_per_year: number;
  max_array_area_m2: number;
  whole_roof_area_m2: number;
  carbon_offset_factor_kg_per_mwh: number | null;
  roof_segment_count: number;
  roof_segments: RoofSegment[];
  best_segment: RoofSegment | null;
  imagery_date: string | null;
  imagery_quality: string;
  imagery_processed_date: string | null;
  center: { lat: number | null; lng: number | null };
}

function dateStr(d: any): string | null {
  if (!d?.year) return null;
  const y = d.year, m = d.month ?? 1, day = d.day ?? 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export async function buildingInsights(
  lat: number,
  lng: number,
  key: string
): Promise<any | null> {
  const url = `${SOLAR_BASE}/buildingInsights:findClosest`;
  for (const quality of ["HIGH", "MEDIUM", "LOW"]) {
    const params = new URLSearchParams({
      "location.latitude": String(lat),
      "location.longitude": String(lng),
      requiredQuality: quality,
      key,
    });
    const res = await fetch(`${url}?${params}`, { cache: "no-store" });
    if (res.ok) return await res.json();
    if (res.status !== 404) return null;
  }
  return null;
}

export async function dataLayers(
  lat: number,
  lng: number,
  key: string,
  radiusM = 50
): Promise<any | null> {
  const url = `${SOLAR_BASE}/dataLayers:get`;
  const params = new URLSearchParams({
    "location.latitude": String(lat),
    "location.longitude": String(lng),
    radiusMeters: String(radiusM),
    view: "FULL_LAYERS",
    requiredQuality: "LOW",
    key,
  });
  const res = await fetch(`${url}?${params}`, { cache: "no-store" });
  if (!res.ok) return null;
  return await res.json();
}

export async function fetchGeotiffAsPng(
  tiffUrl: string,
  key: string,
  maxSide = 768
): Promise<Buffer | null> {
  try {
    const res = await fetch(`${tiffUrl}&key=${key}`, { cache: "no-store" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const img = sharp(buf, { failOn: "none" });
    const meta = await img.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const longest = Math.max(w, h);
    const out = await (longest > maxSide ? img.resize(maxSide, maxSide, { fit: "inside" }) : img)
      .png()
      .toBuffer();
    return out;
  } catch {
    return null;
  }
}

export function summarizeBuildingInsights(bi: any): BuildingInsightsSummary {
  const sp = bi.solarPotential ?? {};
  const configs: any[] = sp.solarPanelConfigs ?? [];
  const bestCfg = configs.length > 0 ? configs[configs.length - 1] : {};

  const segsRaw: any[] = sp.roofSegmentStats ?? [];
  const segments: RoofSegment[] = segsRaw.map((s) => ({
    pitch_deg: Math.round((s.pitchDegrees ?? 0) * 10) / 10,
    azimuth_deg: Math.round((s.azimuthDegrees ?? 0) * 10) / 10,
    area_m2: Math.round(s.stats?.areaMeters2 ?? 0),
    sunshine_kwh_m2_yr:
      (s.stats?.sunshineQuantiles ?? []).length >= 6
        ? Math.round(s.stats.sunshineQuantiles[5])
        : 0,
  }));
  segments.sort((a, b) => b.area_m2 - a.area_m2);

  const panels = bestCfg.panelsCount ?? sp.maxArrayPanelsCount ?? 0;
  const yearlyKwh = bestCfg.yearlyEnergyDcKwh ?? 0;
  const panelW = sp.panelCapacityWatts ?? 400;
  const panelH = sp.panelHeightMeters ?? 1.65;
  const panelWi = sp.panelWidthMeters ?? 0.99;

  return {
    panels: Math.round(panels),
    yearly_kwh: Math.round(yearlyKwh),
    panel_capacity_watts: panelW,
    panel_height_m: panelH,
    panel_width_m: panelWi,
    panel_area_m2: Math.round(panelH * panelWi * 100) / 100,
    kwp: Math.round((panels * panelW) / 100) / 10,
    max_sunshine_hours_per_year: Math.round(sp.maxSunshineHoursPerYear ?? 0),
    max_array_area_m2: Math.round(sp.maxArrayAreaMeters2 ?? 0),
    whole_roof_area_m2: Math.round(sp.wholeRoofStats?.areaMeters2 ?? 0),
    carbon_offset_factor_kg_per_mwh: sp.carbonOffsetFactorKgPerMwh ?? null,
    roof_segment_count: segments.length,
    roof_segments: segments.slice(0, 6),
    best_segment: segments[0] ?? null,
    imagery_date: dateStr(bi.imageryDate),
    imagery_quality: bi.imageryQuality ?? "UNKNOWN",
    imagery_processed_date: dateStr(bi.imageryProcessedDate),
    center: {
      lat: bi.center?.latitude ?? null,
      lng: bi.center?.longitude ?? null,
    },
  };
}
