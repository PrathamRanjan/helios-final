// Server-only client for the language model behind resident voices and rule drafting.
//
// Two modes, both OpenAI-compatible chat completions:
//   • local (default)  llama.cpp serving Gemma 4 on this machine — GEMMA_URL
//   • hosted           any OpenAI-compatible endpoint with a key — set LLM_API_KEY
//                      (+ optional LLM_BASE_URL, LLM_MODEL). Defaults to Google AI
//                      Studio's OpenAI-compatible endpoint serving Gemma.
//
// No fallbacks by design: if the model is unreachable, callers get a GemmaUnavailable
// error and the UI says so. HELIOS sends the facts in every prompt, so short direct
// answers are what we want (thinking is disabled on the local server).

const LOCAL_URL = process.env.GEMMA_URL || "http://127.0.0.1:8081";
const HOSTED_KEY = process.env.LLM_API_KEY || "";

export const LLM_MODE: "local" | "hosted" = HOSTED_KEY ? "hosted" : "local";
const BASE = LLM_MODE === "hosted" ? (process.env.LLM_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/+$/, "") : `${LOCAL_URL}/v1`;
export const GEMMA_MODEL = LLM_MODE === "hosted" ? process.env.LLM_MODEL || "gemma-3-27b-it" : "gemma-4-26b";
/** Where the model lives, for status displays (never includes the key). */
export const GEMMA_URL = LLM_MODE === "hosted" ? BASE : LOCAL_URL;
// Gemma served through the Gemini API accepts neither system messages nor JSON mode.
const GOOGLE_GEMMA = LLM_MODE === "hosted" && BASE.includes("generativelanguage.googleapis.com") && GEMMA_MODEL.startsWith("gemma");
const GOOGLE_GEMINI = LLM_MODE === "hosted" && BASE.includes("generativelanguage.googleapis.com") && GEMMA_MODEL.startsWith("gemini");

export class GemmaUnavailable extends Error {
  constructor(detail: string) {
    super(
      LLM_MODE === "hosted"
        ? `Hosted model ${GEMMA_MODEL} at ${BASE} is not answering (${detail}). Check LLM_API_KEY / LLM_BASE_URL / LLM_MODEL in .env.local.`
        : `Local Gemma is not running at ${LOCAL_URL} (${detail}). Start it with helios/scripts/gemma-server.sh`
    );
    this.name = "GemmaUnavailable";
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const authHeaders = (): Record<string, string> => (LLM_MODE === "hosted" ? { Authorization: `Bearer ${HOSTED_KEY}` } : {});

export async function gemmaHealth(): Promise<{ ok: boolean; url: string; mode: typeof LLM_MODE; model: string; detail?: string }> {
  const base = { url: GEMMA_URL, mode: LLM_MODE, model: GEMMA_MODEL };
  try {
    const r =
      LLM_MODE === "hosted"
        ? await fetch(`${BASE}/models`, { headers: authHeaders(), cache: "no-store", signal: AbortSignal.timeout(5000) })
        : await fetch(`${LOCAL_URL}/health`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
    return { ...base, ok: r.ok, detail: r.ok ? undefined : `HTTP ${r.status}` };
  } catch (e: any) {
    return { ...base, ok: false, detail: e?.message ?? "unreachable" };
  }
}

/** Gemma via the Gemini API has no system role: fold it into the first user turn. */
function foldSystem(messages: ChatMessage[]): ChatMessage[] {
  const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  if (!sys) return rest;
  const i = rest.findIndex((m) => m.role === "user");
  if (i < 0) return [{ role: "user", content: sys }, ...rest];
  return rest.map((m, j) => (j === i ? { ...m, content: `${sys}\n\n${m.content}` } : m));
}

export async function gemmaChat(
  messages: ChatMessage[],
  opts: { json?: boolean; maxTokens?: number; temperature?: number; timeoutMs?: number } = {}
): Promise<{ text: string; ms: number; tokens: number }> {
  const t0 = Date.now();
  const body: Record<string, unknown> = {
    model: GEMMA_MODEL,
    messages: GOOGLE_GEMMA ? foldSystem(messages) : messages,
    temperature: opts.temperature ?? 0.6,
    max_tokens: opts.maxTokens ?? 300,
  };
  if (LLM_MODE === "local") body.chat_template_kwargs = { enable_thinking: false };
  if (GOOGLE_GEMINI) {
    // Gemini's token cap includes reasoning as well as the visible JSON reply.
    body.max_tokens = Math.max(opts.maxTokens ?? 300, 2048);
    body.reasoning_effort = "low";
  }
  // JSON mode where the server supports it; prompts ask for JSON either way and parseJson tolerates fences.
  if (opts.json && !GOOGLE_GEMMA) body.response_format = { type: "json_object" };
  let r: Response;
  try {
    r = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    throw new GemmaUnavailable(e?.message ?? "unreachable");
  }
  if (!r.ok) throw new GemmaUnavailable(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  if (d.choices?.[0]?.finish_reason === "length") {
    throw new Error("Model response reached its token limit before completing. Please try again.");
  }
  return { text: d.choices?.[0]?.message?.content ?? "", ms: Date.now() - t0, tokens: d.usage?.completion_tokens ?? 0 };
}

/** Parse a JSON reply, tolerating a ```json fence or prose around the object. */
export function parseJson<T>(text: string): T {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (m ? m[1] : text).trim();
  try {
    return JSON.parse(body) as T;
  } catch {
    const s = body.search(/[[{]/);
    const e = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
    if (s >= 0 && e > s) return JSON.parse(body.slice(s, e + 1)) as T;
    throw new Error("model did not return JSON");
  }
}

/** Run async jobs with a concurrency cap (llama-server has 4 slots; hosted APIs rate-limit). */
export async function pool<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
