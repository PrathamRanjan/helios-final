"""HELIO Flow — freeze the baseline world state (runs once, offline).

Mirrors lib/compass/world/buildWorld.ts: nodes from LTA stops/stations + solar
buildings, corridor edges + agent cohorts from the fare-card OD matrix — then
upgrades each corridor's shadeScore from a flat proxy to a building-shadow score
computed from real OSM footprint heights (district_vector.json). Near-vertical
tropical sun makes the height/distance canyon proxy defensible for Singapore.
Also emits data/shade_segments.json for the UI heat layer.

Usage:  python3 ingest/build_world_state.py [district_id]
"""
from __future__ import annotations

import calendar
import json
import math
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

DISTRICT = sys.argv[1] if len(sys.argv) > 1 else "jurong_east"
BASELINE_FILE = (
    DATA / "district_baseline.json"
    if DISTRICT == "jurong_east"
    else DATA / f"{DISTRICT}_baseline.json"
)
OUT = DATA / f"world_baseline_{DISTRICT}.json"


def weekdays_in_month(yyyymm: str) -> int:
    """Mon-Fri days in a YYYYMM string (mirrors mobility.ts weekdaysInMonth)."""
    try:
        year, month = int(yyyymm[:4]), int(yyyymm[4:6])
    except ValueError:
        return 21
    days = calendar.monthrange(year, month)[1]
    count = sum(1 for d in range(1, days + 1) if date(year, month, d).weekday() < 5)
    return count or 21


def default_env(env_defaults: dict, shade: float | None = None) -> dict:
    return {
        "heatExposure": env_defaults["heatExposure"]["value"],
        "rainExposure": env_defaults["rainExposure"]["value"],
        "shadeScore": env_defaults["shadeScore"]["value"] if shade is None else shade,
        "comfortScore": env_defaults["comfortScore"]["value"],
        "safetyScore": env_defaults["safetyScore"]["value"],
        "comfortBonus": {},
        "safetyBonus": {},
        "travelTimeMultiplier": {},
        "costMultiplier": {},
        "carTimePenaltyMin": 0,
        "busWaitDeltaMin": 0,
        "cycleMaxKmExtension": 0,
    }


# --------------------------------------------------------------------------- #
# Building-shadow shade scores (M7)
# --------------------------------------------------------------------------- #
KM_LAT = 111.32
SHADE_RADIUS_M = 60.0     # buildings this close can shade a street
MIN_DIST_M = 8.0          # clamp: standing beside a facade
CONTRIB_CAP = 3.0         # one huge tower can't do it all
NORMALIZER = 6.0          # dense two-sided canyon ≈ 1.0 raw
SHADE_BASE = 0.12         # residual trees/covered-walkway baseline (proxy)
SHADE_GAIN = 0.5
SHADE_CAP = 0.75          # streets are never fully shaded all day


class ShadeIndex:
    """Grid-hashed OSM building centroids+heights for fast proximity queries."""

    def __init__(self, vector_file: Path):
        self.cell_deg = 0.001  # ~110 m
        self.grid: dict[tuple[int, int], list[tuple[float, float, float]]] = {}
        if not vector_file.exists():
            print("  ! no district_vector.json — keeping flat shade proxy")
            return
        vec = json.loads(vector_file.read_text())
        for b in vec.get("buildings", []):
            poly = b.get("polygon") or []
            h = float(b.get("height") or 0)
            if not poly or h <= 3:
                continue
            lng = sum(p[0] for p in poly) / len(poly)
            lat = sum(p[1] for p in poly) / len(poly)
            key = (int(lat / self.cell_deg), int(lng / self.cell_deg))
            self.grid.setdefault(key, []).append((lat, lng, h))

    def shade_at(self, lat: float, lng: float) -> float:
        if not self.grid:
            return SHADE_BASE + 0.13  # matches the old flat 0.25 default
        km_lng = KM_LAT * math.cos(math.radians(lat))
        ci, cj = int(lat / self.cell_deg), int(lng / self.cell_deg)
        raw = 0.0
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for blat, blng, h in self.grid.get((ci + di, cj + dj), []):
                    dm = max(
                        MIN_DIST_M,
                        math.hypot((blat - lat) * KM_LAT, (blng - lng) * km_lng) * 1000,
                    )
                    if dm <= SHADE_RADIUS_M:
                        raw += min(h / dm, CONTRIB_CAP)
        return min(SHADE_CAP, SHADE_BASE + SHADE_GAIN * min(1.0, raw / NORMALIZER))


