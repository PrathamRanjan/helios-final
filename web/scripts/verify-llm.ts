import assert from "node:assert/strict";

async function main() {
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_MODEL = "gemini-3.8-flash";
  process.env.LLM_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
  const { gemmaChat, parseJson } = await import("../lib/compass/llm/gemma");
  let finishReason = "stop";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.reasoning_effort, "low");
    assert.ok(body.max_tokens >= 2048, "Gemini needs room for reasoning and complete JSON");
    assert.deepEqual(body.response_format, { type: "json_object" });
    return Response.json({ choices: [{ finish_reason: finishReason, message: { content: '{"reaction":"A shorter walk helps.","sentiment":1}' } }] });
  };
  const messages = [{ role: "user" as const, content: "React in JSON." }];
  const result = await gemmaChat(messages, { json: true, maxTokens: 200 });
  assert.equal(parseJson<{ sentiment: number }>(result.text).sentiment, 1);
  finishReason = "length";
  await assert.rejects(gemmaChat(messages, { json: true }), /token limit/i);
  console.log("Hosted Gemini JSON and truncation checks passed.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
