"""Tools the HELIOS agents call. Agents never produce numbers themselves: every figure they quote
comes from one of these functions, and every return value carries `sources` so the guardrail can
check citations (see guardrails.py).

All tools are plain typed Python functions with docstrings — ADK turns them into FunctionTools.
"""
from __future__ import annotations

import json
from functools import lru_cache

import numpy as np

from ..choice.utility import ASSUMPTIONS
from ..data.registry import PROCESSED_DIR
from ..decision.evpi import evpi, evppi
from ..decision.portfolio import mean_cvar, minimax_regret
from ..energy.queue import size_chargers as _size_chargers
from .librarian import search_catalog
from .shock_schema import validate_shock

CAL = ASSUMPTIONS / "calibrated"


def _cal(name: str) -> dict:
    return json.loads((CAL / name).read_text())


@lru_cache(maxsize=1)
def _draws():
    z = np.load(PROCESSED_DIR / "decision_draws.npz", allow_pickle=False)
    return {k: z[k] for k in z.files}


def list_interventions() -> dict:
    """List the candidate interventions HELIO has evaluated for the district, with capex and verdict.

    Returns: {"interventions": [{id, label, capex_usd, verdict, expected_net_benefit_usd, p10_usd, p90_usd,
              chance_of_loss, top_uncertainty}], "sources": [...]}
    """
    d = _cal("decision_calibrated.json")
    rows = []
    for c in d["candidates"]:
        top = max(c["sobol"].items(), key=lambda kv: kv[1]["ST"])[0]
        rows.append(
            {
                "id": c["id"],
                "label": c["label"],
                "capex_usd": c["capexUsd"],
                "verdict": c["gate"]["verdict"],
                "expected_net_benefit_usd": round(c["netBenefit"]["mean"]),
                "p10_usd": round(c["netBenefit"]["p10"]),
                "p90_usd": round(c["netBenefit"]["p90"]),
                "chance_of_loss": round(c["gate"]["p_net_loss"], 3),
                "top_uncertainty": top,
            }
        )
    rows.sort(key=lambda r: -r["expected_net_benefit_usd"])
    return {"interventions": rows, "sources": ["helios:decision_calibrated.json", f"draws:{d['n_samples']}"]}


def recommend_portfolio(budget_usd: float, risk_aversion: float = 0.5) -> dict:
    """Choose the best set of interventions within a budget, balancing expected value and downside risk.

    Args:
        budget_usd: total capital budget in US dollars.
        risk_aversion: 0 = maximise expected net benefit; 1 = maximise the average of the worst 10% of futures.
    Returns: selected interventions, expected net benefit, worst-10% average (CVaR), chance of net loss.
    """
    D = _draws()
    r = mean_cvar(D["NB"], D["capex"], float(budget_usd), alpha=0.1, w=float(np.clip(risk_aversion, 0, 1)))
    sel = [i for i, x in enumerate(r["selected"]) if x]
    return {
        "selected": [{"id": str(D["ids"][i]), "label": str(D["labels"][i]), "capex_usd": float(D["capex"][i])} for i in sel],
        "capex_usd": round(r["capex"]),
        "expected_net_benefit_usd": round(r["expected_net_benefit"]),
        "worst_10pct_average_usd": round(r["cvar"]),
        "chance_of_net_loss": round(r["p_net_loss"], 3),
        "method": "mean–CVaR mixed-integer program (Rockafellar–Uryasev), HiGHS",
        "sources": ["helios:decision_draws.npz", "helios:decision_calibrated.json"],
    }


def value_of_information(intervention_ids: list[str] | None = None) -> dict:
    """How much it is worth to reduce uncertainty before choosing among interventions, and which study to run.

    Args:
        intervention_ids: optional subset of intervention ids to choose between (default: all).
    Returns: EVPI (value of removing all uncertainty), EVPPI per parameter, and the study whose value
             most exceeds its cost.
    """
    D = _draws()
    d = _cal("decision_calibrated.json")
    ids = [str(x) for x in D["ids"]]
    cols = [ids.index(i) for i in intervention_ids if i in ids] if intervention_ids else list(range(len(ids)))
    NB = np.column_stack([D["NB"][:, cols], np.zeros(len(D["NB"]))])
    params = [str(p) for p in D["params"]]
    ev = {p: round(evppi(NB, D["X"][:, k])) for k, p in enumerate(params)}
    cost = d["study_cost_usd"]
    worth = {p: ev[p] - cost.get(p, np.inf) for p in params}
    best = max(worth, key=worth.get)
    return {
        "evpi_usd": round(evpi(NB)),
        "evppi_usd": ev,
        "study_cost_usd": cost,
        "recommended_study": best if worth[best] > 0 else None,
        "recommended_study_net_value_usd": round(worth[best]) if worth[best] > 0 else 0,
        "sources": ["helios:decision_draws.npz", "study costs: consultancy proxy"],
    }


