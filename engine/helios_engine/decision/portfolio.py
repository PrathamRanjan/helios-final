"""Risk-aware portfolio selection: mean–CVaR mixed-integer program (Rockafellar & Uryasev 2000).

Choose x_i ∈ {0,1} over candidate interventions with scenario net benefits NB[s, i]:

    max   (1 − w)·(1/S) Σ_s Σ_i NB[s,i] x_i  +  w·CVaR_α
    CVaR_α = η − (1/(α S)) Σ_s u_s
    s.t.  u_s ≥ η − Σ_i NB[s,i] x_i,  u_s ≥ 0        (lower-tail of portfolio net benefit)
          Σ_i capex_i x_i ≤ Budget
          Σ_{i∈family f} x_i ≤ cap_f                   (diversity, optional)

w = 0 → risk-neutral (max expected value); w → 1 → maximise the worst-α average ("even in the worst
10 % of futures, this package still delivers"). Additivity across interventions is assumed inside
the MILP; the chosen package is then re-simulated jointly to check interaction effects.

Also: minimax regret across scenarios (Savage) for deep uncertainty (policy pathways).
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp


def mean_cvar(NB: np.ndarray, capex: np.ndarray, budget: float, *, alpha: float = 0.1, w: float = 0.5, families: list[str] | None = None, family_cap: int | None = None) -> dict:
    S, n = NB.shape
    # variables: x (n, binary), eta (1, free), u (S, ≥0)
    nv = n + 1 + S
    c = np.zeros(nv)
    c[:n] = -(1 - w) * NB.mean(axis=0)
    c[n] = -w
    c[n + 1 :] = w / (alpha * S)
    A, lo, hi = [], [], []
    for s in range(S):  # u_s − η + Σ NB x ≥ 0
        row = np.zeros(nv)
        row[:n] = NB[s]
        row[n] = -1
        row[n + 1 + s] = 1
        A.append(row)
        lo.append(0)
        hi.append(np.inf)
    row = np.zeros(nv)
    row[:n] = capex
    A.append(row)
    lo.append(-np.inf)
    hi.append(budget)
    if families and family_cap:
        for f in sorted(set(families)):
            row = np.zeros(nv)
            row[:n] = [1.0 if fam == f else 0.0 for fam in families]
            A.append(row)
            lo.append(-np.inf)
            hi.append(family_cap)
    integrality = np.r_[np.ones(n), np.zeros(1 + S)]
    bounds = Bounds(np.r_[np.zeros(n), -np.inf, np.zeros(S)], np.r_[np.ones(n), np.inf, np.full(S, np.inf)])
    res = milp(c, constraints=LinearConstraint(np.array(A), lo, hi), integrality=integrality, bounds=bounds)
    if not res.success:
        raise RuntimeError(res.message)
    x = np.round(res.x[:n]).astype(int)
    port = NB @ x
    tail = np.sort(port)[: max(1, int(np.ceil(alpha * S)))]
    return {
        "selected": x.tolist(),
        "expected_net_benefit": float(port.mean()),
        "cvar": float(tail.mean()),
        "p_net_loss": float((port < 0).mean()),
        "capex": float(capex @ x),
    }


def minimax_regret(NB_by_scenario: np.ndarray) -> dict:
    """NB_by_scenario: (n_scenarios, n_options) expected NB under each scenario."""
    regret = NB_by_scenario.max(axis=1, keepdims=True) - NB_by_scenario
    worst = regret.max(axis=0)
    return {"choice": int(worst.argmin()), "max_regret_by_option": worst.tolist()}
