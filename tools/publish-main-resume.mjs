/** First-period resume: original Runner upgrade (Pi optional) + native tail, with Pandas continued only past an already-completed Switch. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {assertFrozenSource} from './frozen-main-source.mjs';
import {createMainPublicationStep} from './publish-main-step.mjs';
import {finishMainPublication} from './publish-main-tail.mjs';
import {pandasRuntimeChanged,verifyPandasSwitch} from './publish-main-pandas.mjs';
import {reconcileMainPiUpgrade} from './publish-main-pi-reconciliation.mjs';
import {assertPublicationRetired,capturePublicationOwner} from './publish-main-owner.mjs';
import {releaseLeaseTtlMs,releaseLeaseVersion,verifyPreparedPiImageSelection} from './publish-prepared-main.mjs';
export const resumeProtocol='teruisi-pi-main-resume-v1';
// First-period resume lease form (A1's new branch in
// tools/django-ai.ps1's Assert-PandasPublicationOwner): written only while
// a Pandas rotation is actually configured for this attempt, in the same
// release-publication-lease.json refreshLease() already maintains. Field
// set matches Test-ExactObjectPropertyNames in Assert-PandasResumePublicationOwner.
export const resumeLeaseVersion='teruisi-release-publication-lease-v1-resume';
const hash=b=>createHash('sha256').update(b).digest('hex');
const sha=async file=>hash(await fs.readFile(file));
const exists=async p=>{try{await fs.access(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const read=async p=>{const bytes=await fs.readFile(p);assert.ok(bytes.length<=4*1024*1024,'发布记录超过限制');return JSON.parse(bytes.toString('utf8'));};
const noProgress={begin(){},complete(){},log(){},success(){}};
// '核验Pandas Broker原启动回执' (publish-main-tail.mjs:64) runs strictly after
// '启动服务' and is included here so inspectMainPublication's stage() scan
// can tell "not started" from "started but unknown" for it (the same
// unknown-rejects-replay rule as every other tail label) and report it in
// the resumable plan. finishMainPublication never wraps this one call in
// once(completed[...]) the way it does WorkerApply/ExitMaintenance/
// Start/VerifyStartup — Complete-PandasRotation is itself idempotent
// (returns the one persisted completion receipt on a repeat call and
// rejects a changed one), so this is a plan/diagnostic addition, not a new
// skip path: a resume still calls CompletePandasRotation once through
// finishMainPublication exactly as a first attempt would.
const tailLabels=['WorkerApply','退出维护','启动服务','确认启动版本','核验Pandas Broker原启动回执'];

async function stage(original,resumed,label,{raw=false}={}){
 const records=[];
 for(const root of [original,resumed]){
  const started=path.join(root,label+'-started.json'),result=path.join(root,label+'-result.json');
  if(await exists(result)){
   assert.ok(await exists(started),'完成回执缺少原started：'+label);
   const record=await read(result),entry=await read(started);
   let processEvidence;
   if(!raw){
    const processFile=path.join(root,label+'-process.json');assert.ok(await exists(processFile),'缺少原退出证据：'+label);
    processEvidence=(await read(processFile)).processEvidence;
    assert.equal(processEvidence?.code,'completed','步骤退出结果未知：'+label);assert.equal(processEvidence.exitCode,0,'步骤未成功：'+label);
    assert.equal(processEvidence.timeoutType,null,'步骤超时：'+label);
   }
   records.push({state:'completed',value:raw?record:record.value,entry,root,processEvidence});
  }else if(await exists(started))records.push({state:'unknown',entry:await read(started),root});
 }
 assert.ok(records.length<=1,'同一步骤存在重复执行记录：'+label);
 return records[0]??{state:'not_started'};
}

async function assertLeafTree(root){
 let current=path.resolve(root);
 for(;;){const stat=await fs.lstat(current);assert.equal(stat.isSymbolicLink(),false,'发布路径不能经过链接');const parent=path.dirname(current);if(parent===current)break;current=parent;}
}
export async function inspectMainPublication(attempt,context){
 const out=path.resolve(attempt),resumed=path.join(out,'resume');
 await assertLeafTree(out);
 const started=await read(path.join(out,'STARTED.json'));
 assert.equal(started.resumeProtocol,resumeProtocol,'历史/未知发布协议不适用通用续接');
 assert.match(started.mainCommit??'',/^[a-f0-9]{40}$/);assert.match(started.maintenanceId??'',/^[a-f0-9]{32}$/);
 const source=path.resolve(started.source),packet=path.dirname(source);
 assert.equal(out,path.join(packet,'publish-'+started.mainCommit.slice(0,12)),'原发布目录与来源不一致');
 const request=await read(path.join(packet,'main-release-request.json')),prepared=await read(path.join(out,'preparation/PREPARED.json'));
 // R1: Pandas is no longer a hard reject. pandasRuntimeChanged(request) and
 // prepared.pandasBrokerRotation must agree (both present or both absent); a
 // runtime change with no prepared binding is a genuine inconsistency, not a
 // resumable state. STARTED.json's own pandasBrokerRotation (written by
 // publish-prepared-main.mjs before Switch ever runs, from the same prepared
 // binding) must be byte-identical to prepared.pandasBrokerRotation when
 // either is present — not merely both-truthy — because it is this
 // function's only independent confirmation that the preparation record
 // backing a years-old attempt directory has not been swapped since.
 assert.deepEqual(started.pandasBrokerRotation,prepared.pandasBrokerRotation,'started与准备记录的Pandas绑定不一致');
 assert.equal(Boolean(pandasRuntimeChanged(request)),Boolean(prepared.pandasBrokerRotation),
  'Pandas轮换intent与准备记录不一致；续接入口不能跳过本域原启动证明或自动重放切换');
 let pandasSwitchReceipt=null;
 if(prepared.pandasBrokerRotation?.configured){
  // Switch itself is never replayed in this period: only a publication that
  // already got through SwitchPandasRotation (strictly before WorkerApply in
  // publish-prepared-main.mjs's own ordering) is eligible. Unknown/missing
  // Switch evidence is refused, not treated as "not yet attempted" the way
  // WorkerApply itself would be — Switch has no -process.json direct-exit
  // evidence of its own in this shape, so completeness is judged by the two
  // durable receipts the original publisher wrote once Switch returned.
  const switchResult=await stage(out,resumed,'切换Pandas Broker单元');
  assert.equal(switchResult.state,'completed','Pandas Switch未完成或结果未知，第一期不重放Switch');
  assert.ok(await exists(path.join(out,'PandasRotation-switched.json')),'缺少原Pandas Switch durable回执');
  const switchedReceipt=(await read(path.join(out,'PandasRotation-switched.json'))).value;
  assert.deepEqual(switchedReceipt,switchResult.value,'原Pandas Switch durable回执与原始结果不一致');
  pandasSwitchReceipt=verifyPandasSwitch(switchResult.value,prepared.pandasBrokerRotation,started.maintenanceId,started.publisherOwner.processId);
 }
 assert.equal(request.latestMainRelease,true);assert.equal(request.version,'teruisi-frozen-latest-main-request-v1');
 assert.equal(request.mainCommit,started.mainCommit);assert.equal(prepared.version,'teruisi-main-preparation-v1');
 assert.equal(hash(Buffer.from(JSON.stringify(request))),started.requestSha256);assert.equal(prepared.requestSha256,started.requestSha256);
 assert.deepEqual(started.components,request.components);assert.deepEqual(request.components,['worker','django'],'首版仅支持Worker+Django的Runner升级尾部');
 assert.equal(request.migrate,false,'结构发布保持原专用恢复');assert.equal(request.releasePlan?.migrate,false);assert.equal(started.schemaRelease,undefined);assert.equal(started.operationId,undefined);
 assert.equal(request.completedTask,undefined,'历史专用入口不能通用续接');assert.equal(request.schemaRelease,undefined);
 assert.equal(request.releasePlan.headSha,request.mainCommit);assert.equal(request.releasePlan.baseSha,request.deployedCommit);assert.deepEqual(request.releasePlan.components,request.components);
 // R2: piRunnerUpgrade is now optional; workerPlan/djangoPackage remain required.
 assert.ok(prepared.workerPlan&&prepared.djangoPackage,'缺少本次完整准备包');
 assert.match(prepared.djangoManifestSha256??'',/^[a-f0-9]{64}$/);
 if(prepared.piRunnerUpgrade)assert.match(prepared.piRunnerUpgrade.registeredPlanSha256??'',/^[a-f0-9]{64}$/);
 assert.deepEqual(prepared.sourceIdentity,{commit:started.mainCommit,tree:started.sourceTree});
 const identity=await (context.sourceIdentity??(()=>assertFrozenSource({source,mainCommit:started.mainCommit,sourceTree:request.sourceTree})))();
 assert.deepEqual(identity,prepared.sourceIdentity,'原冻结来源发生变化');
 await verifyPreparedPiImageSelection(request,prepared,path.join(out,'preparation'),identity);
 const failure=await exists(path.join(out,'FAILED.json'))?await read(path.join(out,'FAILED.json')):null;
 for(const file of [path.join(out,'SUCCESS.json'),path.join(resumed,'SUCCESS.json')])if(await exists(file)){
  const success=await read(file);assert.equal(success.status,'deployed_and_ready');assert.equal(success.mainCommit,request.mainCommit);
  return {status:'recorded_complete',canResume:false,receiptPath:file,mainCommit:request.mainCommit,success,request,prepared,started,source,out,resumed,identity};
 }
 assert.ok(failure,'原失败回执缺失，不能自动续接');assert.equal(failure.mainCommit,request.mainCommit);assert.equal(failure.maintenanceStarted,true);
 const {api,rotation}=context,installed=context.installedRoot??'D:/teruisi-runtime/django-sales/app',runtime=context.workerRuntimeRoot??api.workerRuntimeRoot;
 const originalActorPids=[];
 for(const root of [out,resumed])if(await exists(root))for(const name of await fs.readdir(root)){
  if(!name.endsWith('-process.json'))continue;
  const record=await read(path.join(root,name)),e=record.processEvidence;
  if(e?.processId&&!(e.code==='completed'&&e.exitCode===0))originalActorPids.push(e.processId);
 }
 if(failure.processEvidence?.processId)originalActorPids.push(failure.processEvidence.processId);
 await (context.assertRetired??assertPublicationRetired)({owner:started.publisherOwner,actorPids:[...new Set(originalActorPids)],source,attempt:out,prepared});
 const owners=path.join(resumed,'attempts');
 if(await exists(owners)){
  const entries=await fs.readdir(owners);assert.ok(entries.length<=64,'续接历史超过边界');
  for(const entry of entries){assert.match(entry,/^[a-f0-9]{32}$/);const old=await read(path.join(owners,entry,'STARTED.json'));assert.equal(old.originalStartedSha256,await sha(path.join(out,'STARTED.json')));await (context.assertRetired??assertPublicationRetired)({owner:old.owner,actorPids:[],source,attempt:out,prepared});}
 }
 assert.equal(await (context.sha??sha)(path.join(installed,'deployment.json')),prepared.djangoManifestSha256,'当前Django不是本次已部署包');
 assert.equal(await (context.sha??sha)(path.join(path.dirname(installed),'app.prepare-'+prepared.djangoPackage.id+'.json')),prepared.djangoPackage.receiptSha256,'原准备收据已变化');
 const deployed=await stage(out,resumed,'部署后台'),acl=await stage(out,resumed,'应用后台权限');
 for(const [label,r,action] of [['DeployApp',deployed,'DeployApp'],['HardenAcl',acl,'HardenAcl']]){
  assert.equal(r.state,'completed',label+'无可信完成回执，不能重新执行');assert.equal(r.entry.action,action);
 }
 assert.equal(path.resolve(deployed.entry.script),path.join(source,'tools/django-local-service.ps1'));assert.equal(deployed.entry.extra[deployed.entry.extra.indexOf('-PreparedAppId')+1],prepared.djangoPackage.id);assert.equal(deployed.entry.extra[deployed.entry.extra.indexOf('-PreparedAppSha256')+1],prepared.djangoPackage.receiptSha256);
 assert.equal(path.resolve(acl.entry.script),path.join(installed,'tools/django-local-service.ps1'));
 const steps={},completed={};let preceding=true;
 for(const label of tailLabels){
  const record=await stage(out,resumed,label,{raw:label==='WorkerApply'});steps[label]=record;
  assert.notEqual(record.state,'unknown','步骤已开始但结果未知，不能重放：'+label);
  if(record.state==='completed'){
   assert.equal(preceding,true,'发布步骤不连续：'+label);completed[label]=record.value;
   if(label==='WorkerApply'){
    assert.equal(record.entry.planSha256,prepared.workerPlan.planSha256);assert.equal(record.value.planSha256,prepared.workerPlan.planSha256);assert.equal(record.value.releaseId,prepared.workerPlan.candidateReleaseId);assert.equal(record.value.manifestSha256,prepared.workerPlan.candidateManifestSha256);
    assert.ok(['activated','already_activated'].includes(record.value.status));
    const consumption=path.join(runtime,'state/worker-release-rotation-consumptions',prepared.workerPlan.planSha256+'.json');assert.equal(await (context.sha??sha)(consumption),record.value.consumptionSha256,'Worker消费回执不匹配');
   }else if(label==='核验Pandas Broker原启动回执'){
    // This step's script/action are django-ai.ps1/CompletePandasRotation, not the
    // Worker controller every other tailLabels entry uses; a completed record only
    // means a PRIOR resume already ran it (see the tailLabels comment above for why
    // finishMainPublication still re-runs it idempotently rather than skipping it).
    assert.ok(prepared.pandasBrokerRotation?.configured,'无Pandas轮换时不应出现该步骤记录');
    assert.equal(record.entry.action,'CompletePandasRotation');assert.equal(path.resolve(record.entry.script),path.join(installed,'tools/django-ai.ps1'));
   }else{
    const action={'退出维护':'ExitMaintenance','启动服务':'Start','确认启动版本':'VerifyStartup'}[label];assert.equal(record.entry.action,action);assert.equal(path.resolve(record.entry.script),path.join(runtime,'releases',prepared.workerPlan.candidateReleaseId,'tools/worker-local-service.ps1'));
    if(label==='退出维护'){assert.equal(record.value.status,'maintenance_ended');assert.equal(record.value.maintenanceId,started.maintenanceId);}
    if(label==='启动服务'){assert.ok(['started','already_running'].includes(record.value.status));assert.equal(record.value.manifestSha256,prepared.workerPlan.candidateManifestSha256);}
    if(label==='确认启动版本')assert.equal(record.value.startupVerified,true);
   }
  }else preceding=false;
 }
 const chain=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});
 if(completed.WorkerApply){assert.equal(chain.head.releaseId,prepared.workerPlan.candidateReleaseId);assert.equal(chain.head.manifestSha256,prepared.workerPlan.candidateManifestSha256);}
 else{assert.deepEqual(chain.head,request.predecessorWorker);assert.equal(chain.chainStateSha256,started.predecessorChainStateSha256,'原前驱链已变化');}
 const maintenance=path.join(path.dirname(installed),'run/system-maintenance.json'),drain=path.join(path.dirname(installed),'run/automation-drain.json');
 if(completed['退出维护']){assert.equal(await exists(maintenance),false);assert.equal(await exists(drain),false);}
 else{
  const m=await read(maintenance),d=await read(drain);assert.equal(m.id,started.maintenanceId);assert.equal(d.id,started.maintenanceId);assert.equal(m.keepPostgres,true);assert.equal(m.drainedStopped,true);assert.equal(d.keepPostgres,true);assert.equal(d.phase,'requests');
 }
 // R2: no Pi upgrade in this preparation -> skip observePi/reconcileMainPiUpgrade
 // entirely; canResume no longer depends on Pi. With Pi present, behavior is
 // unchanged from before this change.
 let pi=null,reconciliationAttempted=false,canResume;
 if(prepared.piRunnerUpgrade){
  pi=await context.observePi(prepared.piRunnerUpgrade,installed);
  assert.equal(pi.registeredPlanSha256,prepared.piRunnerUpgrade.registeredPlanSha256);assert.equal(pi.sourceSha256,prepared.piRunnerUpgrade.sourceSha256);assert.equal(pi.image,prepared.piRunnerUpgrade.image);
  reconciliationAttempted=await exists(path.join(out,'PiReconcile-started.json'));
  canResume=pi.status==='windows_complete'||pi.status==='reconcile_available'&&!reconciliationAttempted;
  if(completed.WorkerApply)assert.equal(pi.status,'windows_complete','Worker已切换但Pi升级未完成');
 }else canResume=true;
 return {status:canResume?'resumable':'blocked',canResume,reason:canResume?null:reconciliationAttempted?'original_reconciliation_already_started':pi.reason,mainCommit:request.mainCommit,source,out,resumed,request,prepared,started,identity,installed,runtime,pi,steps,completed,chain,pandasSwitchReceipt};
}

export async function resumeMainPublication(attempt,context){
 const {rotation,api}=context;
 return rotation.withRotationLock(async rotationLease=>{
  await rotation.assertActiveBatchOwnership(context.workerRuntimeRoot??api.workerRuntimeRoot);
  const state=await inspectMainPublication(attempt,context);
  if(state.status==='recorded_complete'){
   // Index coordination only: never re-enter a lifecycle step after SUCCESS.
   const check=context.assertRetired??assertPublicationRetired;
   await check({owner:state.started.publisherOwner,actorPids:[],source:state.source,attempt:state.out,prepared:state.prepared});
   const owners=path.join(state.resumed,'attempts');
   if(await exists(owners))for(const entry of await fs.readdir(owners)){
    assert.match(entry,/^[a-f0-9]{32}$/);const owner=await read(path.join(owners,entry,'STARTED.json'));
    assert.equal(owner.originalStartedSha256,await sha(path.join(state.out,'STARTED.json')));await check({owner:owner.owner,actorPids:[],source:state.source,attempt:state.out,prepared:state.prepared});
   }
   await context.beforeResume?.(state);
   await context.publishCatalog({...state.success,receiptPath:state.receiptPath},state);return {...state.success,status:'already-current',receiptPath:state.receiptPath};
  }
  assert.equal(state.canResume,true,state.reason??'发布不具备受限续接条件');
  await context.beforeResume?.(state);
  const {out,resumed,request,prepared,started,source,identity,installed,completed,pandasSwitchReceipt}=state;
  await fs.mkdir(path.join(resumed,'attempts'),{recursive:true});const invocation=path.join(resumed,'attempts',randomUUID().replaceAll('-',''));await fs.mkdir(invocation);
  const save=(name,value)=>fs.writeFile(path.join(resumed,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  const originalStartedSha256=await sha(path.join(out,'STARTED.json')),originalFailureSha256=await sha(path.join(out,'FAILED.json'));
  await fs.writeFile(path.join(invocation,'STARTED.json'),JSON.stringify({at:new Date().toISOString(),originalStartedSha256,originalFailureSha256,owner:await (context.captureOwner??capturePublicationOwner)(),mainCommit:request.mainCommit,maintenanceId:started.maintenanceId})+'\n',{flag:'wx'});
  const leaseFile=path.join(path.dirname(installed),'run/release-publication-lease.json');let ownLease=null,phase='Pi升级对账';const createdAt=new Date().toISOString();
  // A1's resume lease form is written only while this attempt actually has a
  // configured Pandas rotation: that is the only consumer
  // (Assert-PandasPublicationOwner's -resume branch, reached only with
  // -AllowResume from Start-PandasSandbox's pending path). A no-Pandas resume
  // keeps writing the ordinary lease exactly as before this change.
  const usesPandasResumeLease=Boolean(prepared.pandasBrokerRotation?.configured);
  const refreshLease=async label=>{
   if(ownLease!==null)assert.equal(await fs.readFile(leaseFile,'utf8'),ownLease,'续接lease owner发生变化');
   const now=new Date();
   const raw=JSON.stringify(usesPandasResumeLease?{
    version:resumeLeaseVersion,ownerPid:process.pid,phase:label,createdAt,updatedAt:now.toISOString(),expiresAt:new Date(+now+releaseLeaseTtlMs).toISOString(),
    mainCommit:request.mainCommit,maintenanceId:started.maintenanceId,out:resumed,
    originalOwnerPid:started.publisherOwner.processId,originalOwnerCreationDate:started.publisherOwner.creationDate,
    originalStartedSha256,originalFailureSha256,originalAttempt:out,
   }:{version:releaseLeaseVersion,ownerPid:process.pid,phase:label,createdAt,updatedAt:now.toISOString(),expiresAt:new Date(+now+releaseLeaseTtlMs).toISOString(),mainCommit:request.mainCommit,maintenanceId:started.maintenanceId,out:resumed})+'\n';
   if(ownLease===null)await fs.writeFile(leaseFile,raw,{flag:'wx'});else{const tmp=leaseFile+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,raw,{flag:'wx'});assert.equal(await fs.readFile(leaseFile,'utf8'),ownLease);await fs.rename(tmp,leaseFile);}ownLease=raw;
  };
  const endLease=async()=>{if(ownLease!==null&&await exists(leaseFile)){assert.equal(await fs.readFile(leaseFile,'utf8'),ownLease);await fs.unlink(leaseFile);}ownLease=null;};
  const progress=context.progress??noProgress;
  const step=createMainPublicationStep({out:resumed,request,api,transport:context.transport,runStep:context.runStep,progress,phase:value=>{phase=value;},refreshLease});
  const observeStep=(label,...args)=>step(label,...args.slice(0,3),{...(args[3]??{}),directory:invocation});
  try{
   await refreshLease(phase);
   // R2: no Pi upgrade in this preparation -> skip reconcileMainPiUpgrade entirely.
   const upgrade=prepared.piRunnerUpgrade?await reconcileMainPiUpgrade({prepared:prepared.piRunnerUpgrade,installed,out:invocation,intentRoot:out,step:observeStep,requireReconcileDirectExit:!context.runStep}):null;
   const result=await finishMainPublication({request,components:{worker:true,django:true},source,identity,installed,out:resumed,api,rotation,rotationLease,before:{head:request.predecessorWorker},plan:prepared.workerPlan,pkg:prepared.djangoPackage,djangoExpected:prepared.djangoManifestSha256,maintenanceId:started.maintenanceId,schema:null,schemaReceipt:null,piUpgradeReceipt:upgrade,pandasBrokerRotation:prepared.pandasBrokerRotation??null,pandasSwitchReceipt,step,save,sha:context.sha??sha,ready:context.ready,refreshLease,endLease,progress,phase:value=>{phase=value;},completed,receiptExtra:{manualRecovery:true,automatedPublisherSuccess:false,originalAttempt:out,originalStartedSha256,originalFailureSha256}});
   await context.publishCatalog(result,state);
   await fs.writeFile(path.join(invocation,'COMPLETED.json'),JSON.stringify({at:new Date().toISOString(),status:result.status,receiptPath:result.receiptPath,receiptSha256:await sha(result.receiptPath)})+'\n',{flag:'wx'});return result;
  }catch(error){await fs.writeFile(path.join(invocation,'FAILED.json'),JSON.stringify({at:new Date().toISOString(),phase,error:String(error.message).slice(0,1200),processEvidence:error.processEvidence??null,automaticReplay:false})+'\n',{flag:'wx'});throw error;}
  finally{await endLease();}
 });
}
