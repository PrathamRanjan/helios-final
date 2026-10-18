// City-aware funding lookup. Maps the present intervention kinds to matching
// funding / finance instruments from the sourced directory (Singapore, Bangkok,
// Hanoi). This is the "portability" wiring: the same package, funded the way
// each city actually funds it. SG grants with $ offsets still come from the
// decision brief; this adds the full instrument list and unlocks the other cities.

import directory from "@/data/funding_directory.json";
import type { AssetKind } from "./decisionBrief";

export type FundingCity = "singapore" | "bangkok" | "hanoi";

export interface FundingInstrument {
  name: string;
  admin?: string;
  type: string;
  funds: string;
  terms?: string;
  eligibility?: string;
  status?: string;
  confidence: "verified" | "partial" | "indicative";
}

export const FUNDING_CITIES: { id: FundingCity; label: string }[] = [
  { id: "singapore", label: "Singapore" },
  { id: "bangkok", label: "Bangkok" },
  { id: "hanoi", label: "Hanoi" },
];

// Each present asset kind → the funding tags that pay for it.
const KIND_TAGS: Record<AssetKind, string[]> = {
  ev_charging: ["ev_charging", "ev_fleet"],
  battery: ["battery"],
  solar: ["solar", "wind"],
  cycling: ["cycling", "walkway", "transit"],
  walkway: ["walkway", "greenery", "transit"],
  greenery: ["greenery"],
};

// Universal financing / carbon levers — relevant to any capital project.
const CROSS_CUTTING = new Set(["finance", "emitters", "fuels", "efficiency", "emission-reduction projects"]);

const CONF_RANK: Record<string, number> = { verified: 0, partial: 1, indicative: 2 };

/** Normalise a comma-separated `funds` field into clean lowercase tags. */
function fundTags(funds: string): string[] {
  return funds
    .split(",")
    .map((t) => t.replace(/\(.*?\)/g, "").trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Funding instruments for a city that match the present intervention kinds,
 * plus the city's cross-cutting finance/carbon levers. Verified-first.
 */
export function fundingForCity(kinds: AssetKind[], city: FundingCity): FundingInstrument[] {
  const target = new Set<string>();
  for (const k of kinds) for (const t of KIND_TAGS[k] ?? []) target.add(t);
  const items = ((directory as any).cities?.[city] ?? []) as FundingInstrument[];
  return items
    .filter((it) => {
      const tags = fundTags(it.funds);
      return tags.some((t) => target.has(t) || CROSS_CUTTING.has(t));
    })
    .sort((a, b) => (CONF_RANK[a.confidence] ?? 3) - (CONF_RANK[b.confidence] ?? 3));
}
