import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectMainPublication,resumeAi159OriginalTail,resumeMainPublication,resumeProtocol} from '../tools/publish-main-resume.mjs';
import {reconcileMainPiUpgrade} from '../tools/publish-main-pi-reconciliation.mjs';
import {verifyPublisherRetired} from '../tools/publish-main-owner.mjs';
import {assertAi159InitialPi,assertAi159RetryInvocations} from '../tools/publish-ai159-resume.mjs';
import {resumeAi159PreparedMain} from '../tools/publish-prepared-main.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const write=async(p,v)=>{await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,typeof v==='string'?v:JSON.stringify(v)+'\n');};
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const hex=c=>c.repeat(64),commit='a'.repeat(40),tree='b'.repeat(40);
const owner={processId:123,creationDate:'2026-10-21T00:00:00.000Z',commandLineSha256:hex('1'),executablePathSha256:hex('2'),sessionId:1};

async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'main-resume-private-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const packet=path.join(root,'packet'),source=path.join(packet,'source'),out=path.join(packet,'publish-'+commit.slice(0,12)),resumed=path.join(out,'resume'),installed=path.join(root,'django/app'),runtime=path.join(root,'worker');
 const old={releaseId:'old',manifestSha256:hex('1'),bindingSha256:hex('2')};let head={...old};
 const request={version:'teruisi-frozen-latest-main-request-v1',latestMainRelease:true,mainCommit:commit,deployedCommit:'c'.repeat(40),components:['worker','django'],migrate:false,predecessorWorker:old,predecessorDjangoSha256:hex('3'),releasePlan:{headSha:commit,baseSha:'c'.repeat(40),components:['worker','django'],migrate:false}};
 const upgrade={prepared:true,started:false,operationId:'4'.repeat(32),registeredPlanSha256:hex('5'),planSha256:hex('6'),sourceSha256:hex('7'),image:'sha256:'+hex('8')};
 const prepared={version:'teruisi-main-preparation-v1',requestSha256:hash(Buffer.from(JSON.stringify(request))),sourceIdentity:{commit,tree},workerPlan:{planSha256:hex('9'),candidateReleaseId:'new',candidateManifestSha256:hex('a')},djangoPackage:{id:'b'.repeat(32),receiptSha256:null},djangoManifestSha256:null,piRunnerUpgrade:upgrade};
 await write(path.join(installed,'deployment.json'),{private:true});await write(path.join(root,'django','app.prepare-'+prepared.djangoPackage.id+'.json'),{privatePackage:true});
 prepared.djangoManifestSha256=hash(await fs.readFile(path.join(installed,'deployment.json')));prepared.djangoPackage.receiptSha256=hash(await fs.readFile(path.join(root,'django','app.prepare-'+prepared.djangoPackage.id+'.json')));
 const maintenanceId='c'.repeat(32),started={resumeProtocol,publisherOwner:owner,mainCommit:commit,maintenanceId,components:request.components,source,sourceTree:tree,requestSha256:prepared.requestSha256,predecessorChainStateSha256:hex('d')};
 await write(path.join(packet,'main-release-request.json'),request);await write(path.join(out,'preparation/PREPARED.json'),prepared);await write(path.join(out,'STARTED.json'),started);await write(path.join(out,'FAILED.json'),{mainCommit:commit,maintenanceStarted:true,phase:'升级Pi Runner'});
 await write(path.join(root,'django/run/system-maintenance.json'),{id:maintenanceId,keepPostgres:true,drainedStopped:true});await write(path.join(root,'django/run/automation-drain.json'),{id:maintenanceId,keepPostgres:true,phase:'requests'});
 const processEvidence={code:'completed',exitCode:0,timeoutType:null};
 const stage=async(label,action,script,extra=[],value=null,dir=out)=>{
  await write(path.join(dir,label+'-started.json'),{action,script,extra});await write(path.join(dir,label+'-process.json'),{processEvidence});await write(path.join(dir,label+'-result.json'),{value});
 };
 await stage('部署后台','DeployApp',path.join(source,'tools/django-local-service.ps1'),['-PreparedAppId',prepared.djangoPackage.id,'-PreparedAppSha256',prepared.djangoPackage.receiptSha256]);
 await stage('应用后台权限','HardenAcl',path.join(installed,'tools/django-local-service.ps1'));
 const receipt={upgraded:true,windowsConfigUpdated:true,sameDpapiOwner:true,sourceSha256:upgrade.sourceSha256,image:upgrade.image};
 const pi={status:'windows_complete',registeredPlanSha256:upgrade.registeredPlanSha256,operationId:upgrade.operationId,planSha256:upgrade.planSha256,sourceSha256:upgrade.sourceSha256,image:upgrade.image};
 const events=[];let status=pi,failAt=null,catalogFails=false,retired=true;
 const context={installedRoot:installed,workerRuntimeRoot:runtime,sourceIdentity:async()=>({commit,tree}),captureOwner:async()=>owner,
  assertRetired:async()=>{events.push('retired');assert.equal(retired,true,'owner active');},
  observePi:async()=>{events.push('status');return status;},
  api:{workerRuntimeRoot:runtime},transport:{},
  rotation:{withRotationLock:async cb=>{events.push('rotation');return cb({private:true});},assertActiveBatchOwnership:async()=>{},resolveEffectiveReleaseChain:async()=>({head:{...head},chainStateSha256:hex('d')}),
   applyApprovedRotationPlan:async()=>{events.push('WorkerApply');assert.notEqual(failAt,'WorkerApply','fixture apply failure');head={releaseId:'new',manifestSha256:prepared.workerPlan.candidateManifestSha256};const consumption=path.join(runtime,'state/worker-release-rotation-consumptions',prepared.workerPlan.planSha256+'.json');await write(consumption,{private:true});return {status:'activated',planSha256:prepared.workerPlan.planSha256,releaseId:'new',manifestSha256:prepared.workerPlan.candidateManifestSha256,consumptionSha256:hash(await fs.readFile(consumption))};}},
  runStep:async({label,action})=>{
   events.push(action);
   if(action==='PiUpgradeStatus')return status;
   if(action==='VerifyPiUpgradeResult')return {...pi,postconditionsVerified:true,upgradeReceipt:receipt};
   if(action==='ReconcilePiUpgrade'){status=pi;if(failAt===action)throw Error('fixture parse failure after Windows completion');return receipt;}
   if(failAt===action)throw Error('fixture '+action+' failure');
   // These are explicitly private native-engine stand-ins, not production evidence.
   await write(path.join(resumed,label+'-process.json'),{processEvidence});
   if(action==='ExitMaintenance'){await fs.unlink(path.join(root,'django/run/system-maintenance.json'));await fs.unlink(path.join(root,'django/run/automation-drain.json'));return {status:'maintenance_ended',maintenanceId};}
   if(action==='Start')return {status:'started',manifestSha256:prepared.workerPlan.candidateManifestSha256};
   if(action==='VerifyStartup')return {startupVerified:true};
   throw Error('Unexpected forbidden action: '+action);
  },
  ready:async()=>events.push('ready'),publishCatalog:async()=>{events.push('catalog');if(catalogFails)throw Error('catalog CAS conflict');}
 };
 return {root,source,out,resumed,installed,runtime,request,prepared,started,context,stage,events,pi,receipt,set status(v){status=v;},set failAt(v){failAt=v;},set catalogFails(v){catalogFails=v;},set retired(v){retired=v;},set head(v){head=v;}};
}

