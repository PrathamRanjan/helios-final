'use client';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import DemoTour,{type DemoStep} from "@/components/v2/DemoTour";
import HazePanel,{AirChip} from "@/components/v2/HazePanel";
import Link from 'next/link';
import { ArrowLeft, Download, Droplets, Flame, Hexagon, Layers, Leaf, Loader2, MapPin, Play, RotateCcw, Search, Sparkles, Sun, Trash2, X } from 'lucide-react';
import { Label, Stat, Tabs, Segmented, ConfChip } from '@/components/v2/ui';
import { INDIA_CITIES, inCity, type IndiaCity } from '@/lib/india/cities';
import { roofPolygon, type RoofPoint } from '@/lib/india/geometry';
import { DEFAULT_URBAN_INPUTS, URBAN_FIELDS, simulateUrban, validateUrbanInputs, type UrbanInputs, type UrbanField, type UrbanResult } from '@/lib/india/urban';
import { loadGoogleMaps } from '@/lib/google-maps';
import IndiaUrbanMap, { type UrbanLayer } from './IndiaUrbanMap';

type Snapshot={vertices:RoofPoint[];inputs:UrbanInputs;year:number;label:string};
type Tab='plan'|'impact'|'compare'|'context';
const n=(v:number,d=0)=>new Intl.NumberFormat('en-IN',{maximumFractionDigits:d}).format(v);
const money=(v:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(v);
const START_YEAR=2026;
function fieldError(e:unknown){return (e instanceof Error?e.message:'Unable to use this study area.').replace(/roof corners/gi,'area corners').replace(/a roof/gi,'a study area').replace(/Roof edges/gi,'Area edges');}
function Field({field,inputs,onChange}:{field:UrbanField;inputs:UrbanInputs;onChange:(k:keyof UrbanInputs,v:number)=>void}){
 return <label className="block text-[11px] text-white/65"><span className="flex items-center justify-between gap-2"><span>{field.label}</span>{field.group==='interventions'&&<span className="mono text-signal-300">{inputs[field.key]}%</span>}</span>
  <input aria-label={field.label} type={field.group==='interventions'?'range':'number'} min={field.key==='maturityYears'?1:0} max={field.max} step={field.step} value={inputs[field.key]}
   onChange={e=>{const v=Number(e.target.value);if(Number.isFinite(v))onChange(field.key,v);}}
   className={field.group==='interventions'?'mt-2 w-full accent-[#5eead4]':'mt-1 w-full rounded border border-line bg-ink-2 px-2 py-1.5 text-white outline-none focus:border-signal-300'} />
 </label>;
}
function ChangeRow({label,before,after,unit}:{label:string;before:number;after:number;unit:string}){
 return <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-center border-b border-line py-2 text-[11px]"><span className="text-white/60">{label}<span className="block text-[9px] text-white/35">{unit}</span></span><span className="mono text-white/45">{n(before,1)}</span><span className="mono text-signal-300 min-w-[68px] text-right">{n(after,1)}</span></div>;
}
const click=(sel:string)=>(document.querySelector(sel) as HTMLElement|null)?.click();
// India demo: an urban cooling + water experiment on a real street, then the city's live air.
function indiaDemo(name:string,setTab:(t:string)=>void,showAir:(v:boolean)=>void,preset:()=>void):DemoStep[]{return [
 {title:`${name}: an urban sandbox`,body:"Indian cities are hotter, wetter in monsoon bursts, and far more polluted. This sandbox tests <b>shade, cool roofs, rain gardens and harvesting</b> on any patch of the city, with every assumption editable and labelled."},
 {element:'[data-tour="india-test"]',title:"Pick a study area",body:"Draw any area, or drop a 1-hectare test square on the map pin. Placing one now.",before:()=>{showAir(false);setTab("plan");click('[data-tour="india-test"]');},wait:900},
 {element:'[data-tour="india-run"]',title:"Run the experiment",body:"Loading an example package (editable): cool roofs on 60% of roofs, harvesting on 30%, and trees, shade, permeable paving and rain gardens on the paving. Interventions share the paved and roof area honestly, with no double counting.",before:async()=>{preset();await new Promise(r=>setTimeout(r,300));click('[data-tour="india-run"]');},wait:900},
 {element:'[data-tour="india-stats"]',title:"Shade, water and cool roofs",body:"Added shade, runoff kept out of drains in a design storm, and cool-roof area, all recomputed from the inputs. Costs are in rupees and editable."},
 {element:'[data-tour="india-explain"]',title:"An AI that explains, not invents",body:"Ask the model to explain the result. It only receives this scenario's inputs and recomputed outputs, so it can't make up numbers.",before:()=>setTab("impact"),wait:500},
 {element:'[data-tour="india-air"]',title:"The air is the hardest constraint",body:`Live PM2.5 for ${name} (Copernicus CAMS). Unlike Singapore's imported haze, much of India's is local: traffic, construction dust, crop burning. HELIOS uses the same physics: fewer people walk and cycle, rooftop solar dims. Try Delhi NCR from the city menu.`,before:()=>showAir(true),wait:1200},
 {element:'[data-tour="india-solar"]',title:"Rooftop solar, city by city",body:"Switch to rooftop solar for this city: system size, yield and payback in rupees, with the local distribution company's rules called out.",before:()=>showAir(false)},
];}

export default function IndiaUrbanWorkspace({city}:{city:IndiaCity}){
 const [tab,setTab]=useState<Tab>('plan'),[inputs,setInputs]=useState<UrbanInputs>({...DEFAULT_URBAN_INPUTS});
 const [vertices,setVertices]=useState<RoofPoint[]>([]),[drawing,setDrawing]=useState(false);
 const [showAir,setShowAir]=useState(false);
 const [focus,setFocus]=useState<RoofPoint>(city.center),[query,setQuery]=useState(''),[searching,setSearching]=useState(false);
 const [layer,setLayer]=useState<UrbanLayer>('plan'),[baseline,setBaseline]=useState(false),[satellite,setSatellite]=useState(false);
 const [year,setYear]=useState(10),[run,setRun]=useState<Snapshot|null>(null),[a,setA]=useState<Snapshot|null>(null),[b,setB]=useState<Snapshot|null>(null);
 const [error,setError]=useState(''),[explanation,setExplanation]=useState(''),[explanationModel,setExplanationModel]=useState(''),[explaining,setExplaining]=useState(false),[aiError,setAiError]=useState('');
 const [context,setContext]=useState<any>(null),[contextLoading,setContextLoading]=useState(false);
 const content=useRef<HTMLDivElement>(null);
 useEffect(()=>{content.current?.scrollTo({top:0});},[tab]);
 const explainRequest=useRef<AbortController|null>(null),searchId=useRef(0), revision=useRef(0);
 const checked=useMemo(()=>{try{return {inputs:validateUrbanInputs(inputs),error:''};}catch(e){return {inputs:null,error:fieldError(e)};}},[inputs]);
 const site=useMemo(()=>{try{return vertices.length?roofPolygon(vertices,city.bounds):null;}catch{return null;}},[vertices,city]);
 const result:UrbanResult|null=useMemo(()=>run?simulateUrban(roofPolygon(run.vertices,city.bounds).areaM2,run.inputs,year):null,[run,year,city]);
 const dirty=!!run&&(JSON.stringify(inputs)!==JSON.stringify(run.inputs)||JSON.stringify(vertices)!==JSON.stringify(run.vertices));
 const usable=!!result&&!dirty&&!drawing;
 const invalidateAi=()=>{revision.current++;explainRequest.current?.abort();setExplaining(false);setExplanation('');setAiError('');};
 useEffect(()=>()=>{searchId.current++;explainRequest.current?.abort();},[]);
 useEffect(()=>{
  const ctrl=new AbortController();setContext(null);setContextLoading(true);
  fetch(`/api/india/${city.slug}/urban?lat=${focus.lat}&lng=${focus.lng}`,{signal:ctrl.signal}).then(async r=>{if(!r.ok)throw new Error();return r.json();}).then(d=>{if(!ctrl.signal.aborted)setContext(d);}).catch(()=>{}).finally(()=>{if(!ctrl.signal.aborted)setContextLoading(false);});
  return()=>ctrl.abort();
 },[city.slug,focus]);
 const update=(key:keyof UrbanInputs,value:number)=>{invalidateAi();setInputs(p=>({...p,[key]:value}));};
 const pickFocus=(point:RoofPoint)=>{
  if(!inCity(city,point.lat,point.lng)){setError(`Choose a location inside ${city.name}'s screening extent.`);return;}
  searchId.current++;setSearching(false);setFocus(point);setError('');
 };
 const chooseGeometry=(points:RoofPoint[])=>{
  try{
   const p=roofPolygon(points,city.bounds);invalidateAi();setVertices(points);setFocus(p.center);setDrawing(false);setError('');setRun(null);
  }catch(e){setError(fieldError(e));}
 };
 const testArea=()=>{
  const dLat=50/111320,dLng=50/(111320*Math.cos(focus.lat*Math.PI/180));
  chooseGeometry([{lat:focus.lat-dLat,lng:focus.lng-dLng},{lat:focus.lat-dLat,lng:focus.lng+dLng},{lat:focus.lat+dLat,lng:focus.lng+dLng},{lat:focus.lat+dLat,lng:focus.lng-dLng}]);
 };
 useEffect(()=>{
  if(!drawing)return;
  const cancel=(e:KeyboardEvent)=>{if(e.key==='Escape'){setDrawing(false);setError('');}};
  window.addEventListener('keydown',cancel);return()=>window.removeEventListener('keydown',cancel);
 },[drawing]);
 const beginDraw=()=>{searchId.current++;setSearching(false);invalidateAi();setDrawing(true);setError('');};
 const search=async(e:FormEvent)=>{
  e.preventDefault();if(!query.trim())return;
  setDrawing(false);const id=++searchId.current;setSearching(true);setError('');
  try{
   const g=await loadGoogleMaps(),{Geocoder}=await g.maps.importLibrary('geocoding');
   const d=await new Geocoder().geocode({address:`${query.trim()}, ${city.searchLabel}, India`,componentRestrictions:{country:'IN'},bounds:city.bounds});
   if(id!==searchId.current)return;
   const found=d.results?.find((p:any)=>inCity(city,p.geometry.location.lat(),p.geometry.location.lng()));
   if(!found)throw new Error(`No matching place within ${city.name}. Try a nearby address.`);
   pickFocus({lat:found.geometry.location.lat(),lng:found.geometry.location.lng()});
  }catch(e){if(id===searchId.current)setError(e instanceof Error?e.message:'Search unavailable. Click the map instead.');}
  finally{if(id===searchId.current)setSearching(false);}
 };
 const runScenario=()=>{
  if(!site||!checked.inputs||drawing)return;
  content.current?.scrollTo({top:0});invalidateAi();setRun({vertices:vertices.map(v=>({...v})),inputs:{...checked.inputs},year,label:'Current experiment'});setTab('impact');setBaseline(false);setError('');
 };
 const snapshot=():Snapshot=>({...run!,year,vertices:run!.vertices.map(v=>({...v})),inputs:{...run!.inputs}});
 const restore=(slot:Snapshot)=>{invalidateAi();searchId.current++;setSearching(false);setDrawing(false);setVertices(slot.vertices.map(v=>({...v})));setInputs({...slot.inputs});setYear(slot.year);setRun({...slot});setFocus(roofPolygon(slot.vertices,city.bounds).center);setTab('impact');setError('');};
 const exportScenario=()=>{
  if(!usable)return;
  const blob=new Blob([JSON.stringify({version:1,city:city.slug,scenario:snapshot(),result,source:'User-defined screening assumptions',limits:'Not calibrated air temperature, flood depth, or city planning advice. No maintenance costs included.'},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`helios-${city.slug}-urban-scenario.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 const explain=async()=>{
  if(!usable||!run)return;
  explainRequest.current?.abort();const ctrl=new AbortController();explainRequest.current=ctrl;const version=revision.current;
  setExplaining(true);setAiError('');setExplanation('');
  try{
   const r=await fetch(`/api/india/${city.slug}/urban`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot()),signal:ctrl.signal});
   const data=await r.json();if(!r.ok)throw new Error(data.error||'Explanation unavailable.');
   if(!ctrl.signal.aborted&&version===revision.current){setExplanation(data.explanation);setExplanationModel(data.model);}
  }catch(e){if(!ctrl.signal.aborted&&version===revision.current)setAiError(e instanceof Error?e.message:'Explanation unavailable.');}
  finally{if(!ctrl.signal.aborted&&version===revision.current)setExplaining(false);}
 };
 const comparison=(slot:Snapshot|null)=>slot?simulateUrban(roofPolygon(slot.vertices,city.bounds).areaM2,slot.inputs,slot.year):null;
 const ar=comparison(a),br=comparison(b);
 const group=(name:UrbanField['group'])=>URBAN_FIELDS.filter(f=>f.group===name).map(f=><Field key={f.key} field={f} inputs={inputs} onChange={update}/>);
 return <main className="v2 h-[100dvh] flex flex-col overflow-y-auto md:overflow-hidden">
  <header className="relative z-30 shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line bg-ink-0">
   <Link href="/india" className="v2-btn !px-2" aria-label="Back to India cities"><ArrowLeft size={14}/></Link>
   <Link href="/india" className="mono text-[12px] tracking-[.18em] text-white">HELIOS</Link><span className="h-5 w-px bg-line"/>
   <label className="sr-only" htmlFor="urban-city">Sandbox city</label><select id="urban-city" value={city.slug} onChange={e=>window.location.assign(`/india/${e.target.value}/sandbox`)} className="h-7 rounded border border-line bg-ink-1 px-2 text-xs max-w-[145px]">{INDIA_CITIES.map(c=><option key={c.slug} value={c.slug}>{c.name}</option>)}</select>
   <span className="hidden lg:block text-[10px] text-white/40">India / Urban sandbox</span><div className="flex-1"/>
   <AirChip city={city.slug} onClick={()=>setShowAir(v=>!v)}/>
   <DemoTour label={`${city.name} demo`} storageKey="helios-india-demo" steps={indiaDemo(city.name,setTab as (t:string)=>void,setShowAir,()=>{invalidateAi();setInputs(i=>({...i,coolRoofPct:60,treePct:15,shadePct:10,permeablePct:15,gardenPct:5,harvestPct:30}));})}/>
   <Link href={`/india/${city.slug}`} className="v2-btn" data-tour="india-solar"><Sun size={13}/> <span className="hidden sm:inline">Rooftop</span> Solar</Link>
   <button onClick={exportScenario} disabled={!usable} className="v2-btn disabled:opacity-35" aria-label="Export scenario"><Download size={13}/><span className="hidden lg:inline">Export</span></button>
  </header>
  {showAir&&<div className="absolute z-40 top-14 left-3 w-[300px] v2-panel p-1" data-tour="india-air"><HazePanel city={city.slug} startYear={2026}/></div>}
  <div className="relative flex-1 min-h-[700px] md:min-h-0 flex flex-col md:block">
   <section className="relative shrink-0 h-[43dvh] min-h-[270px] md:h-auto md:absolute md:inset-0 md:right-[400px]" aria-label="Urban scenario canvas">
    <IndiaUrbanMap city={city} geometry={vertices} drawing={drawing} focus={focus} layer={layer} baseline={baseline} result={usable?result:null} satellite={satellite} onFocus={pickFocus} onSelectArea={chooseGeometry}/>

    <div className="absolute top-3 left-3 z-10 flex flex-col gap-1 v2-panel p-1">
     <button onClick={beginDraw} title="Draw study area" aria-label="Draw study area" data-active={drawing} className="v2-btn !px-2"><Hexagon size={15}/></button>
     <button onClick={()=>setLayer('plan')} title="Intervention footprint" aria-label="Intervention footprint layer" data-active={layer==='plan'} className="v2-btn !px-2"><Layers size={15}/></button>
     <button onClick={()=>setLayer('shade')} title="Shade change" aria-label="Shade change layer" data-active={layer==='shade'} className="v2-btn !px-2"><Leaf size={15}/></button>
     <button onClick={()=>setLayer('water')} title="Runoff change" aria-label="Runoff change layer" data-active={layer==='water'} className="v2-btn !px-2"><Droplets size={15}/></button>
     <button onClick={()=>setLayer('roof')} title="Roof energy change" aria-label="Roof energy change layer" data-active={layer==='roof'} className="v2-btn !px-2"><Flame size={15}/></button>
     <button onClick={()=>setSatellite(v=>!v)} title="Satellite basemap" aria-label="Satellite basemap" data-active={satellite} className="v2-btn !px-2"><MapPin size={15}/></button>
    </div>
    <div className="absolute top-3 left-16 right-3 z-10 space-y-2">
     <form onSubmit={search} className="v2-panel flex items-center gap-2 p-1.5"><Search size={14} className="ml-1 text-white/40"/><label htmlFor="urban-address" className="sr-only">Find a place in {city.name}</label><input id="urban-address" value={query} onChange={e=>setQuery(e.target.value)} placeholder={`Find a place in ${city.name}…`} className="min-w-0 flex-1 bg-transparent outline-none text-xs py-1 focus-visible:ring-1 focus-visible:ring-signal-300"/><button disabled={searching||!query.trim()} className="v2-btn !h-7 disabled:opacity-35" type="submit">{searching?<Loader2 size={12} className="animate-spin"/>:'Find'}</button></form>
     <div className="flex flex-wrap gap-2 items-center"><div className="v2-panel p-1"><Segmented options={[{id:'before',label:'Baseline'},{id:'after',label:'Scenario'}]} value={baseline?'before':'after'} onChange={v=>setBaseline(v==='before')}/></div><span className="v2-panel px-2 py-1 text-[9px] text-white/55">{site?`${n(site.areaM2)} m² study area`:'Drag to select an area'}</span></div>
    </div>
    {drawing&&<div className="absolute left-16 right-3 bottom-[94px] md:bottom-[110px] z-20 v2-panel p-2 flex flex-wrap gap-2 items-center text-[11px]">{error&&<p role="alert" className="w-full text-amber-200">{error}</p>}<span className="flex-1 text-white/75">Drag to select an area · release to finish</span><button className="v2-btn !h-7" aria-label="Cancel drawing" onClick={()=>{setDrawing(false);setError('');}}><X size={12}/>Cancel</button></div>}

    {error&&!drawing&&<div role="alert" className="absolute left-16 right-3 bottom-[78px] z-20 v2-panel p-2 text-[11px] text-amber-200">{error}</div>}
    <div className="absolute bottom-2 left-3 right-3 z-10 v2-panel p-2 md:p-3">
     <div className="flex items-center gap-3 text-[10px]"><span className="mono text-signal-300 shrink-0">{START_YEAR+year} · +{year}y</span><label htmlFor="urban-year" className="sr-only">Years since implementation</label><input id="urban-year" type="range" min={0} max={20} step={1} value={year} onChange={e=>{invalidateAi();setYear(Number(e.target.value));}} className="min-w-0 flex-1 accent-[#5eead4]"/><span className="text-white/40 hidden lg:inline">Tree canopy growth</span></div>
     <p className="mt-1 text-[9px] text-white/45">{layer==='plan'?'Study footprint':layer==='shade'?`Added shade: ${usable&&!baseline?n(result!.delta.shadeM2):'0'} m²`:layer==='water'?`Runoff change: ${usable&&!baseline?n(result!.delta.runoffM3,1):'0'} m³ / event`:`Roof absorption avoided: ${usable&&!baseline?n(result!.delta.roofAbsorbedKwhDay):'0'} thermal kWh/day`} · uniform site summary, not a measured raster.</p>
    </div>
   </section>
   <aside className="relative flex-1 min-h-0 flex flex-col border-t md:border-t-0 md:border-l border-line bg-ink-1 md:absolute md:top-0 md:right-0 md:bottom-0 md:w-[400px]" aria-label={`${city.name} urban sandbox inspector`}>
    <div className="grid grid-cols-3 gap-2 px-4 py-3 border-b border-line" data-tour="india-stats">
     <Stat label="Added shade" value={usable?n(result!.delta.shadeM2):'—'} unit="m²" tone="signal"/>
     <Stat label="Runoff avoided" value={usable?n(result!.delta.runoffM3,1):'—'} unit="m³"/>
     <Stat label="Cool roof" value={usable?n(result!.coolRoofM2):'—'} unit="m²"/>
    </div>
    <Tabs<Tab> value={tab} onChange={setTab} tabs={[{id:'plan',label:'Plan',icon:Hexagon},{id:'impact',label:'Impact',icon:Flame},{id:'compare',label:'Compare',icon:Layers},{id:'context',label:'Context',icon:MapPin}]}/>
    <div ref={content} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
     {dirty&&<p role="status" className="rounded border border-amber-300/20 p-2 text-[11px] text-amber-200">Inputs changed. Run the scenario to update its results.</p>}
     {tab==='plan'&&<>
      <div className="flex items-center justify-between"><Label>{city.name} / Experiment</Label><ConfChip conf="screening estimate"/></div>
      <h1 className="text-lg text-white">Change the city. Test the effects.</h1><p className="text-xs leading-relaxed text-white/50">Drag to select a study area, describe its existing surfaces, then combine interventions. No projects are selected for you.</p>
      <div className="flex flex-wrap gap-2"><button className="v2-btn" onClick={beginDraw}><Hexagon size={13}/>Draw area</button><button className="v2-btn" data-tour="india-test" onClick={testArea}>Use 1 ha test area</button></div>
      <p className="text-[10px] text-white/40">The 1 ha square is a synthetic test boundary around the white map pin, not a ward or property. Click the map or search to move the pin.</p>
      <section className="space-y-3 border-t border-line pt-4"><Label>Existing surfaces · assumed</Label><div className="grid grid-cols-2 gap-3">{group('site')}</div><p className="text-[10px] text-white/50">Remaining {n(100-inputs.roofPct-inputs.pavedPct)}% is assumed existing tree canopy over planted ground. Replace these illustrative shares with your site survey.</p></section>
      <section className="space-y-3 border-t border-line pt-4"><Label>Interventions</Label>{group('interventions')}<p className="text-[10px] text-white/45">Ground allocations are disjoint and share the original paved area. Cool roofs and harvesting can share the same roof. Trees start at 15% of mature canopy.</p></section>
      {(['water','heat','energy','costs'] as const).map(g=><details key={g} className="border-t border-line pt-3"><summary className="cursor-pointer text-xs text-white/75">{g==='water'?'Rain event & water assumptions':g==='heat'?'Roof energy & tree growth':g==='energy'?'Cooling electricity & carbon':'Illustrative costs'}</summary><div className="grid grid-cols-2 gap-3 mt-3">{group(g)}</div><p className="mt-2 text-[10px] text-white/40">{g==='water'?'Tank and garden start empty. All residual site runoff is assumed connected to the garden. No flood depth or drain-capacity prediction.':g==='heat'?'Solar absorption is thermal energy, not electricity or a predicted temperature change. Tree survival and seasonal shade are not modelled.':g==='energy'?'Enter annual cooling electricity divided by roof footprint, plus your assumed reduction. Zero baseline means electricity savings are not estimated. No tree sequestration is claimed.':'Editable scenario costs, not local quotations. Upkeep, replacement, land and financing are excluded.'}</p></details>)}
      <button className="v2-btn text-xs" onClick={()=>{invalidateAi();setInputs({...DEFAULT_URBAN_INPUTS});}}><RotateCcw size={12}/>Reset inputs</button>
     </>}
     {tab==='impact'&&<>
      <div className="flex justify-between items-center"><Label>Baseline → Scenario</Label><ConfChip conf="screening estimate"/></div>
      {!usable?<p className="text-xs text-white/55">{dirty?'Run again to see the updated comparison.':'Choose an area and run your experiment from Plan.'}</p>:<>
       <p className="text-xs text-white/60">{n(result!.areaM2)} m² · {START_YEAR+year} · rainfall {run!.inputs.stormMm} mm per event</p>
       <div><div className="flex justify-end gap-5 text-[9px] text-white/35"><span>BASELINE</span><span>SCENARIO</span></div>
        <ChangeRow label="Ground shade" before={result!.baseline.shadeM2} after={result!.scenario.shadeM2} unit="m² canopy + structures"/>
        <ChangeRow label="Runoff leaving site" before={result!.baseline.runoffM3} after={result!.scenario.runoffM3} unit="m³ / selected event"/>
        <ChangeRow label="Roof solar absorption" before={result!.baseline.roofAbsorbedKwhDay} after={result!.scenario.roofAbsorbedKwhDay} unit="thermal kWh / scenario day"/>
       </div>
       <div className="grid grid-cols-2 gap-4"><Stat label="Tank collection" value={n(result!.harvestStoredM3,1)} unit="m³/event"/><Stat label="Garden storage" value={n(result!.gardenStoredM3,1)} unit="m³/event"/><Stat label="Scenario capex" value={money(result!.costInr)}/><Stat label="Cooling saved" value={run!.inputs.coolingKwhM2Year?n(result!.delta.coolingKwhYear):'Not estimated'} unit={run!.inputs.coolingKwhM2Year?'kWh/yr':undefined}/></div>
       {run!.inputs.coolingKwhM2Year>0&&<p className="text-xs text-white/55">Assumed cooling savings: {money(result!.coolingSavingsInrYear)}/yr · {n(result!.avoidedCo2KgYear/1000,2)} t CO₂/yr avoided. These follow your building-energy and emissions inputs.</p>}
       <p className="text-[10px] leading-relaxed text-white/45">These are area and water/energy balances under your assumptions. They do not predict air temperature, flood depth, health or citywide effects. Water and shade outcomes can trade off with available land and maintenance needs.</p>
       <div className="flex gap-2 flex-wrap"><button onClick={()=>{setA({...snapshot(),label:'Scenario A'});setTab('compare');}} className="v2-btn">Save as A</button><button onClick={()=>{setB({...snapshot(),label:'Scenario B'});setTab('compare');}} className="v2-btn">Save as B</button><button className="v2-btn" onClick={exportScenario}><Download size={12}/>Export</button></div>
       <section className="border-t border-line pt-3 space-y-3"><button disabled={explaining} onClick={explain} data-tour="india-explain" className="v2-btn disabled:opacity-40">{explaining?<Loader2 size={13} className="animate-spin"/>:<Sparkles size={13}/>}Explain my results</button><p className="text-[10px] text-white/40">The AI receives this scenario's location, assumptions and recomputed results when you ask.</p>{aiError&&<p role="alert" className="text-xs text-amber-200">{aiError}</p>}{explanation&&<div className="text-xs leading-relaxed whitespace-pre-wrap text-white/75"><span className="block text-[9px] uppercase tracking-widest text-signal-300 mb-2">{explanationModel} · scenario explanation</span>{explanation}</div>}</section>
      </>}
     </>}
     {tab==='compare'&&<>
      <Label>Scenario A / Scenario B</Label><p className="text-xs text-white/55">Snapshots include the study boundary, all assumptions and the selected year. Kept for this session; export to keep a copy.</p>
      {(['A','B'] as const).map((label,i)=>{const slot=i?b:a;return <div key={label} className="v2-panel p-3 space-y-2"><div className="flex items-center justify-between"><b className="text-sm">Scenario {label}</b><span className="text-[10px] text-white/40">{slot?`${START_YEAR+slot.year} · ${n(roofPolygon(slot.vertices,city.bounds).areaM2)} m²`:'Empty'}</span></div><div className="flex flex-wrap gap-2"><button disabled={!usable} onClick={()=>i?setB({...snapshot(),label:'Scenario B'}):setA({...snapshot(),label:'Scenario A'})} className="v2-btn disabled:opacity-35">Save current</button>{slot&&<><button onClick={()=>restore(slot)} className="v2-btn">Restore</button><button aria-label={`Clear scenario ${label}`} onClick={()=>i?setB(null):setA(null)} className="v2-btn"><Trash2 size={12}/></button></>}</div></div>;})}
      {ar&&br&&<><p className="text-[10px] text-white/40">Columns show A then B. {JSON.stringify(a!.vertices)!==JSON.stringify(b!.vertices)?'Different study boundaries: totals are not a like-for-like comparison.':''}{JSON.stringify(a!.inputs)!==JSON.stringify(b!.inputs)?' Inputs differ; compare the exported assumptions as well.':''}</p><ChangeRow label="Added shade" before={ar.delta.shadeM2} after={br.delta.shadeM2} unit="m²"/><ChangeRow label="Runoff avoided" before={ar.delta.runoffM3} after={br.delta.runoffM3} unit="m³/event"/><ChangeRow label="Roof absorption avoided" before={ar.delta.roofAbsorbedKwhDay} after={br.delta.roofAbsorbedKwhDay} unit="thermal kWh/day"/><ChangeRow label="Illustrative capex" before={ar.costInr} after={br.costInr} unit="₹"/></>}
     </>}
     {tab==='context'&&<>
      <Label>{city.name} / Site context</Label><p className="text-xs text-white/55">{city.region}<br/>{focus.lat.toFixed(5)}, {focus.lng.toFixed(5)} · white map pin</p>
      {contextLoading?<p role="status" className="text-xs text-white/45">Checking Google site context…</p>:<>
       <div className="grid grid-cols-2 gap-4"><Stat label="Current air temp" value={typeof context?.weather?.temp_c==='number'?n(context.weather.temp_c,1):'Unavailable'} unit={typeof context?.weather?.temp_c==='number'?'°C':undefined}/><Stat label="Elevation" value={typeof context?.elevation?.elevation_m==='number'?n(context.elevation.elevation_m):'Unavailable'} unit={typeof context?.elevation?.elevation_m==='number'?'m':undefined}/></div>
       {context?.weather?.description&&<p className="text-xs text-white/55">{context.weather.description}</p>}
       <p className="text-[10px] text-white/40">Google Weather / Elevation{context?.retrievedAt?` · retrieved ${new Date(context.retrievedAt).toLocaleString()}`:''}. Unavailable services do not block manual experiments.</p>
      </>}
      <p className="text-xs text-white/55 leading-relaxed">Current weather does not set your rain event or climate baseline. Point elevation does not establish drainage. The pin is context for the chosen location; scenario results apply to the outlined study area.</p>
      <section className="space-y-2 border-t border-line pt-3"><Label>Evidence & assumptions</Label><p className="text-[11px] leading-relaxed text-white/55">Surface shares, canopy, reflectance, rain, runoff coefficients, cooling response and costs are user inputs. They are not extracted from satellite imagery. All eight cities have the same tools; local surveys and weather make the experiment local.</p><p className="text-[11px] leading-relaxed text-white/55">Earth Engine heat/land-cover layers and calibrated neighbourhood models are not connected. Existing canopy is held constant; tree growth is illustrative. Storage assumes empty facilities and connected drainage. No legal or structural suitability is inferred.</p>
       <a className="block text-xs text-signal-300 underline" href="https://developers.google.com/maps/documentation/weather/overview" target="_blank" rel="noreferrer">Google Weather documentation</a><a className="block text-xs text-signal-300 underline" href="https://developers.google.com/maps/documentation/elevation/overview" target="_blank" rel="noreferrer">Google Elevation documentation</a></section>
     </>}
    </div>
    <footer className="shrink-0 border-t border-line p-3 bg-ink-1"><div className="space-y-2">{checked.error&&<p role="alert" className="text-[10px] text-amber-200">{checked.error}</p>}<button onClick={runScenario} data-tour="india-run" disabled={!site||!!checked.error||drawing} className="v2-btn-primary w-full disabled:opacity-35"><Play size={13}/>Run scenario</button></div>{!site&&<p className="mt-1.5 text-center text-[10px] text-white/35">Drag to select a study area or use a 1 ha test area first.</p>}</footer>
   </aside>
  </div>
 </main>;
}
