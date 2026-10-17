import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {publishPreparedMain} from '../tools/publish-prepared-main.mjs';

async function fixture(t,components=['worker'],failAt=null){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'prepared-publisher-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const events=[],out=path.join(root,'out'),installed=path.join(root,'django','app'),runtime=path.join(root,'worker');
 let head={releaseId:'old',manifestSha256:'1'.repeat(64)},django='2'.repeat(64),successes=0,readyStatus=200,readyBody={ok:true,status:'ready'};
 const target={releaseId:'new',manifestSha256:'3'.repeat(64)};
 const event=name=>{events.push(name);if(name===failAt)throw Error('fixture failure: '+name);};
 const request={mainCommit:'a'.repeat(40),components,predecessorWorker:{...head},predecessorDjangoSha256:django};
 const context={source:root,out,installedRoot:installed,workerRuntimeRoot:runtime,
  sourceIdentity:async()=>({commit:request.mainCommit,tree:'b'.repeat(40)}),
  sha:async file=>file===path.join(installed,'deployment.json')?django:path.basename(file).startsWith('app.prepare-')?'9'.repeat(64):'4'.repeat(64),
  progress:{begin(){},complete(){},log(){},success(){event('success');successes++;}},
  api:{workerRuntimeRoot:runtime,workerPreparationIdentity:async()=>{event('identity');return {fixture:true};},workerSourceBindingVersion:'fixture',windowsPathSha256:()=> '5'.repeat(64),canonicalJson:JSON.stringify},
  rotation:{withRotationLock:async cb=>{event('lock');return cb({fixture:true});},assertActiveBatchOwnership:async()=>event('ownership'),resolveEffectiveReleaseChain:async()=>{event('head');return {head:{...head},chainStateSha256:'6'.repeat(64)};},
   planWorkerReleaseRotation:async options=>{event(options.reusePlanSha256?'reuse':'plan');assert.equal(options.prepareOnline,true);assert.ok(options.rotationLease.fixture);assert.match(options.sourceBindingSha256,/^[a-f0-9]{64}$/);return {status:'planned',planSha256:'7'.repeat(64),candidateReleaseId:target.releaseId,candidateManifestSha256:target.manifestSha256};},
   applyApprovedRotationPlan:async options=>{event('apply');assert.ok(options.rotationLease.fixture);head={...target};return {status:'activated',releaseId:head.releaseId};}},
  runStep:async({script,action,extra})=>{
   event(action);
   if(action==='PrepareApp')return {id:'8'.repeat(32),receiptSha256:'9'.repeat(64)};
   if(action==='VerifyPreparedApp')return {status:'prepared_verified',id:'8'.repeat(32)};
   if(action==='DeployApp'){django='4'.repeat(64);return null;}
   const maintenanceId=extra[extra.indexOf('-MaintenanceId')+1];
   if(action==='EnterMaintenance'){
    assert.equal(path.basename(script),'manual-maintenance-start.ps1');
    const admission=JSON.parse(await fs.readFile(extra[extra.indexOf('-InputPath')+1],'utf8'));
    return {status:'maintenance',maintenanceId:admission.maintenanceId,postgresPreserved:true};
   }
   if(action==='BeginWorkerDrain')return {status:'worker_drained',maintenanceId,drainConfirmed:true,backendStopped:false};
   if(action==='EndWorkerDrain')return {status:'worker_drain_ended',maintenanceId};
   if(action==='ExitMaintenance')return {status:'maintenance_ended',maintenanceId};
   if(action==='Start'){
    assert.equal(script,path.join(runtime,'releases',head.releaseId,'tools/worker-local-service.ps1'));
    if(!components.includes('django'))assert.deepEqual(extra,['-BackendStartPolicy','RequireReady']);
    return {status:'started',manifestSha256:head.manifestSha256};
   }
   if(action==='VerifyStartup')return {startupVerified:true};
   return {};
  },
  fetch:async(url,options)=>{event('ready');assert.equal(options.headers['x-teruisi-local-health'],'1');return {status:readyStatus,json:async()=>{if(readyBody instanceof Error)throw readyBody;return readyBody;},body:{cancel:async()=>{}}};}
 };
 return {request,context,events,out,get successes(){return successes;},set head(value){head=value;},set django(value){django=value;},set readyStatus(value){readyStatus=value;},set readyBody(value){readyBody=value;}};
}
const operations=events=>events.filter(e=>!['lock','ownership','head','identity','success'].includes(e));
test('worker-only calls the real engine boundaries in order without preparing or stopping Django',async t=>{
 const f=await fixture(t);const receipt=await publishPreparedMain(f.request,f.context);
 assert.deepEqual(operations(f.events),['plan','BeginWorkerDrain','StopForRelease','apply','Start','EndWorkerDrain','VerifyStartup','ready']);
 assert.equal(receipt.mainCommit,f.request.mainCommit);assert.equal(receipt.djangoManifestSha256,f.request.predecessorDjangoSha256);assert.equal(f.successes,1);
 const saved=JSON.parse(await fs.readFile(path.join(f.out,'SUCCESS.json'),'utf8'));assert.equal(saved.sourceTree,'b'.repeat(40));
});
test('django-only keeps old Worker and never prepares or applies a Worker release',async t=>{
 const f=await fixture(t,['django']);const result=await publishPreparedMain(f.request,f.context);
 assert.deepEqual(operations(f.events),['PrepareApp','EnterMaintenance','Stop','DeployApp','HardenAcl','ExitMaintenance','Start','VerifyStartup','ready']);
 assert.equal(result.workerRelease,'old');assert.equal(result.djangoManifestSha256,'4'.repeat(64));assert.ok(!f.events.includes('identity'));
 await assert.rejects(fs.access(path.join(f.out,'source-binding.json')));
});
test('combined uses full native maintenance without any migration operator',async t=>{
 const f=await fixture(t,['worker','django']);await publishPreparedMain(f.request,f.context);
 assert.deepEqual(operations(f.events),['plan','PrepareApp','EnterMaintenance','Stop','DeployApp','HardenAcl','apply','ExitMaintenance','Start','VerifyStartup','ready']);
});
test('migration requests fail before any engine or result write',async t=>{
 const f=await fixture(t,['django']);f.request.migrate=true;
 await assert.rejects(publishPreparedMain(f.request,f.context),/结构迁移/);assert.deepEqual(f.events,[]);
 await assert.rejects(fs.access(f.out));
});
test('existing SUCCESS only reports current when target and both live bindings match',async t=>{
 const f=await fixture(t);await publishPreparedMain(f.request,f.context);f.events.length=0;
 const current=await publishPreparedMain(f.request,f.context);assert.equal(current.status,'already-current');assert.deepEqual(operations(f.events),['ready']);
 assert.equal(f.successes,1,'already-current must not announce another successful publish');
 f.request.mainCommit='c'.repeat(40);await assert.rejects(publishPreparedMain(f.request,f.context),/旧成功凭证/);
 f.request.mainCommit='a'.repeat(40);f.head={releaseId:'other',manifestSha256:'3'.repeat(64)};await assert.rejects(publishPreparedMain(f.request,f.context),/当前Worker/);
 f.head={releaseId:'new',manifestSha256:'3'.repeat(64)};f.django='changed';await assert.rejects(publishPreparedMain(f.request,f.context),/当前Django/);
});
test('existing STARTED never retries an unknown result',async t=>{
 const f=await fixture(t);await fs.mkdir(f.out);await fs.writeFile(path.join(f.out,'STARTED.json'),'{}');
 await assert.rejects(publishPreparedMain(f.request,f.context),/结果未知/);assert.deepEqual(operations(f.events),[]);assert.equal(f.successes,0);
});
for(const failure of ['BeginWorkerDrain','StopForRelease','apply','Start','EndWorkerDrain','VerifyStartup','ready'])test('failure at '+failure+' retains FAILED and never retries or writes success',async t=>{
 const f=await fixture(t,['worker'],failure);await assert.rejects(publishPreparedMain(f.request,f.context),/fixture failure/);
 assert.equal(f.successes,0);await assert.rejects(fs.access(path.join(f.out,'SUCCESS.json')));
 const failed=JSON.parse(await fs.readFile(path.join(f.out,'FAILED.json'),'utf8'));assert.equal(failed.automaticRetry,false);
 const prior=f.events.length;await assert.rejects(publishPreparedMain(f.request,f.context),/结果未知/);
 assert.deepEqual(operations(f.events.slice(prior)),[]);
 assert.ok(!f.events.includes('CancelDrain'));assert.ok(!f.events.includes('ExitMaintenance'));
});
for(const failure of ['EnterMaintenance','Stop','DeployApp','HardenAcl','apply','ExitMaintenance','Start'])test('full maintenance failure at '+failure+' stops without replay or automatic cleanup',async t=>{
 const f=await fixture(t,['worker','django'],failure);await assert.rejects(publishPreparedMain(f.request,f.context),/fixture failure/);
 assert.equal(f.successes,0);assert.equal(f.events.filter(e=>e===failure).length,1);
 assert.equal(f.events.at(-1),failure);await assert.rejects(fs.access(path.join(f.out,'SUCCESS.json')));
 assert.equal(JSON.parse(await fs.readFile(path.join(f.out,'FAILED.json'),'utf8')).automaticRetry,false);
 const prior=f.events.length;await assert.rejects(publishPreparedMain(f.request,f.context),/结果未知/);assert.deepEqual(operations(f.events.slice(prior)),[]);
});
test('unready HTTP or final Django drift cannot save SUCCESS',async t=>{
 const f=await fixture(t);f.readyStatus=503;await assert.rejects(publishPreparedMain(f.request,f.context),/服务尚未就绪/);await assert.rejects(fs.access(path.join(f.out,'SUCCESS.json')));
 const g=await fixture(t);const native=g.context.runStep;g.context.runStep=async args=>{const result=await native(args);if(args.action==='VerifyStartup')g.django='changed';return result;};
 await assert.rejects(publishPreparedMain(g.request,g.context),/最终后台manifest/);await assert.rejects(fs.access(path.join(g.out,'SUCCESS.json')));
});
test('HTTP 200 with HTML or non-ready JSON never saves SUCCESS',async t=>{
 for(const body of [new SyntaxError('HTML instead of JSON'),{ok:false,status:'ready'},{ok:true,status:'notready'}]){
  const f=await fixture(t);f.readyBody=body;
  await assert.rejects(publishPreparedMain(f.request,f.context));assert.equal(f.successes,0);
  await assert.rejects(fs.access(path.join(f.out,'SUCCESS.json')));
 }
});
test('real Fetch Response consumed by JSON can publish successfully',async t=>{
 const f=await fixture(t);
 const response=new Response(JSON.stringify({ok:true,status:'ready'}),{status:200,headers:{'content-type':'application/json'}});
 f.context.fetch=async(url,options)=>{
  f.events.push('ready');assert.equal(options.headers['x-teruisi-local-health'],'1');return response;
 };
 const receipt=await publishPreparedMain(f.request,f.context);
 assert.equal(response.bodyUsed,true);assert.equal(receipt.status,'deployed_and_ready');assert.equal(f.successes,1);
 assert.equal(JSON.parse(await fs.readFile(path.join(f.out,'SUCCESS.json'),'utf8')).mainCommit,f.request.mainCommit);
 await assert.rejects(fs.access(path.join(f.out,'FAILED.json')));
});

