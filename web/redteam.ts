// redteam.ts — stress-test suite of deliberately BAD interventions.
//
// Run: npm run redteam   (or: npx tsx redteam.ts)
//
// Proves HELIO does not just say "implement" to everything: it defers
// problem-shifts, blocks impossible sitings, and exposes bad cost-per-tonne.
// Exits non-zero if any *critical* bad idea slips through — a regression guard
// alongside `npm run verify`. Non-critical "watch" scenarios surface yes-bias
// gaps (e.g. no automatic cost-effectiveness ceiling) without failing the build.

import { runRedTeam } from "@/lib/compass/redteam/scenarios";

async function main() {
  console.log("== HELIO Flow red-team (bad interventions that should be rejected) ==\n");
  const report = await runRedTeam();

  for (const r of report.rows) {
    const tag = r.status === "caught" ? "✓ CAUGHT" : "✗ MISSED";
    const crit = r.critical ? " [critical]" : " [watch]";
    console.log(`${tag}${crit}  ${r.label}`);
    console.log(`    why bad : ${r.whyBad}`);
    console.log(`    expected: ${r.expected}`);
    console.log(`    observed: ${r.observed}\n`);
  }

  const { caught, total, criticalMissed } = report.summary;
  console.log(`caught ${caught}/${total} · critical missed ${criticalMissed}`);
  if (criticalMissed > 0) {
    console.log("\n✗ RED-TEAM FAILED — a critical bad intervention was not rejected.");
    process.exit(1);
  }
  console.log("\n✓ Red-team passed — every critical bad intervention was rejected.");
}

main().catch((e) => { console.error(e); process.exit(1); });
