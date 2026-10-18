// Server-only: rule drafts proposed by local Gemma from policy documents, awaiting
// human review. Drafts never change engine verdicts — approved ones are the queue a
// developer maps into data/compliance/rules/*.json (with a rule kind + examples).

import {readObject,mutateJson,listObjects} from "@/lib/cloud/storage";
import path from "path";

export const PAGES_DIR = path.join(process.cwd(), "..", "policy_sources", "pages"); // gitignored source docs
export const DRAFTS_FILE = path.join(process.cwd(), "data", "compliance", "drafts.json");

export interface Draft {
  id: string;
  doc: string; // slug
  docTitle: string;
  page: number;
  title: string;
  kind: "threshold" | "rate" | "date" | "requirement" | "exemption" | "definition";
  metric?: string;
  operator?: string;
  value?: number | string | null;
  unit?: string;
  applies_to?: string;
  effective_from?: string | null;
  quote: string;
  quote_verified: boolean;
  status: "pending" | "approved" | "rejected";
  note?: string;
  promotion?: { file: string; candidate: Record<string, unknown> };
  created: string;
  reviewed?: string;
}

const EMPTY = {_note:"Human-reviewed rule candidates; not active engine rules.",drafts:[] as Draft[]};
function checkedDrafts(data:any):Draft[]{if(!Array.isArray(data?.drafts))throw new Error("Invalid saved rule drafts.");return data.drafts;}
export async function readDrafts(): Promise<Draft[]> {
  const bytes=await readObject("rules/drafts.json",DRAFTS_FILE);
  return bytes?checkedDrafts(JSON.parse(bytes.toString())):[];
}
export async function updateDrafts<R>(mutate:(drafts:Draft[])=>R|Promise<R>):Promise<R>{
  return mutateJson("rules/drafts.json",DRAFTS_FILE,EMPTY,data=>mutate(checkedDrafts(data)));
}
export async function readDoc(slug: string): Promise<{ title: string; file: string; pages: { page: number; text: string }[] }> {
  if (!/^[a-z0-9_]+$/.test(slug)) throw new Error("bad doc");
  const bytes=await readObject(`policy-pages/${slug}.json`,path.join(process.env.HELIOS_POLICY_PAGES_DIR||PAGES_DIR,`${slug}.json`));
  if(!bytes)throw Object.assign(new Error("Document pages not found. Upload authorised policy-page extracts."),{code:404});
  const doc=JSON.parse(bytes.toString());
  if(typeof doc.title!=="string"||!Array.isArray(doc.pages))throw new Error("Invalid policy page document.");
  return doc;
}
export async function listDocs(){
  const files=await listObjects("policy-pages/",process.env.HELIOS_POLICY_PAGES_DIR||PAGES_DIR);
  return Promise.all(files.filter(f=>/^[a-z0-9_]+\.json$/.test(f)).map(async f=>{const slug=f.slice(0,-5),doc=await readDoc(slug);return {slug,title:doc.title,pages:doc.pages.length};}));
}

/** Whitespace/case-insensitive containment — PDF text often loses spaces. */
export const squash = (s: string) => s.toLowerCase().replace(/[\s ]+/g, "").replace(/[“”"']/g, "").replace(/[—–]/g, "-");
