import { NextRequest, NextResponse } from "next/server";
import { gemmaChat, parseJson, GemmaUnavailable, GEMMA_MODEL } from "@/lib/compass/llm/gemma";
import { loadPopulation, stratifiedSample, AGE_GROUP, DRIVES, type Resident } from "@/lib/compass/personas/population";
import { PERSONA_SYSTEM, residentBlock } from "@/lib/compass/personas/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATED = ["drive_less", "switch_to_transit", "walk_or_cycle_more", "no_change", "not_applicable"] as const;
type Stated = (typeof STATED)[number];

interface Reply {
  reaction: string;
  sentiment: number;
  stated_change: Stated;
}

const LOW_INCOME = /No Employed|Below \$1,000|\$1,000 - \$1,999|\$2,000 - \$2,999|\$3,000 - \$3,999/;

/**
 * Area reaction panel: a stratified sample of synthetic residents reacts to a simulated
 * plan. Their stated behaviour is compared with the engine's modelled mode shift — a
 * disagreement is an uncertainty signal, never an override of the model.
 */
export async function POST(req: NextRequest) {
  const { areaId, areaName, changes = [], summary = {}, carShareBaseline, n = 24, seed = 1 } = await req.json();
  let pop: Resident[];
  try {
    pop = await loadPopulation(areaId);
  } catch {
    return NextResponse.json({ error: `No synthetic population for ${areaName ?? areaId}.` }, { status: 404 });
  }
  const panel = stratifiedSample(pop, Math.min(40, Math.max(8, n)), seed);
  const pct = (x?: number) => (x == null ? "n/a" : `${(x * 100).toFixed(1)} pts`);
  const facts = [
    `Area: ${areaName}. Changes simulated for 2026–2036: ${changes.length ? changes.join("; ") : "none"}.`,
    `Engine results for the whole area (modelled, not a forecast):`,
    `- CO₂ avoided over 10 years: ${Math.round(summary.cumulativeCO2AvoidedTonnes ?? 0)} t`,
    `- Heat exposure on walking/cycling routes: −${(summary.heatExposureReducedPct ?? 0).toFixed(1)}%`,
    `- Change in share of trips: car ${pct(summary.modeShareChange?.car)}, bus ${pct(summary.modeShareChange?.bus)}, MRT ${pct(summary.modeShareChange?.mrt)}, walk ${pct(summary.modeShareChange?.walk)}, cycle ${pct(summary.modeShareChange?.cycle)}`,
    `- About ${Math.round(summary.tripsShiftedPerDay ?? 0)} trips a day change mode.`,
  ].join("\n");

  try {
    const res = await gemmaChat(
        [
          { role: "system", content: PERSONA_SYSTEM },
          {
            role: "user",
            content: `${panel.map(residentBlock).join("\n")}\n\n${facts}\n\nReact to this plan as EACH resident. Say what each would actually do differently. Return exactly ${panel.length} replies in the same order, copying each resident id.\nJSON: {"replies": [{"id": string, "reaction": string, "sentiment": integer -2..2, "stated_change": one of ${JSON.stringify(STATED)}}]}\nUse "not_applicable" if the resident doesn't commute.`,
          },
        ],
        { json: true, maxTokens: 8192, temperature: 0.7 }
      );
    const { replies } = parseJson<{ replies: (Reply & { id: string })[] }>(res.text);
    if (!Array.isArray(replies) || replies.length !== panel.length) throw new Error("Model returned an incomplete resident panel. Please try again.");
    const out = panel.map((r, i) => {
      const j = replies[i];
      if (j.id !== r.id || typeof j.reaction !== "string" || !j.reaction.trim() || !Number.isFinite(j.sentiment) || !(STATED as readonly string[]).includes(j.stated_change)) {
        throw new Error("Model returned an invalid resident reaction. Please try again.");
      }
      const stated = (STATED as readonly string[]).includes(j.stated_change) ? j.stated_change : "no_change";
      return { resident: r, reaction: j.reaction, sentiment: Math.max(-2, Math.min(2, Math.round(Number(j.sentiment) || 0))), stated_change: stated as Stated };
    });

    // Stated vs modelled: among drivers on the panel, what share say they'd drive less?
    const drivers = out.filter((x) => DRIVES(x.resident));
    const statedSwitch = drivers.length ? drivers.filter((x) => x.stated_change === "drive_less" || x.stated_change === "switch_to_transit").length / drivers.length : null;
    const dCar = summary.modeShareChange?.car;
    const modelledSwitch = dCar != null && carShareBaseline ? Math.max(0, -dCar / carShareBaseline) : null;
    const gap = statedSwitch != null && modelledSwitch != null ? statedSwitch - modelledSwitch : null;

    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const byGroup = (key: (r: Resident) => string) => {
      const m = new Map<string, number[]>();
      for (const x of out) (m.get(key(x.resident)) ?? m.set(key(x.resident), []).get(key(x.resident))!).push(x.sentiment);
      return [...m.entries()].map(([group, s]) => ({ group, n: s.length, sentiment: mean(s) })).sort((a, b) => a.group.localeCompare(b.group));
    };

    return NextResponse.json({
      panel: out,
      aggregate: {
        n: out.length,
        sentiment: mean(out.map((x) => x.sentiment)),
        byAge: byGroup((r) => AGE_GROUP(r.age)),
        byIncome: byGroup((r) => (LOW_INCOME.test(r.hh_income) ? "household < S$4k" : "household ≥ S$4k")),
        drivers: drivers.length,
        statedDriverSwitch: statedSwitch,
        modelledDriverSwitch: modelledSwitch,
        gap,
        flag: gap != null && Math.abs(gap) > 0.15 && drivers.length >= 4,
      },
      model: GEMMA_MODEL,
      note: "Synthetic residents (GHS 2025 sample) voiced by the configured model from the engine's results. Stated intentions usually overstate real behaviour change; the comparison is an uncertainty signal, not a correction.",
    });
  } catch (e: any) {
    const status = e instanceof GemmaUnavailable ? 503 : 500;
    return NextResponse.json({ error: e?.message ?? String(e) }, { status });
  }
}
