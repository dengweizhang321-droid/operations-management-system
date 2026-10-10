// Narrow metadata protocol extension. No Backup/Restore/lifecycle execution.
// Original runtime owns the lock, journal verification and create-only fsync.
import assert from 'node:assert/strict';
import path from 'node:path';
import {lstat} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
export const version='teruisi-completed-backup-reconciliation-v1';
export const batchSha='9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15';
export const unknownSha='420fd5e13e5b637c1a6d62f6fad1e16dccd19c8f1f2c26c8302db892c34fcd09';
const keys=['backupDirectory','backupId','manifestSha256','dumpSha256','contentSha256'];
const requireHash=value=>assert.match(value??'',/^[a-f0-9]{64}$/);

export function validatedBackupOutputs({batch,unknown,proof,nativeRaw,manifestRaw,dumpSha256,manifestSidecar,validateFullManifest,contract,hash,canonical}){
  assert.equal(batch.batchSha256,batchSha);
  const op=batch.operations.find(o=>o.id==='backup-post');
  assert.ok(op?.kind==='backup'&&op.phase==='backup-post'&&op.mutating===true);
  assert.ok(unknown.operationId===op.id&&unknown.status==='unknown'&&unknown.eventSha256===unknownSha);
  assert.equal(unknown.processEvidence.exitCode,1);
  assert.ok(proof?.independent===true&&proof.completed===true&&proof.noReplay===true&&proof.originalShellSucceeded===false);
  assert.equal(proof.version,'teruisi-independent-post-backup-completed-effects-proof-v1');
  assert.equal(proof.originalOperationPassed,false);assert.notEqual(proof.noEffect,true);
  assert.equal(proof.originalProcessExitCode,unknown.processEvidence.exitCode);
  assert.equal(proof.batchSha256,batchSha);assert.equal(proof.operationId,op.id);assert.equal(proof.unknownEventSha256,unknownSha);
  requireHash(proof.observationsSha256);assert.equal(hash(nativeRaw),proof.nativeAuditSha256);assert.equal(hash(manifestRaw),proof.manifestSha256);
  const native=JSON.parse(nativeRaw),result=native.result,manifest=JSON.parse(manifestRaw);
  assert.equal(native.version,'teruisi-postgres-operation-v1');assert.equal(native.id,'420adb985efc496a8c6d861a7c717046');
  assert.equal(native.action,'Backup');assert.equal(native.status,'completed');assert.equal(native.failure,null);
  assert.equal(canonical(native.databaseBackup),canonical(result));
  for(const a of op.assertions)assert.equal(canonical(a.path.split('.').reduce((v,k)=>v?.[k],result)),canonical(a.equals));
  assert.equal(result.status,'completed');assert.equal(result.serviceStateChanged,false);
  assert.equal(result.retention.status,'completed');assert.equal(result.retention.maximumRecoveryPoints,3);
  assert.equal(result.retention.retainedVerification,'full-evidence');
  assert.ok(result.retention.retained.includes(result.backupId));assert.equal(new Set(result.retention.retained).size,result.retention.retained.length);
  assert.ok(result.retention.retained.length<=3);assert.equal(result.releaseRetention.status,'blocked');
  // The known cleanup block is retained, not silently changed to success.
  assert.equal(result.releaseRetention.reasonSha256,'d707a053790242fed8902a36d323f690c2526a2ed91d5c0a89a9c95b993b8860');
  assert.equal(path.dirname(path.resolve(result.backupDirectory)),path.resolve('E:/运营管理系统业务数据'));
  assert.equal(path.basename(result.backupDirectory),result.backupId);assert.equal(result.backupId,'daily-20261010T093506Z-8a5a7107b3f6');
  for(const key of ['manifestSha256','dumpSha256','contentSha256'])requireHash(result[key]);
  assert.equal(hash(manifestRaw),result.manifestSha256);assert.equal(manifestSidecar.toString().trim(),result.manifestSha256);
  validateFullManifest(manifest,contract);
  assert.equal(manifest.status,'completed');assert.equal(manifest.backupId,result.backupId);
  assert.equal(manifest.dump.sha256,result.dumpSha256);assert.equal(dumpSha256,result.dumpSha256);
  assert.equal(manifest.evidence.contentSha256,result.contentSha256);
  assert.equal(manifest.software.deploymentManifestSha256,batch.binding.djangoCandidateSha256);
  // Bind the actual nonzero process's emitted JSON using its recorded digest.
  const calculated=Buffer.from(JSON.stringify(result)+'\r\n');
  assert.equal(calculated.length,unknown.processEvidence.stdoutBytes);assert.equal(hash(calculated),unknown.processEvidence.stdoutSha256);
  const outputs=Object.fromEntries(keys.map(key=>[key,result[key]]));assert.equal(canonical(proof.verifiedOutputCandidate),canonical(outputs));
  return {outputs,native,originalUnknownEventSha256:unknown.eventSha256,
    originalShellSucceeded:false,releaseRetentionStatus:'blocked',dumpVerified:true};
}

