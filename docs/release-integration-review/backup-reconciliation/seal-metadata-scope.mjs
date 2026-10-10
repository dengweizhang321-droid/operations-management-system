// Read-only production evidence inspection; writes only a new external proposal.
// Never imports or calls the metadata reconciliation API.
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
const directory=path.dirname(fileURLToPath(import.meta.url));
const destination=path.resolve(process.argv[2]);
assert.equal(path.dirname(destination),path.resolve('E:/codex-artifacts/release-integration-review-20261010'));
assert.match(path.basename(destination),/^AB-backup-metadata-20261010-[a-z0-9-]+$/);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const authority='E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2/approved-batch.json';
const authorityRaw=await readFile(authority);assert.equal(digest(authorityRaw),'896d20483fea390636293c7952b4792b5ca2e1f64f76f60ec6e5c3a15381b347');
const spec=JSON.parse(authorityRaw),adopted='D:/teruisi-runtime/teruisi-worker-sales/releases/20261010T014638Z-97833d2f2b7e7bc9';
const original=[...spec.collector.files,...spec.batch.operations.slice(15).flatMap(op=>op.command?.files??[])];
for(const name of ['tools/release-impact.mjs','node_modules/typescript/package.json','node_modules/typescript/lib/typescript.js']){
  const filename=path.resolve(adopted,name),pin=original.find(f=>path.resolve(f.path)===filename);assert.ok(pin);assert.equal(digest(await readFile(filename)),pin.sha256);
}
const impact=await import(pathToFileURL(path.join(adopted,'tools/release-impact.mjs')));
const pins=new Map();function add(file){const key=path.resolve(file.path),prior=pins.get(key);if(prior)assert.equal(prior.sha256,file.sha256);pins.set(key,{path:key,sha256:file.sha256});}
for(const pin of original)add(pin);
for(const pin of pins.values())assert.equal(await impact.safeFileDigest(pin.path),pin.sha256);
const engine=await import(pathToFileURL(path.join(adopted,'tools/release-batch.mjs')));
engine.verifyBatch(spec.batch,spec.batch.batchSha256);
const state=await engine.journalState(spec.journalRoot,spec.batch);
assert.equal(state.previous,'420fd5e13e5b637c1a6d62f6fad1e16dccd19c8f1f2c26c8302db892c34fcd09');
assert.equal(state.unknown.length,1);assert.equal(state.unknown[0].operationId,'backup-post');
const active=JSON.parse(await readFile(path.join(spec.journalRoot,'active.json')));
assert.equal(impact.canonical(active),impact.canonical({batchSha256:spec.batch.batchSha256,id:spec.batch.id}));
await mkdir(destination); // New scope only; EEXIST refuses replacing a proposal.
for(const name of await readdir(directory)){
  const src=path.join(directory,name);assert.ok((await lstat(src)).isFile());
  const raw=await readFile(src),dest=path.join(destination,name);await writeFile(dest,raw,{flag:'wx'});add({path:dest,sha256:digest(raw)});
}
const oldD='D:/.codex/worktrees/release-integration-review/运营管理系统/docs/release-integration-review/production';
const proofRaw=await readFile(path.join(oldD,'BACKUP_COMPLETED_PROOF.json')),proof=JSON.parse(proofRaw);
assert.equal(digest(proofRaw),'a3b5ea5c35676fd8db6eaab49027539b2a79269b45e9756f744be86b368f200b');
const proofPath=path.join(destination,'BACKUP_COMPLETED_PROOF.json');await writeFile(proofPath,proofRaw,{flag:'wx'});add({path:proofPath,sha256:digest(proofRaw)});
for(const name of ['INDEPENDENT_POST_BACKUP_EFFECTS.json','INDEPENDENT_POST_BACKUP_DUMP_VERIFICATION.json','POST_BACKUP_METADATA_DIFFERENCES.json','backup-post-blocked-final.json','INDEPENDENT_CONTINUATION_LATE_ANOMALIES.json']){
  const raw=await readFile(path.join(oldD,name)),dest=path.join(destination,name);await writeFile(dest,raw,{flag:'wx'});add({path:dest,sha256:digest(raw)});
}
const nativeAuditPath=proof.nativeAuditPath,nativeRaw=await readFile(nativeAuditPath);assert.equal(digest(nativeRaw),proof.nativeAuditSha256);
const native=JSON.parse(nativeRaw),backupDirectory=native.result.backupDirectory;
const manifestRaw=await readFile(path.join(backupDirectory,'backup-manifest.json'));
assert.equal(digest(manifestRaw),proof.manifestSha256);
const sidecarRaw=await readFile(path.join(backupDirectory,'backup-manifest.json.sha256'));assert.equal(sidecarRaw.toString().trim(),proof.manifestSha256);
for(const [filename,sha256] of [[proof.observationsPath,proof.observationsSha256],[nativeAuditPath,proof.nativeAuditSha256],
  [path.join(backupDirectory,'backup-manifest.json'),proof.manifestSha256],[path.join(backupDirectory,'backup-manifest.json.sha256'),digest(sidecarRaw)]])add({path:filename,sha256});
const codePath=path.join(destination,'reconcile-completed-backup.mjs'),callerPath=path.join(destination,'execute-reconciliation.mjs');
const core={version:'teruisi-completed-backup-reconciliation-v1',sealedAt:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  outputRoot:destination,batchSha256:spec.batch.batchSha256,originalSourceCommit:'5faac8151f59d66de72c3caead8cad916ea547da',unknownEventSha256:state.previous,expectedJournalHeadSha256:state.previous,
  operationSha256:impact.hash(spec.batch.operations.find(o=>o.id==='backup-post')),codePath,codeSha256:digest(await readFile(codePath)),callerPath,callerSha256:digest(await readFile(callerPath)),
  proofPath,proofSha256:digest(proofRaw),observationsPath:proof.observationsPath,observationsSha256:proof.observationsSha256,
  nativeAuditPath,nativeAuditSha256:proof.nativeAuditSha256,backupDirectory,manifestSha256:proof.manifestSha256,manifestSidecarSha256:digest(sidecarRaw),
  contractPath:path.resolve(path.dirname(authority),'candidate-handoff.json'),contractFileSha256:'a2ec59b6119a6f6382953c9f2c620345a3fdaaf1a3367773e7c6200ddd3f6e13',
  validatorPath:path.resolve(path.dirname(authority),'validators.mjs'),validatorSha256:'7ada759aa35fabc1cf12ba22e51d4b517b2c7dae5c83315feb485188c33b3f2e',
  newAction:'one guarded append-only completed-backup metadata reconciliation',metadataOnly:true,originalBatchUnchanged:true,nativeBackupReplayed:false,
  originalShellSucceeded:false,releaseRetentionStatus:'blocked',strictComparisonMismatchNotWaived:true,fullBatchCompleted:false,
  preRecoveryPayloadCurrentlyAvailable:false,tailExecutedByThisCaller:false,productionDataRestoreAuthorized:false,CAdoptionAuthorized:false,
  files:[...pins.values()].sort((a,b)=>a.path.localeCompare(b.path))};
const scope={...core,scopeSha256:impact.hash(core)};
for(const pin of scope.files)assert.equal(await impact.safeFileDigest(pin.path),pin.sha256);
assert.equal((await engine.journalState(spec.journalRoot,spec.batch)).previous,state.previous);
await writeFile(path.join(destination,'metadata-scope.json'),JSON.stringify(scope,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({outputRoot:destination,scopeSha256:scope.scopeSha256,files:scope.files.length,sourceCommit:scope.sourceCommit,sealedAt:scope.sealedAt,productionExecuted:false}));
