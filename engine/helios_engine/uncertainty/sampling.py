"""Uncertain parameters, Latin Hypercube sampling with a Gaussian copula, and the simulator bridge.

Parameters (multipliers on the engine's values; uniform priors over plausible ranges):
  behavioural    0.6–1.4   intervention mobility response (literature ±40 %)          calibrated proxy
  capexMult      0.75–1.5  unit-cost outturn (infrastructure overruns skew upward)     literature-derived
  evDisplace     0.2–0.8   share of EV kWh that displaces ICE car-km                   speculative
  betaHeatMult   0.5–1.5   heat-sensitivity coefficient (β_heat)                       calibrated proxy
  betaCostMult   0.7–1.3   cost coefficient (β_cost → value of time, $ welfare)        literature-derived
  lambdaPt       0.4–1.0   PT nest dissimilarity (Ortúzar & Willumsen range)           literature-derived

Correlation (Gaussian copula): behavioural ↔ betaHeatMult ρ = 0.4 — both encode how strongly
people respond to street conditions; drawing them independently would understate joint risk.
"""
from __future__ import annotations

import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np
from scipy.stats import norm, qmc

from ..choice.utility import FRONTEND

PARAMS = {
    "behavioural": (0.6, 1.4),
    "capexMult": (0.75, 1.5),
    "evDisplace": (0.2, 0.8),
    "betaHeatMult": (0.5, 1.5),
    "betaCostMult": (0.7, 1.3),
    "lambdaPt": (0.4, 1.0),
}
NAMES = list(PARAMS)
CORR = {("behavioural", "betaHeatMult"): 0.4}
NODE = os.path.expanduser("~/.local/node/bin")


def correlation_matrix() -> np.ndarray:
    k = len(NAMES)
    C = np.eye(k)
    for (a, b), r in CORR.items():
        i, j = NAMES.index(a), NAMES.index(b)
        C[i, j] = C[j, i] = r
    return C


def lhs(n: int, seed: int = 0, correlated: bool = True) -> np.ndarray:
    """n × k samples in parameter units. LHS margins, Gaussian-copula dependence (Iman–Conover style)."""
    u = qmc.LatinHypercube(d=len(NAMES), seed=seed).random(n)
    if correlated:
        z = norm.ppf(np.clip(u, 1e-9, 1 - 1e-9))
        L = np.linalg.cholesky(correlation_matrix())
        u = norm.cdf(z @ L.T)
    lo = np.array([PARAMS[p][0] for p in NAMES])
    hi = np.array([PARAMS[p][1] for p in NAMES])
    return lo + u * (hi - lo)


def to_samples(X: np.ndarray) -> list[dict]:
    return [dict(zip(NAMES, map(float, row))) for row in X]


@dataclass
class SimResult:
    candidates: list[dict]
    metrics: list[str]
    Y: np.ndarray  # (n_samples, n_units, n_metrics)

    def metric(self, name: str) -> np.ndarray:
        return self.Y[:, :, self.metrics.index(name)]


def _run_chunk(payload: dict) -> dict:
    env = {**os.environ, "PATH": f"{NODE}:{os.environ.get('PATH', '')}"}
    p = subprocess.run(
        ["npx", "tsx", "scripts/batch_sim.ts"],
        input=json.dumps(payload).encode(),
        cwd=FRONTEND,
        capture_output=True,
        env=env,
        timeout=3600,
    )
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode()[-2000:])
    return json.loads(p.stdout)


def list_candidates() -> list[dict]:
    return _run_chunk({"mode": "candidates"})["candidates"]


def simulate(samples: list[dict], candidate_ids: list[str] | None = None, packages: list[list[str]] | None = None, workers: int = 4, **kw) -> SimResult:
    """Run the TS simulator for every sample × unit, split across `workers` node processes."""
    chunks = [samples[i::workers] for i in range(workers)]
    order = [list(range(i, len(samples), workers)) for i in range(workers)]
    base = {k: v for k, v in kw.items()}
    if packages is not None:
        base["package"] = packages
    elif candidate_ids is not None:
        base["candidateIds"] = candidate_ids
    with ThreadPoolExecutor(max_workers=workers) as ex:
        outs = list(ex.map(lambda c: _run_chunk({**base, "samples": c}) if c else None, chunks))
    first = next(o for o in outs if o)
    n_units = len(first["results"][0])
    Y = np.zeros((len(samples), n_units, len(first["metrics"])))
    for o, idx in zip(outs, order):
        if o:
            for r, i in zip(o["results"], idx):
                Y[i] = np.array(r)
    return SimResult(first["candidates"], first["metrics"], Y)
