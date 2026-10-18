"""Temperature-corrected hourly PV generation for Singapore.

Irradiance: when the Google Solar API key is available, use its per-roof annual/monthly flux.
Until then, plane-of-array irradiance comes from a pvlib clear-sky model (Ineichen, Singapore
Linke turbidity) scaled by a clearness factor that is CALIBRATED so a standard flat-ish roof
yields Singapore's measured specific yield (HDB SolarNova ≈ 1,100–1,300 kWh/kWp·yr).

Cell temperature (Faiman / NOCT form) and the power temperature coefficient are what make
this "physics-grade" in the tropics: at 60 °C cell temperature a panel loses ~12 %.

    T_cell = T_amb + (NOCT − 20)/800 · G_poa
    P      = P_stc · G_poa/1000 · [1 + γ (T_cell − 25)] · η_sys
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import pvlib

SG_LAT, SG_LON, SG_ALT = 1.3521, 103.8198, 15
TZ = "Asia/Singapore"


@dataclass
class PVParams:
    tilt_deg: float = 10.0          # typical HDB rooftop racking
    azimuth_deg: float = 180.0
    gamma_per_c: float = -0.0035    # mono-Si power temperature coefficient
    noct_c: float = 45.0
    system_losses: float = 0.14     # PVWatts default (wiring, soiling, mismatch, availability)
    inverter_eff: float = 0.96


def clear_sky_poa(times: pd.DatetimeIndex, p: PVParams) -> pd.Series:
    loc = pvlib.location.Location(SG_LAT, SG_LON, tz=TZ, altitude=SG_ALT)
    sp = loc.get_solarposition(times)
    cs = loc.get_clearsky(times, model="ineichen")
    poa = pvlib.irradiance.get_total_irradiance(
        p.tilt_deg, p.azimuth_deg, sp["apparent_zenith"], sp["azimuth"], cs["dni"], cs["ghi"], cs["dhi"]
    )["poa_global"]
    return poa.clip(lower=0)


def generation_per_kwp(times: pd.DatetimeIndex, temp_c: np.ndarray, poa: np.ndarray, p: PVParams) -> np.ndarray:
    """AC energy per kWp for each hour (kWh), given ambient temperature and POA irradiance (W/m²)."""
    t_cell = temp_c + (p.noct_c - 20.0) / 800.0 * poa
    dc = (poa / 1000.0) * (1 + p.gamma_per_c * (t_cell - 25.0))
    return np.clip(dc, 0, None) * (1 - p.system_losses) * p.inverter_eff


def calibrate_clearness(weather_hourly: pd.DataFrame, target_kwh_per_kwp: float = 1200.0, p: PVParams | None = None) -> dict:
    """Find the clearness factor k (cloud attenuation of clear-sky POA) that reproduces the measured yield."""
    p = p or PVParams()
    times = pd.DatetimeIndex(weather_hourly["hour"]).tz_localize(TZ, nonexistent="shift_forward", ambiguous="NaT")
    poa_cs = clear_sky_poa(times, p).values
    temp = weather_hourly["temp_c"].interpolate().bfill().ffill().values

    def annual(k):
        return float(generation_per_kwp(times, temp, k * poa_cs, p).sum())

    lo, hi = 0.2, 1.2
    for _ in range(60):
        mid = (lo + hi) / 2
        if annual(mid) < target_kwh_per_kwp:
            lo = mid
        else:
            hi = mid
    k = (lo + hi) / 2
    gen = generation_per_kwp(times, temp, k * poa_cs, p)
    gen_no_temp = generation_per_kwp(times, np.full_like(temp, 25.0) - (p.noct_c - 20) / 800 * k * poa_cs, k * poa_cs, p)
    return {
        "clearness_k": k,
        "annual_kwh_per_kwp": float(gen.sum()),
        "temperature_loss_pct": float((1 - gen.sum() / gen_no_temp.sum()) * 100),
        "peak_cell_temp_c": float((temp + (p.noct_c - 20) / 800 * k * poa_cs).max()),
        "hourly_profile_kwh_per_kwp": gen,
        "times": times,
    }


def typical_day_profile(hourly_gen: np.ndarray, times: pd.DatetimeIndex) -> np.ndarray:
    """Mean generation per hour-of-day (24 values, kWh/kWp)."""
    s = pd.Series(hourly_gen, index=times)
    return s.groupby(s.index.hour).mean().reindex(range(24), fill_value=0).values
