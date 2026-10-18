import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { buildReport, type ReportInput } from "@/lib/compass/report/buildReport";
import type { InterventionSpec } from "@/lib/compass/report/imagery";
import { civicFor, type CivicCity } from "@/lib/compass/civic/civicScore";

export const runtime = "nodejs";
export const maxDuration = 60;

// Map an EV candidate site (or a generic located intervention) to a report.
// Demo-safe: if a cached report exists it is returned WITHOUT any API call.
// Live generation requires the server-side keys and degrades gracefully.

const CIVIC_CAP: Record<InterventionSpec["kind"], string[]> = {
  ev_charging: ["ev_charging"],
  solar_canopy: ["solar_canopy"],
  cycling: ["allows_cycling"],
  shade: ["adds_shade"],
  bus: ["better_bus"],
  generic: [],
};

async function loadEvSite(siteId: string) {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "data", "ev_candidate_sites.json"), "utf-8");
    return (JSON.parse(raw).sites as any[]).find((s) => s.id === siteId) ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { siteId, intervention, city = "singapore", forceRegen = false } = body as {
    siteId?: string;
    intervention?: ReportInput;
    city?: CivicCity;
    forceRegen?: boolean;
  };

  const mapsKey = process.env.GOOGLE_MAPS_API_KEY ?? "";
  const geminiKey = process.env.GEMINI_API_KEY ?? "";

  let input: ReportInput | null = null;

  if (siteId) {
    const site = await loadEvSite(siteId);
    if (!site) return NextResponse.json({ error: `site not found: ${siteId}` }, { status: 404 });
    const a = site.recommendedAsset;
    input = {
      id: site.id,
      spec: {
        kind: "ev_charging",
        title: `EV charging hub · ${site.name}`,
        asset: `${a.ports} × ${a.chargerPowerKW} kW ports${a.batteryKWh ? ` + ${a.batteryKWh} kWh battery` : ""}`,
      },
      lat: site.lat,
      lng: site.lng,
      computational: { score: site.score, reasons: site.reasons, assetSpec: a },
      civic: civicFor(["ev_charging"], city),
    };
  } else if (intervention?.id && intervention.spec && typeof intervention.lat === "number") {
    input = {
      ...intervention,
      civic: intervention.civic ?? civicFor(CIVIC_CAP[intervention.spec.kind] ?? [], city),
    };
  }

  if (!input) return NextResponse.json({ error: "provide siteId or a valid intervention" }, { status: 400 });

  try {
    const report = await buildReport(input, { mapsKey, geminiKey, forceRegen });
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
