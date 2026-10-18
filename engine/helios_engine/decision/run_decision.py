"""End-to-end decision analysis on the REAL simulator.

    cd helios/engine && .venv/bin/python -m helios_engine.decision.run_decision [--n 120]

1. Probabilistic sensitivity analysis: LHS (+copula) over 6 model parameters × every optimizer
   candidate, each run through the TypeScript simulator.
2. GP surrogate per candidate (5-fold CV R² reported) → Sobol indices on net benefit.
3. Value of information: EVPI across options; EVPPI per parameter; FUND / STUDY / DEFER per option.
4. Mean–CVaR portfolio MILP under a S$2M-class budget at three risk attitudes, then JOINT
   re-simulation of the chosen package to measure interaction effects vs the additive assumption.
5. Minimax regret of each option across Green Plan pathways (deep uncertainty).

Writes web/data/assumptions/calibrated/decision_calibrated.json
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import time

import numpy as np

from ..choice.utility import ASSUMPTIONS
from ..uncertainty.sampling import NAMES, lhs, list_candidates, simulate, to_samples
from ..uncertainty.sensitivity import Surrogate, cv_r2, sobol_on
from .evpi import evpi, evppi, gate
from .portfolio import mean_cvar, minimax_regret

# Cost of a study that would resolve each uncertainty (USD). Proxy figures from typical Singapore
# consultancy scopes — label: literature-derived / consultancy proxy.
STUDY_COST = {
    "behavioural": 40_000,    # before/after pedestrian & cycle counts + intercept survey
    "betaHeatMult": 40_000,   # same survey with thermal-comfort module
    "betaCostMult": 60_000,   # stated-preference survey (value of time)
    "capexMult": 25_000,      # quantity-surveyor estimate per site
    "evDisplace": 30_000,     # fleet / charger-user survey
    "lambdaPt": 80_000,       # HTS microdata request + nested-logit estimation
}
BUDGET = 1_500_000  # USD (≈ S$2M)


def family(cid: str) -> str:
    return cid.split("_")[1] if cid.startswith("opt_") else cid


def main(n: int = 120, workers: int = 4) -> dict:
    t0 = time.time()
    cands = list_candidates()
    ids = [c["id"] for c in cands]
    X = lhs(n, seed=11)
    sim = simulate(to_samples(X), candidate_ids=ids, workers=workers)
    NB = sim.metric("netBenefitUsd")          # (n, k)
    CO2 = sim.metric("netCO2AvoidedT")
    capex = np.array([c["capexUsd"] for c in cands], dtype=float)
    t_sim = time.time() - t0

    # 2. surrogate + Sobol per candidate
    per = []
    for j, c in enumerate(cands):
        y = NB[:, j]
        r2 = cv_r2(X, y) if y.std() > 1e-6 else 1.0
        S = sobol_on(Surrogate(X, y).predict, n_base=1024) if y.std() > 1e-6 else {p: {"S1": 0, "ST": 0} for p in NAMES}
        # 3. value of information for the binary decision (fund this vs do nothing)
        two = np.column_stack([y, np.zeros_like(y)])
        ev_pp = {p: evppi(two, X[:, i]) for i, p in enumerate(NAMES)}
        g = gate(y, ev_pp, STUDY_COST)
        per.append(
            {
                "id": c["id"],
                "label": c["label"],
                "capexUsd": c["capexUsd"],
                "netBenefit": {"mean": float(y.mean()), "p10": float(np.percentile(y, 10)), "p50": float(np.median(y)), "p90": float(np.percentile(y, 90))},
                "netCO2T": {"mean": float(CO2[:, j].mean()), "p10": float(np.percentile(CO2[:, j], 10)), "p90": float(np.percentile(CO2[:, j], 90))},
                "surrogate_cv_r2": round(float(r2), 4),
                "sobol": {p: {"S1": round(v["S1"], 4), "ST": round(v["ST"], 4)} for p, v in S.items()},
                "evpi_binary": evpi(two),
                "evppi": {p: round(v, 2) for p, v in ev_pp.items()},
                "gate": g,
            }
        )

    # EVPI across the whole option set (choose ONE of k options or nothing)
    all_opts = np.column_stack([NB, np.zeros(n)])
    evpi_all = evpi(all_opts)
    evppi_all = {p: evppi(all_opts, X[:, i]) for i, p in enumerate(NAMES)}

    # 4. portfolio at three risk attitudes, then joint re-simulation
    fams = [family(i) for i in ids]
    portfolios = {}
    for w in (0.0, 0.5, 0.9):
        r = mean_cvar(NB, capex, BUDGET, alpha=0.1, w=w, families=fams, family_cap=2)
        r["ids"] = [ids[i] for i, x in enumerate(r["selected"]) if x]
        portfolios[f"w={w}"] = r
    uniq = []
    for r in portfolios.values():
        if r["ids"] and r["ids"] not in uniq:
            uniq.append(r["ids"])
    joint = simulate(to_samples(X[:40]), packages=uniq, workers=workers) if uniq else None
    for r in portfolios.values():
        if joint and r["ids"] in uniq:
            k = uniq.index(r["ids"])
            jnb = joint.metric("netBenefitUsd")[:, k]
            add = NB[:40] @ np.array(r["selected"])
            r["joint_check"] = {
                "joint_mean": float(jnb.mean()),
                "additive_mean": float(add.mean()),
                "interaction_pct": float((jnb.mean() - add.mean()) / max(abs(add.mean()), 1e-9) * 100),
            }

    # 5. regret across Green Plan pathways (central parameters)
    centre = [{p: float(np.mean(lhs(1000, seed=2)[:, i])) for i, p in enumerate(NAMES)}]
    regret_tbl = []
    pathways = ["target_achieved", "delayed", "accelerated", "frozen"]
    for pw in pathways:
        r = simulate(centre, candidate_ids=ids, workers=1, pathway=pw)
        regret_tbl.append(r.metric("netBenefitUsd")[0])
    regret_tbl = np.array(regret_tbl)
    mm = minimax_regret(np.column_stack([regret_tbl, np.zeros(len(pathways))]))

    out = {
        "generated": dt.datetime.now().isoformat(timespec="seconds"),
        "n_samples": n,
        "parameters": NAMES,
        "simulation_seconds": round(t_sim, 1),
        "study_cost_usd": STUDY_COST,
        "study_cost_label": "consultancy proxy",
        "budget_usd": BUDGET,
        "candidates": per,
        "evpi_all_options_usd": evpi_all,
        "evppi_all_options_usd": evppi_all,
        "portfolios": portfolios,
        "pathway_regret": {
            "pathways": pathways,
            "nb_by_pathway": regret_tbl.tolist(),
            "minimax_choice": (ids + ["do_nothing"])[mm["choice"]],
            "max_regret_by_option": dict(zip(ids + ["do_nothing"], mm["max_regret_by_option"])),
        },
    }
    # Raw draws let tools re-optimise portfolios for any budget / risk attitude without re-simulating.
    from ..data.registry import PROCESSED_DIR

    np.savez_compressed(PROCESSED_DIR / "decision_draws.npz", X=X, NB=NB, CO2=CO2, capex=capex, ids=np.array(ids), labels=np.array([c["label"] for c in cands]), params=np.array(NAMES))
    (ASSUMPTIONS / "calibrated" / "decision_calibrated.json").write_text(json.dumps(out, indent=1, allow_nan=False, default=float))
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=120)
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    o = main(a.n, a.workers)
    print(f"sim {o['simulation_seconds']}s for {o['n_samples']} samples")
    for c in o["candidates"]:
        top = max(c["sobol"].items(), key=lambda kv: kv[1]["ST"])
        print(f"{c['gate']['verdict']:6s} NB mean ${c['netBenefit']['mean']:>12,.0f} p10 ${c['netBenefit']['p10']:>12,.0f}  R2 {c['surrogate_cv_r2']:.3f}  top ST {top[0]}={top[1]['ST']:.2f}  | {c['label']}")
    print("EVPI all options $%.0f" % o["evpi_all_options_usd"], {k: round(v) for k, v in o["evppi_all_options_usd"].items()})
    for k, p in o["portfolios"].items():
        print(k, p["ids"], "E=%.0f CVaR=%.0f" % (p["expected_net_benefit"], p["cvar"]), p.get("joint_check"))
    print("minimax regret choice:", o["pathway_regret"]["minimax_choice"])
