import { CITIES } from '../lib/cities';
import assert from 'node:assert/strict';
import { INDIA_CITIES, indiaCityBySlug, inCity } from '../lib/india/cities';
import { estimatedRoof, proposalFacts, DEFAULT_SOLAR_ASSUMPTIONS } from '../lib/india/solar';
import { getSolar, postRoof } from '../lib/india/server';
import { NextRequest } from 'next/server';
async function main(){
 assert.equal(CITIES.find(c=>c.code==='IN')?.route,'/india');
 assert.equal(INDIA_CITIES.length,8); assert.equal(new Set(INDIA_CITIES.map(c=>c.slug)).size,8);
 assert.equal(indiaCityBySlug('unknown'),undefined);
 const original=globalThis.fetch; const key=process.env.GOOGLE_SOLAR_API_KEY; process.env.GOOGLE_SOLAR_API_KEY='test';
 try {for(const city of INDIA_CITIES){
  const {lat,lng}=city.center;assert.ok(inCity(city,lat,lng));assert.ok(!inCity(city,1.3,103.8));
  const roof=estimatedRoof(lat,lng,100,'flat','Drawn roof estimate',city);
  const facts=proposalFacts(roof,DEFAULT_SOLAR_ASSUMPTIONS,city);
  assert.ok(facts.location.includes(city.name));
  assert.ok(Number.isFinite(facts.lifetimeSavings20y), 'Every city proposal includes lifetime savings');
  assert.ok(facts.lcoeInrPerKwh! > 0, 'Every city proposal includes generation cost in INR/kWh');
  if(city.slug!=='bengaluru') assert.ok(!/BESCOM|KERC|Bengaluru/.test(JSON.stringify(facts)));
  globalThis.fetch=async()=>{throw new Error('Unexpected fetch');};
  const vertices=[{lat,lng},{lat,lng:lng+.0001},{lat:lat+.0001,lng:lng+.0001},{lat:lat+.0001,lng}];
  const request=(body:unknown)=>new NextRequest('http://localhost/api/india/'+city.slug+'/roof',{method:'POST',body:JSON.stringify(body)});
  assert.equal((await postRoof(request({action:'manual',lat,lng,vertices,roofType:'flat'}),city)).status,200);
  assert.equal((await postRoof(request({action:'manual',lat,lng,area:100,roofType:'flat'}),city)).status,400);
  assert.equal((await getSolar(new NextRequest('http://localhost?lat=1.3&lng=103.8'),city)).status,400);
  globalThis.fetch=async()=>Response.json({regionCode:'IN',center:{latitude:lat,longitude:lng},solarPotential:{wholeRoofStats:{areaMeters2:100},solarPanelConfigs:[{panelsCount:5,yearlyEnergyDcKwh:3000}]}});
  assert.equal((await getSolar(new NextRequest(`http://localhost?lat=${lat}&lng=${lng}`),city)).status,200);
 }}finally{globalThis.fetch=original;if(key===undefined) delete process.env.GOOGLE_SOLAR_API_KEY;else process.env.GOOGLE_SOLAR_API_KEY=key;}
 console.log('India cities: all eight manual/Solar flows, guidance, bounds and invalid inputs passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
