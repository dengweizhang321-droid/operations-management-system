/** Offline counterexamples only. No retirement provider or production control action. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {publishPreparedMain} from '../../tools/publish-prepared-main.mjs';
import {acquireQueueLock,canonical,sha,durableCreate} from '../../tools/main-prebuild-queue.mjs';
import {stableBytes,assertCensus,readPreparationResolution,resolutionVersion} from '../../tools/preparation-resolution.mjs';

async function privateRoot(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'retirement-boundary-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
async function publisherFixture(t){
 const root=await privateRoot(t),out=path.join(root,'publication'),installed=path.join(root,'django','app'),runtime=path.join(root,'worker');
 const head={releaseId:'old',manifestSha256:'1'.repeat(64)},request={mainCommit:'a'.repeat(40),components:['worker'],predecessorWorker:head,predecessorDjangoSha256:'2'.repeat(64)};
 let plans=0;const plan={status:'planned',planSha256:'3'.repeat(64),candidateReleaseId:'new',candidateManifestSha256:'4'.repeat(64)};
 const context={source:root,out,installedRoot:installed,workerRuntimeRoot:runtime,prepareOnly:true,sourceIdentity:async()=>({commit:request.mainCommit,tree:'b'.repeat(40)}),sha:async()=>request.predecessorDjangoSha256,
  api:{workerRuntimeRoot:runtime,workerPreparationIdentity:async()=>({fixture:true}),workerSourceBindingVersion:'private-fixture',windowsPathSha256:()=> '5'.repeat(64),canonicalJson:JSON.stringify},
  rotation:{withRotationLock:async operation=>operation({privateFixture:true}),assertActiveBatchOwnership:async()=>{},resolveEffectiveReleaseChain:async()=>({head,chainStateSha256:'6'.repeat(64)}),planWorkerReleaseRotation:async()=>{plans++;return plan;}}};
 return {root,out,request,context,plan,get plans(){return plans;}};
}

test('real old publisher refuses fresh re-entry with PREPARING but no PREPARED before candidate planning',async t=>{
 const f=await publisherFixture(t);await fs.mkdir(path.join(f.out,'preparation'),{recursive:true});await fs.writeFile(path.join(f.out,'preparation','PREPARING.json'),'original retained marker');
 await assert.rejects(publishPreparedMain(f.request,f.context),/未完成记录/);assert.equal(f.plans,0);
});
test('real old publisher already past PREPARING gate ignores a new fence and completes later writes',async t=>{
 const f=await publisherFixture(t);let reached;const entered=new Promise(resolve=>{reached=resolve;});let continuePlan;const continueSignal=new Promise(resolve=>{continuePlan=resolve;});
 f.context.rotation.planWorkerReleaseRotation=async()=>{reached();await continueSignal;return f.plan;};
 const pending=publishPreparedMain(f.request,f.context);await entered;
 const fence=path.join(f.out,'RETIREMENT-FENCE.json');await fs.writeFile(fence,JSON.stringify({privateProposedFence:true,epoch:1,retired:true}));continuePlan();
 const result=await pending;assert.equal(result.status,'prepared-only');assert.equal(JSON.parse(await fs.readFile(path.join(f.out,'preparation','worker-plan.json'))).planSha256,f.plan.planSha256);assert.equal(JSON.parse(await fs.readFile(path.join(f.out,'preparation','PREPARED.json'))).requestSha256,sha(Buffer.from(JSON.stringify(f.request))));assert.equal(JSON.parse(await fs.readFile(fence)).retired,true);
});
test('a released private named-pipe lock does not revoke an independent child writer or its open file handle',async t=>{
 const root=await privateRoot(t),file=path.join(root,'late.bin'),unlock=await acquireQueueLock(root);assert.ok(unlock);let child;
 const script=`const fs=require('node:fs');const fd=fs.openSync(process.argv[1],'wx');let open=true;process.once('disconnect',()=>{if(open){fs.closeSync(fd);open=false;}});process.send('open');process.once('message',()=>{fs.writeSync(fd,'late');fs.closeSync(fd);open=false;process.disconnect();});`;
 try{
  child=spawn(process.execPath,['-e',script,file],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
  await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>{if(code!==0)reject(Error('Private writer exited before ready'));});});
  await unlock();const second=await acquireQueueLock(root);assert.ok(second);try{await fs.writeFile(path.join(root,'NEW-FENCE.json'),'retired');const ended=new Promise((resolve,reject)=>{child.once('exit',code=>code===0?resolve():reject(Error('Private writer failed')));});child.send('continue');await ended;assert.equal(await fs.readFile(file,'utf8'),'late');}finally{await second();}
 }finally{if(child?.connected)child.disconnect();}
});
test('separate stable-byte SHA checks cannot distinguish an A to B to A change',async t=>{
 const root=await privateRoot(t),file=path.join(root,'pointer.json'),a=Buffer.from(canonical({generation:'A'}));await fs.writeFile(file,a);const first=sha(await stableBytes(file));await fs.writeFile(file,canonical({generation:'B'}));await fs.writeFile(file,a);const last=sha(await stableBytes(file));assert.equal(first,last);
});
test('existing observer fails closed for an opaque possible controller',()=>{
 const created='2026-10-22T07:00:00.000Z',writer={processId:111,creationDate:created,commandLine:'private writer',executablePath:'C:/private/node.exe'},observer={processId:222,creationDate:created,commandLine:'private observer',executablePath:'C:/private/node.exe'};
 const rows=[{...writer,parentProcessId:1,name:'node.exe'},{...observer,parentProcessId:2,name:'node.exe'},{processId:333,parentProcessId:0,name:'node.exe',creationDate:created,commandLine:null,executablePath:null}];assert.throws(()=>assertCensus(rows,{writer,observer,roots:['D:/private']}),/opaque/);
});
test('a proposed sealed resolution is not a valid resolution in the unchanged old reader',async t=>{
 const root=await privateRoot(t),dispatch={dispatchId:'11111111-1111-1111-1111-111111111111'};await fs.mkdir(path.join(root,'resolutions'));await durableCreate(path.join(root,'resolutions',dispatch.dispatchId+'.json'),{version:resolutionVersion,decision:'retired-reconciled-and-sealed'});
 await assert.rejects(readPreparationResolution(root,dispatch,{status:'unknown'}),/Unknown resolution decision/);
});
