/** Reconcile one exact original upgrade. Never retries apply or starts a unit. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

export function verifyUpgradeReceipt(value,prepared){
 assert.equal(value?.upgraded,true);assert.equal(value.windowsConfigUpdated,true);assert.equal(value.sameDpapiOwner,true);
 assert.equal(value.sourceSha256,prepared.sourceSha256);assert.equal(value.image,prepared.image);
 return value;
}
export async function reconcileMainPiUpgrade({prepared,installed,out,intentRoot=out,step,originalError,requireDirectExit=false,requireReconcileDirectExit=true}){
 if(requireDirectExit){
  const observed=JSON.parse(await fs.readFile(path.join(intentRoot,'升级Pi Runner-process.json'),'utf8')).processEvidence;
  assert.ok(observed&&Number.isInteger(observed.exitCode)&&observed.timeoutType===null,'原UpgradePi未证实直接退出，不能自动协调');
 }
 const script=path.join(installed,'tools/django-ai.ps1'),args=['-PiUpgradePlanSha256',prepared.registeredPlanSha256];
 const bind=value=>{
  assert.equal(value.registeredPlanSha256,prepared.registeredPlanSha256);assert.equal(value.sourceSha256,prepared.sourceSha256);assert.equal(value.image,prepared.image);
  if(prepared.operationId)assert.equal(value.operationId,prepared.operationId);
  if(prepared.planSha256)assert.equal(value.planSha256,prepared.planSha256);
  return value;
 };
 const status=bind(await step('核对Pi升级原结果',script,'PiUpgradeStatus',args));
 const verify=async()=>{
  const completed=bind(await step('确认Pi升级后置检查',script,'VerifyPiUpgradeResult',args));
  assert.equal(completed.status,'windows_complete');assert.equal(completed.postconditionsVerified,true);
  return verifyUpgradeReceipt(completed.upgradeReceipt,prepared);
 };
 if(status.status==='windows_complete')return verify();
 if(status.status!=='reconcile_available')throw originalError??Error('Pi升级不具备原操作协调条件：'+status.reason);
 const intent=path.join(intentRoot,'PiReconcile-started.json');
 await fs.writeFile(intent,JSON.stringify({at:new Date().toISOString(),registeredPlanSha256:prepared.registeredPlanSha256,operationId:status.operationId,sourceSha256:prepared.sourceSha256,automaticReplay:false})+'\n',{flag:'wx'});
 let failure;
 try{verifyUpgradeReceipt(await step('协调Pi升级原操作',script,'ReconcilePiUpgrade',args),prepared);}
 catch(error){failure=error;}
 // Even an output/ACL error may follow a successful atomic Windows result.
 if(failure){
  if(requireReconcileDirectExit){
   const evidence=JSON.parse(await fs.readFile(path.join(out,'协调Pi升级原操作-process.json'),'utf8')).processEvidence;
   assert.ok(evidence&&Number.isInteger(evidence.exitCode)&&evidence.timeoutType===null,'原Reconcile未证实直接退出，保留原意图并停止');
  }
  const observed=bind(await step('复核Pi协调持久结果',script,'PiUpgradeStatus',args));
  if(observed.status!=='windows_complete')throw failure;
 }
 return verify();
}
