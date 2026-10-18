"""Stream an Agent Studio run as events (FastAPI SSE and the CLI share this).

Sessions persist for the life of the process (InMemorySessionService), or in Agent Platform
when AGENT_ENGINE_ID is set (VertexAiSessionService), so follow-up messages edit the same plan.

    HELIOS_MODEL=openai/gemma-4-26b OPENAI_API_BASE=http://127.0.0.1:8081/v1 OPENAI_API_KEY=x \\
      .venv/bin/python -m helios_engine.agents.studio_runner "Shade the walk to Tampines MRT, test it in today's haze"
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import uuid
from typing import AsyncIterator

APP = "helios_studio"
USER = "planner"
_runner = None


def studio_ready() -> tuple[bool, str]:
    m = os.environ.get("HELIOS_MODEL", "gemini-2.5-flash")
    if m.startswith(("openai/", "litellm/")):
        return (bool(os.environ.get("OPENAI_API_BASE")), "set OPENAI_API_BASE for the OpenAI-compatible model")
    ok = bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or os.environ.get("GOOGLE_GENAI_USE_VERTEXAI"))
    return ok, "set GEMINI_API_KEY (Google AI Studio) or Vertex AI env vars"


def _get_runner():
    global _runner
    if _runner is None:
        if os.environ.get("GEMINI_API_KEY") and not os.environ.get("GOOGLE_API_KEY"):
            os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]
        from google.adk.runners import Runner

        from .studio import root_agent

        engine_id = os.environ.get("AGENT_ENGINE_ID")
        if engine_id:
            from google.adk.sessions import VertexAiSessionService

            sessions = VertexAiSessionService(project=os.environ["GOOGLE_CLOUD_PROJECT"], location=os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1"), agent_engine_id=engine_id)
        else:
            from google.adk.sessions import InMemorySessionService

            sessions = InMemorySessionService()
        _runner = Runner(agent=root_agent, app_name=APP, session_service=sessions)
    return _runner


def _summ(x, n: int = 600) -> str:
    s = json.dumps(x, ensure_ascii=False, default=str)
    return s if len(s) <= n else s[:n] + "…"


async def stream(message: str, session_id: str | None = None) -> AsyncIterator[dict]:
    from google.genai import types

    runner = _get_runner()
    sid = session_id or str(uuid.uuid4())
    if not await runner.session_service.get_session(app_name=APP, user_id=USER, session_id=sid):
        await runner.session_service.create_session(app_name=APP, user_id=USER, session_id=sid)
    t0 = time.time()
    yield {"type": "start", "session_id": sid}
    msg = types.Content(role="user", parts=[types.Part(text=message)])
    try:
        async for ev in runner.run_async(user_id=USER, session_id=sid, new_message=msg):
            for p in (ev.content.parts if ev.content else []) or []:
                if getattr(p, "function_call", None):
                    yield {"type": "call", "agent": ev.author, "tool": p.function_call.name, "args": dict(p.function_call.args or {}), "t": round(time.time() - t0, 1)}
                elif getattr(p, "function_response", None):
                    resp = p.function_response.response
                    err = resp.get("error") if isinstance(resp, dict) else None
                    yield {"type": "result", "agent": ev.author, "tool": p.function_response.name, "ok": not err, "summary": err or _summ(resp), "t": round(time.time() - t0, 1)}
                elif getattr(p, "text", None) and not getattr(p, "thought", False):
                    yield {"type": "say", "agent": ev.author, "text": p.text, "t": round(time.time() - t0, 1)}
    except Exception as e:  # noqa: BLE001
        yield {"type": "error", "message": f"{type(e).__name__}: {e}"}
    sess = await runner.session_service.get_session(app_name=APP, user_id=USER, session_id=sid)
    st = sess.state if sess else {}
    yield {
        "type": "plan",
        "area": st.get("plan_area"),
        "change_ids": st.get("plan_ids", []),
        "shocks": st.get("shocks", []),
        "guard": st.get("helios_last_guard"),
    }
    yield {"type": "done", "seconds": round(time.time() - t0, 1)}


async def _cli(q: str):
    async for e in stream(q):
        if e["type"] == "call":
            print(f"  [{e['agent']}] → {e['tool']}({json.dumps(e['args'])[:120]})")
        elif e["type"] == "result":
            print(f"  [{e['agent']}] ← {e['tool']} {'ok' if e['ok'] else 'ERROR ' + e['summary']}")
        elif e["type"] == "say":
            print(f"\n[{e['agent']}] {e['text']}\n")
        else:
            print(e)


if __name__ == "__main__":
    asyncio.run(_cli(" ".join(sys.argv[1:]) or "We have S$5M for Tampines. Make the walk to the MRT cooler and test it against today's haze."))
