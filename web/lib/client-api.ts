import type { SolarData, DemoListItem, ContextData } from "../types";

// NOTE: the Maps key still needs to be loaded by the in-browser Maps JS
// bootstrap, so it must be in the page. Restrict the key by HTTP referrer
// in Google Cloud Console (this is config, not code).
export const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "";

export async function fetchSolar(
  lat: number,
  lng: number,
  address?: string
): Promise<SolarData> {
  const url = new URL("/api/solar", window.location.origin);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lng", String(lng));
  if (address) url.searchParams.set("address", address);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`solar: ${r.status}`);
  return r.json();
}

export async function fetchDemoList(country?: string): Promise<DemoListItem[]> {
  const url = new URL("/api/demo", window.location.origin);
  if (country) url.searchParams.set("country", country);
  const r = await fetch(url);
  if (!r.ok) return [];
  const data = await r.json();
  return data.buildings ?? [];
}

export async function fetchDemo(slug: string): Promise<SolarData> {
  const r = await fetch(`/api/demo/${slug}`);
  if (!r.ok) throw new Error(`demo: ${r.status}`);
  return r.json();
}

export interface RenderPairResult {
  before: string;
  after: string;
  imagery_source: "solar_rgb" | "static_maps";
}

export async function renderPair(opts: {
  lat: number;
  lng: number;
  address?: string;
  country_code?: string;
}): Promise<RenderPairResult> {
  const r = await fetch("/api/render_pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!r.ok) throw new Error(`render_pair: ${r.status}`);
  const data = await r.json();
  return {
    before: `data:image/png;base64,${data.before}`,
    after: `data:image/png;base64,${data.after}`,
    imagery_source: data.imagery_source,
  };
}

export async function fetchSolarManual(opts: {
  lat: number;
  lng: number;
  roof_area_m2: number;
  roof_type: string;
  address?: string;
  country_code?: string;
}): Promise<SolarData> {
  const r = await fetch("/api/solar/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!r.ok) throw new Error(`manual: ${r.status}`);
  return r.json();
}

export async function fetchContext(
  lat: number,
  lng: number,
  address?: string
): Promise<ContextData> {
  const url = new URL("/api/context", window.location.origin);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lng", String(lng));
  if (address) url.searchParams.set("address", address);
  const r = await fetch(url);
  if (!r.ok) {
    return { elevation: null, timezone: null, air_quality: null, weather: null, aerial_view: null };
  }
  return r.json();
}

export function streetViewUrl(lat: number, lng: number, size = "640x320"): string {
  const url = new URL("/api/streetview", window.location.origin);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lng", String(lng));
  url.searchParams.set("size", size);
  return url.toString();
}

export async function fetchDemoRenders(slug: string): Promise<{ before: string | null; after: string | null }> {
  const r = await fetch(`/api/demo/${slug}/renders`);
  if (!r.ok) return { before: null, after: null };
  return r.json();
}

/**
 * Stream a proposal. If `slug` is provided and a cached markdown exists
 * for that demo, we stream the cached version with typewriter pacing —
 * looks identical to a live stream but is instant and can't fail mid-way.
 * Falls back to live Gemini for arbitrary clicks.
 */
export async function streamProposal(opts: {
  slug?: string;
  solar?: SolarData;
  onToken: (t: string) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { slug, solar, onToken, signal } = opts;

  let response: Response;
  if (slug) {
    response = await fetch(`/api/demo/${slug}/proposal`, { signal });
    if (response.status === 404) {
      response = await fetch("/api/proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ solar, audience: "building_owner" }),
        signal,
      });
    }
  } else {
    response = await fetch("/api/proposal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ solar, audience: "building_owner" }),
      signal,
    });
  }
  if (!response.body) throw new Error("no body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") return;
      try {
        const obj = JSON.parse(payload);
        if (obj.text) onToken(obj.text);
      } catch {
        /* ignore */
      }
    }
  }
}
