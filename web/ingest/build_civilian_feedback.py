#!/usr/bin/env python3
"""Freeze the cleaned Reddit sustainability scrape into a small, demo-safe JSON
the HELIO Flow app reads at runtime — the "civilian feedback" RAG store.

Input : ~/reddit_sustainability_index/data/processed/<run>/  (raw_posts.jsonl + city_topic_index.csv)
Output: web/data/civilian_feedback.json

For each city × topic we compute:
  - civicScore 0-100  : how residents feel about this topic (sentiment + support),
                        blended so a topic with strong positive discourse scores high.
  - support / sentiment / counts : the components (shown labelled in the UI).
  - quotes[]          : 2-4 top-engagement real comments, usernames stripped,
                        each kept with its source permalink for provenance.

Label everywhere in the UI: "Reddit discourse proxy — not representative polling."
Retrieval is entirely offline/frozen; no live dependency at demo time.
"""

import csv
import json
import re
from collections import defaultdict
from pathlib import Path

RUN = Path.home() / "reddit_sustainability_index/data/processed/focused_rescrape_20260703"
OUT = Path(__file__).resolve().parent.parent / "data" / "civilian_feedback.json"

TOPICS = [
    "public_transport", "active_mobility", "heat_weather",
    "climate_environment", "ev_energy", "policy_prices",
]

# Topic keywords used to pick quotes that are actually about the topic.
TOPIC_KEYWORDS = {
    "public_transport": ["mrt", "bus", "train", "transit", "metro", "public transport", "lrt", "commute", "station"],
    "active_mobility": ["cycl", "bike", "walk", "pedestrian", "footpath", "sidewalk", "pcn", "scooter"],
    "heat_weather": ["heat", "hot", "shade", "shelter", "rain", "flood", "humid", "weather", "aircon"],
    "climate_environment": ["climate", "carbon", "emission", "pollution", "air quality", "green", "environment", "recycl", "waste"],
    "ev_energy": ["ev", "electric vehicle", "charger", "charging", "solar", "renewable", "battery", "grid", "tariff"],
    "policy_prices": ["coe", "erp", "tax", "subsid", "rebate", "price", "fare", "toll", "policy"],
}


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def civic_score(avg_sentiment, support_ratio, n_posts):
    """0-100. Sentiment (normalised from roughly [-3,3]) blended with the
    positive-share of posts, then lightly damped when the sample is tiny so a
    single post can't read as a confident 90."""
    sent_norm = clamp((avg_sentiment + 3.0) / 6.0)      # [-3,3] -> [0,1]
    blended = 0.55 * sent_norm + 0.45 * support_ratio    # 0..1
    # Pull toward the neutral midpoint (0.5) when n is small (confidence damping).
    conf = clamp(n_posts / 25.0)                          # full confidence at 25+ posts
    damped = 0.5 + (blended - 0.5) * (0.5 + 0.5 * conf)
    return round(damped * 100)


def strip_user(body):
    body = re.sub(r"\bu/[A-Za-z0-9_-]+", "someone", body)
    body = re.sub(r"\s+", " ", body).strip()
    return body


def pick_quotes(posts, topic, limit=4):
    kws = TOPIC_KEYWORDS[topic]
    cands = []
    for p in posts:
        url = p.get("url", "")
        for c in (p.get("comments") or []):
            body = (c.get("body") or "").strip()
            if not (60 <= len(body) <= 260):
                continue
            low = body.lower()
            if not any(k in low for k in kws):
                continue
            if body.startswith(">") or "http" in low:
                continue
            cands.append({
                "text": strip_user(body),
                "sentiment": c.get("sentiment_label", "neutral"),
                "score": int(c.get("score", 0)),
                "source": url,
            })
    cands.sort(key=lambda q: q["score"], reverse=True)
    # de-dup near-identical openings
    seen, out = set(), []
    for q in cands:
        key = q["text"][:40].lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(q)
        if len(out) >= limit:
            break
    return out


def main():
    if not RUN.exists():
        raise SystemExit(f"scrape run not found: {RUN}")

    # sentiment averages from the aggregate CSV
    agg = {}
    with (RUN / "city_topic_index.csv").open() as f:
        for row in csv.DictReader(f):
            agg[(row["city"], row["topic"])] = {
                "avg_sentiment": float(row["avg_sentiment"]),
                "posts": int(row["posts"]),
                "avg_engagement": float(row["avg_engagement"]),
            }

    # posts grouped by (city, primary_topic) for support ratio + quotes
    by_ct = defaultdict(list)
    with (RUN / "raw_posts.jsonl").open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            p = json.loads(line)
            topic = p.get("primary_topic") or p.get("matched_topic")
            if topic in TOPICS:
                by_ct[(p["city"], topic)].append(p)

    out = {"_meta": {
        "source": "reddit_sustainability_index / focused_rescrape_20260703",
        "label": "Reddit discourse proxy — not representative polling",
        "cities": {}, "topics": TOPICS,
    }, "cities": {}}

    for (city, topic), posts in by_ct.items():
        a = agg.get((city, topic))
        if not a:
            continue
        pos = sum(1 for p in posts if p.get("sentiment_label") == "positive")
        neg = sum(1 for p in posts if p.get("sentiment_label") == "negative")
        support = pos / (pos + neg) if (pos + neg) else 0.5
        n = a["posts"]
        score = civic_score(a["avg_sentiment"], support, n)
        n_comments = sum(len(p.get("comments") or []) for p in posts)
        out["cities"].setdefault(city, {})[topic] = {
            "civicScore": score,
            "avgSentiment": round(a["avg_sentiment"], 2),
            "supportRatio": round(support, 2),
            "nPosts": n,
            "nComments": n_comments,
            "quotes": pick_quotes(posts, topic),
        }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    cities = {c: len(t) for c, t in out["cities"].items()}
    print(f"wrote {OUT}  ({cities})")


if __name__ == "__main__":
    main()
