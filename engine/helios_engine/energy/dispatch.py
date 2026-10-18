"""Hourly energy dispatch LP: rooftop PV + battery + flexible EV charging at a site.

    min Σ_t  price_t · g_t  +  λ_CO2 · EF_t · g_t
    s.t. g_t + pv_t + d_t − c_t − curt_t = L_t + ev_t           (energy balance, kWh)
         soc_{t+1} = soc_t + η_c c_t − d_t / η_d                 (battery state of charge)
         0 ≤ soc_t ≤ E_bat,  0 ≤ c_t, d_t ≤ P_bat
         Σ_t ev_t = E_ev,  0 ≤ ev_t ≤ plugged_t · P_ev           (flexible EV energy need)
         g_t ≥ 0, curt_t ≥ 0,  soc_0 = soc_T (cyclic day)

Comparing the cost-only optimum (λ_CO2 = 0) to the carbon-aware optimum shows the
"cost–carbon paradox" from the Hanoi work: cheap overnight power can be the dirtiest.
In Singapore (≈95 % gas) the hourly EF is nearly flat, so the carbon gain comes mostly
from soaking up rooftop PV, while in coal-margin grids (Hanoi, Jakarta) timing matters a lot.

Solved with HiGHS via scipy.optimize.linprog.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import linprog


@dataclass
class Site:
    load_kwh: np.ndarray          # (T,) inflexible demand
    pv_kwh: np.ndarray            # (T,) PV generation available
    price: np.ndarray             # (T,) $/kWh
    ef_kg_per_kwh: np.ndarray     # (T,) grid emission factor
    ev_energy_kwh: float = 0.0
    ev_plugged: np.ndarray | None = None  # (T,) 0/1 availability
    ev_max_kw: float = 0.0
    bat_kwh: float = 0.0
    bat_kw: float = 0.0
    eta_c: float = 0.95
    eta_d: float = 0.95


def solve(site: Site, carbon_price_per_kg: float = 0.0) -> dict:
    T = len(site.load_kwh)
    plugged = site.ev_plugged if site.ev_plugged is not None else np.ones(T)
    # variable blocks: g, c, d, curt, ev (T each), soc (T+1)
    nG, nC, nD, nU, nE = 0, T, 2 * T, 3 * T, 4 * T
    nS = 5 * T
    N = 5 * T + T + 1
    cost = np.zeros(N)
    cost[nG : nG + T] = site.price + carbon_price_per_kg * site.ef_kg_per_kwh

    A_eq, b_eq = [], []
    for t in range(T):  # balance
        row = np.zeros(N)
        row[nG + t] = 1
        row[nD + t] = 1
        row[nC + t] = -1
        row[nU + t] = -1
        row[nE + t] = -1
        A_eq.append(row)
        b_eq.append(site.load_kwh[t] - site.pv_kwh[t])
    for t in range(T):  # SOC dynamics
        row = np.zeros(N)
        row[nS + t + 1] = 1
        row[nS + t] = -1
        row[nC + t] = -site.eta_c
        row[nD + t] = 1 / site.eta_d
        A_eq.append(row)
        b_eq.append(0.0)
    row = np.zeros(N)  # cyclic SOC
    row[nS] = 1
    row[nS + T] = -1
    A_eq.append(row)
    b_eq.append(0.0)
    row = np.zeros(N)  # EV energy requirement
    row[nE : nE + T] = 1
    A_eq.append(row)
    b_eq.append(site.ev_energy_kwh)

    bounds = (
        [(0, None)] * T
        + [(0, site.bat_kw)] * T
        + [(0, site.bat_kw)] * T
        + [(0, None)] * T
        + [(0, site.ev_max_kw * plugged[t]) for t in range(T)]
        + [(0, site.bat_kwh)] * (T + 1)
    )
    res = linprog(cost, A_eq=np.array(A_eq), b_eq=np.array(b_eq), bounds=bounds, method="highs")
    if not res.success:
        raise RuntimeError(f"dispatch infeasible: {res.message}")
    x = res.x
    g, c, d, u, ev = (x[k * T : (k + 1) * T] for k in range(5))
    soc = x[nS:]
    return {
        "grid_kwh": g,
        "charge_kwh": c,
        "discharge_kwh": d,
        "curtail_kwh": u,
        "ev_kwh": ev,
        "soc_kwh": soc,
        "cost_usd": float(site.price @ g),
        "co2_kg": float(site.ef_kg_per_kwh @ g),
        "pv_self_consumed_kwh": float(site.pv_kwh.sum() - u.sum()),
    }


def cost_vs_carbon(site: Site, carbon_price_per_kg: float = 0.08) -> dict:
    """Three schedules: cost-minimal, carbon-minimal, and cost + carbon price (default ≈ US$80/t).

    The gap between cost-minimal and carbon-minimal is the carbon at stake from WHEN energy is
    drawn; the break-even carbon price is the smallest price at which the cost-optimal schedule
    captures ≥ 90 % of that gap (the "cost–carbon paradox" made quantitative).
    """
    from dataclasses import replace

    a = solve(site, 0.0)
    carbon_site = replace(site, price=np.zeros_like(site.price) + 1e-6)  # tiny price breaks ties
    b = solve(carbon_site, 1.0)
    b_cost = float(site.price @ b["grid_kwh"])
    c = solve(site, carbon_price_per_kg)
    gap = a["co2_kg"] - b["co2_kg"]
    breakeven = None
    if gap > 1e-6:
        lo, hi = 0.0, 50.0  # $/kg
        if site.price.max() > 0:
            for _ in range(40):
                mid = (lo + hi) / 2
                r = solve(site, mid)
                if a["co2_kg"] - r["co2_kg"] >= 0.9 * gap:
                    hi = mid
                else:
                    lo = mid
            breakeven = hi * 1000  # $/t
    return {
        "cost_minimal": {"cost_usd": a["cost_usd"], "co2_kg": a["co2_kg"], "ev_profile": a["ev_kwh"].round(3).tolist()},
        "carbon_minimal": {"cost_usd": b_cost, "co2_kg": b["co2_kg"], "ev_profile": b["ev_kwh"].round(3).tolist()},
        "at_carbon_price": {"usd_per_t": carbon_price_per_kg * 1000, "cost_usd": c["cost_usd"], "co2_kg": c["co2_kg"]},
        "co2_at_stake_pct": float(gap / max(a["co2_kg"], 1e-9) * 100),
        "carbon_min_cost_premium_pct": float((b_cost - a["cost_usd"]) / max(a["cost_usd"], 1e-9) * 100),
        "co2_saved_at_price_pct": float((a["co2_kg"] - c["co2_kg"]) / max(a["co2_kg"], 1e-9) * 100),
        "breakeven_carbon_price_usd_per_t": breakeven,
    }
