// Browser-side fetch helpers for the Compass UI.

export interface ClientNode {
  code: string;
  type: "BUS" | "TRAIN";
  name: string;
  road: string;
  lat: number;
  lng: number;
  volume: number;
  peak_hour_in: number;
  hourly_weekday: { tap_in: number[]; tap_out: number[] };
}

export interface ClientFlow {
  o: string;
  d: string;
  trips: number;
  dist_km: number;
  mode: string;
  from: { lat: number; lng: number; name: string };
  to: { lat: number; lng: number; name: string };
}

export interface ClientBuilding {
  id: string;
  name: string;
  lat: number;
  lng: number;
  solar: { available: boolean; kwp?: number; annual_kwh?: number };
}

export interface DistrictSummary {
  district: string;
  district_id: string;
  bbox: [number, number, number, number];
  pv_month: string;
  source: string;
  center: { lat: number; lng: number };
  nodes: ClientNode[];
  flows: ClientFlow[];
  buildings: ClientBuilding[];
}

export interface RankedItem {
  id: string;
  intervention: string;
  type: "solar" | "mobility";
  co2_avoided_tpy: number;
  capex_usd: number;
  cost_per_tonne_usd: number;
  detail: Record<string, any>;
}

export interface Ranking {
  district: string;
  district_id: string;
  pv_month: string;
  baseline_co2_tpy: number;
  ranked: RankedItem[];
  sources: string;
  cached?: boolean;
}

export async function fetchDistrict(id = "jurong_east"): Promise<DistrictSummary> {
  const r = await fetch(`/api/district/${id}`);
  if (!r.ok) throw new Error(`district: ${r.status}`);
  return r.json();
}

export async function fetchRanking(
  sortBy: "cost_per_tonne" | "co2" = "cost_per_tonne",
  districtId = "jurong_east"
): Promise<Ranking> {
  const r = await fetch("/api/compass/rank", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ district_id: districtId, sort_by: sortBy }),
  });
  if (!r.ok) throw new Error(`rank: ${r.status}`);
  return r.json();
}

export async function fetchSolarInsight(buildingId: string, withStorage = false) {
  const r = await fetch("/api/solar/insight", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ building_id: buildingId, with_storage: withStorage }),
  });
  if (!r.ok) throw new Error(`solar insight: ${r.status}`);
  return r.json();
}

export async function streamMemo(opts: {
  ranking: Ranking;
  onToken: (t: string) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { ranking, onToken, signal } = opts;
  const response = await fetch("/api/compass/memo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ranking }),
    signal,
  });
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
