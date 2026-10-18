import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "";

function memoPrompt(ranking: any): string {
  return `You are HELIO Compass, an urban-decarbonisation decision advisor for city planners.

You are given a ranked list of candidate interventions for a Singapore district,
already scored for annual CO2 avoided (tonnes/yr), capital cost (USD), and
cost-per-tonne (USD/tCO2 over the asset lifetime). The numbers come from real LTA
DataMall passenger-volume data and the Google Solar API.

RANKING DATA (the ONLY numbers you may cite):
${JSON.stringify(ranking, null, 2)}

STRICT RULES:
- Use ONLY the numbers in the RANKING DATA above. Do not invent any figure.
- This is a calibrated, illustrative reallocation — NEVER call mobility numbers a
  "prediction" or "forecast". Say "illustrative, calibrated to observed transit share".
- Be concrete: name the top intervention and why it leads on cost-per-tonne, and
  contrast it with the highest absolute-CO2 option if different.

OUTPUT FORMAT (Markdown, ~220 words):
## The headline
2 sentences: what wins per dollar, and the single number that proves it.
## Why the ranking lands here
3-4 sentences comparing solar vs mobility levers using the data.
## What a planner should do first
3 short bullets (this quarter / this year / pilot).
End with: "HELIO Compass · grounded in LTA DataMall + Google Solar API".`;
}

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

export async function POST(req: NextRequest) {
  const { ranking } = await req.json();

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    `gemini-2.5-flash:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: memoPrompt(ranking) }] }],
    generationConfig: { temperature: 0.6, maxOutputTokens: 900 },
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = async (chunk: string) => {
        controller.enqueue(encoder.encode(chunk));
        await new Promise((r) => setTimeout(r, 10));
      };
      try {
        if (!GEMINI_KEY) {
          await emit(`data: ${JSON.stringify({ error: "GEMINI_API_KEY not set" })}\n\n`);
          controller.close();
          return;
        }
        const upstream = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!upstream.ok || !upstream.body) {
          const err = await upstream.text();
          await emit(`data: ${JSON.stringify({ error: err.slice(0, 400) })}\n\n`);
          controller.close();
          return;
        }
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const buffered: string[] = [];
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") continue;
            try {
              const obj = JSON.parse(payload);
              const parts = obj?.candidates?.[0]?.content?.parts ?? [];
              for (const p of parts) {
                const txt = p.text ?? "";
                if (!txt) continue;
                buffered.push(txt);
                while (true) {
                  const full = buffered.join("");
                  const chunks = splitForTypewriter(full);
                  if (chunks.length <= 1) break;
                  for (const c of chunks.slice(0, -1)) {
                    await emit(`data: ${JSON.stringify({ text: c })}\n\n`);
                  }
                  buffered.length = 0;
                  buffered.push(chunks[chunks.length - 1]);
                }
              }
            } catch {
              /* ignore */
            }
          }
        }
        const remainder = buffered.join("");
        for (const c of splitForTypewriter(remainder)) {
          await emit(`data: ${JSON.stringify({ text: c })}\n\n`);
        }
        await emit("data: [DONE]\n\n");
      } catch (e: any) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: e?.message ?? "stream error" })}\n\n`)
        );
      } finally {
        controller.close();
      }
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
