// Pre-generate an intervention feasibility report and cache it under
// public/reports/<id>/. Run before a demo so the pitch never waits on (or is
// broken by) a live Gemini/Maps call.
//
//   npx tsx scripts/gen_report.ts [siteId]
//
// Default siteId = the top-ranked EV opportunity zone in Jurong East.

import { promises as fs } from "fs";
import path from "path";
import { buildReport } from "@/lib/compass/report/buildReport";
import type { InterventionSpec } from "@/lib/compass/report/imagery";
import { civicFor } from "@/lib/compass/civic/civicScore";

async function loadEnv() {
  // tsx does not auto-load .env.local — read the keys ourselves.
  try {
    const raw = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf-8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* env may already be set */
  }
}

async function main() {
  await loadEnv();
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY ?? "";
  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  if (!mapsKey || !geminiKey) throw new Error("Missing GOOGLE_MAPS_API_KEY or GEMINI_API_KEY");

  const siteId = process.argv[2];
  const sitesRaw = await fs.readFile(path.join(process.cwd(), "data", "ev_candidate_sites.json"), "utf-8");
  const sites = JSON.parse(sitesRaw).sites as any[];
  const site = siteId ? sites.find((s) => s.id === siteId) : sites[0];
  if (!site) throw new Error(`site not found: ${siteId}`);

  const a = site.recommendedAsset;
  const spec: InterventionSpec = {
    kind: "ev_charging",
    title: `EV charging hub · ${site.name}`,
    asset: `${a.ports} × ${a.chargerPowerKW} kW EV charging ports${a.batteryKWh ? ` + ${a.batteryKWh} kWh battery` : ""}`,
  };

  console.log(`Generating report for ${site.id} — ${site.name} (${site.lat}, ${site.lng})`);
  const report = await buildReport(
    {
      id: site.id,
      spec,
      lat: site.lat,
      lng: site.lng,
      computational: { score: site.score, reasons: site.reasons, assetSpec: a },
      civic: civicFor(["ev_charging"], "singapore"),
    },
    { mapsKey, geminiKey, forceRegen: true }
  );

  console.log(`  status: ${report.status}`);
  console.log(`  images: ${Object.entries(report.images).map(([k, v]) => `${k}=${v ? "✓" : "✗"}`).join(" ")}`);
  if (report.siting) {
    console.log(`  visualFeasibility: ${report.siting.visualFeasibility}`);
    console.log(`  bestPlacement: ${report.siting.bestPlacement}`);
    console.log(`  obstructions: ${report.siting.obstructions.join("; ") || "none"}`);
  } else {
    console.log("  siting: (none — vision unavailable)");
  }
  console.log(`\nCached to public/reports/${site.id}/`);
}

main().catch((e) => {
  console.error("gen_report failed:", e);
  process.exit(1);
});
