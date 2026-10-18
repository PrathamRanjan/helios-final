"""Geospatial helpers: planning-area lookup, HDB block centroids, rail access.

Coordinates: WGS84 lon/lat in the GeoJSON. Distances use a local equirectangular projection
around Singapore (error < 0.1% over 50 km), avoiding a heavy GIS dependency.
"""
from __future__ import annotations

import json
from functools import lru_cache

import numpy as np
import pandas as pd
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

from .registry import PROCESSED_DIR, RAW_DIR

LAT0 = 1.3521
M_PER_DEG_LAT = 110_574.0
M_PER_DEG_LON = 111_320.0 * np.cos(np.radians(LAT0))


def to_xy(lon, lat):
    return np.asarray(lon) * M_PER_DEG_LON, np.asarray(lat) * M_PER_DEG_LAT


def _gj(key: str) -> dict:
    return json.loads((RAW_DIR / "datagov" / f"{key}.geojson").read_text())


@lru_cache(maxsize=1)
def planning_areas():
    feats = _gj("pa_boundary_mp2019")["features"]
    names = [f["properties"]["PLN_AREA_N"].title() for f in feats]
    geoms = [shape(f["geometry"]) for f in feats]
    return names, geoms, STRtree(geoms)


def pa_of(lon: float, lat: float) -> str | None:
    names, geoms, tree = planning_areas()
    p = Point(lon, lat)
    for i in tree.query(p):
        if geoms[i].contains(p):
            return names[i]
    return None


def hdb_blocks() -> pd.DataFrame:
    """One row per HDB building footprint: centroid lon/lat, footprint area, planning area, postal code."""
    cache = PROCESSED_DIR / "hdb_blocks.csv"
    if cache.exists():
        return pd.read_csv(cache, dtype={"postal": str, "blk": str})
    rows = []
    for f in _gj("hdb_existing_building")["features"]:
        g = shape(f["geometry"])
        c = g.centroid
        pr = f["properties"]
        rows.append(
            {
                "blk": str(pr.get("BLK_NO", "")),
                "postal": str(pr.get("POSTAL_COD", "")),
                "lon": c.x,
                "lat": c.y,
                "footprint_m2": float(pr.get("SHAPE.AREA") or 0),
            }
        )
    df = pd.DataFrame(rows)
    df["pa"] = [pa_of(x, y) for x, y in zip(df["lon"], df["lat"])]
    df.to_csv(cache, index=False)
    return df


def mrt_exits() -> pd.DataFrame:
    feats = _gj("mrt_station_exits")["features"]
    return pd.DataFrame(
        {
            "station": [f["properties"]["STATION_NA"].title() for f in feats],
            "lon": [f["geometry"]["coordinates"][0] for f in feats],
            "lat": [f["geometry"]["coordinates"][1] for f in feats],
        }
    )


def nearest_distance_m(lon, lat, tgt_lon, tgt_lat) -> np.ndarray:
    x, y = to_xy(lon, lat)
    tx, ty = to_xy(tgt_lon, tgt_lat)
    from scipy.spatial import cKDTree

    d, _ = cKDTree(np.c_[tx, ty]).query(np.c_[x, y])
    return d


def rail_access_by_pa(radius_m: float = 600.0) -> pd.Series:
    """Share of HDB blocks (weighted by footprint as a size proxy) within `radius_m` of an MRT/LRT exit."""
    b = hdb_blocks().dropna(subset=["pa"])
    ex = mrt_exits()
    b["d_mrt"] = nearest_distance_m(b["lon"], b["lat"], ex["lon"], ex["lat"])
    b["near"] = (b["d_mrt"] <= radius_m).astype(float)
    b["w"] = b["footprint_m2"].clip(lower=1)
    b["wn"] = b["near"] * b["w"]
    g = b.groupby("pa")[["wn", "w"]].sum()
    return (g["wn"] / g["w"]).rename("rail_access")
