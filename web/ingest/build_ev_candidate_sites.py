"""HELIO Flow — EV charging opportunity zones (runs once, offline).

Scores every transit node in the frozen world on real measured signals —
footfall, OD demand touching the node, solar-pairing potential nearby — plus a
spacing bonus so the shortlist spreads across the district. Output feeds the
"Recommended by HELIO" pins that solve the sandbox cold-start problem.

Usage:  python3 ingest/build_ev_candidate_sites.py [district_id]
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DISTRICT = sys.argv[1] if len(sys.argv) > 1 else "jurong_east"
WORLD = DATA / f"world_baseline_{DISTRICT}.json"
OUT = DATA / "ev_candidate_sites.json"

TOP_N = 8
SOLAR_PAIR_RADIUS_KM = 0.5


def dist_km(a: dict, b: dict) -> float:
    kx = 111.32 * math.cos(math.radians((a["lat"] + b["lat"]) / 2))
    return math.hypot((a["lng"] - b["lng"]) * kx, (a["lat"] - b["lat"]) * 111.32)


def main() -> None:
    world = json.loads(WORLD.read_text())
    nodes = world["nodes"]
    edges = world["edges"]

    transit = [n for n in nodes if n["type"] in ("bus_stop", "mrt_station")]
    solar_nodes = [n for n in nodes if n["attrs"].get("solarKwp")]

    # OD demand touching each node (measured).
    od_demand: dict[str, float] = {}
    for e in edges:
        od_demand[e["from"]] = od_demand.get(e["from"], 0) + e["totalTripsDaily"]
        od_demand[e["to"]] = od_demand.get(e["to"], 0) + e["totalTripsDaily"]

    max_foot = max((n["attrs"].get("footfallDaily", 0) for n in transit), default=1) or 1
    max_od = max(od_demand.values(), default=1) or 1

    scored = []
    for n in transit:
        foot = n["attrs"].get("footfallDaily", 0) / max_foot
        od = od_demand.get(n["id"], 0) / max_od
        near_solar = [s for s in solar_nodes if dist_km(n, s) <= SOLAR_PAIR_RADIUS_KM]
        solar_pair = min(1.0, sum(s["attrs"].get("solarKwp", 0) for s in near_solar) / 2000)
        # weights adapted from the master plan §15 formula (grid/carpark layers
        # arrive when the LTA EV Charging Points dataset is ingested)
        score = 0.4 * foot + 0.35 * od + 0.25 * solar_pair
        scored.append((score, foot, od, solar_pair, n, near_solar))

    scored.sort(key=lambda x: -x[0])

    # Greedy spacing: keep the shortlist ≥600 m apart so pins spread usefully.
    picked: list = []
    for row in scored:
        if len(picked) >= TOP_N:
            break
        if all(dist_km(row[4], p[4]) >= 0.6 for p in picked):
            picked.append(row)

    # Demand-based charger sizing: busier sites (footfall + OD) get more ports,
    # instead of a fixed 8 everywhere. Transparent unit costs, clamped to a sane
    # 4-16 port range. Grid-headroom / carpark constraints remain PENDING (no
    # dataset) — sizing is demand-led only, and we say so.
    CHARGER_KW = 22
    CHARGER_CAPEX = 5000       # per AC port (ev_charging.json charger_capex_per_port)
    BATTERY_KWH_PER_PORT = 40  # buffering to shave peak grid draw
    BATTERY_CAPEX_PER_KWH = 400
    CIVIL_GRID_CAPEX = 60000   # foundation + grid connection, fixed

    def size_asset(foot, od, solar_pair):
        intensity = 0.5 * foot + 0.5 * od          # 0..1 measured demand signal
        ports = 4 + round(12 * intensity)          # 4..16
        ports = max(4, min(16, ports))
        if ports % 2:                              # keep even for bay layout
            ports = min(16, ports + 1)
        battery = ports * BATTERY_KWH_PER_PORT
        capex = ports * CHARGER_CAPEX + battery * BATTERY_CAPEX_PER_KWH + CIVIL_GRID_CAPEX
        return {
            "ports": ports,
            "chargerPowerKW": CHARGER_KW,
            "chargingCapacityKW": ports * CHARGER_KW,
            "batteryKWh": battery,
            "solarCanopyKWhYr": 120000 if solar_pair > 0.2 else 0,
            "capexUsd": capex,
            "sizing": "demand-led (footfall+OD); grid-headroom & carpark constraints PENDING",
        }

    sites = []
    for i, (score, foot, od, solar_pair, n, near_solar) in enumerate(picked):
        reasons = []
        if foot > 0.3:
            reasons.append("High measured tap-in/out footfall")
        if od > 0.3:
            reasons.append("Strong OD corridor demand")
        if solar_pair > 0.2:
            reasons.append(f"Solar pairing nearby ({', '.join(s['name'] for s in near_solar[:2])})")
        if not reasons:
            reasons.append("Coverage gap in the district shortlist")
        asset = size_asset(foot, od, solar_pair)
        reasons.append(f"Sized to {asset['ports']} ports from measured demand")
        sites.append({
            "id": f"ev_{DISTRICT}_{i+1:02d}",
            "name": n["name"],
            "nodeId": n["id"],
            "nodeType": n["type"],
            "lat": n["lat"],
            "lng": n["lng"],
            "score": round(score, 3),
            "reasons": reasons,
            "recommendedAsset": asset,
        })

    OUT.write_text(json.dumps({
        "district_id": DISTRICT,
        "method": "0.4·footfall + 0.35·OD demand + 0.25·solar pairing (measured signals), ≥600 m spacing",
        "note": "Grid headroom / carpark layers pending LTA EV Charging Points ingest — labelled accordingly",
        "sites": sites,
    }, indent=2))
    print(f"✓ Wrote {OUT.relative_to(ROOT)} — {len(sites)} candidate sites")
    for s in sites:
        print(f"  {s['id']}  {s['score']:.2f}  {s['name']}")


if __name__ == "__main__":
    main()
