// stress.ts — hammer the live judge-facing endpoints and report latency + errors.
//   BASE=http://localhost:3001 npx tsx scripts/stress.ts        (production build)
//   BASE=https://<cloud-run-url> npx tsx scripts/stress.ts        (deployed)
// Exits non-zero if any endpoint errors or its p95 exceeds its budget.

const BASE = process.env.BASE ?? "http://localhost:3001";

type Case = { name: string; method?: "GET" | "POST"; path: string; body?: unknown; concurrency: number; requests: number; p95BudgetMs: number };

const haze = [{ type: "haze", startYear: 2026, durationYears: 3, psi: 200, daysPerYear: 30 }];
const CASES: Case[] = [
  { name: "page /sg", path: "/sg", concurrency: 10, requests: 40, p95BudgetMs: 3000 },
  { name: "page /bangkok", path: "/bangkok", concurrency: 10, requests: 30, p95BudgetMs: 3000 },
  { name: "page /india/delhi-ncr/sandbox", path: "/india/delhi-ncr/sandbox", concurrency: 10, requests: 30, p95BudgetMs: 3000 },
  { name: "island skyline layer", path: "/api/sg/layer/skyline", concurrency: 5, requests: 20, p95BudgetMs: 6000 },
  { name: "nature screen (building)", path: "/api/sg/nature?lng=103.945&lat=1.353", concurrency: 20, requests: 200, p95BudgetMs: 800 },
  { name: "BCA buildings (area)", path: "/api/sg/buildings?area=downtown_core", concurrency: 20, requests: 100, p95BudgetMs: 800 },
  { name: "live air · Singapore", path: "/api/air?city=singapore", concurrency: 20, requests: 100, p95BudgetMs: 3000 },
  { name: "live air · Bangkok", path: "/api/air?city=bangkok", concurrency: 10, requests: 40, p95BudgetMs: 3000 },
  { name: "live air · Delhi", path: "/api/air?city=delhi-ncr", concurrency: 10, requests: 40, p95BudgetMs: 3000 },
  { name: "simulate Tampines + haze", method: "POST", path: "/api/compass/simulate", body: { districtId: "tampines", modifiers: [], shocks: haze }, concurrency: 8, requests: 40, p95BudgetMs: 8000 },
  { name: "agent tool: candidates", method: "POST", path: "/api/studio/tools", body: { tool: "list_candidate_changes", args: { area: "tampines" } }, concurrency: 8, requests: 24, p95BudgetMs: 15000 },
  { name: "agent tool: simulate plan", method: "POST", path: "/api/studio/tools", body: { tool: "simulate_plan", args: { area: "tampines", change_ids: ["opt_shade_EW2|EW3", "opt_cycle_EW2|EW3"], shocks: haze } }, concurrency: 8, requests: 40, p95BudgetMs: 8000 },
  { name: "agent tool: compliance", method: "POST", path: "/api/studio/tools", body: { tool: "check_compliance", args: { area: "tampines", change_ids: ["opt_shade_EW2|EW3"] } }, concurrency: 10, requests: 50, p95BudgetMs: 2000 },
  { name: "agent tool: screen sites", method: "POST", path: "/api/studio/tools", body: { tool: "screen_sites", args: { area: "tampines", change_ids: ["opt_shade_EW2|EW3"] } }, concurrency: 10, requests: 50, p95BudgetMs: 2000 },
  { name: "bad input rejected", method: "POST", path: "/api/studio/tools", body: { tool: "simulate_plan", args: { area: "atlantis" } }, concurrency: 5, requests: 10, p95BudgetMs: 1000 },
];

const pct = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

async function hit(c: Case) {
  const t0 = performance.now();
  try {
    const r = await fetch(BASE + c.path, {
      method: c.method ?? "GET",
      headers: c.body ? { "Content-Type": "application/json" } : undefined,
      body: c.body ? JSON.stringify(c.body) : undefined,
      signal: AbortSignal.timeout(60000),
    });
    await r.arrayBuffer();
    const expectedFail = c.name.startsWith("bad input");
    return { ms: performance.now() - t0, ok: expectedFail ? r.status === 400 : r.ok, status: r.status };
  } catch (e: any) {
    return { ms: performance.now() - t0, ok: false, status: e?.name ?? "ERR" };
  }
}

async function runCase(c: Case) {
  await hit(c); // warm-up (cold caches are measured separately by the first real request in production)
  const results: Awaited<ReturnType<typeof hit>>[] = [];
  let next = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: c.concurrency }, async () => {
      while (next < c.requests) {
        next++;
        results.push(await hit(c));
      }
    })
  );
  const wall = (performance.now() - t0) / 1000;
  const ms = results.map((r) => r.ms);
  const errors = results.filter((r) => !r.ok);
  const p95 = pct(ms, 95);
  return { name: c.name, n: results.length, conc: c.concurrency, rps: results.length / wall, p50: pct(ms, 50), p95, max: Math.max(...ms), errors: errors.length, statuses: [...new Set(errors.map((e) => e.status))], pass: errors.length === 0 && p95 <= c.p95BudgetMs, budget: c.p95BudgetMs };
}

(async () => {
  console.log(`Stress test → ${BASE}\n`);
  console.log("endpoint".padEnd(32), "n".padStart(4), "conc".padStart(5), "req/s".padStart(7), "p50".padStart(7), "p95".padStart(7), "max".padStart(7), "err".padStart(4), " result");
  let failed = 0;
  for (const c of CASES) {
    const r = await runCase(c);
    if (!r.pass) failed++;
    console.log(
      r.name.padEnd(32),
      String(r.n).padStart(4),
      String(r.conc).padStart(5),
      r.rps.toFixed(1).padStart(7),
      `${Math.round(r.p50)}`.padStart(7),
      `${Math.round(r.p95)}`.padStart(7),
      `${Math.round(r.max)}`.padStart(7),
      String(r.errors).padStart(4),
      r.pass ? " ✓" : ` ✗ ${r.errors ? `errors ${r.statuses.join(",")}` : `p95 > ${r.budget} ms`}`
    );
  }
  console.log(`\n${CASES.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
