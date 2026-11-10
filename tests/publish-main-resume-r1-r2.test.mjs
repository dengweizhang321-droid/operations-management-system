/** R1 (Pandas, Switch already completed) and R2 (Pi optional) synthetic fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectMainPublication,resumeMainPublication,resumeProtocol,resumeLeaseVersion} from '../tools/publish-main-resume.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const write=async(p,v)=>{await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,typeof v==='string'?v:JSON.stringify(v)+'\n');};
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const exists=async p=>{try{await fs.access(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const hex=c=>c.repeat(64),commit='a'.repeat(40),tree='b'.repeat(40);
const owner={processId:123,creationDate:'2026-10-21T00:00:00.000Z',commandLineSha256:hex('1'),executablePathSha256:hex('2'),sessionId:1};

/**
 * @param {{pi?:boolean,pandas?:boolean,pandasSwitchState?:'completed'|'unknown'|'not_started',pandasMismatch?:boolean}} options
 */
async function fixture(t,{pi=false,pandas=false,pandasSwitchState='completed',pandasMismatch=false}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'main-resume-r1r2-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const packet=path.join(root,'packet'),source=path.join(packet,'source'),out=path.join(packet,'publish-'+commit.slice(0,12)),resumed=path.join(out,'resume'),installed=path.join(root,'django/app'),runtime=path.join(root,'worker');
 const old={releaseId:'old',manifestSha256:hex('1'),bindingSha256:hex('2')};let head={...old};
 const changes=pandasMismatch?[]:(pandas?[{status:'M',path:'backend/pandas_runner/broker.py'}]:[]);
 const request={version:'teruisi-frozen-latest-main-request-v1',latestMainRelease:true,mainCommit:commit,deployedCommit:'c'.repeat(40),components:['worker','django'],migrate:false,predecessorWorker:old,predecessorDjangoSha256:hex('3'),releasePlan:{headSha:commit,baseSha:'c'.repeat(40),components:['worker','django'],migrate:false,changes}};
 const upgrade=pi?{prepared:true,started:false,operationId:'4'.repeat(32),registeredPlanSha256:hex('5'),planSha256:hex('6'),sourceSha256:hex('7'),image:'sha256:'+hex('8')}:null;
 // preparedAppId/preparedAppSha256 must match prepared.djangoPackage.id/receiptSha256
 // exactly (verifyPandasPreparation asserts this): both bindings describe the
 // same prepared Django app, so the receipt file is written and hashed
 // before pandasBinding/prepared are built (prepared.pandasBrokerRotation is
 // a plain spread copy of pandasBinding, not a live reference).
 const djangoPackageId='b'.repeat(32);
 await write(path.join(installed,'deployment.json'),{private:true});await write(path.join(root,'django','app.prepare-'+djangoPackageId+'.json'),{privatePackage:true});
 const djangoManifestSha256=hash(await fs.readFile(path.join(installed,'deployment.json')));
 const djangoPackageReceiptSha256=hash(await fs.readFile(path.join(root,'django','app.prepare-'+djangoPackageId+'.json')));
 const pandasBinding=pandas?{configured:true,image:'sha256:'+hex('9'),predecessorSourceSha256:hex('1'),prepared:true,preparedAppId:djangoPackageId,preparedAppSha256:djangoPackageReceiptSha256,registeredPlanSha256:hex('3'),sourceCommit:commit,sourceSha256:hex('4'),started:false}:null;
 const prepared={version:'teruisi-main-preparation-v1',requestSha256:hash(Buffer.from(JSON.stringify(request))),sourceIdentity:{commit,tree},workerPlan:{planSha256:hex('9'),candidateReleaseId:'new',candidateManifestSha256:hex('a')},djangoPackage:{id:djangoPackageId,receiptSha256:djangoPackageReceiptSha256},djangoManifestSha256,...(upgrade?{piRunnerUpgrade:upgrade}:{}),...(pandasBinding?{pandasBrokerRotation:pandasBinding}:{})};
 const maintenanceId='c'.repeat(32),startedPandas=pandasMismatch?{...pandasBinding,sourceSha256:hex('ffff')}:pandasBinding;
 const started={resumeProtocol,publisherOwner:owner,mainCommit:commit,maintenanceId,components:request.components,source,sourceTree:tree,requestSha256:prepared.requestSha256,predecessorChainStateSha256:hex('d'),...(startedPandas?{pandasBrokerRotation:startedPandas}:{})};
 await write(path.join(packet,'main-release-request.json'),request);await write(path.join(out,'preparation/PREPARED.json'),prepared);await write(path.join(out,'STARTED.json'),started);await write(path.join(out,'FAILED.json'),{mainCommit:commit,maintenanceStarted:true,phase:'启动服务'});
 await write(path.join(root,'django/run/system-maintenance.json'),{id:maintenanceId,keepPostgres:true,drainedStopped:true});await write(path.join(root,'django/run/automation-drain.json'),{id:maintenanceId,keepPostgres:true,phase:'requests'});
 const processEvidence={code:'completed',exitCode:0,timeoutType:null};
 const stage=async(label,action,script,extra=[],value=null,dir=out)=>{
  await write(path.join(dir,label+'-started.json'),{action,script,extra});await write(path.join(dir,label+'-process.json'),{processEvidence});await write(path.join(dir,label+'-result.json'),{value});
 };
 await stage('部署后台','DeployApp',path.join(source,'tools/django-local-service.ps1'),['-PreparedAppId',prepared.djangoPackage.id,'-PreparedAppSha256',prepared.djangoPackage.receiptSha256]);
 await stage('应用后台权限','HardenAcl',path.join(installed,'tools/django-local-service.ps1'));
 let pandasSwitchReceiptValue=null;
 if(pandas){
  pandasSwitchReceiptValue={...pandasBinding,maintenanceId,publicationOwnerPid:owner.processId,intentSha256:hex('9'),switched:true,started:false,status:'switched_stopped'};
  if(pandasSwitchState==='completed'){
   await stage('切换Pandas Broker单元','SwitchPandasRotation',path.join(installed,'tools/django-ai.ps1'),[],pandasSwitchReceiptValue);
   await write(path.join(out,'PandasRotation-switched.json'),{at:new Date().toISOString(),value:pandasSwitchReceiptValue});
  }else if(pandasSwitchState==='unknown'){
   await write(path.join(out,'切换Pandas Broker单元-started.json'),{action:'SwitchPandasRotation'});
  }
  // pandasSwitchState==='not_started': write nothing.
  if(pandasSwitchState==='completed'){
   // Mirrors the real c7604df9 attempt: WorkerApply and 退出维护 both
   // completed (in publish-prepared-main.mjs's own order, strictly after
   // Switch) before the failure at 启动服务, so this "resumable" case's
   // remaining plan is exactly 启动服务 onward, like the real fixture.
   const consumption=path.join(runtime,'state/worker-release-rotation-consumptions',prepared.workerPlan.planSha256+'.json');
   await write(consumption,{private:true});
   await write(path.join(out,'WorkerApply-started.json'),{planSha256:prepared.workerPlan.planSha256});
   await write(path.join(out,'WorkerApply-result.json'),{status:'activated',planSha256:prepared.workerPlan.planSha256,releaseId:'new',manifestSha256:prepared.workerPlan.candidateManifestSha256,consumptionSha256:hash(await fs.readFile(consumption))});
   head={releaseId:'new',manifestSha256:prepared.workerPlan.candidateManifestSha256};
   await stage('退出维护','ExitMaintenance',path.join(runtime,'releases/new/tools/worker-local-service.ps1'),['-MaintenanceId',maintenanceId],{status:'maintenance_ended',maintenanceId});
   await fs.unlink(path.join(root,'django/run/system-maintenance.json'));await fs.unlink(path.join(root,'django/run/automation-drain.json'));
  }
 }
 const receipt=pi?{upgraded:true,windowsConfigUpdated:true,sameDpapiOwner:true,sourceSha256:upgrade.sourceSha256,image:upgrade.image}:null;
 const piStatus=pi?{status:'windows_complete',registeredPlanSha256:upgrade.registeredPlanSha256,operationId:upgrade.operationId,planSha256:upgrade.planSha256,sourceSha256:upgrade.sourceSha256,image:upgrade.image}:null;
 const events=[];let status=piStatus,failAt=null,catalogFails=false,retired=true;
 const context={installedRoot:installed,workerRuntimeRoot:runtime,sourceIdentity:async()=>({commit,tree}),captureOwner:async()=>owner,
  assertRetired:async()=>{events.push('retired');assert.equal(retired,true,'owner active');},
  observePi:async()=>{events.push('status');return status;},
  api:{workerRuntimeRoot:runtime},transport:{},
  rotation:{withRotationLock:async cb=>{events.push('rotation');return cb({private:true});},assertActiveBatchOwnership:async()=>{},resolveEffectiveReleaseChain:async()=>({head:{...head},chainStateSha256:hex('d')}),
   applyApprovedRotationPlan:async()=>{events.push('WorkerApply');assert.notEqual(failAt,'WorkerApply','fixture apply failure');head={releaseId:'new',manifestSha256:prepared.workerPlan.candidateManifestSha256};const consumption=path.join(runtime,'state/worker-release-rotation-consumptions',prepared.workerPlan.planSha256+'.json');await write(consumption,{private:true});return {status:'activated',planSha256:prepared.workerPlan.planSha256,releaseId:'new',manifestSha256:prepared.workerPlan.candidateManifestSha256,consumptionSha256:hash(await fs.readFile(consumption))};}},
  runStep:async({label,action,script})=>{
   events.push(action);
   if(action==='PiUpgradeStatus')return status;
   if(action==='VerifyPiUpgradeResult')return {...piStatus,postconditionsVerified:true,upgradeReceipt:receipt};
   if(action==='ReconcilePiUpgrade'){status=piStatus;if(failAt===action)throw Error('fixture parse failure after Windows completion');return receipt;}
   if(failAt===action)throw Error('fixture '+action+' failure');
   await write(path.join(resumed,label+'-process.json'),{processEvidence});
   if(action==='ExitMaintenance'){await fs.unlink(path.join(root,'django/run/system-maintenance.json'));await fs.unlink(path.join(root,'django/run/automation-drain.json'));return {status:'maintenance_ended',maintenanceId};}
   if(action==='Start')return {status:'started',manifestSha256:prepared.workerPlan.candidateManifestSha256};
   if(action==='VerifyStartup')return {startupVerified:true};
   if(action==='CompletePandasRotation'){
    assert.equal(path.resolve(script),path.resolve(path.join(installed,'tools/django-ai.ps1')));
    return {...pandasSwitchReceiptValue,completed:true,postconditionsVerified:true,status:'ready_verified',startupReceiptSha256:hex('5')};
   }
   throw Error('Unexpected forbidden action: '+action);
  },
  ready:async()=>events.push('ready'),publishCatalog:async()=>{events.push('catalog');if(catalogFails)throw Error('catalog CAS conflict');}
 };
 return {root,source,out,resumed,installed,runtime,request,prepared,started,context,stage,events,pi:piStatus,receipt,pandasSwitchReceiptValue,
  set status(v){status=v;},set failAt(v){failAt=v;},set catalogFails(v){catalogFails=v;},set retired(v){retired=v;},set head(v){head=v;}};
}

