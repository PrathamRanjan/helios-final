// HELIO Compliance evaluator — pure, deterministic.
//
//   evaluate(facts, rules, { asOf }) → Finding[]
//
// Each rule KIND has one evaluator below; rule DATA comes from JSON. Every
// finding carries the values compared, the margin to the threshold, the
// citation and the input confidence. Missing inputs → "needs_info", never a
// silent pass. Rules outside their effective window → "not_in_force".

import type {
  Comparison,
  EvaluateOptions,
  FactProvenance,
  Facts,
  Finding,
  Outcome,
  Rule,
} from "./types";

const PROVENANCE_RANK: FactProvenance[] = ["measured", "user_input", "modelled", "assumed"];

function num(f: Facts, k: string): number | undefined {
  const v = f[k];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function inWindow(asOf: string, from: string | null, to: string | null): boolean {
  return (!from || asOf >= from) && (!to || asOf <= to);
}

function weakest(keys: string[], prov: Record<string, FactProvenance> | undefined): FactProvenance {
  let worst = 0;
  for (const k of keys) {
    const p = prov?.[k] ?? "user_input";
    worst = Math.max(worst, PROVENANCE_RANK.indexOf(p));
  }
  return PROVENANCE_RANK[worst];
}

/** Does the rule's applies_to filter match these facts? Keys absent from facts don't exclude. */
function applies(rule: Rule, facts: Facts): { ok: boolean; why?: string } {
  for (const [key, allowed] of Object.entries(rule.applies_to)) {
    if (key === "asset" || key === "event" || key === "lifecycle") continue; // routing keys, handled by caller
    const v = facts[key];
    if (v === undefined || v === null) continue;
    const list = Array.isArray(allowed) ? allowed : [allowed];
    if (!list.includes(String(v))) return { ok: false, why: `${key} = ${v} (rule covers ${list.join(", ")})` };
  }
  return { ok: true };
}

function base(rule: Rule, asOf: string): Omit<Finding, "outcome" | "summary" | "comparisons" | "inputConfidence"> {
  return {
    ruleId: rule.id,
    title: rule.title,
    instrument: rule.instrument,
    category: rule.category,
    status: rule.status,
    citation: rule.citation,
    asOf,
    ruleConfidence: rule.review.confidence,
  };
}

function simple(rule: Rule, asOf: string, outcome: Outcome, summary: string, extra: Partial<Finding> = {}): Finding {
  return { ...base(rule, asOf), outcome, summary, comparisons: [], inputConfidence: "user_input", ...extra };
}

const fmt = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString("en-SG") : String(+n.toFixed(3)));
const sgd = (n: number) => `${n < 0 ? "−" : "+"}S$${Math.abs(Math.round(n)).toLocaleString("en-SG")}`;

// ---- kind: worst_band (VES) -------------------------------------------------