def pathway_regret() -> dict:
    """Which intervention is the safest first pick across Singapore Green Plan pathways (minimax regret)."""
    d = _cal("decision_calibrated.json")["pathway_regret"]
    tbl = np.array(d["nb_by_pathway"])
    r = minimax_regret(np.column_stack([tbl, np.zeros(len(tbl))]))
    return {"pathways": d["pathways"], "minimax_choice": d["minimax_choice"], "max_regret_by_option_usd": {k: round(v) for k, v in d["max_regret_by_option"].items()}, "check_choice_index": r["choice"], "sources": ["helios:decision_calibrated.json"]}


def model_validation() -> dict:
    """How accurate HELIO's models are: out-of-sample errors, physics checks, forecast holdouts."""
    mc = _cal("mode_choice_calibrated.json")["validation"]
    heat = _cal("heat_calibrated.json")["validation"]
    en = _cal("energy_calibrated.json")
    t = mc["temporal_holdout_2020_to_2025"]
    return {
        "mode_choice_out_of_sample_mae_pp": round(t["calibrated_persistence_plus_national_trend"]["weighted_mae_pp"], 2),
        "mode_choice_uncalibrated_mae_pp": round(t["baseline_national_share"]["weighted_mae_pp"], 2),
        "spatial_holdout_mae_pp": round(mc["spatial_5fold_from_covariates"]["calibrated"]["weighted_mae_pp"], 2),
        "weather_input_wetbulb_mae_c": heat["mae_c"],
        "solar_adoption_holdout_mape_pct": round(en["solar_diffusion"]["fit"]["holdout_mape"], 1),
        "pv_yield_kwh_per_kwp": en["pv"]["annual_kwh_per_kwp"],
        "sources": ["SingStat C020139, 17594 (census mode shares)", "NEA wet-bulb hourly (data.gov.sg)", "EMA solar capacity (SingStat M891611)"],
    }


def heat_at_hour(hour: int) -> dict:
    """Pedestrian thermal stress (UTCI °C) in sun and in shade at a given hour of day (7–19), Singapore climatology.

    Args:
        hour: hour of day, 7 to 19.
    """
    rows = {r["hour"]: r for r in _cal("heat_calibrated.json")["utci_by_hour_annual"]}
    if hour not in rows:
        return {"error": f"hour must be one of {sorted(rows)}"}
    r = rows[hour]
    return {"hour": hour, "air_temp_c": r["temp_c"], "utci_sun_c": r["utci_sun"], "utci_shade_c": r["utci_shade"], "mrt_sun_c": r["mrt_sun"], "mrt_shade_c": r["mrt_shade"], "sources": ["NEA 2024 hourly temp/RH/wind", "SolarCal + UTCI (pythermalcomfort)"]}


def size_ev_chargers(peak_arrivals_per_hour: float, mean_charge_hours: float, max_wait_minutes: float = 10.0) -> dict:
    """Minimum number of EV chargers so that at most 5% of drivers wait longer than max_wait_minutes (Erlang-C).

    Args:
        peak_arrivals_per_hour: expected EV arrivals in the busiest hour.
        mean_charge_hours: average charging session length in hours.
        max_wait_minutes: service target.
    """
    r = _size_chargers(peak_arrivals_per_hour, mean_charge_hours, max_wait_minutes, 0.05)
    return {**r, "method": "Erlang-C queueing", "sources": ["helios:energy/queue.py"]}


def find_datasets(query: str, limit: int = 8) -> dict:
    """Search Singapore's 7,489 public government datasets (data.gov.sg + SingStat) for ones relevant to a question.

    Args:
        query: what you need, in plain words (e.g. "elderly population by planning area").
        limit: number of results.
    Returns: datasets with id, title, agency, coverage and URL.
    """
    return {"results": search_catalog(query, limit), "sources": ["catalog: data.gov.sg API + SingStat TableBuilder (fetched 2026-10-13)"]}


def check_shock(shock_json: str) -> dict:
    """Validate a proposed simulator shock (from a news event) against the HELIO shock schema.

    Args:
        shock_json: JSON string of a shock, e.g. {"type": "oil_price_spike", "startYear": 2027, "durationYears": 1, "carCostIncreasePct": 30}.
    Returns: {"valid": bool, "shock": normalised shock or None, "errors": [...]}
    """
    return validate_shock(shock_json)


ALL_TOOLS = [
    list_interventions,
    recommend_portfolio,
    value_of_information,
    pathway_regret,
    model_validation,
    heat_at_hour,
    size_ev_chargers,
    find_datasets,
    check_shock,
]
