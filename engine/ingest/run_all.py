"""One command: fetch every Phase-1 source, register provenance, write tidy processed files.

    engine/.venv/bin/python -m ingest.run_all            (from helios/engine)
    engine/.venv/bin/python -m ingest.run_all --only singstat
"""
from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from helios_engine.data import datagov, registry, singstat  # noqa: E402

# key → (table id, description)
SINGSTAT = {
    "mode_by_pa_res_2025": ("C020139", "Mode to work × planning area of residence, GHS 2025"),
    "mode_by_pa_res_2020": ("17594", "Mode to work × planning area of residence, Census 2020"),
    "mode_by_pa_work_2025": ("C020153", "Mode to work × planning area of workplace, GHS 2025"),
    "mode_by_pa_work_2020": ("17597", "Mode to work × planning area of workplace, Census 2020"),
    "work_pa_x_res_region_2025": ("C020155", "Workplace PA × mode × residence region, GHS 2025"),
    "mode_by_age_2025": ("C020163", "Mode to work × age × sex, GHS 2025"),
    "mode_by_income_2025": ("C020168", "Mode to work × gross monthly employment income, GHS 2025"),
    "travel_time_by_pa_2025": ("C020140", "Travel time to work × PA of residence, GHS 2025"),
    "pop_subzone_age_sex_2025": ("C020123", "Resident population × PA/subzone × age × sex, GHS 2025"),
    "pop_subzone_dwelling_2025": ("C020125", "Resident population × PA/subzone × dwelling, GHS 2025"),
    "hh_income_by_pa_2025": ("C020145", "Households × PA × monthly household employment income, GHS 2025"),
    "solar_capacity_annual": ("M891611", "Installed solar PV capacity (W per capita), annual, EMA"),
    "pt_ridership_annual": ("M651351", "Public transport operation & ridership, annual, LTA"),
}

# key → (dataset id, format)
DATAGOV = {
    "hdb_property_info": ("d_17f5382f26140b1fdae0ba2ef6239d2f", "csv"),
    "hdb_existing_building": ("d_16b157c52ed637edd6ba1232e026258d", "geojson"),
    "mrt_station_exits": ("d_b39d3a0871985372d7e1637193335da5", "geojson"),
    "pa_boundary_mp2019": ("d_4765db0e87b9c86336792efe8a1f7a66", "geojson"),
    "subzone_boundary_mp2019": ("d_8594ae9ff96d0c708bc2af633048edfb", "geojson"),
    "wetbulb_hourly": ("d_f222c70a7c00c5a5a9d4ec432d67f6e8", "csv"),
    "air_temp_2024": ("d_910c81fce47f38574015b3882ac59254", "csv"),
    "rh_2024": ("d_7916c4c0cbe0dfaadaeac4b56d732a2a", "csv"),
    "wind_speed_2024": ("d_33f6c1091f73c1451c3aedc4f0061c9c", "csv"),
    "coe_results": ("d_69b3380ad7e51aff3a7dcc84eba52b8a", "csv"),
    "avg_speed_peak": ("d_26f6afadf2f86b2004f9a1e28f5564cc", "csv"),
    "traffic_entering_city": ("d_3136f317a1f282a33fe7a2f6a907c047", "csv"),
    "electricity_tariff_monthly": ("d_61eac3cdb086814af485dcc682b75ae9", "csv"),
    "electricity_generation_monthly": ("d_ae4afbaf5bc96bde19d8ce85810ab9f4", "csv"),
}


def run(only: str | None = None) -> dict:
    results = {}
    if only in (None, "singstat"):
        for key, (tid, desc) in SINGSTAT.items():
            try:
                df = singstat.fetch(tid, key=key)
                out = registry.PROCESSED_DIR / f"{key}.csv"
                df.to_csv(out, index=False)
                results[key] = f"ok ({len(df)} cells)"
            except Exception as e:  # keep going; report at the end
                results[key] = f"FAIL {e}"
                traceback.print_exc()
            print(f"[singstat] {key:30s} {results[key]}", flush=True)
    if only in (None, "datagov"):
        for key, (did, fmt) in DATAGOV.items():
            try:
                out = datagov.fetch(did, key, fmt)
                n = len(out["features"]) if fmt == "geojson" else len(out)
                results[key] = f"ok ({n} {'features' if fmt == 'geojson' else 'rows'})"
            except Exception as e:
                results[key] = f"FAIL {e}"
            print(f"[datagov ] {key:30s} {results[key]}", flush=True)
    return results


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["singstat", "datagov"])
    a = ap.parse_args()
    res = run(a.only)
    fails = [k for k, v in res.items() if v.startswith("FAIL")]
    print(f"\n{len(res) - len(fails)}/{len(res)} sources ok" + (f"; failed: {fails}" if fails else ""))
