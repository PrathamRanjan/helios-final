"""Value of information — the formal FUND / STUDY / DEFER gate.

Net benefit NB(a, θ) for each option a (including "do nothing", NB = 0) over posterior draws θ.

    EVPI          = E_θ[ max_a NB(a, θ) ] − max_a E_θ[ NB(a, θ) ]
    EVPPI(θ_i)    = E_{θ_i}[ max_a E[NB(a, θ) | θ_i] ] − max_a E_θ[ NB(a, θ) ]

EVPPI uses the regression (non-parametric) estimator of Strong, Oakley & Brennan (2014):
E[NB(a,θ) | θ_i] is estimated by smoothing NB(a, ·) against θ_i alone (here: binned means with
monotone-safe smoothing), which needs only the existing PSA draws — no nested Monte Carlo.

Decision rule (per option, relative to doing nothing):
  FUND   if E[NB] > 0 and P(NB < 0) ≤ α
  STUDY  if the best EVPPI exceeds the cost of a study that resolves that parameter
  DEFER  otherwise
Standard in health-technology assessment (NICE); rarely applied to urban infrastructure.
"""
from __future__ import annotations

import numpy as np


def evpi(NB: np.ndarray) -> float:
    """NB: (n_draws, n_options). Include a zero column for 'do nothing' if it is an option."""
    return float(NB.max(axis=1).mean() - NB.mean(axis=0).max())


def _conditional_mean(theta_i: np.ndarray, y: np.ndarray, bins: int = 12) -> np.ndarray:
    q = np.quantile(theta_i, np.linspace(0, 1, bins + 1))
    idx = np.clip(np.searchsorted(q, theta_i, side="right") - 1, 0, bins - 1)
    means = np.array([y[idx == b].mean() if np.any(idx == b) else np.nan for b in range(bins)])
    # fill empties by nearest
    for b in range(bins):
        if np.isnan(means[b]):
            means[b] = np.nanmean(means)
    return means[idx]


def evppi(NB: np.ndarray, theta_i: np.ndarray, bins: int = 12) -> float:
    cond = np.column_stack([_conditional_mean(theta_i, NB[:, a], bins) for a in range(NB.shape[1])])
    return float(max(0.0, cond.max(axis=1).mean() - NB.mean(axis=0).max()))


def gate(nb: np.ndarray, evppi_by_param: dict, study_cost: dict, alpha: float = 0.2) -> dict:
    """Verdict for ONE option vs do-nothing. nb: (n_draws,) net benefit draws (USD)."""
    mean, p_loss = float(nb.mean()), float((nb < 0).mean())
    best_param, best_val = max(evppi_by_param.items(), key=lambda kv: kv[1]) if evppi_by_param else (None, 0.0)
    cost = study_cost.get(best_param, np.inf) if best_param else np.inf
    if mean > 0 and p_loss <= alpha:
        verdict = "FUND"
        why = f"E[net benefit] ${mean:,.0f} and only {p_loss:.0%} chance of a net loss."
    elif best_param and best_val > cost:
        verdict = "STUDY"
        why = (
            f"Uncertainty in '{best_param}' is worth ${best_val:,.0f} of decision value — more than the "
            f"${cost:,.0f} study that would resolve it. Study first, then decide."
        )
    else:
        verdict = "DEFER"
        why = f"E[net benefit] ${mean:,.0f}, {p_loss:.0%} chance of loss, and no study pays for itself."
    return {"verdict": verdict, "expected_net_benefit": mean, "p_net_loss": p_loss, "top_uncertainty": best_param, "top_evppi": best_val, "study_cost": None if cost == np.inf else cost, "reason": why}
