"""Fit energy/diffusion models on real Singapore data and export runtime parameters.

    cd helios/engine && .venv/bin/python -m helios_engine.energy.run_energy

Outputs web/data/assumptions/calibrated/energy_calibrated.json:
  - Bass diffusion of installed solar (SingStat M891611, EMA), with 3-year holdout and the
    implied 2030 capacity vs the 2 GWp SolarNova/Green Plan target.
  - Temperature-corrected PV: clearness factor calibrated to measured SolarNova yield using
    real 2024 NEA hourly temperature; typical-day generation profile (kWh/kWp by hour).
  - Example dispatch: cost-only vs carbon-aware EV + PV + battery at a Singapore site.
"""
from __future__ import annotations

import datetime as dt
import json

import numpy as np
import pandas as pd

from ..choice.utility import ASSUMPTIONS
from ..data.registry import PROCESSED_DIR
from ..data.weather import island_hourly
from ..diffusion.bass import fit_with_holdout
from .dispatch import Site, cost_vs_carbon
from .pv import PVParams, calibrate_clearness, typical_day_profile
from .queue import size_chargers

SG_POPULATION_M = 6.04          # total population mid-2024 (SingStat), for W/cap → MW
SOLAR_TARGET_2030_MWP = 2000.0  # Green Plan / SolarNova: ≥ 2 GWp by 2030
MEASURED_YIELD = 1200.0         # kWh/kWp·yr, HDB SolarNova measured range 1,100–1,300


def solar_bass() -> dict:
    df = pd.read_csv(PROCESSED_DIR / "solar_capacity_annual.csv", dtype={"col": str})
    s = df[df["col"].str.match(r"^\d{4}$")].copy()
    s["year"] = s["col"].astype(int)
    s = s.sort_values("year")
    t = s["year"].values.astype(float)
    y = s["value"].values  # W per capita
    fit = fit_with_holdout(t, y, holdout=3, t0=float(t.min() - 1))
    years = np.arange(int(t.min()), 2041)
    pred = fit.predict(years)
    mw = pred * SG_POPULATION_M
    y2030 = float(fit.predict([2030])[0] * SG_POPULATION_M)
    return {
        "series": "Installed solar PV capacity, W per capita (SingStat M891611 / EMA)",
        "observed": {int(a): float(b) for a, b in zip(t, y)},
        "fit": fit.as_dict(),
        "projection_mwp": {int(a): round(float(b), 1) for a, b in zip(years, mw)},
        "projected_2030_mwp": round(y2030, 1),
        "target_2030_mwp": SOLAR_TARGET_2030_MWP,
        "on_track_for_2030_target": y2030 >= SOLAR_TARGET_2030_MWP,
        "label": "estimated (Bass diffusion fitted to EMA data; 3-yr holdout)",
    }


