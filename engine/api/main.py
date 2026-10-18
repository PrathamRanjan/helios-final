"""HELIOS engine API (FastAPI) — deployable to Cloud Run.

Serves (a) the calibrated, validated parameter sets the TypeScript engine runs on, with provenance,
and (b) on-demand math the agents call as tools. Agents never invent numbers: every figure they
quote comes from one of these endpoints and carries its source ids.

    uvicorn api.main:app --port 8080        (from helios/engine)
"""
from __future__ import annotations

import json
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from helios_engine.choice.utility import ASSUMPTIONS
from helios_engine.data import registry
from helios_engine.decision.evpi import evpi, evppi, gate
from helios_engine.decision.portfolio import mean_cvar, minimax_regret
from helios_engine.diffusion.bass import fit_with_holdout
from helios_engine.energy.dispatch import Site, cost_vs_carbon
from helios_engine.energy.queue import size_chargers

app = FastAPI(title="HELIOS engine", version="0.1.0", description="Calibrated urban decarbonisation math for APAC cities")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

CAL = ASSUMPTIONS / "calibrated"


def _cal(name: str) -> dict:
    p = CAL / name
    if not p.exists():
        raise HTTPException(404, f"{name} not generated yet — run the engine pipeline")
    return json.loads(p.read_text())


@app.get("/health")
def health():
    return {"ok": True, "calibrated": sorted(p.name for p in CAL.glob("*.json"))}


@app.get("/provenance")
def provenance():
    """Every ingested source: id, url, as-of date, row count, checksum, stale flag."""
    return registry.all_entries()


@app.get("/calibration/mode-choice")
def mode_choice():
    d = _cal("mode_choice_calibrated.json")
    d.get("runtime", {}).pop("edge_pa", None)  # large; not needed by clients
    return d


@app.get("/validation")
def validation():
    out = {"mode_choice": _cal("mode_choice_calibrated.json").get("validation")}
    try:
        out["heat"] = _cal("heat_calibrated.json").get("validation")
    except HTTPException:
        pass
    try:
        e = _cal("energy_calibrated.json")
        out["solar_diffusion_holdout"] = e["solar_diffusion"]["fit"]
        out["pv_yield"] = {k: e["pv"][k] for k in ("annual_kwh_per_kwp", "temperature_loss_pct", "clearness_k")}
    except HTTPException:
        pass
    return out


@app.get("/energy")
def energy():
    return _cal("energy_calibrated.json")


@app.get("/heat")
def heat(include_edges: bool = False):
    d = _cal("heat_calibrated.json")
    if not include_edges:
        d.pop("edges", None)
    return d


@app.get("/decision")
def decision():
    return _cal("decision_calibrated.json")


# ---------------- on-demand tools ----------------
class DispatchReq(BaseModel):
    load_kwh: list[float] = Field(..., min_length=24, max_length=24)
    pv_kwh: list[float] = Field(..., min_length=24, max_length=24)
    price: list[float] = Field(..., min_length=24, max_length=24)
    ef_kg_per_kwh: list[float] = Field(..., min_length=24, max_length=24)
    ev_energy_kwh: float = 0
    ev_plugged: Optional[list[float]] = None
    ev_max_kw: float = 0
    bat_kwh: float = 0
    bat_kw: float = 0
    carbon_price_usd_per_t: float = 80


@app.post("/tools/dispatch")
def dispatch(r: DispatchReq):
    site = Site(
        load_kwh=np.array(r.load_kwh), pv_kwh=np.array(r.pv_kwh), price=np.array(r.price), ef_kg_per_kwh=np.array(r.ef_kg_per_kwh),
        ev_energy_kwh=r.ev_energy_kwh, ev_plugged=None if r.ev_plugged is None else np.array(r.ev_plugged), ev_max_kw=r.ev_max_kw,
        bat_kwh=r.bat_kwh, bat_kw=r.bat_kw,
    )
    return cost_vs_carbon(site, r.carbon_price_usd_per_t / 1000)


