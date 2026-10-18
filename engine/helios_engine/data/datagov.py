"""data.gov.sg fetcher (CSV + GeoJSON) via the public download API.

Flow: GET /v1/public/api/datasets/<id>/poll-download → {data: {url}} → download file.
Metadata (title, agency, coverage) from api-production /v2/public/api/datasets/<id>/metadata.
"""
from __future__ import annotations

import io
import json
import time

import pandas as pd

from . import http, registry

POLL = "https://api-open.data.gov.sg/v1/public/api/datasets/{id}/poll-download"
INIT = "https://api-open.data.gov.sg/v1/public/api/datasets/{id}/initiate-download"
META = "https://api-production.data.gov.sg/v2/public/api/datasets/{id}/metadata"


def _download_url(dataset_id: str) -> str:
    for attempt in range(10):
        j = http.get(POLL.format(id=dataset_id)).json()
        url = (j.get("data") or {}).get("url")
        if url:
            return url
        # Large datasets need an explicit initiate before poll returns a URL.
        try:
            import requests

            requests.get(INIT.format(id=dataset_id), headers=http.UA, timeout=30)
        except Exception:
            pass
        time.sleep(3 + attempt)
    raise RuntimeError(f"no download url for {dataset_id}")


def metadata(dataset_id: str) -> dict:
    try:
        return http.get(META.format(id=dataset_id)).json().get("data", {})
    except Exception:
        return {}


def fetch(dataset_id: str, key: str, fmt: str = "csv") -> pd.DataFrame | dict:
    """Download a dataset, cache raw, register provenance. Returns a DataFrame (csv) or dict (geojson)."""
    meta = metadata(dataset_id)
    url = _download_url(dataset_id)
    content = http.get(url, timeout=300).content
    ext = "geojson" if fmt == "geojson" else "csv"
    raw = registry.RAW_DIR / "datagov" / f"{key}.{ext}"
    raw.parent.mkdir(parents=True, exist_ok=True)
    raw.write_bytes(content)

    if fmt == "geojson":
        obj = json.loads(content)
        rows = len(obj.get("features", []))
        out = obj
    else:
        out = pd.read_csv(io.BytesIO(content), low_memory=False)
        rows = len(out)

    cov_end = (meta.get("coverageEnd") or meta.get("lastUpdatedAt") or "")[:7] or None
    registry.record(
        key,
        source="data.gov.sg",
        url=f"https://data.gov.sg/datasets/{dataset_id}/view",
        path=raw,
        title=meta.get("name", key),
        agency=meta.get("managedBy", "") or meta.get("managedByAgencyName", ""),
        as_of=cov_end,
        rows=rows,
        notes=f"dataset_id={dataset_id}",
    )
    return out


def load_cached(key: str, fmt: str = "csv"):
    ext = "geojson" if fmt == "geojson" else "csv"
    p = registry.RAW_DIR / "datagov" / f"{key}.{ext}"
    if not p.exists():
        return None
    return json.loads(p.read_text()) if fmt == "geojson" else pd.read_csv(p, low_memory=False)
