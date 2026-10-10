import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const version='teruisi-ab-approved-final-tail-resume-v1';
export const batchSha256='9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15';
export const sourceScopeSha256='295d8923fb794079faf5cc9c74f92f12d8bd78a3ccbbce4b9dcbb19e00fcc458';
export const sourceScopeFileSha256='bf82070e60d613a169a059af7374dc3bca43862264b4f222c10e9c6d7412421b';
export const sourceApprovalSha256='c70ac58556ffca976c0d19c0abebf5858da545b034c3b09048dd82f7fe8a3970';
export const originalHead='316f341eafafe08c3366fc79ca2c36b96258d2b00fcd9767a82a32cd62f7ce7d';
export const acceptedHead='ee784dfd718bc16aabcc2868667ac5b5d707bf3a582624a4f722019a050d7485';
export const acceptedReceipt='73c0de244c7358a9c7031411dac86d1c028689bdd02efb5e14a0e7154d5c5f5f';
export const originalAuthoritySha256='896d20483fea390636293c7952b4792b5ca2e1f64f76f60ec6e5c3a15381b347';
export const originalRoot='E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2';
export const sourceRoot='E:/codex-artifacts/release-integration-review-20261010/AB-exact-closeout-20261010-1530-final';
export const artifactParent='E:/codex-artifacts/release-integration-review-20261010';
export const journalRoot='D:/teruisi-runtime/teruisi-worker-sales/state/release-batches';
export const comparisonId='full-postgresql-deep-comparison';
export const tailIds=['original-historical-audits-preserved','exact-final-readiness'];
export const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
export const digest=b=>createHash('sha256').update(b).digest('hex');
export const hash=v=>digest(canonical(v));
const requireHash=v=>assert.match(v??'',/^[a-f0-9]{64}$/);
function frozen(value){const copy=structuredClone(value);function visit(v){if(v&&typeof v==='object'){for(const child of Object.values(v))visit(child);Object.freeze(v);}return v;}return visit(copy);}
const errorCodes=new Set(['UNCLASSIFIED_FAILURE','DEADLINE_EXCEEDED','STATUS_NOT_READY','ASSERTION_FAILED','STATUS_TIMEOUT','STATUS_IDENTITY_MISMATCH','INVALID_STATUS_JSON','PROCESS_FAILED','OUTPUT_LIMIT','EAI_AGAIN','RELEASE_MISMATCH','INVALID_RESPONSE','CONNECTION_RESET','SERVICE_UNAVAILABLE','TIMEOUT','EACCES','ENOENT','EEXIST','EIO','ENOSPC','EPIPE','EPERM','ETIMEDOUT','ECONNREFUSED','ECONNRESET','RESULT_LEDGER_NOT_CONFIRMED']);
const iso=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v)&&Number.isFinite(Date.parse(v));
function tag(out,key,value,allowed){if(value===null)out[key]=null;else if(typeof value==='string'&&allowed.includes(value))out[key]=value;else if(value!==undefined)out[key+'Sha256']=digest(String(value));}

