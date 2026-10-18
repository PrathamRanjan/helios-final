"""Bass (1969) diffusion model — estimated adoption curves for solar PV and EVs.

    dN/dt = (p + q·N/M) · (M − N)
    N(t)  = M · (1 − e^{−(p+q)(t−t0)}) / (1 + (q/p)·e^{−(p+q)(t−t0)})

p = innovation (external influence: subsidies, mandates), q = imitation (word of mouth),
M = market potential. Fitted by non-linear least squares on the cumulative series, with an
optional fixed M when a policy target defines the ceiling (e.g. SolarNova 2 GWp by 2030).

Replaces the hand-drawn 10-year logistic adoption ramp with a curve estimated from real
Singapore data, validated by holding out the last years.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import least_squares


def bass_cumulative(t: np.ndarray, p: float, q: float, M: float, t0: float = 0.0) -> np.ndarray:
    tt = np.maximum(np.asarray(t, dtype=float) - t0, 0.0)
    e = np.exp(-(p + q) * tt)
    return M * (1 - e) / (1 + (q / p) * e)


def bass_peak_time(p: float, q: float) -> float:
    """Time of peak adoption rate (inflection), t* = ln(q/p)/(p+q), when q > p."""
    return float(np.log(q / p) / (p + q)) if q > p else 0.0


@dataclass
class BassFit:
    p: float
    q: float
    M: float
    t0: float
    rmse: float
    n: int
    holdout_mape: float | None = None
    holdout_years: list | None = None

    def predict(self, t) -> np.ndarray:
        return bass_cumulative(np.asarray(t, dtype=float), self.p, self.q, self.M, self.t0)

    def as_dict(self) -> dict:
        return {
            "p": self.p,
            "q": self.q,
            "M": self.M,
            "t0": self.t0,
            "rmse": self.rmse,
            "n": self.n,
            "peak_year": self.t0 + bass_peak_time(self.p, self.q),
            "holdout_mape": self.holdout_mape,
            "holdout_years": self.holdout_years,
        }


def fit_bass(t, y, *, M_fixed: float | None = None, t0: float | None = None) -> BassFit:
    t = np.asarray(t, dtype=float)
    y = np.asarray(y, dtype=float)
    t0 = float(t.min() - 1) if t0 is None else t0
    ymax = float(y.max())

    def resid(theta):
        p, q = np.exp(theta[0]), np.exp(theta[1])
        M = M_fixed if M_fixed is not None else np.exp(theta[2])
        return (bass_cumulative(t, p, q, M, t0) - y) / max(ymax, 1e-9)

    starts = []
    for p0 in (0.001, 0.005, 0.02):
        for q0 in (0.2, 0.4, 0.7):
            th = [np.log(p0), np.log(q0)]
            if M_fixed is None:
                th.append(np.log(ymax * 3))
            starts.append(th)
    best = None
    for th in starts:
        r = least_squares(resid, th, method="trf", max_nfev=20000)
        if best is None or r.cost < best.cost:
            best = r
    p, q = float(np.exp(best.x[0])), float(np.exp(best.x[1]))
    M = float(M_fixed) if M_fixed is not None else float(np.exp(best.x[2]))
    rmse = float(np.sqrt(np.mean((bass_cumulative(t, p, q, M, t0) - y) ** 2)))
    return BassFit(p, q, M, t0, rmse, len(t))


def fit_with_holdout(t, y, holdout: int = 3, **kw) -> BassFit:
    """Fit on all but the last `holdout` points, score MAPE on them, then refit on everything."""
    t = np.asarray(t, dtype=float)
    y = np.asarray(y, dtype=float)
    tr = fit_bass(t[:-holdout], y[:-holdout], **kw)
    pred = tr.predict(t[-holdout:])
    mape = float(np.mean(np.abs(pred - y[-holdout:]) / np.abs(y[-holdout:])) * 100)
    full = fit_bass(t, y, **kw)
    full.holdout_mape = mape
    full.holdout_years = [int(x) for x in t[-holdout:]]
    return full
