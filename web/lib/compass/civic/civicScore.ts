// Civilian feedback lookup — the "ask the public what they think" layer.
//
// A frozen RAG store (data/civilian_feedback.json, built by
// ingest/build_civilian_feedback.py from the cleaned Reddit scrape) is queried
// whenever the planner designs/accepts an intervention. Each capability maps to
// the discourse topic(s) it touches; we return a blended civic score (0-100)
// and a couple of real resident quotes.
//
// Honesty: this is a Reddit *discourse* proxy, not representative polling — the
// UI must always show that label. Retrieval is fully offline/frozen.

import feedback from "@/data/civilian_feedback.json";

export type CivicCity = "singapore" | "hanoi" | "bangkok";

export interface CivicQuote {
  text: string;
  sentiment: string;
  score: number;
  source: string;
}

export interface CivicResult {
  civicScore: number; // 0-100, weighted across matched topics
  topics: string[]; // discourse topics this intervention touched
  nPosts: number;
  nComments: number;
  quotes: CivicQuote[];
  label: string; // the mandatory proxy caveat
  sentimentWord: "supportive" | "mixed" | "opposed";
}

// Which discourse topic(s) each sandbox capability speaks to.
const CAPABILITY_TOPICS: Record<string, string[]> = {
  allows_cycling: ["active_mobility"],
  walk_link: ["active_mobility"],
  adds_shade: ["heat_weather", "active_mobility"],
  rain_protection: ["heat_weather", "active_mobility"],
  restricts_cars: ["policy_prices", "active_mobility"],
  faster_cycle: ["active_mobility"],
  better_bus: ["public_transport"],
  solar_canopy: ["ev_energy", "climate_environment"],
  ev_charging: ["ev_energy"],
  battery: ["ev_energy"],
};

const DATA = feedback as unknown as {
  _meta: { label: string };
  cities: Record<string, Record<string, {
    civicScore: number; avgSentiment: number; supportRatio: number;
    nPosts: number; nComments: number; quotes: CivicQuote[];
  }>>;
};

function sentimentWord(score: number): CivicResult["sentimentWord"] {
  if (score >= 66) return "supportive";
  if (score >= 45) return "mixed";
  return "opposed";
}

/** Look up public sentiment for a set of capabilities in a city. */
export function civicFor(capabilityIds: string[], city: CivicCity = "singapore"): CivicResult | null {
  const cityData = DATA.cities[city];
  if (!cityData) return null;

  const topics = [...new Set(capabilityIds.flatMap((id) => CAPABILITY_TOPICS[id] ?? []))];
  if (topics.length === 0) return null;

  // Weight each topic's score by its sample size (nPosts) so a well-discussed
  // topic dominates a barely-mentioned one; pool quotes across matched topics.
  let wsum = 0, wtot = 0, nPosts = 0, nComments = 0;
  const quotes: CivicQuote[] = [];
  const matched: string[] = [];
  for (const t of topics) {
    const d = cityData[t];
    if (!d) continue;
    matched.push(t);
    const w = Math.max(1, d.nPosts);
    wsum += d.civicScore * w;
    wtot += w;
    nPosts += d.nPosts;
    nComments += d.nComments;
    quotes.push(...d.quotes);
  }
  if (wtot === 0) return null;

  const civicScore = Math.round(wsum / wtot);
  quotes.sort((a, b) => b.score - a.score);

  return {
    civicScore,
    topics: matched,
    nPosts,
    nComments,
    quotes: quotes.slice(0, 3),
    label: DATA._meta.label,
    sentimentWord: sentimentWord(civicScore),
  };
}

/** Given a built WorldModifier, infer its capabilities from effects for lookup.
 *  (Optimizer/EV-site modifiers carry effects, not capability ids.) */
export function civicForModifierEffects(
  effects: Record<string, unknown>,
  city: CivicCity = "singapore"
): CivicResult | null {
  const caps: string[] = [];
  if (effects.cycleMaxKmExtension || (effects.safetyDelta as any)?.cycle) caps.push("allows_cycling");
  if ((effects.comfortDelta as any)?.walk) caps.push("walk_link");
  if (effects.shadeDelta) caps.push("adds_shade");
  if (effects.rainProtectionDelta) caps.push("rain_protection");
  if (effects.carTimePenaltyMin) caps.push("restricts_cars");
  if (effects.busWaitDeltaMin) caps.push("better_bus");
  if (effects.solarAnnualKWhDelta) caps.push("solar_canopy");
  if (effects.chargingCapacityKWDelta) caps.push("ev_charging");
  if (effects.batteryCapacityKWhDelta) caps.push("battery");
  return caps.length ? civicFor(caps, city) : null;
}
