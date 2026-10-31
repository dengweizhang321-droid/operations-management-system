import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {firstMaintenancePredecessor as k,assertFirstMaintenanceContinuation,continueFirstMaintenance,isFirstMaintenancePredecessor,assertMaintenanceControllerGeneration,piNativeCandidateDjangoScriptSha256,aDescendantCreationGuardDjangoScriptSha256,sales154SchemaAdditionDjangoScriptSha256,batchedStatusEnumerationDjangoScriptSha256,workflowAutomationSchemaAdditionDjangoScriptSha256,catalogBaselineDjangoScriptSha256,bWorkerJsonFailureCauseScriptSha256,piNativeCandidateControllerSha256} from '../tools/manual-maintenance-continuation.mjs';
import {publishPreparedMain} from '../tools/publish-prepared-main.mjs';
// Execute the actual pure adapter declaration without importing release-impact's
// TypeScript-dependent deployment analysis into this dependency-free fixture.
async function loadProductionCommandArguments(){
 const actual=(await fs.readFile(new URL('../tools/release-batch.mjs',import.meta.url),'utf8')).match(/export function productionCommandArguments\(executable, args\) \{[\s\S]*?\n\}/)?.[0];
 const canonical=(await fs.readFile(new URL('../tools/release-impact.mjs',import.meta.url),'utf8')).match(/export function canonical\(value\) \{[\s\S]*?\n\}/)?.[0];
 assert.ok(actual&&canonical,'Actual pure adapter declarations must remain available');
 return new Function('path',canonical.replace('export ','')+'\n'+actual.replace('export ','')+'\nreturn productionCommandArguments;')(path);
}
const execute=promisify(execFile),id='a'.repeat(32),hash='b'.repeat(64);
const expected={maintenanceId:id,requestSha256:hash,startedSha256:hash,admissionSha256:hash,originalFailureSha256:hash};
function snapshot(){return {version:'manual-maintenance-continuation-v1',...k,...expected,sourceBound:true,rotationOwnerBound:true,originalActorBound:true,originalActorExited:true,controlParticipants:[],fullNativeStopScopeVerified:true,workerStatus:{state:'stopped',releaseId:k.releaseId,manifestSha256:k.workerManifestSha256},workerReceiptAbsent:true,applicationProcesses:[],postgresPreservedReady:true,downstreamEffects:[],maintenance:{version:'teruisi-system-maintenance-v1',id,runtimeRoot:'D:\\teruisi-runtime\\django-sales',keepPostgres:true},drain:{version:'teruisi-automation-drain-v1',id,runtimeRoot:'D:\\teruisi-runtime\\django-sales',keepPostgres:true,phase:'requests'},pandasConfigured:true,pandas:{distribution:'TERUISI-Pandas',user:'teruisi-pandas',unit:'teruisi-pandas.service',activeState:'inactive',subState:'dead',mainPid:0,controlPid:0,containers:[]},durableCompleteCommit:false};}
test('finite old pair only; native Stop exit0 is not a precondition or inferred claim',()=>{
 assert.equal(isFirstMaintenancePredecessor({releaseId:k.releaseId,manifestSha256:k.workerManifestSha256},k.djangoManifestSha256),true);
 assert.equal(isFirstMaintenancePredecessor({releaseId:k.releaseId,manifestSha256:hash},k.djangoManifestSha256),false);
 const value=snapshot();assert.equal(assertFirstMaintenanceContinuation(value,expected),'enter-same-id-once');
 assert.equal(value.originalStopExitCode,undefined);
 value.maintenance.drainedStopped=true;assert.throws(()=>assertFirstMaintenanceContinuation(value,expected));
 value.durableCompleteCommit=true;assert.equal(assertFirstMaintenanceContinuation(value,expected),'coordinate-completed');
});
test('reviewed Django controller generations preserve historical exceptions and match current source',async()=>{
 // The catalog-preflight bytes are the newly reviewed current controller; earlier
 // batched-status-enumeration, Sales154, PiNative and descendant-guard
 // qualifications stay registered. Future byte changes must be reviewed explicitly rather
 // than accepted by this static tripwire, so this compares against the
 // registered constant and never recomputes it from the file.
 const source=await fs.readFile(new URL('../tools/django-local-service.ps1',import.meta.url));
 assert.equal(createHash('sha256').update(source).digest('hex'),catalogBaselineDjangoScriptSha256);
 assert.notEqual(catalogBaselineDjangoScriptSha256,workflowAutomationSchemaAdditionDjangoScriptSha256);
 assert.notEqual(workflowAutomationSchemaAdditionDjangoScriptSha256,batchedStatusEnumerationDjangoScriptSha256);
 assert.notEqual(batchedStatusEnumerationDjangoScriptSha256,sales154SchemaAdditionDjangoScriptSha256);
 assert.notEqual(sales154SchemaAdditionDjangoScriptSha256,aDescendantCreationGuardDjangoScriptSha256);
 assert.notEqual(aDescendantCreationGuardDjangoScriptSha256,piNativeCandidateDjangoScriptSha256);
 const installed='d884882af114840ff1b0061c57439556cfc6a8fd7d0a751896363dd59eecde5d';
 assert.doesNotThrow(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:installed,expected:piNativeCandidateDjangoScriptSha256,candidateSha:piNativeCandidateDjangoScriptSha256}));
 assert.throws(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:installed,expected:piNativeCandidateDjangoScriptSha256,candidateSha:'e'.repeat(64)}),/不一致/);
 assert.throws(()=>assertMaintenanceControllerGeneration({name:'worker-local-service.ps1',installedSha:installed,expected:piNativeCandidateDjangoScriptSha256,candidateSha:piNativeCandidateDjangoScriptSha256}),/不一致/);
 assert.doesNotThrow(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:piNativeCandidateDjangoScriptSha256,expected:piNativeCandidateDjangoScriptSha256,candidateSha:piNativeCandidateDjangoScriptSha256}));
});
test('A项: descendant CreationDate guard candidate is qualified; other names and bytes still fail closed',()=>{
 // The installed controller is the PiNative-era one currently in production
 // (D:\teruisi-runtime\django-sales\app\tools\django-local-service.ps1 at the
 // time of writing); the candidate adds only the two reused-PID guard lines.
 const installed=piNativeCandidateDjangoScriptSha256;
 const candidate=aDescendantCreationGuardDjangoScriptSha256;
 const pins=[...piNativeCandidateControllerSha256['django-local-service.ps1']];
 // Both generations stay registered: forward (install old, ship new) and
 // backward (install new, ship old) must both be admissible so a rollback of
 // this change is not blocked by its own qualification entry.
 assert.deepEqual(pins,[piNativeCandidateDjangoScriptSha256,candidate,sales154SchemaAdditionDjangoScriptSha256,batchedStatusEnumerationDjangoScriptSha256,workflowAutomationSchemaAdditionDjangoScriptSha256,catalogBaselineDjangoScriptSha256]);
 assert.doesNotThrow(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:installed,expected:candidate,candidateSha:candidate}));
 assert.doesNotThrow(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:candidate,expected:piNativeCandidateDjangoScriptSha256,candidateSha:piNativeCandidateDjangoScriptSha256}));
 // An unqualified byte sequence for this controller still fails closed.
 assert.throws(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:installed,expected:candidate,candidateSha:'b'.repeat(64)}),/实际原生控制器代际与候选不一致：django-local-service\.ps1/);
 // Qualification is per controller: this hash does not leak to other names.
 for(const name of ['worker-local-service.ps1','process-deadline.ps1'])
  assert.throws(()=>assertMaintenanceControllerGeneration({name,installedSha:installed,expected:candidate,candidateSha:candidate}),/实际原生控制器代际与候选不一致：/);
});
test('Sales154: append exact qualification, retain old generation, and reject foreign or modified hashes',()=>{
 const old=aDescendantCreationGuardDjangoScriptSha256,candidate=sales154SchemaAdditionDjangoScriptSha256;
 assert.equal(old,'4ba1fcaf3cd1568a64098a9d2d32039f850ec2db1da4f81aa97fa3ab9530723a');
 assert.equal(candidate,'98028cb49195b7b145c74fdb5205e949e6152d065ce926265cd5773e8b00580b');
 assert.deepEqual([...piNativeCandidateControllerSha256['django-local-service.ps1']],[piNativeCandidateDjangoScriptSha256,old,candidate,batchedStatusEnumerationDjangoScriptSha256,workflowAutomationSchemaAdditionDjangoScriptSha256,catalogBaselineDjangoScriptSha256]);
 assert.doesNotThrow(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:old,expected:candidate,candidateSha:candidate}));
 assert.doesNotThrow(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:candidate,expected:old,candidateSha:old}));
 const changed=candidate.slice(0,-1)+(candidate.endsWith('0')?'1':'0');
 assert.throws(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:old,expected:changed,candidateSha:changed}),/不一致/);
 for(const name of ['worker-local-service.ps1','process-deadline.ps1','unknown.ps1'])
  assert.throws(()=>assertMaintenanceControllerGeneration({name,installedSha:old,expected:candidate,candidateSha:candidate}),/不一致/);
});
test('batched status enumeration: append exact qualification, retain Sales154, and reject foreign or modified hashes',()=>{
 // 94312406 (one batched Win32_Process enumeration for AggregateStatus) plus
 // 3cf4927f (wrap the whole if-expression in @() so a single-element array is
 // not unwrapped into a bare CimInstance). Both hashes are the registered
 // literals, not recomputed from the file, so a further controller edit fails
 // closed here until it is reviewed and qualified explicitly.
 const old=sales154SchemaAdditionDjangoScriptSha256,candidate=batchedStatusEnumerationDjangoScriptSha256;
 assert.equal(old,'98028cb49195b7b145c74fdb5205e949e6152d065ce926265cd5773e8b00580b');
 assert.equal(candidate,'fbb62792eb0962cb91b76b0045a08812d29de0dabb0ab9056ac9ce235d76bddb');
 assert.deepEqual([...piNativeCandidateControllerSha256['django-local-service.ps1']],[piNativeCandidateDjangoScriptSha256,aDescendantCreationGuardDjangoScriptSha256,old,candidate,workflowAutomationSchemaAdditionDjangoScriptSha256,catalogBaselineDjangoScriptSha256]);
 // Forward adoption (Sales154 installed, ship this) and backward rollback
 // (this installed, ship Sales154) must both be admissible, so reverting this
 // change is never blocked by its own qualification entry.
 assert.doesNotThrow(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:old,expected:candidate,candidateSha:candidate}));
 assert.doesNotThrow(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:candidate,expected:old,candidateSha:old}));
 // Every older registered generation stays admissible against these bytes.
 for(const earlier of [piNativeCandidateDjangoScriptSha256,aDescendantCreationGuardDjangoScriptSha256])
  assert.doesNotThrow(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:candidate,expected:earlier,candidateSha:earlier}));
 // An unqualified byte sequence for this controller still fails closed.
 const changed=candidate.slice(0,-1)+(candidate.endsWith('0')?'1':'0');
 assert.throws(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:old,expected:changed,candidateSha:changed}),/实际原生控制器代际与候选不一致：django-local-service\.ps1/);
 // Qualification stays per controller: this hash does not leak to other names.
 for(const name of ['worker-local-service.ps1','process-deadline.ps1','unknown.ps1'])
  assert.throws(()=>assertMaintenanceControllerGeneration({name,installedSha:old,expected:candidate,candidateSha:candidate}),/实际原生控制器代际与候选不一致：/);
});