test('R2: no Pi upgrade, WorkerApply-after-failure fixture is resumable without calling observePi',async t=>{
 const f=await fixture(t,{pi:false,pandas:false});
 const r=await inspectMainPublication(f.out,f.context);
 assert.equal(r.status,'resumable');assert.equal(r.canResume,true);assert.equal(r.pi,null);
 assert.ok(!f.events.includes('status'));
});
test('R2: no Pi, resume runs the full tail and never calls reconcileMainPiUpgrade',async t=>{
 const f=await fixture(t,{pi:false,pandas:false});
 const result=await resumeMainPublication(f.out,f.context);
 assert.equal(result.status,'deployed_and_ready');
 assert.ok(!f.events.includes('PiUpgradeStatus'));assert.ok(!f.events.includes('ReconcilePiUpgrade'));assert.equal(result.piRunnerUpgrade,undefined);
 assert.deepEqual(f.events.filter(e=>['WorkerApply','ExitMaintenance','Start','VerifyStartup','ready','catalog'].includes(e)),['WorkerApply','ExitMaintenance','Start','VerifyStartup','ready','catalog']);
});
test('R2: Pi still present behaves exactly as before (observePi called, canResume depends on Pi status)',async t=>{
 const f=await fixture(t,{pi:true,pandas:false});
 const r=await inspectMainPublication(f.out,f.context);
 assert.equal(r.status,'resumable');assert.ok(f.events.includes('status'));assert.equal(r.pi.status,'windows_complete');
});

