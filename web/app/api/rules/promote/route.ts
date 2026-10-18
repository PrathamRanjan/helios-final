import { NextRequest, NextResponse } from "next/server";
import {writeObject} from "@/lib/cloud/storage";
import path from "path";
import { updateDrafts } from "@/lib/compass/compliance/drafts";
import { reconcileDraft, KIND_HINT, CANDIDATES_DIR } from "@/lib/compass/compliance/reconcile";
import { SOURCES } from "@/lib/compass/compliance/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);

/**
 * Promote an APPROVED draft into a candidate rule file (data/compliance/rules/candidates/).
 * Candidates are status "draft": the engine never loads them. A developer finishes the
 * mapping (rule kind, facts, ≥3 worked examples) and moves the file into rules/.
 */
export async function POST(req: NextRequest) {
  const { id } = await req.json();
  const result = await updateDrafts(drafts=>{
  const d = drafts.find((x) => x.id === id);
  if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (d.status !== "approved") return NextResponse.json({ error: "Only approved drafts can be promoted." }, { status: 400 });
  if (d.promotion) return d.promotion;
  const rec = reconcileDraft(d);
  if (rec.status === "matches_engine") return NextResponse.json({ error: `Already in the engine: ${rec.matches.map((m) => `${m.ruleId} → ${m.path}`).join(", ")}` }, { status: 409 });
  const sourceKey = Object.entries(SOURCES).find(([, s]) => s.file && s.file.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") === d.doc)?.[0] ?? null;
  const hint = KIND_HINT[d.kind] ?? { kind: null, how: "Map by hand." };
  const ruleId = `candidate.${d.doc}.p${d.page}.${slug(d.title)}`;
  const today = new Date().toISOString().slice(0, 10);
  const candidate = {
    id: ruleId,
    title: d.title,
    instrument: d.docTitle,
    jurisdiction: "SG",
    category: d.kind === "rate" ? "cost" : "law",
    kind: hint.kind ?? "unmapped",
    status: "draft",
    effective_from: d.effective_from ?? null,
    effective_to: null,
    applies_to: {},
    citation: { source: sourceKey ?? d.doc, clause: `p.${d.page}`, pages: [d.page], quote: d.quote },
    draft_value: { metric: d.metric ?? null, operator: d.operator ?? null, value: d.value ?? null, unit: d.unit ?? null, applies_to: d.applies_to ?? null },
    todo: [hint.how, "Set applies_to and the fact keys the rule reads.", "Write at least 3 worked examples (they become tests).", "Human sign-off, then move this file into data/compliance/rules/ and register it in rules.ts."],
    related_rules: rec.sameDocRules,
    examples: [],
    review: {
      confidence: "draft",
      reviewed_by: `gemma-4 (drafted${d.quote_verified ? ", quote verified on page" : ", QUOTE NOT VERIFIED"}); approved in rules desk`,
      reviewed_at: today,
    },
    from_draft: d.id,
  };
  const file = path.join(CANDIDATES_DIR, `${slug(`${d.doc}_p${d.page}_${d.title}`)}.json`);
  // Commit the export payload with approval before performing any retryable side effect.
  d.promotion = { file: path.basename(file), candidate };
  d.note = `promoted → ${path.relative(process.cwd(), file)}`;
  return d.promotion;
  });
  if (result instanceof NextResponse) return result;
  // A failed export retains its committed payload so a retry can safely finish it.
  const file = path.join(CANDIDATES_DIR, result.file);
  await writeObject(`rules/candidates/${result.file}`, file, JSON.stringify(result.candidate,null,2)+"\n", "application/json");
  return NextResponse.json({ok:true,file:process.env.HELIOS_STORAGE_BUCKET ? `rules/candidates/${result.file}` : path.relative(process.cwd(),file),candidate:result.candidate});
}
