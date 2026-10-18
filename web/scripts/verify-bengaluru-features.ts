import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { estimatedRoof, proposalFacts, DEFAULT_SOLAR_ASSUMPTIONS } from "../lib/india/solar";
import { POST } from "../app/api/india/bengaluru/roof/route";
import { GET as context } from "../app/api/india/bengaluru/context/route";

async function main() {
  const result = estimatedRoof(12.97, 77.59, 100, "flat", "Drawn roof estimate");
  assert.equal(result.summary.panels, 25);
  assert.equal(result.summary.kwp, 13.75);
  assert.equal(result.summary.yearly_kwh, 24750);
  assert.equal(result.panels.length, 0, "Estimated roofs must not invent Google panel locations");
  assert.throws(() => estimatedRoof(12.97, 77.59, Infinity, "flat", "Drawn roof estimate"));
  assert.throws(() => estimatedRoof(1.3, 103.8, 100, "flat", "Drawn roof estimate"));
  assert.throws(() => estimatedRoof(12.97, 77.59, 100, "unknown", "Drawn roof estimate"));
  const facts = proposalFacts(result, DEFAULT_SOLAR_ASSUMPTIONS);
  assert.equal(facts.currency, "INR");
  assert.equal(facts.annualAcKwh, 24750 * 0.85);
  assert.equal(facts.co2TonnesPerYear, facts.annualAcKwh * 0.71 / 1000);
  assert.equal(facts.source, "Drawn roof estimate");
  assert.ok(!JSON.stringify(facts).includes("usd"));
  const call = (body: unknown) => POST(new NextRequest("http://localhost/api/india/bengaluru/roof", { method: "POST", body: JSON.stringify(body) }));
  const originalFetch = globalThis.fetch;
  const originalMaps = process.env.GOOGLE_MAPS_API_KEY;
  const originalGemini = process.env.GEMINI_API_KEY;
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; throw new Error("No upstream call expected"); };
    for (const body of [null, {}, { action: "manual", lat: "12.97", lng: 77.59, area: 100 }, { action: "manual", lat: 1.3, lng: 103.8, area: 100 }, { action: "manual", lat: 12.97, lng: 77.59, area: -1 }, { action: "render", lat: 12.97, lng: 77.59, result: {} }]) {
      assert.equal((await call(body)).status, 400);
    }
    const manual = await call({ action: "manual", lat: 12.97, lng: 77.59, area: 100, roofType: "flat", vertices: [{lat:12.97,lng:77.59},{lat:12.97,lng:77.5901},{lat:12.9701,lng:77.5901},{lat:12.9701,lng:77.59}] });
    assert.equal(manual.status, 200);
    assert.equal((await manual.json()).source, "Drawn roof estimate");
    assert.equal((await call({ action: "proposal", lat: 12.97, lng: 77.59, result, assumptions: { ...DEFAULT_SOLAR_ASSUMPTIONS, acEfficiency: 2 } })).status, 400);
    assert.equal((await context(new NextRequest("http://localhost/context?lat=&lng="))).status, 400);
    assert.equal(calls, 0);
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const promptFacts = JSON.parse(body.messages[1].content);
      assert.equal(promptFacts.currency, "INR");
      assert.equal(promptFacts.lifetimeSavings20y, facts.lifetimeSavings20y);
      assert.equal(promptFacts.lcoeInrPerKwh, facts.lcoeInrPerKwh);
      assert.equal(promptFacts.co2TonnesPerYear, promptFacts.annualAcKwh * 0.71 / 1000);
      return Response.json({ choices: [{ message: { content: "## Bengaluru proposal\nPre-feasibility estimate in INR." }, finish_reason: "stop" }] });
    };
    const proposal = await call({ action: "proposal", lat: 12.97, lng: 77.59, result, assumptions: DEFAULT_SOLAR_ASSUMPTIONS });
    assert.equal(proposal.status, 200);
    assert.match((await proposal.json()).text, /Pre-feasibility/);

    process.env.GOOGLE_MAPS_API_KEY = "test-maps";
    process.env.GEMINI_API_KEY = "test-gemini";
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("source"), "outdoor");
      assert.equal(url.searchParams.get("return_error_code"), "true");
      return new Response(new Uint8Array(1200));
    };
    const street = await context(new NextRequest("http://localhost/context?lat=12.97&lng=77.59&view=street"));
    assert.equal(street.status, 200);
    assert.equal(street.headers.get("Content-Type"), "image/jpeg");
    globalThis.fetch = async (input) => {
      calls++;
      if (String(input).includes("staticmap")) return new Response(new Uint8Array([137, 80, 78, 71]));
      if (String(input).includes("generateContent")) {
        assert.ok(String(input).includes("gemini-3.8-flash"), "Use the supported vision model for Bengaluru");
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ primary_roof_area_m2: 100, roof_type: "flat", confidence: 0.7, notes: "Water tank visible" }) }] } }] });
      }
      throw new Error("Unexpected URL");
    };
    const vision = await call({ action: "estimate", lat: 12.97, lng: 77.59 });
    assert.equal(vision.status, 200);
    const estimate = await vision.json();
    assert.equal(estimate.source, "Gemini roof estimate");
    assert.match(estimate.estimation.notes, /Water tank/);
    globalThis.fetch = async (input) => {
      if (String(input).includes("staticmap")) return new Response(new Uint8Array([137, 80, 78, 71]));
      return new Response(null, { status: 429 });
    };
    const imageQuota = await call({ action: "render", lat: 12.97, lng: 77.59, result });
    assert.equal(imageQuota.status, 503);
    assert.match((await imageQuota.json()).error, /image-generation quota/);
    globalThis.fetch = async (input) => {
      if (String(input).includes("staticmap")) return new Response(new Uint8Array([137, 80, 78, 71]));
      assert.ok(String(input).includes("gemini-3.1-flash-image"));
      return Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from("generated-image").toString("base64") } }] } }] });
    };
    const image = await call({ action: "render", lat: 12.97, lng: 77.59, result });
    assert.equal(image.status, 200);
    assert.equal(Buffer.from((await image.json()).after, "base64").toString(), "generated-image");
    globalThis.fetch = async () => new Response(null, { status: 403 });
    const failure = await call({ action: "estimate", lat: 12.97, lng: 77.59 });
    assert.equal(failure.status, 502);
    assert.match((await failure.json()).error, /Static Maps/);
    console.log("Bengaluru extensions: estimates, INR/carbon facts, input validation, manual and Gemini routes passed.");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalMaps === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = originalMaps;
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalGemini;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