test('R1: Pandas Switch already completed -> inspectMainPublication reports resumable with the exact expected remaining plan',async t=>{
 const f=await fixture(t,{pi:false,pandas:true,pandasSwitchState:'completed'});
 const r=await inspectMainPublication(f.out,f.context);
 assert.equal(r.status,'resumable');assert.equal(r.canResume,true);
 assert.equal(r.steps['切换Pandas Broker单元'],undefined);// not a tailLabels entry; Switch is checked separately
 const remaining=Object.entries(r.steps).filter(([,v])=>v.state!=='completed').map(([label])=>label);
 assert.deepEqual(remaining,['启动服务','确认启动版本','核验Pandas Broker原启动回执']);
 assert.equal(r.pandasSwitchReceipt.status,'switched_stopped');
});
// KNOWN DISCREPANCY (reported, not resolved here — see delivery report):
// finishMainPublication (publish-main-tail.mjs:9, unmodified/shared with the
// normal non-resume publish path) re-verifies the Switch receipt with
// verifyPandasSwitch(pandasSwitchReceipt, pandasBrokerRotation, maintenanceId,
// process.pid) — hardcoded to the CURRENT process's own pid, which is correct
// for the normal path (Switch and the tail run in the same process) but is
// structurally never satisfiable during a resume: the continuation process
// (process.pid here) is never the original process that ran SwitchPandasRotation
// (pandasSwitchReceipt.publicationOwnerPid, the original owner now exited —
// that is the entire premise of a resume). Passing pandasBrokerRotation/
// pandasSwitchReceipt into finishMainPublication so the tail "原样跑
// CompletePandasRotation 核验" (the brief's own instruction) unavoidably
// re-triggers this same-process check first, before CompletePandasRotation is
// even reached, and finishMainPublication is shared/unmodified. This test
// pins the real, current, verified behavior.
test('R1: resumeMainPublication currently fails inside finishMainPublication\'s own Switch re-check (process.pid identity mismatch across resume)',async t=>{
 const f=await fixture(t,{pi:false,pandas:true,pandasSwitchState:'completed'});
 await assert.rejects(resumeMainPublication(f.out,f.context),err=>{
  assert.equal(err.name,'AssertionError');
  assert.ok(!f.events.includes('CompletePandasRotation'),'must fail before reaching CompletePandasRotation');
  return true;
 });
});
test('R1: Pandas Switch not yet attempted is rejected (first period never replays Switch)',async t=>{
 const f=await fixture(t,{pi:false,pandas:true,pandasSwitchState:'not_started'});
 await assert.rejects(inspectMainPublication(f.out,f.context),/Pandas Switch未完成或结果未知/);
});
test('R1: Pandas Switch started but unknown (no result) is rejected',async t=>{
 const f=await fixture(t,{pi:false,pandas:true,pandasSwitchState:'unknown'});
 await assert.rejects(inspectMainPublication(f.out,f.context),/Pandas Switch未完成或结果未知/);
});
test('R1: pandasRuntimeChanged(request) true but PREPARED has no pandasBrokerRotation is rejected',async t=>{
 const f=await fixture(t,{pi:false,pandas:false});
 const r=await read(path.join(path.dirname(f.source),'main-release-request.json'));
 r.releasePlan.changes=[{status:'M',path:'backend/pandas_runner/broker.py'}];
 await write(path.join(path.dirname(f.source),'main-release-request.json'),r);
 await assert.rejects(inspectMainPublication(f.out,f.context),/Pandas轮换intent与准备记录不一致/);
});
test('R1: PREPARED has pandasBrokerRotation but pandasRuntimeChanged(request) is false is rejected',async t=>{
 const f=await fixture(t,{pi:false,pandas:true,pandasSwitchState:'completed'});
 const r=await read(path.join(path.dirname(f.source),'main-release-request.json'));
 r.releasePlan.changes=[];
 await write(path.join(path.dirname(f.source),'main-release-request.json'),r);
 await assert.rejects(inspectMainPublication(f.out,f.context),/Pandas轮换intent与准备记录不一致/);
});
test('R1: STARTED.pandasBrokerRotation does not match PREPARED.pandasBrokerRotation is rejected',async t=>{
 const f=await fixture(t,{pi:false,pandas:true,pandasSwitchState:'completed',pandasMismatch:true});
 await assert.rejects(inspectMainPublication(f.out,f.context),/started与准备记录的Pandas绑定不一致/);
});
test('R1: 核验Pandas Broker原启动回执 started but unknown (no result) is rejected like any other tail label',async t=>{
 const f=await fixture(t,{pi:false,pandas:true,pandasSwitchState:'completed'});
 await write(path.join(f.out,'核验Pandas Broker原启动回执-started.json'),{});
 await assert.rejects(resumeMainPublication(f.out,f.context),/未知/);
 assert.ok(!f.events.includes('CompletePandasRotation'));
});
