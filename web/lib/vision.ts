const STATIC_MAPS_URL = "https://maps.googleapis.com/maps/api/staticmap";
const GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

export async function fetchSatelliteTile(
  lat: number,
  lng: number,
  key: string,
  zoom = 19,
  sizePx = 640
): Promise<{ pngBytes: Buffer; groundSideM: number } | null> {
  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: String(zoom),
    size: `${sizePx}x${sizePx}`,
    maptype: "satellite",
    scale: "1",
    key,
  });
  const res = await fetch(`${STATIC_MAPS_URL}?${params}`, { cache: "no-store", signal: AbortSignal.timeout(25000) });
  if (!res.ok) return null;
  const pngBytes = Buffer.from(await res.arrayBuffer());
  const groundSideM = metersPerPixel(lat, zoom) * sizePx;
  return { pngBytes, groundSideM };
}

const VISION_PROMPT_TEMPLATE = (groundSideM: number) => `You are a remote-sensing analyst looking at a Google Maps satellite tile.

The tile is square, centered on a specific GPS coordinate. The ground footprint of the entire tile is approximately ${groundSideM.toFixed(0)} m on each side (so total ground area ≈ ${(groundSideM * groundSideM).toFixed(0)} m²).

Look at the rooftop nearest to the center of the image — that is the building of interest.

Return ONE JSON object with these exact keys (numbers only, no units in values):
{
  "primary_roof_area_m2": <integer estimated rooftop footprint area for the central building>,
  "roof_type": "<one of: flat, pitched_simple, pitched_complex, partial_obstructed, none>",
  "building_type": "<one of: commercial, industrial, hypermarket, school_university, hospital, residential_single, residential_multi, mixed_use, religious, warehouse, parking, other>",
  "confidence": <number 0.0–1.0, how confident you are in the area estimate>,
  "notes": "<one short sentence>"
}

roof_type definitions (pick the closest match):
- "flat": large flat industrial/commercial roof, mostly unobstructed
- "pitched_simple": gable or shed roof, one or two slopes, residential or small commercial
- "pitched_complex": multi-faceted roof with many gables/dormers/hips
- "partial_obstructed": flat or pitched roof with extensive HVAC, skylights, walkways, vents
- "none": no clear building / water / forest / road only

Rules:
- The image is a near-overhead satellite view. Use the known ground scale to estimate area; don't guess wildly.
- If roof_type is "none", set primary_roof_area_m2 to 0 and confidence to 0.1.
- Return ONLY the JSON object. No prose, no markdown fences.
`;

export const USABLE_FRACTION_BY_ROOF_TYPE: Record<string, number> = {
  flat: 0.65,
  pitched_simple: 0.45,
  pitched_complex: 0.30,
  partial_obstructed: 0.40,
  none: 0.0,
};

export interface VisionEstimate {
  primary_roof_area_m2: number;
  roof_type: string;
  building_type: string;
  confidence: number;
  usable_fraction: number;
  notes: string;
}

export async function visionEstimateRoof(
  imagePng: Buffer,
  groundSideM: number,
  geminiKey: string,
  model = "gemini-2.5-flash"
): Promise<VisionEstimate | null> {
  const imgB64 = imagePng.toString("base64");
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "image/png", data: imgB64 } },
          { text: VISION_PROMPT_TEMPLATE(groundSideM) },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: model.startsWith("gemini-3") ? 4096 : 1024,
      responseMimeType: "application/json",
      thinkingConfig: model.startsWith("gemini-3") ? { thinkingLevel: "low" } : { thinkingBudget: 0 },
    },
  };
  const res = await fetch(`${GEMINI_MODELS_URL}/${encodeURIComponent(model)}:generateContent?key=${geminiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text: string = (data?.candidates?.[0]?.content?.parts ?? []).filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join("");
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  const area = Math.max(0, Math.floor(parsed.primary_roof_area_m2 ?? 0));
  let roofType = String(parsed.roof_type ?? "flat").toLowerCase();
  if (!(roofType in USABLE_FRACTION_BY_ROOF_TYPE)) roofType = "flat";
  const confidence = Math.max(0, Math.min(1, parseFloat(parsed.confidence ?? 0.5)));
  return {
    primary_roof_area_m2: area,
    roof_type: roofType,
    building_type: parsed.building_type ?? "other",
    confidence,
    usable_fraction: USABLE_FRACTION_BY_ROOF_TYPE[roofType],
    notes: parsed.notes ?? "",
  };
}
