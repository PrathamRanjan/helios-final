// Nature + physical-risk screening (TNFD "Locate") for one building. Thresholds and
// their sources live in data/nature/screening.json; this file only applies them.

import screening from "@/data/nature/screening.json";

export type Level = "high" | "elevated" | "low" | "unknown";
export type Group = "nature" | "flood" | "heat";

export interface NatureValues {
  d_protected: number;
  d_nature: number;
  d_habitat: number;
  d_water: number;
  d_flood: number;
  veg_100m: number;
  ground_m: number | null;
  land_use: string | null;
}

export interface ScreenTest {
  id: string;
  group: Group;
  label: string;
  metric: keyof NatureValues;
  op: "<=" | "<";
  value: number;
  level: "high" | "elevated";
  basis: "cited" | "method";
  source: string;
  url?: string;
}

export interface ScreenHit extends ScreenTest {
  actual: number;
}

export const TESTS = screening.tests as ScreenTest[];
export const CAVEATS = screening.caveats as string[];
export const FRAMEWORK = screening.framework;

export function screen(v: NatureValues): { groups: Record<Group, Level>; hits: ScreenHit[] } {
  const hits: ScreenHit[] = [];
  const groups: Record<Group, Level> = { nature: "low", flood: "low", heat: "low" };
  for (const t of TESTS) {
    const a = v[t.metric];
    if (typeof a !== "number") {
      if (groups[t.group] === "low") groups[t.group] = "unknown";
      continue;
    }
    const hit = t.op === "<=" ? a <= t.value : a < t.value;
    if (!hit) continue;
    hits.push({ ...t, actual: a });
    if (t.level === "high" || groups[t.group] !== "high") groups[t.group] = t.level;
  }
  // Keep only the strongest hit per group+metric (e.g. "inside" beats "within 500 m").
  const best = new Map<string, ScreenHit>();
  for (const h of hits) {
    const k = `${h.group}|${h.metric}`;
    const cur = best.get(k);
    if (!cur || (h.level === "high" && cur.level !== "high")) best.set(k, h);
  }
  return { groups, hits: [...best.values()] };
}

export const LEVEL_TONE: Record<Level, string> = {
  high: "text-risk-300 border-risk-400/40 bg-risk-400/[0.08]",
  elevated: "text-warn-300 border-warn-400/40 bg-warn-400/[0.08]",
  low: "text-signal-300 border-signal-400/30 bg-signal-400/[0.06]",
  unknown: "text-white/50 border-line bg-white/[0.03]",
};