export function safeProcess(value){
  if(!value||typeof value!=='object')return null;
  const out={};
  for(const k of ['version','processId','exitCode','elapsedMs','deadlineUnixMs','stdoutBytes','stderrBytes','treeCleanupExitCode'])if(value[k]===null||Number.isFinite(value[k]))out[k]=value[k];
  const enums={code:['completed','spawn_failed','nonzero_exit','process_timeout','output_limit','invalid_result','engine_failed','engine_timeout'],stage:['spawn','direct-exit','output','result-parse','result-assertions','completed','engine','candidate-identity','full-readiness','maintenance','receipt'],outputProtocol:['direct-exit-files','eof'],cleanup:['direct','preserve','tree'],timeoutType:['spawn','direct-exit','output','result-parse','result-assertions','tree-cleanup','engine','total','idle'],signal:['SIGTERM','SIGKILL','SIGINT','SIGBREAK','SIGHUP','SIGABRT'],nativeCode:[...errorCodes],completionCode:['completed','nonzero_exit','process_timeout','invalid_result','engine_failed','assertion_failed','missing_readiness'],completionStage:['engine','candidate-identity','full-readiness','maintenance','receipt']};for(const [k,allowed]of Object.entries(enums))tag(out,k,value[k],allowed);
  for(const k of Object.keys(enums)){const s=k+'Sha256';if(out[s]===undefined&&/^[a-f0-9]{64}$/.test(value[s]??''))out[s]=value[s];}
  if(typeof value.treeCleanupPending==='boolean')out.treeCleanupPending=value.treeCleanupPending;
  for(const k of ['stdoutSha256','stderrSha256'])if(/^[a-f0-9]{64}$/.test(value[k]??''))out[k]=value[k];
  if(value.engineFailure)out.engineFailure=safeProcess(value.engineFailure);
  if(Array.isArray(value.engine))out.engine=value.engine.slice(0,8).map(safeProcess);
  return out;
}
export function safeAttempt(value){
  const v=value?.observation??value,out={};if(!v||typeof v!=='object')return null;
  for(const k of ['attempt','durationMs'])if(Number.isFinite(v[k]))out[k]=v[k];
  if(iso(v.at))out.at=v.at;else if(v.at!==undefined)out.atSha256=digest(String(v.at));
  tag(out,'stage',v.stage,['closeout-admission-status','closeout-status','accept-status','verify-startup-status','startup-status','prepare-status','drain-status','readiness','status']);tag(out,'status',v.status,['passed','failed','started','unknown']);
  if(v.error){out.error={code:errorCodes.has(v.error.code)?v.error.code:'UNCLASSIFIED_FAILURE',retryable:v.error.retryable===true,messageSha256:/^[a-f0-9]{64}$/.test(v.error.messageSha256??'')?v.error.messageSha256:null};if(v.error.code!==undefined&&!errorCodes.has(v.error.code))out.error.codeSha256=digest(String(v.error.code));}
  if(v.error?.process)out.error.process=safeProcess(v.error.process);
  for(const s of ['atSha256','stageSha256','statusSha256'])if(out[s]===undefined&&/^[a-f0-9]{64}$/.test(v[s]??''))out[s]=v[s];if(out.error&&out.error.codeSha256===undefined&&/^[a-f0-9]{64}$/.test(v.error?.codeSha256??''))out.error.codeSha256=v.error.codeSha256;
  if(value?.sourceSha256&&/^[a-f0-9]{64}$/.test(value.sourceSha256))out.sourceSha256=value.sourceSha256;
  const basename=typeof value?.sourcePath==='string'?path.basename(value.sourcePath):value?.sourceBasename;
  if(typeof basename==='string'&&/^\d{1,8}\.json$/.test(basename))out.sourceBasename=basename;
  return out;
}
const safeAttempts=value=>Array.isArray(value)?value.map(safeAttempt).filter(Boolean):[];
export function safeFailure(error){
  const rawCode=error?.failureCode??error?.code,code=errorCodes.has(rawCode)?rawCode:'UNCLASSIFIED_FAILURE';
  return {code,unrecognizedCodeSha256:rawCode!==undefined&&!errorCodes.has(rawCode)?digest(String(rawCode)):/^[a-f0-9]{64}$/.test(error?.unrecognizedCodeSha256??'')?error.unrecognizedCodeSha256:null,errorType:['Error','AssertionError','TypeError','RangeError','SyntaxError'].includes(error?.name??error?.errorType)?(error.name??error.errorType):'OtherError',messageSha256:/^[a-f0-9]{64}$/.test(error?.messageSha256??'')?error.messageSha256:digest(String(error?.message??'non-string error')),operatorFailureCode:errorCodes.has(error?.operatorFailureCode)?error.operatorFailureCode:null,operatorFailureMessageSha256:/^[a-f0-9]{64}$/.test(error?.operatorFailureMessageSha256??'')?error.operatorFailureMessageSha256:null,resultReceiptSha256:/^[a-f0-9]{64}$/.test(error?.resultReceiptSha256??'')?error.resultReceiptSha256:null,processEvidence:safeProcess(error?.processEvidence),observationAttempts:safeAttempts(error?.observationAttempts),observationCaptureFailureSha256:/^[a-f0-9]{64}$/.test(error?.observationCaptureFailure?.messageSha256??error?.observationCaptureFailureSha256??'')?(error.observationCaptureFailure?.messageSha256??error.observationCaptureFailureSha256):null,rawPrivateValuesLogged:false};
}
function passedProcess(result,deadlineUnixMs){
  requireHash(result?.receiptSha256);const p=result.processEvidence;
  assert.equal(p?.exitCode,0);assert.equal(p.signal,null);assert.equal(p.code,'completed');assert.equal(p.stage,'completed');assert.equal(p.outputProtocol,'direct-exit-files');assert.equal(p.cleanup,'direct');assert.equal(p.timeoutType,null);assert.equal(p.treeCleanupPending,false);
  assert.ok(Number.isSafeInteger(p.processId)&&p.processId>0);assert.ok(Number.isFinite(p.elapsedMs)&&p.elapsedMs>=0);assert.ok(Number.isSafeInteger(p.stdoutBytes)&&p.stdoutBytes>0);assert.ok(Number.isSafeInteger(p.stderrBytes)&&p.stderrBytes>=0);requireHash(p.stdoutSha256);requireHash(p.stderrSha256);
  assert.ok(Number.isSafeInteger(p.deadlineUnixMs)&&p.deadlineUnixMs<=deadlineUnixMs,'Original inherited deadline extended');
}

