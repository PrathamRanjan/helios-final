import numpy as np
import pytest

from helios_engine.choice.calibrate import calibrate_constants
from helios_engine.choice.nested_logit import HELIOS_NESTS, NestSpec, logsum, mnl_probabilities, probabilities
from helios_engine.choice.welfare import (
    delta_consumer_surplus,
    elasticity_matrix,
    mnl_cross_elasticity,
    mnl_direct_elasticity,
    value_of_time_per_hour,
)

RNG = np.random.default_rng(7)
MNL_SPEC = HELIOS_NESTS.with_lambdas(pt=1.0, active=1.0)


def test_lambda_one_equals_mnl():
    V = RNG.normal(size=(50, 5))
    np.testing.assert_allclose(probabilities(V, MNL_SPEC), mnl_probabilities(V), atol=1e-12)


def test_probabilities_valid():
    V = RNG.normal(scale=3, size=(200, 5))
    P = probabilities(V, HELIOS_NESTS)
    assert np.all(P > 0)
    np.testing.assert_allclose(P.sum(axis=-1), 1.0, atol=1e-12)


def test_stable_for_extreme_utilities():
    V = np.array([[800.0, -800.0, 0.0, 400.0, -1e3]])
    P = probabilities(V, HELIOS_NESTS)
    assert np.all(np.isfinite(P)) and abs(P.sum() - 1) < 1e-12


def test_nesting_breaks_iia_in_the_right_direction():
    """Improving bus should draw proportionally MORE from MRT (same nest) than from car."""
    V0 = np.array([0.0, -0.5, -0.3, -1.0, -2.0])
    V1 = V0.copy()
    V1[1] += 0.5  # better bus
    P0, P1 = probabilities(V0, HELIOS_NESTS), probabilities(V1, HELIOS_NESTS)
    drop_car = (P0[0] - P1[0]) / P0[0]
    drop_mrt = (P0[2] - P1[2]) / P0[2]
    assert drop_mrt > drop_car > 0
    # Under MNL the proportional drops are identical (IIA)
    Q0, Q1 = probabilities(V0, MNL_SPEC), probabilities(V1, MNL_SPEC)
    assert abs((Q0[0] - Q1[0]) / Q0[0] - (Q0[2] - Q1[2]) / Q0[2]) < 1e-12


def test_calibration_reproduces_observed_shares():
    V_base = RNG.normal(size=(30, 5))
    S = RNG.dirichlet(np.ones(5), size=30)
    res = calibrate_constants(V_base, S, HELIOS_NESTS)
    assert res.converged
    np.testing.assert_allclose(probabilities(V_base + res.delta, HELIOS_NESTS), S, atol=1e-9)
    assert np.allclose(res.delta[:, 0], 0)  # normalisation on reference alternative


def test_calibration_handles_zero_share():
    S = np.array([[0.5, 0.3, 0.2, 0.0, 0.0]])
    res = calibrate_constants(np.zeros((1, 5)), S, HELIOS_NESTS)
    assert res.converged
    assert probabilities(res.delta, HELIOS_NESTS)[0, 3] < 1e-5


def test_consumer_surplus_zero_when_nothing_changes_and_positive_when_improved():
    V = RNG.normal(size=(10, 5))
    assert np.allclose(delta_consumer_surplus(V, V, HELIOS_NESTS, -0.18), 0)
    V2 = V.copy()
    V2[:, 3] += 0.4
    assert np.all(delta_consumer_surplus(V, V2, HELIOS_NESTS, -0.18) > 0)


def test_logsum_bounds():
    V = RNG.normal(size=(20, 5))
    ls = logsum(V, HELIOS_NESTS)
    assert np.all(ls >= V.max(axis=-1) - 1e-12)  # expected max ≥ best systematic utility


def test_consumer_surplus_matches_cost_cut_for_single_option():
    """If every alternative's cost falls by $1, ΔCS must be exactly $1."""
    V = RNG.normal(size=(5, 5))
    beta_cost = -0.18
    V2 = V + (-beta_cost) * 1.0
    np.testing.assert_allclose(delta_consumer_surplus(V, V2, HELIOS_NESTS, beta_cost), 1.0, atol=1e-12)


def test_value_of_time():
    assert value_of_time_per_hour(-0.06, -0.18) == pytest.approx(20.0)


def test_numeric_elasticity_matches_mnl_formula():
    V = np.array([0.2, -0.4, 0.1, -1.0, -2.0])
    X = np.array([3.0, 1.2, 1.4, 0.0, 0.0])
    beta = -0.18
    E = elasticity_matrix(V, X, beta, MNL_SPEC, rel_step=1e-6)
    P = mnl_probabilities(V)
    assert E[0, 0] == pytest.approx(mnl_direct_elasticity(beta, X[0], P[0]), rel=1e-3)
    assert E[2, 0] == pytest.approx(mnl_cross_elasticity(beta, X[0], P[0]), rel=1e-3)


def test_invalid_lambda_rejected():
    with pytest.raises(ValueError):
        NestSpec(("a",), {"a": "x"}, {"x": 1.5})
