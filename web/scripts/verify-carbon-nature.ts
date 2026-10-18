// verify-carbon-nature.ts — checks for carbon accounting, carbon-price what-ifs,
// intervention badges and nature screening. Run: npm run verify:carbon. Exits non-zero on failure.

import { promises as fs } from "fs";
import path from "path";
import { gridFactor, buildingScope2, draftDisclosure, stockPercentiles } from "@/lib/compass/carbon/ghg";
import { carbonPrice, satActivity, badgesForModifier } from "@/lib/compass/compliance/policy";
import { screen, TESTS } from "@/lib/compass/nature/screen";
import type { DistrictBuilding } from "@/lib/compass/compliance/facts";
import type { WorldModifier } from "@/lib/compass/world/types";
import { CAPABILITIES, DATASETS } from "@/lib/compass/openStack";
import { hazeEffect, psiToPm25, psiBand } from "@/lib/compass/air/haze";
import { shockFactors } from "@/lib/compass/shocks/applyShock";

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
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

async function main() {
  console.log("== Grid factor ==");
  check("2020 = 0.408 (EMA, data.gov.sg)", gridFactor(2020)?.value === 0.408 && !gridFactor(2020)!.carriedForward);
  check("2017 = 0.421", gridFactor(2017)?.value === 0.421);
  check("2024 = 0.402, secondary", gridFactor(2024)?.value === 0.402 && gridFactor(2024)?.confidence === "secondary");
  check("2030 carries 2024 forward, flagged", gridFactor(2030)?.year === "2024" && gridFactor(2030)!.carriedForward);
  check("before 2005 → null", gridFactor(2000) === null);

  console.log("\n== Scope 2 ==");
  const b: DistrictBuilding = { id: "t1", name: "Test", building_type: "office_large", cooling_system: "in_house", gfa_m2: 65947, eui: { "2019": 274.91, "2020": 250.89 }, provenance: {}, certificate: null };
  const g = buildingScope2(b)!;
  check("latest year chosen", g.year === "2020");
  check("kWh = EUI × GFA", near(g.kwh, 250.89 * 65947));
  check("tCO2 = kWh × 0.408 / 1000", near(g.scope2_t, (250.89 * 65947 * 0.408) / 1000), String(g.scope2_t));
  check("intensity = EUI × factor", near(g.intensity_kg_m2, 250.89 * 0.408));
  check("explicit year 2019 uses 0.4085", near(buildingScope2(b, "2019")!.scope2_t, (274.91 * 65947 * 0.4085) / 1000));
  check("no GFA → null", buildingScope2({ ...b, gfa_m2: undefined }) === null);

  console.log("\n== Disclosure draft ==");
  const asOf = "2026-10-16";
  const d = draftDisclosure({ name: "X", entity_type: "listed_large", financial_year: 2026, buildings: [b, { ...b, id: "t2", eui: {} }] }, asOf);
  check("one covered, one excluded", d.scope2.covered === 1 && d.scope2.excluded.length === 1);
  check("Scope 1 missing is flagged, not zero", d.scope1.t === null && d.gaps.some((x) => x.startsWith("Scope 1")));
  check("listed_large FY2026 must disclose Scope 1 & 2", /Scope 1 & 2/.test(d.obligations.summary), d.obligations.summary);
  check("carbon tax needs facility emissions", d.carbonTax.outcome === "needs_info");
  check("stale EUI year flagged", d.gaps.some((x) => x.includes("not FY2026 bills")));
  const d2 = draftDisclosure({ name: "Y", entity_type: "other", financial_year: 2026, buildings: [b], scope1_t: 120, largest_facility_scope1_t: 30000 }, asOf);
  check("other entity → not_applicable reporting", d2.obligations.outcome === "not_applicable");
  check("30,000 t facility taxed S$1.35M in 2026", d2.carbonTax.amountSgd === 1350000, String(d2.carbonTax.amountSgd));
  check("no valid cert + no rank → taxonomy unclassified", d.taxonomy.unknown_m2 === 65947 || d.perBuilding[0].sat?.outcome === "needs_info");
  const certified = draftDisclosure({ name: "Z", entity_type: "sti", financial_year: 2026, buildings: [{ ...b, certificate: { rating: "Platinum", scheme: "GM", issued: "2024-01-01", expires: "2028-01-01" } }] }, asOf);
  check("valid Green Mark → SAT Green", certified.perBuilding[0].sat?.tier === "Green");
  const expired = draftDisclosure({ name: "Z", entity_type: "sti", financial_year: 2026, buildings: [{ ...b, certificate: { rating: "Gold", scheme: "GM", issued: "2018-01-01", expires: "2021-01-01" }, stock_percentile: 0.2 }] }, asOf);
  check("expired cert, top 20% → SAT Amber", expired.perBuilding[0].sat?.tier === "Amber", expired.perBuilding[0].sat?.summary);

  console.log("\n== Stock percentile ==");
  const peers: DistrictBuilding[] = Array.from({ length: 20 }, (_, i) => ({ ...b, id: `p${i}`, eui: { "2020": 100 + i } }));
  const pct = stockPercentiles(peers);
  check("best building ranks 0", pct.get("p0")?.pct === 0);
  check("3rd of 20 ranks 0.1 (top 15%)", pct.get("p2")?.pct === 0.1);
  check("fewer than 10 peers → unranked", stockPercentiles(peers.slice(0, 5)).size === 0);

  console.log("\n== Carbon price (from rule JSONs) ==");
  check("law 2025 = S$25", carbonPrice(2025, "law").sgd === 25);
  check("law 2026 = S$45", carbonPrice(2026, "law").sgd === 45);
  check("law 2030 still S$45 (no later rate in the Act)", carbonPrice(2030, "law").sgd === 45 && carbonPrice(2030, "law").status === "law");
  check("central 2030 = S$65, proposed", carbonPrice(2030, "central").sgd === 65 && carbonPrice(2030, "central").status === "proposed");
  check("low 2030 = S$50", carbonPrice(2030, "low").sgd === 50);
  check("high 2030 = S$80", carbonPrice(2030, "high").sgd === 80);
  check("high 2028 = law S$45 (before 2030)", carbonPrice(2028, "high").sgd === 45 && carbonPrice(2028, "high").status === "law");
  check("high 2026 = law S$45", carbonPrice(2026, "high").sgd === 45);

  console.log("\n== Intervention badges ==");
  const mod = (effects: WorldModifier["effects"]): WorldModifier => ({ id: "m", label: "m", geometry: { type: "Point", coordinates: [103.74, 1.33] }, effects, economics: { capexUsd: 1, annualOpexUsd: 0, lifetimeYears: 20 }, metadata: { createdBy: "user", confidence: "measured", builtYear: 2027 } });
  check("solar → solar_pv", satActivity(mod({ solarAnnualKWhDelta: 1000 })) === "solar_pv");
  check("charger → ev_charging", satActivity(mod({ chargingCapacityKWDelta: 50 })) === "ev_charging");
  check("shade → active mobility", satActivity(mod({ shadeDelta: 0.2 })) === "active_mobility_infra");
  check("bus frequency → not mapped (stated)", satActivity(mod({ busWaitDeltaMin: -2 })) === null);
  const sb = badgesForModifier(mod({ solarAnnualKWhDelta: 1000 }), { asOf });
  check("solar badge = Taxonomy Green", sb.some((x) => x.key === "sat" && x.label === "Taxonomy Green" && x.tone === "good"));
  const host: DistrictBuilding = { ...b, building_type: "office_large", gfa_m2: 10000, eui: { "2020": 160 } };
  const hb = badgesForModifier(mod({ solarAnnualKWhDelta: 200000 }), { asOf, host });
  check("solar on BCA host → Green Mark badge", hb.some((x) => x.key === "gm"), hb.map((x) => x.label).join(", "));
  const evb = badgesForModifier(mod({ chargingCapacityKWDelta: 50 }), { asOf });
  check("charger → EVCA voluntary badge", evb.some((x) => x.key === "evca"));

  console.log("\n== Nature screening ==");
  const base = { d_protected: 5000, d_nature: 5000, d_habitat: 5000, d_water: 500, d_flood: 5000, veg_100m: 40, ground_m: 12, land_use: "RESIDENTIAL" };
  const clean = screen(base);
  check("clean site → all low", clean.groups.nature === "low" && clean.groups.flood === "low" && clean.groups.heat === "low" && clean.hits.length === 0);
  const inside = screen({ ...base, d_protected: 0, d_nature: 0 });
  check("inside reserve → nature high", inside.groups.nature === "high");
  check("inside beats within-500 m (one hit per metric)", inside.hits.filter((h) => h.metric === "d_protected").length === 1 && inside.hits.find((h) => h.metric === "d_protected")!.id === "protected_inside");
  check("ground 3.5 m → flood elevated (below 4 m MPL)", screen({ ...base, ground_m: 3.5 }).groups.flood === "elevated");
  check("ground 2.0 m → flood high", screen({ ...base, ground_m: 2 }).groups.flood === "high");
  check("unknown ground → flood unknown, not low", screen({ ...base, ground_m: null }).groups.flood === "unknown");
  check("near PUB flood spot → elevated", screen({ ...base, d_flood: 200 }).groups.flood === "elevated");
  check("8% greenery → heat elevated", screen({ ...base, veg_100m: 8 }).groups.heat === "elevated");
  check("every test has a source", TESTS.every((t) => t.source.length > 10));
  check("cited tests carry a URL", TESTS.filter((t) => t.basis === "cited").every((t) => !!t.url));

  console.log("\n== Built nature layer ==");
  try {
    const dir = path.join(process.cwd(), "data", "sg");
    const sky = JSON.parse(await fs.readFile(path.join(dir, "skyline.json"), "utf-8"));
    const nat = JSON.parse(await fs.readFile(path.join(dir, "nature", "buildings.json"), "utf-8"));
    const areas = JSON.parse(await fs.readFile(path.join(dir, "nature", "areas.json"), "utf-8"));
    check("aligned to skyline", nat.n === sky.lng.length && nat.d_protected.length === sky.lng.length);
    check("every planning area summarised", Object.keys(areas.areas).length === 55, String(Object.keys(areas.areas).length));
    check("all 36 PUB flood spots placed", Object.values<any>(areas.areas).reduce((s, a) => s + a.flood_spots.length, 0) === 36);
    check("Central Water Catchment mostly nature", areas.areas.central_water_catchment.nature_area_share > 0.7);
    const known = nat.ground_m.filter((v: number | null) => v != null) as number[];
    check("ground levels plausible (median 5–40 m)", (() => { const s = [...known].sort((a, b) => a - b); const m = s[s.length >> 1]; return m > 5 && m < 40; })());
  } catch (e) {
    check("nature layer built (run ingest/sg_nature.py)", false, String(e));
  }

  console.log("\n== Haze physics ==");
  check("PSI 100 → PM2.5 55 (NEA breakpoint)", psiToPm25(100) === 55);
  check("PSI 200 → PM2.5 150", psiToPm25(200) === 150);
  check("PSI 218 is 'Very unhealthy'", psiBand(218) === "Very unhealthy");
  check("clean air → no effect", hazeEffect(40, 30).cycleDropOnHazeDay === 0 && hazeEffect(40, 30).pvLossOnHazeDay === 0);
  const hz = hazeEffect(150, 30);
  check("PSI 150 → cycling down, PV down, both bounded", hz.cycleDropOnHazeDay > 0 && hz.cycleDropOnHazeDay <= 0.8 && hz.pvLossOnHazeDay > 0.05 && hz.pvLossOnHazeDay <= 0.35);
  check("cycling drop capped at 80%", hazeEffect(500, 30).cycleDropOnHazeDay === 0.8);
  const f = shockFactors([{ type: "haze", startYear: 2026, durationYears: 2, psi: 200, daysPerYear: 73 }], 2026);
  check("haze shock annualises by haze days (73 d = 20%)", Math.abs(f.solarMultiplier - (1 - hazeEffect(200, 73).pvLossOnHazeDay * 0.2)) < 1e-9 && f.hazeActivePenalty > 0);
  check("haze inactive outside its years", shockFactors([{ type: "haze", startYear: 2026, durationYears: 2, psi: 200, daysPerYear: 73 }], 2028).hazeActivePenalty === 0);

  console.log("\n== Open stack registry ==");
  const used = new Set(CAPABILITIES.flatMap((c) => c.datasets));
  check("every capability's datasets are registered", CAPABILITIES.every((c) => c.datasets.every((d) => !!DATASETS[d])), CAPABILITIES.flatMap((c) => c.datasets.filter((d) => !DATASETS[d])).join(","));
  check("every registered dataset is used", Object.keys(DATASETS).every((d) => used.has(d)), Object.keys(DATASETS).filter((d) => !used.has(d)).join(","));
  check("every dataset names a licence", Object.values(DATASETS).every((d) => d.licence.length > 3));
  check("every priced vendor claim links a source", CAPABILITIES.every((c) => c.replaces.every((r) => r.basis === "not_published" || !!r.source)));
  check("every capability says what's still out of reach", CAPABILITIES.every((c) => c.out_of_reach.length > 10));
  const ids = new Set(CAPABILITIES.map((c) => c.id));
  for (const f of ["components/v2/NaturePanel.tsx", "components/flow/CompliancePanel.tsx", "components/v2/SiteInspector.tsx", "app/sg/rules/page.tsx", "components/v2/AreaWorkspace.tsx"]) {
    const t = await fs.readFile(path.join(process.cwd(), f), "utf-8");
    const refs = [...t.matchAll(/ReplacesStrip[^>]*?id="([a-z_]+)"/g), ...t.matchAll(/(?:buildings|carbon|policy|vehicles): "([a-z_]+)"/g)].map((m) => m[1]);
    check(`${f}: strips point at real capabilities`, refs.length > 0 && refs.every((r) => ids.has(r)), refs.join(","));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main();
