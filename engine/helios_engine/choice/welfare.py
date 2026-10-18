"""Welfare and behavioural diagnostics from the choice model.

Consumer surplus change (Small & Rosen 1981), valid for logit-family models with
utility linear in cost:
    ΔCS = (1 / |β_cost|) · [ logsum(V_after) − logsum(V_before) ]      ($ per trip)

Implied value of time:  VoT = β_time / β_cost  ($ per minute → × 60 for $/hour)

Elasticities are computed numerically on the actual (nested) model, so they stay correct
when nests break IIA — the analytic MNL formula e = β·x·(1−P) is reported alongside for MNL.
"""
from __future__ import annotations

import numpy as np

from .nested_logit import NestSpec, logsum, probabilities


def delta_consumer_surplus(V_before: np.ndarray, V_after: np.ndarray, spec: NestSpec, beta_cost: float) -> np.ndarray:
    if beta_cost >= 0:
        raise ValueError("β_cost must be negative (cost is a disutility)")
    return (logsum(V_after, spec) - logsum(V_before, spec)) / abs(beta_cost)


def value_of_time_per_hour(beta_time_per_min: float, beta_cost_per_usd: float) -> float:
    return 60.0 * beta_time_per_min / beta_cost_per_usd


def elasticity_matrix(V: np.ndarray, X: np.ndarray, beta: float, spec: NestSpec, rel_step: float = 1e-4) -> np.ndarray:
    """E[i, j] = ∂ln P_i / ∂ln x_j for one choice situation.

    V: (n_alt,) utilities; X: (n_alt,) attribute levels (e.g. cost); beta: its coefficient.
    Utility changes by beta·Δx_j when x_j changes.
    """
    V = np.asarray(V, dtype=float)
    X = np.asarray(X, dtype=float)
    P0 = probabilities(V, spec)
    n = len(V)
    E = np.zeros((n, n))
    for j in range(n):
        if X[j] == 0:
            continue
        dx = X[j] * rel_step
        V1 = V.copy()
        V1[j] += beta * dx
        P1 = probabilities(V1, spec)
        E[:, j] = (np.log(P1) - np.log(P0)) / np.log1p(rel_step)
    return E


def mnl_direct_elasticity(beta: float, x: float, p: float) -> float:
    return beta * x * (1.0 - p)


def mnl_cross_elasticity(beta: float, x_j: float, p_j: float) -> float:
    return -beta * x_j * p_j
