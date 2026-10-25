// Read-only terminal metadata review; writes only this worktree's review JSON.
// No production modules, process launch, socket, SQL, lock or operator imports.
import assert from 'node:assert/strict';
import {readFile,readdir,lstat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root='E:/codex-artifacts/release-integration-review-20261010/AB-exact-closeout-20261010-1530-final';
const original='E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2';
const journalRoot='D:/teruisi-runtime/teruisi-worker-sales/state/release-batches';
const id='integration-ab-v2-20261010-c22d8dd69a',batch='9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15';
const scopeSha='295d8923fb794079faf5cc9c74f92f12d8bd78a3ccbbce4b9dcbb19e00fcc458';
const oldHead='316f341eafafe08c3366fc79ca2c36b96258d2b00fcd9767a82a32cd62f7ce7d';
const archive='E:/codex-artifacts/release-integration-review-20261010/AB-backup-metadata-20261010-1025-final/production/DELIVERY-cb007f05/journal-at-delivery';
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const sha=b=>createHash('sha256').update(b).digest('hex'),hash=v=>sha(canonical(v));
const sources=[];
async function load(filename){const raw=await readFile(filename);sources.push({path:filename,bytes:raw.length,sha256:sha(raw)});return raw;}
const scopeRaw=await load(path.join(root,'exact-acceptance-scope.json')),scope=JSON.parse(scopeRaw),{scopeSha256,...scopeCore}=scope;
assert.equal(scopeSha256,scopeSha);assert.equal(hash(scopeCore),scopeSha);assert.equal((await load(path.join(root,'exact-acceptance-scope.json.sha256'))).toString().trim(),sha(scopeRaw));
const approval=JSON.parse(await load(path.join(root,'human-exact-acceptance-approval.json')));
assert.equal(approval.scopeSha256,scopeSha);assert.equal(approval.explicitHumanApproval,true);assert.equal(approval.approvedAt,'2026-10-10T15:59:48.000Z');assert.equal(approval.userItemId,'01a1268a-bc4d-7501-98f1-5ec3ceaa2a99');
assert.equal(approval.acceptExactConcurrentTransitions,true);assert.equal(approval.preserveOriginalStrictFailure,true);
for(const [filename,expected]of [[scope.apiPath,scope.apiSha256],[scope.callerPath,scope.callerSha256]])assert.equal(sha(await load(filename)),expected);
const authorityRaw=await load(path.join(original,'approved-batch.json'));assert.equal(sha(authorityRaw),'896d20483fea390636293c7952b4792b5ca2e1f64f76f60ec6e5c3a15381b347');const spec=JSON.parse(authorityRaw);
const start=JSON.parse(await load(path.join(root,'production/execute-start.json'))),finish=JSON.parse(await load(path.join(root,'production/execute-finished.json')));
assert.equal(start.approvedScopeSha256,scopeSha);assert.equal(start.originalApprovalAt,'2026-10-10T05:28:51.000Z');assert.equal(start.newApprovalAt,approval.approvedAt);assert.equal(start.processId,finish.processId);
const stdout=await load(path.join(root,'production/execute-exact.stdout.log')),stderr=await load(path.join(root,'production/execute-exact.stderr.log'));
assert.equal(stdout.length,finish.stdoutBytes);assert.equal(stderr.length,finish.stderrBytes);assert.equal(sha(stdout),finish.stdoutSha256);assert.equal(sha(stderr),finish.stderrSha256);
const failure=stderr.length?JSON.parse(stderr):null;
const names=(await readdir(path.join(journalRoot,id))).sort();assert.ok(names.every((n,i)=>n===String(i).padStart(6,'0')+'.json'));
const events=[],oldBytes=[],journalFiles=[];let previous=null;
for(const [index,name]of names.entries()){
  const filename=path.join(journalRoot,id,name),raw=await readFile(filename),record=JSON.parse(raw),{eventSha256,...body}=record;
  assert.equal(record.batchSha256,batch);assert.equal(record.previous,previous);assert.equal(hash(body),eventSha256);assert.ok(raw.equals(Buffer.from(canonical(record)+'\n')));
  if(index<87){const before=await readFile(path.join(archive,name));assert.ok(raw.equals(before),'Original canonical journal bytes changed');oldBytes.push({name,bytes:raw.length,sha256:sha(raw)});}
  events.push(record);journalFiles.push({name,bytes:raw.length,sha256:sha(raw),eventSha256});previous=eventSha256;
}
assert.equal(events[86].eventSha256,oldHead);const newEvents=events.slice(87),latest=new Map();for(const e of events)if(e.operationId)latest.set(e.operationId,e);
const operations=spec.batch.operations.map((op,index)=>({index:index+1,id:op.id,latestStatus:latest.get(op.id)?.status??'not-started',eventSha256:latest.get(op.id)?.eventSha256??null,started:events.filter(e=>e.operationId===op.id&&e.status==='started').length,newStarts:newEvents.filter(e=>e.operationId===op.id&&e.status==='started').length}));
for(const op of operations.slice(0,18))assert.equal(op.latestStatus,'passed');assert.equal(operations[18].latestStatus,'unknown');assert.equal(operations[18].eventSha256,oldHead);
assert.ok(!newEvents.some(e=>e.operationId&&spec.batch.operations.slice(0,19).some(o=>o.id===e.operationId)));
const acceptance=newEvents.find(e=>e.status==='exact-transition-acceptance-passed');assert.ok(acceptance);assert.equal(newEvents.filter(e=>e.status==='exact-transition-acceptance-passed').length,1);
assert.equal(acceptance.originalOperationStatus,'unknown');assert.equal(acceptance.originalProcessSucceeded,false);assert.equal(acceptance.originalStrictEquality,false);assert.equal(acceptance.originalUnknownEventSha256,oldHead);
assert.equal(acceptance.originalApprovalAt,'2026-10-10T05:28:51.000Z');assert.equal(acceptance.acceptanceApprovedAt,approval.approvedAt);assert.equal(acceptance.scopeSha256,scopeSha);
assert.equal(acceptance.receiptSha256,hash({scopeSha256:scopeSha,humanApproval:approval,proof:acceptance.acceptanceProof}));
const activePath=path.join(journalRoot,'active.json');let active=null,activeExists;
try{const info=await lstat(activePath);assert.ok(info.isFile()&&!info.isSymbolicLink());const raw=await load(activePath);active=JSON.parse(raw);activeExists=true;}catch(error){assert.equal(error.code,'ENOENT');activeExists=false;}
if(activeExists)assert.deepEqual(active,{batchSha256:batch,id});
const workerPath='D:/teruisi-runtime/teruisi-worker-sales/releases/20261010T014638Z-97833d2f2b7e7bc9/deployment-manifest.json',workerRaw=await load(workerPath),worker=JSON.parse(workerRaw);
assert.equal(sha(workerRaw),'f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113');assert.equal(worker.releaseId,'20261010T014638Z-97833d2f2b7e7bc9');assert.equal(worker.source.sourceFingerprint,spec.batch.binding.sourceSha256);
const djangoRaw=await load('D:/teruisi-runtime/django-sales/app/deployment.json');assert.equal(sha(djangoRaw),'237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9');
const complete=newEvents.find(e=>e.status==='completed-with-approved-exact-transitions');
const observedAt=new Date().toISOString();
const review={version:'teruisi-exact-295d-actual-independent-review-v1',independent:true,observedAt,reviewer:'/root/combined_independent_review',status:complete&&!activeExists&&finish.exitCode===0?'exact-contract-completed':'blocked-before-original-tail',batchSha256:batch,scopeSha256:scopeSha,actualHumanApproval:approval,callerTerminal:{...finish,stdoutAndStderrOriginalFilesPresentAndMatched:true,failureEnvelope:failure},sourceCandidate:scope.sourceCommit,apiSha256:scope.apiSha256,callerSha256:scope.callerSha256,journal:{records:events.length,head:previous,allCanonicalHashChainVerified:true,old87RawBytesMatchPreviouslyArchivedDelivery:true,old87Files:oldBytes,allFiles:journalFiles,newEvents,operations},exactSourceAcceptance:{passed:true,eventSha256:acceptance.eventSha256,receiptSha256:acceptance.receiptSha256,receiptHashRecomputedFromActualApprovalAndRecordedProof:true,at:acceptance.at,proof:acceptance.acceptanceProof,durationMs:acceptance.durationMs,queueWaitMs:acceptance.queueWaitMs},originalStrictComparison:{status:'unknown',strictEquality:false,eventSha256:oldHead,exitCode:events[86].processEvidence.exitCode,oldFailureRawBytesPreserved:true,oldEngineNormalCompleted:false},ownership:{observedAt,activeExists,active,ownershipReleased:!activeExists},tailOperations:operations.slice(19).map(o=>({...o,processEvidence:latest.get(o.id)?.processEvidence??null,receiptSha256:latest.get(o.id)?.receiptSha256??null})),noReplay:{oldOperations1to19NewStarted:0,newLifecycleActions:0,newBackupOrRestoreActions:0},currentManifestMetadata:{observedAt,workerReleaseId:worker.releaseId,workerManifestSha256:sha(workerRaw),sourceFingerprint:worker.source.sourceFingerprint,expectedAdoptedSourceCommit:'5faac8151f59d66de72c3caead8cad916ea547da',djangoOwnerSha256:sha(djangoRaw),CAdopted:false,newNoDataPolicyAdopted:false,fullSourceTreeRehashed:false,activeMetadataIsNotHealthProof:true},timing:{originalApprovalAt:'2026-10-10T05:28:51.000Z',newApprovalAt:approval.approvedAt,attemptElapsedMs:finish.elapsedMs,originalApprovalToAttemptStopMs:Date.parse(finish.finishedAt)-Date.parse('2026-10-10T05:28:51.000Z'),newApprovalToAttemptStopMs:Date.parse(finish.finishedAt)-Date.parse(approval.approvedAt),necessaryAcceptanceClosedAt:null,fullDeliveryClosedAt:null},productionMutationsByReviewer:0,productionOperatorInvokedByReviewer:false,productionSqlHttpStatusOrLocksUsedByReviewer:false,dumpOr4505ClosureRehashedByReviewer:false,real20or21ReceiptAvailable:operations.slice(19).every(o=>o.latestStatus==='passed'),completeABAcceptance:false,fullDeliveryClosed:false,blockingFacts:['The one approved caller exited1 after the new exact source contract passed.','No original20/21 started or terminal event and no distinct completion event exists in the captured89-record journal.','Exact active9 ownership is retained; no owner release is claimed.','The sanitized original caller stderr does not preserve the failed admission child raw output or processEvidence; its underlying dynamic/integrity cause is not independently established.','This single-head scope has appended records and cannot be automatically re-entered.'],limitations:['No API, collector, Status, business HTTP, SQL, lifecycle, Backup, Restore, lock, fullpins or dump hash was executed by the reviewer.','A failed admission before its append leaves only the caller failure envelope. This report does not reconstruct its private diagnostic message or invent a health result.','Manifest identity supports the same AB artifact and Django owner at observedAt; it does not establish permanent readiness or zero historical availability faults.','Original source proof remains limited to exact reviewed effects; historical signatures/human intent and complete pre recovery package are not recovered.','No new release strategy or C adoption is inferred from development-main commits.'],sources};
assert.equal(events.length,89);assert.equal(finish.exitCode,1);assert.equal(operations[19].latestStatus,'not-started');assert.equal(operations[20].latestStatus,'not-started');assert.equal(activeExists,true);assert.equal(complete,undefined);
const dest=path.join(path.dirname(fileURLToPath(import.meta.url)),'EXACT_295D_ACTUAL_INDEPENDENT_REVIEW.json');await writeFile(dest,JSON.stringify(review,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:review.status,observedAt,records:events.length,old87BytesPreserved:true,head:previous,sourceContractPassed:true,original20and21:'not-started',activeRetained:activeExists,reviewSha256:sha(await readFile(dest))}));
