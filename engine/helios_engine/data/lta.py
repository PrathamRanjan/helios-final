"""LTA vehicle statistics (lta.gov.sg PDFs) → tidy series. No key needed.

  MVP01-4_MVP_by_fuel.pdf     annual motor vehicle population by fuel type (2015–latest year)
  M09-Vehs_by_Fuel_Type.pdf   monthly, latest ~10 months
"""
from __future__ import annotations

import re

import pandas as pd

from . import http, registry

BASE = "https://www.lta.gov.sg/content/dam/ltagov/who_we_are/statistics_and_publications/statistics/pdf/"
FILES = {"annual": "MVP01-4_MVP_by_fuel.pdf", "monthly": "M09-Vehs_by_Fuel_Type.pdf"}
FUELS = ["Petrol-Electric (Plug-In)", "Diesel-Electric (Plug-In)", "Petrol-Electric", "Diesel-Electric", "Petrol-CNG", "Petrol", "Diesel", "Electric", "Total"]


def _fetch(kind: str):
    from pypdf import PdfReader

    p = registry.RAW_DIR / "lta" / FILES[kind]
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(http.get(BASE + FILES[kind], headers={"User-Agent": "Mozilla/5.0"}).content)
    return p, "\n".join(pg.extract_text() for pg in PdfReader(str(p)).pages)


def _rows(text: str) -> dict[str, list[float]]:
    out = {}
    for line in text.splitlines():
        line = line.strip()
        for f in FUELS:  # longest names first so "Petrol-Electric (Plug-In)" wins over "Petrol"
            if line.startswith(f + " ") and f not in out:
                nums = re.findall(r"[\d,]+|(?<=\s)-(?=\s|$)", line[len(f):])
                out[f] = [float(n.replace(",", "")) if n != "-" else 0.0 for n in nums]
                break
    return out


def vehicles_by_fuel() -> dict[str, pd.DataFrame]:
    res = {}
    p, t = _fetch("annual")
    year_line = next(l for l in t.splitlines() if len(re.findall(r"\b20\d\d\b", l)) >= 5 and not re.search(r"[A-Za-z]", l))
    years = [int(y) for y in re.findall(r"\b(20\d\d)\b", year_line)]
    rows = _rows(t)
    ann = pd.DataFrame({f: v[: len(years)] for f, v in rows.items() if len(v) >= len(years)}, index=years)
    registry.record("lta_vehicles_by_fuel_annual", source="LTA Annual Vehicle Statistics", url=BASE + FILES["annual"], path=p, title="Motor vehicle population by type of fuel used (annual)", agency="Land Transport Authority", as_of=str(max(years)), rows=len(ann))
    res["annual"] = ann

    p, t = _fetch("monthly")
    dates = re.findall(r"(\d{2}/\d{2}/\d{4})", t)
    rows = _rows(t)
    mon = pd.DataFrame({f: v[: len(dates)] for f, v in rows.items() if len(v) >= len(dates)}, index=pd.to_datetime(dates, dayfirst=True))
    registry.record("lta_vehicles_by_fuel_monthly", source="LTA Monthly Vehicle Statistics", url=BASE + FILES["monthly"], path=p, title="Motor vehicle population by type of fuel used (monthly)", agency="Land Transport Authority", as_of=str(mon.index.max().date())[:7], rows=len(mon))
    res["monthly"] = mon
    return res
