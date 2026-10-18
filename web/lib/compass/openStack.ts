// HELIOS's purpose as data: which paid sustainability products each capability
// replaces, and the open datasets it is built from (data/open_stack.json).

import stack from "@/data/open_stack.json";

export type CapabilityId = (typeof stack.capabilities)[number]["id"];

export interface Replaced {
  vendor: string;
  price: string;
  basis: "list" | "third_party" | "not_published";
  source: string | null;
}

export interface Capability {
  id: string;
  name: string;
  what: string;
  replaces: Replaced[];
  datasets: string[];
  status: "built" | "partial";
  out_of_reach: string;
  where: { label: string; href: string };
}

export interface OpenDataset {
  name: string;
  publisher: string;
  url: string;
  licence: string;
  refresh: string;
}

export const THESIS = stack.thesis;
export const CAPABILITIES = stack.capabilities as Capability[];
export const DATASETS = stack.datasets as Record<string, OpenDataset>;
export const MOATS = stack.moats;

export const capability = (id: string) => CAPABILITIES.find((c) => c.id === id);

/** One-line provenance for exports: what this replaces and what it was built from. */
export function provenanceLine(id: string): string {
  const c = capability(id);
  if (!c) return "";
  const pubs = [...new Set(c.datasets.map((d) => DATASETS[d]?.publisher).filter(Boolean))];
  return `Built with HELIOS from open data (${pubs.join(", ")}) — no paid data licences. Replaces: ${c.replaces.map((r) => `${r.vendor} (${r.price})`).join("; ")}.`;
}
