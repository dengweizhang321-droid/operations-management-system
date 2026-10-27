/** Shared native publication tail; trusted completed steps are reused, never rerun. */
import path from 'node:path';
import assert from 'node:assert/strict';

export async function finishMainPublication({request,components,source,identity,installed,out,api,rotation,rotationLease,before,plan,pkg,djangoExpected,maintenanceId,schema,schemaReceipt,piUpgradeReceipt,step,save,sha,ready,refreshLease,endLease,progress,phase,completed={},receiptExtra={}}){
 const once=async(label,operation)=>Object.hasOwn(completed,label)?completed[label]:operation();
 if(plan){
  phase('切换前端');progress.begin('切换前端');await refreshLease('切换前端');
  const applied=await once('WorkerApply',async()=>{
   await save('WorkerApply-started.json',{at:new Date().toISOString(),planSha256:plan.planSha256});
   // C 项第三步修复: rotation's apply stages log through console.log, which this
   // process owns, so the lines are lost unless they are collected here. The
   // interception lives inside this operation on purpose. It is the only place a
   // regular publication actually runs apply — publish-main.mjs:102 throws before
   // its own copy of this collection can run, which is why the first attempt
   // produced no receipt in production — and the window is narrow enough that
   // rotation.applyApprovedRotationPlan is the only rotation call inside it, so
   // nothing but apply.* stages can reach the parser. A resume that reuses
   // WorkerApply skips this operation whole and therefore writes no receipt,
   // rather than an empty one. Restoring in `finally` is required: a throwing
   // apply must not leave the replacement installed. Forwarding to the original
   // keeps anything else logging in this window visible, and is itself wrapped
   // because a throwing console.log must not break the apply.
   const applyTimingLines=[],originalConsoleLog=console.log;
   let value;
   try{
    console.log=(...args)=>{try{applyTimingLines.push(args.join(' '));}catch{/* diagnostic only */}try{originalConsoleLog(...args);}catch{/* diagnostic only */}};
    value=await rotation.applyApprovedRotationPlan({approvedPlanSha256:plan.planSha256,rotationLease});
   }finally{console.log=originalConsoleLog;}
   await save('WorkerApply-result.json',value);
   // Diagnostics only: losing the receipt must never fail a release that worked,
   // so the operational receipt above is written first and this whole block is
   // guarded. The parser is imported dynamically on purpose — a static import
   // would add publish-latest-main.mjs and its relative imports to the closure
   // every release packet must carry, and a packet missing one would die with
   // ERR_MODULE_NOT_FOUND before admission, which
   // main-publication-readiness.test.mjs pins. Here a missing file costs the
   // receipt and nothing else.
   try{
    const {parseApplyTimingLines}=await import('./publish-latest-main.mjs');
    const timing=parseApplyTimingLines(applyTimingLines);
    await save('apply-timing.json',{version:'teruisi-apply-timing-v1',at:new Date().toISOString(),mainCommit:request.mainCommit,
     planSha256:plan.planSha256,releaseId:value.releaseId,...timing});
   }catch{/* diagnostic only */}
   return value;
  });
  assert.ok(['activated','already_activated'].includes(applied.status));assert.equal(applied.releaseId,plan.candidateReleaseId);await refreshLease('切换前端');progress.complete();
 }
 const targetWorker=path.join(api.workerRuntimeRoot,'releases',plan?.candidateReleaseId??before.head.releaseId,'tools/worker-local-service.ps1');
 if(components.django){const ended=await once('退出维护',()=>step('退出维护',targetWorker,'ExitMaintenance',['-MaintenanceId',maintenanceId]));assert.equal(ended.status,'maintenance_ended');assert.equal(ended.maintenanceId,maintenanceId);}
 const started=await once('启动服务',()=>step('启动服务',targetWorker,'Start',components.django?[]:['-BackendStartPolicy','RequireReady']));
 assert.ok(['started','already_running'].includes(started.status));assert.equal(started.manifestSha256,plan?.candidateManifestSha256??before.head.manifestSha256);
 if(!components.django){const ended=await once('结束前端排空',()=>step('结束前端排空',targetWorker,'EndWorkerDrain',['-MaintenanceId',maintenanceId]));assert.equal(ended.status,'worker_drain_ended');assert.equal(ended.maintenanceId,maintenanceId);}
 const startup=await once('确认启动版本',()=>step('确认启动版本',targetWorker,'VerifyStartup'));assert.equal(startup.startupVerified,true);
 phase('确认服务可用');progress.begin('确认服务可用');
 const after=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});
 assert.equal(after.head.releaseId,plan?.candidateReleaseId??before.head.releaseId);assert.equal(after.head.manifestSha256,plan?.candidateManifestSha256??before.head.manifestSha256);
 assert.equal(await sha(path.join(installed,'deployment.json')),djangoExpected,'最终后台manifest不匹配');
 await refreshLease('确认服务可用');await ready();progress.complete();await endLease();
 const receipt={...receiptExtra,status:'deployed_and_ready',at:new Date().toISOString(),mainCommit:request.mainCommit,components:request.components,workerRelease:after.head.releaseId,workerManifestSha256:after.head.manifestSha256,djangoManifestSha256:djangoExpected,source,sourceTree:identity.tree??null,djangoPreparedId:pkg?.id??null,maintenanceId,migration:schema?.steps[0]??null,...(schemaReceipt?{schemaReceipt}:{}),...(piUpgradeReceipt?{piRunnerUpgrade:piUpgradeReceipt}:{}),startupVerified:true,readyVerified:true,backupPerformed:false};
 await save('SUCCESS.json',receipt);progress.success('main版本：'+request.mainCommit+'；步骤详细日志：'+out);
 return {...receipt,receiptPath:path.join(out,'SUCCESS.json')};
}
