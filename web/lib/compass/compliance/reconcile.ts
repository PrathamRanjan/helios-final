// Reconcile Gemma's rule drafts with the hand-built engine rules.
//
// Two independent readings of the same law: the rule JSON was encoded separately (extracted
// by Claude, pending human sign-off) and Gemma read the PDF page on its own. Where Gemma's number appears in a rule that cites the same document, under a
// field whose name shares a word with the draft (rate ↔ rates, threshold ↔ thresholds),
// the two readings agree. Everything else is "not in the engine yet" — the promotion queue.

import path from "path";
import { RULES, SOURCES } from "./rules";
import type { Rule } from "./types";

/** Promoted-but-unmapped rule files. The engine never loads this folder. */
export const CANDIDATES_DIR = path.join(process.cwd(), "data", "compliance", "rules", "candidates");

export interface EngineMatch {
  ruleId: string;
  path: string;
  value: number;
}

export interface Reconciled {
  status: "matches_engine" | "not_in_engine" | "no_checkable_value";
  matches: EngineMatch[];
  /** Rules that cite the same document (even when no value matched). */
  sameDocRules: string[];
}

const slug = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const STOP = new Set(["the", "of", "for", "or", "and", "a", "an", "to", "in", "on", "is", "by", "later", "earlier", "value", "per"]);
const stem = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem));

/** document slug (policy_sources/pages/<slug>.json) → source keys in sources.json */
function sourcesForDoc(docSlug: string): string[] {
  return Object.entries(SOURCES)
    .filter(([, s]) => s.file && slug(s.file) === docSlug)
    .map(([k]) => k);
}

function numericLeaves(o: unknown, path = ""): { path: string; value: number }[] {
  if (typeof o === "number") return [{ path, value: o }];
  if (Array.isArray(o)) return o.flatMap((x, i) => numericLeaves(x, `${path}[${i}]`));
  if (o && typeof o === "object")
    return Object.entries(o).flatMap(([k, v]) => (k === "examples" || k === "review" || k === "citation" ? [] : numericLeaves(v, path ? `${path}.${k}` : k)));
  return [];
}

export function reconcileDraft(d: { doc: string; title: string; metric?: string; unit?: string; value?: number | string | null }, rules: Rule[] = RULES): Reconciled {
  const keys = sourcesForDoc(d.doc);
  const same = rules.filter((r) => keys.includes(r.citation.source));
  const v = typeof d.value === "number" ? d.value : typeof d.value === "string" && /^[\d,.]+$/.test(d.value) ? Number(d.value.replace(/,/g, "")) : null;
  if (v == null || !Number.isFinite(v)) return { status: "no_checkable_value", matches: [], sameDocRules: same.map((r) => r.id) };
  const want = tokens(`${d.title} ${d.metric ?? ""} ${d.unit ?? ""}`);
  const matches: EngineMatch[] = [];
  for (const r of same) {
    for (const leaf of numericLeaves(r)) {
      if (leaf.value !== v) continue;
      const have = tokens(leaf.path.replace(/_/g, " "));
      if ([...have].some((t) => want.has(t))) matches.push({ ruleId: r.id, path: leaf.path, value: leaf.value });
    }
  }
  return { status: matches.length ? "matches_engine" : "not_in_engine", matches, sameDocRules: same.map((r) => r.id) };
}

/** Suggested engine rule kind for a draft kind — a starting point for whoever maps it. */
export const KIND_HINT: Record<string, { kind: Rule["kind"] | null; how: string }> = {
  rate: { kind: "rate_schedule", how: "Add a rates[] row (from_year, to_year, value) to a rate_schedule rule." },
  threshold: { kind: "tier_threshold", how: "Add a threshold to an existing rule's thresholds{} or a tier_threshold table." },
  requirement: { kind: "trigger_requirement", how: "Add to a trigger_requirement rule's obligations, with the trigger that activates it." },
  exemption: { kind: "trigger_requirement", how: "Add to a rule's exemptions[] with the fact that grants it." },
  date: { kind: null, how: "Set effective_from / effective_to on the rule it dates." },
  definition: { kind: null, how: "Becomes a fact definition (facts.ts) or applies_to value, not a rule on its own." },
};
