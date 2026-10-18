import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET, POST } from '../app/api/india/[city]/urban/route';
import { POST as bengaluruPost } from '../app/api/india/bengaluru/urban/route';
import { INDIA_CITIES } from '../lib/india/cities';
import { DEFAULT_URBAN_INPUTS } from '../lib/india/urban';
const ctx={params:{city:'bengaluru'}};
const point=INDIA_CITIES[0].center;
const vertices=[{lat:point.lat,lng:point.lng},{lat:point.lat+.001,lng:point.lng},{lat:point.lat+.001,lng:point.lng+.001}];
const body={vertices,inputs:DEFAULT_URBAN_INPUTS,year:10};
const post=(value:unknown)=>new NextRequest('http://localhost/api/india/bengaluru/urban',{method:'POST',body:JSON.stringify(value)});
async function main(){
 const original=globalThis.fetch, key=process.env.GEMINI_API_KEY, maps=process.env.GOOGLE_MAPS_API_KEY, solar=process.env.GOOGLE_SOLAR_API_KEY;
 let calls=0;
 globalThis.fetch=(async()=>{calls++;throw new Error('No external calls in invalid-input tests');}) as typeof fetch;
 try{
  assert.equal((await POST(post(body),{params:{city:'unknown'}})).status,404);
  assert.equal((await POST(post({...body,vertices:[]}),ctx)).status,400);
  assert.equal((await POST(post({...body,inputs:{...DEFAULT_URBAN_INPUTS,treePct:80,gardenPct:80}}),ctx)).status,400);
  assert.equal((await GET(new NextRequest('http://localhost/api/india/bengaluru/urban?lat=0&lng=0'),ctx)).status,400);
  assert.equal((await GET(new NextRequest('http://localhost/api/india/bengaluru/urban'),ctx)).status,400);
  assert.equal(calls,0);
  delete process.env.GEMINI_API_KEY;
  assert.equal((await POST(post(body),ctx)).status,503);
  assert.equal((await bengaluruPost(post(body))).status,503);
  globalThis.fetch=(async(_url:any,init:any)=>{
   const payload=JSON.parse(init.body);
   assert(payload.messages.some((m:any)=>m.content.includes('screening')));
   return new Response(JSON.stringify({choices:[{message:{content:'These are assumption-based scenario results.'}}],usage:{completion_tokens:10}}),{status:200});
  }) as typeof fetch;
  const response=await POST(post({...body,result:{delta:{coolingKwhYear:999999}}}),ctx);
  assert.equal(response.status,200);
  const data=await response.json(); assert.equal(data.result.delta.coolingKwhYear,0);
  globalThis.fetch=(async()=>new Response('{}',{status:429})) as typeof fetch;
  assert.equal((await POST(post(body),ctx)).status,503);
  assert.equal((await bengaluruPost(post(body))).status,503);
  delete process.env.GOOGLE_MAPS_API_KEY;delete process.env.GOOGLE_SOLAR_API_KEY;
  const absent=await GET(new NextRequest(`http://localhost/api/india/bengaluru/urban?lat=${point.lat}&lng=${point.lng}`),ctx);
  assert.equal(absent.status,200);assert.equal((await absent.json()).weather,null);
  console.log('India urban API: invalid inputs, unknown cities, absent services, upstream failure and server-recomputed AI facts passed.');
 }finally{
  globalThis.fetch=original;
  for(const [k,v] of Object.entries({GEMINI_API_KEY:key,GOOGLE_MAPS_API_KEY:maps,GOOGLE_SOLAR_API_KEY:solar})) {if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
