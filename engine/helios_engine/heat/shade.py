"""Hour-by-hour building shadows on street corridors (sun geometry × building heights).

1. Heights: OSM buildings with height tags (web/data/geo/building_heights.json) + every HDB
   block footprint (data.gov.sg) at its town's median storey count × 3 m (HDB Property Information).
   OSM-tagged heights take precedence where both exist.
2. Rasterise to a 5 m height grid (local metric projection).
3. Sun position (pvlib / NREL SPA) for representative days (15th of each month) and daylight hours.
4. A street point is shaded at hour h if, marching toward the sun, some cell at distance s has
   height > s · tan(elevation)  (simple ray-cast; ignores trees — tree canopy is added separately).

Output per corridor: shaded fraction by hour-of-day and the daytime-weighted shade score.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

import numpy as np
import pandas as pd
import pvlib
from PIL import Image, ImageDraw

from ..choice.utility import FRONTEND
from ..data.geo import M_PER_DEG_LAT, M_PER_DEG_LON
from ..data.registry import RAW_DIR

CELL_M = 5.0
STOREY_M = 3.0


@dataclass
class HeightGrid:
    h: np.ndarray        # (ny, nx) metres
    x0: float            # metres (west edge)
    y0: float            # metres (south edge)
    cell: float = CELL_M

    def lookup(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        i = ((y - self.y0) / self.cell).astype(int)
        j = ((x - self.x0) / self.cell).astype(int)
        ok = (i >= 0) & (i < self.h.shape[0]) & (j >= 0) & (j < self.h.shape[1])
        out = np.zeros_like(x, dtype=float)
        out[ok] = self.h[i[ok], j[ok]]
        return out


def _xy(lon, lat):
    return np.asarray(lon) * M_PER_DEG_LON, np.asarray(lat) * M_PER_DEG_LAT


def building_polygons(bbox: tuple[float, float, float, float], hdb_storeys: float) -> list[tuple[np.ndarray, float, str]]:
    """[(ring lon/lat array, height m, source)] inside bbox (lon_min, lat_min, lon_max, lat_max)."""
    lo0, la0, lo1, la1 = bbox
    out = []

    def inside(r):
        return lo0 <= r[:, 0].mean() <= lo1 and la0 <= r[:, 1].mean() <= la1

    hdb = json.loads((RAW_DIR / "datagov" / "hdb_existing_building.geojson").read_text())
    for f in hdb["features"]:
        g = f["geometry"]
        rings = [g["coordinates"][0]] if g["type"] == "Polygon" else [p[0] for p in g["coordinates"]]
        for r in rings:
            r = np.asarray(r)[:, :2]
            if inside(r):
                out.append((r, hdb_storeys * STOREY_M, "hdb_town_median"))
    osm = json.loads((FRONTEND / "data" / "geo" / "building_heights.json").read_text())
    for b in osm["buildings"]:
        r = np.asarray(b["r"])[:, :2]
        if inside(r):
            out.append((r, float(b["h"]), "osm_tag"))  # drawn last → overrides HDB median where overlapping
    return out


def rasterise(polys, bbox, cell=CELL_M) -> HeightGrid:
    lo0, la0, lo1, la1 = bbox
    x0, y0 = _xy(lo0, la0)
    x1, y1 = _xy(lo1, la1)
    nx, ny = int((x1 - x0) / cell) + 1, int((y1 - y0) / cell) + 1
    img = Image.new("I", (nx, ny), 0)
    d = ImageDraw.Draw(img)
    for ring, h, _ in polys:
        x, y = _xy(ring[:, 0], ring[:, 1])
        pts = list(zip((x - x0) / cell, (y - y0) / cell))
        if len(pts) >= 3:
            d.polygon(pts, fill=int(round(h * 10)))  # decimetres
    arr = np.array(img, dtype=float) / 10.0
    return HeightGrid(arr, x0, y0, cell)


def sun_positions(hours=range(7, 20), days=None) -> pd.DataFrame:
    """Solar elevation/azimuth for the 15th of each month at each daylight hour (Singapore time)."""
    days = days or [pd.Timestamp(2024, m, 15) for m in range(1, 13)]
    times = pd.DatetimeIndex([d + pd.Timedelta(hours=h) for d in days for h in hours]).tz_localize("Asia/Singapore")
    sp = pvlib.solarposition.get_solarposition(times, 1.3521, 103.8198)
    return pd.DataFrame({"time": times, "hour": times.hour, "elev": sp["apparent_elevation"].values, "az": sp["azimuth"].values})


def shaded(grid: HeightGrid, x: np.ndarray, y: np.ndarray, elev_deg: float, az_deg: float, max_dist=200.0, step=CELL_M) -> np.ndarray:
    """Boolean array: is each point (metres) in a building shadow for this sun position?"""
    if elev_deg <= 0:
        return np.ones_like(x, dtype=bool)  # night: no direct sun
    tan_e = np.tan(np.radians(elev_deg))
    # azimuth: clockwise from north. Direction TOWARD the sun in x (east), y (north):
    dx, dy = np.sin(np.radians(az_deg)), np.cos(np.radians(az_deg))
    hit = np.zeros_like(x, dtype=bool)
    for s in np.arange(step, max_dist + step, step):
        h = grid.lookup(x + dx * s, y + dy * s)
        hit |= h > s * tan_e
        if s * tan_e > grid.h.max():
            break
    return hit


def corridor_samples(edges: list[dict], nodes: dict, spacing_m=25.0, max_pts=40):
    """Sample points along the straight from→to line of each corridor edge."""
    out = []
    for e in edges:
        a, b = nodes.get(e["from"]), nodes.get(e["to"])
        if not a or not b:
            continue
        xa, ya = _xy(a[0], a[1])
        xb, yb = _xy(b[0], b[1])
        L = float(np.hypot(xb - xa, yb - ya))
        n = int(min(max_pts, max(3, L // spacing_m)))
        t = np.linspace(0.05, 0.95, n)
        out.append((e["id"], xa + (xb - xa) * t, ya + (yb - ya) * t))
    return out