for(const components of [['worker'],['django'],['worker','django']])test('prepare-only and deploy-only reuse exact '+components.join('+')+' artifacts',async t=>{
 const f=await fixture(t,components);
 const prepared=await publishPreparedMain(f.request,{...f.context,prepareOnly:true});
 assert.equal(prepared.status,'prepared-only');assert.equal(prepared.publicationPerformed,false);
 assert.deepEqual(operations(f.events),components.includes('worker')?(components.includes('django')?['plan','PrepareApp']:['plan']):['PrepareApp']);
 await assert.rejects(fs.access(path.join(f.out,'STARTED.json')));await assert.rejects(fs.access(path.join(f.out,'SUCCESS.json')));assert.equal(f.successes,0);
 f.events.length=0;await publishPreparedMain(f.request,{...f.context,prepareOnly:true});
 assert.ok(!f.events.includes('plan')&&!f.events.includes('PrepareApp'),'second preparation must reuse');
 assert.ok(!f.events.includes('apply')&&!f.events.includes('Start'));f.events.length=0;
 const success=await publishPreparedMain(f.request,{...f.context,deployOnly:true});
 assert.equal(success.status,'deployed_and_ready');assert.ok(!f.events.includes('plan')&&!f.events.includes('PrepareApp'));assert.equal(f.successes,1);
});
test('deploy-only without a prepared artifact never builds or starts publication',async t=>{
 const f=await fixture(t,['worker','django']);
 await assert.rejects(publishPreparedMain(f.request,{...f.context,deployOnly:true}),/尚未准备好/);
 assert.deepEqual(operations(f.events),[]);await assert.rejects(fs.access(path.join(f.out,'STARTED.json')));
 await publishPreparedMain(f.request,{...f.context,prepareOnly:true});
});
for(const failure of ['identity','plan','PrepareApp'])test('preparation failure '+failure+' preserves preparation evidence without a deployment STARTED',async t=>{
 const f=await fixture(t,['worker','django'],failure);
 await assert.rejects(publishPreparedMain(f.request,{...f.context,prepareOnly:true}),/fixture failure/);
 await assert.rejects(fs.access(path.join(f.out,'STARTED.json')));await assert.rejects(fs.access(path.join(f.out,'SUCCESS.json')));
 const files=await fs.readdir(path.join(f.out,'preparation'));assert.ok(files.some(n=>n.startsWith('FAILED-')));
 const count=f.events.length;await assert.rejects(publishPreparedMain(f.request,{...f.context,prepareOnly:true}),/未完成记录/);
 assert.deepEqual(operations(f.events.slice(count)),[]);
});
test('source/request drift and native Worker reuse failure stop before maintenance',async t=>{
 const f=await fixture(t);await publishPreparedMain(f.request,{...f.context,prepareOnly:true});f.events.length=0;
 f.request.newInput=true;await assert.rejects(publishPreparedMain(f.request,{...f.context,deployOnly:true}),/请求已变化/);delete f.request.newInput;
 f.context.rotation.planWorkerReleaseRotation=async()=>{throw Error('native source/environment/cache mismatch');};
 await assert.rejects(publishPreparedMain(f.request,{...f.context,deployOnly:true}),/native source/);
 await assert.rejects(fs.access(path.join(f.out,'STARTED.json')));assert.ok(!f.events.includes('BeginWorkerDrain'));
});
