import {Storage} from '@google-cloud/storage';
import {promises as fs} from 'fs';
import path from 'path';
import {randomUUID} from 'crypto';
let client:Storage;
const locks=new Map<string,Promise<unknown>>();
const missing=(e:any)=>e?.code===404||e?.code==='ENOENT';
function objectKey(key:string){
 if(!key||key.startsWith('/')||key.includes('\\')||key.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Invalid storage object key.');
 return key;
}
function cloud(){const name=process.env.HELIOS_STORAGE_BUCKET?.trim();return name?(client??=new Storage()).bucket(name):null;}
export async function readObject(key:string,localPath:string):Promise<Buffer|null>{
 objectKey(key);const bucket=cloud();
 try{return bucket?(await bucket.file(key).download())[0]:await fs.readFile(localPath);}catch(e){if(missing(e))return null;throw e;}
}
export async function writeObject(key:string,localPath:string,data:Buffer|string,contentType:string){
 objectKey(key);const bucket=cloud();
 if(bucket){await bucket.file(key).save(data,{resumable:false,metadata:{contentType,cacheControl:'private, no-store'}});return;}
 await fs.mkdir(path.dirname(localPath),{recursive:true});const temporary=`${localPath}.${randomUUID()}.tmp`;
 try{await fs.writeFile(temporary,data);await fs.rename(temporary,localPath);}finally{await fs.rm(temporary,{force:true});}
}
export async function listObjects(prefix:string,localDir:string):Promise<string[]>{
 objectKey(prefix.replace(/\/$/,''));const bucket=cloud();
 if(bucket){const [files]=await bucket.getFiles({prefix});return files.map(f=>f.name.slice(prefix.length)).filter(name=>name&&!name.includes('/'));}
 try{return await fs.readdir(localDir);}catch(e){if(missing(e))return [];throw e;}
}
/** Mutators may run again on a cloud conflict; keep their side effects idempotent. */
export async function mutateJson<T,R>(key:string,localPath:string,initial:T,mutate:(data:T)=>R|Promise<R>):Promise<R>{
 objectKey(key);const bucket=cloud();
 if(bucket){
  for(let attempt=0;attempt<8;attempt++){
   let generation:string|number=0,data:T=structuredClone(initial);
   try{
    const [meta]=await bucket.file(key).getMetadata();generation=meta.generation!;
    try{const [bytes]=await bucket.file(key,{generation}).download();data=JSON.parse(bytes.toString());}catch(e){if(missing(e))continue;throw e;}
   }catch(e){if(!missing(e))throw e;}
   const result=await mutate(data);
   try{await bucket.file(key).save(JSON.stringify(data,null,1),{resumable:false,preconditionOpts:{ifGenerationMatch:generation},metadata:{contentType:'application/json',cacheControl:'private, no-store'}});return result;}
   catch(e:any){if(e?.code!==412)throw e;}
  }
  throw new Error('The saved data changed repeatedly. Please retry your update.');
 }
 const previous=locks.get(localPath)||Promise.resolve();
 const next=previous.catch(()=>{}).then(async()=>{
  const bytes=await readObject(key,localPath),data:T=bytes?JSON.parse(bytes.toString()):structuredClone(initial);
  const result=await mutate(data);await writeObject(key,localPath,JSON.stringify(data,null,1),'application/json');return result;
 });
 locks.set(localPath,next);
 try{return await next;}finally{if(locks.get(localPath)===next)locks.delete(localPath);}
}
