// POST /api/studio/agent — streams an Agent Studio run (server-sent events) from the HELIOS
// engine's ADK team (engine/api /agent/studio). ENGINE_URL = Cloud Run service or :8080 locally.

const ENGINE = process.env.ENGINE_URL ?? "http://localhost:8080";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 2000) : "";
  if (!message) return new Response(sse({ type: "error", message: "Tell the agents your idea first." }), { status: 400, headers: { "Content-Type": "text/event-stream" } });
  let r: Response;
  try {
    r = await fetch(`${ENGINE}/agent/studio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, session_id: body.sessionId }),
      signal: AbortSignal.timeout(900_000),
    });
  } catch {
    return new Response(sse({ type: "error", message: `The HELIOS agent service isn't reachable at ${ENGINE}.` }), { status: 503, headers: { "Content-Type": "text/event-stream" } });
  }
  if (!r.ok || !r.body) {
    const j = await r.json().catch(() => ({}));
    return new Response(sse({ type: "error", message: j?.detail ?? `Agent service returned HTTP ${r.status}` }), { status: 502, headers: { "Content-Type": "text/event-stream" } });
  }
  return new Response(r.body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" } });
}
