// HELIO Suggest-Changes: the optimizer proposes world changes, scores every
// candidate through the REAL simulation engine (no shortcut math), then greedy-
// selects a package under budget and simulates the chosen package jointly.
//
// Honesty notes baked into the output: candidates are scored independently
// (additivity is an approximation — the package number comes from ONE joint
// run), and the objective weights are labelled calibrated proxies.

import { capexForModifier } from "../finance/intervention";
import type { WorldState, WorldModifier, Shock } from "../world/types";
import { simulateTimeline } from "../world/simulateTimeline";
import { modeShares } from "../world/agentChoice";
import { evSiteModifier, type EvSite } from "../flow/scenario";
import { substitutionRisk } from "../lifecycle/substitution";
import { placementCheck, type FeasibilityResult } from "../feasibility/placementCheck";
import type { PathwayId } from "../policy/applyPolicy";

export interface Suggestion {
  modifier: WorldModifier;
  reason: string;
  aloneAvoidedT: number;
  aloneCostPerTonneUsd: number | null;
  aloneHeatReducedPct: number;
  utilityPerMillionUsd: number;
  selected: boolean;
  /** True when the change shifts the problem rather than solving it. */
  regrettable: boolean;
  regrettableReason?: string;
  /** Placement plausibility screen (EV-on-platform, path-on-rail, etc.). */
  feasibility: FeasibilityResult;
}

/** One candidate PACKAGE on the trade-off frontier (real joint simulation). */
export interface ParetoPackage {
  ids: string[];
  labels: string[];
  capexUsd: number;
  co2AvoidedT: number; // maximise
  heatReducedPct: number; // maximise
  costPerTonneUsd: number | null;
  builtFromWeight: number; // the heat-weight that generated this package
  onFrontier: boolean; // non-dominated over (co2 ↑, heat ↑, cost ↓)
  isRecommended: boolean; // equals the greedy pick
}

export interface OptimizeResult {
  budgetUsd: number;
  considered: number;
  suggestions: Suggestion[];
  package: {
    ids: string[];
    capexUsd: number;
    cumulativeCO2AvoidedTonnes: number;
    costPerTonneUsd: number | null;
    heatExposureReducedPct: number;
  } | null;
  /** Package-level Pareto frontier — the recommendation is one point on it. */
  paretoPackages?: ParetoPackage[];
  objective: string;
  note: string;
}

// Objective weight: 1 heat-% point ≈ this many tonnes of "utility".
// Calibrated proxy — surfaces the planner's dual mandate (carbon + comfort).
const HEAT_WEIGHT_T = 15;
const MAX_PICKS = 6;
// Portfolio diversity: at most this many picks per candidate family, so a single
// assumption (e.g. the speculative EV displacement) can't dominate the package.
const MAX_PER_FAMILY = 2;

function familyOf(id: string): string {
  return id.split("_")[1] ?? id; // opt_shade_x → shade
}

interface Candidate {
  modifier: WorldModifier;
  reason: string;
}

function corridorKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Generate ~18 candidates from measured signals in the frozen world. */
function generateCandidates(
  world: WorldState,
  evSites: EvSite[],
  existingIds: Set<string>,
  builtYear: number
): Candidate[] {
  const nodeById = new Map(world.nodes.map((n) => [n.id, n]));
  const out: Candidate[] = [];
  const usedCorridors = new Set<string>();

  const lineGeom = (edge: (typeof world.edges)[number]) => {
    const f = nodeById.get(edge.from)!;
    const t = nodeById.get(edge.to)!;
    return {
      type: "LineString" as const,
      coordinates: [
        [f.lng, f.lat],
        [t.lng, t.lat],
      ] as [number, number][],
    };
  };
  const name = (id: string) => nodeById.get(id)?.name ?? id;

  // 1. Shade corridors over the worst measured heat deficits (trips × km × effHeat).
  const byDeficit = [...world.edges].sort((a, b) => {
    const ha = a.totalTripsDaily * a.distKm * a.attrs.heatExposure * (1 - a.attrs.shadeScore);
    const hb = b.totalTripsDaily * b.distKm * b.attrs.heatExposure * (1 - b.attrs.shadeScore);
    return hb - ha;
  });
  let n = 0;
  for (const e of byDeficit) {
    if (n >= 5) break;
    const key = corridorKey(e.from, e.to);
    if (usedCorridors.has(key)) continue;
    usedCorridors.add(key);
    n++;
    out.push({
      modifier: {
        id: `opt_shade_${key}`,
        label: `Shaded walkway · ${name(e.from)} → ${name(e.to)}`,
        geometry: lineGeom(e),
        effects: { shadeDelta: 0.45, rainProtectionDelta: 0.5, comfortDelta: { walk: 0.25 } },
        economics: { capexUsd: 500_000, annualOpexUsd: 10_000, lifetimeYears: 15 },
        metadata: { createdBy: "optimizer", confidence: "literature-derived", builtYear },
      },
      reason: `Worst measured shade deficit: ${Math.round(e.totalTripsDaily).toLocaleString()} trips/day, ${e.distKm.toFixed(1)} km, shade ${e.attrs.shadeScore.toFixed(2)}`,
    });
  }

  // 2. Protected cycling links on high-demand, cycle-range corridors where car
  //    share is currently high (most to win).
  const cycleRange = world.edges.filter((e) => e.distKm >= 1 && e.distKm <= 5);
  const byCycleWin = cycleRange
    .map((e) => ({ e, carTrips: modeShares(e).car * e.totalTripsDaily }))
    .sort((a, b) => b.carTrips - a.carTrips);
  n = 0;
  const cycleUsed = new Set<string>();
  for (const { e, carTrips } of byCycleWin) {
    if (n >= 5) break;
    const key = corridorKey(e.from, e.to);
    if (cycleUsed.has(key)) continue;
    cycleUsed.add(key);
    n++;
    out.push({
      modifier: {
        id: `opt_cycle_${key}`,
        label: `Protected cycle link · ${name(e.from)} → ${name(e.to)}`,
        geometry: lineGeom(e),
        effects: {
          cycleMaxKmExtension: 1.5,
          safetyDelta: { cycle: 0.3 },
          comfortDelta: { cycle: 0.2 },
          travelTimeMultiplier: { cycle: 0.75 },
        },
        economics: { capexUsd: 500_000, annualOpexUsd: 10_000, lifetimeYears: 15 },
        metadata: { createdBy: "optimizer", confidence: "literature-derived", builtYear },
      },
      reason: `Cycle-range corridor (${e.distKm.toFixed(1)} km) with ~${Math.round(carTrips).toLocaleString()} car trips/day to shift`,
    });
  }

  // 3. EV hubs from the opportunity-zone shortlist (skip already-accepted).
  for (const site of evSites.slice(0, 4)) {
    const mod = evSiteModifier(site, builtYear);
    if (existingIds.has(mod.id)) continue;
    out.push({ modifier: { ...mod, id: `opt_${mod.id}` }, reason: site.reasons.join(" · ") });
  }

  // 4. Bus priority on the two highest-demand corridors overall.
  const byTrips = [...world.edges].sort((a, b) => b.totalTripsDaily - a.totalTripsDaily);
  n = 0;
  const busUsed = new Set<string>();
  for (const e of byTrips) {
    if (n >= 2) break;
    const key = corridorKey(e.from, e.to);
    if (busUsed.has(key)) continue;
    busUsed.add(key);
    n++;
    out.push({
      modifier: {
        id: `opt_bus_${key}`,
        label: `Bus priority · ${name(e.from)} → ${name(e.to)}`,
        geometry: lineGeom(e),
        effects: { busWaitDeltaMin: -3 },
        economics: { capexUsd: 150_000, annualOpexUsd: 20_000, lifetimeYears: 15 },
        metadata: { createdBy: "optimizer", confidence: "literature-derived", builtYear },
      },
      reason: `Highest-demand corridor: ${Math.round(e.totalTripsDaily).toLocaleString()} trips/day (headway elasticity literature)`,
    });
  }

  // 5. Solar canopies at the two busiest measured-footfall stations.
  const byFootfall = world.nodes
    .filter((x) => x.type === "mrt_station" || x.type === "bus_stop")
    .sort((a, b) => (b.attrs.footfallDaily ?? 0) - (a.attrs.footfallDaily ?? 0))
    .slice(0, 2);
  for (const node of byFootfall) {
    out.push({
      modifier: {
        id: `opt_solar_${node.id}`,
        label: `Solar canopy · ${node.name}`,
        geometry: { type: "Point", coordinates: [node.lng, node.lat] },
        effects: { solarAnnualKWhDelta: 120_000 },
        economics: { capexUsd: 150_000, annualOpexUsd: 3_000, lifetimeYears: 20 },
        metadata: { createdBy: "optimizer", confidence: "literature-derived", builtYear },
      },
      reason: `${(node.attrs.footfallDaily ?? 0).toLocaleString()} measured taps/day — canopy gives shade + 120 MWh/yr`,
    });
  }

  // Price length/size-based candidates from official unit costs (MOT covered walkway S$2–3M/km,
  // cycle lane, shade trees, EMA PV $/kWp) instead of a flat tier — a 3 km walkway is not $500k.
  // EV hubs keep their demand-sized site package; bus priority keeps its flat estimate (no per-km
  // unit cost in the dataset yet — flagged in notes).
  for (const c of out) {
    const id = c.modifier.id;
    if (!(id.startsWith("opt_shade_") || id.startsWith("opt_cycle_") || id.startsWith("opt_solar_"))) continue;
    const cx = capexForModifier(c.modifier);
    if (cx.totalUsd > 0) {
      c.modifier.economics = { ...c.modifier.economics, capexUsd: Math.round(cx.totalUsd), annualOpexUsd: Math.round(cx.opexPerYearUsd) };
      c.reason += ` · costed ${cx.lines.map((l) => l.detail).join(" + ")}`;
    } else if (id.startsWith("opt_bus_")) {
      c.modifier.metadata.notes = [...(c.modifier.metadata.notes ?? []), "flat capex estimate (no per-km bus-priority unit cost yet)"];
    }
  }

  return out;
}

