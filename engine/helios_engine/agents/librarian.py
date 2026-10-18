"""Data Librarian: retrieval over Singapore's full public dataset catalogue (7,489 tables).

Retrieval index: TF-IDF over title + agency + description (works offline, no key). When
GEMINI_API_KEY is set, `semantic=True` re-ranks the TF-IDF shortlist with Gemini embeddings
(text-embedding-004) — hybrid retrieval. Returns dataset ids and URLs so agents cite, not invent.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer

CATALOG = Path(__file__).resolve().parents[2] / "data" / "catalog"


@lru_cache(maxsize=1)
def _index():
    dg = pd.read_csv(CATALOG / "datagovsg_datasets.csv", dtype=str).fillna("")
    dg = pd.DataFrame(
        {
            "id": dg["dataset_id"],
            "title": dg["name"],
            "agency": dg["agency"],
            "source": "data.gov.sg",
            "coverage": (dg["coverage_start"].str[:4] + "–" + dg["coverage_end"].str[:4]).str.strip("–"),
            "url": dg["page_url"],
            "text": dg["name"] + " " + dg["agency"] + " " + dg["description"],
        }
    )
    st = pd.read_csv(CATALOG / "singstat_tables.csv", dtype=str).fillna("")
    st = pd.DataFrame(
        {
            "id": st["id"],
            "title": st["title"],
            "agency": "Singapore Department of Statistics",
            "source": "SingStat",
            "coverage": st["table_type"],
            "url": st["page_url"],
            "text": st["title"] + " " + st["theme"] + " " + st["subject"] + " " + st["topic"],
        }
    )
    df = pd.concat([dg, st], ignore_index=True).drop_duplicates(subset=["title", "source"])
    yrs = df["coverage"].str.extract(r"(\d{4})(?!.*\d{4})")[0].astype(float)
    df["recency"] = ((yrs - 2000) / 26).clip(0, 1).fillna(0.5)
    vec = TfidfVectorizer(ngram_range=(1, 2), min_df=1, sublinear_tf=True, stop_words="english")
    M = vec.fit_transform(df["text"].str.lower())
    return df.reset_index(drop=True), vec, M


def search_catalog(query: str, limit: int = 8, semantic: bool | None = None) -> list[dict]:
    df, vec, M = _index()
    q = vec.transform([query.lower()])
    scores = (M @ q.T).toarray().ravel()
    # Prefer the newest edition of a table (2025 survey over 2015 over 2010): +0–15 % by recency.
    scores = scores * (1 + 0.15 * df["recency"].values)
    top = np.argsort(-scores)[: max(limit * 5, 40)]
    if semantic is None:
        semantic = bool(os.environ.get("GEMINI_API_KEY"))
    if semantic:
        try:
            top = _rerank(query, df, top)
        except Exception:
            pass  # degrade to lexical ranking
    # Collapse editions of the same recurring table (Census 2010 / GHS 2015 / GHS 2025 …) to the newest.
    import re

    def family(t: str) -> str:
        t = re.sub(r"\bof (residence|workplace)\b", "", t.lower())
        return re.sub(r"[^a-z]+", " ", t).strip()

    best: dict[str, int] = {}
    for i in top:
        f = family(df.iloc[i]["title"]) + "|" + df.iloc[i]["source"]
        if f not in best or df.iloc[i]["recency"] > df.iloc[best[f]]["recency"]:
            best[f] = i
    keep = set(best.values())
    top = np.array([i for i in top if i in keep])
    out = []
    for i in top[:limit]:
        if scores[i] <= 0 and not semantic:
            break
        r = df.iloc[i]
        out.append({"id": r["id"], "title": r["title"], "agency": r["agency"], "source": r["source"], "coverage": r["coverage"], "url": r["url"], "score": round(float(scores[i]), 4)})
    return out


def _rerank(query: str, df: pd.DataFrame, cand: np.ndarray) -> np.ndarray:
    from google import genai

    client = genai.Client()
    texts = [query] + df.iloc[cand]["title"].tolist()
    emb = client.models.embed_content(model="text-embedding-004", contents=texts).embeddings
    V = np.array([e.values for e in emb])
    V = V / np.linalg.norm(V, axis=1, keepdims=True)
    sim = V[1:] @ V[0]
    return cand[np.argsort(-sim)]
