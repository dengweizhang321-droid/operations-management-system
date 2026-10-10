// Approved metadata extension caller. Does not execute the original tail.
import assert from 'node:assert/strict';
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const [scopePathArg,approvedScope,approvalPathArg]=process.argv.slice(2);
assert.match(approvedScope??'',/^[a-f0-9]{64}$/);
const scopePath=path.resolve(scopePathArg),approvalPath=path.resolve(approvalPathArg);
const authorityPath='E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2/approved-batch.json';
const adoptedRoot='D:/teruisi-runtime/teruisi-worker-sales/releases/20261010T014638Z-97833d2f2b7e7bc9';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function singleFile(filename){
  filename=path.resolve(filename);let cursor=path.parse(filename).root;
  for(const part of filename.slice(cursor.length).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,part);const s=await lstat(cursor);
    assert.ok(!s.isSymbolicLink());if(cursor!==filename)assert.ok(s.isDirectory());
  }
  const s=await lstat(filename,{bigint:true});assert.ok(s.isFile()&&s.nlink===1n);return filename;
}
const authorityRaw=await readFile(await singleFile(authorityPath));
assert.equal(digest(authorityRaw),'896d20483fea390636293c7952b4792b5ca2e1f64f76f60ec6e5c3a15381b347');
const spec=JSON.parse(authorityRaw),scope=JSON.parse(await readFile(await singleFile(scopePath)));
const humanApproval=JSON.parse(await readFile(await singleFile(approvalPath)));
assert.equal(scope.scopeSha256,approvedScope);
assert.equal(path.dirname(scopePath),path.resolve(scope.outputRoot));
assert.equal(approvalPath,path.join(path.resolve(scope.outputRoot),'human-metadata-approval.json'));
const self=fileURLToPath(import.meta.url);
assert.equal(path.resolve(scope.callerPath),self);
assert.equal(digest(await readFile(await singleFile(self))),scope.callerSha256);
assert.ok(scope.files.some(f=>path.resolve(f.path)===self&&f.sha256===scope.callerSha256));
const currentPins=[...spec.collector.files,...spec.batch.operations.slice(15).flatMap(op=>op.command?.files??[])];
const impactPath=path.join(adoptedRoot,'tools/release-impact.mjs');
const compilerPackagePath=path.join(adoptedRoot,'node_modules/typescript/package.json');
const compilerEntryPath=path.join(adoptedRoot,'node_modules/typescript/lib/typescript.js');
for(const filename of [impactPath,compilerPackagePath,compilerEntryPath]){
  const pin=currentPins.find(f=>path.resolve(f.path)===path.resolve(filename));assert.ok(pin);
  assert.equal(digest(await readFile(await singleFile(filename))),pin.sha256);
}
const compiler=JSON.parse(await readFile(compilerPackagePath));assert.equal(compiler.name,'typescript');
assert.equal(path.resolve(path.dirname(compilerPackagePath),compiler.main),path.resolve(compilerEntryPath));assert.equal(compiler.exports,undefined);
const impact=await import(pathToFileURL(impactPath));
const {scopeSha256,...core}=scope;assert.equal(impact.hash(core),scopeSha256);
assert.equal(scope.version,'teruisi-completed-backup-reconciliation-v1');
assert.ok(humanApproval.explicitHumanApproval===true&&humanApproval.scopeSha256===approvedScope);
assert.ok(Number.isFinite(Date.parse(humanApproval.approvedAt))&&Date.parse(humanApproval.approvedAt)>=Date.parse(scope.sealedAt)&&Date.parse(humanApproval.approvedAt)<=Date.now());
assert.match(humanApproval.userItemId??'',/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
assert.ok(!['01a12449-131b-7dd0-ae6f-b98a5f32b283','01a124f9-78a0-75b3-bd46-c484e6734b12'].includes(humanApproval.userItemId));
const scopePins=new Map(scope.files.map(file=>[path.resolve(file.path),file.sha256]));
assert.equal(scopePins.size,scope.files.length);
for(const pin of currentPins)assert.equal(scopePins.get(path.resolve(pin.path)),pin.sha256);
assert.equal(path.resolve(scope.codePath),path.join(path.resolve(scope.outputRoot),'reconcile-completed-backup.mjs'));
assert.equal(path.resolve(scope.validatorPath),path.resolve('E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2/validators.mjs'));
assert.equal(scope.validatorSha256,'7ada759aa35fabc1cf12ba22e51d4b517b2c7dae5c83315feb485188c33b3f2e');
assert.equal(scopePins.get(path.resolve(scope.codePath)),scope.codeSha256);
assert.equal(scopePins.get(path.resolve(scope.validatorPath)),scope.validatorSha256);
assert.match(scope.codeSha256??'',/^[a-f0-9]{64}$/);
// Original System32-host exception is limited to its exact already approved pin.
for(const file of scope.files)assert.equal(await impact.safeFileDigest(file.path),file.sha256);
const engine=await import(pathToFileURL(path.join(adoptedRoot,'tools/release-batch.mjs')));
const rotation=await import(pathToFileURL(path.join(adoptedRoot,'tools/worker-local-release-rotation.mjs')));
const validator=await import(pathToFileURL(scope.validatorPath));
const api=await import(pathToFileURL(scope.codePath));
const event=await api.reconcileCompletedBackup({spec,scope,approvedScope,humanApproval,
  runtime:{...impact,...engine,...rotation,validateFullManifest:validator.assertFullManifest}});
console.log(impact.canonical(event));