export function suggestModifiers(
  world: WorldState,
  opts: {
    budgetUsd: number;
    startYear: number;
    endYear: number;
    pathway: PathwayId;
    shocks: Shock[];
    evSites: EvSite[];
    existingModifierIds: string[];
  }
): OptimizeResult {
  const candidates = generateCandidates(
    world,
    opts.evSites,
    new Set(opts.existingModifierIds),
    opts.startYear
  );

  // Score every candidate through the real engine, alone.
  const scored: Suggestion[] = candidates.map((c) => {
    const r = simulateTimeline(world, [c.modifier], opts.startYear, opts.endYear, opts.pathway, opts.shocks);
    const avoided = r.summary.cumulativeCO2AvoidedTonnes;
    const heat = r.summary.heatExposureReducedPct;
    const utility = avoided + HEAT_WEIGHT_T * heat;
    const risk = substitutionRisk(r.summary);
    const feasibility = placementCheck(c.modifier, world);
    return {
      modifier: c.modifier,
      reason: c.reason,
      aloneAvoidedT: avoided,
      aloneCostPerTonneUsd: r.summary.costPerTonneUsd,
      aloneHeatReducedPct: heat,
      utilityPerMillionUsd: Math.round((utility / (c.modifier.economics.capexUsd / 1e6)) * 10) / 10,
      selected: false,
      regrettable: risk.regrettable,
      regrettableReason: risk.reasons[0],
      feasibility,
    };
  });

  // Greedy knapsack by utility density (heat-weight HEAT_WEIGHT_T) — the pick.
  const pickedIds = greedyPickIds(scored, opts.budgetUsd, HEAT_WEIGHT_T);
  const picked = scored.filter((s) => pickedIds.has(s.modifier.id));
  for (const s of picked) s.selected = true;
  const spent = picked.reduce((sum, p) => sum + p.modifier.economics.capexUsd, 0);

  // The package's headline number comes from ONE joint simulation — never from
  // summing independent runs.
  let pkg: OptimizeResult["package"] = null;
  if (picked.length) {
    const joint = simulateTimeline(
      world,
      picked.map((p) => p.modifier),
      opts.startYear,
      opts.endYear,
      opts.pathway,
      opts.shocks
    );
    pkg = {
      ids: picked.map((p) => p.modifier.id),
      capexUsd: spent,
      cumulativeCO2AvoidedTonnes: joint.summary.cumulativeCO2AvoidedTonnes,
      costPerTonneUsd: joint.summary.costPerTonneUsd,
      heatExposureReducedPct: joint.summary.heatExposureReducedPct,
    };
  }

  // Package-level Pareto frontier: sweep the heat-weight to generate DIFFERENT
  // budget-feasible packages, jointly simulate each (real), and keep the
  // non-dominated set. This removes the "one arbitrary weight" objection — the
  // recommendation is shown as one point on a real trade-off curve.
  const paretoPackages = buildPackageFrontier(scored, picked, opts, world);

  return {
    budgetUsd: opts.budgetUsd,
    considered: candidates.length,
    suggestions: scored,
    package: pkg,
    paretoPackages,
    objective: `maximise CO₂ avoided + ${HEAT_WEIGHT_T}·heat-reduction-% per dollar (heat weight: calibrated proxy); ≤${MAX_PER_FAMILY} picks per intervention family (portfolio balance)`,
    note:
      "Candidates are scored independently through the full simulation; the package number is one joint run " +
      "(interactions included). Suggestions are recommendations against the policy baseline — accept, edit or reject.",
  };
}

