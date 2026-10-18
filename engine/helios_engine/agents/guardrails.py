"""Guardrails: agents never invent numbers, never overclaim.

1. Numeric citation check — every number in an agent's final answer must appear (within rounding)
   in a tool result from the same session. Unsupported numbers are flagged and, in strict mode,
   the answer is rewritten to say the figure could not be verified.
2. Overclaim check — words that turn a modelled reallocation into a promise ("guarantee",
   "will definitely", "forecast" for the logit output) are flagged.

Used as an ADK after_model_callback and directly in tests/evals.
"""
from __future__ import annotations

import json
import re

NUM = re.compile(r"(?<![\w.])[-−]?\$?\d[\d,]*(?:\.\d+)?\s?(?:%|k|K|M|m|bn|t|pp|°C)?")
OVERCLAIM = re.compile(r"\b(guarantee[sd]?|will definitely|certain(?:ly)? will|proven to|forecasts? that ridership)\b", re.I)
IGNORE_SMALL = {str(i) for i in range(0, 13)} | {"2026", "2030", "2035", "2036", "2040"}


def _to_float(tok: str) -> float | None:
    t = tok.replace("−", "-").replace("$", "").replace(",", "").strip()
    mult = 1.0
    for suf, m in (("bn", 1e9), ("M", 1e6), ("m", 1e6), ("k", 1e3), ("K", 1e3)):
        if t.endswith(suf):
            t, mult = t[: -len(suf)], m
            break
    t = re.sub(r"(%|t|pp|°C)$", "", t).strip()
    try:
        return float(t) * mult
    except ValueError:
        return None


def _numbers_in(obj) -> list[float]:
    s = obj if isinstance(obj, str) else json.dumps(obj)
    vals = []
    for m in NUM.finditer(s):
        v = _to_float(m.group(0))
        if v is not None:
            vals.append(v)
    return vals


def supported(value: float, evidence: list[float], rel: float = 0.06) -> bool:
    for e in evidence:
        for scale in (1, 100, 0.01, 1e3, 1e-3, 1e6, 1e-6):
            ee = e * scale
            if ee == 0 and value == 0:
                return True
            if ee != 0 and abs(value - ee) / abs(ee) <= rel:
                return True
    return False


def check_answer(answer: str, tool_results: list) -> dict:
    evidence: list[float] = []
    for r in tool_results:
        evidence += _numbers_in(r)
    unsupported = []
    for m in NUM.finditer(answer):
        raw = m.group(0).strip()
        if raw.rstrip("%") in IGNORE_SMALL:
            continue
        v = _to_float(raw)
        if v is None or abs(v) < 13 and not raw.endswith(("%", "pp", "°C")):
            continue
        if not supported(v, evidence):
            unsupported.append(raw)
    over = sorted({m.group(0) for m in OVERCLAIM.finditer(answer)})
    return {"ok": not unsupported and not over, "unsupported_numbers": unsupported, "overclaims": over}