function evalWorstBand(rule: Rule, facts: Facts, opts: EvaluateOptions): Finding {
  const metrics = rule.metrics as Record<string, { label: string; unit: string }>;
  const bands = rule.bands as { band: string; max: Record<string, number> | null }[];
  const keys = Object.keys(metrics);
  const missing = keys.filter((k) => num(facts, k) === undefined);
  if (missing.length) {
    return simple(rule, opts.asOf, "needs_info", `Needs ${missing.map((k) => metrics[k].label).join(", ")} to determine the band.`, { missing });
  }

  // Band per pollutant = first (best) band whose limit it meets; overall = worst.
  let worstIdx = 0;
  let decidedBy = keys[0];
  for (const k of keys) {
    const v = num(facts, k)!;
    let idx = bands.findIndex((b) => b.max === null || v <= b.max[k]);
    if (idx < 0) idx = bands.length - 1;
    if (idx > worstIdx) {
      worstIdx = idx;
      decidedBy = k;
    }
  }
  const band = bands[worstIdx].band;

  const comparisons: Comparison[] = [];
  for (const k of keys) {
    const lim = bands[worstIdx].max?.[k];
    if (lim === undefined) continue;
    const v = num(facts, k)!;
    comparisons.push({ metric: k, label: metrics[k].label, unit: metrics[k].unit, value: v, threshold: lim, op: "<=", met: v <= lim, margin: lim - v });
  }

  const periods = (rule.amount_sgd as { periods: { from: string; to: string; by_band: Record<string, number> }[] }).periods;
  const period = periods.find((p) => inWindow(opts.asOf, p.from, p.to));
  const mult = (rule.multipliers as any)?.vehicle_class?.[String(facts.vehicle_class)] ?? 1;
  const amount = period ? period.by_band[band] * mult : undefined;

  // Next step: what would reach the next better band.
  let nextStep: string | undefined;
  if (worstIdx > 0) {
    const better = bands[worstIdx - 1];
    const gaps = keys
      .filter((k) => better.max && num(facts, k)! > better.max[k])
      .map((k) => `${metrics[k].label} ≤ ${better.max![k]} ${metrics[k].unit}`);
    const betterAmt = period ? period.by_band[better.band] * mult : undefined;
    nextStep = `Band ${better.band} needs ${gaps.join(", ")}${betterAmt !== undefined && amount !== undefined ? ` (saves S$${Math.round(amount - betterAmt).toLocaleString("en-SG")})` : ""}.`;
  }

  return {
    ...base(rule, opts.asOf),
    outcome: "info",
    tier: band,
    amountSgd: amount,
    summary: `VES Band ${band}${worstIdx > 0 ? ` (set by ${metrics[decidedBy].label})` : ""} → ${amount === undefined ? "no amount for this date" : amount === 0 ? "no rebate or surcharge" : `${sgd(amount)} ${amount < 0 ? "rebate" : "surcharge"}`}${mult !== 1 ? ` (×${mult} ${facts.vehicle_class})` : ""}.`,
    comparisons,
    nextStep,
    inputConfidence: weakest(keys, opts.provenance),
    derived: { ves_band: band },
  };
}

// ---- kind: capped_percentage (EEAI) ------------------------------------------

function evalCappedPercentage(rule: Rule, facts: Facts, opts: EvaluateOptions): Finding {
  const bm = rule.base_metric as { key: string; label: string; unit: string };
  const v = num(facts, bm.key);
  if (v === undefined) return simple(rule, opts.asOf, "needs_info", `Needs ${bm.label} (${bm.unit}).`, { missing: [bm.key] });
  const pct = rule.percentage as number;
  const cap = rule.cap_sgd as number;
  const raw = v * pct;
  const amount = (rule.sign as number) * Math.min(raw, cap);
  return {
    ...base(rule, opts.asOf),
    outcome: "info",
    amountSgd: amount,
    summary: `${Math.round(pct * 100)}% of ${bm.label} S$${Math.round(v).toLocaleString("en-SG")} = S$${Math.round(raw).toLocaleString("en-SG")}${raw > cap ? `, capped at S$${cap.toLocaleString("en-SG")}` : ""} → ${sgd(amount)} rebate.`,
    comparisons: [{ metric: bm.key, label: `${bm.label} × ${pct}`, unit: "S$", value: raw, threshold: cap, op: "<=", met: raw <= cap, margin: cap - raw }],
    inputConfidence: weakest([bm.key], opts.provenance),
  };
}

// ---- kind: tier_threshold (Green Mark EUI) -----------------------------------

/** EUI from raw energy facts when not given directly: on-site RE netted off, EV charging excluded. */
export function deriveEui(facts: Facts): number | undefined {
  const direct = num(facts, "eui_kwh_m2_yr");
  if (direct !== undefined) return direct;
  const kwh = num(facts, "annual_kwh");
  const gfa = num(facts, "gfa_m2");
  if (kwh === undefined || !gfa) return undefined;
  return (kwh - (num(facts, "onsite_re_kwh") ?? 0) - (num(facts, "ev_charging_kwh") ?? 0)) / gfa;
}

