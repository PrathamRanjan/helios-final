"""Exact Python port of the Helios TypeScript utility (web/lib/compass/world/agentChoice.ts).

Reads the same JSON assumption files, so Python calibration and the TS runtime share one
definition of utility. Any change to agentChoice.ts must be mirrored here (a parity test
checks representative values).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

FRONTEND = Path(__file__).resolve().parents[3] / "web"
ASSUMPTIONS = FRONTEND / "data" / "assumptions"
MODES = ("car", "bus", "mrt", "walk", "cycle")


def _load(name: str) -> dict:
    return json.loads((ASSUMPTIONS / name).read_text())


MC = _load("mode_choice.json")
WD = _load("world_defaults.json")
try:
    _freq = json.loads((FRONTEND / "data" / "lta_frequencies.json").read_text())
    REAL_BUS_WAIT = _freq.get("peak_wait_min")
except FileNotFoundError:
    REAL_BUS_WAIT = None


@dataclass
class Edge:
    """The subset of CorridorEdge.attrs that utility() reads."""

    dist_km: float
    heat_exposure: float = WD["edge_defaults"]["heatExposure"]["value"]
    rain_exposure: float = WD["edge_defaults"]["rainExposure"]["value"]
    shade_score: float = WD["edge_defaults"]["shadeScore"]["value"]
    comfort_score: float = WD["edge_defaults"]["comfortScore"]["value"]
    safety_score: float = WD["edge_defaults"]["safetyScore"]["value"]
    comfort_bonus: dict = field(default_factory=dict)
    safety_bonus: dict = field(default_factory=dict)
    travel_time_multiplier: dict = field(default_factory=dict)
    cost_multiplier: dict = field(default_factory=dict)
    car_time_penalty_min: float = 0.0
    bus_wait_delta_min: float = 0.0
    cycle_max_km_extension: float = 0.0


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def utility(mode: str, e: Edge, asc: dict | None = None) -> float:
    B = {k: v["value"] for k, v in MC["betas"].items()}
    ASC = asc if asc is not None else MC["asc"]
    wait = dict(MC["access_wait_min"])
    if isinstance(REAL_BUS_WAIT, (int, float)):
        wait["bus"] = REAL_BUS_WAIT
    w = wait[mode]
    if mode == "bus":
        w = max(1.0, w + e.bus_wait_delta_min)
    if mode == "car":
        w += e.car_time_penalty_min
    time_min = (e.dist_km / MC["speed_kmh"][mode]) * 60 * e.travel_time_multiplier.get(mode, 1.0) + w
    cost = (e.dist_km * MC["cost_per_km_usd"][mode] + MC["fixed_cost_usd"][mode]) * e.cost_multiplier.get(mode, 1.0)
    eff_heat = e.heat_exposure * (1 - e.shade_score)
    comfort = _clamp01(e.comfort_score + e.comfort_bonus.get(mode, 0.0))
    safety = _clamp01(e.safety_score + e.safety_bonus.get(mode, 0.0))
    u = (
        B["time_per_min"] * time_min
        + B["cost_per_usd"] * cost
        + B["heat"] * eff_heat * MC["exposure_weight_by_mode"][mode]
        + B["rain"] * e.rain_exposure * MC["exposure_weight_by_mode"][mode]
        + B["comfort"] * (1 - comfort) * MC["comfort_weight_by_mode"][mode]
        + B["safety"] * (1 - safety) * MC["safety_weight_by_mode"][mode]
        + ASC[mode]
    )
    if mode == "walk" and e.dist_km > MC["walk_max_km"]:
        u += MC["infeasible_penalty"]
    if mode == "cycle" and e.dist_km > MC["cycle_max_km"] + e.cycle_max_km_extension:
        u += MC["infeasible_penalty"]
    return u


def utilities(e: Edge, asc: dict | None = None) -> np.ndarray:
    return np.array([utility(m, e, asc) for m in MODES])
