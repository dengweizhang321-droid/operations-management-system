/** Finite 6dc recovery. No production imports or I/O occur on import. */
import assert from 'node:assert/strict';

export const identity=Object.freeze({
 commit:'6dc028139cc6e561dcad68d76c9d673596d9ec82',tree:'d59298fb09af5f27dbda1e0999823af1e8d95f05',maintenanceId:'5fe642a2602243ca83819253d8848e57',
 oldRelease:'20261018T081823Z-282cee340c57bf41',oldWorker:'120911425367ef3a451c40f7a9842f3c1e39fc99b38cfd602b011ae3ed0733fc',oldDjango:'a9e3fdb943dfcc558a69982f9d410aff103872712e26e0d50b0cefe3841693e7',
 chain:'bdfa4fc9680ee4c02341fbe5d2938ecf2168ba20ebf89e3b979be9ab4569aa4d',plan:'e9114eb427dd3dc3412941b36d3faf5322d2e4b6e5959be99958a995ea9d5ce4',
 release:'20261018T112936Z-f51e4f3671a64cd3',worker:'9eb5a75ac7d377c786bfc0fdb0ef6c0d8129698cf82e416fccfc07fbdb449fd7',django:'ca9c731a0843e7e01d8300f6190bca1377114f228ad5b17c16113e4028a582a9',
 preparedId:'32ba2595db6d4cc397e34945e7cd13a4',preparedSha:'27f15f9ca5d32460ffac3f5c3eeea361bb02bec25e119e1a6ef4509c6a1444fc'
});
export function assertSnapshot(value,phase){
 assert.ok(value&&typeof value==='object'&&!Array.isArray(value));assert.equal(value.version,'6dc-maintenance-observation-v1');
 for(const field of ['originalActorsAbsent','controlsAbsent','postgresOwnedReady'])assert.equal(value[field],true,field+' is not proved');
 assert.equal(value.maintenanceId,identity.maintenanceId);assert.equal(value.nativeStopIdentityGatePreserved,true);
 if(phase==='final'){assert.equal(value.maintenanceAbsent,true);assert.equal(value.drainAbsent,true);return;}
 assert.equal(value.workerReceiptAbsent,true);
 for(const [record,version]of[[value.maintenance,'teruisi-system-maintenance-v1'],[value.drain,'teruisi-automation-drain-v1']]){
  assert.ok(record&&typeof record==='object'&&!Array.isArray(record));assert.equal(record.version,version);assert.equal(record.id,identity.maintenanceId);
  assert.equal(record.runtimeRoot.toLowerCase().replaceAll('/','\\'),'d:\\teruisi-runtime\\django-sales');assert.equal(record.keepPostgres,true);
 }
 assert.equal(value.drain.phase,'requests');assert.equal(value.piStopBound,true);
 if(value.maintenance.drainedStopped!==undefined)assert.equal(typeof value.maintenance.drainedStopped,'boolean');
 if(phase!=='partial'){assert.equal(value.maintenance.drainedStopped,true);assert.equal(value.fullNativeStopVerified,true);}
 else if(value.maintenance.drainedStopped===true)assert.equal(value.fullNativeStopVerified,true,'Completed maintenance lacks native stopped proof');
}

