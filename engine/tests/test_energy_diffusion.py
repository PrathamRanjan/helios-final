import math

import numpy as np
import pandas as pd
import pytest

from helios_engine.diffusion.bass import bass_cumulative, fit_bass, fit_with_holdout
from helios_engine.energy.dispatch import Site, cost_vs_carbon, solve
from helios_engine.energy.pv import PVParams, generation_per_kwp
from helios_engine.energy.queue import erlang_c, mean_wait_hours, size_chargers


# ---------------- Bass ----------------
def test_bass_monotone_and_bounded():
    t = np.linspace(0, 40, 200)
    N = bass_cumulative(t, 0.01, 0.4, 1000.0)
    assert np.all(np.diff(N) >= -1e-9)
    assert N[0] == pytest.approx(0) and N[-1] <= 1000.0 + 1e-9


def test_bass_recovers_known_parameters():
    t = np.arange(2008, 2026, dtype=float)
    y = bass_cumulative(t, 0.004, 0.45, 500.0, t0=2007)
    f = fit_bass(t, y, t0=2007)
    assert f.p == pytest.approx(0.004, rel=0.05)
    assert f.q == pytest.approx(0.45, rel=0.05)
    assert f.M == pytest.approx(500.0, rel=0.05)


def test_holdout_scores_unseen_years():
    t = np.arange(2008, 2026, dtype=float)
    y = bass_cumulative(t, 0.004, 0.45, 500.0, t0=2007)
    f = fit_with_holdout(t, y, holdout=3, t0=2007)
    assert f.holdout_years == [2023, 2024, 2025] and f.holdout_mape < 1.0


# ---------------- PV ----------------
def test_pv_hotter_cells_produce_less():
    times = pd.date_range("2024-03-01 12:00", periods=1, freq="h", tz="Asia/Singapore")
    cool = generation_per_kwp(times, np.array([25.0]), np.array([900.0]), PVParams())
    hot = generation_per_kwp(times, np.array([35.0]), np.array([900.0]), PVParams())
    assert hot[0] < cool[0]
    # 10 °C hotter ambient → γ·10 = 3.5 % of STC power lost; relative to an already-hot cell
    # (T_cell = T_amb + (NOCT−20)/800·G) the drop is 0.035 / (1 + γ(T_cell,cool − 25)).
    p = PVParams()
    t_cell_cool = 25.0 + (p.noct_c - 20) / 800 * 900
    expected = -p.gamma_per_c * 10 / (1 + p.gamma_per_c * (t_cell_cool - 25))
    assert (cool[0] - hot[0]) / cool[0] == pytest.approx(expected, rel=1e-9)


def test_pv_zero_at_night():
    times = pd.date_range("2024-03-01 00:00", periods=1, freq="h", tz="Asia/Singapore")
    assert generation_per_kwp(times, np.array([26.0]), np.array([0.0]), PVParams())[0] == 0


# ---------------- Dispatch LP ----------------
def _site(**kw):
    T = 24
    h = np.arange(T)
    pv = np.clip(np.sin((h - 6) / 12 * np.pi), 0, None) * 40
    base = dict(
        load_kwh=np.full(T, 20.0),
        pv_kwh=pv,
        price=np.where((h >= 23) | (h < 6), 0.15, 0.30),
        ef_kg_per_kwh=np.where((h >= 18) & (h <= 22), 0.75, 0.55),
        ev_energy_kwh=120.0,
        ev_plugged=np.ones(T),
        ev_max_kw=30.0,
        bat_kwh=50.0,
        bat_kw=25.0,
    )
    base.update(kw)
    return Site(**base)


def test_dispatch_energy_balance_every_hour():
    s = _site()
    r = solve(s)
    lhs = r["grid_kwh"] + s.pv_kwh + r["discharge_kwh"] - r["charge_kwh"] - r["curtail_kwh"]
    rhs = s.load_kwh + r["ev_kwh"]
    np.testing.assert_allclose(lhs, rhs, atol=1e-6)
    assert r["ev_kwh"].sum() == pytest.approx(120.0, abs=1e-6)
    assert np.all(r["soc_kwh"] >= -1e-9) and np.all(r["soc_kwh"] <= s.bat_kwh + 1e-9)
    assert r["soc_kwh"][0] == pytest.approx(r["soc_kwh"][-1], abs=1e-6)


def test_carbon_price_never_increases_emissions():
    out = cost_vs_carbon(_site(), carbon_price_per_kg=0.5)
    assert out["at_carbon_price"]["co2_kg"] <= out["cost_minimal"]["co2_kg"] + 1e-6
    assert out["carbon_minimal"]["co2_kg"] <= out["at_carbon_price"]["co2_kg"] + 1e-6
    assert out["carbon_minimal"]["cost_usd"] >= out["cost_minimal"]["cost_usd"] - 1e-6


def test_ev_charging_shifts_to_solar_hours_when_carbon_priced():
    # flat price, solar-shaped surplus: carbon-aware EV charging should sit in daylight
    s = _site(price=np.full(24, 0.25), bat_kwh=0.0, bat_kw=0.0)
    r = solve(s, carbon_price_per_kg=0.5)
    day = r["ev_kwh"][7:18].sum()
    assert day / r["ev_kwh"].sum() > 0.8


# ---------------- Erlang C ----------------
def test_erlang_c_reference_value():
    # Classic textbook case: c = 2 servers, a = 1 Erlang → P(wait) = 1/3
    assert erlang_c(2, 1.0) == pytest.approx(1 / 3, rel=1e-9)


def test_erlang_c_saturated():
    assert erlang_c(3, 3.0) == 1.0
    assert math.isinf(mean_wait_hours(3, 3.0, 1.0))


def test_sizing_meets_target_and_is_minimal():
    r = size_chargers(lam_peak=6.0, mean_charge_hours=1.0, max_wait_min=10, max_prob=0.05)
    assert r["p_wait_over_target"] <= 0.05
    c = r["chargers"]
    from helios_engine.energy.queue import p_wait_exceeds

    assert p_wait_exceeds(c - 1, 6.0, 1.0, 10 / 60) > 0.05


# ---------------- LTA PDF row parser ----------------
def test_lta_row_parser_prefers_longest_fuel_name():
    from helios_engine.data.lta import _rows

    txt = "Petrol 587,900 578,977\nPetrol-Electric (Plug-In) 108 125\nPetrol-Electric 6,371 10,075\nElectric 1 12\nDiesel-Electric (Plug-In) - -\n"
    r = _rows(txt)
    assert r["Petrol"] == [587900.0, 578977.0]
    assert r["Petrol-Electric (Plug-In)"] == [108.0, 125.0]
    assert r["Petrol-Electric"] == [6371.0, 10075.0]
    assert r["Electric"] == [1.0, 12.0]
    assert r["Diesel-Electric (Plug-In)"] == [0.0, 0.0]