function evalTierThreshold(rule: Rule, facts: Facts, opts: EvaluateOptions): Finding {
  const metric = rule.metric as { key: string; label: string; unit: string; better: "lower" | "higher" };
  const tiers = (rule.tiers as { tier: string }[]).map((t) => t.tier);
  const table = rule.table as Record<string, { label: string; in_house: number[] | null; district: number[] | null; pathway1?: string }>;

  const bt = facts.building_type as string | undefined;
  const cooling = (facts.cooling_system as string | undefined) ?? undefined;
  const missing: string[] = [];
  if (!bt) missing.push("building_type");
  if (!cooling) missing.push("cooling_system");
  const eui = deriveEui(facts);
  if (eui === undefined) missing.push("eui_kwh_m2_yr (or annual_kwh + gfa_m2)");
  if (!bt || !cooling) return simple(rule, opts.asOf, "needs_info", "Needs building type and cooling system.", { missing });

  const row = table[bt];
  if (!row) return simple(rule, opts.asOf, "not_applicable", `No Green Mark EUI benchmark for building type "${bt}".`);
  const limits = cooling === "district" ? row.district : row.in_house;
  if (!limits) {
    return simple(rule, opts.asOf, "not_applicable", `${row.label}: ${row.pathway1 ?? `no EUI benchmark for ${cooling === "district" ? "district-cooled" : "in-house cooled"} buildings`}.`);
  }
  if (eui === undefined) return simple(rule, opts.asOf, "needs_info", "Needs measured EUI, or annual kWh and GFA.", { missing });

  const lower = metric.better === "lower";
  const meets = (lim: number) => (lower ? eui <= lim : eui >= lim);
  let best = -1;
  limits.forEach((lim, i) => {
    if (meets(lim)) best = i;
  });

  const comparisons: Comparison[] = limits.map((lim, i) => ({
    metric: metric.key,
    label: `${metric.label} — ${tiers[i]}`,
    unit: metric.unit,
    value: +eui.toFixed(1),
    threshold: lim,
    op: lower ? "<=" : ">=",
    met: meets(lim),
    margin: +(lower ? lim - eui : eui - lim).toFixed(1),
  }));

  const next = best + 1 < limits.length ? { tier: tiers[best + 1], lim: limits[best + 1] } : undefined;
  const gap = next ? Math.abs(eui - next.lim) : 0;
  const gfa = num(facts, "gfa_m2");
  const nextStep = next
    ? `${next.tier} needs EUI ≤ ${next.lim} ${metric.unit}: cut ${fmt(gap)} ${metric.unit}` +
      (gfa ? ` ≈ ${Math.round(gap * gfa).toLocaleString("en-SG")} kWh/yr (e.g. ~${Math.round((gap * gfa) / 1200).toLocaleString("en-SG")} kWp of on-site solar at 1,200 kWh/kWp).` : ".")
    : undefined;

  const tier = best >= 0 ? tiers[best] : undefined;
  return {
    ...base(rule, opts.asOf),
    outcome: best >= 0 ? "pass" : "fail",
    tier,
    summary:
      best >= 0
        ? `EUI ${fmt(eui)} ≤ ${limits[best]} → Green Mark ${tier} (${row.label}, ${cooling === "district" ? "district cooling" : "in-house cooling"}).`
        : `EUI ${fmt(eui)} is above the Gold limit of ${limits[0]} ${metric.unit} — does not reach any Green Mark rating.`,
    comparisons,
    nextStep,
    inputConfidence: weakest(num(facts, "eui_kwh_m2_yr") !== undefined ? ["eui_kwh_m2_yr"] : ["annual_kwh", "gfa_m2", "onsite_re_kwh"].filter((k) => facts[k] !== undefined), opts.provenance),
    derived: { gm_eui_tier: tier ?? "below_gold" },
  };
}

// ---- kind: energy_label (SLE / ZE / PE) --------------------------------------

