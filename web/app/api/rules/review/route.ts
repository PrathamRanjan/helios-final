import { NextRequest, NextResponse } from "next/server";
import { updateDrafts } from "@/lib/compass/compliance/drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Human review of a Gemma-drafted rule: approve, reject or reset, with an optional note. */
export async function POST(req: NextRequest) {
  const { id, status, note } = await req.json();
  if (!["approved", "rejected", "pending"].includes(status)) return NextResponse.json({ error: "bad status" }, { status: 400 });
  const d=await updateDrafts(drafts=>{
    const draft=drafts.find(x=>x.id===id);if(!draft)return null;
    draft.status=status;draft.note=note??draft.note;draft.reviewed=new Date().toISOString();return draft;
  });
  if(!d)return NextResponse.json({error:"not found"},{status:404});
  return NextResponse.json({ok:true,draft:d});
}