export async function reconcileCompletedBackup({spec,scope,approvedScope,humanApproval,runtime}){
  const {hash,canonical,verifyBatch,journalState,writeOnce,withRotationLock,safeRead,safeFileDigest,validateFullManifest}=runtime;
  const {scopeSha256,...core}=scope;requireHash(approvedScope);assert.equal(hash(core),scopeSha256);assert.equal(scopeSha256,approvedScope);
  assert.equal(scope.version,version);assert.equal(scope.batchSha256,batchSha);assert.equal(scope.unknownEventSha256,unknownSha);
  assert.equal(scope.expectedJournalHeadSha256,unknownSha);
  assert.ok(Number.isFinite(Date.parse(scope.sealedAt))&&Date.parse(scope.sealedAt)>Date.parse('2026-10-10T09:44:11.721Z'));
  assert.equal(path.resolve(scope.codePath),fileURLToPath(import.meta.url));requireHash(scope.codeSha256);
  assert.equal(new Set(scope.files.map(file=>path.resolve(file.path))).size,scope.files.length);
  for(const file of scope.files){assert.ok(path.isAbsolute(file.path));requireHash(file.sha256);}
  assert.ok(humanApproval?.explicitHumanApproval===true&&humanApproval.scopeSha256===approvedScope);
  assert.ok(Number.isFinite(Date.parse(humanApproval.approvedAt))&&Date.parse(humanApproval.approvedAt)>=Date.parse(scope.sealedAt)&&Date.parse(humanApproval.approvedAt)<=Date.now());
  assert.match(humanApproval.userItemId??'',/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.ok(!['01a12449-131b-7dd0-ae6f-b98a5f32b283','01a124f9-78a0-75b3-bd46-c484e6734b12'].includes(humanApproval.userItemId));
  verifyBatch(spec.batch,batchSha);assert.equal(spec.journalRoot,'D:\\teruisi-runtime\\teruisi-worker-sales\\state\\release-batches');
  assert.equal(hash(spec.batch.operations.find(o=>o.id==='backup-post')),scope.operationSha256);
  assert.equal(path.resolve(scope.contractPath),path.resolve('E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2/candidate-handoff.json'));
  assert.equal(path.resolve(scope.validatorPath),path.resolve('E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2/validators.mjs'));
  // Prior Apply upgraded primary scripts. Pin the collector (including the
  // archived pre-Apply bytes), current Backup and every remaining command.
  // Old pre-Apply command pins cannot simultaneously describe today's files.
  const oldPins=[...spec.collector.files,...spec.batch.operations.slice(15).flatMap(op=>op.command?.files??[])];
  const scopePins=new Map(scope.files.map(file=>[path.resolve(file.path),file.sha256]));
  for(const pin of oldPins)assert.equal(scopePins.get(path.resolve(pin.path)),pin.sha256,'Original execution closure pin missing');
  for(const [filename,digest]of [[scope.contractPath,scope.contractFileSha256],[scope.validatorPath,scope.validatorSha256]]){
    const pin=oldPins.find(f=>path.resolve(f.path)===path.resolve(filename));assert.ok(pin);assert.equal(pin.sha256,digest);
  }
  assert.ok(scope.files.some(f=>f.path===scope.proofPath&&f.sha256===scope.proofSha256));
  assert.ok(scope.files.some(f=>f.path===scope.contractPath&&f.sha256===scope.contractFileSha256));
  assert.ok(scope.files.some(f=>f.path===scope.validatorPath&&f.sha256===scope.validatorSha256));
  for(const [filename,digest]of [[scope.codePath,scope.codeSha256],[scope.observationsPath,scope.observationsSha256],
    [scope.nativeAuditPath,scope.nativeAuditSha256],[path.join(scope.backupDirectory,'backup-manifest.json'),scope.manifestSha256],
    [path.join(scope.backupDirectory,'backup-manifest.json.sha256'),scope.manifestSidecarSha256]]){
    assert.ok(scope.files.some(f=>path.resolve(f.path)===path.resolve(filename)&&f.sha256===digest),'Mandatory source/evidence pin missing');
  }
  return withRotationLock(async()=>{
    for(const file of scope.files)assert.equal(await safeFileDigest(file.path),file.sha256,'Reconciliation input changed');
    const frozenValidator=await import(pathToFileURL(scope.validatorPath));assert.equal(validateFullManifest,frozenValidator.assertFullManifest,'Only the original frozen typed validator may execute');
    const active=JSON.parse(await safeRead(path.join(spec.journalRoot,'active.json')));
    assert.equal(canonical(active),canonical({batchSha256:batchSha,id:spec.batch.id}));
    const state=await journalState(spec.journalRoot,spec.batch);assert.equal(state.unknown.length,1);
    assert.equal(state.previous,scope.expectedJournalHeadSha256,'Sealed journal head changed');
    const unknown=state.latest.get('backup-post');assert.equal(state.unknown[0].eventSha256,unknownSha);
    for(const op of spec.batch.operations.slice(0,15))assert.equal(state.latest.get(op.id)?.status,'passed','Prior work cannot be replayed');
    for(const op of spec.batch.operations.slice(16))assert.ok(!state.latest.has(op.id),'Tail already started');
    const proofRaw=await safeRead(scope.proofPath);assert.equal(hash(proofRaw),scope.proofSha256);
    const proof=JSON.parse(proofRaw);assert.equal(path.resolve(proof.observationsPath),path.resolve(scope.observationsPath));assert.equal(proof.observationsSha256,scope.observationsSha256);assert.equal(hash(await safeRead(proof.observationsPath)),proof.observationsSha256);
    assert.equal(scope.nativeAuditPath,'D:\\teruisi-runtime\\django-sales\\audits\\postgres-operations\\420adb985efc496a8c6d861a7c717046.json');
    const nativeRaw=await safeRead(scope.nativeAuditPath),manifestRaw=await safeRead(path.join(scope.backupDirectory,'backup-manifest.json'));
    assert.equal(hash(nativeRaw),scope.nativeAuditSha256);assert.equal(hash(manifestRaw),scope.manifestSha256);
    const h=JSON.parse(await safeRead(scope.contractPath));
    const dumpPath=path.join(scope.backupDirectory,'teruisi-sales.dump'),beforeDump=await lstat(dumpPath,{bigint:true});
    const result=validatedBackupOutputs({batch:spec.batch,unknown,proof,nativeRaw,manifestRaw,manifestSidecar:await safeRead(path.join(scope.backupDirectory,'backup-manifest.json.sha256')),
      dumpSha256:await safeFileDigest(dumpPath),validateFullManifest,contract:h.profileContract,hash,canonical});
    assert.equal(result.outputs.backupDirectory,scope.backupDirectory);
    for(const file of scope.files)assert.equal(await safeFileDigest(file.path),file.sha256,'Reconciliation input changed during dump verification');
    assert.equal(hash(await safeRead(scope.nativeAuditPath)),scope.nativeAuditSha256);
    assert.equal(hash(await safeRead(path.join(scope.backupDirectory,'backup-manifest.json'))),scope.manifestSha256);
    assert.equal((await safeRead(path.join(scope.backupDirectory,'backup-manifest.json.sha256'))).toString().trim(),scope.manifestSha256);
    assert.equal(hash(await safeRead(proof.observationsPath)),proof.observationsSha256);
    assert.equal(hash(await safeRead(scope.proofPath)),scope.proofSha256);
    const afterDump=await lstat(dumpPath,{bigint:true});for(const k of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(beforeDump[k],afterDump[k],'Recovery payload changed during validation');
    assert.equal(canonical(JSON.parse(await safeRead(path.join(spec.journalRoot,'active.json')))),canonical(active));
    const finalState=await journalState(spec.journalRoot,spec.batch);assert.equal(finalState.previous,state.previous,'Journal changed while coordinating');
    // Append through the original verified journal + create-only fsync API.
    // No old event is edited, no caller-supplied output object is accepted.
    const eventCore={batchSha256:batchSha,previous:state.previous,at:new Date().toISOString(),operationId:'backup-post',phase:'backup-post',status:'passed',
      reason:'independently-reconciled-completed-backup-with-outputs',receiptSha256:hash({scopeSha256,proof,nativeAuditSha256:hash(nativeRaw)}),outputs:result.outputs,
      reconciliation:{version,scopeSha256,originalUnknownEventSha256:unknownSha,originalShellSucceeded:false,nativeAuditSha256:hash(nativeRaw),releaseRetentionStatus:result.releaseRetentionStatus,backupReplayed:false}};
    const event={...eventCore,eventSha256:hash(eventCore)};
    await writeOnce(path.join(state.dir,String(state.events.length).padStart(6,'0')+'.json'),event);
    return event;
  });
}
