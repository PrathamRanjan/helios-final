// Pareto frontier — shows the carbon/heat/cost trade-off WITHOUT collapsing it
// into one arbitrary "utility" weight.
//
// The greedy optimizer needs a single objective (it uses HEAT_WEIGHT_T = 15 t
// per heat-point — a calibrated proxy both audits flagged). Pareto removes that
// dependence: it plots every candidate the optimizer already scored through the
// full simulation in objective space (CO₂ avoided ↑, heat relief ↑, cost ↓) and
// marks the NON-DOMINATED set — the interventions where you can't do better on
// one objective without giving up another. The greedy pick then sits ON this
// frontier, shown as "the recommendation; here's the trade-off behind it".
//
// Every point is a REAL single-intervention simulation (from suggestModifiers),
// so the frontier involves no additivity approximation.

// Minimal structural input — works with either the engine or client Suggestion
// shape (the fields the frontier actually reads).
interface ParetoInput {
  modifier: { id: string; label: string; economics: { capexUsd: number } };
  aloneAvoidedT: number;
  aloneHeatReducedPct: number;
  aloneCostPerTonneUsd: number | null;
  selected: boolean;
  regrettable: boolean;
}

export interface ParetoPoint {
  id: string;
  label: string;
  co2AvoidedT: number; // maximise
  heatReducedPct: number; // maximise
  capexUsd: number; // minimise
  costPerTonneUsd: number | null;
  onFrontier: boolean; // non-dominated
  selected: boolean; // chosen by the greedy package
}

/**
 * A point A dominates B if A is at-least-as-good on every objective and strictly
 * better on at least one. Objectives: co2 ↑, heat ↑, cost ↓.
 */
function dominates(a: ParetoPoint, b: ParetoPoint): boolean {
  const ge =
    a.co2AvoidedT >= b.co2AvoidedT &&
    a.heatReducedPct >= b.heatReducedPct &&
    a.capexUsd <= b.capexUsd;
  const gt =
    a.co2AvoidedT > b.co2AvoidedT ||
    a.heatReducedPct > b.heatReducedPct ||
    a.capexUsd < b.capexUsd;
  return ge && gt;
}

export interface ParetoResult {
  points: ParetoPoint[];
  frontier: ParetoPoint[]; // non-dominated, sorted by cost
  note: string;
}

/** Compute the Pareto frontier over the optimizer's already-scored candidates. */
export function paretoFrontier(suggestions: ParetoInput[]): ParetoResult {
  const points: ParetoPoint[] = suggestions
    .filter((s) => s.aloneAvoidedT > 0 && !s.regrettable)
    .map((s) => ({
      id: s.modifier.id,
      label: s.modifier.label,
      co2AvoidedT: Math.round(s.aloneAvoidedT * 10) / 10,
      heatReducedPct: s.aloneHeatReducedPct,
      capexUsd: s.modifier.economics.capexUsd,
      costPerTonneUsd: s.aloneCostPerTonneUsd,
      onFrontier: false,
      selected: s.selected,
    }));

  for (const p of points) {
    p.onFrontier = !points.some((q) => q !== p && dominates(q, p));
  }

  const frontier = points
    .filter((p) => p.onFrontier)
    .sort((a, b) => a.capexUsd - b.capexUsd);

  return {
    points,
    frontier,
    note:
      "Each point is one intervention scored through the full simulation. The frontier is the set where no " +
      "option beats it on carbon, heat and cost at once — so the trade-off is explicit, not hidden behind a " +
      "single weight. The recommended package is assembled from frontier-leading options.",
  };
}
