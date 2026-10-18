import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEMO_DIR = path.join(process.cwd(), "data", "demo_data");

function splitForTypewriter(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of text) {
    cur += ch;
    if (" \n.,;:!?".includes(ch)) {
      out.push(cur);
      cur = "";
    }
  }
  if (cur) out.push(cur);
  return out;
}

export async function GET(
  _req: Request,
  ctx: { params: { slug: string } }
) {
  const p = path.join(DEMO_DIR, `${ctx.params.slug}-proposal.txt`);
  let text: string;
  try {
    text = await fs.readFile(p, "utf-8");
  } catch {
    return new Response("not cached", { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const chunk of splitForTypewriter(text)) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`)
        );
        await new Promise((r) => setTimeout(r, 12));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
