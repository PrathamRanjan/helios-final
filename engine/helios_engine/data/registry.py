"""Provenance registry: every fetched source records where it came from, when, and how fresh it is.

Stored in engine/data/registry.json. The UI and the validation report read it so every number
can be traced to a source id and an as-of date.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ENGINE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
REGISTRY_PATH = DATA_DIR / "registry.json"

for _d in (RAW_DIR, PROCESSED_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# A source older than this (relative to today) is flagged stale.
STALE_AFTER_YEARS = 3


def _load() -> dict:
    if REGISTRY_PATH.exists():
        return json.loads(REGISTRY_PATH.read_text())
    return {}


def record(
    key: str,
    *,
    source: str,
    url: str,
    path: Path,
    title: str,
    as_of: str | None,
    rows: int,
    agency: str = "",
    notes: str = "",
) -> dict:
    """Register (or refresh) one source. `as_of` is the latest period the data covers (YYYY or YYYY-MM)."""
    reg = _load()
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    stale = False
    if as_of:
        try:
            year = int(str(as_of)[:4])
            stale = dt.date.today().year - year > STALE_AFTER_YEARS
        except ValueError:
            pass
    entry = {
        "key": key,
        "source": source,
        "title": title,
        "agency": agency,
        "url": url,
        "path": str(path.relative_to(ENGINE_DIR)),
        "fetched_at": dt.datetime.now().isoformat(timespec="seconds"),
        "as_of": as_of,
        "rows": rows,
        "sha256_16": digest,
        "stale": stale,
        "notes": notes,
    }
    reg[key] = entry
    REGISTRY_PATH.write_text(json.dumps(reg, indent=2, sort_keys=True))
    return entry


def get(key: str) -> dict | None:
    return _load().get(key)


def all_entries() -> dict:
    return _load()
