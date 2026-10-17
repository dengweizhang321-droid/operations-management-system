/** One finite bridge for the installed pre-wait controllers; never a publisher retry. */
import assert from 'node:assert/strict';
import path from 'node:path';

export const firstMaintenancePredecessor=Object.freeze({
 releaseId:'20261017T082953Z-c9da1765d84847d4',
 workerManifestSha256:'91a0cdce3cd59457ab3be2ae7366411fb975e1ebd07203119ff380ee568655f1',
 djangoManifestSha256:'622cb632fdf9408bfb6dc641422602a0e741aeea18d09c65f39480d203069d1a',
 workerScriptSha256:'8ef6d09c23f780657d74e8c591dea543713410783ce2d5fdf165f2093db51a1d',
 djangoScriptSha256:'2a4d3629d1f80b824ad247ef4b4ce810632090586b87be3686432f5b6aea98e0',
 workerTransportSha256:'5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd'
});
const root='D:\\teruisi-runtime\\django-sales';
const hash=/^[a-f0-9]{64}$/;
export function isFirstMaintenancePredecessor(head,djangoManifestSha256){
 const k=firstMaintenancePredecessor;
 return head?.releaseId===k.releaseId&&head?.manifestSha256===k.workerManifestSha256&&djangoManifestSha256===k.djangoManifestSha256;
}
export function assertFirstMaintenanceContinuation(snapshot,admission){
 const k=firstMaintenancePredecessor;
 assert.equal(snapshot.version,'manual-maintenance-continuation-v1');
 for(const field of ['requestSha256','startedSha256','admissionSha256','originalFailureSha256']){assert.match(snapshot[field]??'',hash);assert.equal(snapshot[field],admission[field]);}
 for(const [key,value] of Object.entries(k))assert.equal(snapshot[key],value,'限定前驱变化：'+key);
 assert.equal(snapshot.maintenanceId,admission.maintenanceId);assert.match(snapshot.maintenanceId??'',/^[a-f0-9]{32}$/);
 assert.equal(snapshot.sourceBound,true);assert.equal(snapshot.rotationOwnerBound,true);assert.equal(snapshot.originalActorBound,true);
 assert.equal(snapshot.originalActorExited,true);assert.deepEqual(snapshot.controlParticipants,[],'原控制参与者仍在或身份未知');
 assert.equal(snapshot.fullNativeStopScopeVerified,true,'完整原停止范围未验证');
 assert.equal(snapshot.workerStatus?.state,'stopped');assert.equal(snapshot.workerStatus?.releaseId,k.releaseId);assert.equal(snapshot.workerStatus?.manifestSha256,k.workerManifestSha256);
 assert.equal(snapshot.workerReceiptAbsent,true);assert.deepEqual(snapshot.applicationProcesses,[]);assert.equal(snapshot.postgresPreservedReady,true);
 assert.deepEqual(snapshot.downstreamEffects,[],'已有后续发布动作');
 for(const [record,version] of [[snapshot.maintenance,'teruisi-system-maintenance-v1'],[snapshot.drain,'teruisi-automation-drain-v1']]){
  assert.ok(record&&typeof record==='object'&&!Array.isArray(record));assert.equal(record.version,version);assert.equal(record.id,snapshot.maintenanceId);assert.equal(typeof record.runtimeRoot,'string');
  assert.equal(path.win32.normalize(record.runtimeRoot).toUpperCase(),root.toUpperCase());assert.equal(record.keepPostgres,true);
 }
 assert.equal(snapshot.drain.phase,'requests');
 assert.equal(typeof snapshot.pandasConfigured,'boolean');
 if(snapshot.pandasConfigured){assert.equal(snapshot.pandas?.distribution,'TERUISI-Pandas');assert.equal(snapshot.pandas?.user,'teruisi-pandas');assert.equal(snapshot.pandas?.unit,'teruisi-pandas.service');assert.equal(snapshot.pandas?.activeState,'inactive');assert.equal(snapshot.pandas?.subState,'dead');assert.equal(snapshot.pandas?.mainPid,0);assert.equal(snapshot.pandas?.controlPid,0);assert.deepEqual(snapshot.pandas?.containers,[]);}
 const stopped=snapshot.maintenance.drainedStopped;
 assert.ok(stopped===undefined||typeof stopped==='boolean','drainedStopped类型不正确');
 if(stopped===true){assert.equal(snapshot.durableCompleteCommit,true,'原完成提交证据缺失');return 'coordinate-completed';}
 assert.equal(snapshot.durableCompleteCommit,false,'原提交与维护对象矛盾');
 return 'enter-same-id-once';
}

export async function continueFirstMaintenance({admission,admissionPath,admissionSha256,originalFailureSha256,step,recheck}){
 // The caller keeps its original rotation lease and call stack. A new publisher
 // invocation still rejects STARTED without SUCCESS before reaching this code.
 await recheck();
 const expected={...admission,admissionSha256,originalFailureSha256};
 const extra=['-InputPath',admissionPath,'-InputSha256',admissionSha256,'-OriginalFailureSha256',originalFailureSha256];
 const script=path.join(admission.source,'tools/manual-maintenance-continuation.ps1');
 const snapshot=await step('核实首次维护',script,'Check',extra);
 const decision=assertFirstMaintenanceContinuation(snapshot,expected);
 await recheck();
 const result=await step('续接首次维护',script,'EnterMaintenance',extra);
 assert.equal(result.continuationDecision,decision);assertFirstMaintenanceContinuation(result.before,expected);
 assert.equal(result.status,'maintenance');assert.equal(result.maintenanceId,admission.maintenanceId);assert.equal(result.postgresPreserved,true);
 return result;
}
