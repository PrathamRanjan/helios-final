"""Thermal stress for pedestrians in sun vs shade: Mean Radiant Temperature → UTCI.

  T_mrt(sun)   = T_air + ΔMRT_solar (SolarCal, ASHRAE 55 App. C; direct beam from clear-sky × clearness k)
  T_mrt(shade) = T_air + ΔMRT_diffuse (same model, direct beam blocked → diffuse/reflected only)
  UTCI         = f(T_air, T_mrt, wind, RH)   (Bröde et al. 2012; pythermalcomfort implementation)

Wind at 10 m from NEA stations is reduced to 1.1 m (pedestrian height) with a log profile
(z0 = 1 m for an urban canopy) — standard for UTCI inputs.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pvlib
from pythermalcomfort.models import solar_gain, utci

from ..energy.pv import SG_ALT, SG_LAT, SG_LON, TZ


def wind_at_pedestrian(v10, z0=1.0, z=1.1):
    return np.maximum(0.5, np.asarray(v10) * np.log(z / z0 + 1) / np.log(10 / z0 + 1))


def hourly_climatology(weather: pd.DataFrame) -> pd.DataFrame:
    """Mean temp/RH/wind by hour-of-day over the year (plus a hot-month variant)."""
    w = weather.dropna(subset=["temp_c"]).copy()
    w["hod"] = pd.DatetimeIndex(w["hour"]).hour
    w["month"] = pd.DatetimeIndex(w["hour"]).month
    annual = w.groupby("hod")[["temp_c", "rh_pct", "wind_ms"]].mean()
    hot = w[w["month"].isin([4, 5, 6])].groupby("hod")[["temp_c", "rh_pct", "wind_ms"]].mean()
    return annual, hot


def utci_sun_shade(clim: pd.DataFrame, clearness_k: float, day=pd.Timestamp(2024, 4, 15)) -> pd.DataFrame:
    """UTCI in full sun and in shade for each hour-of-day under climatology `clim`."""
    times = pd.DatetimeIndex([day + pd.Timedelta(hours=int(h)) for h in clim.index]).tz_localize(TZ)
    loc = pvlib.location.Location(SG_LAT, SG_LON, tz=TZ, altitude=SG_ALT)
    sp = loc.get_solarposition(times)
    cs = loc.get_clearsky(times, model="ineichen")
    elev = sp["apparent_elevation"].clip(lower=0).values
    dni = (cs["dni"].values * clearness_k).clip(min=0)
    ta = clim["temp_c"].values
    rh = clim["rh_pct"].values
    v = wind_at_pedestrian(clim["wind_ms"].values)
    rows = []
    for i, h in enumerate(clim.index):
        if elev[i] > 0.5:
            sg_sun = solar_gain(sol_altitude=float(elev[i]), sharp=90, sol_radiation_dir=float(dni[i]), sol_transmittance=1.0, f_svv=0.7, f_bes=0.6, asw=0.7, posture="standing")
            # shade: direct beam blocked (transmittance≈0.05 through building edge/canopy) — diffuse & reflected remain
            sg_shd = solar_gain(sol_altitude=float(elev[i]), sharp=90, sol_radiation_dir=float(dni[i]), sol_transmittance=0.05, f_svv=0.4, f_bes=0.6, asw=0.7, posture="standing")
            dmrt_sun, dmrt_shd = float(sg_sun.delta_mrt), float(sg_shd.delta_mrt)
        else:
            dmrt_sun = dmrt_shd = 0.0
        tr_sun, tr_shd = ta[i] + dmrt_sun, ta[i] + dmrt_shd
        u_sun = float(utci(tdb=ta[i], tr=tr_sun, v=float(v[i]), rh=rh[i], limit_inputs=False).utci)
        u_shd = float(utci(tdb=ta[i], tr=tr_shd, v=float(v[i]), rh=rh[i], limit_inputs=False).utci)
        rows.append({"hour": int(h), "temp_c": ta[i], "rh": rh[i], "v_ped": float(v[i]), "sun_elev": float(elev[i]), "mrt_sun": tr_sun, "mrt_shade": tr_shd, "utci_sun": u_sun, "utci_shade": u_shd})
    return pd.DataFrame(rows).set_index("hour")


def stress_category(u: float) -> str:
    if u > 46:
        return "extreme"
    if u > 38:
        return "very strong"
    if u > 32:
        return "strong"
    if u > 26:
        return "moderate"
    if u > 9:
        return "no thermal stress"
    return "cold"


def stull_wet_bulb(t, rh):
    """Stull (2011) wet-bulb from air temperature and RH — used to validate weather inputs vs NEA wet-bulb."""
    t, rh = np.asarray(t, dtype=float), np.asarray(rh, dtype=float)
    return (
        t * np.arctan(0.151977 * np.sqrt(rh + 8.313659))
        + np.arctan(t + rh)
        - np.arctan(rh - 1.676331)
        + 0.00391838 * rh ** 1.5 * np.arctan(0.023101 * rh)
        - 4.686035
    )
