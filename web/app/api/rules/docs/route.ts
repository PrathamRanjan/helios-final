import { NextResponse } from "next/server";
import { listDocs, readDrafts } from "@/lib/compass/compliance/drafts";
import { reconcileDraft, KIND_HINT } from "@/lib/compass/compliance/reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const docs=await listDocs();
  // Each draft is checked against the hand-built engine rules (two independent readings of the law).
  const drafts = (await readDrafts()).map((d) => ({ ...d, engine: reconcileDraft(d), hint: KIND_HINT[d.kind]?.how }));
  return NextResponse.json({ docs: docs.sort((a, b) => a.title.localeCompare(b.title)), drafts, sourceStatus: docs.length ? "available" : "missing", notice: docs.length ? null : "Policy source pages are not installed; document drafting is unavailable until authorised extracts are uploaded." });
}