test('Workflow156: append exact qualification, retain every older generation, and reject foreign or modified hashes',()=>{
 // The twelfth generation's schema-addition admission branch plus its four
 // verifier modules in PrepareApp's copy list. Both hashes are the registered
 // literals, not recomputed from the file, so a further controller edit fails
 // closed here until it is reviewed and qualified explicitly.
 const old=batchedStatusEnumerationDjangoScriptSha256,candidate=workflowAutomationSchemaAdditionDjangoScriptSha256;
 assert.equal(old,'fbb62792eb0962cb91b76b0045a08812d29de0dabb0ab9056ac9ce235d76bddb');
 assert.equal(candidate,'af6b3b4242f0863296f018d3908ce9d9e93a1d8ec89565e299c7dba16e6e279c');
 assert.deepEqual([...piNativeCandidateControllerSha256['django-local-service.ps1']],[piNativeCandidateDjangoScriptSha256,aDescendantCreationGuardDjangoScriptSha256,sales154SchemaAdditionDjangoScriptSha256,old,candidate,catalogBaselineDjangoScriptSha256]);
 // Forward adoption (batched-status installed, ship this) and backward
 // rollback (this installed, ship batched-status) must both be admissible, so
 // reverting this change is never blocked by its own qualification entry.
 assert.doesNotThrow(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:old,expected:candidate,candidateSha:candidate}));
 assert.doesNotThrow(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:candidate,expected:old,candidateSha:old}));
 // Every older registered generation stays admissible against these bytes.
 for(const earlier of [piNativeCandidateDjangoScriptSha256,aDescendantCreationGuardDjangoScriptSha256,sales154SchemaAdditionDjangoScriptSha256])
  assert.doesNotThrow(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:candidate,expected:earlier,candidateSha:earlier}));
 // An unqualified byte sequence for this controller still fails closed.
 const changed=candidate.slice(0,-1)+(candidate.endsWith('0')?'1':'0');
 assert.throws(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:old,expected:changed,candidateSha:changed}),/实际原生控制器代际与候选不一致：django-local-service\.ps1/);
 // Qualification stays per controller: this hash does not leak to other names.
 for(const name of ['worker-local-service.ps1','process-deadline.ps1','unknown.ps1'])
  assert.throws(()=>assertMaintenanceControllerGeneration({name,installedSha:old,expected:candidate,candidateSha:candidate}),/实际原生控制器代际与候选不一致：/);
});

