"""Calibrate Helios mode choice to census by planning area, validate out-of-sample, export for the TS engine.

    cd helios/engine && .venv/bin/python -m helios_engine.choice.run_calibration

Outputs
  web/data/assumptions/calibrated/mode_choice_calibrated.json   (consumed by the TS engine)
  engine/data/processed/validation_mode_choice.json                   (validation report)

Validation (fit ≠ test)
  A. Temporal: constants fitted on Census 2020 + 2025 commute times → predict GHS 2025 shares.
  B. Spatial: regress constants on planning-area covariates (income, dwelling mix, seniors, commute
     time) using K-fold cross-validation; predict held-out areas' shares from covariates alone.
  Baseline for both: every area gets the national share (what an uncalibrated model implies).
"""
from __future__ import annotations

import datetime as dt
import json

import numpy as np
import pandas as pd

from ..data.registry import PROCESSED_DIR
from . import census
from .calibrate import calibrate_constants
from .nested_logit import HELIOS_NESTS, probabilities
from .utility import ASSUMPTIONS, MODES, Edge, utilities

DOOR_TO_DOOR_KMH = 20.0  # converts mean commute minutes → representative distance (calibrated proxy)
OUT_DIR = ASSUMPTIONS / "calibrated"


def base_utilities(commute_min: pd.Series) -> pd.DataFrame:
    rows = {}
    for pa, minutes in commute_min.items():
        d = float(minutes) * DOOR_TO_DOOR_KMH / 60.0
        rows[pa] = utilities(Edge(dist_km=d))
    return pd.DataFrame(rows, index=MODES).T


def calibrate(shares: pd.DataFrame, V: pd.DataFrame) -> pd.DataFrame:
    idx = shares.index.intersection(V.index)
    res = calibrate_constants(V.loc[idx].values, shares.loc[idx].values, HELIOS_NESTS)
    assert res.converged, f"calibration did not converge (err={res.max_abs_log_error})"
    return pd.DataFrame(res.delta, index=idx, columns=MODES)


def predict(V: pd.DataFrame, delta: pd.DataFrame) -> pd.DataFrame:
    idx = V.index.intersection(delta.index)
    P = probabilities(V.loc[idx].values + delta.loc[idx].values, HELIOS_NESTS)
    return pd.DataFrame(P, index=idx, columns=MODES)


def errors(pred: pd.DataFrame, obs: pd.DataFrame, weights: pd.Series) -> dict:
    idx = pred.index.intersection(obs.index)
    e = (pred.loc[idx] - obs.loc[idx]).abs()
    w = weights.reindex(idx).fillna(0)
    w = w / w.sum()
    out = {
        "n_areas": int(len(idx)),
        "weighted_mae_pp": float((e.mul(w, axis=0).sum(axis=0)).mean() * 100),
        "by_mode_mae_pp": {m: float((e[m] * w).sum() * 100) for m in MODES},
    }
    for m in ("car", "mrt", "bus"):
        o = obs.loc[idx, m]
        rc = float(pred.loc[idx, m].rank().corr(o.rank()))
        out[f"{m}_rank_corr"] = None if np.isnan(rc) else rc  # NaN for a constant baseline
    return out


def ridge_fit_predict(X_tr, Y_tr, X_te, alpha=1.0):
    mu, sd = X_tr.mean(0), X_tr.std(0) + 1e-9
    A = np.c_[np.ones(len(X_tr)), (X_tr - mu) / sd]
    B = np.c_[np.ones(len(X_te)), (X_te - mu) / sd]
    I = np.eye(A.shape[1])
    I[0, 0] = 0
    W = np.linalg.solve(A.T @ A + alpha * I, A.T @ Y_tr)
    return B @ W, W, mu, sd


