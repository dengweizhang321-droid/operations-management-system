// Actual immutable metadata, injected isolated journal/IO only. No PG action.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {pathToFileURL,fileURLToPath} from 'node:url';import path from 'node:path';
import {version,batchSha,unknownSha,validatedBackupOutputs,reconcileCompletedBackup} from './reconcile-completed-backup.mjs';
const root='E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2';
const impact=await import(pathToFileURL('D:/teruisi-runtime/teruisi-worker-sales/releases/20261010T014638Z-97833d2f2b7e7bc9/tools/release-impact.mjs'));
const {assertFullManifest}=await import(pathToFileURL(root+'/validators.mjs'));
const spec=JSON.parse(await readFile(root+'/approved-batch.json')),h=JSON.parse(await readFile(root+'/candidate-handoff.json'));
const unknown=JSON.parse(await readFile(spec.journalRoot+'/'+spec.batch.id+'/000074.json'));
const nativePath='D:\\teruisi-runtime\\django-sales\\audits\\postgres-operations\\420adb985efc496a8c6d861a7c717046.json';
const nativeRaw=await readFile(nativePath),native=JSON.parse(nativeRaw),directory=native.result.backupDirectory;
const manifestRaw=await readFile(path.join(directory,'backup-manifest.json')),sidecar=await readFile(path.join(directory,'backup-manifest.json.sha256'));
const codePath=fileURLToPath(new URL('./reconcile-completed-backup.mjs',import.meta.url)),codeRaw=await readFile(codePath);
const sha='a'.repeat(64),proof={version:'teruisi-independent-post-backup-completed-effects-proof-v1',independent:true,completed:true,noReplay:true,originalShellSucceeded:false,originalProcessExitCode:1,originalOperationPassed:false,batchSha256:batchSha,operationId:'backup-post',unknownEventSha256:unknownSha,
  verifiedOutputCandidate:Object.fromEntries(['backupDirectory','backupId','manifestSha256','dumpSha256','contentSha256'].map(k=>[k,native.result[k]])),
  observationsSha256:sha,observationsPath:'E:\\fixture\\observations.json',nativeAuditSha256:impact.hash(nativeRaw),manifestSha256:impact.hash(manifestRaw)};
const input=()=>({batch:spec.batch,unknown:structuredClone(unknown),proof:structuredClone(proof),nativeRaw,manifestRaw,manifestSidecar:sidecar,dumpSha256:native.result.dumpSha256,validateFullManifest:assertFullManifest,contract:h.profileContract,hash:impact.hash,canonical:impact.canonical});
test('real completed backup produces five original outputs; shell/cleanup failures stay failures',()=>{
  const result=validatedBackupOutputs(input());assert.deepEqual(Object.keys(result.outputs).sort(),['backupDirectory','backupId','contentSha256','dumpSha256','manifestSha256'].sort());
  assert.equal(result.originalShellSucceeded,false);assert.equal(result.releaseRetentionStatus,'blocked');assert.equal(result.outputs.backupDirectory,directory);
});
for(const [name,mutate] of [
  ['wrong target unknown',x=>x.unknown.eventSha256=sha],['wrong operation',x=>x.unknown.operationId='restore-post'],
  ['claim normal outer success',x=>x.proof.originalShellSucceeded=true],['non-independent proof',x=>x.proof.independent=false],
  ['wrong audit digest',x=>x.proof.nativeAuditSha256=sha],['changed dump',x=>x.dumpSha256=sha],
  ['bad manifest sidecar',x=>x.manifestSidecar=Buffer.from(sha)],['wrong exact process stdout',x=>x.unknown.processEvidence.stdoutSha256=sha],
])test(name,()=>{const x=input();mutate(x);assert.throws(()=>validatedBackupOutputs(x));});
for(const [name,mutate] of [
  ['native unresolved',v=>v.status='running'],['missing result',v=>v.result=null],
  ['unclosed retention',v=>{v.result.retention.status='blocked';v.databaseBackup=v.result;}],
  ['directory swap',v=>{v.result.backupDirectory='D:\\not-approved';v.databaseBackup=v.result;}],
  ['launder cleanup blocker',v=>{v.result.releaseRetention.status='completed';v.databaseBackup=v.result;}],
])test(name,()=>{const x=input(),v=structuredClone(native);mutate(v);x.nativeRaw=Buffer.from(JSON.stringify(v));x.proof.nativeAuditSha256=impact.hash(x.nativeRaw);assert.throws(()=>validatedBackupOutputs(x));});

