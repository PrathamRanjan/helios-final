const GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const EDIT_PROMPT_TEMPLATE = `Edit this near-overhead satellite/aerial photograph: cover the visible rooftops of the central building(s) with neat tightly-packed rows of dark navy-blue monocrystalline photovoltaic solar panels in a professional commercial installation. The panels should be perfectly aligned in a clean grid pattern, slightly tilted, with narrow service walkways between rows. Add small white inverter cabinets at the roof edges.

CRITICAL: Keep every other detail of the image identical to the original — the exact same streets, trees, neighbouring buildings, shadows, vehicles, sun direction, and overall colour grading. Do NOT change the perspective. Do NOT change the building shape or scale. Only add panels to the existing rooftop surfaces. Photorealistic, no text, no watermarks.`;

const REGIONAL_FLAVOR: Record<string, string> = {
  VN: "tropical Vietnamese urban context",
  SG: "Singapore equatorial urban context",
  ID: "tropical Indonesian urban context",
  TH: "tropical Thai urban context",
  MY: "tropical Malaysian urban context",
  PH: "tropical Philippine urban context",
  IN: "Indian urban context",
};

export class ImageGenerationError extends Error {
  constructor(public status: number) { super(`Image generation failed (HTTP ${status}).`); }
}

export async function editWithPanels(
  imagePng: Buffer,
  geminiKey: string,
  countryCode?: string | null,
  { model = "gemini-2.5-flash-image", throwOnError = false }: { model?: string; throwOnError?: boolean } = {}
): Promise<Buffer | null> {
  const imgB64 = imagePng.toString("base64");
  const flavor = REGIONAL_FLAVOR[(countryCode ?? "").toUpperCase()] ?? "";
  const prompt = flavor
    ? `${EDIT_PROMPT_TEMPLATE}\n\nContext: ${flavor}.`
    : EDIT_PROMPT_TEMPLATE;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "image/png", data: imgB64 } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: { responseModalities: ["IMAGE"] },
  };
  const res = await fetch(`${GEMINI_MODELS_URL}/${encodeURIComponent(model)}:generateContent?key=${geminiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
    cache: "no-store",
  });
  if (!res.ok) {
    if (throwOnError) throw new ImageGenerationError(res.status);
    return null;
  }
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
