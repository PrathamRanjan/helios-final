// GET /api/compass/evidence — the validation & provenance bundle behind every HELIO number.
// Reads the engine's calibrated outputs from disk (demo-safe: no live service in the hot path).

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DIR = path.join(process.cwd(), "data", "assumptions", "calibrated");

function read(name: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
  } catch {
    return null;
  }
}

export async function GET() {
  const mc = read("mode_choice_calibrated.json");
  const heat = read("heat_calibrated.json");
  const energy = read("energy_calibrated.json");
  const decision = read("decision_calibrated.json");
  const registry = read("registry.json");

  return NextResponse.json({
    modeChoice: mc && {
      validation: mc.validation,
      nests: mc.nests,
      nationalShares: mc.national_shares_2025,
      paDelta: mc.runtime?.pa_delta_relative,
      source: mc.source,
    },
    heat: heat && {
      utciByHour: heat.utci_by_hour_annual,
      heatExposure: heat.heat_exposure_annual,
      heatExposureHot: heat.heat_exposure_hot_months,
      buildings: heat.n_buildings,
      osmHeights: heat.n_buildings_osm_height,
      validation: heat.validation,
      shadeStats: (() => {
        const v = Object.values(heat.edges ?? {}).map((e: any) => e.shade as number).sort((a, b) => a - b);
        const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))];
        return v.length ? { n: v.length, p10: q(0.1), p50: q(0.5), p90: q(0.9) } : null;
      })(),
    },
    energy: energy && {
      solar: energy.solar_diffusion,
      ev: energy.ev_diffusion && {
        latest: energy.ev_diffusion.latest,
        band: energy.ev_diffusion.fit_band,
        carEfData: energy.ev_diffusion.car_ef_data_implied_gpkm,
        carEfBand: energy.ev_diffusion.car_ef_data_implied_band_gpkm,
        carEfPathway: energy.ev_diffusion.car_ef_pathway_gpkm,
      },
      pv: energy.pv,
      dispatchInsight: energy.dispatch_insight,
      dispatchSg: energy.example_dispatch_sg && { atStakePct: energy.example_dispatch_sg.co2_at_stake_pct },
      dispatchVn: energy.example_dispatch_hanoi_grid && {
        atStakePct: energy.example_dispatch_hanoi_grid.co2_at_stake_pct,
        breakevenUsdPerT: energy.example_dispatch_hanoi_grid.breakeven_carbon_price_usd_per_t,
      },
      chargers: energy.charger_sizing_example,
    },
    decision: decision && {
      generated: decision.generated,
      nSamples: decision.n_samples,
      parameters: decision.parameters,
      budgetUsd: decision.budget_usd,
      evpiAll: decision.evpi_all_options_usd,
      evppiAll: decision.evppi_all_options_usd,
      studyCost: decision.study_cost_usd,
      candidates: decision.candidates,
      portfolios: decision.portfolios,
      regret: decision.pathway_regret && {
        minimaxChoice: decision.pathway_regret.minimax_choice,
        pathways: decision.pathway_regret.pathways,
      },
    },
    provenance: registry
      ? Object.values(registry).map((r: any) => ({ key: r.key, title: r.title, agency: r.agency, source: r.source, url: r.url, asOf: r.as_of, rows: r.rows, stale: r.stale }))
      : [],
  });
}