function evalEnergyLabel(rule: Rule, facts: Facts, opts: EvaluateOptions): Finding {
  const sle = rule.sle as { min_savings_vs_2005: number; or_tier_from_rule: { tier: string } };
  const ze = rule.ze as { min_renewable_share: number };
  const pe = rule.pe as { min_onsite_renewable_share: number };

  const savings = num(facts, "energy_savings_vs_2005");
  const viaTier = facts.gm_eui_tier === sle.or_tier_from_rule.tier;
  if (savings === undefined && !facts.gm_eui_tier) {
    return simple(rule, opts.asOf, "needs_info", "Needs energy savings vs 2005 (or a Green Mark EUI result) to test SLE.", { missing: ["energy_savings_vs_2005"] });
  }
  const comparisons: Comparison[] = [];
  if (savings !== undefined) {
    comparisons.push({ metric: "energy_savings_vs_2005", label: "Energy savings vs 2005 (SLE)", unit: "", value: savings, threshold: sle.min_savings_vs_2005, op: ">=", met: savings >= sle.min_savings_vs_2005, margin: +(savings - sle.min_savings_vs_2005).toFixed(3) });
  }
  const isSle = viaTier || (savings !== undefined && savings >= sle.min_savings_vs_2005);
  if (!isSle) {
    return {
      ...base(rule, opts.asOf),
      outcome: "fail",
      summary:
        savings === undefined
          ? `Not Super Low Energy: the EUI ${facts.gm_eui_tier === "below_gold" ? "does not reach any Green Mark rating" : `reaches Green Mark ${facts.gm_eui_tier}`}, not the SLE column. Renewables alone can't earn ZE/PE without SLE efficiency first.`
          : `Not Super Low Energy: needs ≥${Math.round(sle.min_savings_vs_2005 * 100)}% savings vs 2005 (has ${Math.round(savings * 100)}%). Renewables alone can't earn ZE/PE without SLE efficiency first.`,
      comparisons,
      nextStep: "Reach SLE efficiency first (Green Mark EUI SLE column), then add renewables for ZE/PE.",
      inputConfidence: weakest(["energy_savings_vs_2005", "gm_eui_tier"].filter((k) => facts[k] !== undefined), opts.provenance),
    };
  }

  const onsite = num(facts, "onsite_renewable_share") ?? 0;
  const total = Math.max(num(facts, "renewable_share") ?? 0, onsite);
  comparisons.push(
    { metric: "renewable_share", label: "Renewable share (ZE)", unit: "", value: total, threshold: ze.min_renewable_share, op: ">=", met: total >= ze.min_renewable_share, margin: +(total - ze.min_renewable_share).toFixed(3) },
    { metric: "onsite_renewable_share", label: "On-site renewable share (PE)", unit: "", value: onsite, threshold: pe.min_onsite_renewable_share, op: ">=", met: onsite >= pe.min_onsite_renewable_share, margin: +(onsite - pe.min_onsite_renewable_share).toFixed(3) },
  );
  const tier = onsite >= pe.min_onsite_renewable_share ? "PE" : total >= ze.min_renewable_share ? "ZE" : "SLE";
  const nextStep =
    tier === "SLE"
      ? `ZE needs ${Math.round(ze.min_renewable_share * 100)}% renewable supply (has ${Math.round(total * 100)}%).`
      : tier === "ZE"
        ? `PE needs ${Math.round(pe.min_onsite_renewable_share * 100)}% from on-site renewables (has ${Math.round(onsite * 100)}%).`
        : undefined;
  return {
    ...base(rule, opts.asOf),
    outcome: "pass",
    tier,
    summary: `${tier === "PE" ? "Positive Energy" : tier === "ZE" ? "Zero Energy" : "Super Low Energy"} building${viaTier && savings === undefined ? " (SLE via EUI)" : ""}.`,
    comparisons,
    nextStep,
    inputConfidence: weakest(["energy_savings_vs_2005", "renewable_share", "onsite_renewable_share", "gm_eui_tier"].filter((k) => facts[k] !== undefined), opts.provenance),
    derived: { gm_energy_label: tier },
  };
}


// ---- kind: rate_schedule (carbon tax) ------------------------------------------

