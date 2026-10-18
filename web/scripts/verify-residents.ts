import assert from "node:assert/strict";
import { NextRequest } from "next/server";

async function main() {
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_MODEL = "gemini-3.8-flash";
  const { POST } = await import("../app/api/persona/area/route");
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    const prompt = body.messages.map((m: { content: string }) => m.content).join("\n");
    const ids = [...prompt.matchAll(/Resident ([^:\n]+):/g)].map((m) => m[1]);
    assert.equal(ids.length, 24, "Send the whole resident panel in one request");
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ replies: ids.map((id) => ({ id, reaction: "A shorter walk helps.", sentiment: 1, stated_change: "walk_or_cycle_more" })) }) } }] });
  };
  const response = await POST(new NextRequest("http://localhost/api/persona/area", { method: "POST", body: JSON.stringify({ areaId: "jurong_east", areaName: "Jurong East", n: 24 }) }));
  const data = await response.json();
  assert.equal(response.status, 200, data.error);
  assert.equal(data.panel.length, 24);
  assert.equal(calls, 1);
  console.log("24-resident single-request check passed.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