def main() -> None:
    baseline = json.loads(BASELINE_FILE.read_text())
    mc = json.loads((DATA / "assumptions" / "mode_choice.json").read_text())
    wd = json.loads((DATA / "assumptions" / "world_defaults.json").read_text())
    pt_share = mc["baseline_pt_share"]["value"]
    env_defaults = wd["edge_defaults"]

    nodes: list[dict] = []
    node_by_id: dict[str, dict] = {}
    for n in baseline["nodes"]:
        hourly = n["hourly_weekday"]
        node = {
            "id": n["code"],
            "type": "mrt_station" if n["type"] == "TRAIN" else "bus_stop",
            "name": n["name"],
            "lat": n["lat"],
            "lng": n["lng"],
            "attrs": {"footfallDaily": sum(hourly["tap_in"]) + sum(hourly["tap_out"])},
        }
        nodes.append(node)
        node_by_id[node["id"]] = node

    for b in baseline["buildings"]:
        solar = b.get("solar", {})
        nodes.append({
            "id": b["id"],
            "type": "building",
            "name": b["name"],
            "lat": b["lat"],
            "lng": b["lng"],
            "attrs": (
                {"solarAnnualKWh": solar.get("annual_kwh"), "solarKwp": solar.get("kwp")}
                if solar.get("available")
                else {}
            ),
        })

    wkdays = weekdays_in_month(baseline["pv_month"])
    agg: dict[str, dict] = {}
    for od in baseline["od"]:
        if od["o"] == od["d"]:
            continue
        key = f"{od['o']}->{od['d']}"
        cur = agg.get(key)
        if cur:
            cur["trips"] += od["trips"]
        else:
            agg[key] = {"o": od["o"], "d": od["d"], "trips": od["trips"], "dist": od["dist_km"]}

    shade_index = ShadeIndex(DATA / ("district_vector.json" if DISTRICT == "jurong_east" else f"{DISTRICT}_vector.json"))

    edges: list[dict] = []
    cohorts: list[dict] = []
    for a in agg.values():
        if a["trips"] <= 0 or a["dist"] <= 0:
            continue
        frm, to = node_by_id.get(a["o"]), node_by_id.get(a["d"])
        if not frm or not to:
            continue
        daily_transit = a["trips"] / wkdays
        edge_id = f"{a['o']}->{a['d']}"
        mid_lat = (frm["lat"] + to["lat"]) / 2
        mid_lng = (frm["lng"] + to["lng"]) / 2
        # Corridor shade = mean of endpoint + midpoint building-shadow scores
        shade = round(
            (
                shade_index.shade_at(frm["lat"], frm["lng"])
                + shade_index.shade_at(mid_lat, mid_lng)
                + shade_index.shade_at(to["lat"], to["lng"])
            )
            / 3,
            3,
        )
        edges.append({
            "id": edge_id,
            "from": a["o"],
            "to": a["d"],
            "distKm": a["dist"],
            "midLat": mid_lat,
            "midLng": mid_lng,
            "observedTransitDaily": daily_transit,
            "totalTripsDaily": daily_transit / pt_share,
            "attrs": default_env(env_defaults, shade),
        })
        cohorts.append({
            "id": f"cohort:{edge_id}",
            "edgeId": edge_id,
            "tripsPerDay": daily_transit / pt_share,
            "availableModes": ["car", "bus", "mrt", "walk", "cycle"],
        })

    world = {
        "year": 2026,
        "districtId": baseline["district_id"],
        "nodes": nodes,
        "edges": edges,
        "cohorts": cohorts,
        "energy": {"addedSolarAnnualKWh": 0, "addedBatteryKWh": 0, "addedChargingKW": 0},
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "pv_month": baseline["pv_month"],
            "weekdays_in_month": wkdays,
            "pt_share": pt_share,
            "source": baseline.get("source", ""),
            "builder": "ingest/build_world_state.py (mirrors lib/compass/world/buildWorld.ts)",
        },
    }

    OUT.write_text(json.dumps(world))
    size_mb = OUT.stat().st_size / 1e6
    shades = [e["attrs"]["shadeScore"] for e in edges]
    print(
        f"✓ Wrote {OUT.relative_to(ROOT)} — {len(nodes)} nodes, {len(edges):,} corridors, "
        f"{len(cohorts):,} cohorts ({size_mb:.1f} MB)"
    )
    if shades:
        print(
            f"  shade: min {min(shades):.2f} · mean {sum(shades)/len(shades):.2f} · "
            f"max {max(shades):.2f} · >0.4: {sum(1 for s in shades if s > 0.4)}"
        )

    # UI heat layer: top corridors by demand with their shade + heat exposure.
    heat_base = env_defaults["heatExposure"]["value"]
    segs = sorted(edges, key=lambda e: -e["totalTripsDaily"])[:500]
    seg_out = []
    for e in segs:
        frm, to = node_by_id[e["from"]], node_by_id[e["to"]]
        eff = heat_base * (1 - e["attrs"]["shadeScore"])
        seg_out.append({
            "id": e["id"],
            "from": [frm["lng"], frm["lat"]],
            "to": [to["lng"], to["lat"]],
            "shade": e["attrs"]["shadeScore"],
            "effHeat": round(eff, 3),
            "tripsPerDay": round(e["totalTripsDaily"]),
        })
    (DATA / "shade_segments.json").write_text(json.dumps({
        "district_id": DISTRICT,
        "method": "building-shadow proxy: sum(height/dist) over OSM footprints ≤60 m, near-vertical tropical sun",
        "segments": seg_out,
    }))
    print(f"✓ Wrote data/shade_segments.json — {len(seg_out)} segments for the heat layer")


if __name__ == "__main__":
    main()
