import { NextRequest } from "next/server";
import { fetchSatelliteTile } from "@/lib/vision";

export const runtime = "nodejs";
export const maxDuration = 60;

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "";

const CATEGORY_LABEL: Record<string, string> = {
  metro_station: "metro station",
  university: "university campus",
  office: "office complex",
  commercial: "commercial / retail",
  commercial_residential: "mixed-use residential/commercial",
  government_civic: "government / civic facility",
  transit_hub: "transit hub",
  industrial: "industrial zone",
  enforcement_checkpoint: "Ring Road 1 entry checkpoint",
};

// What each deployment type physically needs — so Gemini verifies the SPECIFIC
// recommendation, not generic "could chargers go here" musings.
const TYPE_CRITERIA: Record<string, string> = {
  dc_fast:
    "DC fast charging for quick-turnaround e-scooters: needs street-frontage or forecourt space with easy ride-in/ride-out flow, close to the roadway.",
  ev_level_2:
    "Level-2 AC charging for long-dwell parking: needs visible parking areas where scooters/vehicles sit for hours (commuters, students, office workers).",
  solar_canopy:
    "Solar canopy + charging: needs open, UNSHADED parking or ground area large enough for canopy structures — tree cover or tall-building shadows kill the 10 AM–2 PM solar window.",
};

function buildPrompt(site: {
  name: string;
  category: string;
  district: string;
  zone: string;
  rationale: string;
  recommended_type?: string;
  deploy_units?: number;
  deploy_unit_label?: string;
  daily_evs?: number;
}) {
  const catLabel = CATEGORY_LABEL[site.category] ?? site.category;
  const type = site.recommended_type ?? "ev_level_2";
  const criteria = TYPE_CRITERIA[type] ?? TYPE_CRITERIA.ev_level_2;
  const deployment =
    site.deploy_units && site.deploy_unit_label
      ? `${site.deploy_units} ${site.deploy_unit_label}`
      : "managed EV charging";

  return `You are the field-verification step of HELIO, an EV charging deployment optimizer for Hanoi (motorbike ban inside Ring Road 1 since July 1, 2026 — 450,000+ scooters going electric).

The optimizer recommends deploying ${deployment} at "${site.name}" — a ${catLabel} in ${site.district} district${site.daily_evs ? `, projected ${site.daily_evs} EVs/day` : ""}.
Optimizer rationale: ${site.rationale}

Deployment requirement to verify: ${criteria}

Your job: check the satellite image for physical evidence FOR or AGAINST this specific deployment. Answer in EXACTLY this format (plain text, no markdown):

Space: <one sentence — the usable area you can actually see for this deployment>
Fit: <one sentence — can ${deployment} physically fit, and where exactly>
Risk: <one sentence — the main visible threat to THIS deployment type>
Verdict: <SUPPORTS, PARTIAL, or WEAK> — <one short clause why>

Judge only from what is visible. Do not invent measurements. Max 90 words total.`;
}

export async function POST(req: NextRequest) {
  const { lat, lng, site } = await req.json();
  if (typeof lat !== "number" || typeof lng !== "number" || !site) {
    return new Response("lat, lng, and site required", { status: 400 });
  }

  // Zoom 19 matches the panel's satellite image — Gemini sees what the user sees.
  const satResult = await fetchSatelliteTile(lat, lng, GOOGLE_MAPS_KEY, 19, 640);

  const parts: object[] = [{ text: buildPrompt(site) }];

  if (satResult) {
    parts.push({
      inlineData: { mimeType: "image/png", data: satResult.pngBytes.toString("base64") },
    });
  }

  // Use non-streaming generateContent — vision + streaming has truncation issues.
  // We emit the full response as a single SSE text event so the client typewriter still works.
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    `gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1024,
      // 2.5-flash is a thinking model: its reasoning tokens count against
      // maxOutputTokens, which silently truncates the visible answer mid-
      // sentence. Disable thinking — this task doesn't need it.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => "no body");
          emit(`data: ${JSON.stringify({ error: `gemini ${res.status}: ${errText.slice(0, 200)}` })}\n\n`);
          controller.close();
          return;
        }
        const d = await res.json();
        // Join ALL parts (thinking models may emit multiple; skip thought parts)
        const text = (d?.candidates?.[0]?.content?.parts ?? [])
          .filter((p: any) => p.text && !p.thought)
          .map((p: any) => p.text)
          .join("");
        if (text) {
          // Emit word-by-word so the client typewriter animates
          const words = text.split(/(\s+)/);
          for (const word of words) {
            emit(`data: ${JSON.stringify({ text: word })}\n\n`);
            await new Promise((r) => setTimeout(r, 18));
          }
        }
        emit("data: [DONE]\n\n");
      } catch (e: any) {
        emit(`data: ${JSON.stringify({ error: e?.message ?? "error" })}\n\n`);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
