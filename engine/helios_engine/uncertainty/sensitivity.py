"""Gaussian-process surrogate of the simulator + Sobol global sensitivity (Saltelli/Jansen).

The full simulator costs ~0.3 s per intervention-run, so Sobol on it directly (thousands of runs ×
14 candidates) is slow. Standard practice: train a GP emulator on a space-filling design, check its
out-of-sample accuracy, then compute Sobol indices on the emulator (Oakley & O'Hagan 2004).

    S_i  = Var(E[Y | X_i]) / Var(Y)                (first order)
    S_Ti = E[Var(Y | X_~i)] / Var(Y)               (total, incl. interactions)
"""
from __future__ import annotations

import numpy as np
from SALib.analyze import sobol as sobol_analyze
from SALib.sample import sobol as sobol_sample
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import RBF, ConstantKernel, WhiteKernel
from sklearn.model_selection import KFold

from .sampling import NAMES, PARAMS


class Surrogate:
    def __init__(self, X: np.ndarray, y: np.ndarray):
        lo = np.array([PARAMS[p][0] for p in NAMES])
        hi = np.array([PARAMS[p][1] for p in NAMES])
        self.lo, self.hi = lo, hi
        self.mu, self.sd = float(y.mean()), float(y.std() + 1e-12)
        kern = ConstantKernel(1.0) * RBF(length_scale=np.ones(len(NAMES)), length_scale_bounds=(1e-2, 1e3)) + WhiteKernel(1e-3, (1e-8, 1e-1))
        self.gp = GaussianProcessRegressor(kern, normalize_y=False, n_restarts_optimizer=2, random_state=0)
        self.gp.fit(self._u(X), (y - self.mu) / self.sd)

    def _u(self, X):
        return (np.asarray(X) - self.lo) / (self.hi - self.lo)

    def predict(self, X, return_std=False):
        if return_std:
            m, s = self.gp.predict(self._u(X), return_std=True)
            return m * self.sd + self.mu, s * self.sd
        return self.gp.predict(self._u(X)) * self.sd + self.mu


def cv_r2(X: np.ndarray, y: np.ndarray, folds: int = 5) -> float:
    """Out-of-sample R² of the emulator (5-fold) — reported so the Sobol result can be trusted."""
    ss_res, ss_tot = 0.0, 0.0
    for tr, te in KFold(folds, shuffle=True, random_state=0).split(X):
        s = Surrogate(X[tr], y[tr])
        p = s.predict(X[te])
        ss_res += float(((y[te] - p) ** 2).sum())
        ss_tot += float(((y[te] - y.mean()) ** 2).sum())
    return 1 - ss_res / ss_tot


def sobol_on(model_fn, n_base: int = 2048, seed: int = 0) -> dict:
    problem = {"num_vars": len(NAMES), "names": NAMES, "bounds": [list(PARAMS[p]) for p in NAMES]}
    Xs = sobol_sample.sample(problem, n_base, calc_second_order=False, seed=seed)
    Y = model_fn(Xs)
    Si = sobol_analyze.analyze(problem, Y, calc_second_order=False, seed=seed)
    return {
        n: {"S1": float(Si["S1"][i]), "S1_conf": float(Si["S1_conf"][i]), "ST": float(Si["ST"][i]), "ST_conf": float(Si["ST_conf"][i])}
        for i, n in enumerate(NAMES)
    }
