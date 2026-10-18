// batch_sim.ts — run the REAL HELIO simulator over a matrix of (candidate × parameter sample).
//
// Used by the Python engine (engine/helios_engine/uncertainty, decision) for global sensitivity
// (Sobol), the value-of-information decision gate (EVPI/EVPPI) and the CVaR portfolio.
//
//   npx tsx scripts/batch_sim.ts < request.json > response.json
//
// request:  { mode: "candidates" }                        → list the optimizer's candidate interventions
//           { samples: Sample[], candidateIds?: string[], package?: string[][], startYear, endYear, pathway }
// Sample:   { behavioural, capexMult, evDisplace, betaHeatMult, betaCostMult, lambdaPt }
// response: { candidates: [{id,label,capexUsd}], results: number[sample][candidate][metric], metrics: [...] }

import fs from "fs";
import path from "path";
import { loadBaselineWorld } from "@/lib/compass/world/buildWorld";
import { simulateTimeline, clearBaselineCache } from "@/lib/compass/world/simulateTimeline";
import { setParamOverrides } from "@/lib/compass/world/agentChoice";
import { suggestModifiers } from "@/lib/compass/optimizer/suggestModifiers";
import { perturb } from "@/lib/compass/act/monteCarloFull";
import type { WorldModifier } from "@/lib/compass/world/types";
import type { PathwayId } from "@/lib/compass/policy/applyPolicy";

const METRICS = ["netCO2AvoidedT", "socialNpvUsd", "userBenefitPvUsd", "netBenefitUsd", "benefitCostRatio", "heatReducedPct", "capexUsd"] as const;

async function main() {
  const req = JSON.parse(fs.readFileSync(0, "utf8"));
  const world = await loadBaselineWorld();
  const startYear = req.startYear ?? 2026;
  const endYear = req.endYear ?? 2036;
  const pathway: PathwayId = req.pathway ?? "target_achieved";

  // Candidate interventions = the optimizer's own candidate set (real placements in the district).
  const evSites = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "ev_candidate_sites.json"), "utf8")).sites ?? [];
  setParamOverrides({});
  clearBaselineCache();
  const opt = suggestModifiers(world, { budgetUsd: 1e12, startYear, endYear, pathway, shocks: [], evSites, existingModifierIds: [] });
  const all: WorldModifier[] = opt.suggestions.filter((s) => !s.regrettable).map((s) => s.modifier);
  const byId = new Map(all.map((m) => [m.id, m]));
  const candidates = all.map((m) => ({ id: m.id, label: m.label, capexUsd: m.economics.capexUsd }));

  if (req.mode === "candidates") {
    process.stdout.write(JSON.stringify({ candidates }));
    return;
  }

  // Units of evaluation: single candidates, or packages (arrays of ids) for joint runs.
  const units: WorldModifier[][] = req.package
    ? (req.package as string[][]).map((ids) => ids.map((id) => byId.get(id)!).filter(Boolean))
    : (req.candidateIds ?? candidates.map((c) => c.id)).map((id: string) => [byId.get(id)!]);

  const results: number[][][] = [];
  for (const s of req.samples) {
    setParamOverrides({ betaHeatMult: s.betaHeatMult ?? 1, betaCostMult: s.betaCostMult ?? 1, lambdaPt: s.lambdaPt ?? NaN });
    clearBaselineCache();
    const row: number[][] = [];
    for (const unit of units) {
      const mods = unit.map((m) => perturb(m, s.behavioural ?? 1, s.capexMult ?? 1));
      const r = simulateTimeline(world, mods, startYear, endYear, s.pathway ?? pathway, [], "base", s.evDisplace ?? 0.5);
      const sm = r.summary;
      const user = sm.userBenefitPvUsd ?? 0;
      row.push([
        sm.netCO2AvoidedTonnes,
        sm.socialNpvUsd,
        user,
        sm.socialNpvUsd + user,
        sm.benefitCostRatio ?? 0,
        sm.heatExposureReducedPct,
        sm.capexUsd,
      ]);
    }
    results.push(row);
  }
  setParamOverrides({});
  clearBaselineCache();
  process.stdout.write(
    JSON.stringify({
      candidates: req.package ? (req.package as string[][]).map((ids, i) => ({ id: `pkg_${i}`, label: ids.join("+"), capexUsd: 0 })) : candidates.filter((c) => !req.candidateIds || req.candidateIds.includes(c.id)),
      metrics: METRICS,
      results,
    })
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
