"""Run the HELIOS agent team programmatically (CLI, API and evals share this).

    GEMINI_API_KEY=... .venv/bin/python -m helios_engine.agents.runner "We have $1.5M for Jurong East. What should we fund?"
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid

APP = "helios"


def has_credentials() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or os.environ.get("GOOGLE_GENAI_USE_VERTEXAI"))


async def ask(question: str, session_id: str | None = None, agent=None) -> dict:
    if not has_credentials():
        return {"error": "No model credentials. Set GEMINI_API_KEY (Google AI Studio) or Vertex AI env vars.", "answer": None}
    if os.environ.get("GEMINI_API_KEY") and not os.environ.get("GOOGLE_API_KEY"):
        os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]
    from google.adk.runners import InMemoryRunner
    from google.genai import types

    from .agent import root_agent

    runner = InMemoryRunner(agent=agent or root_agent, app_name=APP)
    sid = session_id or str(uuid.uuid4())
    await runner.session_service.create_session(app_name=APP, user_id="planner", session_id=sid)
    msg = types.Content(role="user", parts=[types.Part(text=question)])
    trace, answer = [], ""
    async for ev in runner.run_async(user_id="planner", session_id=sid, new_message=msg):
        for p in (ev.content.parts if ev.content else []) or []:
            if getattr(p, "function_call", None):
                trace.append({"agent": ev.author, "call": p.function_call.name, "args": dict(p.function_call.args or {})})
            elif getattr(p, "text", None) and ev.is_final_response():
                answer += p.text
    sess = await runner.session_service.get_session(app_name=APP, user_id="planner", session_id=sid)
    return {"answer": answer, "trace": trace, "guard": sess.state.get("helios_last_guard"), "session_id": sid}


if __name__ == "__main__":
    q = " ".join(sys.argv[1:]) or "We have US$1.5M for Jurong East. What should we fund, and what could make that wrong?"
    out = asyncio.run(ask(q))
    if out.get("error"):
        print(out["error"])
        sys.exit(1)
    for t in out["trace"]:
        print(f"  [{t['agent']}] → {t['call']}({t['args']})")
    print("\n" + out["answer"])
    print("\nguardrail:", out["guard"])
