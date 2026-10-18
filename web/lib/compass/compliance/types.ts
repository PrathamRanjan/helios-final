// HELIO Compliance — shared types.
//
// The principle (see COMPLIANCE_ROADMAP.md): verdicts come from deterministic,
// cited, effective-dated rules. Rule DATA lives in data/compliance/rules/*.json;
// rule KINDS (how a rule is evaluated) live in evaluate.ts. The LLM may explain
// a finding, never produce one.

/** Flat inputs a rule can read. Helios internals are mapped into this by facts.ts. */
export type FactValue = number | string | boolean | null | undefined;
export type Facts = Record<string, FactValue>;

/** Where a fact came from — confidence travels into the finding. */
export type FactProvenance = "measured" | "user_input" | "modelled" | "assumed";

export type RuleStatus = "in_force" | "enacted_future" | "draft" | "proposed";
export type RuleCategory = "law" | "standard" | "taxonomy" | "cost" | "disclosure";
export type RuleKind =
  | "worst_band"
  | "capped_percentage"
  | "tier_threshold"
  | "energy_label"
  | "rate_schedule"
  | "trigger_requirement"
  | "taxonomy_class"
  | "disclosure_schedule";

export interface Citation {
  source: string; // key in data/compliance/sources.json
  clause: string;
  pages: number[];
  quote: string;
}

/** Common header for every rule JSON. Kind-specific payload stays loosely typed. */
export interface Rule {
  id: string;
  title: string;
  instrument: string;
  jurisdiction: string;
  category: RuleCategory;
  kind: RuleKind;
  status: RuleStatus;
  effective_from: string; // ISO date
  effective_to: string | null;
  supersedes?: string | null;
  applies_to: Record<string, string | string[]>;
  citation: Citation;
  notes?: string[];
  examples?: RuleExample[];
  review: { confidence: "verified_primary" | "secondary" | "draft"; reviewed_by: string; reviewed_at: string };
  [k: string]: unknown;
}

export interface RuleExample {
  name: string;
  asOf: string;
  facts: Facts;
  expect: { outcome?: Outcome; tier?: string; amount_sgd?: number };
}

export type Outcome =
  | "pass" // meets the rule (or achieves a tier)
  | "fail" // does not meet the rule / below lowest tier
  | "info" // a cost or classification with no pass/fail sense (e.g. a VES surcharge)
  | "needs_info" // an input the rule needs is missing — never silently pass
  | "not_applicable" // rule doesn't cover this asset
  | "not_in_force"; // asOf is outside the rule's effective window

export interface Comparison {
  metric: string;
  label: string;
  unit: string;
  value: number;
  threshold: number;
  op: "<=" | ">=" | "<" | ">";
  met: boolean;
  /** Distance to the threshold in metric units (positive = headroom, negative = shortfall). */
  margin: number;
}

export interface Finding {
  ruleId: string;
  title: string;
  instrument: string;
  category: RuleCategory;
  status: RuleStatus;
  outcome: Outcome;
  /** Tier / band achieved, e.g. "GoldPLUS", "C2", "ZE". */
  tier?: string;
  /** Money effect in S$: negative = rebate/saving, positive = surcharge/cost. */
  amountSgd?: number;
  /** One-line human summary, e.g. "EUI 150 ≤ 155 → GoldPLUS (5 kWh/m²/yr short of Platinum)". */
  summary: string;
  comparisons: Comparison[];
  /** What would move it up a tier / to compliance, when computable. */
  nextStep?: string;
  missing?: string[];
  citation: Citation;
  asOf: string;
  /** Lowest provenance among the facts used — "modelled" makes the verdict "likely". */
  inputConfidence: FactProvenance;
  ruleConfidence: Rule["review"]["confidence"];
  /** Facts this finding makes available to later rules (e.g. gm_eui_tier). */
  derived?: Facts;
}

export interface EvaluateOptions {
  asOf: string; // ISO date
  provenance?: Record<string, FactProvenance>;
  /** Include draft / proposed rules (policy "what-if" view). Default false. */
  includeDraft?: boolean;
}
