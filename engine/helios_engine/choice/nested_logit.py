"""Nested logit choice model (McFadden 1978), with MNL as the λ = 1 special case.

Utilities V[..., m] over alternatives m; each alternative belongs to one nest k with
dissimilarity λ_k ∈ (0, 1].  λ_k = 1 for every nest  ⇔  multinomial logit.

    P(m) = P(m | k) · P(k)
    P(m | k) = exp(V_m / λ_k) / Σ_{j∈k} exp(V_j / λ_k)
    I_k      = ln Σ_{j∈k} exp(V_j / λ_k)                (inclusive value)
    P(k)     = exp(λ_k I_k) / Σ_l exp(λ_l I_l)
    Logsum   = ln Σ_k exp(λ_k I_k)                       (expected max utility, up to a constant)

All functions are vectorised over leading axes (e.g. corridors × alternatives).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass(frozen=True)
class NestSpec:
    alternatives: tuple[str, ...]
    nest_of: dict[str, str]           # alternative → nest name
    lambdas: dict[str, float] = field(default_factory=dict)  # nest → λ (default 1)

    def __post_init__(self):
        for a in self.alternatives:
            if a not in self.nest_of:
                raise ValueError(f"alternative {a!r} has no nest")
        for k, lam in self.lambdas.items():
            if not (0 < lam <= 1):
                raise ValueError(f"λ for nest {k!r} must be in (0, 1], got {lam}")

    @property
    def nests(self) -> tuple[str, ...]:
        seen: list[str] = []
        for a in self.alternatives:
            k = self.nest_of[a]
            if k not in seen:
                seen.append(k)
        return tuple(seen)

    def lam(self, nest: str) -> float:
        return float(self.lambdas.get(nest, 1.0))

    def with_lambdas(self, **lams: float) -> "NestSpec":
        return NestSpec(self.alternatives, dict(self.nest_of), {**self.lambdas, **lams})


# Helios modes. Bus and MRT share unobserved "public transport" traits; walk and cycle share
# "active, weather-exposed" traits. λ values: literature range 0.5–0.8 for PT nests
# (e.g. Ortúzar & Willumsen, Modelling Transport, 4th ed.) — label: literature-derived.
HELIOS_NESTS = NestSpec(
    alternatives=("car", "bus", "mrt", "walk", "cycle"),
    nest_of={"car": "car", "bus": "pt", "mrt": "pt", "walk": "active", "cycle": "active"},
    lambdas={"pt": 0.6, "active": 0.75},
)


def _alt_index(spec: NestSpec) -> dict[str, list[int]]:
    idx: dict[str, list[int]] = {k: [] for k in spec.nests}
    for i, a in enumerate(spec.alternatives):
        idx[spec.nest_of[a]].append(i)
    return idx


def inclusive_values(V: np.ndarray, spec: NestSpec) -> np.ndarray:
    """I_k for each nest, shape V.shape[:-1] + (n_nests,). Numerically stable (log-sum-exp)."""
    V = np.asarray(V, dtype=float)
    idx = _alt_index(spec)
    out = []
    for k in spec.nests:
        lam = spec.lam(k)
        z = V[..., idx[k]] / lam
        zmax = np.max(z, axis=-1, keepdims=True)
        out.append((zmax + np.log(np.sum(np.exp(z - zmax), axis=-1, keepdims=True)))[..., 0])
    return np.stack(out, axis=-1)


def probabilities(V: np.ndarray, spec: NestSpec) -> np.ndarray:
    """Choice probabilities, same shape as V; sums to 1 over the last axis."""
    V = np.asarray(V, dtype=float)
    idx = _alt_index(spec)
    I = inclusive_values(V, spec)
    lams = np.array([spec.lam(k) for k in spec.nests])
    top = lams * I
    top_max = np.max(top, axis=-1, keepdims=True)
    p_nest = np.exp(top - top_max)
    p_nest /= p_nest.sum(axis=-1, keepdims=True)
    P = np.empty_like(V)
    for j, k in enumerate(spec.nests):
        lam = spec.lam(k)
        z = V[..., idx[k]] / lam
        z = z - np.max(z, axis=-1, keepdims=True)
        within = np.exp(z)
        within /= within.sum(axis=-1, keepdims=True)
        P[..., idx[k]] = within * p_nest[..., j : j + 1]
    return P


def logsum(V: np.ndarray, spec: NestSpec) -> np.ndarray:
    """Expected maximum utility ln Σ_k exp(λ_k I_k) (the welfare-relevant accessibility measure)."""
    I = inclusive_values(V, spec)
    lams = np.array([spec.lam(k) for k in spec.nests])
    top = lams * I
    m = np.max(top, axis=-1, keepdims=True)
    return (m + np.log(np.sum(np.exp(top - m), axis=-1, keepdims=True)))[..., 0]


def mnl_probabilities(V: np.ndarray) -> np.ndarray:
    V = np.asarray(V, dtype=float)
    z = V - V.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)
