// Decision gate — the single affirmative answer the chief judge asked for.
//
// The tool already computes cost-per-tonne, regrettable-substitution, grid
// readiness, civic sentiment and payback. This module collapses those signals
// into ONE unmistakable verdict a committee can act on:
//   FUND        — go ahead
//   FUND_COND   — fund, subject to a named pre-condition (e.g. grid check)
//   STUDY       — don't commit yet; a site study must resolve a blocker
//   DEFER       — don't fund as drawn; redesign first
//
// It is deliberately conservative: any hard blocker (regrettable substitution)
// forces DEFER; a grid substation flag or public opposition forces at least
// STUDY. Green signals only upgrade the verdict when no blocker is present.

import type { ScenarioResult, WorldModifier } from "../world/types";
import { substitutionRisk } from "../lifecycle/substitution";
import { civicForModifierEffects } from "../civic/civicScore";
import { verdictFor } from "../finance/verdict";
import { gridSummary } from "./gridReadiness";

export type Gate = "FUND" | "FUND_COND" | "STUDY" | "DEFER";

export interface DecisionGate {
  gate: Gate;
  headline: string; // the affirmative sentence
  tone: "good" | "ok" | "warn" | "bad";
  reasons: string[]; // why this verdict
  conditions: string[]; // what must be true / checked before/at funding
}

const TONE: Record<Gate, DecisionGate["tone"]> = {
  FUND: "good",
  FUND_COND: "ok",
  STUDY: "warn",
  DEFER: "bad",
};

export function decisionGate(result: ScenarioResult, modifiers: WorldModifier[]): DecisionGate {
  const s = result.summary;
  const reasons: string[] = [];
  const conditions: string[] = [];

  const sub = substitutionRisk(s);
  const grid = gridSummary(modifiers);
  const value = verdictFor(s.costPerTonneUsd);
  const opposed = modifiers.some((m) => {
    const c = civicForModifierEffects(m.effects as any);
    return c && c.sentimentWord === "opposed";
  });

  // --- Hard blocker → DEFER ---
  if (sub.regrettable) {
    reasons.push(`Regrettable substitution: ${sub.reasons[0]}`);
    return {
      gate: "DEFER",
      headline: "Defer — redesign before funding",
      tone: TONE.DEFER,
      reasons,
      conditions: ["Rework the package so lifecycle carbon is clearly positive."],
    };
  }

  // --- Positive drivers ---
  const co2 = s.netCO2AvoidedTonnes;
  if (co2 > 0) reasons.push(`${Math.round(co2)} t net CO₂ avoided over the horizon`);
  if (value.costPerTonneUsd) reasons.push(`$${value.costPerTonneUsd.toLocaleString()}/t — ${value.label.toLowerCase()}`);
  if (s.moneyPaybackYear) reasons.push(`Social payback by ${s.moneyPaybackYear}`);
  if (s.budgetSharePct) reasons.push(`Uses ${s.budgetSharePct}% of the district envelope`);

  // --- Blockers that need resolving before commitment ---
  let gate: Gate = "FUND";
  if (grid.worst === "substation") {
    gate = "STUDY";
    conditions.push(`Grid: ${grid.headline}`);
  } else if (grid.worst === "review") {
    gate = gate === "FUND" ? "FUND_COND" : gate;
    conditions.push(`Grid: ${grid.headline}`);
  }
  if (opposed) {
    gate = gate === "STUDY" ? "STUDY" : "STUDY";
    conditions.push("Public acceptance: residents lean opposed — run consultation before committing.");
  }
  if (s.netNegativeOnCarbon) {
    // Not a carbon play — allowed, but flag it needs a co-benefit rationale.
    gate = gate === "FUND" ? "FUND_COND" : gate;
    conditions.push("Carbon-negative on build — justify on heat / mobility / livability co-benefits.");
    reasons.push("Primary value is heat / mobility co-benefit, not carbon");
  }
  if (value.verdict === "POOR_VALUE") {
    gate = gate === "FUND" ? "FUND_COND" : gate;
    conditions.push("Weak carbon value — confirm the non-carbon rationale is the intent.");
  }

  const headline =
    gate === "FUND"
      ? "Fund this package"
      : gate === "FUND_COND"
      ? "Fund — subject to the conditions below"
      : gate === "STUDY"
      ? "Commission a site study before funding"
      : "Defer — redesign before funding";

  return { gate, headline, tone: TONE[gate], reasons, conditions };
}