test('B项: worker -Json failure-cause candidate is qualified; bytes match the repository controller',async()=>{
 // The repository worker controller must be exactly the registered B项 bytes,
 // so a further edit fails closed until re-qualified here.
 const source=await fs.readFile(new URL('../tools/worker-local-service.ps1',import.meta.url));
 assert.equal(createHash('sha256').update(source).digest('hex'),bWorkerJsonFailureCauseScriptSha256);
 const b1='83705551d9a9b2f3d2948d7b7eb8b41f3c6cfae5a8747949ffd8d6e3a4ee7058';
 const candidate=bWorkerJsonFailureCauseScriptSha256;
 assert.notEqual(candidate,b1);
 // Forward (install B1, ship B项) and backward (install B项, ship B1) adoption
 // must both pass so rolling this change back is not blocked by its own entry.
 assert.doesNotThrow(()=>assertMaintenanceControllerGeneration({name:'worker-local-service.ps1',installedSha:b1,expected:candidate,candidateSha:candidate}));
 assert.doesNotThrow(()=>assertMaintenanceControllerGeneration({name:'worker-local-service.ps1',installedSha:candidate,expected:b1,candidateSha:b1}));
 assert.throws(()=>assertMaintenanceControllerGeneration({name:'worker-local-service.ps1',installedSha:b1,expected:candidate,candidateSha:'d'.repeat(64)}),/实际原生控制器代际与候选不一致：worker-local-service\.ps1/);
 // Qualification stays per controller: this hash does not leak to other names.
 for(const name of ['django-local-service.ps1','process-deadline.ps1'])
  assert.throws(()=>assertMaintenanceControllerGeneration({name,installedSha:b1,expected:candidate,candidateSha:candidate}),/实际原生控制器代际与候选不一致：/);
});
test('S04a: A1-fixed candidate local-service is qualified against the installed 988810cf controller',()=>{
 // Exact witness bytes from the S04 refusal (FAILED-c8e0ea7a-…): the installed
 // controller shipped with 988810cf, the candidate controller with 559e64fd.
 const installed='c9e72fcc7d56282f7c5bcd5a56ee5c4f75005e74c2f23e0f229f4156496c6878';
 const candidate='65f057297208b32ac6d3c2e71a12016b1fd4afdc0ed7ea455fbda13181fffb61';
 assert.equal(piNativeCandidateDjangoScriptSha256,candidate);
 assert.doesNotThrow(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:installed,expected:candidate,candidateSha:candidate}));
 assert.throws(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:installed,expected:candidate,candidateSha:'a'.repeat(64)}),/实际原生控制器代际与候选不一致：django-local-service\.ps1/);
 assert.throws(()=>assertMaintenanceControllerGeneration({name:'worker-local-service.ps1',installedSha:installed,expected:candidate,candidateSha:candidate}),/实际原生控制器代际与候选不一致：worker-local-service\.ps1/);
 assert.throws(()=>assertMaintenanceControllerGeneration({name:'process-deadline.ps1',installedSha:installed,expected:candidate,candidateSha:candidate}),/实际原生控制器代际与候选不一致：process-deadline\.ps1/);
});
test('S05a: B1 worker controller is qualified per controller; other names still fail closed',()=>{
 // Exact B1 (codex/start-timing-20261022, 2dd8f23f) worker controller bytes and
 // the installed controller shipped with 4059afea.
 const installed='112b091b610b09187110ba478cfff2280b30705dd21e185a8132e683414ec2bc';
 const candidate='83705551d9a9b2f3d2948d7b7eb8b41f3c6cfae5a8747949ffd8d6e3a4ee7058';
 // B项 (2026-10-25) appended the -Json failure-cause generation after this B1
 // entry. The B1 hash must stay first so an installed B1-era worker controller
 // remains admissible; the set is asserted exactly, so any further worker
 // controller edit still fails closed until it is re-qualified.
 assert.deepEqual([...piNativeCandidateControllerSha256['worker-local-service.ps1']],[candidate,bWorkerJsonFailureCauseScriptSha256]);
 assert.doesNotThrow(()=>assertMaintenanceControllerGeneration({name:'worker-local-service.ps1',installedSha:installed,expected:candidate,candidateSha:candidate}));
 assert.throws(()=>assertMaintenanceControllerGeneration({name:'worker-local-service.ps1',installedSha:installed,expected:candidate,candidateSha:'c'.repeat(64)}),/实际原生控制器代际与候选不一致：worker-local-service\.ps1/);
 // Each name only owns its own hashes: the django generation is not a worker one, nor the reverse.
 assert.throws(()=>assertMaintenanceControllerGeneration({name:'worker-local-service.ps1',installedSha:installed,expected:candidate,candidateSha:piNativeCandidateDjangoScriptSha256}),/worker-local-service\.ps1/);
 assert.throws(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:installed,expected:candidate,candidateSha:candidate}),/django-local-service\.ps1/);
 assert.doesNotThrow(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:installed,expected:piNativeCandidateDjangoScriptSha256,candidateSha:piNativeCandidateDjangoScriptSha256}));
 // A registered name with no reviewed candidate still refuses every drift.
 assert.deepEqual([...piNativeCandidateControllerSha256['process-deadline.ps1']],[]);
 assert.throws(()=>assertMaintenanceControllerGeneration({name:'process-deadline.ps1',installedSha:installed,expected:candidate,candidateSha:candidate}),/process-deadline\.ps1/);
 // An unknown controller name is never a default allow.
 assert.throws(()=>assertMaintenanceControllerGeneration({name:'foo.ps1',installedSha:installed,expected:candidate,candidateSha:candidate}),/实际原生控制器代际与候选不一致：foo\.ps1/);
});
const failures={
 'wrong maintenance ID':s=>s.maintenance.id='c'.repeat(32),
 'coerced maintenance keepPG':s=>s.maintenance.keepPostgres='true',
 'maintenance array':s=>s.maintenance=[s.maintenance],
 'wrong native runtime root':s=>s.drain.runtimeRoot='D:\\private',
 'wrong request phase':s=>s.drain.phase='helpers',
 'coerced drainedStopped':s=>s.maintenance.drainedStopped=1,
 'source bytes changed':s=>s.sourceBound=false,
 'request drift':s=>s.requestSha256='d'.repeat(64),
 'rotation owner changed':s=>s.rotationOwnerBound=false,
 'no pre-bound actor':s=>s.originalActorBound=false,
 'original actor still alive':s=>s.originalActorExited=false,
 'late Report participant':s=>s.controlParticipants=[{action:'Report'}],
 'only vacant Windows ports':s=>s.fullNativeStopScopeVerified=false,
 'partial stopped services':s=>s.applicationProcesses=[{service:'ai-reader'}],
 'Worker supervisor receipt remains':s=>s.workerReceiptAbsent=false,
 'ambiguous native Worker state':s=>s.workerStatus.state='foreign_or_ambiguous',
 'owned PostgreSQL unknown':s=>s.postgresPreservedReady=false,
 'Linux observation unavailable':s=>s.pandas=null,
 'Linux service active':s=>s.pandas.activeState='active',
 'Linux containers unresolved':s=>s.pandas.containers=['container'],
 'wrong Linux user':s=>s.pandas.user='root',
 'unknown Pandas configuration':s=>delete s.pandasConfigured,
 'downstream deployment possible':s=>s.downstreamEffects=['DeployApp'],
 'old Django bytes changed':s=>s.djangoScriptSha256=hash,
 'completion evidence contradicts current state':s=>s.durableCompleteCommit=true
};
for(const [name,change] of Object.entries(failures))test(name+' fails closed',()=>{const value=snapshot();change(value);assert.throws(()=>assertFirstMaintenanceContinuation(value,expected));});
test('no Linux requirement is added when the original Stop has no configured Pandas',()=>{const value=snapshot();value.pandasConfigured=false;value.pandas=null;assert.equal(assertFirstMaintenanceContinuation(value,expected),'enter-same-id-once');});
for(const completed of [false,true])test('one in-call continuation '+(completed?'coordinates durable commit':'calls same-ID once')+'; no build/migrate/publisher seam',async()=>{
 const calls=[],value=snapshot();value.maintenance.drainedStopped=completed;value.durableCompleteCommit=completed;
 const result=await continueFirstMaintenance({admission:{...expected,source:'D:/private-source'},admissionPath:'D:/private-attempt/admission.json',admissionSha256:hash,originalFailureSha256:hash,recheck:async()=>calls.push('recheck'),step:async(label,script,action,extra)=>{
  calls.push(action);assert.equal(path.basename(script),'manual-maintenance-continuation.ps1');assert.ok(extra.includes(hash));
  return action==='Check'?value:{status:'maintenance',maintenanceId:id,postgresPreserved:true,continuationDecision:completed?'coordinate-completed':'enter-same-id-once',before:value};
 }});
 assert.equal(result.status,'maintenance');assert.deepEqual(calls,['recheck','Check','recheck','EnterMaintenance']);
});
test('bad fresh proof cannot reach continuation Enter; second failure is not retried',async()=>{
 const value=snapshot();value.originalActorExited=false;let calls=0;
 const options={admission:{...expected,source:'D:/private-source'},admissionPath:'D:/private-attempt/admission.json',admissionSha256:hash,originalFailureSha256:hash,recheck:async()=>{},step:async()=>{calls++;return value;}};
 await assert.rejects(continueFirstMaintenance(options));assert.equal(calls,1);
 value.originalActorExited=true;calls=0;options.step=async(label,script,action)=>{calls++;if(action==='Check')return value;throw Error('still locked');};
 await assert.rejects(continueFirstMaintenance(options),/still locked/);assert.equal(calls,2);
});

