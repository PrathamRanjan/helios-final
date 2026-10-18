import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { loadBaselineWorld } from "@/lib/compass/world/buildWorld";
import { simulateTimeline } from "@/lib/compass/world/simulateTimeline";
import { suggestModifiers, type OptimizeResult } from "@/lib/compass/optimizer/suggestModifiers";
import { badgesForModifier, carbonValue } from "@/lib/compass/compliance/policy";
import { convertFromUsd } from "@/lib/compass/finance/currency";
import { AREAS, areaById } from "@/lib/compass/areas";
import type { Shock, WorldModifier } from "@/lib/compass/world/types";
import type { DistrictBuilding } from "@/lib/compass/compliance/facts";

export const runtime = "nodejs";
export const maxDuration = 120;

// The tool surface the ADK agent team (engine/helios_engine/agents/studio.py) works through.
// Every number an agent states comes from one of these deterministic calls; the agents
// choose, sequence and explain — they never compute.

const START = 2026;
const END = 2036;
const SHOCKS = new Set(["heatwave", "heavy_rain", "oil_price_spike", "pandemic", "grid_carbon_spike", "mrt_loop_closure", "haze"]);
const sgd = (usd: number | null | undefined) => (usd == null ? null : Math.round(convertFromUsd(usd, "SGD")));

const candCache = new Map<string, OptimizeResult>();

function kindOf(id: string): string {
  if (id.startsWith("opt_shade")) return "shaded_walkway";
  if (id.startsWith("opt_cycle")) return "protected_cycle_link";
  if (id.startsWith("opt_bus")) return "bus_priority";
  if (id.startsWith("opt_solar")) return "solar_canopy";
  if (id.startsWith("opt_ev") || id.startsWith("mod_ev")) return "ev_charging_hub";
  return "other";
}

function needReady(area: string) {
  const a = areaById(area);
  if (!a) throw new Error(`Unknown area "${area}". Call list_areas for valid ids.`);
  if (a.simulation !== "ready") throw new Error(`${a.name} has no simulation (no transit corridors or residents).`);
  return a;
}

async function candidates(area: string): Promise<OptimizeResult> {
  const hit = candCache.get(area);
  if (hit) return hit;
  needReady(area);
  const world = await loadBaselineWorld(area, START);
  let evSites: any[] = [];
  if (area === "jurong_east") {
    try {
      evSites = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "ev_candidate_sites.json"), "utf-8")).sites ?? [];
    } catch {}
  }
  const r = suggestModifiers(world, { budgetUsd: 2_000_000, startYear: START, endYear: END, pathway: "target_achieved", shocks: [], evSites, existingModifierIds: [] });
  candCache.set(area, r);
  return r;
}

async function resolve(area: string, ids: string[]): Promise<WorldModifier[]> {
  const c = await candidates(area);
  const out: WorldModifier[] = [];
  for (const id of ids) {
    const s = c.suggestions.find((x) => x.modifier.id === id);
    if (!s) throw new Error(`Unknown change id "${id}" for ${area}. Call list_candidate_changes first.`);
    out.push(s.modifier);
  }
  return out;
}

function cleanShocks(raw: unknown): Shock[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s: any) => s && SHOCKS.has(s.type) && Number.isFinite(s.startYear)) as Shock[];
}

function midpoint(m: WorldModifier): [number, number] {
  const g = m.geometry as any;
  if (g.type === "Point") return g.coordinates;
  const pts: [number, number][] = g.type === "LineString" ? g.coordinates : g.coordinates[0];
  const s = pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
  return [s[0] / pts.length, s[1] / pts.length];
}

/** Internal API call with one retry (a cold route can drop the first request while its data loads). */
async function internal(url: string): Promise<any> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60000) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      return d;
    } catch (e) {
      if (i >= 1) throw e;
    }
  }
}

async function bcaBuildings(origin: string, area: string): Promise<DistrictBuilding[]> {
  const r = await fetch(`${origin}/api/sg/buildings?area=${area}`, { cache: "no-store" });
  return r.ok ? (await r.json()).buildings ?? [] : [];
}