/** Seams are a private test harness; the fixed CLI constructs native deps itself. */
export async function runRecovery(facts,d,store){
 await d.validateStatic(facts);
 assert.equal(await store.exists('RECOVERY-STARTED.json'),false,'Recovery already started: no native replay, even after success');
 const started={version:'6dc-maintenance-recovery-started-v1',at:d.now(),maintenanceId:identity.maintenanceId,commit:identity.commit,intentSha256:d.intentSha256,driverSha256:d.driverSha256};
 await store.create('RECOVERY-STARTED.json',started);
 let phase='rotation',deploymentReady=false;
 try{return await d.withRotationLock(async lease=>{
  await d.assertActiveBatch();await store.create('RECOVERY-OWNER.json',await d.owner());
  phase='admission';let before=await d.observe('partial');assertSnapshot(before,'partial');await d.assertPredecessor();
  await d.verifyPrepared(lease);await d.validateStatic(facts);before=await d.observe('partial');assertSnapshot(before,'partial');await d.assertPredecessor();
  phase='EnterMaintenance';
  assert.notEqual(before.maintenance.drainedStopped,true,'Unexpected prior completion: no implicit coordination');
  const entered=await d.enter();
  assert.equal(entered.status,'maintenance');assert.equal(entered.maintenanceId,identity.maintenanceId);assert.equal(entered.postgresPreserved,true);assert.equal(entered.backendStopped,true);
  const stopped=await d.observe('stopped');assertSnapshot(stopped,'stopped');await d.validateStatic(facts);await d.assertPredecessor();await d.assertNoDownstream();
  phase='Stop';const stop=await d.step('Stop',facts.oldWorker,'Stop');assert.ok(['stopped','already_stopped','stale_receipt_cleared'].includes(stop.status));
  phase='DeployApp';await d.step('DeployApp',facts.sourceDjango,'DeployApp',['-PreparedAppId',identity.preparedId,'-PreparedAppSha256',identity.preparedSha],false);
  await d.assertDjango(identity.django);
  phase='HardenAcl';await d.step('HardenAcl',facts.installedDjango,'HardenAcl',[],false);
  phase='WorkerApply';await store.create('WorkerApply-started.json',{at:d.now(),approvedPlanSha256:identity.plan});
  const applied=await d.apply({approvedPlanSha256:identity.plan,rotationLease:lease});
  await store.create('WorkerApply-result.json',{at:d.now(),value:applied});assert.ok(['activated','already_activated'].includes(applied.status));assert.equal(applied.releaseId,identity.release);
  phase='ExitMaintenance';const ended=await d.step('ExitMaintenance',facts.targetWorker,'ExitMaintenance',['-MaintenanceId',identity.maintenanceId]);assert.equal(ended.status,'maintenance_ended');assert.equal(ended.maintenanceId,identity.maintenanceId);
  phase='Start';const running=await d.step('Start',facts.targetWorker,'Start');assert.ok(['started','already_running'].includes(running.status));assert.equal(running.manifestSha256,identity.worker);
  phase='VerifyStartup';const startup=await d.step('VerifyStartup',facts.targetWorker,'VerifyStartup');assert.equal(startup.startupVerified,true);
  phase='Final';await d.assertTarget();await d.ready();assertSnapshot(await d.observe('final'),'final');
  const sourceTree=await d.sourceTree();
  const receipt={status:'deployed_and_ready',at:d.now(),mainCommit:identity.commit,components:['worker','django'],workerRelease:identity.release,workerManifestSha256:identity.worker,djangoManifestSha256:identity.django,source:facts.source,sourceGitTree:identity.tree,sourceTree,djangoPreparedId:identity.preparedId,maintenanceId:identity.maintenanceId,migration:null,backupPerformed:false,recovery:{intentSha256:d.intentSha256,driverSha256:d.driverSha256,originalStartedSha256:facts.originalStartedSha256,originalFailureSha256:facts.originalFailureSha256}};
  await store.create('RECOVERY-SUCCESS.json',receipt);deploymentReady=true;
  phase='Catalog';await finishCatalog(receipt,facts,d,store);return receipt;
 });}catch(error){await store.create('RECOVERY-FAILED.json',{at:d.now(),phase,code:deploymentReady?'deployment-ready-catalog-unfinished':'unknown-no-replay',message:String(error.message).slice(0,1800),processEvidence:error.processEvidence??null,automaticRetry:false,deploymentReady});throw error;}
}
async function finishCatalog(receipt,facts,d,store){
 await d.assertTarget();await d.ready();assertSnapshot(await d.observe('final'),'final');
 await d.catalogCas(receipt);const live=await d.readLive();
 assert.equal(live.mainCommit,identity.commit);assert.equal(live.head.releaseId,identity.release);assert.equal(live.head.manifestSha256,identity.worker);assert.equal(live.djangoManifestSha256,identity.django);assert.equal(live.resolvedOriginalAttempt,true);
 await store.create('CATALOG-COMPLETE.json',{at:d.now(),live});
}

/** Independent explicit catalog-only invocation, never called by runRecovery retry. */
export async function finishCatalogOnly(facts,d,store){
 await d.validateStatic(facts);assert.equal(await store.exists('RECOVERY-STARTED.json'),true);assert.equal(await store.exists('RECOVERY-SUCCESS.json'),true);
 assert.equal(await store.exists('CATALOG-COMPLETE.json'),false,'Catalog already completed; use read-only inspection');
 const receipt=await store.read('RECOVERY-SUCCESS.json');
 assert.equal(receipt.status,'deployed_and_ready');assert.equal(receipt.mainCommit,identity.commit);assert.equal(receipt.maintenanceId,identity.maintenanceId);assert.equal(receipt.recovery.intentSha256,d.intentSha256);assert.equal(receipt.recovery.driverSha256,d.driverSha256);
 assert.equal(receipt.workerRelease,identity.release);assert.equal(receipt.workerManifestSha256,identity.worker);assert.equal(receipt.djangoManifestSha256,identity.django);assert.equal(receipt.source,facts.source);assert.deepEqual(receipt.sourceTree,await d.sourceTree());
 assert.deepEqual(receipt.components,['worker','django']);assert.equal(receipt.sourceGitTree,identity.tree);assert.equal(receipt.djangoPreparedId,identity.preparedId);assert.equal(receipt.migration,null);
 await store.create('CATALOG-ONLY-STARTED.json',{at:d.now(),intentSha256:d.intentSha256});
 return d.withRotationLock(async()=>{await d.assertActiveBatch();await store.create('CATALOG-ONLY-OWNER.json',await d.owner());await finishCatalog(receipt,facts,d,store);return {status:'catalog-completed',nativeActionsPerformed:false};});
}
