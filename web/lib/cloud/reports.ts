import {promises as fs} from 'fs';
import path from 'path';
import {readObject,writeObject} from './storage';
export const REPORT_TYPES:Record<string,string>={'before.jpg':'image/jpeg','after.png':'image/png','satellite.png':'image/png','report.json':'application/json'};
export function reportLocation(id:string,asset:string){
 if(!/^[A-Za-z0-9_-]{1,160}$/.test(id)||!Object.hasOwn(REPORT_TYPES,asset))throw new Error('Invalid report asset.');
 return {key:`reports/${id}/${asset}`,file:path.join(process.cwd(),'public','reports',id,asset)};
}
export async function readReportAsset(id:string,asset:string):Promise<Buffer|null>{
 const {key,file}=reportLocation(id,asset);const bytes=await readObject(key,file);
 if(bytes||!process.env.HELIOS_STORAGE_BUCKET)return bytes;
 // Frozen demo reports remain usable before their objects are seeded to the bucket.
 try{return await fs.readFile(file);}catch(e:any){if(e.code==='ENOENT')return null;throw e;}
}
export async function writeReportAsset(id:string,asset:string,bytes:Buffer|string){
 const {key,file}=reportLocation(id,asset);await writeObject(key,file,bytes,REPORT_TYPES[asset]);
}
