// Imagery pipeline for intervention feasibility reports.
//
// Two kinds of feasibility for a drawn/recommended intervention:
//   1. computational — demand/score numbers (already in the engine).
//   2. visual        — does it physically fit? Gemini vision reads the real
//                      Street View + satellite tile and says where it goes.
// Then Gemini image-edit renders the intervention INTO the real photo (the
// "after"). Both are clearly labelled AI estimates, never engineering fact.
//
// Reuses the same Google Maps + Gemini plumbing as the V2 solar flow.

const GEMINI_VISION_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const GEMINI_IMAGE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";
const STREETVIEW_URL = "https://maps.googleapis.com/maps/api/streetview";

/** Street View frame at a chosen compass heading (0=N,90=E,…). */
export async function streetViewAt(
  lat: number,
  lng: number,
  key: string,
  heading: number,
  size = "640x400"
): Promise<Buffer | null> {
  const params = new URLSearchParams({
    location: `${lat},${lng}`,
    size,
    fov: "80",
    pitch: "8",
    heading: String(heading),
    key,
  });
  const res = await fetch(`${STREETVIEW_URL}?${params}`, { cache: "no-store" });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1500) return null; // Google returns a tiny "no imagery" tile
  return buf;
}

/** How each intervention type should be described to the vision + edit models. */
export interface InterventionSpec {
  kind: "ev_charging" | "solar_canopy" | "cycling" | "shade" | "bus" | "generic";
  title: string;
  /** short human description of the physical asset, e.g. "8 × 22 kW EV charging ports". */
  asset: string;
}

const SITING_HINT: Record<InterventionSpec["kind"], string> = {
  ev_charging: "kerbside bays or an existing car-park/forecourt edge with vehicle access and grid proximity",
  solar_canopy: "open car-park or plaza area where a PV canopy could span without shading conflicts",
  cycling: "roadside space for a protected cycle lane separated from traffic",
  shade: "the pedestrian path where trees or a canopy would cover the walking route",
  bus: "the bus stop / kerb where a shelter or priority lane fits",
  generic: "the most suitable open ground-level space for the change",
};

export interface SitingAssessment {
  visualFeasibility: number; // 0..1
  bestPlacement: string;
  usableSpots: { where: string; type: string; estWidthM?: number }[];
  obstructions: string[];
  pedestrianClearanceOk: boolean;
  notes: string;
}

export async function assessSiting(
  streetImg: Buffer,
  satImg: Buffer | null,
  groundSideM: number,
  spec: InterventionSpec,
  key: string
): Promise<SitingAssessment | null> {
  const prompt = `You are a transport-infrastructure surveyor doing a desk study (NOT a site survey).
You are given a street-level photo${satImg ? " and a top-down satellite tile" : ""} of a location where a planner wants to add: ${spec.asset}.
${satImg ? `The satellite tile is ~${groundSideM.toFixed(0)} m per side.` : ""}
Assess whether this physically fits. Look for ${SITING_HINT[spec.kind]}.

Return ONE JSON object, no markdown:
{
  "visualFeasibility": <0.0-1.0 how well it physically fits>,
  "bestPlacement": "<one sentence: exactly where it should go in this view>",
  "usableSpots": [{"where":"<short>","type":"<kerbside|carpark|forecourt|plaza|roadside|path>","estWidthM":<number optional>}],
  "obstructions": ["<short>", ...],
  "pedestrianClearanceOk": <true|false>,
  "notes": "<one short sentence of caveat>"
}
Rules: be realistic and specific to what you can see; if imagery is poor set visualFeasibility low. Return ONLY the JSON.`;

  const parts: any[] = [{ inlineData: { mimeType: "image/jpeg", data: streetImg.toString("base64") } }];
  if (satImg) parts.push({ inlineData: { mimeType: "image/png", data: satImg.toString("base64") } });
  parts.push({ text: prompt });

  const res = await fetch(`${GEMINI_VISION_URL}?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  try {
    const p = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
    return {
      visualFeasibility: Math.max(0, Math.min(1, Number(p.visualFeasibility) || 0)),
      bestPlacement: String(p.bestPlacement ?? ""),
      usableSpots: Array.isArray(p.usableSpots) ? p.usableSpots.slice(0, 5) : [],
      obstructions: Array.isArray(p.obstructions) ? p.obstructions.slice(0, 5) : [],
      pedestrianClearanceOk: Boolean(p.pedestrianClearanceOk),
      notes: String(p.notes ?? ""),
    };
  } catch {
    return null;
  }
}

const EDIT_HINT: Record<InterventionSpec["kind"], string> = {
  ev_charging:
    "Add modern EV charging pillars (brand-neutral white/green) with charging cables, wheel-stop bollards and subtle painted bay markings at the placement described",
  solar_canopy:
    "Add a photovoltaic solar canopy (dark navy-blue monocrystalline panels on a clean steel frame) spanning the open area described",
  cycling:
    "Add a protected cycle lane (smooth red/green surface, low separators or planters) along the roadside described",
  shade:
    "Add mature shade trees and/or a covered walkway canopy over the pedestrian path described",
  bus: "Add a modern covered bus shelter with seating at the kerb described",
  generic: "Add the described infrastructure at the placement described",
};

export async function renderAfter(
  streetImg: Buffer,
  spec: InterventionSpec,
  placement: string,
  key: string
): Promise<Buffer | null> {
  const prompt = `Edit this street-level photograph. ${EDIT_HINT[spec.kind]}${placement ? `: ${placement}` : ""}.

CRITICAL: keep every other detail identical to the original — the same buildings, road, trees, sky, lighting, sun direction, people, vehicles and colour grading. Do NOT change the camera perspective or the scene. Only add the new infrastructure so it looks naturally integrated and photorealistic. Singapore equatorial urban context. No text, no watermarks, no labels.`;

  const res = await fetch(`${GEMINI_IMAGE_URL}?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: streetImg.toString("base64") } },
            { text: prompt },
          ],
        },
      ],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  try {
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      const inline = p.inlineData ?? p.inline_data;
      if (inline?.data) return Buffer.from(inline.data, "base64");
    }
  } catch {
    return null;
  }
  return null;
}
