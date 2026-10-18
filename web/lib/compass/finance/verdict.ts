// Verdict scoring — turns the engine's cost-per-tonne into a decision label at
// the moment the planner sees a result. This is the "decision-support, not
// dashboard" beat: the planner acts in half a second.
//
// IMPORTANT honesty note: urban mobility/shade interventions are NOT pure
// carbon plays. Their cost-per-tonne (typ. $2k–15k/t here) sits far above the
// carbon *price* (~US$33/t in 2026 → ~US$37–59/t by 2030) because their primary
// value is heat, mobility and livability — carbon is a co-benefit. So the badge
// bands are calibrated to published urban-transport marginal-abatement-cost
// ranges, and we show the carbon-price multiple only as CONTEXT — never as a
// pass/fail line (that would flag everything "poor" and mislead).
//
// Bands (calibrated proxy — urban transport MACC literature, co-benefits unpriced):
//   HIGH_LEVERAGE  < $2,000/t     cost-effective on carbon alone
//   VIABLE         $2,000–6,000/t typical for good active-mobility infra
//   MARGINAL       $6,000–15,000/t justified mainly by heat/co-benefits
//   POOR_VALUE     > $15,000/t    weak on carbon; needs another rationale

export type Verdict = "HIGH_LEVERAGE" | "VIABLE" | "MARGINAL" | "POOR_VALUE";

export interface VerdictInfo {
  verdict: Verdict;
  label: string;
  costPerTonneUsd: number | null;
  /** cost-per-tonne ÷ 2030 carbon price — shown as context, not a threshold. */
  carbonPriceMultiple: number | null;
  blurb: string;
  tone: "good" | "ok" | "warn" | "bad";
}

// Carbon Pricing Act 2018: S$45/t from 2026 (law). S$50–80/t by 2030 is the
// Government's stated trajectory, not yet legislated (see compliance/policy.ts).
// USD at ~0.74 → ~$33/t 2026, ~$37–59/t 2030. The 2030 midpoint is a context
// anchor only — a policy pathway, not a statutory rate.
export const CARBON_PRICE_2030_USD = 48; // midpoint of S$50–80/t → ~US$37–59

const BANDS: { max: number; verdict: Verdict; label: string; tone: VerdictInfo["tone"]; blurb: string }[] = [
  { max: 2000, verdict: "HIGH_LEVERAGE", label: "High-leverage", tone: "good", blurb: "Cost-effective on carbon alone" },
  { max: 6000, verdict: "VIABLE", label: "Viable", tone: "ok", blurb: "Typical for good active-mobility infrastructure" },
  { max: 15000, verdict: "MARGINAL", label: "Marginal", tone: "warn", blurb: "Justified mainly by heat / co-benefits" },
  { max: Infinity, verdict: "POOR_VALUE", label: "Poor value", tone: "bad", blurb: "Weak on carbon — needs another rationale" },
];

export function verdictFor(costPerTonneUsd: number | null): VerdictInfo {
  if (costPerTonneUsd === null || !Number.isFinite(costPerTonneUsd) || costPerTonneUsd <= 0) {
    return {
      verdict: "MARGINAL",
      label: "No carbon signal",
      costPerTonneUsd,
      carbonPriceMultiple: null,
      blurb: "No net CO₂ avoided yet — add a change or extend the horizon",
      tone: "warn",
    };
  }
  const band = BANDS.find((b) => costPerTonneUsd < b.max)!;
  return {
    verdict: band.verdict,
    label: band.label,
    costPerTonneUsd,
    carbonPriceMultiple: Math.round(costPerTonneUsd / CARBON_PRICE_2030_USD),
    blurb: band.blurb,
    tone: band.tone,
  };
}
