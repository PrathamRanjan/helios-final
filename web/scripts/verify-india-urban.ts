import assert from 'node:assert/strict';
import { INDIA_CITIES } from '../lib/india/cities';
import { DEFAULT_URBAN_INPUTS as D, simulateUrban, validateUrbanInputs } from '../lib/india/urban';
const area=10000, base=simulateUrban(area,D,0);
assert.equal(base.delta.shadeM2,0); assert.equal(base.delta.runoffM3,0); assert.equal(base.costInr,0); assert.equal(base.delta.coolingKwhYear,0);
assert.equal(base.baseline.runoffM3,400);
const planted={...D,treePct:50};
assert(simulateUrban(area,planted,20).delta.shadeM2>simulateUrban(area,planted,0).delta.shadeM2);
assert.equal(simulateUrban(area,planted,20).delta.shadeM2,2000);
const roofs={...D,coolRoofPct:100,harvestPct:100,tankM3:1000}, r=simulateUrban(area,roofs,20);
assert.equal(r.coolRoofM2,4000); assert(r.delta.roofAbsorbedKwhDay>0); assert.equal(r.delta.coolingKwhYear,0);
assert.equal(r.harvestStoredM3,144); assert.equal(r.scenario.runoffM3+r.delta.runoffM3,r.baseline.runoffM3);
const energy=simulateUrban(area,{...roofs,coolingKwhM2Year:100,coolingReductionPct:10},20);
assert.equal(energy.delta.coolingKwhYear,40000);
const all={...D,treePct:25,shadePct:25,permeablePct:25,gardenPct:25,coolRoofPct:100,harvestPct:100,tankM3:1000};
for(const stormMm of [0,1,50,500]) {
 const s=simulateUrban(area,{...all,stormMm},10);
 assert(s.scenario.runoffM3>=0); assert(s.delta.runoffM3<=s.baseline.runoffM3);
 assert(s.scenario.shadeM2<=area*(1-D.roofPct/100));
 if(!stormMm) assert.equal(s.delta.runoffM3,0);
}
assert.throws(()=>validateUrbanInputs({...D,roofPct:80,pavedPct:40}),/cover/i);
assert.throws(()=>validateUrbanInputs({...D,treePct:60,gardenPct:60}),/pav/i);
assert.throws(()=>validateUrbanInputs({...D,newAlbedo:.1}),/reflect/i);
for(const bad of [NaN,Infinity,-1,101]) assert.throws(()=>validateUrbanInputs({...D,coolRoofPct:bad}));
assert.throws(()=>validateUrbanInputs({...D,tankM3:'5'})); assert.throws(()=>validateUrbanInputs(null));
assert.throws(()=>simulateUrban(0,D,0)); assert.throws(()=>simulateUrban(area,D,21));
for(const city of INDIA_CITIES) assert.equal(simulateUrban(area,D,10).areaM2,area,city.slug);
console.log('India urban model: baseline, conservation, combined interventions, maturity, energy prerequisites and validation passed for eight cities.');
