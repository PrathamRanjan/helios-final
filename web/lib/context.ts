// Context APIs: Elevation, TimeZone, Air Quality, Weather, Aerial View, Street View

export async function elevation(lat: number, lng: number, key: string) {
  const url = "https://maps.googleapis.com/maps/api/elevation/json";
  const res = await fetch(`${url}?locations=${lat},${lng}&key=${key}`, {
    signal: AbortSignal.timeout(15000), cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== "OK" || !data.results?.length) return null;
  const r = data.results[0];
  return {
    elevation_m: Math.round(r.elevation * 10) / 10,
    resolution_m: Math.round((r.resolution ?? 0) * 10) / 10,
  };
}

function formatSolarNoon(lng: number, utcOffsetH: number): string {
  const tzMeridian = utcOffsetH * 15;
  const deltaH = (tzMeridian - lng) / 15;
  let noonH = 12 + deltaH;
  let h = Math.floor(noonH);
  let m = Math.round((noonH - h) * 60);
  if (m === 60) { h += 1; m = 0; }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export async function timezone(lat: number, lng: number, key: string) {
  const url = "https://maps.googleapis.com/maps/api/timezone/json";
  const ts = Math.floor(Date.now() / 1000);
  const res = await fetch(
    `${url}?location=${lat},${lng}&timestamp=${ts}&key=${key}`,
    { signal: AbortSignal.timeout(15000), cache: "no-store" }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== "OK") return null;
  const rawOffsetH = (data.rawOffset ?? 0) / 3600;
  return {
    time_zone_id: data.timeZoneId,
    time_zone_name: data.timeZoneName,
    utc_offset_hours: rawOffsetH,
    dst_offset_hours: (data.dstOffset ?? 0) / 3600,
    solar_noon_local: formatSolarNoon(lng, rawOffsetH),
  };
}

export async function airQuality(lat: number, lng: number, key: string) {
  const url = "https://airquality.googleapis.com/v1/currentConditions:lookup";
  const res = await fetch(`${url}?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location: { latitude: lat, longitude: lng } }),
    signal: AbortSignal.timeout(15000), cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json();
  const indexes = data.indexes ?? [];
  if (!indexes.length) return null;
  const uaqi = indexes.find((i: any) => i.code === "uaqi") ?? indexes[0];
  return {
    aqi: uaqi.aqi,
    category: uaqi.category,
    dominant_pollutant: uaqi.dominantPollutant,
    region_code: data.regionCode,
  };
}

export async function weather(lat: number, lng: number, key: string) {
  const url = "https://weather.googleapis.com/v1/currentConditions:lookup";
  const params = new URLSearchParams({
    key,
    "location.latitude": String(lat),
    "location.longitude": String(lng),
  });
  const res = await fetch(`${url}?${params}`, { signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  const cond = data.weatherCondition ?? {};
  const temp = data.temperature ?? {};
  const feels = data.feelsLikeTemperature ?? {};
  return {
    description: cond.description?.text ?? null,
    type: cond.type,
    icon_uri: cond.iconBaseUri,
    temp_c: temp.degrees ?? null,
    feels_like_c: feels.degrees ?? null,
    cloud_cover_pct: data.cloudCover ?? null,
    is_daytime: data.isDaytime ?? null,
  };
}

export async function aerialLookup(
  _lat: number,
  _lng: number,
  key: string,
  address?: string
) {
  if (!address) return null;
  const url = "https://aerialview.googleapis.com/v1/videos:lookupVideo";
  const params = new URLSearchParams({ key, address });
  const res = await fetch(`${url}?${params}`, { signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  const uris = data.uris ?? {};
  const mp4 = uris.MP4_MEDIUM ?? uris.MP4_LOW ?? uris.MP4_HIGH;
  const img = uris.IMAGE ?? {};
  if (!mp4) return null;
  return {
    state: data.state,
    video_landscape: mp4.landscapeUri,
    video_portrait: mp4.portraitUri,
    thumb_landscape: img.landscapeUri,
    thumb_portrait: img.portraitUri,
  };
}

export async function gatherContext(
  lat: number,
  lng: number,
  mapsKey: string,
  address?: string
) {
  const [elev, tz, aqi, wx, aerial] = await Promise.all([
    elevation(lat, lng, mapsKey).catch(() => null),
    timezone(lat, lng, mapsKey).catch(() => null),
    airQuality(lat, lng, mapsKey).catch(() => null),
    weather(lat, lng, mapsKey).catch(() => null),
    aerialLookup(lat, lng, mapsKey, address).catch(() => null),
  ]);
  return {
    elevation: elev,
    timezone: tz,
    air_quality: aqi,
    weather: wx,
    aerial_view: aerial,
  };
}

export async function streetViewBytes(
  lat: number,
  lng: number,
  key: string,
  size = "640x400",
  outdoor = false
): Promise<Buffer | null> {
  const params = new URLSearchParams({
    location: `${lat},${lng}`,
    ...(outdoor ? { source: "outdoor", radius: "100", return_error_code: "true" } : {}),
    size,
    fov: "80",
    pitch: "10",
    key,
  });
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/streetview?${params}`,
    { signal: AbortSignal.timeout(15000), cache: "no-store" }
  );
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) return null;
  return buf;
}
