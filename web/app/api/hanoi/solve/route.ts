import { NextRequest, NextResponse } from "next/server";
import { solveSite, solvePortfolio, optimizePortfolio, type CandidateSite } from "@/lib/hanoi/gridMath";

export const runtime = "nodejs";

/**
 * HELIO Hanoi — portfolio solver endpoint.
 * POST { candidates: CandidateSite[], deployedIds: string[], budgetUSD?: number }
 * Returns portfolio-level and per-site results.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const candidates = (body.candidates ?? []) as CandidateSite[];
  const deployedIds = new Set((body.deployedIds ?? []) as string[]);
  const budgetUSD = (body.budgetUSD ?? 1_500_000) as number;

  const deployedSites = candidates.filter((s) => deployedIds.has(s.id));
  const portfolio = solvePortfolio(deployedSites);

  // Per-site results
  const siteResults = candidates.map((site) => ({
    id: site.id,
    ...solveSite(site),
  }));

  // Optimized portfolio for comparison
  const optimalIds = optimizePortfolio(candidates, budgetUSD);

  return NextResponse.json({
    portfolio,
    siteResults,
    optimalIds: Array.from(optimalIds),
  });
}
