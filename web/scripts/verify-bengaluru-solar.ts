import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { solarFinancials, inBengaluru } from "../lib/india/solar";
import { GET } from "../app/api/india/bengaluru/solar/route";

async function main() {
  assert.ok(inBengaluru(12.9716, 77.5946));
  assert.ok(!inBengaluru(1.3, 103.8));
  const f = solarFinancials(4000, 2, { tariff: 8, costPerKwp: 50000, selfConsumption: 1, exportRate: 0, acEfficiency: 0.85 });
  assert.equal(f.annualAcKwh, 3400);
  assert.equal(f.capex, 100000);
  assert.equal(f.annualNetSavings, 26200);
  const enriched = f;
  assert.ok(Math.abs(enriched.lifetimeSavings20y - 389299.18513695175) < 0.01, "20-year savings deduct installation and maintenance from degraded AC generation value");
  assert.ok(Math.abs(enriched.lcoeInrPerKwh! - 1.884943129728067) < 0.000001, "LCOE uses total costs divided by degraded lifetime AC energy");
  const noValue = solarFinancials(4000, 2, { tariff: 0, costPerKwp: 50000, selfConsumption: 0, exportRate: 0, acEfficiency: 0.85 });
  assert.equal(noValue.lifetimeSavings20y, -120000);
  assert.equal(noValue.lcoeInrPerKwh, enriched.lcoeInrPerKwh, "Tariffs and self-consumption affect savings, not generation cost");
  const noGeneration = solarFinancials(4000, 2, { tariff: 8, costPerKwp: 50000, selfConsumption: 1, exportRate: 0, acEfficiency: 0 });
  assert.equal(noGeneration.lcoeInrPerKwh, null);
  assert.equal(noGeneration.lifetimeSavings20y, -120000);
  assert.equal((solarFinancials(4000, 2, { tariff: 8, costPerKwp: 0, selfConsumption: 1, exportRate: 0, acEfficiency: 0.85 })).lcoeInrPerKwh, 0);
  assert.equal(solarFinancials(4000, 2, { tariff: 8, costPerKwp: 50000, selfConsumption: 0, exportRate: 0, acEfficiency: 0.85 }).paybackYears, null);
  assert.throws(() => solarFinancials(4000, 2, { tariff: -1, costPerKwp: 50000, selfConsumption: 1, exportRate: 0, acEfficiency: 0.85 }));
  const call = (query: string) => GET(new NextRequest(`http://localhost/api/india/bengaluru/solar?${query}`));
  let calls = 0;
  const fetchOriginal = globalThis.fetch;
  const keyOriginal = process.env.GOOGLE_SOLAR_API_KEY;
  const mapsOriginal = process.env.GOOGLE_MAPS_API_KEY;
  try {
    delete process.env.GOOGLE_SOLAR_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
    assert.equal((await call("lat=12.97&lng=77.59")).status, 503);
    process.env.GOOGLE_SOLAR_API_KEY = "test-key";
    globalThis.fetch = async (input) => {
      calls++;
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("requiredQuality"), "BASE");
      return Response.json({ regionCode: "IN", center: { latitude: 12.97, longitude: 77.59 }, imageryQuality: "BASE", solarPotential: {
        panelCapacityWatts: 400, panelHeightMeters: 2, panelWidthMeters: 1,
        wholeRoofStats: { areaMeters2: 100 }, solarPanelConfigs: [{ panelsCount: 5, yearlyEnergyDcKwh: 3000 }], solarPanels: [],
      } });
    };
    assert.equal((await call("lat=&lng=")).status, 400);
    assert.equal((await call("lat=Infinity&lng=77.59")).status, 400);
    assert.equal((await call("lat=1.3&lng=103.8")).status, 400);
    assert.equal(calls, 0);
    const response = await call("lat=12.97&lng=77.59");
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.summary.kwp, 2);
    assert.equal(result.summary.yearly_kwh, 3000);
    globalThis.fetch = async () => Response.json({ error: { message: "upstream includes a secret" } }, { status: 404 });
    const missing = await call("lat=12.97&lng=77.59");
    assert.equal(missing.status, 404);
    assert.ok(!(await missing.text()).includes("secret"));
    globalThis.fetch = async () => Response.json({ error: { details: [{ reason: "API_KEY_INVALID" }], message: "upstream includes a secret" } }, { status: 400 });
    const invalidKey = await call("lat=12.97&lng=77.59");
    assert.equal(invalidKey.status, 502);
    const invalidKeyMessage = await invalidKey.text();
    assert.match(invalidKeyMessage, /key is invalid/);
    assert.ok(!invalidKeyMessage.includes("secret"));
    globalThis.fetch = async () => new Response(null, { status: 403 });
    assert.equal((await call("lat=12.97&lng=77.59")).status, 502);
    globalThis.fetch = async () => Response.json({ regionCode: "IN", solarPotential: {} });
    assert.equal((await call("lat=12.97&lng=77.59")).status, 404);
    console.log("Bengaluru solar: validation, coverage/auth errors, API results and INR finance passed.");
  } finally {
    globalThis.fetch = fetchOriginal;
    if (keyOriginal === undefined) delete process.env.GOOGLE_SOLAR_API_KEY; else process.env.GOOGLE_SOLAR_API_KEY = keyOriginal;
    if (mapsOriginal === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = mapsOriginal;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
