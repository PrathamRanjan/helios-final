import assert from 'node:assert/strict';
import React from 'react';
import Module from 'node:module';

// Exercise the native map boundary without WebGL or a new browser-test dependency.
async function main() {
  const effects: (() => any)[] = [];
  const refs: {current:any}[] = [];
  const picks: any[] = [];
  const geocodes: ((value:any)=>void)[] = [];
  let refIndex=0;
  let map: any;
  class FakeMap {
    style={}; listeners: Record<string,Function>={};
    constructor(){ map=this; }
    addEventListener(name:string,fn:Function){this.listeners[name]=fn;}
    removeEventListener(name:string){delete this.listeners[name];}
    flyCameraTo(){} remove(){} appendChild(){}
  }
  const maps={importMaps3D:async()=>({Map3DElement:FakeMap}),loadGoogleMaps:async()=>({maps:{Geocoder:class { geocode(){return new Promise(resolve=>geocodes.push(resolve));} }}})};
  const originalLoad=(Module as any)._load;
  const originalReact=(globalThis as any).React;
  const originalFrame=globalThis.requestAnimationFrame;
  const originalCancel=globalThis.cancelAnimationFrame;
  (globalThis as any).React=React;
  globalThis.requestAnimationFrame=()=>1;
  globalThis.cancelAnimationFrame=()=>{};
  const mockReact={...React,useRef:(initial:any)=>{const i=refIndex++;return refs[i]??(refs[i]={current:i===0?{appendChild(){}}:initial});},useState:(v:any)=>[v,()=>{}],useEffect:(fn:any)=>effects.push(fn)};
  (Module as any)._load=function(id:string,...args:any[]){if(id==='react')return mockReact;if(id==='@/lib/google-maps')return maps;return originalLoad.call(this,id,...args);};
  try {
    const Map3D=require('../components/Map3D').default;
    Map3D({target:null,onPickLocation:(p:any)=>picks.push(p)});
    const disposers=effects.map(fn=>fn());
    await new Promise(resolve=>setImmediate(resolve));
    const first=map.listeners['gmp-click']({position:{lat:12.97,lng:77.59}});
    const second=map.listeners['gmp-click']({position:{lat:12.98,lng:77.60}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(geocodes.length,2,'Legacy callers still receive address resolution');
    geocodes[1]({results:[{formatted_address:'Latest roof'}]});await second;
    geocodes[0]({results:[{formatted_address:'Old roof'}]});await first;
    assert.deepEqual(picks,[{lat:12.98,lng:77.60,address:'Latest roof'}]);
    disposers.forEach(fn=>{if(typeof fn==='function')fn();});
    assert.equal(map.listeners['gmp-click'],undefined,'Remove listeners on unmount');
    console.log('India map: address context preserved, stale clicks ignored, listeners cleaned up.');
  } finally {(Module as any)._load=originalLoad;(globalThis as any).React=originalReact;globalThis.requestAnimationFrame=originalFrame;globalThis.cancelAnimationFrame=originalCancel;}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
