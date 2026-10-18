// Server-only: the synthetic population (ingest/sg_population.py) + stratified sampling
// for persona panels. Residents are sampled from GHS 2025 marginals — not real people.

import { promises as fs } from "fs";
import path from "path";

export interface Resident {
  id: string;
  area: string;
  subzone: string;
  age: number;
  sex: "M" | "F";
  dwelling: string;
  hh_income: string;
  commute: string | null; // null = not working / student / retired
  weight: number;
}

const cache = new Map<string, Resident[]>();

export async function loadPopulation(areaId: string): Promise<Resident[]> {
  if (!/^[a-z0-9_]+$/.test(areaId)) throw new Error("bad area id");
  const hit = cache.get(areaId);
  if (hit) return hit;
  const raw = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "sg", "population", `${areaId}.json`), "utf-8"));
  const out: Resident[] = raw.age.map((age: number, i: number) => ({
    id: `${raw.area.slice(0, 3).toUpperCase()}-${String(i).padStart(4, "0")}`,
    area: raw.area,
    subzone: raw.subzone[i],
    age,
    sex: raw.sex[i],
    dwelling: raw.dwelling[i],
    hh_income: raw.hh_income[i],
    commute: raw.commute[i],
    weight: raw.weight,
  }));
  cache.set(areaId, out);
  return out;
}

/** Deterministic PRNG so the same request gives the same panel. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export const AGE_GROUP = (a: number) => (a < 18 ? "under 18" : a < 35 ? "18–34" : a < 50 ? "35–49" : a < 65 ? "50–64" : "65+");
export const DRIVES = (r: Resident) => r.commute === "car" || r.commute === "taxi/PHV" || r.commute === "motorcycle";

/**
 * Stratified sample: spread across age groups and car / non-car commuters so a small
 * panel still hears from seniors, drivers and transit users. Adults only.
 */
export function stratifiedSample(pop: Resident[], n: number, seed = 1, filter?: (r: Resident) => boolean): Resident[] {
  const rand = rng(seed);
  const pool = pop.filter((r) => r.age >= 18 && (!filter || filter(r)));
  const strata = new Map<string, Resident[]>();
  for (const r of pool) {
    const k = `${AGE_GROUP(r.age)}|${DRIVES(r) ? "drive" : r.commute ? "transit" : "none"}`;
    (strata.get(k) ?? strata.set(k, []).get(k)!).push(r);
  }
  // Shuffle strata order by seed so small panels mix ages and commute types.
  const keys = [...strata.keys()].sort().map((k) => ({ k, r: rand() })).sort((a, b) => a.r - b.r).map((x) => x.k);
  const out: Resident[] = [];
  let round = 0;
  while (out.length < n && round < 50) {
    for (const k of keys) {
      const list = strata.get(k)!;
      if (list.length > round) {
        out.push(list[Math.floor(rand() * list.length)]);
        if (out.length >= n) break;
      }
    }
    round++;
  }
  return out;
}

export function describe(r: Resident): string {
  const work = r.commute ? `commutes to work by ${r.commute}` : r.age >= 65 ? "retired or not working" : "not in paid work";
  return `${r.age}-year-old ${r.sex === "M" ? "man" : "woman"} in ${r.subzone}, lives in a ${r.dwelling} home, household income ${r.hh_income} a month, ${work}`;
}