function evalRateSchedule(rule: Rule, facts: Facts, opts: EvaluateOptions): Finding {
  const metric = rule.metric as { key: string; label: string; unit: string };
  const t = num(facts, metric.key);
  if (t === undefined) return simple(rule, opts.asOf, "needs_info", `Needs ${metric.label} (${metric.unit}).`, { missing: [metric.key] });
  const year = num(facts, (rule.year_fact as string) ?? "emissions_year") ?? Number(opts.asOf.slice(0, 4));
  const rates = rule.rates as { from_year: number; to_year: number | null; sgd_per_t: number; range?: [number, number] }[];
  const r = rates.find((x) => year >= x.from_year && (x.to_year == null || year <= x.to_year));
  const th = rule.thresholds as { reporting_tco2e: number; taxable_tco2e: number };
  if (t < th.reporting_tco2e) return simple(rule, opts.asOf, "not_applicable", `${fmt(t)} tCO₂e is below the ${fmt(th.reporting_tco2e)} t reporting threshold.`);
  if (!r) return simple(rule, opts.asOf, "not_in_force", `No carbon tax rate set for emissions year ${year}.`);
  const taxable = t >= th.taxable_tco2e;
  const amount = taxable ? t * r.sgd_per_t : 0;
  return {
    ...base(rule, opts.asOf),
    outcome: "info",
    tier: taxable ? "taxable" : "reporting only",
    amountSgd: amount,
    summary: taxable
      ? `${fmt(t)} tCO₂e × S$${r.sgd_per_t}/t (${year}${r.range ? `, range S$${r.range[0]}–${r.range[1]}` : ""}) → S$${Math.round(amount).toLocaleString("en-SG")} carbon tax.`
      : `${fmt(t)} tCO₂e: must register and report (≥${fmt(th.reporting_tco2e)} t) but below the ${fmt(th.taxable_tco2e)} t taxable threshold.`,
    comparisons: [
      { metric: metric.key, label: "Taxable threshold", unit: "tCO₂e", value: t, threshold: th.taxable_tco2e, op: ">=", met: taxable, margin: t - th.taxable_tco2e },
    ],
    inputConfidence: weakest([metric.key], opts.provenance),
    derived: { carbon_tax_sgd: amount },
  };
}

// ---- kind: trigger_requirement (EV Charging Act) ---------------------------------

type Test = { key: string; label: string; test: "is_true" | ">=" | ">" | "<" | "<=" | "=="; value?: number; requires?: string; exempts?: string };

function passes(t: Test, facts: Facts): boolean | undefined {
  const v = facts[t.key];
  if (v === undefined || v === null) return undefined;
  if (t.requires && facts[t.requires] === false) return false;
  if (t.test === "is_true") return v === true;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return t.test === ">=" ? n >= t.value! : t.test === ">" ? n > t.value! : t.test === "<" ? n < t.value! : t.test === "<=" ? n <= t.value! : n === t.value;
}

function evalTriggerRequirement(rule: Rule, facts: Facts, opts: EvaluateOptions): Finding {
  const triggers = rule.triggers as Test[];
  const exemptions = rule.exemptions as Test[];
  const obligations = rule.obligations as Record<string, string[]>;
  const results = triggers.map((t) => ({ t, r: passes(t, facts) }));
  const hit = results.filter((x) => x.r === true);
  if (!hit.length) {
    const unknown = results.filter((x) => x.r === undefined);
    return unknown.length === results.length
      ? simple(rule, opts.asOf, "needs_info", `Needs the type of works: ${triggers.map((t) => t.label.toLowerCase()).join("; ")}.`, { missing: triggers.map((t) => t.key) })
      : simple(rule, opts.asOf, "not_applicable", "These works are not 'defined works' under the Act — no EV charging obligation.");
  }
  const exAll = exemptions.find((e) => e.exempts === "all" && passes(e, facts) === true);
  if (exAll) return simple(rule, opts.asOf, "not_applicable", `Exempt: ${exAll.label}.`);
  const exPoints = exemptions.find((e) => e.exempts === "charging_points" && passes(e, facts) === true);
  const scope = exPoints ? "load_only" : "all";
  const planned = facts.ev_provision_planned === true;
  return {
    ...base(rule, opts.asOf),
    outcome: planned ? "pass" : "fail",
    tier: scope,
    summary: `Triggered by: ${hit.map((h) => h.t.label.toLowerCase()).join(", ")}. ${planned ? "EV provision is in the plan." : "Must provide EV charging"}${exPoints ? " (electrical load only — fewer than 8 lots)" : ""}${planned ? "" : "."}`,
    comparisons: [],
    nextStep: [...(obligations[scope] ?? []), String(rule.missing ?? "")].filter(Boolean).join(" · "),
    inputConfidence: weakest(hit.map((h) => h.t.key), opts.provenance),
  };
}

