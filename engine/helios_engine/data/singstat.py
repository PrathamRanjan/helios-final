"""SingStat Table Builder fetcher → tidy (long) DataFrames.

API: https://tablebuilder.singstat.gov.sg/api/table/tabledata/<id>
Cross-tab (census) tables: rows = categories (e.g. planning areas, with rowNo like "1.3"), columns = second dimension.
Time-series tables: rows = series, columns = periods.
"""
from __future__ import annotations

import json

import pandas as pd

from . import http, registry

BASE = "https://tablebuilder.singstat.gov.sg/api/table/tabledata/{id}"


def _num(v: str):
    v = (v or "").strip().replace(",", "")
    if v in ("", "-", "na", "NA", "n.a."):
        return 0.0 if v == "-" else float("nan")  # SingStat: '-' = nil/negligible
    try:
        return float(v)
    except ValueError:
        return float("nan")


def fetch(table_id: str, key: str | None = None) -> pd.DataFrame:
    """Fetch a SingStat table, cache the raw JSON, register provenance, return a long DataFrame.

    Columns: row_no, row, level (depth of rowNo, 1 = total/top), col, value, uom.
    """
    url = BASE.format(id=table_id)
    data = http.get(url, params={"limit": 5000}).json()["Data"]
    raw = registry.RAW_DIR / "singstat" / f"{table_id}.json"
    raw.parent.mkdir(parents=True, exist_ok=True)
    raw.write_text(json.dumps(data))

    def _flatten(cols, prefix=""):
        # Columns can nest (e.g. sex → age group); flatten to "Males|0 - 4".
        for c in cols or []:
            k = (c.get("key") or "").strip()
            name = f"{prefix}|{k}" if prefix else k
            if c.get("columns"):
                yield from _flatten(c["columns"], name)
            else:
                yield name, c.get("value")

    recs = []
    for r in data.get("row") or []:
        row_no = str(r.get("rowNo") or r.get("seriesNo") or "")
        for name, val in _flatten(r.get("columns")):
            recs.append(
                {
                    "row_no": row_no,
                    "row": (r.get("rowText") or "").strip(),
                    "level": row_no.count(".") + 1,
                    "col": name,
                    "value": _num(val),
                    "uom": r.get("uoM", ""),
                }
            )
    df = pd.DataFrame(recs)

    # as-of: the survey year for census tables, the latest period for time series
    as_of = None
    tt = data.get("tableType") or ""
    digits = "".join(ch for ch in tt if ch.isdigit())
    if len(digits) >= 4:
        as_of = digits[-4:]
    elif not df.empty:
        periods = [c for c in df["col"].unique() if c[:4].isdigit()]
        as_of = max(periods) if periods else None

    registry.record(
        key or f"singstat:{table_id}",
        source="SingStat Table Builder",
        url=f"https://tablebuilder.singstat.gov.sg/table/{'TS' if table_id.startswith('M') else 'CT'}/{table_id}",
        path=raw,
        title=data.get("title", ""),
        agency=data.get("dataSource") or data.get("datasource") or "",
        as_of=as_of,
        rows=len(data.get("row") or []),
        notes=(tt or data.get("frequency", "")),
    )
    return df


def crosstab(df: pd.DataFrame, level: int | None = 2) -> pd.DataFrame:
    """Wide table: index = row categories at `level` (2 = planning areas under the Total row), columns = col keys."""
    sub = df if level is None else df[df["level"] == level]
    return sub.pivot_table(index="row", columns="col", values="value", aggfunc="first")


def timeseries(df: pd.DataFrame, series_row: str | None = None) -> pd.Series:
    """One time series (first row or the named row) indexed by period."""
    sub = df if series_row is None else df[df["row"] == series_row]
    first = sub["row"].iloc[0] if series_row is None else series_row
    s = sub[sub["row"] == first].set_index("col")["value"]
    return s.sort_index()