test('default observation has no publication or file writes',async t=>{
 const f=await fixture(t),before=await fs.readdir(f.out);const r=await inspectMainPublication(f.out,f.context);assert.equal(r.canResume,true);assert.deepEqual(await fs.readdir(f.out),before);assert.ok(!f.events.includes('WorkerApply'));assert.ok(!f.events.includes('VerifyPiUpgradeResult'));
});
test('completed Windows upgrade reuses Deploy and Upgrade and executes only native tail',async t=>{
 const f=await fixture(t),original=await fs.readFile(path.join(f.out,'FAILED.json'));const result=await resumeMainPublication(f.out,f.context);
 assert.equal(result.status,'deployed_and_ready');assert.equal(result.manualRecovery,true);assert.equal(result.automatedPublisherSuccess,false);assert.deepEqual(await fs.readFile(path.join(f.out,'FAILED.json')),original);
 for(const forbidden of ['DeployApp','HardenAcl','UpgradePi','ReconcilePiUpgrade'])assert.equal(f.events.includes(forbidden),false);
 assert.deepEqual(f.events.filter(e=>['WorkerApply','ExitMaintenance','Start','VerifyStartup','ready','catalog'].includes(e)),['WorkerApply','ExitMaintenance','Start','VerifyStartup','ready','catalog']);
 assert.equal((await read(path.join(f.resumed,'SUCCESS.json'))).originalAttempt,f.out);
});
test('eligible original intent reconciles once and then enters the same tail',async t=>{
 const f=await fixture(t);f.status={...f.pi,status:'reconcile_available'};await resumeMainPublication(f.out,f.context);assert.equal(f.events.filter(x=>x==='ReconcilePiUpgrade').length,1);assert.ok(await fs.stat(path.join(f.out,'PiReconcile-started.json')));
});
test('parse error after persisted reconciliation does not resend it',async t=>{
 const f=await fixture(t);f.status={...f.pi,status:'reconcile_available'};f.failAt='ReconcilePiUpgrade';await resumeMainPublication(f.out,f.context);assert.equal(f.events.filter(x=>x==='ReconcilePiUpgrade').length,1);
});
test('global original reconciliation marker cannot be reset by a resume directory',async t=>{
 const f=await fixture(t);f.status={...f.pi,status:'reconcile_available'};await write(path.join(f.out,'PiReconcile-started.json'),{original:true});const r=await inspectMainPublication(f.out,f.context);assert.equal(r.canResume,false);await assert.rejects(resumeMainPublication(f.out,f.context));assert.ok(!f.events.includes('ReconcilePiUpgrade'));
});
for(const label of ['WorkerApply','退出维护','启动服务','确认启动版本'])test('started without a trusted result never replays '+label,async t=>{
 const f=await fixture(t);await write(path.join(f.out,label+'-started.json'),{});await assert.rejects(resumeMainPublication(f.out,f.context),/未知/);assert.ok(!f.events.includes('WorkerApply'));
});
test('late/live original owner prevents any continuation',async t=>{
 const f=await fixture(t);f.retired=false;await assert.rejects(resumeMainPublication(f.out,f.context),/owner active/);assert.ok(!f.events.includes('WorkerApply'));
});
test('recorded Worker activation requires exact current head and consumption and is not repeated',async t=>{
 const f=await fixture(t);const applied=await f.context.rotation.applyApprovedRotationPlan();await write(path.join(f.out,'WorkerApply-started.json'),{planSha256:f.prepared.workerPlan.planSha256});await write(path.join(f.out,'WorkerApply-result.json'),applied);f.events.length=0;
 await resumeMainPublication(f.out,f.context);assert.ok(!f.events.includes('WorkerApply'));
});
test('changed Worker consumption blocks reuse',async t=>{
 const f=await fixture(t);const applied=await f.context.rotation.applyApprovedRotationPlan();await write(path.join(f.out,'WorkerApply-started.json'),{planSha256:f.prepared.workerPlan.planSha256});await write(path.join(f.out,'WorkerApply-result.json'),{...applied,consumptionSha256:hex('f')});await assert.rejects(inspectMainPublication(f.out,f.context),/消费/);
});
test('SUCCESS followed by catalog failure resumes only the index',async t=>{
 const f=await fixture(t);f.catalogFails=true;await assert.rejects(resumeMainPublication(f.out,f.context),/catalog/);f.catalogFails=false;f.events.length=0;const r=await resumeMainPublication(f.out,f.context);assert.equal(r.status,'already-current');assert.deepEqual(f.events.filter(x=>!['rotation','retired'].includes(x)),['catalog']);
});
test('failed Start leaves its started record unknown instead of retrying',async t=>{
 const f=await fixture(t);f.failAt='Start';await assert.rejects(resumeMainPublication(f.out,f.context),/Start failure/);f.failAt=null;f.events.length=0;await assert.rejects(resumeMainPublication(f.out,f.context),/未知/);assert.ok(!f.events.includes('Start'));
});
test('successful stages from a previous resume are reused after a failure before the next stage',async t=>{
 const f=await fixture(t);let fail=true;f.context.ready=async()=>{if(fail)throw Error('private readiness fail');};await assert.rejects(resumeMainPublication(f.out,f.context),/readiness/);fail=false;f.events.length=0;await resumeMainPublication(f.out,f.context);for(const action of ['WorkerApply','ExitMaintenance','Start','VerifyStartup'])assert.ok(!f.events.includes(action));
});
for(const mutation of ['migration','source','request','maintenance','old-protocol','deploy-unknown','result-without-started'])test('refuses '+mutation+' without any native write',async t=>{
 const f=await fixture(t);
 if(mutation==='migration'){const r=await read(path.join(f.out,'STARTED.json'));r.schemaRelease={};await write(path.join(f.out,'STARTED.json'),r);}
 if(mutation==='source')f.context.sourceIdentity=async()=>({commit,tree:'c'.repeat(40)});
 if(mutation==='request'){const r=await read(path.join(path.dirname(f.source),'main-release-request.json'));r.migrate=true;await write(path.join(path.dirname(f.source),'main-release-request.json'),r);}
 if(mutation==='maintenance')await write(path.join(f.root,'django/run/system-maintenance.json'),{id:'wrong'});
 if(mutation==='old-protocol'){const r=await read(path.join(f.out,'STARTED.json'));delete r.resumeProtocol;await write(path.join(f.out,'STARTED.json'),r);}
 if(mutation==='deploy-unknown')await fs.unlink(path.join(f.out,'部署后台-result.json'));
 if(mutation==='result-without-started')await fs.unlink(path.join(f.out,'部署后台-started.json'));
 await assert.rejects(resumeMainPublication(f.out,f.context));assert.ok(!f.events.includes('WorkerApply'));
});
test('retirement rejects exact owner, related controller and unreadable metadata',()=>{
 assert.throws(()=>verifyPublisherRetired(owner,[{...owner,related:false,identityUnreadable:false}]));
 assert.throws(()=>verifyPublisherRetired(owner,[{processId:234,related:true,identityUnreadable:false}]));
 assert.throws(()=>verifyPublisherRetired(owner,[{processId:234,related:false,identityUnreadable:true}]));
 assert.equal(verifyPublisherRetired(owner,[]),true);
 assert.equal(verifyPublisherRetired(owner,[{...owner,creationDate:'2026-10-22T00:00:00.000Z',related:false,identityUnreadable:false}]),true);
});
test('timeout with unknown direct exit cannot call status or Reconcile',async t=>{
 const f=await fixture(t);await write(path.join(f.out,'升级Pi Runner-process.json'),{processEvidence:{code:'process_timeout',exitCode:null,timeoutType:'direct-exit'}});const events=[];
 await assert.rejects(reconcileMainPiUpgrade({prepared:f.prepared.piRunnerUpgrade,installed:f.installed,out:f.out,step:async()=>events.push('called'),requireDirectExit:true}),/直接退出/);assert.deepEqual(events,[]);
});
test('Reconcile timeout preserves its guard and does not read past a potentially active writer',async t=>{
 const f=await fixture(t),events=[];
 const step=async(label,_script,action)=>{
  events.push(action);if(action==='PiUpgradeStatus')return {...f.pi,status:'reconcile_available'};
  if(action==='ReconcilePiUpgrade'){await write(path.join(f.out,'协调Pi升级原操作-process.json'),{processEvidence:{code:'process_timeout',exitCode:null,timeoutType:'direct-exit'}});throw Error('private timeout');}
  throw Error('must not proceed');
 };
 await assert.rejects(reconcileMainPiUpgrade({prepared:f.prepared.piRunnerUpgrade,installed:f.installed,out:f.out,step}),/直接退出/);assert.deepEqual(events,['PiUpgradeStatus','ReconcilePiUpgrade']);assert.ok(await fs.stat(path.join(f.out,'PiReconcile-started.json')));
});

