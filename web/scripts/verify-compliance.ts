// verify-compliance.ts — runs every rule's embedded examples plus cross-rule
// checks. Run: npm run verify:compliance. Exits non-zero on any failure.

import { RULES, SOURCES } from "@/lib/compass/compliance/rules";
import { evaluateRule, evaluate } from "@/lib/compass/compliance/evaluate";
import { checkBuilding, checkVehicle, checkDistrictBuilding, DISTRICT_BUILDINGS } from "@/lib/compass/compliance/facts";
import { reconcileDraft, CANDIDATES_DIR } from "@/lib/compass/compliance/reconcile";
import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `   [${detail}]` : ""}`);
  }
}

console.log("== Rule metadata ==");
for (const r of RULES) {
  check(`${r.id}: cites a known source`, !!SOURCES[r.citation.source], r.citation.source);
  check(`${r.id}: has a quote`, r.citation.quote.length > 10);
  check(`${r.id}: effective window valid`, !r.effective_to || r.effective_from <= r.effective_to);
  check(`${r.id}: has examples`, (r.examples?.length ?? 0) >= 3);
}

console.log("\n== Rule examples ==");
for (const r of RULES) {
  for (const ex of r.examples ?? []) {
    const f = evaluateRule(r, ex.facts, { asOf: ex.asOf, includeDraft: !!(ex as any).whatIf });
    const problems: string[] = [];
    if (ex.expect.outcome && f.outcome !== ex.expect.outcome) problems.push(`outcome ${f.outcome} ≠ ${ex.expect.outcome}`);
    if (ex.expect.tier && f.tier !== ex.expect.tier) problems.push(`tier ${f.tier} ≠ ${ex.expect.tier}`);
    if (ex.expect.amount_sgd !== undefined && f.amountSgd !== ex.expect.amount_sgd) problems.push(`amount ${f.amountSgd} ≠ ${ex.expect.amount_sgd}`);
    check(`${r.id} — ${ex.name}`, problems.length === 0, `${problems.join("; ")} | ${f.summary}`);
  }
}

console.log("\n== Cross-rule ==");
{
  // EV at 150 Wh/km → 60 g/km at 0.4 g/Wh → Band A; ARF S$5k with S$22.5k VES + S$2.25k EEAI → floored at S$0 ARF.
  const v = checkVehicle({ vehicle_class: "car", fuel: "electric", whPerKm: 150, arf_sgd: 5000 }, "2026-06-01");
  check("EV Wh/km converts to VES CO₂ (0.4 g/Wh)", v.facts.co2_g_km === 60, String(v.facts.co2_g_km));
  check("EV → VES Band A", v.findings[0].tier === "A");
  check("$0 ARF floor caps combined rebate", v.floored && v.netSgd === -5000, `net ${v.netSgd}`);

  const big = checkVehicle({ vehicle_class: "car", fuel: "electric", whPerKm: 150, arf_sgd: 60000 }, "2026-06-01");
  check("EV with ARF S$60k gets full S$30k (VES 22.5k + EEAI 7.5k)", !big.floored && big.netSgd === -30000, `net ${big.netSgd}`);

  const ev2027 = checkVehicle({ vehicle_class: "car", fuel: "electric", whPerKm: 150, arf_sgd: 60000 }, "2027-06-01");
  check("2027: VES only (S$20k), EEAI ceased", ev2027.netSgd === -20000, `net ${ev2027.netSgd}`);
}
{
  // Green Mark EUI tier feeds SLE label; solar nets off EUI.
  const b = checkBuilding({ building_type: "office_large", cooling_system: "in_house", gfa_m2: 40000, annual_kwh: 4400000, onsite_re_kwh: 0 }, "2026-10-16");
  check("EUI 110 → SLE tier", b.findings[0].tier === "SLE", b.findings[0].summary);
  check("SLE tier propagates to energy label", b.findings[1].tier === "SLE", b.findings[1].summary);

  const pe = checkBuilding({ building_type: "office_large", cooling_system: "in_house", gfa_m2: 10000, annual_kwh: 1000000, onsite_re_kwh: 1200000 }, "2026-10-16");
  check("115%+ on-site solar on an SLE building → PE", pe.findings[1].tier === "PE", pe.findings[1].summary);

  const noTier = evaluate({ building_type: "office_large", cooling_system: "in_house", eui_kwh_m2_yr: 150 }, RULES.filter((r) => r.applies_to.asset?.includes("building")), { asOf: "2026-10-16" });
  check("Measured GoldPLUS EUI → not SLE", noTier[1].outcome === "fail", noTier[1].summary);
  check("Next step quantifies the gap to Platinum", (noTier[0].nextStep ?? "").includes("10 kWh"), noTier[0].nextStep);
}

{
  // Real Jurong East data (BCA measured EUI).
  const jem = DISTRICT_BUILDINGS.find((b) => b.id === "jem")!;
  const now = checkDistrictBuilding(jem, "2026-10-16");
  check("JEM measured EUI 312 → below GM2021 Gold (mall ≤300)", now.findings[0].outcome === "fail", now.findings[0].summary);
  check("JEM below Gold → not SLE (fail, not needs_info)", now.findings[1].outcome === "fail", now.findings[1].summary);
  const solar = checkDistrictBuilding(jem, "2026-10-16", { addSolarKwh: jem.rooftop_solar.annual_kwh });
  check("JEM + measured rooftop solar → Gold", solar.findings[0].tier === "Gold", solar.findings[0].summary);
  check("Solar result is labelled modelled", solar.findings[0].inputConfidence === "modelled");
  check("Measured EUI is labelled measured", now.findings[0].inputConfidence === "measured", now.findings[0].inputConfidence);
  const gent = checkDistrictBuilding(DISTRICT_BUILDINGS.find((b) => b.id === "genting")!, "2026-10-16");
  check("Genting Hotel cert expired 30 Jun 2026", gent.certStatus === "expired");
  check("Genting EUI 202.6 → Platinum", gent.findings[0].tier === "Platinum", gent.findings[0].summary);
  const jden = checkDistrictBuilding(DISTRICT_BUILDINGS.find((b) => b.id === "jden")!, "2026-10-16");
  check("Residential → EUI pathway not applicable", jden.findings[0].outcome === "not_applicable");
}

console.log("\n== Gemma drafts vs engine ==");
{
  const r1 = reconcileDraft({ doc: "carbon_pricing_act_2018", title: "Carbon tax rate for 2026 or later", metric: "carbon tax rate", unit: "$/tCO2e", value: 45 });
  check("CPA S$45 rate draft matches rates[2]", r1.status === "matches_engine" && r1.matches.some((m) => m.path === "rates[2].sgd_per_t"));
  const r2 = reconcileDraft({ doc: "carbon_pricing_act_2018", title: "Second emissions threshold", metric: "emissions", unit: "tCO2e", value: 25000 });
  check("CPA 25,000 t threshold draft matches thresholds.taxable_tco2e", r2.matches.some((m) => m.path === "thresholds.taxable_tco2e"));
  const r3 = reconcileDraft({ doc: "carbon_pricing_act_2018", title: "Fixed-price carbon credit value for 2027 or later", metric: "fixed-price carbon credit value", unit: "$", value: 45 });
  check("same number, different meaning (credit value) → not a match", r3.status === "not_in_engine");
  const r4 = reconcileDraft({ doc: "carbon_pricing_act_2018", title: "Carbon tax rate", value: 99 });
  check("wrong number → not in engine", r4.status === "not_in_engine");
  check("text-only draft → no checkable value", reconcileDraft({ doc: "carbon_pricing_act_2018", title: "Exemption" }).status === "no_checkable_value");
  for (const f of existsSync(CANDIDATES_DIR) ? readdirSync(CANDIDATES_DIR).filter((x) => x.endsWith(".json")) : []) {
    const c = JSON.parse(readFileSync(path.join(CANDIDATES_DIR, f), "utf-8"));
    check(`candidate ${f}: draft status, cited, not registered`, c.status === "draft" && c.citation?.quote?.length > 10 && !RULES.some((r) => r.id === c.id));
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
