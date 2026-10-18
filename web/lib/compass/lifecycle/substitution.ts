// Regrettable-substitution detection — "don't solve one problem by creating
// another." A change is regrettable when it SHIFTS the burden rather than
// removing it: it emits more carbon to build than it ever saves, and doesn't
// even buy a compensating co-benefit (heat/comfort). The optimizer refuses to
// recommend these; the UI showcases WHY, so avoiding the trap is visible.
//
// Important nuance: a covered walkway is carbon-negative but is NOT regrettable
// if it delivers real heat relief — that's a legitimate comfort investment, not
// a problem-shift. Regrettability requires net-negative carbon AND negligible
// co-benefit (or an embodied debt never repaid within the horizon).

import type { ScenarioResult } from "../world/types";

// Any real heat reduction at/above this exempts a carbon-negative change from
// "regrettable" — it's then a legitimate comfort investment (e.g. a walkway),
// not a pure problem-shift (e.g. a standalone battery with zero co-benefit).
const HEAT_COBENEFIT_PCT = 1;

export interface SubstitutionRisk {
  regrettable: boolean;
  reasons: string[];
  /** A non-fatal note (e.g. carbon-negative but justified by heat). */
  tradeoffNote?: string;
}

export function substitutionRisk(summary: ScenarioResult["summary"]): SubstitutionRisk {
  const reasons: string[] = [];
  const embodied = summary.embodiedCO2Tonnes;
  const operational = summary.cumulativeCO2AvoidedTonnes;
  const heat = summary.heatExposureReducedPct;

  // Net-negative on carbon (embodied > operational) means the build debt is
  // never repaid within the horizon. That's only REGRETTABLE if it also fails
  // to buy a co-benefit — otherwise it's a legitimate comfort tradeoff.
  const carbonNegative = summary.netNegativeOnCarbon;

  // Traveller welfare (logsum ΔCS: time, safety, comfort) is a real co-benefit too. If it alone
  // repays the capex, the change is a mobility investment with a carbon cost, not a problem-shift.
  const welfarePv = summary.userBenefitPvUsd ?? 0;
  const welfareCoversCost = summary.capexUsd > 0 && welfarePv >= summary.capexUsd;

  if (carbonNegative && embodied > 0 && heat < HEAT_COBENEFIT_PCT && !welfareCoversCost) {
    reasons.push(
      `Builds ${Math.round(embodied)} t of embodied CO₂ to save only ${Math.round(operational)} t over 10 yr, with negligible heat benefit — this shifts the problem (manufacturing/grid), it doesn't solve it.`
    );
  }

  // A legitimate carbon-negative-but-comfort case: surface the tradeoff, not a veto.
  let tradeoffNote: string | undefined;
  if (carbonNegative && heat >= HEAT_COBENEFIT_PCT && reasons.length === 0) {
    tradeoffNote = `Carbon-negative on build, but justified by −${heat}% heat exposure — a comfort investment, not a carbon play.`;
  } else if (carbonNegative && welfareCoversCost && reasons.length === 0) {
    tradeoffNote = `Carbon-negative over 10 yr (embodied ${Math.round(embodied)} t vs ${Math.round(operational)} t saved), but traveller benefit $${Math.round(welfarePv).toLocaleString()} exceeds its cost — a mobility/safety investment with a carbon cost, not a carbon play.`;
  }

  return { regrettable: reasons.length > 0, reasons, tradeoffNote };
}