test('AI159 public entry rejects a different attempt before reading production',async t=>{
 const f=await fixture(t);
 await assert.rejects(resumeAi159PreparedMain({attempt:f.out}),/仅接受原发布目录/);
 assert.deepEqual(f.events,[]);
});

test('AI159 Pi observation requires the original operation, plan and inactive reason',async t=>{
 const f=await fixture(t),prepared=f.prepared.piRunnerUpgrade;
 const inactive={...f.pi,status:'blocked',reason:'linux_successor_not_active',postconditionsVerified:false,upgradeReceipt:null};
 assert.doesNotThrow(()=>assertAi159InitialPi(inactive,prepared));
 for(const mutation of [{reason:'linux_state_unknown'},{status:'reconcile_available'},{registeredPlanSha256:hex('f')},{operationId:'f'.repeat(32)},{upgradeReceipt:{}}]){
  assert.throws(()=>assertAi159InitialPi({...inactive,...mutation},prepared));
 }
});

test('AI159 keeper adoption requires both exact prior invocations and permits one successor only',()=>{
 const prior='1bfffddeb6b14b1689a6f29c99b04d64',keeper='de108347aca1418fa36f97129ba7e178',next='a'.repeat(32);
 assert.doesNotThrow(()=>assertAi159RetryInvocations([prior,keeper]));
 assert.doesNotThrow(()=>assertAi159RetryInvocations([next,keeper,prior],next));
 for(const bad of [[],[prior],[keeper],[next],[prior,next],[prior,keeper,next]])assert.throws(()=>assertAi159RetryInvocations(bad));
 assert.throws(()=>assertAi159RetryInvocations([prior,keeper],prior));
 assert.throws(()=>assertAi159RetryInvocations([prior,keeper],keeper));
 assert.throws(()=>assertAi159RetryInvocations([next,prior,keeper,'b'.repeat(32)],next));
});