async function run(tool: string, a: any, origin: string) {
  switch (tool) {
    case "list_areas":
      return {
        areas: AREAS.filter((x) => x.simulation === "ready").map((x) => ({ id: x.id, name: x.name, region: x.region, residents: x.population })),
        note: "Only areas with a calibrated transit simulation are listed.",
      };

    case "area_profile": {
      const ar = needReady(a.area);
      const nat = await internal(`${origin}/api/sg/nature?area=${ar.id}`);
      const s = nat?.summary;
      return {
        area: ar.name,
        residents: ar.population,
        car_share_to_work: ar.car_share,
        transit_share_to_work: ar.pt_share,
        seniors_65_plus_share: ar.share_65_plus,
        hdb_share: ar.share_hdb,
        tree_cover: s?.tree_cover,
        buildings_below_4m_ground: s?.bld_ground_below_4m,
        pub_flood_prone_spots: s?.flood_spots?.map((f: any) => f.location ?? f),
        threatened_species_recorded: s?.gbif?.threatened_species,
        source: "SingStat GHS 2025; URA/NParks/PUB/ESA/GBIF via HELIOS nature layer",
      };
    }

    case "list_candidate_changes": {
      const c = await candidates(a.area);
      let list = c.suggestions.map((s) => ({
        id: s.modifier.id,
        kind: kindOf(s.modifier.id),
        label: s.modifier.label,
        capex_sgd: sgd(s.modifier.economics.capexUsd),
        why: s.reason,
        alone_co2_avoided_t_10y: Math.round(s.aloneAvoidedT),
        alone_cost_per_tonne_sgd: sgd(s.aloneCostPerTonneUsd),
        alone_heat_reduced_pct: Math.round(s.aloneHeatReducedPct * 10) / 10,
      }));
      if (a.kind) list = list.filter((x) => x.kind === a.kind);
      return { area: needReady(a.area).name, candidates: list, kinds: ["shaded_walkway", "protected_cycle_link", "bus_priority", "solar_canopy", "ev_charging_hub"], note: "Each candidate was already simulated alone on this area's measured corridors (2026–2036)." };
    }

    case "simulate_plan": {
      needReady(a.area);
      const mods = await resolve(a.area, a.change_ids ?? []);
      const shocks = cleanShocks(a.shocks);
      const world = await loadBaselineWorld(a.area, START);
      const r = simulateTimeline(world, mods, START, END, "target_achieved", shocks);
      const s = r.summary;
      const cv = carbonValue(r);
      return {
        changes: mods.map((m) => m.label),
        shocks: shocks.map((x) => x.type),
        co2_avoided_t_2026_2036: Math.round(s.cumulativeCO2AvoidedTonnes),
        co2_band_t: [Math.round(s.cumulativeCO2AvoidedLow), Math.round(s.cumulativeCO2AvoidedHigh)],
        capex_sgd: sgd(s.capexUsd),
        cost_per_tonne_sgd: sgd(s.costPerTonneUsd),
        net_cost_per_tonne_sgd_by_carbon_price: Object.fromEntries(cv.map((x) => [x.scenario, x.netCostPerTonneSgd == null ? null : Math.round(x.netCostPerTonneSgd)])),
        heat_exposure_reduced_pct: Math.round(s.heatExposureReducedPct * 10) / 10,
        trips_shifted_off_car_per_day: s.tripsShiftedPerDay,
        mode_share_change_pp: Object.fromEntries(Object.entries(s.modeShareChange).map(([k, v]) => [k, Math.round((v as number) * 1000) / 10])),
        embodied_co2_t: Math.round(s.embodiedCO2Tonnes),
        carbon_payback_year: s.carbonPaybackYear,
        benefit_cost_ratio: s.benefitCostRatio == null ? null : Math.round(s.benefitCostRatio * 100) / 100,
        equity: s.equity?.label,
        method: "Calibrated nested-logit agents on LTA fare-card corridors (Sep 2026); Green Plan pathway; deterministic.",
      };
    }

    case "check_compliance": {
      needReady(a.area);
      const mods = await resolve(a.area, a.change_ids ?? []);
      const asOf = new Date().toISOString().slice(0, 10);
      const bca = await bcaBuildings(origin, a.area);
      return {
        as_of: asOf,
        changes: mods.map((m) => {
          const [lng, lat] = midpoint(m);
          let host: DistrictBuilding | null = null;
          let best = 80;
          for (const b of bca) {
            if (b.lat == null || b.lng == null) continue;
            const d = Math.hypot((b.lng - lng) * 111320 * Math.cos((lat * Math.PI) / 180), (b.lat - lat) * 111320);
            if (d < best) {
              best = d;
              host = b;
            }
          }
          return { change: m.label, badges: badgesForModifier(m, { asOf, host: m.effects.solarAnnualKWhDelta ? host : null }).map((b) => ({ rule: b.ruleId, result: b.label, why: b.detail })) };
        }),
        carbon_price_sgd_per_t: { law_2026: 45, law_2030: 45, proposed_2030_range: [50, 80] },
        note: "Deterministic rules with clause citations (data/compliance/rules). Policy-alignment indicator, not legal advice.",
      };
    }

    case "screen_sites": {
      needReady(a.area);
      const mods = await resolve(a.area, a.change_ids ?? []);
      const out = [];
      for (const m of mods) {
        const [lng, lat] = midpoint(m);
        const r = await internal(`${origin}/api/sg/nature?lng=${lng}&lat=${lat}`);
        out.push({ change: m.label, nature: r.groups?.nature, flood: r.groups?.flood, heat: r.groups?.heat, flags: (r.hits ?? []).map((h: any) => `${h.label} (${h.basis === "cited" ? "regulatory threshold" : "screening threshold"})`), ground_m: r.values?.ground_m, greenery_100m_pct: r.values?.veg_100m });
      }
      return { sites: out, source: "URA MP2025 nature areas, NParks habitats, Copernicus DEM, PUB flood list, ESA WorldCover" };
    }

    case "air_quality": {
      const r = await fetch(`${origin}/api/air?city=${encodeURIComponent(a.city ?? "singapore")}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `air feed HTTP ${r.status}`);
      return d;
    }

    case "get_modifiers": {
      const mods = await resolve(a.area, a.change_ids ?? []);
      return { modifiers: mods };
    }

    default:
      throw new Error(`Unknown tool "${tool}"`);
  }
}

/** POST /api/studio/tools  { tool, args } */
export async function POST(req: NextRequest) {
  const { tool, args } = await req.json().catch(() => ({}));
  const t0 = Date.now();
  try {
    const result = await run(String(tool), args ?? {}, process.env.HELIOS_INTERNAL_APP_URL || req.nextUrl.origin);
    return NextResponse.json({ ok: true, tool, ms: Date.now() - t0, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, tool, error: e?.message ?? String(e) }, { status: 400 });
  }
}
