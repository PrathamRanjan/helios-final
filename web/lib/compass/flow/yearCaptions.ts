// Year captions — turns the silent time-lapse into a narrated story. For each
// year we diff the scenario timeline (and the known shocks/modifiers) against
// the previous year and emit 1-2 ranked, template captions built ONLY from real
// numbers already on screen — no LLM, so every line stays ledger-honest.

import type { ScenarioResult, WorldModifier, Shock, YearResult } from "../world/types";

export interface YearCaption {
  year: number;
  text: string;
  tone: "good" | "shock" | "policy" | "neutral";
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function shockLabel(s: Shock): string {
  switch (s.type) {
    case "heatwave": return "Heatwave";
    case "haze": return "Haze";
    case "heavy_rain": return "Monsoon surge";
    case "oil_price_spike": return "Oil price spike";
    case "pandemic": return "Pandemic";
    case "grid_carbon_spike": return "Grid-carbon spike";
  }
}

interface Opts {
  modifiers?: WorldModifier[];
  shocks?: Shock[];
}

/** One ranked caption per year (the strongest event), keyed by year. */
export function yearCaptions(result: ScenarioResult, opts: Opts = {}): Map<number, YearCaption> {
  const { modifiers = [], shocks = [] } = opts;
  const out = new Map<number, YearCaption>();
  const tl = result.timeline;

  for (let i = 0; i < tl.length; i++) {
    const y = tl[i];
    const prev: YearResult | undefined = tl[i - 1];
    const cands: { text: string; tone: YearCaption["tone"]; rank: number }[] = [];

    // — Shock onset / recovery (highest priority: it reshapes the world) —
    for (const s of shocks) {
      if (s.startYear === y.year) {
        cands.push({ text: `${shockLabel(s)} begins — the plan is stress-tested`, tone: "shock", rank: 100 });
      }
      const endYear = s.startYear + (("durationYears" in s ? s.durationYears : 1) || 1);
      if (endYear === y.year) {
        cands.push({ text: `${shockLabel(s)} passes — city recovers`, tone: "shock", rank: 70 });
      }
    }

    // — Intervention built this year (capex lands) —
    const built = modifiers.filter((m) => m.metadata.builtYear === y.year);
    if (built.length) {
      const name = built.length === 1 ? built[0].label : `${built.length} changes`;
      const cost = built.reduce((s, m) => s + m.economics.capexUsd, 0);
      cands.push({
        text: `${name} comes online — $${fmt(cost / 1000)}k invested`,
        tone: "good",
        rank: 80,
      });
    }

    // — Energy assets switching on —
    if (prev && y.solarKWh > 0 && prev.solarKWh === 0) {
      cands.push({ text: `Rooftop solar switches on — ${fmt(y.solarKWh / 1000)} MWh/yr clean generation`, tone: "good", rank: 60 });
    }
    if (prev && y.evChargingKWh > 0 && prev.evChargingKWh === 0) {
      cands.push({ text: `EV charging hub active — ${fmt(y.evCO2AvoidedTonnes)} t/yr displaced`, tone: "good", rank: 55 });
    }

    // — Policy milestone —
    if (y.year === 2030) {
      cands.push({ text: `Green Plan 2030 milestone — grid & fleets step cleaner`, tone: "policy", rank: 40 });
    }

    // — Impact swing (fallback narrative) —
    if (prev) {
      const dAvoid = y.annualCO2AvoidedTonnes - prev.annualCO2AvoidedTonnes;
      if (dAvoid > 3) {
        cands.push({ text: `Your changes bite harder — ${fmt(y.annualCO2AvoidedTonnes)} t avoided this year`, tone: "good", rank: 30 });
      }
    } else if (y.annualCO2AvoidedTonnes > 1) {
      cands.push({ text: `Plan takes effect — ${fmt(y.annualCO2AvoidedTonnes)} t avoided`, tone: "good", rank: 30 });
    }

    // — Demand dip (pandemic-style) without an explicit shock passed —
    if (prev && y.demandFactor < 0.95 && y.demandFactor < prev.demandFactor - 0.02) {
      cands.push({ text: `Travel demand drops to ${Math.round(y.demandFactor * 100)}% of normal`, tone: "shock", rank: 65 });
    }

    if (cands.length) {
      cands.sort((a, b) => b.rank - a.rank);
      out.set(y.year, { year: y.year, text: cands[0].text, tone: cands[0].tone });
    } else {
      // Every year gets *something* so the strip never blanks mid-lapse.
      out.set(y.year, {
        year: y.year,
        text:
          y.cumulativeCO2AvoidedTonnes > 0
            ? `${fmt(y.cumulativeCO2AvoidedTonnes)} t cumulative CO₂ avoided`
            : `The city evolves under ${result.policyPathway.label}`,
        tone: "neutral",
      });
    }
  }

  return out;
}