export async function resumeFinalTail({spec,sourceScope,scope,approvedScope,humanApproval,sourceApproval,runtime}){
  spec=frozen(spec);sourceScope=frozen(sourceScope);scope=frozen(scope);humanApproval=frozen(humanApproval);sourceApproval=frozen(sourceApproval);
  const {scopeSha256,...core}=scope;requireHash(approvedScope);assert.equal(hash(core),scopeSha256);assert.equal(scopeSha256,approvedScope);
  assert.equal(scope.version,version);assert.equal(scope.batchSha256,batchSha256);assert.equal(scope.expectedHeadSha256,acceptedHead);assert.equal(scope.expectedRecords,89);assert.equal(scope.originalStrictEquality,false);assert.equal(scope.reappendAcceptedSource,false);assert.equal(scope.releaseExactOwnership,true);assert.equal(scope.originalApprovalAt,'2026-10-10T05:28:51.000Z');
  assert.equal(path.resolve(scope.sourceScopePath),path.resolve(sourceRoot,'exact-acceptance-scope.json'));assert.equal(scope.sourceScopeFileSha256,sourceScopeFileSha256);assert.equal(path.resolve(scope.sourceApprovalPath),path.resolve(sourceRoot,'human-exact-acceptance-approval.json'));assert.equal(scope.sourceApprovalSha256,sourceApprovalSha256);
  assert.equal(path.resolve(spec.journalRoot),path.resolve(journalRoot));runtime.verifyBatch(spec.batch,batchSha256);assert.equal(hash(spec.collector),spec.batch.collectorSha256);assert.equal(sourceScope.scopeSha256,sourceScopeSha256);const {scopeSha256:oldSha,...oldCore}=sourceScope;assert.equal(hash(oldCore),oldSha);
  assert.ok(Number.isSafeInteger(scope.totalTimeoutMs)&&scope.totalTimeoutMs>=840000&&scope.totalTimeoutMs<=3300000);
  for(const k of ['explicitHumanApproval','preserveOriginalStrictFailure','reuseAccepted295Contract','runOnlyOriginalReadOnly20and21','releaseExactOwnership'])assert.equal(humanApproval?.[k],true);
  assert.equal(humanApproval.scopeSha256,approvedScope);assert.ok(Number.isFinite(Date.parse(scope.sealedAt))&&Number.isFinite(Date.parse(humanApproval.approvedAt))&&Date.parse(humanApproval.approvedAt)>=Date.parse(scope.sealedAt)&&Date.parse(humanApproval.approvedAt)<=Date.now());assert.match(humanApproval.userItemId??'',/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.ok(!['01a12449-131b-7dd0-ae6f-b98a5f32b283','01a124f9-78a0-75b3-bd46-c484e6734b12','01a12560-b472-7250-9b1a-63ca0079f774','01a1268a-bc4d-7501-98f1-5ec3ceaa2a99'].includes(humanApproval.userItemId));
  assert.equal(sourceApproval.scopeSha256,sourceScopeSha256);assert.equal(sourceApproval.explicitHumanApproval,true);assert.equal(sourceApproval.acceptExactConcurrentTransitions,true);assert.equal(sourceApproval.preserveOriginalStrictFailure,true);assert.equal(sourceApproval.approvedAt,'2026-10-10T15:59:48.000Z');assert.equal(sourceApproval.userItemId,'01a1268a-bc4d-7501-98f1-5ec3ceaa2a99');
  const pins=new Map();for(const f of scope.files){requireHash(f.sha256);assert.ok(path.isAbsolute(f.path));const p=path.resolve(f.path);assert.ok(!pins.has(p));pins.set(p,f.sha256);}
  assert.equal(sourceScope.files.length,4589);for(const f of sourceScope.files)assert.equal(pins.get(path.resolve(f.path)),f.sha256,'Old4589 closure omitted or changed');
  const oldRequired=new Map();for(const f of [...spec.collector.files,...spec.batch.operations.slice(15).flatMap(o=>o.command?.files??[])]){const p=path.resolve(f.path);if(oldRequired.has(p))assert.equal(oldRequired.get(p),f.sha256);oldRequired.set(p,f.sha256);assert.equal(pins.get(p),f.sha256,'Original current closure omitted');}assert.equal(oldRequired.size,4505);
  for(const [p,s]of [[scope.apiPath,scope.apiSha256],[scope.callerPath,scope.callerSha256],[scope.runtimePath,scope.runtimeSha256],[scope.codeReviewPath,scope.codeReviewSha256],[scope.actualReviewPath,scope.actualReviewSha256],[scope.sourceScopePath,sourceScopeFileSha256],[scope.sourceApprovalPath,sourceApprovalSha256],[path.join(originalRoot,'approved-batch.json'),originalAuthoritySha256]]){requireHash(s);assert.equal(pins.get(path.resolve(p)),s);}
  const tail=spec.batch.operations.slice(19);assert.deepEqual(tail.map(o=>o.id),tailIds);for(const op of tail){assert.equal(op.mutating,false);assert.equal(hash(op),scope.tailOperationSha256[op.id]);}
  const now=runtime.now??Date.now,enteredAt=now(),deadlineUnixMs=Math.min(runtime.deadlineUnixMs??enteredAt+scope.totalTimeoutMs,enteredAt+scope.totalTimeoutMs);assert.ok(Number.isSafeInteger(deadlineUnixMs));
  function remaining(){const ms=deadlineUnixMs-now();if(ms<1)throw Object.assign(new Error('Common final-tail deadline exhausted'),{code:'DEADLINE_EXCEEDED'});return ms;}
  const queued=performance.now();return runtime.withRotationLock(async lease=>{
    const queueWaitMs=performance.now()-queued,activePath=path.join(spec.journalRoot,'active.json'),active={batchSha256,id:spec.batch.id};
    let state=await runtime.journalState(spec.journalRoot,spec.batch);assert.equal(state.previous,acceptedHead);assert.equal(state.events.length,89);assert.equal(state.unknown.length,1);
    const old=state.latest.get(comparisonId),accepted=state.events[88];assert.equal(old.status,'unknown');assert.equal(old.eventSha256,originalHead);assert.equal(old.processEvidence.exitCode,1);assert.equal(old.processEvidence.stderrSha256,'89f830ac2a279106b931debec167604a4fe6bfe72dae915a0aaa2ade4af282b1');
    assert.equal(accepted.eventSha256,acceptedHead);assert.equal(accepted.status,'exact-transition-acceptance-passed');assert.equal(accepted.scopeSha256,sourceScopeSha256);assert.equal(accepted.originalStrictEquality,false);assert.equal(accepted.originalOperationStatus,'unknown');assert.equal(accepted.originalProcessSucceeded,false);assert.equal(accepted.originalUnknownEventSha256,originalHead);assert.equal(accepted.receiptSha256,acceptedReceipt);assert.equal(hash({scopeSha256:sourceScopeSha256,humanApproval:sourceApproval,proof:accepted.acceptanceProof}),acceptedReceipt);
    for(const op of spec.batch.operations.slice(0,18))assert.equal(state.latest.get(op.id)?.status,'passed');for(const op of tail)assert.ok(!state.latest.has(op.id),'Original readonly tail cannot replay');
    assert.equal(canonical(JSON.parse(await runtime.safeRead(activePath))),canonical(active));
    assert.equal(scope.journalPrefixPins.length,89);for(const [i,pin]of scope.journalPrefixPins.entries()){assert.equal(path.resolve(pin.path),path.resolve(state.dir,String(i).padStart(6,'0')+'.json'));requireHash(pin.sha256);assert.equal(pins.get(path.resolve(pin.path)),pin.sha256);}
    async function append(record,allowExpired=false){
      if(!allowExpired)remaining();const before=await runtime.journalState(spec.journalRoot,spec.batch);assert.equal(before.previous,state.previous,'Foreign journal head');assert.equal(before.events.length,state.events.length);const count=state.events.length,body={batchSha256,previous:state.previous,at:new Date(now()).toISOString(),scopeSha256,...record},event={...body,eventSha256:hash(body)};
      await runtime.writeOnce(path.join(state.dir,String(count).padStart(6,'0')+'.json'),event);const after=await runtime.journalState(spec.journalRoot,spec.batch);assert.equal(after.previous,event.eventSha256);assert.equal(after.events.length,count+1);assert.equal(canonical(after.events.at(-1)),canonical(event));state=after;return event;
    }
    async function checkPins(){for(const [filename,expected]of pins){remaining();assert.equal(await runtime.safeFileDigest(filename,deadlineUnixMs),expected,'Pinned final-tail input changed');remaining();}}
    const proofStarted=performance.now();
    try{
      await checkPins();assert.equal(digest(await runtime.safeRead(scope.sourceScopePath)),sourceScopeFileSha256);assert.equal(digest(await runtime.safeRead(scope.sourceApprovalPath)),sourceApprovalSha256);
      const review=JSON.parse(await runtime.safeRead(scope.codeReviewPath)),actual=JSON.parse(await runtime.safeRead(scope.actualReviewPath));assert.equal(review.independent,true);assert.equal(review.acceptedResumeCandidate,true);assert.equal(review.productionExecutionApproved,false);assert.deepEqual(review.blockingFindings,[]);for(const key of ['apiSha256','callerSha256','runtimeSha256'])assert.equal(review[key],scope[key]);assert.equal(actual.independent,true);assert.equal(actual.scopeSha256,sourceScopeSha256);assert.equal(actual.journal.records,89);assert.equal(actual.journal.head,acceptedHead);assert.equal(actual.journal.old87RawBytesMatchPreviouslyArchivedDelivery,true);assert.equal(actual.exactSourceAcceptance.eventSha256,acceptedHead);assert.equal(actual.exactSourceAcceptance.receiptSha256,acceptedReceipt);
      const actualProof=await runtime.revalidateSource(sourceScope,deadlineUnixMs);remaining();assert.equal(canonical(actualProof),canonical(accepted.acceptanceProof),'Accepted295 source contract changed');
      await append({phase:'closeout',status:'tail-resume-approved',reason:'explicitly-approved-original-readonly-final-tail',originalApprovalAt:scope.originalApprovalAt,resumeApprovedAt:humanApproval.approvedAt,sourceApprovalSha256,sourceScopeSha256,acceptedSourceEventSha256:acceptedHead,acceptedSourceReceiptSha256:acceptedReceipt,sourceAcceptedReplayed:false,queueWaitMs,proofDurationMs:performance.now()-proofStarted,deadlineUnixMs,receiptSha256:hash({scopeSha256,humanApproval,sourceApprovalSha256,acceptedHead})});
    }catch(error){await append({phase:'closeout',status:'tail-resume-input-failed',reason:'input-source-or-common-deadline-failed',error:safeFailure(error)},true);throw error;}
    async function admission(op){
      const begun=performance.now();try{
        await checkPins();const current=await runtime.collectCurrent(spec,op,lease,deadlineUnixMs);remaining();assert.equal(current.batchSha256,batchSha256);assert.ok(Number.isFinite(current.observedAtMs)&&Math.abs(now()-current.observedAtMs)<=5000);runtime.assertBindings(spec.batch.binding,current.binding);
        assert.equal(canonical(JSON.parse(await runtime.safeRead(activePath))),canonical(active));await append({phase:op.phase,status:'tail-resume-admission',forOperation:op.id,durationMs:performance.now()-begun,observedAtMs:current.observedAtMs,admissionStages:current.admissionStages??null,observationAttempts:safeAttempts(current.observationAttempts)});return current.observedAtMs;
      }catch(error){try{await append({phase:op.phase,status:'tail-resume-admission-failed',forOperation:op.id,durationMs:performance.now()-begun,reason:'original-dynamic-admission-failed',error:safeFailure(error),processEvidence:safeProcess(error.processEvidence),observationAttempts:safeAttempts(error.observationAttempts)},true);}catch(ledgerError){ledgerError.processEvidence??=safeProcess(error.processEvidence);ledgerError.observationAttempts??=safeAttempts(error.observationAttempts);ledgerError.operatorFailureCode=error.failureCode??error.code;ledgerError.operatorFailureMessageSha256=digest(String(error.message));throw ledgerError;}throw error;}
    }
    let readinessReturnedAtMs=null;
    for(const op of tail){
      const observedAtMs=await admission(op);remaining();const boundaryAgeMs=now()-observedAtMs;assert.ok(Math.abs(boundaryAgeMs)<=5000,'Original sample aged before started');await append({operationId:op.id,phase:op.phase,status:'started',observedAtMs,boundaryAgeMs});const begun=performance.now();let result;
      try{result=await runtime.runApprovedOperation(op,{batch:spec.batch,lease,state,deadlineUnixMs});remaining();assert.equal(result?.status,'passed');passedProcess(result,deadlineUnixMs);if(op.id===tailIds[1])readinessReturnedAtMs=now();}
      catch(error){try{await append({operationId:op.id,phase:op.phase,status:'unknown',reason:'original-readonly-tail-failed-or-incomplete',durationMs:performance.now()-begun,error:safeFailure(error),processEvidence:safeProcess(error.processEvidence??result?.processEvidence),observationAttempts:safeAttempts(error.observationAttempts??result?.observationAttempts)},true);}catch(ledgerError){ledgerError.processEvidence??=safeProcess(error.processEvidence??result?.processEvidence);ledgerError.observationAttempts??=safeAttempts(error.observationAttempts??result?.observationAttempts);ledgerError.resultReceiptSha256=result?.receiptSha256;ledgerError.operatorFailureCode=error.failureCode??error.code;ledgerError.operatorFailureMessageSha256=digest(String(error.message));throw ledgerError;}throw error;}
      try{await append({operationId:op.id,phase:op.phase,status:'passed',durationMs:performance.now()-begun,receiptSha256:result.receiptSha256,processEvidence:safeProcess(result.processEvidence),outputs:result.outputs??null,timing:result.timing??null,observationAttempts:safeAttempts(result.observationAttempts)});}
      catch(error){error.processEvidence??=safeProcess(result.processEvidence);error.resultReceiptSha256=result.receiptSha256;error.observationAttempts??=safeAttempts(result.observationAttempts);throw error;} // Never append over a foreign head; caller durably preserves this actual result.
    }
    assert.equal(state.latest.get(comparisonId).eventSha256,originalHead);assert.equal(state.latest.get(comparisonId).status,'unknown');for(const op of tail)assert.equal(state.latest.get(op.id).status,'passed');assert.equal(canonical(JSON.parse(await runtime.safeRead(activePath))),canonical(active));
    const event=await append({phase:'closeout',status:'completed-with-approved-exact-transitions',completionProtocol:version,originalBatchEngineCompleted:false,originalStrictComparisonPassed:false,originalUnknownEventSha256:originalHead,acceptedSourceEventSha256:acceptedHead,acceptedSourceReappended:false,originalApprovalAt:scope.originalApprovalAt,resumeApprovedAt:humanApproval.approvedAt,finalReadinessReturnedAtMs:readinessReturnedAtMs,finalReadinessReturnToCompletionMs:now()-readinessReturnedAtMs,necessaryAcceptanceClosed:true,fullDeliveryClosed:false});
    try{remaining();const released=await runtime.releaseOwnership({activePath,expectedActive:active,expectedJournalHead:event.eventSha256,spec,deadlineUnixMs});assert.equal(released?.released,true);remaining();try{await runtime.safeRead(activePath);throw new Error('Exact active ownership still exists');}catch(error){assert.equal(error.code,'ENOENT');}remaining();}
    catch(error){await append({phase:'closeout',status:'tail-resume-ownership-release-failed',reason:'physical-owner-release-not-confirmed',error:safeFailure(error),necessaryAcceptanceClosed:true,ownershipReleased:null,fullDeliveryClosed:false},true);throw error;}
    return {event,originalUnknownPreserved:true,originalStrictComparisonPassed:false,acceptedSourceReappended:false,necessaryAcceptanceClosed:true,ownershipReleased:true,ownershipReleasedAtMs:now(),finalReadinessReturnToReleaseMs:now()-readinessReturnedAtMs,fullDeliveryClosed:false};
  });
}
