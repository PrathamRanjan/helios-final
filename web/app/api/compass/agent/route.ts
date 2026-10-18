// POST /api/compass/agent — proxy to the HELIOS engine's ADK agent team (engine/api /agent/chat).
// The engine runs on Cloud Run (ENGINE_URL) or locally on :8080. Fails soft with a clear reason.

import { NextResponse } from "next/server";

const ENGINE = process.env.ENGINE_URL ?? "http://localhost:8080";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!body?.question || typeof body.question !== "string") {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }
  try {
    const r = await fetch(`${ENGINE}/agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: body.question.slice(0, 2000), session_id: body.sessionId }),
      signal: AbortSignal.timeout(120_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return NextResponse.json({ error: j?.detail ?? `engine returned ${r.status}` }, { status: 502 });
    return NextResponse.json(j);
  } catch {
    return NextResponse.json({ error: `HELIOS engine not reachable at ${ENGINE}. Start it with: cd engine && .venv/bin/uvicorn api.main:app --port 8080` }, { status: 503 });
  }
}
