"""Census / GHS mode-to-work tables → Helios 5-mode shares and planning-area covariates.

Census categories → Helios modes (commute main mode):
  car   = Car Only + Taxi/Private Hire Car Only + Motorcycle/Scooter Only + Lorry/Pickup Only
  bus   = Public Bus Only + Private Chartered Bus/Van Only
  mrt   = Rail Only + Rail & Bus + Rail/Bus with other modes      (rail is the line-haul mode)
  active= Others (walking, cycling, PMDs …) → split walk / cycle by the Helios baseline ratio
  excluded: No Transport Required (work from home / at home)

Labels: the mapping is a modelling choice (calibrated proxy); the counts are measured (GHS/Census).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..data.registry import PROCESSED_DIR

MAP = {
    "Car Only": "car",
    "Taxi/Private Hire Car Only": "car",
    "Motorcycle/Scooter Only": "car",
    "Lorry/Pickup Only": "car",
    "Public Bus Only": "bus",
    "Private Chartered Bus/Van Only": "bus",
    "Rail (MRT/LRT) Only": "mrt",
    "Rail (MRT/LRT) & Public Bus Only": "mrt",
    "Combination of Rail (MRT/LRT) and/or Public Bus, with Other Modes": "mrt",
    "Others": "active",
}
WALK_SHARE_OF_ACTIVE = 0.08 / (0.08 + 0.06)  # Helios accepted baseline split walk 0.08 : cycle 0.06
MODES = ["car", "bus", "mrt", "walk", "cycle"]
SHARE_FLOOR = 0.005


def _load(key: str) -> pd.DataFrame:
    return pd.read_csv(PROCESSED_DIR / f"{key}.csv")


def mode_counts(key: str) -> pd.DataFrame:
    """Rows = planning areas (level-2), columns = Helios modes, values = employed residents."""
    df = _load(key)
    df = df[(df["level"] == 2) & (df["row"] != "Others")]
    wide = df.pivot_table(index="row", columns="col", values="value", aggfunc="first").fillna(0)
    out = pd.DataFrame(index=wide.index)
    for m in ("car", "bus", "mrt", "active"):
        cols = [c for c, mm in MAP.items() if mm == m and c in wide.columns]
        out[m] = wide[cols].sum(axis=1)
    out["walk"] = out["active"] * WALK_SHARE_OF_ACTIVE
    out["cycle"] = out["active"] * (1 - WALK_SHARE_OF_ACTIVE)
    out = out[MODES]
    return out[out.sum(axis=1) > 0]


def mode_shares(key: str, min_workers: float = 2000) -> tuple[pd.DataFrame, pd.Series]:
    c = mode_counts(key)
    n = c.sum(axis=1)
    c = c[n >= min_workers]  # tiny PAs (sampling noise) excluded from calibration
    s = c.div(c.sum(axis=1), axis=0)
    # GHS rounds counts to the nearest 100 and prints "-" for negligible cells, so a share of 0 means
    # "below resolution", not "impossible". Floor at SHARE_FLOOR (≈ rounding resolution) and renormalise.
    s = s.clip(lower=SHARE_FLOOR)
    s = s.div(s.sum(axis=1), axis=0)
    return s, n[n >= min_workers]


def national_shares(key: str) -> np.ndarray:
    df = _load(key)
    tot = df[df["level"] == 1].set_index("col")["value"]
    s = {m: 0.0 for m in ("car", "bus", "mrt", "active")}
    for c, m in MAP.items():
        s[m] += float(tot.get(c, 0.0))
    v = np.array([s["car"], s["bus"], s["mrt"], s["active"] * WALK_SHARE_OF_ACTIVE, s["active"] * (1 - WALK_SHARE_OF_ACTIVE)])
    return v / v.sum()


# ---------- covariates per planning area ----------

_TT_MID = {"Up to 15 mins": 10, "16 - 30 mins": 23, "31 - 45 mins": 38, "46 - 60 mins": 53, "More than 60 mins": 75}


def mean_commute_minutes(key: str = "travel_time_by_pa_2025") -> pd.Series:
    df = _load(key)
    w = df[df["level"] == 2].pivot_table(index="row", columns="col", values="value", aggfunc="first").fillna(0)
    cols = [c for c in _TT_MID if c in w.columns]
    return (w[cols] * pd.Series(_TT_MID)[cols]).sum(axis=1) / w[cols].sum(axis=1)


def _band_mid(label: str) -> float | None:
    s = label.replace("$", "").replace(",", "").replace(" ", "")
    if "NoEmployed" in s:
        return 0.0
    if s.startswith("Below"):
        return 500.0
    if "&Over" in s:
        return 40000.0
    if "-" in s:
        a, b = s.split("-")
        return (float(a) + float(b)) / 2
    return None


def mean_household_income(key: str = "hh_income_by_pa_2025") -> pd.Series:
    df = _load(key)
    w = df[df["level"] == 2].pivot_table(index="row", columns="col", values="value", aggfunc="first").fillna(0)
    mids = {c: _band_mid(c) for c in w.columns if c != "Total"}
    mids = {c: v for c, v in mids.items() if v is not None}
    num = sum(w[c] * v for c, v in mids.items())
    den = w[list(mids)].sum(axis=1)
    return num / den


def dwelling_mix(key: str = "pop_subzone_dwelling_2025") -> pd.DataFrame:
    """Per planning area: share of residents in HDB, in condos, in landed homes."""
    df = _load(key)
    pa = df[df["row"].str.endswith(" - Total")].copy()
    pa["pa"] = pa["row"].str.replace(" - Total", "", regex=False)
    w = pa.pivot_table(index="pa", columns="col", values="value", aggfunc="first").fillna(0)
    tot = w["Total"].replace(0, np.nan)
    return pd.DataFrame(
        {
            "hdb_share": w.get("HDB Dwellings|Total", 0) / tot,
            "condo_share": w.get("Condominium & Other Apartments", 0) / tot,
            "landed_share": w.get("Landed Properties", 0) / tot,
        }
    )


def senior_share(key: str = "pop_subzone_age_sex_2025") -> pd.Series:
    df = _load(key)
    pa = df[df["row"].str.endswith(" - Total")].copy()
    pa["pa"] = pa["row"].str.replace(" - Total", "", regex=False)
    pa = pa[pa["col"].str.startswith("Total|")]
    w = pa.pivot_table(index="pa", columns="col", values="value", aggfunc="first").fillna(0)
    old = [c for c in w.columns if any(c.endswith(x) for x in ("65 - 69", "70 - 74", "75 - 79", "80 - 84", "85 - 89", "90 & Over"))]
    return w[old].sum(axis=1) / w["Total|Total"]


def covariates() -> pd.DataFrame:
    X = pd.concat(
        [
            np.log(mean_household_income()).rename("ln_income"),
            dwelling_mix(),
            senior_share().rename("senior_share"),
            mean_commute_minutes().rename("commute_min"),
            _rail_access(),
        ],
        axis=1,
    )
    return X.dropna()


def _rail_access() -> pd.Series:
    from ..data.geo import rail_access_by_pa

    return rail_access_by_pa()


def low_income_share(key: str = "hh_income_by_pa_2025", threshold: float = 4000.0) -> pd.Series:
    """Share of resident households with monthly employment income below `threshold` (incl. no employed person)."""
    df = _load(key)
    w = df[df["level"] == 2].pivot_table(index="row", columns="col", values="value", aggfunc="first").fillna(0)
    cols = [c for c in w.columns if c != "Total" and (_band_mid(c) is not None) and _band_mid(c) < threshold]
    return w[cols].sum(axis=1) / w[[c for c in w.columns if c != "Total"]].sum(axis=1)