def ev_diffusion() -> dict:
    """Bass curve on the EV share of Singapore's motor-vehicle fleet (LTA, 2015 → latest month), and the
    car emission factor that real adoption implies — compared with the Green Plan pathway assumption."""
    from ..data.lta import vehicles_by_fuel

    d = vehicles_by_fuel()
    ann, mon = d["annual"], d["monthly"]
    share = (ann["Electric"] / ann["Total"]).astype(float)
    t = list(share.index.astype(float))
    y = list(share.values)
    last = mon.index.max()
    if last.year > max(share.index):
        t.append(last.year + (last.month - 0.5) / 12)
        y.append(float(mon.loc[last, "Electric"] / mon.loc[last, "Total"]))
    # Early in adoption the Bass ceiling M is not identified by data alone (free fit saturates at ~13 %,
    # contradicting the 2030 cleaner-energy registration rule). So M is a policy-informed scenario band;
    # the data estimates the speed (p, q). Fleet turnover (~7 %/yr) caps 2036 share near 75–80 %.
    years = np.arange(2015, 2037)
    fits = {name: fit_with_holdout(np.array(t), np.array(y), holdout=3, t0=2014.0, M_fixed=M) for name, M in (("low", 0.3), ("central", 0.5), ("high", 0.7))}
    free = fit_with_holdout(np.array(t), np.array(y), holdout=3, t0=2014.0)
    fit = fits["central"]
    ev = fit.predict(years)

    # Hybrid share: continue the 2021–2025 linear trend, capped (calibrated proxy).
    hyb = ((ann["Petrol-Electric"] + ann.get("Petrol-Electric (Plug-In)", 0)) / ann["Total"]).astype(float)
    slope = float(np.polyfit(hyb.index[-5:], hyb.values[-5:], 1)[0])
    hyb_p = np.clip(hyb.iloc[-1] + slope * (years - hyb.index[-1]), 0, 0.35)

    # Car EF per passenger-km: ICE x, hybrid 0.65x, EV = 0.16 kWh/km × grid ÷ occupancy 1.3 (LTA EV guide;
    # pathway grid). x is solved so the 2025 observed mix reproduces Helios's LTA-anchored 144 g/pkm.
    pw = json.loads((ASSUMPTIONS.parent / "policy" / "singapore_green_plan_pathways.json").read_text())
    anchors = pw["anchor_years"]
    grid = np.interp(years, anchors, pw["pathways"]["target_achieved"]["grid_kgco2_per_kwh"])
    ev_g = 0.16 * grid * 1000 / 1.3
    i25 = list(years).index(2025)
    ice_share25 = 1 - ev[i25] - hyb_p[i25]
    x = (144 - ev[i25] * ev_g[i25]) / (ice_share25 + 0.65 * hyb_p[i25])
    def ef_for(ev_share):
        return (1 - ev_share - hyb_p) * x + 0.65 * hyb_p * x + ev_share * ev_g

    ef = ef_for(ev)
    ef_lo, ef_hi = ef_for(fits["high"].predict(years)), ef_for(fits["low"].predict(years))
    path_ef = np.interp(years, anchors, pw["pathways"]["target_achieved"]["car_ef_gpkm"])
    sel = [2026, 2030, 2036]
    return {
        "series": "EV share of motor-vehicle population (LTA MVP01-4 annual + M09 monthly)",
        "observed_share": {str(round(a, 2)): round(b, 5) for a, b in zip(t, y)},
        "latest": {"date": str(last.date()), "electric": int(mon.loc[last, "Electric"]), "total": int(mon.loc[last, "Total"])},
        "fit": fit.as_dict(),
        "fit_band": {k: {**f.as_dict(), "share_2030": round(float(f.predict([2030])[0]), 4), "share_2036": round(float(f.predict([2036])[0]), 4)} for k, f in fits.items()},
        "free_ceiling_fit": {**free.as_dict(), "note": "ceiling not identified early in adoption — not used"},
        "projected_share": {int(a): round(float(b), 4) for a, b in zip(years, ev)},
        "car_ef_data_implied_gpkm": {y_: round(float(ef[list(years).index(y_)]), 1) for y_ in sel},
        "car_ef_data_implied_band_gpkm": {y_: [round(float(ef_lo[list(years).index(y_)]), 1), round(float(ef_hi[list(years).index(y_)]), 1)] for y_ in sel},
        "car_ef_pathway_gpkm": {y_: round(float(path_ef[list(years).index(y_)]), 1) for y_ in sel},
        "label": "estimated (Bass on LTA fleet data); EF mix weights = calibrated proxy",
    }


def pv_profile() -> dict:
    w = island_hourly()
    cal = calibrate_clearness(w, target_kwh_per_kwp=MEASURED_YIELD, p=PVParams())
    prof = typical_day_profile(cal["hourly_profile_kwh_per_kwp"], cal["times"])
    s = pd.Series(cal["hourly_profile_kwh_per_kwp"], index=cal["times"])
    monthly = s.groupby(s.index.month).sum()
    return {
        "clearness_k": round(cal["clearness_k"], 4),
        "annual_kwh_per_kwp": round(cal["annual_kwh_per_kwp"], 1),
        "temperature_loss_pct": round(cal["temperature_loss_pct"], 2),
        "peak_cell_temp_c": round(cal["peak_cell_temp_c"], 1),
        "typical_day_kwh_per_kwp": [round(float(x), 4) for x in prof],
        "monthly_kwh_per_kwp": {int(k): round(float(v), 1) for k, v in monthly.items()},
        "weather_source": "NEA 2024 hourly air temperature, island mean of 17 stations (data.gov.sg)",
        "label": "calibrated (clear-sky × clearness factor fitted to SolarNova measured yield); Solar API replaces irradiance per roof when keyed",
    }


def example_dispatch(prof_kwh_per_kwp, ef=None) -> dict:
    """A 100 kWp carpark site with 400 kWh/day of flexible EV charging (beyond its PV surplus). ef: hourly grid EF (kg/kWh);
    default = Singapore's near-flat gas grid (EMA 2024 0.402)."""
    h = np.arange(24)
    site = Site(
        load_kwh=np.full(24, 15.0),
        pv_kwh=np.array(prof_kwh_per_kwp) * 100,
        price=np.where((h >= 7) & (h < 23), 0.30, 0.22),  # illustrative time-of-use (S$/kWh)
        ef_kg_per_kwh=np.full(24, 0.402) if ef is None else np.asarray(ef),  # SG: EMA 2024, ≈ flat (gas)
        ev_energy_kwh=400.0,  # exceeds the site's PV surplus (~180 kWh) so the grid timing matters
        ev_plugged=((h >= 8) & (h < 19)).astype(float) * 0.6 + ((h >= 19) | (h < 8)).astype(float),
        ev_max_kw=80.0,
        bat_kwh=0.0,
        bat_kw=0.0,
    )
    return cost_vs_carbon(site, carbon_price_per_kg=0.08)


