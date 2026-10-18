import assert from 'node:assert/strict';
import { INDIA_CITIES } from '../lib/india/cities';
const base=process.env.HELIOS_PREVIEW_URL||'http://127.0.0.1:3011';
async function main(){
 for(const city of INDIA_CITIES){
  const r=await fetch(`${base}/india/${city.slug}/sandbox`),html=await r.text();
  assert.equal(r.status,200,city.slug);assert(html.includes(`HELIOS ${city.name}`),city.slug);
  const invalid=await fetch(`${base}/api/india/${city.slug}/urban?lat=0&lng=0`);assert.equal(invalid.status,400,`${city.slug} API route`);
  const solar=await fetch(`${base}/india/${city.slug}`);assert.equal(solar.status,200,`${city.slug} solar`);
  console.log(`${city.name}: sandbox, API and existing solar routes OK`);
 }
 assert.equal((await fetch(`${base}/india/not-a-city/sandbox`)).status,404);
 for(const city of [INDIA_CITIES[0],INDIA_CITIES[2]]){
  const r=await fetch(`${base}/api/india/${city.slug}/urban?lat=${city.center.lat}&lng=${city.center.lng}`),data=await r.json();
  assert.equal(r.status,200);assert(data.retrievedAt);assert.equal(data.location.lat,city.center.lat);
  console.log(`${city.name}: site context weather=${!!data.weather} elevation=${!!data.elevation}`);
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
