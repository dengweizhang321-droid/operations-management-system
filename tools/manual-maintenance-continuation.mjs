/** One finite bridge for the installed pre-wait controllers; never a publisher retry. */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

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
export const piMaintenancePredecessor=Object.freeze({
 releaseId:'20261018T081823Z-282cee340c57bf41',workerManifestSha256:'120911425367ef3a451c40f7a9842f3c1e39fc99b38cfd602b011ae3ed0733fc',
 djangoManifestSha256:'a9e3fdb943dfcc558a69982f9d410aff103872712e26e0d50b0cefe3841693e7',
 workerScriptSha256:'112b091b610b09187110ba478cfff2280b30705dd21e185a8132e683414ec2bc',
 djangoScriptSha256:'d37902ebfbad7a7d6a78bce92e30056fcd6d253c70faa4267089ba5a43df74f2',
 djangoAiScriptSha256:'fc767f83a175642da0922db29770400e50a73d0ca00c56ba840a87d97725455b',
 workerTransportSha256:'5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd'
});
export function isPiMaintenancePredecessor(head,djangoManifestSha256){
 const k=piMaintenancePredecessor;return head?.releaseId===k.releaseId&&head?.manifestSha256===k.workerManifestSha256&&djangoManifestSha256===k.djangoManifestSha256;
}
const sourceNames=['manual-maintenance-start.ps1','manual-maintenance-lock.psm1','manual-maintenance-continuation.ps1','manual-maintenance-continuation.mjs','publish-prepared-main.mjs','publish-main-command.mjs'];
/** Read-only static admission; the native engine still rechecks dynamic facts. */
export async function maintenanceReadiness({source,head,djangoManifestSha256,installed='D:/teruisi-runtime/django-sales/app',runtime='D:/teruisi-runtime/teruisi-worker-sales',sha=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex')}={}){
 const sourcePins={};for(const name of sourceNames)sourcePins[name]=await sha(path.join(source,'tools',name));
 assert.equal(await sha(path.join(installed,'deployment.json')),djangoManifestSha256,'维护前Django前驱变化');
 const known=isPiMaintenancePredecessor(head,djangoManifestSha256)?piMaintenancePredecessor:isFirstMaintenancePredecessor(head,djangoManifestSha256)?firstMaintenancePredecessor:null;
 if(known){
  for(const [name,expected] of [['worker-local-service.ps1',known.workerScriptSha256],['process-deadline.ps1',known.workerTransportSha256]])assert.equal(await sha(path.join(runtime,'releases',head.releaseId,'tools',name)),expected,'维护恢复前驱工具不适用：'+name);
  assert.equal(await sha(path.join(runtime,'releases',head.releaseId,'deployment-manifest.json')),known.workerManifestSha256);
  assert.equal(await sha(path.join(installed,'tools/django-local-service.ps1')),known.djangoScriptSha256);
  if(known===piMaintenancePredecessor){
   assert.equal(await sha(path.join(installed,'tools/django-ai.ps1')),known.djangoAiScriptSha256);
   const file=path.join(path.dirname(installed),'run/django-ai-pi-worker.pid.json');
   const piWorkerReceiptSha256=await sha(file),raw=await fs.readFile(file);
   assert.equal(createHash('sha256').update(raw).digest('hex'),piWorkerReceiptSha256,'Pi ownership changed during readiness read');
   const piWorkerIdentity=JSON.parse(raw);
   assert.equal(piWorkerIdentity.version,2);assert.equal(piWorkerIdentity.service,'django-ai-pi-worker');
   assert.ok(Number.isSafeInteger(piWorkerIdentity.processId)&&piWorkerIdentity.processId>0);
   for(const name of ['creationDate','executablePath','commandLine'])assert.ok(typeof piWorkerIdentity[name]==='string'&&piWorkerIdentity[name]);
   const piConfigurationSha256=await sha(path.join(path.dirname(installed),'config/pi-agent.json'));
   return {route:'pi19db',sourcePins,piWorkerReceiptSha256,piWorkerIdentity,piConfigurationSha256};
  }
  return {route:'legacy',sourcePins};
 }
 // Once this exact observer has been adopted, ordinary successors use native
 // Stop. Unknown controller generations cannot silently enter maintenance.
 const candidate=await fs.readFile(path.join(source,'tools/django-ai.ps1'),'utf8');
 const helper=candidate.replaceAll('\r\n','\n').split('function Wait-PiWorkerExit')[1]?.split('\nfunction Stop-PiRuntime')[0];
 assert.equal(createHash('sha256').update(('function Wait-PiWorkerExit'+(helper??'')).trimEnd()).digest('hex'),'4372d8872c46760d40f7aa346b6476932be8edba7415baba0ae21e9b73293fd3','没有适用于实际前驱的维护恢复材料');
 assert.equal(await sha(path.join(installed,'tools/django-ai.ps1')),await sha(path.join(source,'tools/django-ai.ps1')),'实际前驱缺少已验证的Pi退出观察器；先准备对应恢复材料');
 return {route:'native-exit-observer',sourcePins};
}
export function assertPiMaintenanceContinuation(snapshot,admission,{requireFresh=true}={}){
 assert.equal(snapshot.version,'manual-maintenance-pi-continuation-v1');
 for(const [key,value] of Object.entries(piMaintenancePredecessor))assert.equal(snapshot[key],value);
 for(const field of ['requestSha256','startedSha256','admissionSha256','originalFailureSha256']){assert.match(snapshot[field]??'',hash);assert.equal(snapshot[field],admission[field]);}
 assert.equal(snapshot.maintenanceId,admission.maintenanceId);
 for(const field of ['sourceBound','rotationOwnerBound','originalActorBound','originalActorExited','piStopBound','piWorkerAbsent','workerReceiptAbsent','postgresPreservedReady','nativeStopIdentityGatePreserved'])assert.equal(snapshot[field],true,field);
 assert.deepEqual(snapshot.controlParticipants,[]);assert.deepEqual(snapshot.downstreamEffects,[]);
 assert.match(snapshot.piStopBinding?.controlSha256??'',hash);assert.match(snapshot.piStopBinding?.ackSha256??'',hash);
 assert.ok(Number.isFinite(Date.parse(snapshot.at)),'独立观察时间无效');
 if(requireFresh)assert.ok(Date.now()-Date.parse(snapshot.at)>=0&&Date.now()-Date.parse(snapshot.at)<120000,'独立观察已过期');
 for(const [record,version] of [[snapshot.maintenance,'teruisi-system-maintenance-v1'],[snapshot.drain,'teruisi-automation-drain-v1']]){
  assert.ok(record&&typeof record==='object'&&!Array.isArray(record));assert.equal(record.version,version);assert.equal(record.id,admission.maintenanceId);assert.equal(record.keepPostgres,true);assert.equal(path.win32.normalize(record.runtimeRoot).toUpperCase(),root.toUpperCase());
 }
 assert.equal(snapshot.drain.phase,'requests');
 assert.ok(snapshot.maintenance.drainedStopped===undefined||typeof snapshot.maintenance.drainedStopped==='boolean');
 if(snapshot.maintenance.drainedStopped===true){assert.equal(snapshot.fullNativeStopScopeVerified,true);assert.equal(snapshot.durableCompleteCommit,true);return 'coordinate-completed';}
 assert.equal(snapshot.fullNativeStopScopeVerified,false);return 'enter-same-id-once';
}
export async function continuePiMaintenance({admission,admissionPath,admissionSha256,originalFailureSha256,step,recheck}){
 await recheck();const expected={...admission,admissionSha256,originalFailureSha256};
 const script=path.join(admission.source,'tools/manual-maintenance-continuation.ps1');
 const extra=['-InputPath',admissionPath,'-InputSha256',admissionSha256,'-OriginalFailureSha256',originalFailureSha256,'-Route','pi19db'];
 const observed=await step('独立核实Pi维护',script,'Check',extra);
 assertPiMaintenanceContinuation(observed.snapshot,expected);assert.match(observed.observationSha256??'',hash);
 assert.equal(path.dirname(path.resolve(observed.observationPath)),path.resolve(admission.attempt));
 assert.match(path.basename(observed.observationPath),/^maintenance-pi-observation-[a-f0-9]{32}\.json$/);
 await recheck();
 const result=await step('续接Pi维护',script,'EnterMaintenance',[...extra,'-ObservationPath',observed.observationPath,'-ObservationSha256',observed.observationSha256]);
 assert.equal(result.observationSha256,observed.observationSha256,'续接未绑定原独立观察');
 // before records admission at the native call boundary, not a new observation
 // after a potentially long native Stop. The PS adapter checked freshness there.
 assert.equal(result.continuationDecision,assertPiMaintenanceContinuation(result.before,expected,{requireFresh:false}));
 assert.equal(result.status,'maintenance');assert.equal(result.maintenanceId,admission.maintenanceId);assert.equal(result.postgresPreserved,true);
 return result;
}
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
