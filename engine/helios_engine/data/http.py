"""Polite HTTP with retry/backoff for public government APIs (they rate-limit)."""
from __future__ import annotations

import time
import warnings

import requests

warnings.filterwarnings("ignore", message=".*OpenSSL.*")

UA = {"User-Agent": "helios-engine/0.1 (research prototype)", "Accept": "application/json"}


def get(url: str, *, params: dict | None = None, headers: dict | None = None, tries: int = 8, timeout: int = 60, stream: bool = False) -> requests.Response:
    h = {**UA, **(headers or {})}
    last = None
    for i in range(tries):
        try:
            r = requests.get(url, params=params, headers=h, timeout=timeout, stream=stream)
            if r.status_code == 429 or r.status_code >= 500:
                last = f"HTTP {r.status_code}"
                time.sleep(min(30, 2 * (i + 1)))
                continue
            r.raise_for_status()
            return r
        except requests.RequestException as e:  # network blip
            last = str(e)
            time.sleep(min(30, 2 * (i + 1)))
    raise RuntimeError(f"GET failed after {tries} tries: {url} ({last})")