test('AI159 keeper failure after catalog can only coordinate the index and keeper',async t=>{
 const f=await fixture(t),failure=await fs.readFile(path.join(f.out,'FAILED.json'));
 const schemaReceipt={release:{steps:['ai_assistant.0090_unified_tasks']},operationId:'private'};
 const recovery={protocol:'private-ai159',operatorSource:{commit:'d'.repeat(40)},preparationSha256:hex('e'),
  verifyOriginal:async()=>schemaReceipt,verifySuccess:async success=>assert.deepEqual(success.schemaReceipt,schemaReceipt),canResume:async()=>true,
  runPi:async()=>({receipt:f.receipt,schemaDatabaseVerified:true,schemaDatabaseProofSha256:hex('f'),releaseKeeper:async()=>{
   f.events.push('releaseKeeper');throw Error('private keeper cleanup failed');
  }}),
  cleanupRecordedKeeper:async()=>f.events.push('cleanupRecordedKeeper'),
 };
 await assert.rejects(resumeAi159OriginalTail(f.out,f.context,recovery),/private keeper cleanup failed/);
 assert.deepEqual(f.events.slice(-3),['ready','catalog','releaseKeeper']);
 f.events.length=0;
 const result=await resumeAi159OriginalTail(f.out,f.context,recovery);
 assert.equal(result.status,'already-current');
 assert.deepEqual(f.events.filter(e=>!['rotation','retired'].includes(e)),['catalog','cleanupRecordedKeeper']);
 assert.deepEqual(await fs.readFile(path.join(f.out,'FAILED.json')),failure);
});
