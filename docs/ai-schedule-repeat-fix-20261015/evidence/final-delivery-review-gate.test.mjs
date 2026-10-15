import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {waitForExecution} from './delivery-review-gate.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),exec=promisify(execFile);
async function fixture(){
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'ai-review-gate-'));
 const q=Buffer.from('{}\n'),ready=Buffer.from('{"ready":true}\n');
 await fs.writeFile(out+'/publication-request.json',q);await fs.writeFile(out+'/PREPARATION_READY.json',ready);
 const tuple={requestSha256:hash(q),readySha256:hash(ready),sourceCommit:'a'.repeat(40),workerManifestSha256:'b'.repeat(64),djangoManifestSha256:'c'.repeat(64),driverSha256:'d'.repeat(64)};
 const review={version:'ai-schedule-execution-review-v1',status:'passed',...tuple};
 async function signal(change={},raw){const text=raw??JSON.stringify({...review,...change})+'\n';await fs.writeFile(out+'/execution-review.json',text,{flag:'wx'});return hash(text);}
 async function execute(h,change={}){await fs.writeFile(out+'/EXECUTE.json',JSON.stringify({version:'ai-schedule-execute-v1',requestSha256:tuple.requestSha256,reviewSha256:h,...change})+'\n',{flag:'wx'});}
 return {out,tuple,signal,execute,options:()=>({out,tuple,startedAt:Date.now()-1000,deadline:Date.now()+500,intervalMs:2}),cleanup:()=>fs.rm(out,{recursive:true,force:true})};
}
test('exact review and root signal permit one action only; late reuse expires',async()=>{
 const f=await fixture();try{let stages=0;const h=await f.signal();await f.execute(h);const r=await waitForExecution(f.options());stages++;assert.equal(r.reviewSha256,h);assert.equal(stages,1);await assert.rejects(waitForExecution({...f.options(),deadline:Date.now()-1}),/expired/);assert.equal(stages,1);}finally{await f.cleanup();}
});
for(const change of [{status:'rejected'},{requestSha256:'e'.repeat(64)},{readySha256:'e'.repeat(64)},{sourceCommit:'e'.repeat(40)},{driverSha256:'e'.repeat(64)},{workerManifestSha256:'e'.repeat(64)},{djangoManifestSha256:'e'.repeat(64)},{extra:true}]){
 test('mismatched/rejected review is zero stages '+JSON.stringify(change),async()=>{const f=await fixture();try{let stages=0;const h=await f.signal(change);await f.execute(h);await assert.rejects(async()=>{await waitForExecution(f.options());stages++;});assert.equal(stages,0);}finally{await f.cleanup();}});
}
test('missing signal times out without starting a stage',async()=>{const f=await fixture();try{await assert.rejects(waitForExecution({...f.options(),deadline:Date.now()+15}),/prepared-not-published/);}finally{await f.cleanup();}});
test('duplicate JSON keys, wrong execute digest, stale timestamp and changed READY all reject',async()=>{
 for(const kind of ['duplicate','execute','stale','ready','hardlink']){const f=await fixture();try{
  const h=await f.signal({},kind==='duplicate'?'{"status":"rejected","status":"passed"}\n':undefined);await f.execute(h,kind==='execute'?{reviewSha256:'f'.repeat(64)}:{});
  if(kind==='stale')await fs.utimes(f.out+'/execution-review.json',new Date(0),new Date(0));
  if(kind==='ready')await fs.writeFile(f.out+'/PREPARATION_READY.json','changed');
  if(kind==='hardlink')await fs.link(f.out+'/execution-review.json',f.out+'/extra-link');
  await assert.rejects(waitForExecution(f.options()));
 }finally{await f.cleanup();}}
});
test('exact approval cannot suppress final CAS drift or trigger retries',async()=>{const f=await fixture();try{const h=await f.signal();await f.execute(h);let stageCount=0,predecessor='changed';await assert.rejects(async()=>{await waitForExecution(f.options());assert.equal(predecessor,'expected');stageCount++;});assert.equal(stageCount,0);}finally{await f.cleanup();}});
test('original rotation lease stays private and exclusive through prepare/review/publish and releases in finally',async()=>{
 const file='D:/codex-isolated/ai-schedule-repeat-fix-20261015-v2/source/tools/worker-local-release-rotation.mjs';
 const original=await fs.readFile(file,'utf8'),pipe='\\\\.\\pipe\\AI.ScheduleFollowup.Test.'+randomUUID();
 // Test-only module: same original lease/lock implementation; only isolated
 // namespace/import origins and a private inspection export are substituted.
 let source=original.replace(/from "(\.\/[^\"]+)"/g,(_,p)=>'from '+JSON.stringify(pathToFileURL(path.resolve(path.dirname(file),p)).href));
 source=source.replace('const modulePath = fileURLToPath(import.meta.url);','const modulePath = '+JSON.stringify(file)+';');
 source=source.replace(/const rotationLockPipe = .*?;/,'const rotationLockPipe = '+JSON.stringify(pipe)+';');
 source+='\nexport {lockForOperation as inspectLeaseForTest};\n';
 const load=tail=>import('data:text/javascript;base64,'+Buffer.from(source+tail).toString('base64'));
 const a=await load(''),b=await load('\n// independent module instance');let saved,prepareCount=0,publishCount=0;
 const peer=async()=>{const r=await exec(process.execPath,['-e',"const n=require('node:net'),s=n.createServer();s.once('error',e=>{console.log(e.code);});s.listen("+JSON.stringify(pipe)+",()=>{console.log('acquired');s.close();});"],{windowsHide:true});return r.stdout.trim();};
 await a.withRotationLock(async lease=>{saved=lease;await a.inspectLeaseForTest(lease);prepareCount++;assert.equal(await peer(),'EADDRINUSE');await assert.rejects(b.inspectLeaseForTest(lease),/Invalid or expired/);await assert.rejects(a.inspectLeaseForTest({}),/Invalid or expired/);await a.inspectLeaseForTest(lease);publishCount++;});
 assert.equal(prepareCount,1);assert.equal(publishCount,1);await assert.rejects(a.inspectLeaseForTest(saved),/Invalid or expired/);assert.equal(await peer(),'acquired');
 await assert.rejects(a.withRotationLock(async()=>{throw Error('fixture unknown');}),/fixture unknown/);assert.equal(await peer(),'acquired');
});
