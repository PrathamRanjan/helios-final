import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {NextRequest} from 'next/server';
async function main(){
 const original=process.cwd(),dir=await mkdtemp(path.join(tmpdir(),'helios-drafts-'));
 try{
  process.chdir(dir);
  const {updateDrafts,readDrafts,readDoc,listDocs}=require('../lib/compass/compliance/drafts');
  await Promise.all(Array.from({length:8},(_,i)=>updateDrafts((drafts:any[])=>{drafts.push({id:`d${i}`,status:'pending'});} )));
  assert.equal((await readDrafts()).length,8);
  assert.deepEqual(await listDocs(),[]);
  // Point the local source directory at a private temporary folder, not a shared /tmp path.
  process.env.HELIOS_POLICY_PAGES_DIR=path.join(dir,'pages');await mkdir(process.env.HELIOS_POLICY_PAGES_DIR,{recursive:true});
  await writeFile(path.join(process.env.HELIOS_POLICY_PAGES_DIR,'test_doc.json'),JSON.stringify({title:'Test',file:'test.pdf',pages:[{page:1,text:'A source page.'}]}));
  assert.equal((await listDocs())[0].slug,'test_doc');assert.equal((await readDoc('test_doc')).title,'Test');
  await assert.rejects(()=>readDoc('../escape'));
  const {POST}=require('../app/api/rules/review/route');
  const req=(id:string,status:string)=>new NextRequest('http://localhost/api/rules/review',{method:'POST',body:JSON.stringify({id,status})});
  await Promise.all([POST(req('d0','approved')),POST(req('d1','rejected'))]);
  const drafts=await readDrafts();assert.equal(drafts[0].status,'approved');assert.equal(drafts[1].status,'rejected');
  assert.equal((await POST(req('missing','approved'))).status,404);
  console.log('Rule persistence: atomic additions/reviews, missing sources, source loading and slug boundaries passed.');
 }finally{delete process.env.HELIOS_POLICY_PAGES_DIR;process.chdir(original);await rm(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
