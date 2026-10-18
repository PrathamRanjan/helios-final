import { NextRequest, NextResponse } from "next/server";
import {
  ruleBasedInterpret,
  coerceAiInterpretation,
  interpretationPrompt,
} from "@/lib/compass/parser/interpretIntervention";

export const runtime = "nodejs";
export const maxDuration = 20;

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

/**
 * Open intervention parser: free text → simulable effect primitives.
 * Tries Gemini for a semantic mapping; ALWAYS falls back to the deterministic
 * keyword parser so it works with no key and never fails the demo.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const text = String(body?.text ?? "").trim();
  if (!text || text.length < 2) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  if (text.length > 300) {
    return NextResponse.json({ error: "text too long (max 300 chars)" }, { status: 400 });
  }

  const fallback = ruleBasedInterpret(text);
  const key = process.env.GEMINI_API_KEY ?? "";
  if (!key) return NextResponse.json(fallback);

  try {
    const res = await fetch(`${GEMINI_URL}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        contents: [{ parts: [{ text: interpretationPrompt(text) }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      }),
    });
    if (!res.ok) return NextResponse.json(fallback);
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = JSON.parse(stripFences(raw));
    const coerced = coerceAiInterpretation(text, parsed);
    return NextResponse.json(coerced ?? fallback);
  } catch {
    return NextResponse.json(fallback);
  }
}

/** Gemini sometimes wraps JSON in ```json fences despite the mime hint. */
function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}