class ChargerReq(BaseModel):
    peak_arrivals_per_hour: float
    mean_charge_hours: float
    max_wait_min: float = 10
    max_prob: float = 0.05


@app.post("/tools/size-chargers")
def chargers(r: ChargerReq):
    return size_chargers(r.peak_arrivals_per_hour, r.mean_charge_hours, r.max_wait_min, r.max_prob)


class BassReq(BaseModel):
    years: list[float]
    values: list[float]
    holdout: int = 3
    M_fixed: Optional[float] = None


@app.post("/tools/bass")
def bass(r: BassReq):
    f = fit_with_holdout(np.array(r.years), np.array(r.values), holdout=r.holdout, M_fixed=r.M_fixed)
    return f.as_dict()


class VoIReq(BaseModel):
    net_benefit_draws: list[list[float]]  # draws × options
    parameter_draws: dict[str, list[float]] = {}
    study_cost: dict[str, float] = {}


@app.post("/tools/value-of-information")
def voi(r: VoIReq):
    NB = np.array(r.net_benefit_draws)
    ev = {k: evppi(NB, np.array(v)) for k, v in r.parameter_draws.items()}
    out = {"evpi": evpi(NB), "evppi": ev}
    if NB.shape[1] == 2:
        out["gate"] = gate(NB[:, 0] - NB[:, 1], ev, r.study_cost)
    return out


class PortfolioReq(BaseModel):
    net_benefit_draws: list[list[float]]
    capex: list[float]
    budget: float
    alpha: float = 0.1
    risk_weight: float = 0.5


@app.post("/tools/portfolio")
def portfolio(r: PortfolioReq):
    return mean_cvar(np.array(r.net_benefit_draws), np.array(r.capex), r.budget, alpha=r.alpha, w=r.risk_weight)


class AgentReq(BaseModel):
    question: str
    session_id: Optional[str] = None


@app.post("/agent/chat")
async def agent_chat(r: AgentReq):
    """Ask the HELIOS agent team (Gemini via ADK). Returns the answer, the tool-call trace and the guardrail verdict."""
    from helios_engine.agents.runner import ask, has_credentials

    if not has_credentials():
        raise HTTPException(503, "Agent team needs GEMINI_API_KEY (or Vertex AI credentials) on the engine service")
    return await ask(r.question, r.session_id)


class StudioReq(BaseModel):
    message: str
    session_id: Optional[str] = None


@app.post("/agent/studio")
async def agent_studio(r: StudioReq):
    """Agent Studio: the ADK team designs, simulates, checks and challenges a plan. Server-sent events."""
    import json as _json

    from fastapi.responses import StreamingResponse

    from helios_engine.agents.studio_runner import stream, studio_ready

    ok, why = studio_ready()
    if not ok:
        raise HTTPException(503, f"Agent Studio needs a model: {why}")

    async def gen():
        # Keep-alive comment every 15 s so proxies (Cloud Run, browsers) don't drop a quiet stream
        # while a model is thinking.
        import asyncio

        it = stream(r.message, r.session_id).__aiter__()
        pending = asyncio.ensure_future(it.__anext__())
        while True:
            done, _ = await asyncio.wait({pending}, timeout=15)
            if not done:
                yield ": keep-alive\n\n"
                continue
            try:
                ev = pending.result()
            except StopAsyncIteration:
                break
            yield f"data: {_json.dumps(ev, default=str)}\n\n"
            pending = asyncio.ensure_future(it.__anext__())

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/tools/datasets")
def datasets(q: str, limit: int = 8):
    from helios_engine.agents.librarian import search_catalog

    return {"results": search_catalog(q, limit)}


class RegretReq(BaseModel):
    nb_by_scenario: list[list[float]]


@app.post("/tools/minimax-regret")
def regret(r: RegretReq):
    return minimax_regret(np.array(r.nb_by_scenario))
