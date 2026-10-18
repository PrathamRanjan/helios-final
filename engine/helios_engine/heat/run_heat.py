"""Per-corridor shade and thermal stress for the Jurong East world; validation; export.

    cd helios/engine && .venv/bin/python -m helios_engine.heat.run_heat [--apply]

Writes  web/data/assumptions/calibrated/heat_calibrated.json
        engine/data/processed/validation_heat.json
--apply also writes the per-edge heatExposure/shadeScore into the frozen world baseline
(backing up the original) and re-solves the nested constants so the district baseline split
is preserved.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil

import numpy as np
import pandas as pd

from ..choice.utility import ASSUMPTIONS, FRONTEND
from ..data.registry import PROCESSED_DIR
from ..data.weather import island_hourly, wetbulb_hourly
from .shade import building_polygons, corridor_samples, rasterise, shaded, sun_positions
from .utci import hourly_climatology, stress_category, stull_wet_bulb, utci_sun_shade

WORLD = FRONTEND / "data" / "world_baseline_jurong_east.json"
HDB_STOREYS_WEST = 12.0  # median max_floor_lvl, towns JE/BB/CL (12) and JW (13) — HDB Property Information
UTCI_LO, UTCI_HI = 26.0, 46.0  # moderate → extreme heat stress band used to normalise exposure to 0..1


def compute(world: dict) -> dict:
    nodes = {n["id"]: (n["lng"], n["lat"]) for n in world["nodes"]}
    lons = [v[0] for v in nodes.values()]
    lats = [v[1] for v in nodes.values()]
    pad = 0.003
    bbox = (min(lons) - pad, min(lats) - pad, max(lons) + pad, max(lats) + pad)
    polys = building_polygons(bbox, HDB_STOREYS_WEST)
    grid = rasterise(polys, bbox)

    sun = sun_positions(hours=range(7, 20))
    samples = corridor_samples(world["edges"], nodes)
    # Shaded fraction per edge per hour-of-day (averaged over the 12 representative days).
    hours = [int(h) for h in sorted(sun["hour"].unique())]
    frac = {eid: np.zeros(len(hours)) for eid, _, _ in samples}
    allx = np.concatenate([x for _, x, _ in samples])
    ally = np.concatenate([y for _, _, y in samples])
    bounds = np.cumsum([0] + [len(x) for _, x, _ in samples])
    for hi, h in enumerate(hours):
        acc = np.zeros(len(allx))
        rows = sun[sun["hour"] == h]
        for _, r in rows.iterrows():
            acc += shaded(grid, allx, ally, r["elev"], r["az"])
        acc /= len(rows)
        for k, (eid, _, _) in enumerate(samples):
            frac[eid][hi] = acc[bounds[k] : bounds[k + 1]].mean()

    annual, hot = hourly_climatology(island_hourly())
    from ..energy.pv import PVParams, calibrate_clearness

    k = calibrate_clearness(island_hourly(), 1200.0, PVParams())["clearness_k"]
    u_ann = utci_sun_shade(annual.loc[hours], k)
    u_hot = utci_sun_shade(hot.loc[hours], k)

    def exposure(u):
        return float(np.clip((u - UTCI_LO) / (UTCI_HI - UTCI_LO), 0, 1))

    heat_exposure = float(np.mean([exposure(x) for x in u_ann["utci_sun"]]))
    edges_out = {}
    for eid, f in frac.items():
        u_eff = f * u_ann["utci_shade"].values + (1 - f) * u_ann["utci_sun"].values
        edges_out[eid] = {
            "shade": round(float(f.mean()), 4),
            "shade_by_hour": [round(float(x), 3) for x in f],
            "utci_eff_mean": round(float(u_eff.mean()), 2),
            "strong_stress_hours": int((u_eff > 32).sum()),
            "very_strong_stress_hours": int((u_eff > 38).sum()),
        }
    return {
        "bbox": bbox,
        "n_buildings": len(polys),
        "n_buildings_osm_height": sum(1 for p in polys if p[2] == "osm_tag"),
        "grid_shape": list(grid.h.shape),
        "hours": hours,
        "clearness_k": k,
        "utci_by_hour_annual": u_ann.round(2).reset_index().to_dict(orient="records"),
        "utci_by_hour_hot_months": u_hot.round(2).reset_index().to_dict(orient="records"),
        "heat_exposure_annual": round(heat_exposure, 4),
        "heat_exposure_hot_months": round(float(np.mean([exposure(x) for x in u_hot["utci_sun"]])), 4),
        "edges": edges_out,
    }


def validate() -> dict:
    """Weather-input check: Stull wet-bulb from NEA 2024 temp/RH vs NEA measured hourly wet-bulb."""
    w = island_hourly().dropna(subset=["temp_c", "rh_pct"])
    w["wb_model"] = stull_wet_bulb(w["temp_c"], w["rh_pct"])
    m = wetbulb_hourly()
    j = w.merge(m, on="hour", how="inner")
    err = j["wb_model"] - j["wet_bulb_temperature"]
    return {
        "check": "Stull wet-bulb from NEA 2024 island-mean temp/RH vs NEA measured hourly wet-bulb (Changi)",
        "n_hours": int(len(j)),
        "bias_c": round(float(err.mean()), 3),
        "mae_c": round(float(err.abs().mean()), 3),
        "corr": round(float(j["wb_model"].corr(j["wet_bulb_temperature"])), 3),
    }


def apply_to_world(result: dict) -> dict:
    backup = WORLD.with_name("world_baseline_jurong_east.pre_heat.json")
    if not backup.exists():
        shutil.copy(WORLD, backup)
    world = json.loads(backup.read_text())
    he = result["heat_exposure_annual"]
    changed = 0
    for e in world["edges"]:
        r = result["edges"].get(e["id"])
        e["attrs"]["heatExposure"] = he
        if r:
            e["attrs"]["shadeScore"] = r["shade"]
            changed += 1
    world.setdefault("meta", {})["heat_model"] = {
        "heatExposure": f"{he} = mean over daylight hours of (UTCI_sun − 26)/(46 − 26), NEA 2024 climatology (measured inputs, SolarCal + UTCI physics)",
        "shadeScore": "fraction of daylight hours in building shadow, sun-position ray-cast over HDB + OSM heights (12 representative days)",
        "generated": dt.datetime.now().isoformat(timespec="seconds"),
    }
    WORLD.write_text(json.dumps(world))
    # Keep the map's heat layer consistent with the engine.
    seg_path = FRONTEND / "data" / "shade_segments.json"
    seg_backup = seg_path.with_name("shade_segments.pre_heat.json")
    if not seg_backup.exists():
        shutil.copy(seg_path, seg_backup)
    seg = json.loads(seg_backup.read_text())
    for sg in seg["segments"]:
        r = result["edges"].get(sg["id"])
        if r:
            sg["shade"] = r["shade"]
            sg["effHeat"] = round(he * (1 - r["shade"]), 3)
            sg["utciEff"] = r["utci_eff_mean"]
            sg["strongStressHours"] = r["strong_stress_hours"]
    seg["method"] = "sun-position ray-cast over HDB + OSM building heights (12 days × 13 daylight hours); UTCI from NEA 2024 climatology"
    seg_path.write_text(json.dumps(seg))
    return {"edges_updated": changed, "heat_exposure": he, "backup": backup.name}


def main(apply: bool = False) -> dict:
    world = json.loads((WORLD.with_name("world_baseline_jurong_east.pre_heat.json") if WORLD.with_name("world_baseline_jurong_east.pre_heat.json").exists() else WORLD).read_text())
    res = compute(world)
    val = validate()
    res["validation"] = val
    res["generated"] = dt.datetime.now().isoformat(timespec="seconds")
    (ASSUMPTIONS / "calibrated" / "heat_calibrated.json").write_text(json.dumps(res, allow_nan=False))
    (PROCESSED_DIR / "validation_heat.json").write_text(json.dumps(val, indent=2))
    summary = {
        "buildings": res["n_buildings"],
        "osm_heights": res["n_buildings_osm_height"],
        "heat_exposure_annual": res["heat_exposure_annual"],
        "heat_exposure_hot": res["heat_exposure_hot_months"],
        "shade_mean": round(float(np.mean([v["shade"] for v in res["edges"].values()])), 4),
        "shade_p10_p90": [round(float(np.percentile([v["shade"] for v in res["edges"].values()], q)), 3) for q in (10, 90)],
        "utci_noon": [r for r in res["utci_by_hour_annual"] if r["hour"] == 13],
        "validation": val,
    }
    if apply:
        summary["applied"] = apply_to_world(res)
    return summary


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    print(json.dumps(main(ap.parse_args().apply), indent=2, default=str))