def main() -> dict:
    s25, n25 = census.mode_shares("mode_by_pa_res_2025")
    s20, n20 = census.mode_shares("mode_by_pa_res_2020")
    tt25 = census.mean_commute_minutes("travel_time_by_pa_2025")
    V25 = base_utilities(tt25)
    nat25 = census.national_shares("mode_by_pa_res_2025")

    # Calibrated constants (the deliverable): fit on 2025 for every area.
    d25 = calibrate(s25, V25)

    # A. Temporal holdout: fit on 2020, predict 2025.
    V20 = base_utilities(tt25)  # 2020 travel-time table not ingested; same representative distance (documented)
    d20 = calibrate(s20, V20)
    pred_temporal = predict(V25, d20)
    # A2. Persistence + national trend: shift every area's 2020 constants by the national change
    # in constants between 2020 and 2025 (national totals are published long before area tables).
    nat20 = census.national_shares("mode_by_pa_res_2020")
    V_nat = base_utilities(pd.Series({"_national": float(tt25.mean())}))
    dn25 = calibrate(pd.DataFrame([nat25], index=["_national"], columns=MODES), V_nat)
    dn20 = calibrate(pd.DataFrame([nat20], index=["_national"], columns=MODES), V_nat)
    trend = (dn25.values - dn20.values)[0]
    pred_trend = predict(V25, d20 + trend)
    base_temporal = pd.DataFrame([nat25] * len(s25), index=s25.index, columns=MODES)

    # B. Spatial K-fold: constants explained by covariates.
    X = census.covariates()
    common = d25.index.intersection(X.index)
    Xc, Dc = X.loc[common].values, d25.loc[common].values
    rng = np.random.default_rng(42)
    folds = np.array_split(rng.permutation(len(common)), 5)
    pred_spatial = pd.DataFrame(index=common, columns=MODES, dtype=float)
    for f in folds:
        tr = np.setdiff1d(np.arange(len(common)), f)
        D_hat, *_ = ridge_fit_predict(Xc[tr], Dc[tr], Xc[f])
        P = probabilities(V25.loc[common].values[f] + D_hat, HELIOS_NESTS)
        pred_spatial.iloc[f] = P
    base_spatial = pd.DataFrame([nat25] * len(common), index=common, columns=MODES)

    report = {
        "generated": dt.datetime.now().isoformat(timespec="seconds"),
        "model": "nested logit (PT nest λ=0.6, active nest λ=0.75) with planning-area constants",
        "temporal_holdout_2020_to_2025": {
            "calibrated_persistence": errors(pred_temporal, s25, n25),
            "calibrated_persistence_plus_national_trend": errors(pred_trend, s25, n25),
            "baseline_national_share": errors(base_temporal, s25, n25),
        },
        "spatial_5fold_from_covariates": {
            "calibrated": errors(pred_spatial, s25, n25),
            "baseline_national_share": errors(base_spatial, s25, n25),
            "covariates": list(X.columns),
        },
        "in_sample_reproduction_max_error": float((predict(V25, d25) - s25.loc[d25.index]).abs().values.max()),
    }

    # Full-sample covariate model (lets the TS engine / APAC adapter predict constants for new areas).
    _, W, mu, sd = ridge_fit_predict(Xc, Dc, Xc[:1])
    out = {
        "_note": "Planning-area constants (δ) added to mode_choice.json ASCs. Fitted by BLP contraction so the nested logit reproduces GHS 2025 mode-to-work shares exactly. Label: calibrated to census.",
        "generated": report["generated"],
        "source": ["SingStat C020139 (GHS 2025 mode to work × PA of residence)", "SingStat C020140 (travel time × PA)"],
        "nests": {"pt": ["bus", "mrt"], "active": ["walk", "cycle"], "lambda": {"pt": 0.6, "active": 0.75}, "lambda_label": "literature-derived (Ortúzar & Willumsen)"},
        "national_shares_2025": dict(zip(MODES, map(float, nat25))),
        "pa_delta": {pa: {m: round(float(v), 5) for m, v in row.items()} for pa, row in d25.iterrows()},
        "pa_observed_shares_2025": {pa: {m: round(float(v), 5) for m, v in row.items()} for pa, row in s25.iterrows()},
        "covariate_model": {
            "features": list(X.columns),
            "mean": dict(zip(X.columns, map(float, mu))),
            "sd": dict(zip(X.columns, map(float, sd))),
            "weights": {m: [float(w) for w in W[:, i]] for i, m in enumerate(MODES)},
            "note": "δ_m = W[0] + Σ_k W[k]·(x_k − mean_k)/sd_k ; use for areas without census data",
        },
        "validation": report,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "mode_choice_calibrated.json").write_text(json.dumps(out, indent=2, allow_nan=False))
    (PROCESSED_DIR / "validation_mode_choice.json").write_text(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    print(json.dumps(main(), indent=2))