async function publisherFixture(t,negative=false){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'maintenance-private-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const source=path.join(root,'source'),out=path.join(root,'attempt'),runtime=path.join(root,'worker'),installed=path.join(root,'django/app');
 const head={releaseId:k.releaseId,manifestSha256:k.workerManifestSha256};let django=k.djangoManifestSha256;const events=[];
 const request={mainCommit:'a'.repeat(40),components:['django'],predecessorWorker:head,predecessorDjangoSha256:django};
 let admission;
 const context={source,out,installedRoot:installed,workerRuntimeRoot:runtime,sourceIdentity:async()=>({commit:request.mainCommit,tree:'c'.repeat(40)}),sha:async file=>file===path.join(installed,'deployment.json')?django:file.endsWith('django-local-service.ps1')?k.djangoScriptSha256:file.endsWith('worker-local-service.ps1')?k.workerScriptSha256:hash,api:{workerRuntimeRoot:runtime},rotation:{withRotationLock:async fn=>fn({}),assertActiveBatchOwnership:async()=>{},resolveEffectiveReleaseChain:async()=>({head,chainStateSha256:hash})},fetch:async()=>new Response(JSON.stringify({ok:true,status:'ready'})),runStep:async args=>{
  if(path.basename(args.script)==='manual-maintenance-preflight.ps1')return {ready:true,route:'legacy'};
  events.push(args.action);
  if(args.action==='PrepareApp')return {id:'d'.repeat(32),receiptSha256:hash};
  if(args.action==='EnterMaintenance'&&path.basename(args.script)==='manual-maintenance-start.ps1'){
   admission=JSON.parse(await fs.readFile(args.extra[1],'utf8'));
   await fs.writeFile(path.join(out,'maintenance-first-actor.json'),'{}');throw Error('original mutex contention');
  }
  if(path.basename(args.script)==='manual-maintenance-continuation.ps1'){
   const proof={...snapshot(),maintenanceId:admission.maintenanceId,maintenance:{...snapshot().maintenance,id:admission.maintenanceId},drain:{...snapshot().drain,id:admission.maintenanceId},requestSha256:admission.requestSha256,startedSha256:admission.startedSha256,admissionSha256:hash,originalFailureSha256:hash};
   if(negative)proof.controlParticipants=[{action:'Report'}];
   return args.action==='Check'?proof:{status:'maintenance',maintenanceId:admission.maintenanceId,postgresPreserved:true,continuationDecision:'enter-same-id-once',before:proof};
  }
  if(args.action==='DeployApp')django=hash;
  if(args.action==='ExitMaintenance')return {status:'maintenance_ended',maintenanceId:args.extra[1]};
  if(args.action==='Start')return {status:'started',manifestSha256:k.workerManifestSha256};
  if(args.action==='VerifyStartup')return {startupVerified:true};return {};
 }};
 context.maintenanceReadiness=async()=>({route:'legacy',sourcePins:Object.fromEntries(['manual-maintenance-start.ps1','manual-maintenance-lock.psm1','manual-maintenance-continuation.ps1','manual-maintenance-continuation.mjs','publish-prepared-main.mjs','publish-main-command.mjs'].map(name=>[name,hash]))});
 context.deployOnly=false;
 return {request,context,out,events};
}
test('publisher preserves original failure, then advances only after finite proof and native continuation',async t=>{
 const f=await publisherFixture(t);const result=await publishPreparedMain(f.request,f.context);
 assert.equal(result.status,'deployed_and_ready');assert.deepEqual(f.events,['PrepareApp','EnterMaintenance','Check','EnterMaintenance','Stop','DeployApp','HardenAcl','ExitMaintenance','Start','VerifyStartup']);
 const failed=JSON.parse(await fs.readFile(path.join(f.out,'maintenance-first-FAILED.json'),'utf8'));assert.equal(failed.error,'original mutex contention');assert.equal(failed.automaticRetry,false);
 assert.equal(await fs.readFile(path.join(f.out,'maintenance-first-actor.json'),'utf8'),'{}');
});
test('publisher late-actor rejection preserves unknown STARTED and cannot re-enter on another invocation',async t=>{
 const f=await publisherFixture(t,true);await assert.rejects(publishPreparedMain(f.request,f.context),/控制参与者/);
 assert.deepEqual(f.events,['PrepareApp','EnterMaintenance','Check']);const failed=await fs.readFile(path.join(f.out,'maintenance-first-FAILED.json'),'utf8');
 await assert.rejects(publishPreparedMain(f.request,f.context),/结果未知/);assert.equal(await fs.readFile(path.join(f.out,'maintenance-first-FAILED.json'),'utf8'),failed);
 await assert.rejects(fs.access(path.join(f.out,'SUCCESS.json')));
});
if(process.platform==='win32')test('the exact old manifest pins an existing original Worker process transport',async()=>{
 const release=path.join('D:/teruisi-runtime/teruisi-worker-sales/releases',k.releaseId);
 const manifestRaw=await fs.readFile(path.join(release,'deployment-manifest.json'));
 assert.equal(createHash('sha256').update(manifestRaw).digest('hex'),k.workerManifestSha256);
 const matches=JSON.parse(manifestRaw).artifacts.keyFiles.filter(f=>f.relativePath==='tools/process-deadline.ps1');assert.equal(matches.length,1);assert.equal(matches[0].sha256,k.workerTransportSha256);
 const transport=path.join(release,matches[0].relativePath);assert.ok((await fs.stat(transport)).isFile());
 assert.equal(createHash('sha256').update(await fs.readFile(transport)).digest('hex'),k.workerTransportSha256);
});
if(process.platform==='win32')for(const host of ['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','pwsh.exe'])test(host+' production assertions reject actual transport bootstraps on private process objects',async t=>{
 const transport=path.join('D:/teruisi-runtime/teruisi-worker-sales/releases',k.releaseId,'tools/process-deadline.ps1');
 const fixtureRoot=await fs.mkdtemp(path.join(os.tmpdir(),'maintenance-encoded-report-'));t.after(()=>fs.rm(fixtureRoot,{recursive:true,force:true}));
 const productionCommandArguments=await loadProductionCommandArguments();
 const systemHost='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',file='C:\\private-fixture\\django\\app\\tools\\django-local-service.ps1';
 const argv=productionCommandArguments(systemHost,['-NoProfile','-NonInteractive','-File',file,'-Action','Report','-RuntimeRoot','C:\\private-fixture\\django','-Json']);
 assert.equal(argv[2],'-EncodedCommand');
 const bootstrap=Buffer.from(argv[3],'base64').toString('utf16le');assert.ok(!bootstrap.includes(file)&&!bootstrap.includes('Report'),'fixture must retain the real inner JSON payload');
 const payload=JSON.parse(Buffer.from(bootstrap.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)[1],'base64').toString('utf8'));assert.equal(payload.file,file);assert.equal(payload.parameters.Action,'Report');
 const commandFile=path.join(fixtureRoot,'real-adapter-report.json');await fs.writeFile(commandFile,JSON.stringify({commandLine:systemHost+' '+argv.join(' ')}));
 const {stdout}=await execute(host,['-NoProfile','-NonInteractive','-File',path.resolve('tests/manual-maintenance-continuation.fixture.ps1'),'-SourceFile',path.resolve('tools/manual-maintenance-continuation.ps1'),'-TransportFile',transport,'-AdapterCommandPath',commandFile],{windowsHide:true,timeout:30000});assert.match(stdout,/PRIVATE_FIXTURES_PASSED/);assert.match(stdout,/REJECTED_REAL_ADAPTER_ENCODED_REPORT/);assert.match(stdout,/REJECTED_REAL_NATIVE_TRANSPORT_ENCODED_REPORT/);
});

