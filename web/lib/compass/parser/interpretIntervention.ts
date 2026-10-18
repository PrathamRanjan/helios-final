// Open intervention parser — turn ANY free-text description into a simulable
// intervention. "A floating solar farm on the canal", "a shaded bike bridge
// with EV charging", "pedestrianise the high street" → a set of our effect
// primitives + a cost tier, which buildModifier() turns into a real WorldModifier.
//
// Two layers:
//   • ruleBasedInterpret() — deterministic keyword → capability mapping. Always
//     works, no API key, and serves as the honest fallback + Gemini's guardrail.
//   • (route) Gemini classification — richer semantic mapping, but its output is
//     VALIDATED against these same known capabilities so it can't hallucinate a
//     primitive we don't model.
//
// Honesty: the result always exposes WHICH primitives we mapped the text to and
// a confidence label, so an over/under-read is visible, never silent.

import { CAPABILITIES } from "../flow/scenario";

export type CapabilityId = (typeof CAPABILITIES)[number]["id"];
export type CostTier = "low" | "med" | "high";

export interface ParsedIntervention {
  label: string;
  capabilityIds: CapabilityId[];
  costTier: CostTier;
  circular: { secondLifeBattery?: boolean; pvRecycling?: boolean; modular?: boolean };
  confidence: "calibrated proxy" | "speculative";
  rationale: string; // one line: how we read the text
  matched: string[]; // human labels of the mapped primitives
  source: "rules" | "ai"; // which layer produced this
  unmapped: boolean; // true when nothing matched (treated as a generic guess)
}

const KEYWORDS: Record<CapabilityId, string[]> = {
  allows_cycling: ["cycle", "cycling", "bike", "bicycle", "cycleway", "bike lane", "bike path", "bike route"],
  walk_link: ["walk", "walkway", "footpath", "pedestrian", "sidewalk", "promenade", "boardwalk", "path", "pavement"],
  adds_shade: ["shade", "tree", "trees", "canopy", "greenery", "garden", "park", "planting", "green corridor", "green roof", "vegetat"],
  rain_protection: ["covered", "sheltered", "shelter", "awning", "roofed", "weather protect", "canopy walk"],
  restricts_cars: ["pedestrianise", "pedestrianize", "car-free", "car free", "restrict car", "close the road", "close road", "remove parking", "road diet", "low-traffic", "traffic calm"],
  faster_cycle: ["bridge", "overpass", "underpass", "flyover", "shortcut", "direct link", "link bridge", "footbridge", "crossing"],
  better_bus: ["bus", "brt", "bus lane", "bus priority", "transit lane", "bus frequency", "bus stop"],
  solar_canopy: ["solar", "pv", "photovoltaic", "solar farm", "floating solar", "rooftop solar", "solar canopy", "solar panel"],
  ev_charging: ["ev", "electric vehicle", "charger", "charging", "charge point", "ev hub", "charging hub", "fast charg"],
  battery: ["battery", "batteries", "storage", "bess", "energy storage", "powerwall"],
};

const CAP_LABEL = new Map(CAPABILITIES.map((c) => [c.id, c.label]));

function inferTier(text: string): CostTier {
  const t = text.toLowerCase();
  if (/\b(pilot|small|single|trial|one |a few|modest|minor)\b/.test(t)) return "low";
  if (/\b(large|major|hub|network|farm|city-?wide|island-?wide|massive|flagship|mega)\b/.test(t)) return "high";
  return "med";
}

function inferCircular(text: string): ParsedIntervention["circular"] {
  const t = text.toLowerCase();
  return {
    secondLifeBattery: /second[- ]?life|reused? cell|repurposed batter/.test(t),
    pvRecycling: /recycled|recyclable|recycled-content|circular panel/.test(t),
    modular: /modular|repairable|repair/.test(t),
  };
}

function titleCase(s: string): string {
  const clean = s.trim().replace(/\s+/g, " ");
  return clean.length > 60 ? clean.slice(0, 57) + "…" : clean.charAt(0).toUpperCase() + clean.slice(1);
}