// ---- kind: taxonomy_class (Singapore-Asia Taxonomy) -------------------------------

type Crit = { always?: boolean; fact?: string; test?: Test["test"]; value?: number; why: string; sunset?: string };

function evalTaxonomyClass(rule: Rule, facts: Facts, opts: EvaluateOptions): Finding {
  const acts = rule.activities as Record<string, { label: string; page: number; green?: Crit[]; amber?: Crit[]; amber_note?: string }>;
  const a = facts.activity as string | undefined;
  if (!a) return simple(rule, opts.asOf, "needs_info", "Needs the activity type.", { missing: ["activity"] });
  const act = acts[a];
  if (!act) return simple(rule, opts.asOf, "not_applicable", `No HELIOS mapping for activity "${a}" in the taxonomy yet.`);
  const check = (c: Crit) => (c.always ? true : passes({ key: c.fact!, label: c.why, test: c.test!, value: c.value }, facts));
  const cite = { ...rule.citation, clause: act.label, pages: [act.page] };
  const make = (tier: "Green" | "Amber" | "Ineligible", why: string, outcome: Finding["outcome"]): Finding => ({
    ...base(rule, opts.asOf),
    citation: cite,
    outcome,
    tier,
    summary: `${act.label}: ${tier}${why ? ` — ${why}` : ""}.`,
    comparisons: [],
    inputConfidence: weakest([...(act.green ?? []), ...(act.amber ?? [])].map((c) => c.fact).filter(Boolean) as string[], opts.provenance),
    derived: { sat_tier: tier },
  });
  const g = (act.green ?? []).find((c) => check(c) === true);
  if (g) return make("Green", g.why, "pass");
  const liveAmber = (act.amber ?? []).filter((c) => !c.sunset || opts.asOf <= c.sunset);
  const am = liveAmber.find((c) => check(c) === true);
  if (am) return { ...make("Amber", `${am.why}${am.sunset ? ` (until ${am.sunset.slice(0, 4)})` : ""}`, "pass"), nextStep: `Green needs: ${(act.green ?? []).map((c) => c.why).join(" or ")}.` };
  const unknown = [...(act.green ?? []), ...liveAmber].filter((c) => check(c) === undefined);
  if (unknown.length) return { ...simple(rule, opts.asOf, "needs_info", `${act.label}: needs ${unknown.map((c) => c.fact).join(", ")} to classify.`, { missing: unknown.map((c) => c.fact!) }), citation: cite };
  return { ...make("Ineligible", act.amber_note ?? "meets neither Green nor Amber criteria", "fail"), nextStep: `Green needs: ${(act.green ?? []).map((c) => c.why).join(" or ")}.` };
}

// ---- kind: disclosure_schedule (climate reporting roadmap) ------------------------

