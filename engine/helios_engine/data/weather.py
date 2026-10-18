"""NEA weather → compact hourly tables (per station and island-wide).

The raw 2024 files are minute-level per station (~1 GB each). We reduce once to:
  processed/weather_hourly_station_2024.csv   (station, lon, lat, hour, temp, rh, wind)
  processed/weather_hourly_island_2024.csv    (hour, temp, rh, wind — island-wide mean)
"""
from __future__ import annotations

import pandas as pd

from .registry import PROCESSED_DIR, RAW_DIR

USE = ["timestamp", "station_id", "location_longitude", "location_latitude", "reading_value"]


def _hourly(key: str, name: str) -> pd.DataFrame:
    parts = []
    for chunk in pd.read_csv(RAW_DIR / "datagov" / f"{key}.csv", usecols=USE, chunksize=2_000_000):
        chunk["hour"] = pd.to_datetime(chunk["timestamp"].str.slice(0, 13), format="%Y-%m-%dT%H")
        g = chunk.groupby(["station_id", "hour"]).agg(
            lon=("location_longitude", "first"), lat=("location_latitude", "first"), v=("reading_value", "sum"), n=("reading_value", "count")
        )
        parts.append(g)
    g = pd.concat(parts).groupby(level=[0, 1]).agg(lon=("lon", "first"), lat=("lat", "first"), v=("v", "sum"), n=("n", "sum"))
    g[name] = g["v"] / g["n"]
    return g[["lon", "lat", name]]


def build() -> tuple[pd.DataFrame, pd.DataFrame]:
    t = _hourly("air_temp_2024", "temp_c")
    rh = _hourly("rh_2024", "rh_pct")
    w = _hourly("wind_speed_2024", "wind_kn")
    st = t.join(rh[["rh_pct"]], how="outer").join(w[["wind_kn"]], how="outer").reset_index()
    st["wind_ms"] = st["wind_kn"] * 0.514444
    st.to_csv(PROCESSED_DIR / "weather_hourly_station_2024.csv", index=False)
    isl = st.groupby("hour")[["temp_c", "rh_pct", "wind_ms"]].mean().reset_index()
    isl.to_csv(PROCESSED_DIR / "weather_hourly_island_2024.csv", index=False)
    return st, isl


def island_hourly() -> pd.DataFrame:
    p = PROCESSED_DIR / "weather_hourly_island_2024.csv"
    if not p.exists():
        build()
    return pd.read_csv(p, parse_dates=["hour"])


def station_hourly() -> pd.DataFrame:
    p = PROCESSED_DIR / "weather_hourly_station_2024.csv"
    if not p.exists():
        build()
    return pd.read_csv(p, parse_dates=["hour"])


def wetbulb_hourly() -> pd.DataFrame:
    df = pd.read_csv(RAW_DIR / "datagov" / "wetbulb_hourly.csv")
    df["hour"] = pd.to_datetime(df["wbt_date"]) + pd.to_timedelta(df["wbt_time"].astype(int) - 1, unit="h")
    return df[["hour", "wet_bulb_temperature"]]
