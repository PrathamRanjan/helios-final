import assert from 'node:assert/strict';
import { solarFinancials, DEFAULT_SOLAR_ASSUMPTIONS as defaults } from '../lib/india/solar';
import { NextRequest } from 'next/server';
import { GET } from '../app/api/india/bengaluru/solar/route';

async function main() {
  for (const tariff of [undefined, '7', NaN, Infinity, -1]) {
    assert.throws(() => solarFinancials(24750, 13.75, { ...defaults, tariff } as any), `Reject invalid tariff ${tariff}`);
  }
  assert.throws(() => solarFinancials(24750, 13.75, { ...defaults, costPerKwp: Number.MAX_VALUE }));
  assert.equal(solarFinancials(24750, 13.75, { ...defaults, costPerKwp: 0 }).paybackYears, 0);
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.GOOGLE_SOLAR_API_KEY;
  process.env.GOOGLE_SOLAR_API_KEY = 'test';
  const fixture = (lat = 12.97, lng = 77.59) => ({regionCode:'IN',center:{latitude:lat,longitude:lng}, solarPotential:{wholeRoofStats:{areaMeters2:100},solarPanelConfigs:[{panelsCount:2,yearlyEnergyDcKwh:1000}],solarPanels:Array.from({length:5},()=>({center:{latitude:lat,longitude:lng},orientation:'PORTRAIT',segmentIndex:0}))}});
  const call = () => GET(new NextRequest('http://localhost/api/india/bengaluru/solar?lat=12.97&lng=77.59'));
  try {
    globalThis.fetch = async () => Response.json(fixture(13.2,77.8));
    assert.equal((await call()).status,404,'Reject distant building inside the same city');
    globalThis.fetch = async () => Response.json(fixture());
    const result = await (await call()).json();
    assert.equal(result.panels.length,result.summary.panels,'Display only selected configuration');
    globalThis.fetch = async () => Response.json({...fixture(),solarPotential:{solarPanelConfigs:'bad'}});
    assert.equal((await call()).status,502,'Malformed provider response is not missing coverage');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GOOGLE_SOLAR_API_KEY; else process.env.GOOGLE_SOLAR_API_KEY = oldKey;
  }
  console.log('India regressions: financial validation, zero-cost payback, geographic match and panel count passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
