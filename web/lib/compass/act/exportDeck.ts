// Export the decision brief as a real PowerPoint (.pptx). Runs in the browser,
// generates and downloads a self-contained file — no external calls, demo-safe.
// The planner walks out of the demo with a committee-ready deck.

import type { DecisionBrief } from "./decisionBrief";
import { formatMoney, type CurrencyCode } from "@/lib/compass/finance/currency";
import calib from "@/data/assumptions/calibration.json";

const BG = "0F1117";
const ACCENT = "FFD24A";
const WHITE = "FFFFFF";
const MUTED = "9AA0A6";
const GREEN = "34D399";

/** Extra decision data computed in the panel, folded into the deck. */
export interface DeckExtras {
  verdictHeadline: string;
  verdictReasons: string[];
  verdictConditions: string[];
  socialNpvUsd: number;
  cashNpvUsd: number;
  cashPaybackYear: number | null;
  mcCo2Low: number;
  mcCo2High: number;
  mcProbPositive: number;
  gridHeadline: string;
  materialTonnes: number;
  recyclablePct: number;
  cradleToGraveTonnes: number;
  fleetSummary: string | null;
}

export async function exportDecisionDeck(brief: DecisionBrief, currency: CurrencyCode, extras?: DeckExtras) {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "HELIO", width: 13.33, height: 7.5 });
  pptx.layout = "HELIO";
  const money = (usd: number) => formatMoney(usd, currency);
  const h = brief.headline;

  const dark = (s: any) => { s.background = { color: BG }; };

  // 1 — Title / decision
  let s = pptx.addSlide(); dark(s);
  s.addText("HELIO Flow — Decision Brief", { x: 0.6, y: 0.5, fontSize: 16, color: ACCENT, bold: true });
  const title = extras?.verdictHeadline
    ? `${extras.verdictHeadline} — ${money(h.co2Tonnes)} t CO₂ avoided over 10 years`
    : `Fund this package — ${money(h.co2Tonnes)} t CO₂ avoided over 10 years`;
  s.addText(title, { x: 0.6, y: 1.3, w: 12, fontSize: 28, color: WHITE, bold: true });
  if (extras?.verdictReasons.length) {
    s.addText(extras.verdictReasons.join("  ·  "), { x: 0.6, y: 2.5, w: 12, fontSize: 12, color: GREEN });
  }
  const cards: [string, string, string][] = [
    ["Net cost (after grants)", money(h.netCapexAfterGrantsUsd), `gross ${money(h.capexUsd)}`],
    ["Net CO₂ (after embodied)", `${money(h.netCo2Tonnes)} t`, "lifecycle"],
    ["Cost per tonne", h.costPerTonneUsd !== null ? money(h.costPerTonneUsd) : "—", "vs carbon tax"],
    ["Cash payback", h.moneyPaybackYear ? String(h.moneyPaybackYear) : "public-good", h.moneyPaybackYear ? "self-funds" : "co-benefit"],
  ];
  cards.forEach(([label, val, sub], i) => {
    const x = 0.6 + i * 3.05;
    s.addText(label, { x, y: 3.2, w: 2.9, fontSize: 10, color: MUTED });
    s.addText(val, { x, y: 3.5, w: 2.9, fontSize: 24, color: WHITE, bold: true });
    s.addText(sub, { x, y: 4.2, w: 2.9, fontSize: 9, color: MUTED });
  });
  s.addText("Pre-feasibility decision support · measured data + labelled proxies", { x: 0.6, y: 6.9, fontSize: 9, color: MUTED });

  // 2 — Rollout
  s = pptx.addSlide(); dark(s);
  s.addText("Rollout plan", { x: 0.6, y: 0.5, fontSize: 22, color: ACCENT, bold: true });
  brief.rollout.forEach((p, i) => {
    const x = 0.6 + i * 3.0;
    s.addText(String(p.year), { x, y: 1.6, w: 2.8, fontSize: 22, color: ACCENT, bold: true });
    s.addText(p.items.join("\n"), { x, y: 2.2, w: 2.8, fontSize: 12, color: WHITE });
  });

  // 3 — Funding, suppliers, procurement
  s = pptx.addSlide(); dark(s);
  s.addText("Funding & procurement", { x: 0.6, y: 0.5, fontSize: 22, color: ACCENT, bold: true });
  s.addText("Grants", { x: 0.6, y: 1.4, fontSize: 12, color: MUTED, bold: true });
  s.addText(
    brief.grants.map((g) => `• ${g.name}${g.offsetUsd > 0 ? ` (−${money(g.offsetUsd)})` : ""}`).join("\n"),
    { x: 0.6, y: 1.8, w: 6, fontSize: 12, color: WHITE }
  );
  s.addText("Suppliers & builders", { x: 7, y: 1.4, fontSize: 12, color: MUTED, bold: true });
  s.addText(
    brief.suppliers.slice(0, 8).map((sup) => `• ${sup.name}${sup.circular.length ? " ♻" : ""} — ${sup.type}`).join("\n"),
    { x: 7, y: 1.8, w: 6, fontSize: 11, color: WHITE }
  );
  s.addText("Procurement readiness", { x: 0.6, y: 4.6, fontSize: 12, color: MUTED, bold: true });
  s.addText(
    brief.procurement.map((p) => `• ${p.kind.replace("_", " ")}: land ${p.land}; permit ${p.permit}`).join("\n"),
    { x: 0.6, y: 5.0, w: 12, fontSize: 10, color: MUTED }
  );

  // 4 — Risks + SDG + monitoring
  s = pptx.addSlide(); dark(s);
  s.addText("Risks, alignment & monitoring", { x: 0.6, y: 0.5, fontSize: 22, color: ACCENT, bold: true });
  s.addText("Risks to manage", { x: 0.6, y: 1.4, fontSize: 12, color: MUTED, bold: true });
  s.addText(
    brief.risks.length ? brief.risks.map((r) => `• ${r.label} — ${r.detail}`).join("\n") : "• None flagged",
    { x: 0.6, y: 1.8, w: 12, fontSize: 11, color: WHITE }
  );
  s.addText("SDG alignment", { x: 0.6, y: 3.8, fontSize: 12, color: MUTED, bold: true });
  s.addText(brief.sdgs.map((g) => `SDG ${g.goal} ${g.label}`).join("   ·   "), { x: 0.6, y: 4.2, w: 12, fontSize: 12, color: GREEN });
  s.addText("Impact you'll verify", { x: 0.6, y: 5.0, fontSize: 12, color: MUTED, bold: true });
  s.addText(brief.monitoring.map((m) => `• ${m}`).join("\n"), { x: 0.6, y: 5.4, w: 12, fontSize: 11, color: WHITE });

  // 4b — Value, confidence, materials & grid (only if the panel supplied them)
  if (extras) {
    s = pptx.addSlide(); dark(s);
    s.addText("Value, confidence & lifecycle", { x: 0.6, y: 0.5, fontSize: 22, color: ACCENT, bold: true });
    const rows: [string, string, string][] = [
      ["Social NPV (government)", money(extras.socialNpvUsd), "carbon + energy − cost, discounted"],
      ["Cash NPV (private operator)", money(extras.cashNpvUsd), extras.cashPaybackYear ? `cash payback ${extras.cashPaybackYear}` : "energy margin only — not cash-positive"],
      ["Net CO₂ confidence (P10–P90)", `${extras.mcCo2Low}–${extras.mcCo2High} t`, `${extras.mcProbPositive}% chance carbon-positive (Monte Carlo, 1,000 runs)`],
      ["Material & recyclability", `${extras.materialTonnes.toLocaleString()} t · ${extras.recyclablePct}% recyclable`, `cradle-to-grave ${extras.cradleToGraveTonnes} t CO₂`],
      ["Grid readiness", extras.gridHeadline, "screening — confirm with utility"],
    ];
    rows.forEach(([label, val, sub], i) => {
      const y = 1.5 + i * 1.05;
      s.addText(label, { x: 0.6, y, w: 4.2, fontSize: 12, color: MUTED, bold: true });
      s.addText(val, { x: 5, y, w: 7.5, fontSize: 14, color: WHITE, bold: true });
      s.addText(sub, { x: 5, y: y + 0.4, w: 7.5, fontSize: 10, color: MUTED });
    });
    if (extras.fleetSummary) {
      s.addText(`Fleet: ${extras.fleetSummary}`, { x: 0.6, y: 6.8, w: 12, fontSize: 10, color: GREEN });
    }
  }

  // 5 — Calibration against real SG data (paginated: 4 checks/slide so more
  // validation rows never overflow the slide).
  const checks = (calib as any).checks as { metric: string; model: string; measured: string; verdict: string }[];
  const PER_SLIDE = 4;
  const pages = Math.ceil(checks.length / PER_SLIDE);
  for (let p = 0; p < pages; p++) {
    s = pptx.addSlide(); dark(s);
    const title = pages > 1 ? `Validated on real Singapore data (${p + 1}/${pages})` : "Validated on real Singapore data";
    s.addText(title, { x: 0.6, y: 0.5, fontSize: 22, color: ACCENT, bold: true });
    s.addText("Model parameters checked against measured LTA / SolarNova / regional outcomes — validation, not just assumption.", { x: 0.6, y: 1.2, w: 12, fontSize: 12, color: MUTED });
    checks.slice(p * PER_SLIDE, (p + 1) * PER_SLIDE).forEach((c, i) => {
      const y = 1.9 + i * 1.4;
      s.addText(c.metric, { x: 0.6, y, w: 4, fontSize: 14, color: WHITE, bold: true });
      s.addText(`model ${c.model}   ·   measured ${c.measured}`, { x: 0.6, y: y + 0.45, w: 12, fontSize: 12, color: WHITE });
      s.addText(c.verdict, { x: 0.6, y: y + 0.85, w: 12, fontSize: 11, color: GREEN });
    });
  }

  await pptx.writeFile({ fileName: "HELIO_decision_brief.pptx" });
}
