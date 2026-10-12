// One exact readonly guard decision; no guest start, deploy or automatic resume.
import assert from 'node:assert/strict';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
const own=path.dirname(fileURLToPath(import.meta.url)),evidence='E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/';
const specPath='E:/codex-artifacts/release-site-blockers-20261011/ADOPTION_BATCH_LIVE_V1.json',journal='D:/teruisi-runtime/teruisi-worker-sales/state/release-batches';
export const guardBinding=Object.freeze({batch:'f15d06a159073927ba3565712027aa645869333a3210c54e1858738756ca110f',head:'a40e765dddd23ea17f5f5edd6eab068bf56c12d58a70d03115c96b1070f84fbc',id:'first-adoption-live-guard-20261011',operation:'previous-reference-guard'});
export const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
export const hash=v=>createHash('sha256').update(Buffer.isBuffer(v)||typeof v==='string'?v:canonical(v)).digest('hex');
export function assertGuardDecisionState(state,active,result){
 assert.equal(state.events.length,28);assert.equal(state.previous,guardBinding.head);assert.deepEqual(active,{batchSha256:guardBinding.batch,id:guardBinding.id});
 assert.equal(state.unknown.length,1);assert.equal(state.latest.get(guardBinding.operation),state.unknown[0]);assert.equal(state.unknown[0].status,'unknown');assert.equal(state.unknown[0].eventSha256,guardBinding.head);
 assert.equal(state.latest.get('op-apply').status,'passed');assert.equal(state.latest.get('op-apply').eventSha256,'c2f75a6e8ffbfe0635a02136c9d054917a70069fca9eee9479f135fbdbd22fd9');
 if(result){assert.equal(result.status,'passed');assert.equal(result.branch,'fresh-no-running-wsl');assert.equal(result.journalHead,guardBinding.head);assert.equal(result.preservationVerified,true);assert.equal(result.currentReferences,0);assert.equal(result.productionWrites,0);assert.equal(result.chain.successorCount,220);assert.equal(result.chain.head.bindingSha256,'aec72f36e2718e853c3ca8d9f9790ecb8d01a141b43e7851f8f42979605ca66c');assert.equal(result.chain.head.manifestSha256,'6cff8886e533244997b65d2a8668776cee5178b95e4e2a99ed14bd25bf2733f4');assert.equal(result.liveAudit.status,'passed');assert.deepEqual(result.liveAudit.references,[]);assert.deepEqual(result.liveAudit.unknown,[]);assert.equal(result.liveAudit.noWslDecision.mode,'no-running-wsl');}
}
async function checked(file,expected){const a=path.resolve(file);for(let p=a;;){assert.equal((await lstat(p)).isSymbolicLink(),false);assert.equal((await realpath(p)).toLowerCase(),p.toLowerCase());const next=path.dirname(p);if(next===p)break;p=next;}const before=await lstat(a,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n);const raw=await readFile(a),after=await lstat(a,{bigint:true});for(const k of ['dev','ino','size','nlink','mtimeNs','ctimeNs'])assert.equal(before[k],after[k]);if(expected)assert.equal(hash(raw),expected);return raw;}
export async function runNoWslGuardDecision(mode,intentPath,intentSha256){
 assert.ok(['observe','reconcile'].includes(mode));assert.ok(!Object.keys(process.env).some(n=>/^NODE_/i.test(n)));assert.match(intentSha256,/^[a-f0-9]{64}$/);
 const intent=JSON.parse(await checked(intentPath,intentSha256));assert.deepEqual(Object.keys(intent).sort(),['files','version']);assert.equal(intent.version,'fixed-no-wsl-guard-intent-v1');
 const names=['reconcile-no-wsl-guard-once.mjs','previous-no-wsl-receiver.mjs','live-reference-no-wsl-audit.mjs','no-running-wsl-policy.mjs','Collect-NoRunningWsl.ps1','backup-reconcile-bootstrap.mjs'];
 assert.deepEqual(intent.files.map(f=>f.path).sort(),names.map(n=>path.join(own,n)).sort());
 for(const f of intent.files){assert.deepEqual(Object.keys(f).sort(),['path','sha256']);assert.match(f.sha256,/^[a-f0-9]{64}$/);await checked(f.path,f.sha256);}
 const bootstrap=path.join(own,'backup-reconcile-bootstrap.mjs');await checked(bootstrap,'13e6700181cad60e7576cd60a8f523c36c935f734f63cae5f348f025a5c5de25');
 await checked(specPath,'960c5c3e99da1f5cd7bacf57ae3aa0889fcecb9cd522d9165870560668c7678b');
 const {bootstrapReconciliation}=await import(pathToFileURL(bootstrap)),{spec,api,verifyPins}=await bootstrapReconciliation(specPath,guardBinding.batch);
 const op=spec.batch.operations.find(o=>o.id===guardBinding.operation);assert.equal(op.mutating,false);assert.ok(!spec.batch.operations.some(o=>(o.command?.args??[]).some(v=>v.includes('{receipt:'+guardBinding.operation+':'))));
 const {verifyNoRunningWslPrevious}=await import(pathToFileURL(path.join(own,'previous-no-wsl-receiver.mjs')));
 const {assertNoWslFreshBoundary}=await import(pathToFileURL(path.join(own,'no-running-wsl-policy.mjs')));
 const impact=await import(pathToFileURL(path.join(path.dirname(spec.collector.args[0]),'release-impact.mjs')));
 async function completeReceiver(){
  await verifyPins();for(const f of op.command.files)assert.equal(await impact.safeFileDigest(f.path),f.sha256);
  const state=await api.journalState(journal,spec.batch),active=JSON.parse(await checked(path.join(journal,'active.json')));assertGuardDecisionState(state,active);
  const result=await verifyNoRunningWslPrevious();assertGuardDecisionState(await api.journalState(journal,spec.batch),JSON.parse(await checked(path.join(journal,'active.json'))),result);
  assertNoWslFreshBoundary(result.liveAudit.noWslAfter);return result;
 }
 if(mode==='observe'){const result=await completeReceiver();await api.writeOnce(evidence+'no-wsl-guard/READONLY_RESULT.json',result);return {status:'readonly-postcondition-observed-no-decision',observationsSha256:hash(result),journalHead:result.journalHead};}
 const proof={independent:true,noReplay:true,batchSha256:guardBinding.batch,operationId:guardBinding.operation,observationsSha256:intentSha256,intentSha256,decision:'All original previous-package checks plus fresh no-running-WSL evidence; old guard failure preserved'};
 const event=await api.reconcileOperation({root:journal,batch:spec.batch,approved:guardBinding.batch,operationId:guardBinding.operation,resolution:'passed',proof,lock:callback=>api.withRotationLock(async()=>{
  const result=await completeReceiver();
  await api.writeOnce(evidence+'no-wsl-guard/OBSERVATIONS.json',result);proof.observationsSha256=hash(result);await api.writeOnce(evidence+'no-wsl-guard/PROOF.json',proof);
  assertGuardDecisionState(await api.journalState(journal,spec.batch),JSON.parse(await checked(path.join(journal,'active.json'))),result);assertNoWslFreshBoundary(result.liveAudit.noWslAfter);
  const event=await callback(),after=await api.journalState(journal,spec.batch);assert.equal(after.events.length,29);assert.equal(after.previous,event.eventSha256);assert.equal(after.unknown.length,0);assert.equal(event.receiptSha256,hash(proof));assert.equal(event.outputs,undefined);
  assert.deepEqual([...after.latest.keys()],['op-prepare','backup-pre','op-entermaintenance-drain','op-stopworker-switch','op-apply','previous-reference-guard']);for(const x of after.latest.values())assert.equal(x.status,'passed');return event;
 })});
 return {status:'readonly-guard-postcondition-reconciled-only',batchSha256:guardBinding.batch,eventSha256:event.eventSha256,proofSha256:hash(proof),observationsSha256:proof.observationsSha256,originalGuardFailurePreserved:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){assert.equal(process.argv.length,5);runNoWslGuardDecision(...process.argv.slice(2)).then(v=>console.log(canonical(v))).catch(e=>{console.error(e.message);process.exitCode=1;});}