/** Greedy knapsack under budget for a given heat-weight — returns picked ids. */
function greedyPickIds(scored: Suggestion[], budgetUsd: number, heatWeight: number): Set<string> {
  const ranked = [...scored]
    .filter((s) => s.aloneAvoidedT > 0 && !s.regrettable && s.feasibility.feasible)
    .map((s) => {
      const utility = s.aloneAvoidedT + heatWeight * s.aloneHeatReducedPct;
      return { s, density: utility / (s.modifier.economics.capexUsd / 1e6) };
    })
    .sort((a, b) => b.density - a.density);
  const ids = new Set<string>();
  const familyCount = new Map<string, number>();
  let spent = 0;
  for (const { s } of ranked) {
    if (ids.size >= MAX_PICKS) break;
    if (spent + s.modifier.economics.capexUsd > budgetUsd) continue;
    const fam = familyOf(s.modifier.id);
    if ((familyCount.get(fam) ?? 0) >= MAX_PER_FAMILY) continue;
    ids.add(s.modifier.id);
    familyCount.set(fam, (familyCount.get(fam) ?? 0) + 1);
    spent += s.modifier.economics.capexUsd;
  }
  return ids;
}

/**
 * Sweep the heat-weight to build distinct budget-feasible packages, jointly
 * simulate each through the REAL engine, and mark the non-dominated set.
 */
function buildPackageFrontier(
  scored: Suggestion[],
  recommended: Suggestion[],
  opts: { budgetUsd: number; startYear: number; endYear: number; pathway: PathwayId; shocks: Shock[] },
  world: WorldState
): ParetoPackage[] {
  const byId = new Map(scored.map((s) => [s.modifier.id, s]));
  const recKey = [...recommended.map((p) => p.modifier.id)].sort().join("|");

  // Distinct packages from a sweep of BOTH the objective weight (carbon-only →
  // heat-heavy) AND a budget fraction — the latter spreads points along the cost
  // axis so the frontier is a real curve, not a single point when the full
  // budget fits the same top picks under every weighting.
  const weights = [0, 15, 100];
  const budgetFracs = [0.35, 0.55, 0.75, 1.0];
  const seen = new Set<string>();
  const idSets: { ids: string[]; weight: number }[] = [];
  const MAX_PACKAGES = 10;
  for (const frac of budgetFracs) {
    for (const w of weights) {
      if (idSets.length >= MAX_PACKAGES) break;
      const ids = [...greedyPickIds(scored, opts.budgetUsd * frac, w)];
      const key = [...ids].sort().join("|");
      if (!ids.length || seen.has(key)) continue;
      seen.add(key);
      idSets.push({ ids, weight: w });
    }
  }

  const packages: ParetoPackage[] = idSets.map(({ ids, weight }) => {
    const mods = ids.map((id) => byId.get(id)!.modifier);
    const joint = simulateTimeline(world, mods, opts.startYear, opts.endYear, opts.pathway, opts.shocks);
    return {
      ids,
      labels: mods.map((m) => m.label),
      capexUsd: mods.reduce((s, m) => s + m.economics.capexUsd, 0),
      co2AvoidedT: joint.summary.cumulativeCO2AvoidedTonnes,
      heatReducedPct: joint.summary.heatExposureReducedPct,
      costPerTonneUsd: joint.summary.costPerTonneUsd,
      builtFromWeight: weight,
      onFrontier: false,
      isRecommended: [...ids].sort().join("|") === recKey,
    };
  });

  // Non-dominated over (co2 ↑, heat ↑, cost ↓).
  for (const p of packages) {
    p.onFrontier = !packages.some(
      (q) =>
        q !== p &&
        q.co2AvoidedT >= p.co2AvoidedT &&
        q.heatReducedPct >= p.heatReducedPct &&
        q.capexUsd <= p.capexUsd &&
        (q.co2AvoidedT > p.co2AvoidedT || q.heatReducedPct > p.heatReducedPct || q.capexUsd < p.capexUsd)
    );
  }
  return packages.sort((a, b) => a.capexUsd - b.capexUsd);
}
