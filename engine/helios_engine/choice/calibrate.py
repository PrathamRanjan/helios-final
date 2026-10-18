"""Calibrate alternative-specific constants so the model reproduces observed shares exactly.

BLP-style contraction mapping (Berry 1994; Berry, Levinsohn & Pakes 1995):
    δ^{t+1} = δ^t + ω · [ ln S_obs − ln Ŝ(δ^t) ]
For MNL ω = 1 converges in one step; for nested logit we use ω = min λ (a standard damped
step that guarantees contraction). One alternative is the normalisation (δ = 0).

Calibrating per planning area turns the ledger entry for ASCs from "plausible, hand-tuned"
into "calibrated to census mode shares by planning area".
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .nested_logit import NestSpec, probabilities


@dataclass
class CalibrationResult:
    delta: np.ndarray        # (..., n_alt) constants added to base utility
    iterations: int
    max_abs_log_error: float
    converged: bool


def calibrate_constants(
    V_base: np.ndarray,
    S_obs: np.ndarray,
    spec: NestSpec,
    *,
    ref: int = 0,
    tol: float = 1e-10,
    max_iter: int = 5000,
    floor: float = 1e-6,
) -> CalibrationResult:
    """Find δ so that probabilities(V_base + δ) == S_obs (row-wise). δ[..., ref] is fixed at 0.

    V_base: (..., n_alt) systematic utility from times, costs, comfort etc.
    S_obs:  (..., n_alt) observed shares (rows sum to 1). Zero shares are floored (a share
            of exactly 0 has no finite constant) and the row renormalised.
    """
    V_base = np.asarray(V_base, dtype=float)
    S = np.clip(np.asarray(S_obs, dtype=float), floor, None)
    S = S / S.sum(axis=-1, keepdims=True)
    lnS = np.log(S)
    omega = min([spec.lam(k) for k in spec.nests] + [1.0])

    delta = np.zeros_like(V_base)
    err = np.inf
    for it in range(1, max_iter + 1):
        P = probabilities(V_base + delta, spec)
        gap = lnS - np.log(np.clip(P, 1e-300, None))
        delta = delta + omega * gap
        delta = delta - delta[..., ref : ref + 1]  # normalisation
        err = float(np.max(np.abs(gap)))
        if err < tol:
            return CalibrationResult(delta, it, err, True)
    return CalibrationResult(delta, max_iter, err, False)
