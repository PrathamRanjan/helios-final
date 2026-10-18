'use client';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { snipRectangle, snipCorners, type ScreenPoint } from '@/lib/india/snipping';
import { loadGoogleMaps } from '@/lib/google-maps';
import type { IndiaCity } from '@/lib/india/cities';
import type { RoofPoint } from '@/lib/india/geometry';
import type { UrbanResult } from '@/lib/india/urban';
export type UrbanLayer='plan'|'shade'|'water'|'roof';
interface Props {
 city:IndiaCity; geometry:RoofPoint[]; drawing:boolean; focus:RoofPoint;
 layer:UrbanLayer; baseline:boolean; result:UrbanResult|null; satellite:boolean;
 onSelectArea:(points:RoofPoint[])=>void; onFocus:(point:RoofPoint)=>void;
}
const colors:Record<UrbanLayer,string>={plan:'#5eead4',shade:'#86efac',water:'#38bdf8',roof:'#fbbf24'};
export default function IndiaUrbanMap({city,geometry,drawing,focus,layer,baseline,result,satellite,onSelectArea,onFocus}:Props) {
 const element=useRef<HTMLDivElement>(null), map=useRef<any>(null), gRef=useRef<any>(null);
 const current=useRef({drawing,onFocus}); current.current={drawing,onFocus};
 const projection=useRef<any>(null), drag=useRef<{start:ScreenPoint;pointerId:number}|null>(null);
 const [selection,setSelection]=useState<ReturnType<typeof snipRectangle>|null>(null),[selectionError,setSelectionError]=useState('');
 useEffect(()=>{if(!drawing){drag.current=null;setSelection(null);setSelectionError('');}},[drawing]);
 const [ready,setReady]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  let cancelled=false,listener:any,overlay:any;
  loadGoogleMaps().then(async g=>{
   const {Map}=await g.maps.importLibrary('maps');
   if(cancelled||!element.current)return;
   gRef.current=g;
   map.current=new Map(element.current,{center:city.center,zoom:15,disableDefaultUI:true,zoomControl:true,clickableIcons:false,gestureHandling:'greedy',keyboardShortcuts:true,
    styles:[{elementType:'geometry',stylers:[{color:'#151b27'}]},{elementType:'labels.text.fill',stylers:[{color:'#8290a3'}]},{elementType:'labels.text.stroke',stylers:[{color:'#151b27'}]},{featureType:'water',elementType:'geometry',stylers:[{color:'#080f19'}]},{featureType:'road',elementType:'geometry',stylers:[{color:'#293342'}]},{featureType:'poi',stylers:[{visibility:'off'}]}]});
   overlay=new g.maps.OverlayView();overlay.onAdd=()=>{};overlay.onRemove=()=>{};overlay.draw=()=>{projection.current=overlay.getProjection();};overlay.setMap(map.current);
   listener=map.current.addListener('click',(e:any)=>{
    if(!e.latLng)return;
    const point={lat:e.latLng.lat(),lng:e.latLng.lng()};
    const c=current.current;
    if(!c.drawing)c.onFocus(point);
   });
   setReady(true);
  }).catch(()=>{if(!cancelled)setError('Google Maps is unavailable. The labelled 1 ha test area and manual controls still work.');});
  return()=>{cancelled=true;listener?.remove();overlay?.setMap(null);projection.current=null;if(map.current)window.google?.maps?.event.clearInstanceListeners(map.current);map.current=null;};
 },[city.slug]);
 useEffect(()=>{if(ready)map.current.panTo(focus);},[focus,ready]);
 useEffect(()=>{if(!ready||!geometry.length)return;const bounds=new gRef.current.maps.LatLngBounds();geometry.forEach(p=>bounds.extend(p));map.current.fitBounds(bounds,{top:100,right:45,bottom:105,left:75});},[ready,geometry]);
 useEffect(()=>{if(!ready)return;if(drawing&&map.current.getZoom()<17)map.current.setZoom(17);map.current.setOptions({draggableCursor:drawing?'crosshair':null,mapTypeId:satellite?'satellite':'roadmap',disableDoubleClickZoom:drawing,gestureHandling:drawing?'none':'greedy',keyboardShortcuts:!drawing});},[ready,drawing,satellite]);
 useEffect(()=>{
  if(!ready)return;
  const g=gRef.current, overlays:any[]=[],outline=geometry.length?geometry:null;
  if(outline) {
   const color=baseline?'#94a3b8':colors[layer];
   const polygon=new g.maps.Polygon({map:map.current,paths:outline,strokeColor:color,strokeWeight:2,fillColor:color,fillOpacity:baseline ? .08 : result ? .22 : .08,clickable:false});
   overlays.push(polygon);
  }
  overlays.push(new g.maps.Marker({map:map.current,position:focus,clickable:false,icon:{path:g.maps.SymbolPath.CIRCLE,scale:5,fillColor:'#ffffff',fillOpacity:1,strokeColor:'#5eead4',strokeWeight:2}}));
  return()=>overlays.forEach(o=>o.setMap(null));
 },[ready,geometry,focus,layer,baseline,result]);
 const pointerPosition=(e:PointerEvent<HTMLDivElement>)=>{
  const b=e.currentTarget.getBoundingClientRect();
  return {point:{x:e.clientX-b.left,y:e.clientY-b.top},size:{width:b.width,height:b.height}};
 };
 const finish=(e:PointerEvent<HTMLDivElement>)=>{
  const active=drag.current;if(!active||active.pointerId!==e.pointerId)return;
  drag.current=null;setSelection(null);
  if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  try{
   if(!projection.current)throw new Error('Wait for the map to finish loading, then drag again.');
   const {point,size}=pointerPosition(e);
   const corners=snipCorners(active.start,point,size,p=>{
    const ll=projection.current.fromContainerPixelToLatLng(new gRef.current.maps.Point(p.x,p.y));
    if(!ll)throw new Error('Could not locate this selection. Drag again.');
    return {lat:ll.lat(),lng:ll.lng()};
   });
   setSelectionError('');onSelectArea(corners);
  }catch(e){setSelectionError(e instanceof Error?e.message:'Could not select this area.');}
 };
 return <><style jsx>{`
  @keyframes snip-dash { to { stroke-dashoffset: -20; } }
  .snip-outline { animation: snip-dash 1s linear infinite; }
  @media (prefers-reduced-motion: reduce) { .snip-outline { animation: none; } }
 `}</style><div ref={element} className="absolute inset-0" aria-label={`${city.name} urban sandbox map`} />
  {drawing&&<div role="region" aria-label="Drag to select study area" className="absolute inset-0 z-[5] overflow-hidden cursor-crosshair touch-none select-none"
   onPointerDown={e=>{
    if(e.button!==0||!e.isPrimary)return;
    e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
    const {point,size}=pointerPosition(e);drag.current={start:point,pointerId:e.pointerId};setSelectionError('');setSelection(snipRectangle(point,point,size));
   }}
   onPointerMove={e=>{if(drag.current?.pointerId!==e.pointerId)return;const {point,size}=pointerPosition(e);setSelection(snipRectangle(drag.current.start,point,size));}}
   onPointerUp={finish} onPointerCancel={()=>{drag.current=null;setSelection(null);}} onLostPointerCapture={()=>{drag.current=null;setSelection(null);}}>
   {selection?<>
    <div className="absolute border border-signal-300/60 bg-signal-300/5" style={{left:selection.left,top:selection.top,width:selection.width,height:selection.height,boxShadow:'0 0 0 9999px rgba(0,0,0,.48)'}}/>
    <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true"><rect className="snip-outline" x={selection.left} y={selection.top} width={selection.width} height={selection.height} fill="none" stroke="#5eead4" strokeWidth="2" strokeDasharray="6 4"/></svg>
    {selection.width>40&&selection.height>25&&<span className="absolute rounded bg-ink-0/90 px-2 py-1 text-[10px] mono text-signal-300 pointer-events-none" style={{left:selection.left+5,top:selection.top+5}}>{Math.round(selection.width)} × {Math.round(selection.height)} px</span>}
   </>:<div className="absolute inset-0 bg-black/15 pointer-events-none"/>}
  </div>}
  {(error||selectionError)&&<div role="status" className="absolute z-10 left-16 right-3 bottom-16 v2-panel p-3 text-xs text-amber-200">{selectionError||error}</div>}
 </>;
}
