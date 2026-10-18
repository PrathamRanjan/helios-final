import numpy as np
import pytest

from helios_engine.decision.evpi import evpi, evppi, gate
from helios_engine.decision.portfolio import mean_cvar, minimax_regret
from helios_engine.uncertainty.sampling import NAMES, PARAMS, lhs
from helios_engine.uncertainty.sensitivity import Surrogate, cv_r2, sobol_on

RNG = np.random.default_rng(3)


# ---------------- sampling ----------------
def test_lhs_within_bounds_and_correlated():
    X = lhs(4000, seed=1)
    for j, p in enumerate(NAMES):
        lo, hi = PARAMS[p]
        assert X[:, j].min() >= lo - 1e-12 and X[:, j].max() <= hi + 1e-12
    i, k = NAMES.index("behavioural"), NAMES.index("betaHeatMult")
    r = np.corrcoef(X[:, i], X[:, k])[0, 1]
    assert 0.3 < r < 0.5
    assert abs(np.corrcoef(X[:, NAMES.index("capexMult")], X[:, i])[0, 1]) < 0.06


# ---------------- EVPI ----------------
def test_evpi_zero_without_uncertainty():
    NB = np.tile([[5.0, 3.0, 0.0]], (100, 1))
    assert evpi(NB) == pytest.approx(0.0)


def test_evpi_analytic_two_option_case():
    # Option A pays θ, θ ~ N(0,1) i.i.d. draws; option B pays 0. EVPI = E[max(θ,0)] − max(0,0) = 1/√(2π)
    th = RNG.standard_normal(400_000)
    NB = np.column_stack([th, np.zeros_like(th)])
    assert evpi(NB) == pytest.approx(1 / np.sqrt(2 * np.pi), abs=0.005)


def test_evppi_bounded_by_evpi_and_zero_for_irrelevant_parameter():
    n = 20000
    a, b = RNG.standard_normal(n), RNG.standard_normal(n)
    NB = np.column_stack([a + 0.1, np.zeros(n)])
    assert evppi(NB, a) <= evpi(NB) + 1e-9
    assert evppi(NB, b) < 0.02  # b does not enter NB
    assert evppi(NB, a) > 0.3


def test_gate_verdicts():
    sure = np.full(1000, 1e6)
    assert gate(sure, {"x": 0.0}, {"x": 1e4})["verdict"] == "FUND"
    risky = RNG.normal(-1e5, 1e6, 1000)
    assert gate(risky, {"behavioural": 5e5}, {"behavioural": 4e4})["verdict"] == "STUDY"
    assert gate(risky, {"behavioural": 1e3}, {"behavioural": 4e4})["verdict"] == "DEFER"


# ---------------- portfolio ----------------
def test_mean_cvar_respects_budget_and_risk_neutral_picks_best_mean():
    S = 500
    NB = np.column_stack([RNG.normal(10, 1, S), RNG.normal(12, 30, S), RNG.normal(4, 1, S)])
    capex = np.array([1.0, 1.0, 1.0])
    r0 = mean_cvar(NB, capex, budget=1.0, w=0.0)
    assert r0["selected"] == [0, 1, 0]  # highest mean
    r1 = mean_cvar(NB, capex, budget=1.0, w=0.95, alpha=0.1)
    assert r1["selected"] == [1, 0, 0]  # risk-averse: steady option beats volatile one
    assert r1["capex"] <= 1.0 + 1e-9


def test_minimax_regret():
    tbl = np.array([[10, 8, 0], [2, 7, 9], [6, 7, 3]], dtype=float)
    assert minimax_regret(tbl)["choice"] == 1


# ---------------- surrogate + Sobol ----------------
def test_sobol_recovers_linear_variance_shares():
    # Y = 3·x_behavioural + 1·x_capex (others irrelevant). Uniform widths differ, so compute exact shares.
    wb = PARAMS["behavioural"][1] - PARAMS["behavioural"][0]
    wc = PARAMS["capexMult"][1] - PARAMS["capexMult"][0]
    vb, vc = (3 * wb) ** 2 / 12, (1 * wc) ** 2 / 12
    ib, ic = NAMES.index("behavioural"), NAMES.index("capexMult")

    def f(X):
        return 3 * X[:, ib] + 1 * X[:, ic]

    S = sobol_on(f, n_base=4096)
    assert S["behavioural"]["S1"] == pytest.approx(vb / (vb + vc), abs=0.03)
    assert S["capexMult"]["S1"] == pytest.approx(vc / (vb + vc), abs=0.03)
    assert abs(S["lambdaPt"]["ST"]) < 0.02


def test_surrogate_learns_smooth_function():
    X = lhs(150, seed=4, correlated=False)
    y = np.sin(3 * X[:, 0]) + X[:, 3] ** 2
    assert cv_r2(X, y) > 0.95
    s = Surrogate(X, y)
    Xt = lhs(50, seed=5, correlated=False)
    assert np.corrcoef(s.predict(Xt), np.sin(3 * Xt[:, 0]) + Xt[:, 3] ** 2)[0, 1] > 0.98
