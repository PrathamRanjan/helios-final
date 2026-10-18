"""Agent evals (need GEMINI_API_KEY). Writes evals/results.json.

    cd helios/engine && GEMINI_API_KEY=... .venv/bin/python -m evals.run_evals
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from helios_engine.agents import tools as T  # noqa: E402
from helios_engine.agents.runner import ask, has_credentials  # noqa: E402
from helios_engine.agents.shock_schema import NewsEvent  # noqa: E402

HERE = Path(__file__).resolve().parent


async def eval_shocks() -> dict:
    from helios_engine.agents.agent import shock_parser

    items = json.loads((HERE / "news_shock_eval.json").read_text())["items"]
    rows = []
    for it in items:
        out = await ask(f"Headline: {it['text']}\nURL: https://example.org\nDate: 2026-10-14", agent=shock_parser)
        try:
            ev = NewsEvent.model_validate_json(out["answer"])
            got = ev.shock.type if (ev.relevant and ev.shock) else None
            in_range = True
            if got and it.get("bounds"):
                d = ev.shock.model_dump()
                in_range = all(lo <= d[k] <= hi for k, (lo, hi) in it["bounds"].items() if k in d)
        except Exception as e:  # malformed output counts as wrong
            got, in_range = f"parse_error: {e}", False
        ok = got == it["expect_type"] or got in it.get("alt_types", [])
        rows.append({"text": it["text"][:80], "expected": it["expect_type"], "got": got, "type_ok": ok, "magnitude_ok": in_range})
    n = len(rows)
    irrelevant = [r for r in rows if r["expected"] is None]
    return {
        "type_accuracy": sum(r["type_ok"] for r in rows) / n,
        "magnitude_in_range": sum(r["magnitude_ok"] for r in rows if r["type_ok"] and r["expected"]) / max(1, sum(1 for r in rows if r["expected"])),
        "false_positive_rate": sum(1 for r in irrelevant if r["got"] not in (None,)) / max(1, len(irrelevant)),
        "rows": rows,
    }


def _field(path: str):
    tool, _, rest = path.partition(".")
    obj = getattr(T, tool)() if tool not in ("recommend_portfolio", "heat_at_hour", "size_ev_chargers") else {
        "recommend_portfolio": lambda: T.recommend_portfolio(1_500_000, 0.5),
        "heat_at_hour": lambda: T.heat_at_hour(13),
        "size_ev_chargers": lambda: T.size_ev_chargers(8, 1.5),
    }[tool]()
    for part in rest.replace("]", "").split("."):
        if "[" in part:
            k, i = part.split("[")
            obj = obj[k][int(i)]
        else:
            obj = obj[part]
    return obj


async def eval_golden() -> dict:
    items = json.loads((HERE / "golden_questions.json").read_text())["items"]
    rows = []
    for it in items:
        out = await ask(it["q"])
        calls = {t["call"] for t in out.get("trace", [])}
        called_ok = all(c in calls for c in it["must_call"])
        mention_ok = True
        for f in it["must_mention_tool_field"]:
            v = _field(f)
            s = f"{v:.1f}" if isinstance(v, float) else str(v)
            mention_ok &= s.split(".")[0] in (out["answer"] or "")
        guard = out.get("guard") or {"ok": True}
        rows.append({"q": it["q"], "tools_ok": called_ok, "mention_ok": mention_ok, "guard_ok": guard.get("ok", True), "calls": sorted(calls)})
    n = len(rows)
    return {"tool_routing": sum(r["tools_ok"] for r in rows) / n, "grounded_answer": sum(r["mention_ok"] for r in rows) / n, "guardrail_pass": sum(r["guard_ok"] for r in rows) / n, "rows": rows}


async def main():
    if not has_credentials():
        print("No GEMINI_API_KEY — evals need a model. Tool/guardrail tests run offline via pytest.")
        return
    res = {"shock_parser": await eval_shocks(), "golden": await eval_golden()}
    (HERE / "results.json").write_text(json.dumps(res, indent=2))
    print(json.dumps({k: {kk: v for kk, v in r.items() if kk != "rows"} for k, r in res.items()}, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
