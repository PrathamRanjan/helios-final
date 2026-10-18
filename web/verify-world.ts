// verify-world.ts — standalone invariant checker for the HELIO Flow engine.
//
// Run: npm run verify   (or: npx tsx verify-world.ts)
//
// No server, no browser: imports the pure engine and asserts the facts that
// MUST hold for every simulation. If any edit to the world model, policy,
// shocks, agents or scenario math breaks one of these, this fails loudly —
// the demo's 40%-feasibility armor. Exits non-zero on any failure.

import { loadBaselineWorld } from "@/lib/compass/world/buildWorld";
import { simulateTimeline, evaluateWorld } from "@/lib/compass/world/simulateTimeline";
import { affectedEdgeWeights } from "@/lib/compass/world/modifiers";
import { MODES, modeShares, nestedShares, logsum, utility } from "@/lib/compass/world/agentChoice";
import cal from "@/data/assumptions/calibrated/mode_choice_calibrated.json";
import { policyYear } from "@/lib/compass/policy/applyPolicy";
import { buildModifier } from "@/lib/compass/flow/scenario";
import type { Mode, ModeSplit, ScenarioResult, Shock, WorldModifier } from "@/lib/compass/world/types";

const START = 2026;
const END = 2036;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? `   [${detail}]` : ""}`);
  }
}

function approx(a: number, b: number, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

function sumSplit(s: ModeSplit): number {
  return MODES.reduce((acc, m) => acc + (s[m as Mode] ?? 0), 0);
}

async function main() {
  console.log("== HELIO Flow world invariants ==\n");

  const world = await loadBaselineWorld("jurong_east", START);

  // ---- 1. Per-edge mode shares are a probability distribution ----
  console.log("mode-choice");
  let allEdgesOk = true;
  let minShare = 1;
  for (const edge of world.edges) {
    const s = modeShares(edge);
    if (!approx(sumSplit(s), 1, 1e-6)) allEdgesOk = false;
    for (const m of MODES) {
      if (s[m] < -1e-9) allEdgesOk = false;
      minShare = Math.min(minShare, s[m]);
    }
  }
  check("every corridor's mode shares sum to 1", allEdgesOk);
  check("no negative mode probability", minShare >= -1e-9, `min=${minShare.toExponential(2)}`);

  // ---- 2. evaluateWorld aggregate share also sums to 1 ----
  const ef2026 = policyYear("frozen", START).efByMode;
  const agg = evaluateWorld(world, ef2026);
  check("aggregate mode share sums to 1", approx(sumSplit(agg.modeShare), 1, 1e-6), `sum=${sumSplit(agg.modeShare).toFixed(6)}`);
  check("baseline CO₂ is positive", agg.co2Tonnes > 0, `${agg.co2Tonnes.toFixed(1)} t`);
  check("baseline heat index is non-negative", agg.heatIndex >= 0);

  // ---- 3. Zero-modifier scenario reproduces its own baseline exactly ----
  console.log("\nbaseline consistency");
  const empty: ScenarioResult = simulateTimeline(world, [], START, END, "target_achieved", []);
  let mirrorOk = true;
  let maxDelta = 0;
  for (let i = 0; i < empty.timeline.length; i++) {
    const d = Math.abs(empty.timeline[i].transportCO2Tonnes - empty.baselineTimeline[i].transportCO2Tonnes);
    maxDelta = Math.max(maxDelta, d);
    if (d > 1e-6) mirrorOk = false;
  }
  check("zero-modifier run == its baseline every year", mirrorOk, `maxΔ=${maxDelta}`);
  check("zero-modifier avoids ~0 t", Math.abs(empty.summary.cumulativeCO2AvoidedTonnes) < 0.1, `${empty.summary.cumulativeCO2AvoidedTonnes} t`);
  check("zero-modifier cost-per-tonne is null", empty.summary.costPerTonneUsd === null);

  // ---- 4. Every year: CO2 non-negative, shares valid, cumulative monotone ----
  console.log("\ntimeline sanity (scenario)");
  const shade: WorldModifier = buildModifier({
    geometry: { type: "LineString", coordinates: [[103.742, 1.333], [103.746, 1.335]] },
    capabilityIds: ["adds_shade", "allows_cycling"],
    costTier: "med",
    builtYear: 2027,
  });
  const scen = simulateTimeline(world, [shade], START, END, "target_achieved", []);
  let co2ok = true;
  let sharesOk = true;
  let cumMonotone = true;
  let prevCum = -Infinity;
  for (const y of scen.timeline) {
    if (y.transportCO2Tonnes < 0) co2ok = false;
    // YearResult.modeShare is display-rounded to 3 dp; 5 modes → up to 2.5e-3 drift.
    // Raw shares already asserted == 1 above; this guards against real imbalance.
    if (!approx(sumSplit(y.modeShare), 1, 3e-3)) sharesOk = false;
    if (y.cumulativeCO2AvoidedTonnes < prevCum - 1e-6) cumMonotone = false;
    prevCum = y.cumulativeCO2AvoidedTonnes;
  }
  check("scenario CO₂ never negative", co2ok);
  check("scenario yearly mode shares sum to 1", sharesOk);
  check("cumulative avoided is non-decreasing", cumMonotone);
  check("a beneficial modifier avoids > 0 t", scen.summary.cumulativeCO2AvoidedTonnes > 0, `${scen.summary.cumulativeCO2AvoidedTonnes} t`);
  check("beneficial modifier yields a cost-per-tonne", scen.summary.costPerTonneUsd !== null && scen.summary.costPerTonneUsd > 0);

  // ---- 5. Ramp: a modifier built in 2027 does nothing in 2026 ----
  const preBuiltYear = scen.timeline.find((y) => y.year === 2026);
  check("modifier inactive before its built year", !!preBuiltYear && Math.abs(preBuiltYear.annualCO2AvoidedTonnes) < 0.1, `2026 avoided=${preBuiltYear?.annualCO2AvoidedTonnes}`);

  // ---- 6. Shock recovery: a shock that ends returns baseline to normal ----
  console.log("\nshock recovery");
  const shock: Shock = { type: "heatwave", startYear: 2029, durationYears: 2, severity: 0.6 };
  const shocked = simulateTimeline(world, [], START, END, "target_achieved", [shock]);
  const clean = empty; // same pathway, no shock
  const idx2028 = 2028 - START;
  const idx2035 = 2035 - START;
  const pre = Math.abs(shocked.baselineTimeline[idx2028].heatExposureIndex - clean.baselineTimeline[idx2028].heatExposureIndex);
  const post = Math.abs(shocked.baselineTimeline[idx2035].heatExposureIndex - clean.baselineTimeline[idx2035].heatExposureIndex);
  check("pre-shock year matches no-shock baseline", pre < 1e-6, `Δ=${pre}`);
  check("post-shock year recovers to no-shock baseline", post < 1e-6, `Δ=${post}`);

  // ---- 6b. Lifecycle / embodied carbon ----
  console.log("\nlifecycle (embodied carbon)");
  check("zero-modifier embodied = 0", Math.abs(empty.summary.embodiedCO2Tonnes) < 1e-6);
  check("zero-modifier net = 0", Math.abs(empty.summary.netCO2AvoidedTonnes) < 1e-6);
  check("zero-modifier payback null", empty.summary.carbonPaybackYear === null);

  const solar = simulateTimeline(
    world,
    [buildModifier({ geometry: { type: "Polygon", coordinates: [[[103.742, 1.333], [103.746, 1.333], [103.746, 1.336], [103.742, 1.336], [103.742, 1.333]]] }, capabilityIds: ["solar_canopy"], costTier: "high", builtYear: 2027 })],
    START, END, "target_achieved", []
  );
  const ss = solar.summary;
  check("solar embodied > 0", ss.embodiedCO2Tonnes > 0, `${ss.embodiedCO2Tonnes} t`);
  check("net == operational − embodied", Math.abs(ss.netCO2AvoidedTonnes - (ss.cumulativeCO2AvoidedTonnes - ss.embodiedCO2Tonnes)) < 0.2);
  check("net-negative flag consistent", ss.netNegativeOnCarbon === (ss.embodiedCO2Tonnes > ss.cumulativeCO2AvoidedTonnes));
  check("beneficial asset pays back within horizon", ss.carbonPaybackYear !== null && ss.carbonPaybackYear >= START && ss.carbonPaybackYear <= END);

  // Circular procurement can only REDUCE embodied carbon.
  const evPoint = { type: "Point" as const, coordinates: [103.744, 1.334] as [number, number] };
  const evStd = simulateTimeline(world, [buildModifier({ geometry: evPoint, capabilityIds: ["ev_charging", "battery"], costTier: "high", builtYear: 2027 })], START, END, "target_achieved", []);
  const evCirc = simulateTimeline(world, [buildModifier({ geometry: evPoint, capabilityIds: ["ev_charging", "battery"], costTier: "high", builtYear: 2027, circular: { secondLifeBattery: true, modular: true } })], START, END, "target_achieved", []);
  check("second-life + modular reduces embodied", evCirc.summary.embodiedCO2Tonnes < evStd.summary.embodiedCO2Tonnes, `${evCirc.summary.embodiedCO2Tonnes} < ${evStd.summary.embodiedCO2Tonnes}`);
  check("circular improves net avoided", evCirc.summary.netCO2AvoidedTonnes > evStd.summary.netCO2AvoidedTonnes);

  // EV displacement sensitivity: conservative < base < aggressive.
  const evMod = buildModifier({ geometry: evPoint, capabilityIds: ["ev_charging"], costTier: "high", builtYear: 2027 });
  const cons = simulateTimeline(world, [evMod], START, END, "target_achieved", [], "conservative").summary.cumulativeCO2AvoidedTonnes;
  const base = simulateTimeline(world, [evMod], START, END, "target_achieved", [], "base").summary.cumulativeCO2AvoidedTonnes;
  const aggr = simulateTimeline(world, [evMod], START, END, "target_achieved", [], "aggressive").summary.cumulativeCO2AvoidedTonnes;
  check("EV displacement band ordered cons<base<aggr", cons < base && base < aggr, `${cons}<${base}<${aggr}`);

  // ---- 6c. Finance (B2G) ----
  console.log("\nfinance");
  check("zero-modifier capex = 0", empty.summary.capexUsd === 0);
  check("zero-modifier no money payback", empty.summary.moneyPaybackYear === null);
  // Solar earns energy revenue → should pay back and have positive NPV.
  check("solar has positive capex", ss.capexUsd > 0, `${ss.capexUsd}`);
  check("solar pays back on cash (energy revenue)", ss.moneyPaybackYear !== null, `${ss.moneyPaybackYear}`);
  check("solar social NPV positive", ss.socialNpvUsd > 0, `${ss.socialNpvUsd}`);
  check("budget share is capex/budget", ss.budgetSharePct > 0 && ss.budgetSharePct < 100);
  // Walkway earns no cash → honestly never pays back.
  const walk = simulateTimeline(world, [buildModifier({ geometry: { type: "LineString", coordinates: [[103.742, 1.333], [103.746, 1.335]] }, capabilityIds: ["rain_protection"], costTier: "med", builtYear: 2027 })], START, END, "target_achieved", []);
  check("walkway has real capex (unit-cost)", walk.summary.capexUsd > 100000, `${walk.summary.capexUsd}`);
  check("walkway never pays back on cash", walk.summary.moneyPaybackYear === null);

  // Reconciliation: cost-per-tonne capex basis == finance capex basis (one source).
  check("totalCapexUsd == finance capexUsd (reconciled)", ss.totalCapexUsd === ss.capexUsd, `${ss.totalCapexUsd} vs ${ss.capexUsd}`);
  check("walkway capex reconciled too", walk.summary.totalCapexUsd === walk.summary.capexUsd);
  // Build-year timing: a later-built identical modifier defers cost → different NPV.
  const early = simulateTimeline(world, [buildModifier({ geometry: evPoint, capabilityIds: ["ev_charging"], costTier: "high", builtYear: 2027 })], START, END, "target_achieved", []);
  const late = simulateTimeline(world, [buildModifier({ geometry: evPoint, capabilityIds: ["ev_charging"], costTier: "high", builtYear: 2033 })], START, END, "target_achieved", []);
  check("build-year timing affects NPV (capex/O&M phased)", early.summary.socialNpvUsd !== late.summary.socialNpvUsd, `early ${early.summary.socialNpvUsd} vs late ${late.summary.socialNpvUsd}`);

  // ---- 6d. Regrettable substitution ----
  console.log("\nregrettable substitution");
  const { substitutionRisk } = await import("@/lib/compass/lifecycle/substitution");
  // A standalone battery: pure embodied debt, no operational/heat benefit → regrettable.
  const batteryOnly = simulateTimeline(world, [buildModifier({ geometry: evPoint, capabilityIds: ["battery"], costTier: "high", builtYear: 2027 })], START, END, "target_achieved", []);
  check("standalone battery flagged regrettable", substitutionRisk(batteryOnly.summary).regrettable, `netNeg=${batteryOnly.summary.netNegativeOnCarbon} heat=${batteryOnly.summary.heatExposureReducedPct}`);
  // Solar clearly not regrettable.
  check("solar not regrettable", !substitutionRisk(ss).regrettable);
  // Walkway+shade (carbon-negative but real heat) is a tradeoff, not regrettable.
  const walkShade = simulateTimeline(world, [buildModifier({ geometry: { type: "LineString", coordinates: [[103.742, 1.333], [103.746, 1.335]] }, capabilityIds: ["rain_protection", "adds_shade"], costTier: "med", builtYear: 2027 })], START, END, "target_achieved", []);
  check("walkway+shade is a tradeoff, not regrettable", !substitutionRisk(walkShade.summary).regrettable, `heat=${walkShade.summary.heatExposureReducedPct}`);

  // ---- 7. Determinism: same inputs → same output ----
  console.log("\ndeterminism");
  const again = simulateTimeline(world, [shade], START, END, "target_achieved", []);
  check(
    "identical inputs produce identical cumulative avoided",
    approx(again.summary.cumulativeCO2AvoidedTonnes, scen.summary.cumulativeCO2AvoidedTonnes, 1e-9),
  );

  // ---- 8. Nested logit + census calibration ----
  console.log("\nnested logit (census-calibrated)");
  {
    const u = { car: 0.2, bus: -0.4, mrt: 0.1, walk: -1.0, cycle: -2.0 } as Record<Mode, number>;
    const nl1 = nestedShares(u, { pt: 1, active: 1 });
    const mx = Math.max(...Object.values(u));
    const den = MODES.reduce((a, m) => a + Math.exp(u[m as Mode] - mx), 0);
    check("λ=1 nested logit equals multinomial logit", MODES.every((m) => approx(nl1[m as Mode], Math.exp(u[m as Mode] - mx) / den, 1e-12)));

    const p0 = nestedShares(u);
    const p1 = nestedShares({ ...u, bus: u.bus + 0.5 });
    const dropCar = (p0.car - p1.car) / p0.car;
    const dropMrt = (p0.mrt - p1.mrt) / p0.mrt;
    check("better bus draws proportionally more from MRT than car (IIA fixed)", dropMrt > dropCar && dropCar > 0, `mrt ${dropMrt.toFixed(4)} car ${dropCar.toFixed(4)}`);

    // District baseline split must equal the accepted baseline the engine was calibrated to keep.
    const target = (cal as any).runtime.baseline_split_target as Record<Mode, number>;
    const agg: any = { car: 0, bus: 0, mrt: 0, walk: 0, cycle: 0 };
    let tot = 0;
    for (const e of world.edges) {
      const sh = modeShares(e);
      for (const m of MODES) agg[m] += sh[m as Mode] * e.totalTripsDaily;
      tot += e.totalTripsDaily;
    }
    const maxGap = Math.max(...MODES.map((m) => Math.abs(agg[m] / tot - target[m as Mode])));
    check("district baseline split preserved under nested logit (<0.1pp)", maxGap < 1e-3, `max gap ${(maxGap * 100).toFixed(4)}pp`);

    // Logsum welfare: improving one mode can never make travellers worse off.
    const e0 = world.edges[0];
    const better = { ...e0, attrs: { ...e0.attrs, shadeScore: Math.min(1, e0.attrs.shadeScore + 0.3) } };
    check("logsum rises when a corridor gets more shade (ΔCS ≥ 0)", logsum(better) >= logsum(e0) - 1e-12);

    // Census planning-area effects are actually applied to mapped corridors.
    const mapped = world.edges.find((e) => (cal as any).runtime.edge_pa[e.id] === "Jurong East");
    const none = simulateTimeline(world, [], START, END, "target_achieved", []);
    check("no intervention → zero traveller benefit", approx(none.summary.userBenefitPvUsd ?? 0, 0, 1e-6));
    check("shade intervention → positive traveller benefit (ΔCS > 0)", (scen.summary.userBenefitPvUsd ?? 0) > 0, `PV $${scen.summary.userBenefitPvUsd}`);
    check("benefit-cost ratio reported for a costed intervention", typeof scen.summary.benefitCostRatio === "number", `BCR ${scen.summary.benefitCostRatio}`);
    console.log(`    (shade: user benefit $${scen.summary.userBenefitUsdPerYear}/yr, PV $${scen.summary.userBenefitPvUsd}, BCR ${scen.summary.benefitCostRatio}, capex $${scen.summary.capexUsd})`);
    // Coverage weighting: a short linear intervention only changes the part of a long trip it covers.
    {
      const shortWalk = buildModifier({ geometry: { type: "LineString", coordinates: [[103.742, 1.333], [103.7445, 1.334]] }, capabilityIds: ["adds_shade"], costTier: "low", builtYear: 2027 });
      const wts = [...affectedEdgeWeights(world, shortWalk).entries()];
      const longGrazed = wts.filter(([id, w]) => (world.edges.find((e) => e.id === id)?.distKm ?? 0) > 2 && w < 0.5);
      check("short walkway gives only partial coverage to long corridors it grazes", longGrazed.length > 0 && wts.every(([, w]) => w <= 1 + 1e-9), `${longGrazed.length} long corridors partially covered`);
    }
    const eq = scen.summary.equity;
    check("equity: benefit incidence reported with shares in [0,1]", !!eq && [eq.seniorBenefitShare, eq.seniorTripShare, eq.lowIncomeBenefitShare, eq.lowIncomeTripShare].every((x) => x >= 0 && x <= 1), eq ? `seniors ${eq.seniorBenefitShare} of benefit vs ${eq.seniorTripShare} of trips (×${eq.seniorIncidenceRatio})` : "missing");
    check("equity: no intervention → no incidence claimed", none.summary.equity == null);
    check("planning-area constants applied to mapped corridors", !!mapped && Math.abs(utility("walk", mapped!) - utility("walk", { ...mapped!, id: "__unmapped__" })) > 1e-6);
  }

  // ---- summary ----
  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("verify-world crashed:", e);
  process.exit(1);
});