function evalDisclosureSchedule(rule: Rule, facts: Facts, opts: EvaluateOptions): Finding {
  const types = rule.entity_types as Record<string, string>;
  const items = rule.items as Record<string, { label: string; start_fy: Record<string, number>; voluntary_for?: string[] }>;
  const et = facts.entity_type as string | undefined;
  if (!et) return simple(rule, opts.asOf, "needs_info", `Needs the owner type: ${Object.values(types).join(" / ")}.`, { missing: ["entity_type"] });
  if (et === "other" || !types[et]) return simple(rule, opts.asOf, "not_applicable", `${types[et] ?? et}: no mandatory climate reporting under the roadmap.`);
  const fy = num(facts, "financial_year") ?? Number(opts.asOf.slice(0, 4));
  const now = Object.values(items).filter((i) => i.start_fy[et] != null && i.start_fy[et] <= fy);
  const later = Object.values(items).filter((i) => i.start_fy[et] != null && i.start_fy[et] > fy).sort((x, y) => x.start_fy[et] - y.start_fy[et]);
  const voluntary = Object.values(items).filter((i) => i.voluntary_for?.includes(et));
  return {
    ...base(rule, opts.asOf),
    outcome: "info",
    tier: `${now.length} items`,
    summary: `${types[et]}, FY${fy}: ${now.length ? `must disclose ${now.map((i) => i.label).join("; ")}` : "no mandatory climate disclosures yet"}.`,
    comparisons: [],
    nextStep: [later.length ? `Coming: ${later.map((i) => `${i.label} from FY${i.start_fy[et]}`).join("; ")}` : "", voluntary.length ? `Voluntary: ${voluntary.map((i) => i.label).join("; ")}` : ""].filter(Boolean).join(" · ") || undefined,
    inputConfidence: weakest(["entity_type"], opts.provenance),
    derived: { mandatory_disclosures: now.length },
  };
}

// ---- dispatcher ----------------------------------------------------------------

const KINDS: Record<Rule["kind"], (r: Rule, f: Facts, o: EvaluateOptions) => Finding> = {
  worst_band: evalWorstBand,
  capped_percentage: evalCappedPercentage,
  tier_threshold: evalTierThreshold,
  energy_label: evalEnergyLabel,
  rate_schedule: evalRateSchedule,
  trigger_requirement: evalTriggerRequirement,
  taxonomy_class: evalTaxonomyClass,
  disclosure_schedule: evalDisclosureSchedule,
};

export function evaluateRule(rule: Rule, facts: Facts, opts: EvaluateOptions): Finding {
  if (!opts.includeDraft && (rule.status === "draft" || rule.status === "proposed")) {
    return simple(rule, opts.asOf, "not_in_force", `${rule.status === "draft" ? "Draft" : "Proposed"} rule — shown only in the policy what-if view.`);
  }
  if (!inWindow(opts.asOf, rule.effective_from, rule.effective_to)) {
    const when = opts.asOf < rule.effective_from ? `starts ${rule.effective_from}` : `ended ${rule.effective_to}`;
    return simple(rule, opts.asOf, "not_in_force", `Not in force on ${opts.asOf} (${when}).`);
  }
  const a = applies(rule, facts);
  if (!a.ok) return simple(rule, opts.asOf, "not_applicable", `Does not apply: ${a.why}.`);
  const fn = KINDS[rule.kind];
  if (!fn) return simple(rule, opts.asOf, "needs_info", `Unknown rule kind "${rule.kind}".`);
  return fn(rule, facts, opts);
}

/** Evaluate rules in order; derived facts from earlier findings feed later rules. */
export function evaluate(facts: Facts, rules: Rule[], opts: EvaluateOptions): Finding[] {
  const working: Facts = { ...facts };
  const out: Finding[] = [];
  for (const rule of rules) {
    const f = evaluateRule(rule, working, opts);
    if (f.derived) Object.assign(working, f.derived);
    out.push(f);
  }
  return out;
}

/** Net S$ effect of cost findings, applying the EV $0 ARF floor when ARF is known. */
export function netCostSgd(findings: Finding[], facts: Facts, rules: Rule[], asOf: string): { netSgd: number; floored: boolean } {
  let net = findings.reduce((s, f) => s + (f.amountSgd ?? 0), 0);
  const arf = num(facts, "arf_sgd");
  let floored = false;
  if (arf !== undefined) {
    for (const r of rules) {
      const floor = r.arf_floor as { value_sgd: number; fuel: string[]; from: string; to: string } | undefined;
      if (floor && floor.fuel.includes(String(facts.fuel)) && inWindow(asOf, floor.from, floor.to) && arf + net < floor.value_sgd) {
        net = floor.value_sgd - arf;
        floored = true;
      }
    }
  }
  return { netSgd: net, floored };
}