/** Deterministic keyword interpretation — always available, no API key. */
export function ruleBasedInterpret(text: string): ParsedIntervention {
  const t = (text || "").toLowerCase();
  const ids: CapabilityId[] = [];
  for (const [id, words] of Object.entries(KEYWORDS) as [CapabilityId, string[]][]) {
    if (words.some((w) => t.includes(w))) ids.push(id);
  }
  // "green"/"garden" implies shade; a "bridge" alone implies a walk link too.
  if (ids.includes("faster_cycle") && !ids.includes("allows_cycling") && !ids.includes("walk_link")) {
    ids.push("walk_link");
  }
  const unmapped = ids.length === 0;
  const finalIds = unmapped ? (["walk_link"] as CapabilityId[]) : ids;
  return {
    label: titleCase(text || "Custom intervention"),
    capabilityIds: finalIds,
    costTier: inferTier(text),
    circular: inferCircular(text),
    confidence: unmapped ? "speculative" : "calibrated proxy",
    rationale: unmapped
      ? "Couldn't confidently map this — treated as a generic pedestrian link. Adjust the effects below."
      : `Read as: ${finalIds.map((id) => CAP_LABEL.get(id)).join(" + ")}.`,
    matched: finalIds.map((id) => CAP_LABEL.get(id) ?? id),
    source: "rules",
    unmapped,
  };
}

/** Validate/coerce an AI-proposed interpretation against known primitives. */
export function coerceAiInterpretation(
  text: string,
  ai: { capabilityIds?: string[]; costTier?: string; rationale?: string; circular?: any }
): ParsedIntervention | null {
  const valid = new Set(CAPABILITIES.map((c) => c.id));
  const ids = (ai.capabilityIds ?? []).filter((id): id is CapabilityId => valid.has(id as CapabilityId));
  if (ids.length === 0) return null; // fall back to rules
  const tier: CostTier = ["low", "med", "high"].includes(ai.costTier ?? "") ? (ai.costTier as CostTier) : inferTier(text);
  return {
    label: titleCase(text),
    capabilityIds: ids,
    costTier: tier,
    circular: {
      secondLifeBattery: Boolean(ai.circular?.secondLifeBattery),
      pvRecycling: Boolean(ai.circular?.pvRecycling),
      modular: Boolean(ai.circular?.modular),
    },
    confidence: "calibrated proxy",
    rationale: ai.rationale?.slice(0, 200) || `Read as: ${ids.map((id) => CAP_LABEL.get(id)).join(" + ")}.`,
    matched: ids.map((id) => CAP_LABEL.get(id) ?? id),
    source: "ai",
    unmapped: false,
  };
}

/** The classification instruction handed to Gemini (kept here so it stays in
 *  sync with the capability set). */
export function interpretationPrompt(text: string): string {
  const menu = CAPABILITIES.map((c) => `- ${c.id}: ${c.label} — ${c.hint}`).join("\n");
  return `You map a planner's free-text urban intervention onto a fixed menu of effect primitives. Return ONLY JSON.

Primitive menu (use ONLY these ids):
${menu}

Rules:
- Choose every primitive the intervention would plausibly involve (a "shaded bike bridge with EV charging" → allows_cycling, adds_shade, faster_cycle, ev_charging).
- costTier: "low" (~$150k, small/pilot), "med" (~$500k), or "high" (~$2M, large/hub/network/farm).
- circular: set secondLifeBattery / pvRecycling / modular true only if the text implies reuse/recycling/repairability.
- rationale: one short sentence on how you read it. Do NOT invent primitives outside the menu.

Intervention: "${text.replace(/"/g, "'")}"

Return JSON: {"capabilityIds": string[], "costTier": "low"|"med"|"high", "circular": {"secondLifeBattery": bool, "pvRecycling": bool, "modular": bool}, "rationale": string}`;
}