// Q14 (2026-10-25): DingTalk screenshot ACL tolerance changes only tools/django-ai.ps1
// (Assert-DingTalkScreenshotProfile + one added helper). The installed -> candidate
// django-ai.ps1 pair is the only widened hash pair; these tests drive the real
// maintenanceReadiness path with real files and the real SHA-256 reader.
import {execFileSync} from 'node:child_process';
import {maintenanceReadiness,maintenanceSourceNames,dingtalkScreenshotAclQualification as dtq,isDingTalkScreenshotAclPair} from '../tools/manual-maintenance-continuation.mjs';
const sha256=value=>createHash('sha256').update(value).digest('hex');
const gitBlob=(commit,file)=>execFileSync('git',['show',commit+':'+file],{windowsHide:true,maxBuffer:8*1024*1024});
// Installed bytes = origin/main 525ad36b; candidate bytes = reviewed 33043e9d (or the working
// tree once it has been merged, so the test survives squash merges).
const dingtalkBaseAi=gitBlob('525ad36b','tools/django-ai.ps1');
const dingtalkCandidateAi=await(async()=>{const work=await fs.readFile(new URL('../tools/django-ai.ps1',import.meta.url));return sha256(work)===dtq.candidateAiSha256?work:gitBlob('33043e9d','tools/django-ai.ps1');})();
async function dingtalkAclFixture(t,{installedAi,sourceAi}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dingtalk-acl-readiness-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const source=path.join(root,'source'),installed=path.join(root,'django/app'),runtime=path.join(root,'worker'),releaseId='20261025T000000Z-fixture';
 const write=async(file,data)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,data);};
 for(const name of maintenanceSourceNames)await write(path.join(source,'tools',name),'source '+name);
 for(const name of ['worker-local-service.ps1','process-deadline.ps1','django-local-service.ps1'])await write(path.join(source,'tools',name),'controller '+name);
 const releaseRoot=path.join(runtime,'releases',releaseId);
 await write(path.join(source,'tools/django-ai.ps1'),sourceAi);await write(path.join(installed,'tools/django-ai.ps1'),installedAi);
 await write(path.join(installed,'tools/django-local-service.ps1'),'controller django-local-service.ps1');
 await write(path.join(releaseRoot,'tools/worker-local-service.ps1'),'controller worker-local-service.ps1');
 await write(path.join(releaseRoot,'tools/process-deadline.ps1'),'controller process-deadline.ps1');
 await write(path.join(installed,'deployment.json'),'{"fixture":"django"}');await write(path.join(releaseRoot,'deployment-manifest.json'),'{"fixture":"worker"}');
 const options={source,installed,runtime,head:{releaseId,manifestSha256:sha256('{"fixture":"worker"}')},djangoManifestSha256:sha256('{"fixture":"django"}')};
 return {options,source,installed,releaseRoot,write,real:async file=>sha256(await fs.readFile(file))};
}
test('Q14: registered django-ai hashes are exactly the reviewed pair and match the real bytes',()=>{
 assert.equal(sha256(dingtalkBaseAi),dtq.installedAiSha256);assert.equal(sha256(dingtalkCandidateAi),dtq.candidateAiSha256);
 assert.equal(dtq.installedAiSha256,'f97cf7e2bc532407cdf86501de57097ce6e4f626eaf68f73ee6ab308532e0e73');
 assert.equal(dtq.candidateAiSha256,'55b6701ac0f38e7aed6abea441085aa2b77f0a5f8d1a3f6c81651829ae6f9aba');
 assert.equal(isDingTalkScreenshotAclPair(dtq.installedAiSha256,dtq.candidateAiSha256),true);
 const flip=value=>value.slice(0,-1)+(value.endsWith('0')?'1':'0');
 assert.equal(isDingTalkScreenshotAclPair(flip(dtq.installedAiSha256),dtq.candidateAiSha256),false);
 assert.equal(isDingTalkScreenshotAclPair(dtq.installedAiSha256,flip(dtq.candidateAiSha256)),false);
 assert.equal(isDingTalkScreenshotAclPair(dtq.candidateAiSha256,dtq.installedAiSha256),false,'reverse direction is not registered');
 assert.equal(isDingTalkScreenshotAclPair(dtq.installedAiSha256,dtq.installedAiSha256),false);
 assert.throws(()=>{dtq.candidateAiSha256='0'.repeat(64);},TypeError);
});
test('Q14: the exact installed -> candidate django-ai pair reaches the native exit-observer route',async t=>{
 const {options,installed,source}=await dingtalkAclFixture(t,{installedAi:dingtalkBaseAi,sourceAi:dingtalkCandidateAi});
 const result=await maintenanceReadiness(options);
 assert.equal(result.route,'native-exit-observer');
 assert.equal(result.pins.find(p=>p.root==='django'&&p.relative==='app/tools/django-ai.ps1').sha256,dtq.installedAiSha256);
 assert.equal(result.pins.find(p=>p.root==='source'&&p.relative==='django-ai.ps1').sha256,dtq.candidateAiSha256);
 for(const name of ['worker-local-service.ps1','process-deadline.ps1','django-local-service.ps1'])assert.ok(result.pins.some(p=>p.root==='source'&&p.relative===name),name);
 assert.equal(await fs.readFile(path.join(installed,'tools/django-ai.ps1')).then(sha256),dtq.installedAiSha256);assert.ok(source);
});
test('Q14: unchanged django-ai (installed = candidate) is unaffected by the new pair',async t=>{
 const {options}=await dingtalkAclFixture(t,{installedAi:dingtalkCandidateAi,sourceAi:dingtalkCandidateAi});
 assert.equal((await maintenanceReadiness(options)).route,'native-exit-observer');
});
test('Q14: any other django-ai pair is still refused by the original predecessor checks',async t=>{
 // one byte appended to the candidate, to the installed bytes, and the reverse direction
 for(const [name,installedAi,sourceAi] of [
  ['candidate bytes differ',dingtalkBaseAi,Buffer.concat([dingtalkCandidateAi,Buffer.from('\n')])],
  ['installed bytes differ',Buffer.concat([dingtalkBaseAi,Buffer.from('\n')]),dingtalkCandidateAi],
  ['reverse direction',dingtalkCandidateAi,dingtalkBaseAi],
 ]){
  const {options}=await dingtalkAclFixture(t,{installedAi,sourceAi});
  await assert.rejects(maintenanceReadiness(options),/维护前驱资格与最初读取字节不一致|没有适用于实际前驱/,name);
 }
});
test('Q14: a one-digit hash error on either side is refused (reported hashes, real bytes)',async t=>{
 const flip=value=>value.slice(0,-1)+(value.endsWith('0')?'1':'0');
 for(const [name,which] of [['installed hash off by one digit','installed'],['candidate hash off by one digit','source']]){
  const {options,installed,source,real}=await dingtalkAclFixture(t,{installedAi:dingtalkBaseAi,sourceAi:dingtalkCandidateAi});
  const target=path.join(which==='installed'?installed:source,'tools/django-ai.ps1');
  options.sha=async file=>file===target?flip(await real(file)):real(file);
  await assert.rejects(maintenanceReadiness(options),/维护前驱资格与最初读取字节不一致|没有适用于实际前驱/,name);
 }
});
test('Q14: installed bytes that change after the pair was recognised cannot ride on the registered hash',async t=>{
 const {options,installed,real}=await dingtalkAclFixture(t,{installedAi:Buffer.concat([dingtalkBaseAi,Buffer.from('\n# drift\n')]),sourceAi:dingtalkCandidateAi});
 // The reader claims the registered installed hash while the real bytes differ.
 options.sha=async file=>file===path.join(installed,'tools/django-ai.ps1')?dtq.installedAiSha256:real(file);
 await assert.rejects(maintenanceReadiness(options),/资格核验后工具发生变化/);
});
test('Q14: a candidate that edits the Pi stop protocol is refused before the pair is considered',async t=>{
 const text=dingtalkCandidateAi.toString('utf8');assert.ok(text.includes('Wait-PiWorkerExit $owned'));
 const edited=Buffer.from(text.replace('Wait-PiWorkerExit $owned','# observer detached $owned'));
 const {options}=await dingtalkAclFixture(t,{installedAi:dingtalkBaseAi,sourceAi:edited});
 await assert.rejects(maintenanceReadiness(options),/Pi Stop调用|没有适用于实际前驱/);
});
test('Q14: the pair keeps per-controller generation checks for every other controller',async t=>{
 // unregistered installed worker controller -> refused
 let fixture=await dingtalkAclFixture(t,{installedAi:dingtalkBaseAi,sourceAi:dingtalkCandidateAi});
 await fixture.write(path.join(fixture.releaseRoot,'tools/worker-local-service.ps1'),'an older, unregistered controller');
 await assert.rejects(maintenanceReadiness(fixture.options),/实际原生控制器代际与候选不一致：worker-local-service\.ps1/);
 // a registered candidate hash for that controller is admitted exactly as in the same-AI generation
 const registeredWorker=piNativeCandidateControllerSha256['worker-local-service.ps1'][0];
 const target=path.join(fixture.source,'tools/worker-local-service.ps1');
 fixture.options.sha=async file=>file===target?registeredWorker:fixture.real(file);
 assert.equal((await maintenanceReadiness(fixture.options)).route,'native-exit-observer');
 // an unregistered candidate hash for that controller is refused
 fixture.options.sha=async file=>file===target?'e'.repeat(64):fixture.real(file);
 await assert.rejects(maintenanceReadiness(fixture.options),/实际原生控制器代际与候选不一致：worker-local-service\.ps1/);
 // process-deadline.ps1 has no registered candidate at all
 fixture=await dingtalkAclFixture(t,{installedAi:dingtalkBaseAi,sourceAi:dingtalkCandidateAi});
 await fixture.write(path.join(fixture.releaseRoot,'tools/process-deadline.ps1'),'drifted transport');
 await assert.rejects(maintenanceReadiness(fixture.options),/实际原生控制器代际与候选不一致：process-deadline\.ps1/);
 // django-local-service.ps1: registered PiNative candidate admitted, unknown refused
 fixture=await dingtalkAclFixture(t,{installedAi:dingtalkBaseAi,sourceAi:dingtalkCandidateAi});
 await fixture.write(path.join(fixture.installed,'tools/django-local-service.ps1'),'installed older local service');
 const djangoTarget=path.join(fixture.source,'tools/django-local-service.ps1');
 fixture.options.sha=async file=>file===djangoTarget?piNativeCandidateDjangoScriptSha256:fixture.real(file);
 assert.equal((await maintenanceReadiness(fixture.options)).route,'native-exit-observer');
 await assert.rejects(maintenanceReadiness(await(async()=>{fixture.options.sha=fixture.real;return fixture.options;})()),/实际原生控制器代际与候选不一致：django-local-service\.ps1/);
});


test('catalog preflight controller preserves prior qualifications and rejects unreviewed bytes',()=>{
 const old=workflowAutomationSchemaAdditionDjangoScriptSha256,candidate=catalogBaselineDjangoScriptSha256;
 assert.doesNotThrow(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:old,expected:candidate,candidateSha:candidate}));
 assert.doesNotThrow(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:candidate,expected:old,candidateSha:old}));
 const changed=candidate.slice(0,-1)+(candidate.endsWith('0')?'1':'0');
 assert.throws(()=>assertMaintenanceControllerGeneration({name:'django-local-service.ps1',installedSha:old,expected:changed,candidateSha:changed}));
 for(const name of ['worker-local-service.ps1','process-deadline.ps1','unknown.ps1'])
  assert.throws(()=>assertMaintenanceControllerGeneration({name,installedSha:old,expected:candidate,candidateSha:candidate}));
});
