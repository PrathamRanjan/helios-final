// Rule registry — every rule JSON in data/compliance/rules is imported here.
// Order matters: rules that emit derived facts (Green Mark EUI → gm_eui_tier)
// must come before rules that read them (SLE/ZE/PE labels).

import type { Rule } from "./types";
import ves from "@/data/compliance/rules/sg_ves_2026_2027.json";
import eeai from "@/data/compliance/rules/sg_eeai_2026.json";
import gmEui from "@/data/compliance/rules/sg_greenmark_2021_eui.json";
import gmLabels from "@/data/compliance/rules/sg_greenmark_2021_energy_labels.json";
import carbonTax from "@/data/compliance/rules/sg_carbon_tax_cpa2018.json";
import carbonTax2030 from "@/data/compliance/rules/sg_carbon_tax_2030_proposed.json";
import evca from "@/data/compliance/rules/sg_evca2022_defined_works.json";
import sat from "@/data/compliance/rules/sg_sat2023_activities.json";
import reporting from "@/data/compliance/rules/sg_climate_reporting_roadmap.json";
import sourcesJson from "@/data/compliance/sources.json";

export const RULES: Rule[] = [ves, eeai, gmEui, gmLabels, carbonTax, carbonTax2030, evca, sat, reporting] as unknown as Rule[];

export interface SourceDoc {
  title: string;
  issuer: string;
  url: string;
  file: string;
  published: string | null;
  retrieved: string;
  kind: string;
  licence: string;
  note?: string;
}

export const SOURCES = (sourcesJson as { sources: Record<string, SourceDoc> }).sources;

export function ruleById(id: string): Rule | undefined {
  return RULES.find((r) => r.id === id);
}

/** Rules relevant to an asset type ("vehicle" | "building" | …). */
export function rulesForAsset(asset: string): Rule[] {
  return RULES.filter((r) => {
    const a = r.applies_to.asset;
    return Array.isArray(a) ? a.includes(asset) : a === asset;
  });
}
