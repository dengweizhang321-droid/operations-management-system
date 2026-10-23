import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {publishPreparedMain,piWorkspaceImage,piNativeImage,releaseLeaseTtlMs} from '../tools/publish-prepared-main.mjs';
import {monitoringSchema,tmallSchema,tmall148Schema,piAgentSchema,piWorkspaceSchema} from '../tools/main-schema-release.mjs';

async function fixture(t,components=['worker'],failAt=null){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'prepared-publisher-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const events=[],out=path.join(root,'out'),installed=path.join(root,'django','app'),runtime=path.join(root,'worker');
 const leaseFile=path.join(root,'django','run','release-publication-lease.json'),leaseReadings=[];
 let head={releaseId:'old',manifestSha256:'1'.repeat(64)},django='2'.repeat(64),successes=0,readyStatus=200,readyBody={ok:true,status:'ready'};
 const target={releaseId:'new',manifestSha256:'3'.repeat(64)};
 const event=name=>{events.push(name);if(name===failAt)throw Error('fixture failure: '+name);};
 const readLease=async action=>{
  try{
   const stat=await fs.stat(leaseFile);
   if(!stat.isFile())return;
   leaseReadings.push({action,lease:JSON.parse(await fs.readFile(leaseFile,'utf8'))});
  }catch(error){if(error.code!=='ENOENT')throw error;}
 };
 const request={mainCommit:'a'.repeat(40),components,predecessorWorker:{...head},predecessorDjangoSha256:django};
 const context={source:root,out,installedRoot:installed,workerRuntimeRoot:runtime,deployOnly:false,
  sourceIdentity:async()=>({commit:request.mainCommit,tree:'b'.repeat(40)}),
  maintenanceReadiness:async()=>{event('readiness');return {route:'fixture',sourcePins:Object.fromEntries(['manual-maintenance-start.ps1','manual-maintenance-lock.psm1','manual-maintenance-continuation.ps1','manual-maintenance-continuation.mjs','publish-prepared-main.mjs','publish-main-command.mjs'].map(name=>[name,'4'.repeat(64)]))};},
  sha:async file=>file===path.join(installed,'deployment.json')?django:path.basename(file).startsWith('app.prepare-')?'9'.repeat(64):'4'.repeat(64),
  progress:{begin(){},complete(){},log(){},success(){event('success');successes++;}},
  api:{workerRuntimeRoot:runtime,workerPreparationIdentity:async()=>{event('identity');return {fixture:true};},workerSourceBindingVersion:'fixture',windowsPathSha256:()=> '5'.repeat(64),canonicalJson:JSON.stringify},
  rotation:{withRotationLock:async cb=>{event('lock');return cb({fixture:true});},assertActiveBatchOwnership:async()=>event('ownership'),resolveEffectiveReleaseChain:async()=>{event('head');return {head:{...head},chainStateSha256:'6'.repeat(64)};},
   planWorkerReleaseRotation:async options=>{event(options.reusePlanSha256?'reuse':'plan');assert.equal(options.prepareOnline,true);assert.ok(options.rotationLease.fixture);assert.match(options.sourceBindingSha256,/^[a-f0-9]{64}$/);return {status:'planned',planSha256:'7'.repeat(64),candidateReleaseId:target.releaseId,candidateManifestSha256:target.manifestSha256};},
   applyApprovedRotationPlan:async options=>{event('apply');assert.ok(options.rotationLease.fixture);head={...target};return {status:'activated',releaseId:head.releaseId};}},
  runStep:async({script,action,extra})=>{
   await readLease(action);
   if(path.basename(script)==='manual-maintenance-preflight.ps1')return {ready:true,route:'fixture'};
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
  fetch:async(url,options)=>{await readLease('ready');event('ready');assert.equal(options.headers['x-teruisi-local-health'],'1');return {status:readyStatus,json:async()=>{if(readyBody instanceof Error)throw readyBody;return readyBody;},body:{cancel:async()=>{}}};}
 };
 return {request,context,events,out,leaseFile,get leaseReadings(){return leaseReadings;},get successes(){return successes;},set head(value){head=value;},set django(value){django=value;},set readyStatus(value){readyStatus=value;},set readyBody(value){readyBody=value;}};
}
const operations=events=>events.filter(e=>!['lock','ownership','head','identity','readiness','success'].includes(e));
test('missing maintenance material fails before STARTED and the same prepared package can recheck',async t=>{
 const f=await fixture(t,['django']),original=f.context.sha;let missing=true;
 f.context.sha=async file=>{if(missing&&file===path.join(f.context.workerRuntimeRoot,'state/worker-process.json'))throw Error('missing material');return original(file);};
 await assert.rejects(publishPreparedMain(f.request,f.context),/missing material/);
 await assert.rejects(fs.access(path.join(f.out,'STARTED.json')));assert.ok(!f.events.includes('EnterMaintenance'));
 missing=false;assert.equal((await publishPreparedMain(f.request,f.context)).status,'deployed_and_ready');
 assert.equal(f.events.filter(e=>e==='PrepareApp').length,1);
 const directory=(await fs.readdir(f.out)).find(name=>name.startsWith('publication-materials-'));
 const inventory=JSON.parse(await fs.readFile(path.join(f.out,directory,'inventory.json'),'utf8'));
 assert.equal(inventory.diagnosticOnly,true);assert.equal(inventory.mainCommit,f.request.mainCommit);assert.equal(inventory.preparation.reused,true);
});
test('known read-only preflight failure retains its attempt and can recheck the same prepared package before STARTED',async t=>{
 const f=await fixture(t,['django']);const original=f.context.runStep;let checks=0;
 f.context.runStep=async args=>{if(path.basename(args.script)==='manual-maintenance-preflight.ps1'&&++checks===1)throw Error('visibility unavailable');return original(args);};
 await assert.rejects(publishPreparedMain(f.request,f.context),/visibility unavailable/);await assert.rejects(fs.access(path.join(f.out,'STARTED.json')));
 assert.ok(!f.events.includes('EnterMaintenance'));
 assert.equal((await publishPreparedMain(f.request,f.context)).status,'deployed_and_ready');assert.equal(checks,2);
 const attempts=(await fs.readdir(f.out)).filter(name=>name.startsWith('maintenance-preflight-'));assert.equal(attempts.length,2);
});
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

test('Runner source-only release prepares and adopts the bound Runner without a schema migration',async t=>{
 const f=await fixture(t,['worker','django']);
 f.request.releasePlan={changes:[{status:'M',path:'backend/pi_runner/server.py'}]};
 const original=f.context.runStep;
 const upgrade={prepared:true,started:false,registeredPlanSha256:'c'.repeat(64),sourceSha256:'d'.repeat(64),image:piNativeImage};
 f.context.runStep=async args=>{
  const value=await original(args);
  if(args.action==='PreparePiUpgrade'){
   assert.equal(args.extra[args.extra.indexOf('-PiSkillVersion')+1],'1.3.0');
   assert.equal(args.extra[args.extra.indexOf('-PiImage')+1],piNativeImage);
   assert.equal(args.extra[args.extra.indexOf('-PiPreparedAppId')+1],'8'.repeat(32));
   return upgrade;
  }
  if(args.action==='PiUpgradeCheck')return {...upgrade,checked:true};
  if(args.action==='UpgradePi')return {...upgrade,upgraded:true,windowsConfigUpdated:true,sameDpapiOwner:true};
  return value;
 };
 await publishPreparedMain(f.request,{...f.context,prepareOnly:true});
 assert.ok(f.events.includes('PreparePiUpgrade'));
 assert.ok(!f.events.includes('EnterMaintenance')&&!f.events.includes('UpgradePi'));
 const receipt=await publishPreparedMain(f.request,{...f.context,deployOnly:true});
 assert.equal(receipt.status,'deployed_and_ready');
 assert.equal(receipt.migration,null);
 assert.equal(receipt.piRunnerUpgrade.sourceSha256,upgrade.sourceSha256);
 assert.equal(f.events.filter(e=>e==='PreparePiUpgrade').length,1);
 assert.equal(f.events.filter(e=>e==='PrepareApp').length,1);
 assert.equal(f.events.filter(e=>e==='UpgradePi').length,1);
 assert.ok(f.events.indexOf('DeployApp')<f.events.indexOf('UpgradePi'));
 assert.ok(f.events.indexOf('UpgradePi')<f.events.indexOf('Start'));
});

for(const state of ['windows_complete','reconcile_available','blocked'])test('UpgradePi catch exact state '+state+' never reapplies the upgrade',async t=>{
 const f=await fixture(t,['worker','django']);f.request.releasePlan={changes:[{path:'backend/pi_runner/server.py'}]};
 const original=f.context.runStep,prepared={prepared:true,started:false,operationId:'e'.repeat(32),planSha256:'f'.repeat(64),registeredPlanSha256:'c'.repeat(64),sourceSha256:'d'.repeat(64),image:piNativeImage};
 const receipt={...prepared,upgraded:true,windowsConfigUpdated:true,sameDpapiOwner:true};
 f.context.runStep=async args=>{
  const value=await original(args);
  if(args.action==='PreparePiUpgrade')return prepared;
  if(args.action==='PiUpgradeCheck')return {...prepared,checked:true};
  if(args.action==='UpgradePi')throw Error('private native output failure');
  if(args.action==='PiUpgradeStatus')return {...prepared,status:state,reason:'private_blocked'};
  if(args.action==='VerifyPiUpgradeResult')return {...prepared,status:'windows_complete',postconditionsVerified:true,upgradeReceipt:receipt};
  if(args.action==='ReconcilePiUpgrade')return receipt;
  return value;
 };
 if(state==='blocked'){await assert.rejects(publishPreparedMain(f.request,f.context),/private native output failure/);assert.ok(!f.events.includes('Start'));}
 else assert.equal((await publishPreparedMain(f.request,f.context)).status,'deployed_and_ready');
 assert.equal(f.events.filter(e=>e==='UpgradePi').length,1);assert.equal(f.events.filter(e=>e==='ReconcilePiUpgrade').length,state==='reconcile_available'?1:0);assert.ok(await fs.stat(path.join(f.out,'PiUpgrade-original-failure.json')));
});
test('release lease covers preparation, reverification, Start and ready with bounded refreshes',async t=>{
 const f=await fixture(t,['worker','django']);
 await publishPreparedMain(f.request,{...f.context,prepareOnly:true});
 await assert.rejects(fs.access(f.leaseFile),'prepared-only must remove its lease');
 f.leaseReadings.length=0;
 const result=await publishPreparedMain(f.request,{...f.context,deployOnly:true});
 assert.equal(result.status,'deployed_and_ready');
 const readings=f.leaseReadings;
 assert.ok(readings.some(r=>r.action==='VerifyPreparedApp'),'reverification must observe the lease');
 assert.ok(readings.some(r=>r.action==='Start'),'Start must observe the lease');
 assert.ok(readings.some(r=>r.action==='ready'),'final readiness must observe the lease');
 const createdAt=readings[0].lease.createdAt;
 for(const {action,lease} of readings){
  assert.equal(lease.version,'teruisi-release-publication-lease-v1',action);
  assert.equal(lease.ownerPid,process.pid,action);
  assert.equal(lease.mainCommit,f.request.mainCommit,action);
  assert.match(lease.maintenanceId,/^[a-f0-9]{32}$/,action);
  assert.equal(lease.out,f.out,action);
  assert.equal(lease.createdAt,createdAt,action);
  assert.ok(Date.parse(lease.updatedAt)>=Date.parse(createdAt),action);
  assert.equal(Date.parse(lease.expiresAt)-Date.parse(lease.updatedAt),releaseLeaseTtlMs,action);
 }
 assert.ok(releaseLeaseTtlMs>=15*60*1000&&releaseLeaseTtlMs<=20*60*1000,'lease TTL must stay between 15 and 20 minutes');
 for(let index=1;index<readings.length;index++)assert.ok(Date.parse(readings[index].lease.updatedAt)>=Date.parse(readings[index-1].lease.updatedAt),'lease updates must not move backwards');
 await assert.rejects(fs.access(f.leaseFile),'successful publication must remove its lease');
});
test('release lease is removed after preparation and deployment exceptions',async t=>{
 const prepared=await fixture(t,['django'],'PrepareApp');
 await assert.rejects(publishPreparedMain(prepared.request,{...prepared.context,prepareOnly:true}),/fixture failure/);
 await assert.rejects(fs.access(prepared.leaseFile),'preparation exception must remove its lease');
 const deployed=await fixture(t,['worker','django'],'Start');
 await publishPreparedMain(deployed.request,{...deployed.context,prepareOnly:true});
 await assert.rejects(publishPreparedMain(deployed.request,{...deployed.context,deployOnly:true}),/fixture failure/);
 await assert.rejects(fs.access(deployed.leaseFile),'deployment exception must remove its lease');
});
test('release lease write failure records a warning and never blocks publication',async t=>{
 const f=await fixture(t,['worker','django']);
 await fs.mkdir(f.leaseFile,{recursive:true});
 const result=await publishPreparedMain(f.request,f.context);
 assert.equal(result.status,'deployed_and_ready');
 const warning=JSON.parse(await fs.readFile(path.join(f.out,'LEASE-WARNING.json'),'utf8'));
 assert.equal(warning.version,'teruisi-release-lease-warning-v1');
 assert.equal(warning.fallback,'original-maintenance-drain-gate');
 assert.ok(warning.attempts>=1);
 assert.ok(warning.error);
 assert.deepEqual(await fs.readdir(f.leaseFile),[]);
});
test('migration requests fail before any engine or result write',async t=>{
 const f=await fixture(t,['django']);f.request.migrate=true;
 await assert.rejects(publishPreparedMain(f.request,f.context),/结构发布/);assert.deepEqual(f.events,[]);
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
test('omitted programmatic mode also refuses inline preparation',async t=>{
 const f=await fixture(t,['worker','django']);delete f.context.deployOnly;
 await assert.rejects(publishPreparedMain(f.request,f.context),/尚未准备好/);
 assert.deepEqual(operations(f.events),[]);
 await assert.rejects(fs.access(path.join(f.out,'STARTED.json')));
});
for(const failure of ['identity','plan','PrepareApp'])test('preparation failure '+failure+' preserves preparation evidence without a deployment STARTED',async t=>{
 const f=await fixture(t,['worker','django'],failure);let failed;
 await assert.rejects(publishPreparedMain(f.request,{...f.context,prepareOnly:true}).catch(error=>{failed=error;throw error;}),/fixture failure/);
 await assert.rejects(fs.access(path.join(f.out,'STARTED.json')));await assert.rejects(fs.access(path.join(f.out,'SUCCESS.json')));
 const files=await fs.readdir(path.join(f.out,'preparation'));assert.ok(files.some(n=>n.startsWith('FAILED-')));
 // S05d: the prepare-only entry binds exactly this receipt into its structured result.
 assert.equal(path.resolve(path.dirname(failed.preparationFailureFile)),path.resolve(f.out,'preparation'));assert.ok(files.includes(path.basename(failed.preparationFailureFile)));assert.ok(typeof failed.preparationPhase==='string'&&failed.preparationPhase.length>0);
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

async function migrationFixture(t,failAt=null,schema=monitoringSchema){
 const f=await fixture(t,['worker','django'],failAt);
 f.request.migrate=true;f.request.releasePlan={migrate:true};
 f.request.schemaRelease={...schema,recipeSha256:'a'.repeat(64),evidencePath:path.join(f.context.source,'evidence.json'),evidenceSha256:'b'.repeat(64),validationSha256:'c'.repeat(64),codeSha256:'d'.repeat(64)};
 f.context.verifySchemaRelease=async()=>{f.events.push('schema-check');};
 const native=f.context.runStep;f.ids=[];
 f.context.runStep=async args=>{
  if(['Plan','Install','Finalize'].includes(args.action)){
   f.events.push(args.action);if(args.action===failAt)throw Error('fixture failure: '+failAt);
   assert.equal(args.addJson,false);assert.ok(args.extra.includes('-SchemaOnly'));assert.ok(args.extra.includes(schema.additionKind));
   f.ids.push({operation:args.extra[args.extra.indexOf('-OperationId')+1],maintenance:args.extra[args.extra.indexOf('-MaintenanceId')+1]});
   return args.action==='Plan'?{status:'verified',result:{status:'prepared'}}:{status:'verified',result:{status:args.action==='Install'?'schema_installed':'verified',migrationCount:schema.toGeneration,steps:schema.steps}};
  }
  if(args.action==='PrepareApp')assert.deepEqual(args.extra,['-IntegrationEvidencePath',f.request.schemaRelease.evidencePath,'-IntegrationEvidenceSha256',f.request.schemaRelease.evidenceSha256]);
  if(args.action==='DeployApp')assert.ok(args.extra.includes('-IntegrationOperationId'));
  return native(args);
 };
 return f;
}
test('148 preparation never migrates; manual deployment binds original operation and native receipts',async t=>{
 const f=await migrationFixture(t);await publishPreparedMain(f.request,{...f.context,prepareOnly:true});
 for(const forbidden of ['Plan','DeployApp','Install','Finalize','EnterMaintenance','apply','Start'])assert.ok(!f.events.includes(forbidden));
 await assert.rejects(fs.access(path.join(f.out,'STARTED.json')));f.events.length=0;
 const receipt=await publishPreparedMain(f.request,{...f.context,deployOnly:true});
 assert.deepEqual(operations(f.events).filter(n=>n!=='schema-check'),['reuse','VerifyPreparedApp','EnterMaintenance','Stop','Plan','DeployApp','HardenAcl','Install','Finalize','apply','ExitMaintenance','Start','VerifyStartup','ready']);
 const started=JSON.parse(await fs.readFile(path.join(f.out,'STARTED.json'),'utf8'));
 assert.ok(f.ids.every(id=>id.operation===started.operationId&&id.maintenance===started.maintenanceId));
 assert.equal(receipt.migration,monitoringSchema.steps[0]);assert.equal(receipt.schemaReceipt.operationId,started.operationId);assert.equal(receipt.schemaReceipt.finalized.result.migrationCount,148);
});
for(const failure of ['Plan','Install','Finalize'])test('148 failure at '+failure+' retains unknown publication and never replays',async t=>{
 const f=await migrationFixture(t,failure);await publishPreparedMain(f.request,{...f.context,prepareOnly:true});f.events.length=0;
 await assert.rejects(publishPreparedMain(f.request,{...f.context,deployOnly:true}),/fixture failure/);
 assert.ok(!f.events.includes('apply'));assert.ok(!f.events.includes('ExitMaintenance'));await assert.rejects(fs.access(path.join(f.out,'SUCCESS.json')));
 f.events.length=0;await assert.rejects(publishPreparedMain(f.request,{...f.context,deployOnly:true}),/结果未知/);assert.ok(!f.events.includes('Install'));
});
test('schema evidence drift during reuse is rejected before maintenance',async t=>{
 const f=await migrationFixture(t);await publishPreparedMain(f.request,{...f.context,prepareOnly:true});f.events.length=0;
 let checks=0;f.context.verifySchemaRelease=async()=>{if(++checks===2)throw Error('schema evidence drift');};
 await assert.rejects(publishPreparedMain(f.request,{...f.context,deployOnly:true}),/evidence drift/);
 assert.ok(!f.events.includes('EnterMaintenance'));await assert.rejects(fs.access(path.join(f.out,'STARTED.json')));
});

for(const schema of [tmallSchema,tmall148Schema])test('finite149 parent '+schema.fromGeneration+' provisions exact roles before finalization and never during prepare',async t=>{
 const f=await migrationFixture(t,null,schema);await publishPreparedMain(f.request,{...f.context,prepareOnly:true});
 assert.ok(!f.events.includes('ProvisionRoles'));f.events.length=0;
 const result=await publishPreparedMain(f.request,{...f.context,deployOnly:true});
 assert.ok(f.events.indexOf('Install')<f.events.indexOf('ProvisionRoles'));
 assert.ok(f.events.indexOf('ProvisionRoles')<f.events.indexOf('Finalize'));
 assert.equal(result.schemaReceipt.finalized.result.migrationCount,149);
 assert.deepEqual(result.schemaReceipt.release.steps,schema.steps);
});
for(const failure of ['Install','ProvisionRoles','Finalize'])test('149 '+failure+' failure preserves unknown and stops the remaining chain',async t=>{
 const f=await migrationFixture(t,failure,tmallSchema);await publishPreparedMain(f.request,{...f.context,prepareOnly:true});f.events.length=0;
 await assert.rejects(publishPreparedMain(f.request,{...f.context,deployOnly:true}),/fixture failure/);
 assert.ok(!f.events.includes('apply'));assert.ok(!f.events.includes('ExitMaintenance'));
 await assert.rejects(fs.access(path.join(f.out,'SUCCESS.json')));
 f.events.length=0;await assert.rejects(publishPreparedMain(f.request,{...f.context,deployOnly:true}),/结果未知/);
 assert.ok(!f.events.includes('Install'));
});

test('Pi150 provisions only its AI roles after Install and before Finalize',async t=>{
 const f=await migrationFixture(t,null,piAgentSchema),native=f.context.runStep;
 f.context.runStep=async args=>{
  if(args.action==='ProvisionRoles')assert.equal(path.basename(args.script),'django-ai.ps1');
  return native(args);
 };
 await publishPreparedMain(f.request,{...f.context,prepareOnly:true});
 assert.ok(!f.events.includes('ProvisionRoles'));f.events.length=0;
 const result=await publishPreparedMain(f.request,{...f.context,deployOnly:true});
 assert.ok(f.events.indexOf('Install')<f.events.indexOf('ProvisionRoles'));
 assert.ok(f.events.indexOf('ProvisionRoles')<f.events.indexOf('Finalize'));
 assert.equal(result.schemaReceipt.finalized.result.migrationCount,150);
});
test('Pi150 role provisioning uncertainty preserves the original operation without replay',async t=>{
 const f=await migrationFixture(t,'ProvisionRoles',piAgentSchema);
 await publishPreparedMain(f.request,{...f.context,prepareOnly:true});f.events.length=0;
 await assert.rejects(publishPreparedMain(f.request,{...f.context,deployOnly:true}),/fixture failure/);
 assert.ok(!f.events.includes('Finalize'));assert.ok(!f.events.includes('apply'));
 f.events.length=0;
 await assert.rejects(publishPreparedMain(f.request,{...f.context,deployOnly:true}),/结果未知/);
 assert.ok(!f.events.includes('Install'));assert.ok(!f.events.includes('ProvisionRoles'));
});

async function workspaceMigrationFixture(t, failAt=null) {
 const f=await migrationFixture(t,failAt,piWorkspaceSchema), native=f.context.runStep;
 const prepared={prepared:true,started:false,operationId:'e'.repeat(32),registeredPlanSha256:'f'.repeat(64),planSha256:'1'.repeat(64),sourceSha256:'2'.repeat(64),image:piWorkspaceImage};
 f.context.runStep=async args=>{
  if(['PreparePiUpgrade','PiUpgradeCheck','UpgradePi'].includes(args.action)){
   f.events.push(args.action);if(args.action===failAt)throw Error('fixture failure: '+failAt);
   if(args.action==='PreparePiUpgrade'){assert.deepEqual(args.extra,['-PiImage',piWorkspaceImage,'-PiPreparedAppId','8'.repeat(32),'-PiPreparedAppSha256','9'.repeat(64)]);return prepared;}
   if(args.action==='PiUpgradeCheck'){assert.deepEqual(args.extra,['-PiUpgradePlanSha256',prepared.registeredPlanSha256,'-PiPreparedAppId','8'.repeat(32),'-PiPreparedAppSha256','9'.repeat(64)]);return {...prepared,checked:true};}
   assert.deepEqual(args.extra,['-PiUpgradePlanSha256',prepared.registeredPlanSha256]);
   assert.equal(args.script,path.join(f.context.installedRoot,'tools/django-ai.ps1'));
   return {upgraded:true,windowsConfigUpdated:true,sameDpapiOwner:true,sourceSha256:prepared.sourceSha256,image:prepared.image};
  }
  return native(args);
 };
 return f;
}
test('Pi151 prepares the independent Runner without starting it and upgrades after schema before service start',async t=>{
 const f=await workspaceMigrationFixture(t);await publishPreparedMain(f.request,{...f.context,prepareOnly:true});
 assert.ok(f.events.includes('PreparePiUpgrade'));assert.ok(f.events.includes('PiUpgradeCheck'));
 for(const event of ['UpgradePi','Install','DeployApp','Start','EnterMaintenance'])assert.ok(!f.events.includes(event));
 const prepared=JSON.parse(await fs.readFile(path.join(f.out,'preparation/PREPARED.json'),'utf8'));assert.equal(prepared.piRunnerUpgrade.image,piWorkspaceImage);
 f.events.length=0;const result=await publishPreparedMain(f.request,{...f.context,deployOnly:true});
 assert.ok(f.events.indexOf('PiUpgradeCheck')<f.events.indexOf('EnterMaintenance'));
 assert.ok(f.events.indexOf('Finalize')<f.events.indexOf('UpgradePi'));
 assert.ok(f.events.indexOf('UpgradePi')<f.events.indexOf('apply'));
 assert.ok(f.events.indexOf('UpgradePi')<f.events.indexOf('Start'));
 assert.equal(result.piRunnerUpgrade.upgraded,true);assert.ok(!f.events.includes('PreparePiUpgrade'));
});
test('Pi151 upgrade failure keeps the original publication unknown and never starts or replays',async t=>{
 const f=await workspaceMigrationFixture(t,'UpgradePi');await publishPreparedMain(f.request,{...f.context,prepareOnly:true});f.events.length=0;
 await assert.rejects(publishPreparedMain(f.request,{...f.context,deployOnly:true}),/fixture failure/);
 assert.ok(!f.events.includes('apply'));assert.ok(!f.events.includes('Start'));
 f.events.length=0;await assert.rejects(publishPreparedMain(f.request,{...f.context,deployOnly:true}),/结果未知/);assert.ok(!f.events.includes('UpgradePi'));
});
test('Pi151 failed upgrade preparation check cannot publish PREPARED or enter maintenance',async t=>{
 const f=await workspaceMigrationFixture(t,'PiUpgradeCheck');await assert.rejects(publishPreparedMain(f.request,{...f.context,prepareOnly:true}),/fixture failure/);
 await assert.rejects(fs.access(path.join(f.out,'preparation/PREPARED.json')));assert.ok(!f.events.includes('EnterMaintenance'));
});
test('non-canonical preparation source spelling is normalized before the Worker source binding',async t=>{
 const f=await fixture(t,['worker']);f.context.source='D:/fixture/source/';
 await publishPreparedMain(f.request,{...f.context,prepareOnly:true});
 const binding=JSON.parse(await fs.readFile(path.join(f.out,'preparation/source-binding.json'),'utf8'));
 assert.equal(binding.sourceRoot,'D:\\fixture\\source');
});
test('predecessor qualification runs before expensive reused-package verification',async t=>{
 const f=await fixture(t,['worker','django']);
 await publishPreparedMain(f.request,{...f.context,prepareOnly:true});
 f.events.length=0;
 await publishPreparedMain(f.request,{...f.context,deployOnly:true});
 assert.equal(f.events.filter(e=>e==='readiness').length,2);
 assert.ok(f.events.indexOf('readiness')<f.events.indexOf('reuse'));
 assert.ok(f.events.indexOf('readiness')<f.events.indexOf('VerifyPreparedApp'));
});
