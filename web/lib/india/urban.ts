import { INDIA_GRID_CO2_KG_PER_KWH } from './solar';
/** Screening mass/area balances. Inputs are user assumptions, not calibrated city forecasts. */
export const DEFAULT_URBAN_INPUTS = {
  roofPct:40,pavedPct:40,coolRoofPct:0,treePct:0,shadePct:0,permeablePct:0,gardenPct:0,harvestPct:0,
  tankM3:20,gardenDepthM:.15,stormMm:50,roofRunoff:.9,pavedRunoff:.9,greenRunoff:.4,permeableRunoff:.3,
  harvestEfficiency:.8,oldAlbedo:.2,newAlbedo:.7,sunKwhM2Day:4.5,maturityYears:10,
  coolingKwhM2Year:0,coolingReductionPct:10,tariff:8,gridKgKwh:INDIA_GRID_CO2_KG_PER_KWH,
  coolRoofCost:350,treeCost:800,shadeCost:2500,permeableCost:1200,gardenCost:1500,tankCost:8000,harvestCost:100,
};
export type UrbanInputs = typeof DEFAULT_URBAN_INPUTS;
export type UrbanKey = keyof UrbanInputs;
export interface UrbanField {key:UrbanKey;label:string;max:number;step:number;group:'site'|'interventions'|'water'|'heat'|'energy'|'costs'}
export const URBAN_FIELDS: UrbanField[] = [
  {key:'roofPct',label:'Roof cover (% of site)',max:100,step:1,group:'site'},
  {key:'pavedPct',label:'Paved cover (% of site)',max:100,step:1,group:'site'},
  {key:'coolRoofPct',label:'Cool roofs (% of roof)',max:100,step:5,group:'interventions'},
  {key:'treePct',label:'New tree plots (% of paving)',max:100,step:5,group:'interventions'},
  {key:'shadePct',label:'Shade structures (% of paving)',max:100,step:5,group:'interventions'},
  {key:'permeablePct',label:'Permeable paving (% of paving)',max:100,step:5,group:'interventions'},
  {key:'gardenPct',label:'Rain gardens (% of paving)',max:100,step:5,group:'interventions'},
  {key:'harvestPct',label:'Harvesting (% of roof)',max:100,step:5,group:'interventions'},
  {key:'tankM3',label:'Empty tank capacity (m³)',max:100000,step:1,group:'water'},
  {key:'gardenDepthM',label:'Garden storage depth (m)',max:1,step:.01,group:'water'},
  {key:'stormMm',label:'Rain event (mm)',max:500,step:5,group:'water'},
  {key:'roofRunoff',label:'Roof runoff coefficient (0–1)',max:1,step:.05,group:'water'},
  {key:'pavedRunoff',label:'Paving runoff coefficient (0–1)',max:1,step:.05,group:'water'},
  {key:'greenRunoff',label:'Planted-ground runoff coefficient (0–1)',max:1,step:.05,group:'water'},
  {key:'permeableRunoff',label:'Permeable runoff coefficient (0–1)',max:1,step:.05,group:'water'},
  {key:'harvestEfficiency',label:'Roof collection efficiency (0–1)',max:1,step:.05,group:'water'},
  {key:'oldAlbedo',label:'Existing roof reflectance (0–1)',max:1,step:.05,group:'heat'},
  {key:'newAlbedo',label:'Cool roof reflectance (0–1)',max:1,step:.05,group:'heat'},
  {key:'sunKwhM2Day',label:'Daily solar irradiation (kWh/m²)',max:12,step:.1,group:'heat'},
  {key:'maturityYears',label:'Years to mature tree canopy',max:20,step:1,group:'heat'},
  {key:'coolingKwhM2Year',label:'Roof-normalised cooling baseline (kWh/m²/yr)',max:1000,step:5,group:'energy'},
  {key:'coolingReductionPct',label:'Assumed cool-roof cooling reduction (%)',max:100,step:1,group:'energy'},
  {key:'tariff',label:'Electricity rate (₹/kWh)',max:100,step:.1,group:'energy'},
  {key:'gridKgKwh',label:'Grid emissions (kg CO₂/kWh)',max:2,step:.001,group:'energy'},
  {key:'coolRoofCost',label:'Cool roof (₹/m²)',max:1000000,step:50,group:'costs'},
  {key:'treeCost',label:'Tree plot (₹/m²)',max:1000000,step:50,group:'costs'},
  {key:'shadeCost',label:'Shade structure (₹/m²)',max:1000000,step:100,group:'costs'},
  {key:'permeableCost',label:'Permeable paving (₹/m²)',max:1000000,step:100,group:'costs'},
  {key:'gardenCost',label:'Rain garden (₹/m²)',max:1000000,step:100,group:'costs'},
  {key:'tankCost',label:'Tank (₹/m³ capacity)',max:1000000,step:500,group:'costs'},
  {key:'harvestCost',label:'Roof collection fittings (₹/m²)',max:1000000,step:50,group:'costs'},
];
export function validateUrbanInputs(raw:unknown):UrbanInputs {
  if(!raw || typeof raw!=='object' || Array.isArray(raw)) throw new Error('Provide the scenario inputs.');
  const obj=raw as Record<string,unknown>, inputs={...DEFAULT_URBAN_INPUTS};
  for(const field of URBAN_FIELDS) {
    const v=obj[field.key];
    if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>field.max) throw new Error(`${field.label}: enter a number from 0 to ${field.max}.`);
    inputs[field.key]=v;
  }
  if(inputs.maturityYears<1) throw new Error('Tree maturity must be at least one year.');
  if(inputs.roofPct+inputs.pavedPct>100) throw new Error('Roof and paved cover cannot exceed 100% of the site.');
  if(inputs.treePct+inputs.shadePct+inputs.permeablePct+inputs.gardenPct>100) throw new Error('Ground interventions cannot use more than 100% of the original paving.');
  if(inputs.newAlbedo<inputs.oldAlbedo) throw new Error('Cool roof reflectance must be at least the existing roof reflectance.');
  return inputs;
}
export function simulateUrban(areaM2:number, raw:UrbanInputs, year:number) {
  const p=validateUrbanInputs(raw);
  if(!Number.isFinite(areaM2)||areaM2<2.6||areaM2>100000) throw new Error('Study area must be between 2.6 and 100,000 m².');
  if(!Number.isInteger(year)||year<0||year>20) throw new Error('Choose a whole year between 0 and 20.');
  const roof=areaM2*p.roofPct/100,paved=areaM2*p.pavedPct/100,green=areaM2-roof-paved;
  const coolRoofM2=roof*p.coolRoofPct/100,trees=paved*p.treePct/100,shade=paved*p.shadePct/100;
  const permeable=paved*p.permeablePct/100,garden=paved*p.gardenPct/100;
  const maturity=.15+.85*Math.min(1,year/p.maturityYears);
  const baseline={
    shadeM2:green,
    roofAbsorbedKwhDay:roof*p.sunKwhM2Day*(1-p.oldAlbedo),
    runoffM3:p.stormMm/1000*(roof*p.roofRunoff+paved*p.pavedRunoff+green*p.greenRunoff),
    coolingKwhYear:roof*p.coolingKwhM2Year,
  };
  const generatedRunoffM3=p.stormMm/1000*(roof*p.roofRunoff+(paved-trees-permeable-garden)*p.pavedRunoff+(green+trees+garden)*p.greenRunoff+permeable*p.permeableRunoff);
  const harvestStoredM3=Math.min(p.tankM3,roof*p.harvestPct/100*p.stormMm/1000*p.roofRunoff*p.harvestEfficiency);
  // shortcut: all study-area runoff can reach the garden; upgrade when surveyed drainage connectivity exists.
  const gardenStoredM3=Math.min(garden*p.gardenDepthM,Math.max(0,generatedRunoffM3-harvestStoredM3));
  const scenario={
    shadeM2:green+trees*maturity+shade,
    roofAbsorbedKwhDay:baseline.roofAbsorbedKwhDay-coolRoofM2*p.sunKwhM2Day*(p.newAlbedo-p.oldAlbedo),
    runoffM3:Math.max(0,generatedRunoffM3-harvestStoredM3-gardenStoredM3),
    coolingKwhYear:baseline.coolingKwhYear-coolRoofM2*p.coolingKwhM2Year*p.coolingReductionPct/100,
  };
  const delta={
    shadeM2:scenario.shadeM2-baseline.shadeM2,
    roofAbsorbedKwhDay:baseline.roofAbsorbedKwhDay-scenario.roofAbsorbedKwhDay,
    runoffM3:baseline.runoffM3-scenario.runoffM3,
    coolingKwhYear:baseline.coolingKwhYear-scenario.coolingKwhYear,
  };
  const costInr=coolRoofM2*p.coolRoofCost+trees*p.treeCost+shade*p.shadeCost+permeable*p.permeableCost+garden*p.gardenCost+
    (p.harvestPct>0&&roof>0 ? p.tankM3*p.tankCost+roof*p.harvestPct/100*p.harvestCost : 0);
  return {areaM2,year,baseline,scenario,delta,coolRoofM2,treeCanopyM2:trees*maturity,harvestStoredM3,gardenStoredM3,costInr,
    coolingSavingsInrYear:delta.coolingKwhYear*p.tariff,avoidedCo2KgYear:delta.coolingKwhYear*p.gridKgKwh};
}
export type UrbanResult=ReturnType<typeof simulateUrban>;
