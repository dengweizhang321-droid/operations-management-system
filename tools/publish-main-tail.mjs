/** Shared native publication tail; trusted completed steps are reused, never rerun. */
import path from 'node:path';
import assert from 'node:assert/strict';

export async function finishMainPublication({request,components,source,identity,installed,out,api,rotation,rotationLease,before,plan,pkg,djangoExpected,maintenanceId,schema,schemaReceipt,piUpgradeReceipt,step,save,sha,ready,refreshLease,endLease,progress,phase,completed={},receiptExtra={}}){
 const once=async(label,operation)=>Object.hasOwn(completed,label)?completed[label]:operation();
 if(plan){
  phase('切换前端');progress.begin('切换前端');await refreshLease('切换前端');
  const applied=await once('WorkerApply',async()=>{
   await save('WorkerApply-started.json',{at:new Date().toISOString(),planSha256:plan.planSha256});
   const value=await rotation.applyApprovedRotationPlan({approvedPlanSha256:plan.planSha256,rotationLease});
   await save('WorkerApply-result.json',value);return value;
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
