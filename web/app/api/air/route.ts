import { NextRequest, NextResponse } from "next/server";
import { psiBand, psiToPm25 } from "@/lib/compass/air/haze";
import { indiaCityBySlug } from "@/lib/india/cities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Live air quality, keyless, for the three demo geographies:
//   singapore  NEA via data.gov.sg real-time API (24-h PSI by region + 1-h PM2.5)
//   bangkok    Open-Meteo air-quality API (CAMS model) — Air4Thai's server has a broken TLS chain
//   <india>    Open-Meteo air-quality API (CAMS model, not a station) at the city centre
// No fallbacks: if the agency feed fails, the caller gets the error.

type Air = {
  city: string;
  source: string;
  sourceUrl: string;
  kind: "station" | "model";
  updated: string;
  pm25: number;
  psi?: number;
  aqi?: number;
  band: string;
  regions?: { name: string; psi?: number; pm25?: number }[];
};

const cache = new Map<string, { at: number; data: Air }>();
const TTL = 10 * 60 * 1000;

async function getJson(url: string) {
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000), headers: { "User-Agent": "HELIOS/2 (sustainability planning)" } });
  if (!r.ok) throw new Error(`${new URL(url).host} returned HTTP ${r.status}`);
  return r.json();
}

async function singapore(): Promise<Air> {
  const [psi, pm] = await Promise.all([getJson("https://api-open.data.gov.sg/v2/real-time/api/psi"), getJson("https://api-open.data.gov.sg/v2/real-time/api/pm25")]);
  const item = psi.data.items[0];
  const p24 = item.readings.psi_twenty_four_hourly as Record<string, number>;
  const pm1 = pm.data.items[0].readings.pm25_one_hourly as Record<string, number>;
  const regions = ["north", "south", "east", "west", "central"].map((r) => ({ name: r, psi: p24[r], pm25: pm1[r] }));
  const worst = Math.max(...regions.map((r) => r.psi ?? 0));
  return {
    city: "Singapore",
    source: "NEA (data.gov.sg real-time API)",
    sourceUrl: "https://www.haze.gov.sg/",
    kind: "station",
    updated: item.updatedTimestamp ?? item.timestamp,
    psi: worst,
    pm25: Math.round(psiToPm25(worst)),
    band: psiBand(worst),
    regions,
  };
}

// Air4Thai (Thai PCD) stations would be better, but its server omits the intermediate TLS
// certificate, so a verifying client can't reach it. Bangkok uses the same CAMS model as India.
async function bangkok(): Promise<Air> {
  return model("Bangkok", 13.7563, 100.5018, "Asia%2FBangkok", (pm25) => (pm25 <= 15 ? "Good" : pm25 <= 37.5 ? "Moderate" : pm25 <= 75 ? "Unhealthy" : "Very unhealthy"));
}

async function model(city: string, lat: number, lng: number, tz: string, band: (pm25: number) => string): Promise<Air> {
  const d = await getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=pm2_5,pm10,us_aqi&timezone=${tz}`);
  const pm25 = d.current.pm2_5 as number;
  return {
    city,
    source: "Open-Meteo air-quality API (Copernicus CAMS model)",
    sourceUrl: "https://open-meteo.com/en/docs/air-quality-api",
    kind: "model",
    updated: d.current.time,
    pm25: Math.round(pm25 * 10) / 10,
    aqi: d.current.us_aqi,
    band: band(pm25),
  };
}

async function india(slug: string): Promise<Air> {
  const c = indiaCityBySlug(slug);
  if (!c) throw new Error(`unknown city "${slug}"`);
  // India's National AQI PM2.5 bands (CPCB): 0–30 good, 31–60 satisfactory, 61–90 moderate, 91–120 poor, 121–250 very poor, >250 severe
  return model(c.name, c.center.lat, c.center.lng, "Asia%2FKolkata", (pm25) =>
    pm25 <= 30 ? "Good" : pm25 <= 60 ? "Satisfactory" : pm25 <= 90 ? "Moderate" : pm25 <= 120 ? "Poor" : pm25 <= 250 ? "Very poor" : "Severe"
  );
}

/** GET /api/air?city=singapore | bangkok | bengaluru | delhi-ncr | … */
export async function GET(req: NextRequest) {
  const city = (req.nextUrl.searchParams.get("city") || "singapore").toLowerCase();
  const hit = cache.get(city);
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json({ ...hit.data, cached: true });
  try {
    const data = city === "singapore" ? await singapore() : city === "bangkok" ? await bangkok() : await india(city);
    cache.set(city, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: `Live air-quality feed unavailable: ${e?.message ?? e}` }, { status: 502 });
  }
}
