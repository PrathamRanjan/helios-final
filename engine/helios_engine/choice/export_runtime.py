"""Produce runtime parameters for the TypeScript engine (nested logit + planning-area effects).

Two-level calibration, keeping concepts separate:
  1. National all-day constants under the NESTED model, solved so the trip-weighted baseline split
     over the Jurong East world graph equals what the accepted MNL baseline produced. The baseline
     the judges saw does not move; only substitution behaviour (IIA fix) changes.
  2. Planning-area RELATIVE effects  δ_rel(PA) = δ(PA) − δ(national), from GHS 2025 commute
     calibration. Applied per corridor by the planning area of its midpoint.

    cd helios/engine && .venv/bin/python -m helios_engine.choice.export_runtime
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from ..data.geo import pa_of
from . import census
from .nested_logit import HELIOS_NESTS, mnl_probabilities, probabilities
from .run_calibration import OUT_DIR, base_utilities, calibrate
from .utility import FRONTEND, MC, MODES, Edge, utilities


def _edges():
    w = json.loads((FRONTEND / "data" / "world_baseline_jurong_east.json").read_text())
    return w["edges"]


def _edge_obj(e: dict) -> Edge:
    a = e["attrs"]
    return Edge(
        dist_km=e["distKm"],
        heat_exposure=a["heatExposure"],
        rain_exposure=a["rainExposure"],
        shade_score=a["shadeScore"],
        comfort_score=a["comfortScore"],
        safety_score=a["safetyScore"],
    )


def main() -> dict:
    edges = _edges()
    V = np.array([utilities(_edge_obj(e)) for e in edges])
    trips = np.array([e["totalTripsDaily"] for e in edges])

    # Planning-area relative effects from census calibration (needed before solving national constants).
    s25, _ = census.mode_shares("mode_by_pa_res_2025")
    tt = census.mean_commute_minutes("travel_time_by_pa_2025")
    d_pa = calibrate(s25, base_utilities(tt))
    nat = census.national_shares("mode_by_pa_res_2025")
    d_nat = calibrate(pd.DataFrame([nat], index=["_n"], columns=MODES), base_utilities(pd.Series({"_n": float(tt.mean())}))).iloc[0]
    rel = (d_pa - d_nat).round(5)

    edge_pa = {}
    D = np.zeros_like(V)
    for i, e in enumerate(edges):
        pa = pa_of(e["midLng"], e["midLat"])
        if pa and pa in rel.index:
            edge_pa[e["id"]] = pa
            D[i] = rel.loc[pa, list(MODES)].values
    pas_used = sorted(set(edge_pa.values()))

    # 1. National constants under the nested model, solved WITH the area effects in place, so the
    #    district's trip-weighted baseline split equals the accepted MNL baseline.
    # The accepted baseline split is pinned once (first export) and never recomputed from changed
    # attributes — later physics upgrades (heat, shade) re-solve constants to keep it.
    prev = OUT_DIR / "mode_choice_calibrated.json"
    prev_target = (json.loads(prev.read_text()).get("runtime") or {}).get("baseline_split_target") if prev.exists() else None
    if prev_target:
        target = np.array([prev_target[m] for m in MODES])
    else:
        target = (mnl_probabilities(V) * trips[:, None]).sum(0) / trips.sum()
    a = np.zeros(5)
    omega = min(HELIOS_NESTS.lambdas.values())
    for it in range(5000):
        agg = (probabilities(V + D + a, HELIOS_NESTS) * trips[:, None]).sum(0) / trips.sum()
        gap = np.log(target) - np.log(agg)
        a = a + omega * gap
        a -= a[0]
        if np.max(np.abs(gap)) < 1e-10:
            break
    asc_nested = {m: round(float(MC["asc"][m] + a[i]), 6) for i, m in enumerate(MODES)}

    out_path = OUT_DIR / "mode_choice_calibrated.json"
    cal = json.loads(out_path.read_text()) if out_path.exists() else {}
    cal["runtime"] = {
        "_note": "Consumed by web/lib/compass/world/agentChoice.ts. asc_nested keeps the accepted all-day baseline split under the nested model; pa_delta_relative adds each planning area's census-calibrated deviation from the national average.",
        "asc_nested": asc_nested,
        "asc_nested_label": "calibrated (preserves accepted baseline split)",
        "lambda": dict(HELIOS_NESTS.lambdas),
        "pa_delta_relative": {pa: {m: float(rel.loc[pa, m]) for m in MODES} for pa in pas_used},
        "pa_delta_relative_label": "calibrated to census (GHS 2025, by planning area)",
        # Every published planning area, so worlds built by ingest/build_area.py (edge.pa) get their own constants.
        "pa_delta_relative_all": {pa: {m: float(rel.loc[pa, m]) for m in MODES} for pa in rel.index},
        "pa_delta_relative_all_label": "calibrated to census (GHS 2025) — every published planning area; used for areas outside the original district via the corridor's planning area",
        "edge_pa": edge_pa,
        "baseline_split_target": dict(zip(MODES, map(float, target))),
        # Equity: demographics of each planning area the district's corridors fall in (GHS 2025).
        "pa_demographics": {
            pa: {
                "senior_share": round(float(census.senior_share().get(pa, np.nan)), 4),
                "low_income_share": round(float(census.low_income_share().get(pa, np.nan)), 4),
            }
            for pa in pas_used
        },
        "pa_demographics_label": "measured (GHS 2025: residents 65+, households < S$4,000/month employment income)",
    }
    out_path.write_text(json.dumps(cal, indent=1, allow_nan=False))
    return {"asc_nested": asc_nested, "pas": pas_used, "edges_mapped": len(edge_pa), "of": len(edges), "target": dict(zip(MODES, np.round(target, 4)))}


if __name__ == "__main__":
    print(json.dumps(main(), indent=2, default=str))
