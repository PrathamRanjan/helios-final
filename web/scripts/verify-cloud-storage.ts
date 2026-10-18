import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Module from 'node:module';
const objects=new Map<string,{data:Buffer;generation:number}>();let seq=0,denied=false,conflict=false;
let beforeSave:((name:string)=>void)|undefined;let failExport=false;
class File {
 constructor(public name:string,public options:any={}){}
 async download(){if(denied)throw Object.assign(new Error('denied'),{code:403});const o=objects.get(this.name);if(!o||(this.options.generation&&String(o.generation)!==String(this.options.generation)))throw Object.assign(new Error('missing'),{code:404});return [o.data];}
 async getMetadata(){const [data]=await this.download();return [{generation:String(objects.get(this.name)!.generation),size:data.length}];}
 async save(data:any,opts:any){beforeSave?.(this.name);if(failExport&&this.name.startsWith('rules/candidates/'))throw new Error('export unavailable');if(conflict){conflict=false;const old=objects.get(this.name)!;objects.set(this.name,{data:Buffer.from(JSON.stringify({n:JSON.parse(old.data.toString()).n+10})),generation:++seq});}
 const actual=objects.get(this.name)?.generation||0;
 if(opts.preconditionOpts&&String(opts.preconditionOpts.ifGenerationMatch)!==String(actual))throw Object.assign(new Error('conflict'),{code:412});objects.set(this.name,{data:Buffer.from(data),generation:++seq});}
}
const bucket={file:(key:string,opts?:any)=>new File(key,opts),getFiles:async({prefix}:any)=>[Array.from(objects.keys()).filter(k=>k.startsWith(prefix)).map(name=>({name}))]};
const originalLoad=(Module as any)._load;
(Module as any)._load=function(id:string,...args:any[]){if(id==='@google-cloud/storage')return {Storage:class{bucket(){return bucket;}}};return originalLoad.call(this,id,...args);};
async function main(){
 const old=process.env.HELIOS_STORAGE_BUCKET;const dir=await mkdtemp(path.join(tmpdir(),'helios-store-'));
 try{
  const {readObject,writeObject,mutateJson,listObjects}=require('../lib/cloud/storage');
  delete process.env.HELIOS_STORAGE_BUCKET;
  const file=path.join(dir,'counter.json');assert.equal(await readObject('counter.json',file),null);
  await Promise.all(Array.from({length:12},()=>mutateJson('counter.json',file,{n:0},(d:any)=>{d.n++;})));
  assert.equal(JSON.parse(await readFile(file,'utf8')).n,12);
  process.env.HELIOS_STORAGE_BUCKET='test';
  assert.equal(await readObject('counter.json',file),null,'cloud missing must not silently return local data');
  await writeObject('counter.json',file,Buffer.from('{"n":1}'),'application/json');
  conflict=true;await mutateJson('counter.json',file,{n:0},(d:any)=>{d.n++;});
  assert.equal(JSON.parse((await readObject('counter.json',file)).toString()).n,12,'CAS retry must use latest data');
  await Promise.all(Array.from({length:4},()=>mutateJson('counter.json',file,{n:0},(d:any)=>{d.n++;})));
  assert.equal(JSON.parse((await readObject('counter.json',file)).toString()).n,16);
  await writeObject('policy-pages/test.json',file,Buffer.from('{}'),'application/json');
  assert.deepEqual(await listObjects('policy-pages/',dir),['test.json']);
  denied=true;await assert.rejects(()=>readObject('counter.json',file),/denied/);denied=false;
  await assert.rejects(()=>writeObject('../escape',file,Buffer.from('x'),'text/plain'));
  const {NextRequest}=require('next/server');
  const {POST}=require('../app/api/rules/promote/route');
  const request=()=>new NextRequest('http://localhost/api/rules/promote',{method:'POST',body:JSON.stringify({id:'promotion-test'})});
  const draft={id:'promotion-test',doc:'unknown_source',docTitle:'Test',page:1,title:'Example draft',kind:'requirement',quote:'Example',quote_verified:true,status:'approved',created:'2026-10-18'};
  const seed=()=>objects.set('rules/drafts.json',{data:Buffer.from(JSON.stringify({drafts:[draft]})),generation:++seq});
  seed();beforeSave=name=>{if(name==='rules/drafts.json'){beforeSave=undefined;objects.set(name,{data:Buffer.from(JSON.stringify({drafts:[{...draft,status:'rejected'}]})),generation:++seq});}};
  assert.equal((await POST(request())).status,400);
  assert.equal([...objects.keys()].filter(k=>k.startsWith('rules/candidates/')).length,0,'rejected CAS retry must not leave an export');
  seed();failExport=true;await assert.rejects(()=>POST(request()),/export unavailable/);
  assert.ok(JSON.parse(objects.get('rules/drafts.json')!.data.toString()).drafts[0].promotion,'failed export must retain a recoverable payload');
  failExport=false;assert.equal((await POST(request())).status,200);
  assert.equal([...objects.keys()].filter(k=>k.startsWith('rules/candidates/')).length,1);
  console.log('Promotion: concurrent rejection leaves no candidate; committed failed export is retryable.');
  console.log('Cloud storage: local atomic updates, cloud-only reads, concurrent CAS retries, listing, denied reads and key validation passed.');
 }finally{(Module as any)._load=originalLoad;if(old===undefined)delete process.env.HELIOS_STORAGE_BUCKET;else process.env.HELIOS_STORAGE_BUCKET=old;await rm(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