def main() -> dict:
    out = {
        "generated": dt.datetime.now().isoformat(timespec="seconds"),
        "solar_diffusion": solar_bass(),
        "ev_diffusion": ev_diffusion(),
        "pv": pv_profile(),
    }
    out["example_dispatch_sg"] = example_dispatch(out["pv"]["typical_day_kwh_per_kwp"])
    # Same site on a coal-margin grid (Hanoi hourly EF curve from the HELIO Hanoi module).
    hanoi = json.loads((ASSUMPTIONS.parent / "hanoi" / "grid_emission_curves.json").read_text())
    ef_vn = np.array(hanoi["hourly_ef_gco2_per_kwh"]) / 1000.0
    out["example_dispatch_hanoi_grid"] = example_dispatch(out["pv"]["typical_day_kwh_per_kwp"], ef=ef_vn)
    sg, vn = out["example_dispatch_sg"], out["example_dispatch_hanoi_grid"]
    out["dispatch_insight"] = (
        f"Charging-time carbon at stake: {sg['co2_at_stake_pct']:.1f}% on Singapore's flat gas grid vs "
        f"{vn['co2_at_stake_pct']:.1f}% on a coal-margin grid (Hanoi curve). On the coal grid, a time-of-use "
        f"tariff pulls charging to the dirtiest night hours; the carbon price needed to fix that is "
        f"~US${(vn['breakeven_carbon_price_usd_per_t'] or 0):,.0f}/t — far above today's prices, so siting "
        f"chargers where vehicles dwell in daylight (passive alignment) beats pricing."
    )
    out["charger_sizing_example"] = {
        "assumption": "peak 8 EV arrivals/h, 1.5 h mean charge, ≤5% wait >10 min",
        **size_chargers(8.0, 1.5, 10, 0.05),
    }
    (ASSUMPTIONS / "calibrated" / "energy_calibrated.json").write_text(json.dumps(out, indent=1, allow_nan=False))
    return out


if __name__ == "__main__":
    o = main()
    sb = o["solar_diffusion"]
    print("Bass p=%.4f q=%.3f M=%.1f W/cap | holdout MAPE %.1f%% on %s" % (sb["fit"]["p"], sb["fit"]["q"], sb["fit"]["M"], sb["fit"]["holdout_mape"], sb["fit"]["holdout_years"]))
    print("observed last:", list(sb["observed"].items())[-3:])
    print("2030 projected MWp:", sb["projected_2030_mwp"], "target", sb["target_2030_mwp"], "on track:", sb["on_track_for_2030_target"])
    ev = o["ev_diffusion"]
    for k, f in ev["fit_band"].items():
        print("EV Bass %-7s M=%.2f q=%.3f holdout MAPE %.1f%% | share 2030 %.1f%% 2036 %.1f%%" % (k, f["M"], f["q"], f["holdout_mape"], 100*f["share_2030"], 100*f["share_2036"]))
    print("car EF data-implied", ev["car_ef_data_implied_gpkm"], "band", ev["car_ef_data_implied_band_gpkm"], "vs pathway", ev["car_ef_pathway_gpkm"])
    pv = o["pv"]
    print("PV k=%.3f annual=%.0f kWh/kWp temp loss=%.1f%% peak cell %.1fC" % (pv["clearness_k"], pv["annual_kwh_per_kwp"], pv["temperature_loss_pct"], pv["peak_cell_temp_c"]))
    print("typical day:", pv["typical_day_kwh_per_kwp"])
    d = o["example_dispatch_sg"]
    print("SG dispatch: at stake %.1f%%, premium %.1f%%, breakeven %s" % (d["co2_at_stake_pct"], d["carbon_min_cost_premium_pct"], d["breakeven_carbon_price_usd_per_t"]))
    print("chargers:", o["charger_sizing_example"])
    dh = o["example_dispatch_hanoi_grid"]
    print("VN dispatch: at stake %.1f%%, premium %.1f%%, breakeven %s" % (dh["co2_at_stake_pct"], dh["carbon_min_cost_premium_pct"], dh["breakeven_carbon_price_usd_per_t"]))
    print(o["dispatch_insight"])
