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
// Fix 2 (publish-main-tail.mjs's finishMainPublication gained an optional
// pandasSwitchOwnerPid parameter, defaulting to process.pid so the normal,
// non-resume path is byte-for-byte unchanged): resumeMainPublication passes
// the ORIGINAL Switch owner's pid there instead, after asserting the receipt
// actually belongs to that owner, so the tail's own internal Switch re-check
// passes even though the continuation process is never that original owner.
test('R1: resumeMainPublication completes end to end, writes the A1 resume lease, and calls CompletePandasRotation',async t=>{
 const f=await fixture(t,{pi:false,pandas:true,pandasSwitchState:'completed'});
 const leaseFile=path.join(f.runtime,'..','django/run/release-publication-lease.json');
 let seenLease=null;
 f.context.ready=async()=>{
  if(await exists(leaseFile))seenLease=await read(leaseFile);
 };
 const result=await resumeMainPublication(f.out,f.context);
 assert.equal(result.status,'deployed_and_ready');
 assert.ok(f.events.includes('CompletePandasRotation'));
 assert.ok(seenLease,'lease file must exist when ready() was called mid-resume');
 assert.equal(seenLease.version,resumeLeaseVersion);
 assert.equal(seenLease.originalOwnerPid,owner.processId);
 assert.equal(seenLease.originalOwnerCreationDate,owner.creationDate);
 assert.equal(seenLease.originalAttempt,f.out);
 assert.match(seenLease.originalStartedSha256,/^[a-f0-9]{64}$/);
 assert.match(seenLease.originalFailureSha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(Object.keys(seenLease).sort(),['createdAt','expiresAt','maintenanceId','mainCommit','originalAttempt','originalFailureSha256','originalOwnerCreationDate','originalOwnerPid','originalStartedSha256','out','ownerPid','phase','updatedAt','version'].sort());
 assert.equal(await exists(leaseFile),false,'lease must be removed once resume completes');
});
test('R1: resumeMainPublication rejects when pandasSwitchReceipt.publicationOwnerPid does not match the original publisherOwner',async t=>{
 const f=await fixture(t,{pi:false,pandas:true,pandasSwitchState:'completed'});
 // Corrupt the durable Switch receipts (both copies stage() reads) so their
 // recorded publicationOwnerPid no longer matches started.publisherOwner —
 // the pre-call assertion in resumeMainPublication must catch this before
 // ever invoking finishMainPublication, regardless of what pid is passed.
 const switchResultPath=path.join(f.out,'切换Pandas Broker单元-result.json');
 const switchedPath=path.join(f.out,'PandasRotation-switched.json');
 const switchResult=await read(switchResultPath),switched=await read(switchedPath);
 switchResult.value.publicationOwnerPid=owner.processId+1;
 switched.value.publicationOwnerPid=owner.processId+1;
 await write(switchResultPath,switchResult);await write(switchedPath,switched);
 // Caught by verifyPandasSwitch's own identity check inside inspectMainPublication
 // (publish-main-resume.mjs:98) before resumeMainPublication's own later
 // pre-call assertion is even reached; either guard rejecting is correct.
 await assert.rejects(resumeMainPublication(f.out,f.context),/Pandas Switch回执owner与原发布owner不一致|publicationOwnerPid|strictly equal/);
});
// Drives finishMainPublication directly (not through resumeMainPublication)
// with a minimal Pandas-configured fixture, proving the tail's own Switch
// re-check at publish-main-tail.mjs:9-19 passes with the original owner pid
// (matching pandasSwitchReceipt.publicationOwnerPid) and fails with any
// other pid — including the implicit default, process.pid, which is never
// that owner in this fixture (same as a real resume).
test('finishMainPublication: Switch re-check passes with pandasSwitchOwnerPid=original owner, fails with process.pid default or any other pid',async()=>{
 const {finishMainPublication}=await import('../tools/publish-main-tail.mjs');
 const maintenanceId='c'.repeat(32),originalOwnerPid=process.pid+1000;
 const pandasBrokerRotation={configured:true,image:'sha256:'+hex('9'),predecessorSourceSha256:hex('1'),prepared:true,preparedAppId:'b'.repeat(32),preparedAppSha256:hex('2'),registeredPlanSha256:hex('3'),sourceCommit:commit,sourceSha256:hex('4'),started:false};
 const pandasSwitchReceipt={...pandasBrokerRotation,maintenanceId,publicationOwnerPid:originalOwnerPid,intentSha256:hex('9'),switched:true,started:false,status:'switched_stopped'};
 const request={mainCommit:commit,components:['worker','django'],releasePlan:{changes:[{status:'M',path:'backend/pandas_runner/broker.py'}]}};
 const base={request,components:{worker:true,django:true},source:'s',identity:{tree:null},installed:'i',out:'o',api:{workerRuntimeRoot:'w'},rotation:{},before:{head:{releaseId:'r',manifestSha256:hex('5')}},plan:null,pkg:{id:pandasBrokerRotation.preparedAppId,receiptSha256:pandasBrokerRotation.preparedAppSha256},djangoExpected:hex('6'),maintenanceId,schema:null,schemaReceipt:null,piUpgradeReceipt:null,pandasBrokerRotation,pandasSwitchReceipt,step:async()=>{throw Error('must not reach any step() call before the Switch re-check throws')},save:async()=>{},sha:async()=>hex('6'),ready:async()=>{},refreshLease:async()=>{},endLease:async()=>{},progress:{begin(){},complete(){},log(){},success(){}},phase:()=>{},completed:{}};
 // Default (no pandasSwitchOwnerPid passed) uses process.pid, which is not
 // originalOwnerPid in this fixture -> must reject, same as the real blocker
 // this fix removes for the one correct pid.
 await assert.rejects(finishMainPublication({...base}),/strictly equal/);
 // An explicit, still-wrong pid must also reject.
 await assert.rejects(finishMainPublication({...base,pandasSwitchOwnerPid:originalOwnerPid+1}),/strictly equal/);
 // The original owner's own pid passes the Switch re-check specifically (it
 // then proceeds to call step(), which this fixture's step() rejects on
 // purpose, proving the Switch check itself did not throw).
 await assert.rejects(finishMainPublication({...base,pandasSwitchOwnerPid:originalOwnerPid}),/must not reach any step\(\) call/);
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

// Fix 1 (coordinator-reviewed): narrow failed_known reclassification in
// stage() for an originally-known, clean, non-timeout nonzero exit on an
// allowlisted step. Builds a no-Pi, no-Pandas base fixture (WorkerApply and
// 退出维护 completed, same as fixture()'s pandasSwitchState:'completed'
// branch does for the Pandas case) with a real-shaped 启动服务-process.json
// and the original FAILED.json's own processEvidence.processId matching it,
// then mutates exactly one field per negative test.
async function failedKnownFixture(t,{label='启动服务',processOverrides={},failedOverrides={},laterStepStarted=false}={}){
 const f=await fixture(t,{pi:false,pandas:false});
 const consumption=path.join(f.runtime,'state/worker-release-rotation-consumptions',f.prepared.workerPlan.planSha256+'.json');
 await write(consumption,{private:true});
 await write(path.join(f.out,'WorkerApply-started.json'),{planSha256:f.prepared.workerPlan.planSha256});
 await write(path.join(f.out,'WorkerApply-result.json'),{status:'activated',planSha256:f.prepared.workerPlan.planSha256,releaseId:'new',manifestSha256:f.prepared.workerPlan.candidateManifestSha256,consumptionSha256:hash(await fs.readFile(consumption))});
 f.head={releaseId:'new',manifestSha256:f.prepared.workerPlan.candidateManifestSha256};
 await f.stage('退出维护','ExitMaintenance',path.join(f.runtime,'releases/new/tools/worker-local-service.ps1'),['-MaintenanceId',f.started.maintenanceId],{status:'maintenance_ended',maintenanceId:f.started.maintenanceId});
 await fs.unlink(path.join(f.root,'django/run/system-maintenance.json'));await fs.unlink(path.join(f.root,'django/run/automation-drain.json'));
 const processId=55555;
 const processEvidence={version:1,code:'nonzero_exit',stage:'output',processId,exitCode:1,signal:null,timeoutType:null,deadlineUnixMs:1,elapsedMs:1,outputProtocol:'direct-exit-files',cleanup:'preserve',treeCleanupExitCode:null,treeCleanupPending:false,...processOverrides};
 await write(path.join(f.out,label+'-started.json'),{action:label==='启动服务'?'Start':'VerifyStartup',script:path.join(f.runtime,'releases/new/tools/worker-local-service.ps1'),extra:[]});
 await write(path.join(f.out,label+'-process.json'),{processEvidence});
 await write(path.join(f.out,'FAILED.json'),{mainCommit:commit,maintenanceStarted:true,phase:label,processEvidence:{processId},...failedOverrides});
 if(laterStepStarted){
  const later=label==='启动服务'?'确认启动版本':'核验Pandas Broker原启动回执';
  await write(path.join(f.out,later+'-started.json'),{action:'x'});
 }
 return f;
}
test('failed_known: real-shaped 启动服务 process.json + matching FAILED.json -> resumable with 启动服务 reclassified',async t=>{
 const f=await failedKnownFixture(t);
 const r=await inspectMainPublication(f.out,f.context);
 assert.equal(r.status,'resumable');assert.equal(r.canResume,true);
 assert.equal(r.steps['启动服务'].state,'failed_known');
 assert.equal(r.failedKnownLabel.label,'启动服务');
 assert.match(r.failedKnownLabel.processSha256,/^[a-f0-9]{64}$/);
});
test('failed_known: resumeMainPublication re-executes the reclassified step via step(), not skip',async t=>{
 const f=await failedKnownFixture(t);
 const result=await resumeMainPublication(f.out,f.context);
 assert.equal(result.status,'deployed_and_ready');
 assert.ok(f.events.includes('Start'),'Start must actually be re-invoked, not skipped');
 const invocation=await read((await fs.readdir(path.join(f.resumed,'attempts')).then(es=>path.join(f.resumed,'attempts',es[0],'STARTED.json'))));
 assert.equal(invocation.failedKnownLabel,'启动服务');
 assert.match(invocation.failedKnownOriginalProcessSha256,/^[a-f0-9]{64}$/);
});
test('failed_known negative: FAILED.json.phase does not match the label -> stays unknown, refused',async t=>{
 const f=await failedKnownFixture(t,{failedOverrides:{phase:'确认启动版本'}});
 await assert.rejects(inspectMainPublication(f.out,f.context),/步骤已开始但结果未知，不能重放：启动服务/);
});
test('failed_known negative: FAILED.json.maintenanceStarted is not true -> stays unknown, refused',async t=>{
 // maintenanceStarted:false is rejected by inspectMainPublication's own
 // pre-existing top-level assertion (:170, 'Expected values to be strictly
 // equal: false !== true') before stage()'s failed_known logic is ever
 // reached -- a different, older refusal than the 步骤已开始但结果未知
 // message the other failed_known negatives produce, but the same real
 // security property: this attempt is still refused, not resumed.
 const f=await failedKnownFixture(t,{failedOverrides:{maintenanceStarted:false}});
 await assert.rejects(inspectMainPublication(f.out,f.context),/Expected values to be strictly equal/);
});
test('failed_known negative: FAILED.json.processEvidence.processId does not match process.json\'s processId -> stays unknown, refused',async t=>{
 const f=await failedKnownFixture(t,{failedOverrides:{processEvidence:{processId:99999}}});
 await assert.rejects(inspectMainPublication(f.out,f.context),/步骤已开始但结果未知，不能重放：启动服务/);
});
test('failed_known negative: label not in the allowlist (退出维护) -> stays unknown, refused even with otherwise-matching evidence',async t=>{
 // 退出维护 is itself already completed in this fixture (required for 启动服务
 // to be reachable at all), so this test instead proves the allowlist gate
 // directly: WorkerApply is the step before 退出维护 and is NEVER eligible,
 // confirmed by asserting the real allowlist excludes it even when every
 // other predicate (phase/pid/shape) would otherwise match.
 const f=await fixture(t,{pi:false,pandas:false});
 const processId=55555;
 const processEvidence={version:1,code:'nonzero_exit',stage:'output',processId,exitCode:1,signal:null,timeoutType:null,deadlineUnixMs:1,elapsedMs:1,outputProtocol:'direct-exit-files',cleanup:'preserve',treeCleanupExitCode:null,treeCleanupPending:false};
 await write(path.join(f.out,'WorkerApply-started.json'),{planSha256:f.prepared.workerPlan.planSha256});
 await write(path.join(f.out,'WorkerApply-process.json'),{processEvidence});
 await write(path.join(f.out,'FAILED.json'),{mainCommit:commit,maintenanceStarted:true,phase:'WorkerApply',processEvidence:{processId}});
 await assert.rejects(inspectMainPublication(f.out,f.context),/步骤已开始但结果未知，不能重放：WorkerApply/);
});
test('failed_known negative: a later step already has a record -> the earlier one is not the last attempted step, stays unknown, refused',async t=>{
 const f=await failedKnownFixture(t,{laterStepStarted:true});
 await assert.rejects(inspectMainPublication(f.out,f.context),/步骤已开始但结果未知，不能重放：启动服务/);
});
test('failed_known negative: treeCleanupPending true -> stays unknown, refused',async t=>{
 const f=await failedKnownFixture(t,{processOverrides:{treeCleanupPending:true}});
 await assert.rejects(inspectMainPublication(f.out,f.context),/步骤已开始但结果未知，不能重放：启动服务/);
});
test('failed_known negative: timeoutType set -> stays unknown, refused',async t=>{
 const f=await failedKnownFixture(t,{processOverrides:{timeoutType:'direct-exit'}});
 await assert.rejects(inspectMainPublication(f.out,f.context),/步骤已开始但结果未知，不能重放：启动服务/);
});
test('failed_known negative: exitCode 0 (not actually a failure) -> stays unknown, refused',async t=>{
 const f=await failedKnownFixture(t,{processOverrides:{exitCode:0}});
 await assert.rejects(inspectMainPublication(f.out,f.context),/步骤已开始但结果未知，不能重放：启动服务/);
});
test('failed_known negative: outputProtocol not direct-exit-files -> stays unknown, refused',async t=>{
 const f=await failedKnownFixture(t,{processOverrides:{outputProtocol:'direct-exit-file-snapshot'}});
 await assert.rejects(inspectMainPublication(f.out,f.context),/步骤已开始但结果未知，不能重放：启动服务/);
});
test('failed_known negative: signal not null -> stays unknown, refused',async t=>{
 const f=await failedKnownFixture(t,{processOverrides:{signal:'SIGTERM'}});
 await assert.rejects(inspectMainPublication(f.out,f.context),/步骤已开始但结果未知，不能重放：启动服务/);
});
test('failed_known: 确认启动版本 is also allowlisted and reclassifies the same way',async t=>{
 const f=await failedKnownFixture(t,{label:'确认启动版本'});
 // 启动服务 itself must be completed for 确认启动版本 to be the last attempted
 // step; add it as a normal completed record.
 await f.stage('启动服务','Start',path.join(f.runtime,'releases/new/tools/worker-local-service.ps1'),[],{status:'started',manifestSha256:f.prepared.workerPlan.candidateManifestSha256});
 const r=await inspectMainPublication(f.out,f.context);
 assert.equal(r.status,'resumable');
 assert.equal(r.steps['确认启动版本'].state,'failed_known');
 assert.equal(r.failedKnownLabel.label,'确认启动版本');
});
