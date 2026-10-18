import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {NextRequest} from 'next/server';
async function main(){
 const original=process.cwd(),dir=await mkdtemp(path.join(tmpdir(),'helios-reports-'));
 try{
  process.chdir(dir);
  const {readReportAsset,writeReportAsset}=require('../lib/cloud/reports');
  const {GET}=require('../app/api/reports/[id]/[asset]/route');
  await writeReportAsset('site_1','before.jpg',Buffer.from('image'));
  assert.equal((await readReportAsset('site_1','before.jpg')).toString(),'image');
  assert.equal(await readReportAsset('missing','before.jpg'),null);
  await assert.rejects(()=>readReportAsset('../outside','before.jpg'));
  await assert.rejects(()=>readReportAsset('site_1','../.env'));
  const response=await GET(new NextRequest('http://localhost/api/reports/site_1/before.jpg'),{params:{id:'site_1',asset:'before.jpg'}});
  assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/jpeg');
  assert.equal((await GET(new NextRequest('http://localhost/'),{params:{id:'..',asset:'report.json'}})).status,400);
  assert.equal((await GET(new NextRequest('http://localhost/'),{params:{id:'missing',asset:'report.json'}})).status,404);
  console.log('Report storage: durable-route assets, missing reports, content types and traversal boundaries passed.');
 }finally{process.chdir(original);await rm(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
