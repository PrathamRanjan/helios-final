"""Erlang-C queueing for EV charger sizing.

Arrivals Poisson(λ per hour), service time exponential with mean 1/μ hours, c chargers.
    a = λ/μ (offered load, Erlangs),  ρ = a/c < 1 required
    P(wait > 0)  = ErlangC(c, a) = [a^c/c! · c/(c−a)] / [Σ_{k<c} a^k/k! + a^c/c! · c/(c−a)]
    P(wait > t)  = ErlangC · exp(−(cμ − λ) t)
    E[wait]      = ErlangC / (cμ − λ)
Choose the smallest c meeting a service target, e.g. P(wait > 10 min) ≤ 5 %.
"""
from __future__ import annotations

import math


def erlang_c(c: int, a: float) -> float:
    if a <= 0:
        return 0.0
    if a >= c:
        return 1.0
    # stable recursion via Erlang B: B(0)=1, B(k)=a·B(k−1)/(k + a·B(k−1))
    b = 1.0
    for k in range(1, c + 1):
        b = a * b / (k + a * b)
    return c * b / (c - a * (1 - b))


def p_wait_exceeds(c: int, lam: float, mu: float, t_hours: float) -> float:
    a = lam / mu
    if a >= c:
        return 1.0
    return erlang_c(c, a) * math.exp(-(c * mu - lam) * t_hours)


def mean_wait_hours(c: int, lam: float, mu: float) -> float:
    a = lam / mu
    if a >= c:
        return math.inf
    return erlang_c(c, a) / (c * mu - lam)


def size_chargers(lam_peak: float, mean_charge_hours: float, max_wait_min: float = 10.0, max_prob: float = 0.05, c_max: int = 500) -> dict:
    mu = 1.0 / mean_charge_hours
    for c in range(1, c_max + 1):
        pw = p_wait_exceeds(c, lam_peak, mu, max_wait_min / 60.0)
        if pw <= max_prob:
            return {
                "chargers": c,
                "utilisation": lam_peak / (c * mu),
                "p_wait_over_target": pw,
                "mean_wait_min": mean_wait_hours(c, lam_peak, mu) * 60,
            }
    raise ValueError("demand exceeds c_max chargers")
