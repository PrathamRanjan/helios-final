import { NextResponse } from "next/server";
import { loadBaseline } from "@/lib/compass/data";
import { solarShape, loadShapeFromFootfall, selfConsumptionRatio } from "@/lib/compass/solar-lens";
import {
  modeShares,
  defaultParams,
  buildCorridors,
  baselineSplit,
  simulateIntervention,
  weekdaysInMonth,
  interventionCapex,
  type InterventionId,
} from "@/lib/compass/mobility";
import { rankInterventions } from "@/lib/compass/engine";

export const runtime = "nodejs";

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

function approx(a: number, b: number, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

export async function GET() {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail = "") =>
    checks.push({ name, pass, detail });

  try {
    // ---- solar shape ----
    const s = solarShape();
    add("solarShape sums to 1", approx(s.reduce((a, b) => a + b, 0), 1, 1e-9), `sum=${s.reduce((a, b) => a + b, 0)}`);
    add("solarShape zero at midnight", s[0] === 0 && s[3] === 0, `h0=${s[0]} h3=${s[3]}`);
    add("solarShape peaks midday", s[13] === Math.max(...s), `argmax=${s.indexOf(Math.max(...s))}`);

    // ---- self-consumption monotonicity ----
    const daytimeDemand = solarShape(); // perfectly matched
    const eveningDemand = new Array(24).fill(0);
    [18, 19, 20, 21, 22].forEach((h) => (eveningDemand[h] = 0.2));
    const scrDay = selfConsumptionRatio(100000, daytimeDemand, s);
    const scrEve = selfConsumptionRatio(100000, eveningDemand, s);
    add("self-consumption in [0,1]", scrDay >= 0 && scrDay <= 1 && scrEve >= 0 && scrEve <= 1, `day=${scrDay.toFixed(3)} eve=${scrEve.toFixed(3)}`);
    add("daytime demand self-consumes more than evening", scrDay > scrEve, `day=${scrDay.toFixed(3)} > eve=${scrEve.toFixed(3)}`);

    // ---- logit ----
    const p = defaultParams();
    for (const dist of [0.5, 2, 5, 12]) {
      const sh = modeShares(dist, p);
      const sum = sh.car + sh.bus + sh.mrt + sh.walk + sh.cycle;
      add(`mode shares sum to 1 @ ${dist}km`, approx(sum, 1, 1e-9), `sum=${sum}`);
    }
    const longTrip = modeShares(15, p);
    add("walk infeasible on long trip", longTrip.walk < 0.02, `walk@15km=${longTrip.walk.toFixed(4)}`);

    // ---- weekdays in month ----
    add("weekdaysInMonth(202605)=21", weekdaysInMonth("202605") === 21, `got ${weekdaysInMonth("202605")}`);
    add("weekdaysInMonth(202602)=20", weekdaysInMonth("202602") === 20, `got ${weekdaysInMonth("202602")}`);

    // ---- baseline + interventions (needs real data) ----
    const baseline = await loadBaseline("jurong_east");
    add("baseline has nodes", baseline.nodes.length > 50, `${baseline.nodes.length} nodes`);
    add("baseline has OD", baseline.od.length > 1000, `${baseline.od.length} OD rows`);

    const corridors = buildCorridors(baseline);
    add("corridors built", corridors.length > 100, `${corridors.length} corridors`);
    const bSplit = baselineSplit(corridors, p);
    add("baseline car share plausible (0.2-0.55)", bSplit.car >= 0.2 && bSplit.car <= 0.55, `car=${bSplit.car.toFixed(3)}`);

    const ivs: InterventionId[] = ["green_corridor", "road_to_green", "mobility_hub", "sheltered_walkway", "erp_parking", "new_bus_stop"];
    for (const iv of ivs) {
      const r = simulateIntervention(iv, baseline);
      add(`${iv}: CO2 avoided >= 0`, r.co2_avoided_tpy >= 0, `${r.co2_avoided_tpy} t`);
      add(`${iv}: reduces car share`, r.new_split.car <= r.baseline_split.car, `car ${r.baseline_split.car}->${r.new_split.car}`);
      add(`${iv}: capex > 0`, interventionCapex(iv) > 0, `$${interventionCapex(iv)}`);
      add(`${iv}: daily trips realistic (<1M)`, r.total_daily_trips < 1_000_000 && r.total_daily_trips > 1000, `${r.total_daily_trips}`);
    }

    // ---- full ranking ----
    const ranking = rankInterventions(baseline);
    add("ranking non-empty", ranking.ranked.length >= 5, `${ranking.ranked.length} items`);
    add("baseline mobility CO2 > 0", ranking.baseline_co2_tpy > 0, `${ranking.baseline_co2_tpy} t`);
    const sorted = ranking.ranked.every(
      (r, i, a) => i === 0 || a[i - 1].cost_per_tonne_usd <= r.cost_per_tonne_usd
    );
    add("ranked ascending by $/tonne", sorted, "");
    add("all interventions have positive CO2", ranking.ranked.every((r) => r.co2_avoided_tpy > 0), "");
  } catch (e: any) {
    add("uncaught exception", false, e?.message ?? String(e));
  }

  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.length - passed;
  return NextResponse.json(
    { suite: "compass-engine", total: checks.length, passed, failed, checks },
    { status: failed === 0 ? 200 : 500 }
  );
}
