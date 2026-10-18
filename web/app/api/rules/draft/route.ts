import { NextRequest, NextResponse } from "next/server";
import { gemmaChat, parseJson, pool, GemmaUnavailable } from "@/lib/compass/llm/gemma";
import { readDoc, updateDrafts, squash, type Draft } from "@/lib/compass/compliance/drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = `You extract checkable rules from Singapore laws, standards and policy papers for HELIOS, an urban sustainability decision engine.
Only extract statements a computer could check: numeric thresholds, rates, dates, scope/applicability conditions, exemptions, key definitions.
Each candidate MUST include "quote": an exact, verbatim sentence or clause copied from the page (no paraphrase).
Skip penalties, procedures and administrative detail unless they set a number or date that affects a planning decision.
Reply with JSON only: {"candidates": [{"title": string, "kind": "threshold"|"rate"|"date"|"requirement"|"exemption"|"definition", "metric": string|null, "operator": string|null, "value": number|string|null, "unit": string|null, "applies_to": string|null, "effective_from": string|null, "quote": string}]}. Return {"candidates": []} if the page has nothing checkable.`;

/** Draft rule candidates from a page range with local Gemma; quotes are verified against the page text. */
export async function POST(req: NextRequest) {
  const { doc, from, to } = await req.json();
  let d: Awaited<ReturnType<typeof readDoc>>;
  try {
    d = await readDoc(doc);
  } catch {
    return NextResponse.json({ error: "Document pages unavailable. Upload authorised policy-page extracts with the deployment upload command." }, { status: 404 });
  }
  const lo = Math.max(1, Number(from) || 1);
  const hi = Math.min(d.pages.length, Number(to) || lo, lo + 9); // max 10 pages per run
  const pages = d.pages.filter((p) => p.page >= lo && p.page <= hi && p.text.trim().length > 80);
  try {
    const results = await pool(pages, 4, async (p) => {
      const r = await gemmaChat(
        [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Document: ${d.title}\nPage ${p.page}:\n"""\n${p.text.slice(0, 9000)}\n"""` },
        ],
        { json: true, maxTokens: 900, temperature: 0, timeoutMs: 120_000 }
      );
      let cands: any[] = [];
      try {
        cands = parseJson<{ candidates: any[] }>(r.text).candidates ?? [];
      } catch {}
      const page = squash(p.text);
      return cands.map((c, i): Draft => ({
        id: `${doc}-p${p.page}-${Date.now().toString(36)}-${i}`,
        doc,
        docTitle: d.title,
        page: p.page,
        title: String(c.title ?? "").slice(0, 160),
        kind: c.kind ?? "requirement",
        metric: c.metric ?? undefined,
        operator: c.operator ?? undefined,
        value: c.value ?? null,
        unit: c.unit ?? undefined,
        applies_to: c.applies_to ?? undefined,
        effective_from: c.effective_from ?? null,
        quote: String(c.quote ?? ""),
        quote_verified: !!c.quote && page.includes(squash(String(c.quote))),
        status: "pending",
        created: new Date().toISOString(),
      }));
    });
    const fresh = results.flat();
    await updateDrafts(all=>{all.push(...fresh);});
    return NextResponse.json({ added: fresh.length, verified: fresh.filter((x) => x.quote_verified).length, pages: pages.map((p) => p.page) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: e instanceof GemmaUnavailable ? 503 : 500 });
  }
}