function harness(){
  proof.observationsSha256=impact.hash(Buffer.from('fixture observation'));
  const scopeCore={version,sealedAt:new Date(Date.now()-5).toISOString(),batchSha256:batchSha,unknownEventSha256:unknownSha,expectedJournalHeadSha256:unknownSha,operationSha256:impact.hash(spec.batch.operations.find(o=>o.id==='backup-post')),
    codePath,codeSha256:impact.hash(codeRaw),proofPath:'E:\\fixture\\proof.json',proofSha256:impact.hash(Buffer.from(JSON.stringify(proof))),observationsPath:proof.observationsPath,observationsSha256:proof.observationsSha256,
    contractPath:path.resolve(root,'candidate-handoff.json'),contractFileSha256:'a2ec59b6119a6f6382953c9f2c620345a3fdaaf1a3367773e7c6200ddd3f6e13',validatorPath:path.resolve(root,'validators.mjs'),validatorSha256:'7ada759aa35fabc1cf12ba22e51d4b517b2c7dae5c83315feb485188c33b3f2e',
    nativeAuditPath:nativePath,nativeAuditSha256:impact.hash(nativeRaw),backupDirectory:directory,manifestSha256:impact.hash(manifestRaw),manifestSidecarSha256:impact.hash(sidecar),files:[]};
  scopeCore.files=[[scopeCore.codePath,scopeCore.codeSha256],[scopeCore.proofPath,scopeCore.proofSha256],[scopeCore.observationsPath,scopeCore.observationsSha256],
    [scopeCore.contractPath,scopeCore.contractFileSha256],[scopeCore.validatorPath,scopeCore.validatorSha256],[nativePath,scopeCore.nativeAuditSha256],
    [path.join(directory,'backup-manifest.json'),scopeCore.manifestSha256],[path.join(directory,'backup-manifest.json.sha256'),scopeCore.manifestSidecarSha256]].map(([path,sha256])=>({path,sha256}));
  scopeCore.files=[...new Map([...spec.collector.files,...spec.batch.operations.slice(15).flatMap(op=>op.command?.files??[]),...scopeCore.files].map(file=>[path.resolve(file.path),file])).values()];
  const scope={...scopeCore,scopeSha256:impact.hash(scopeCore)},humanApproval={explicitHumanApproval:true,scopeSha256:scope.scopeSha256,approvedAt:new Date().toISOString(),userItemId:'01a125ee-1234-7555-bb55-123456789abc'};
  const state={dir:'E:\\fixture\\journal',events:[unknown],previous:unknown.eventSha256,unknown:[unknown],latest:new Map(spec.batch.operations.slice(0,15).map(o=>[o.id,{status:'passed'}]))};state.latest.set('backup-post',unknown);
  const written=[],runtime={...impact,validateFullManifest:assertFullManifest,verifyBatch:()=>{},withRotationLock:callback=>callback(),journalState:async()=>state,
    safeFileDigest:async p=>p.endsWith('teruisi-sales.dump')?native.result.dumpSha256:scope.files.find(f=>f.path===p)?.sha256,
    safeRead:async p=>{if(p.endsWith('active.json'))return Buffer.from(JSON.stringify({batchSha256:batchSha,id:spec.batch.id}));if(p===scope.proofPath)return Buffer.from(JSON.stringify(proof));if(p===proof.observationsPath)return Buffer.from('fixture observation');if(p===nativePath)return nativeRaw;if(p===scope.contractPath)return Buffer.from(JSON.stringify(h));if(p.endsWith('backup-manifest.json.sha256'))return sidecar;if(p.endsWith('backup-manifest.json'))return manifestRaw;throw Error('Unexpected read');},
    writeOnce:async(p,v)=>written.push({p,v})};
  return {scope,humanApproval,state,written,runtime};
}
test('guarded append stores real outputs once; historical unknown unchanged and no operator called',async()=>{
  const f=harness(),before=impact.canonical(unknown);const event=await reconcileCompletedBackup({spec,...f,approvedScope:f.scope.scopeSha256});
  assert.equal(f.written.length,1);assert.equal(event.previous,unknownSha);assert.equal(event.reconciliation.originalShellSucceeded,false);assert.equal(event.outputs.backupDirectory,directory);
  assert.equal(event.reconciliation.backupReplayed,false);assert.equal(impact.canonical(unknown),before);assert.equal(event.reason,'independently-reconciled-completed-backup-with-outputs');
});
for(const [name,mutate] of [
  ['missing new approval',f=>f.humanApproval.explicitHumanApproval=false],['old UI approval reused',f=>f.humanApproval.userItemId='01a124f9-78a0-75b3-bd46-c484e6734b12'],
  ['another unknown present',f=>f.state.unknown.push({eventSha256:sha})],['prior work not passed',f=>f.state.latest.get('two-natural-watchdogs').status='failed'],
  ['tail already begun',f=>f.state.latest.set('restore-post',{status:'started'})],['source pin changed',f=>f.runtime.safeFileDigest=async()=> 'b'.repeat(64)],
])test(name,async()=>{const f=harness();mutate(f);await assert.rejects(reconcileCompletedBackup({spec,...f,approvedScope:f.scope.scopeSha256}));assert.equal(f.written.length,0);});
