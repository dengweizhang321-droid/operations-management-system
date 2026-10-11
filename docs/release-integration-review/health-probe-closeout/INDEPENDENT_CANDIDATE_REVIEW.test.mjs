// Independent regressions: pure extracted functions plus two private PS writer leaves.
// No production module import, Status/collector/HTTP/SQL/lock or real WAL access.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import * as fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
const directory=path.dirname(fileURLToPath(import.meta.url));
const read=n=>fs.readFile(path.join(directory,n),'utf8');
const H=b=>createHash('sha256').update(b).digest('hex');
const names=['core','finance','netshop','market','products','workflow','inventory','customerService','accessControl','erpReference','bi','ai'];
const plain=s=>s.replaceAll('export function ','function ').replaceAll('export async function ','async function ').replaceAll('export const ','const ');
const retryText=await read('legacy/release-readonly-retry.mjs');
const projection=new Function('readinessComponents',plain(retryText.slice(retryText.indexOf('function sanitizeReadinessFailure('),retryText.indexOf('export async function retryReadOnlyObservation(')))+'\nreturn {safeHealthEvidence,safeReadinessFailure};')(names);
const contractText=await read('health-contract.mjs');
const assertHealthyContract=new Function('assert',plain(contractText.slice(contractText.indexOf('export function assertHealthyContract(')))+'\nreturn assertHealthyContract;')(assert);
const makeDerivedOperation=new Function('assert','path','newOperationId','sourceScriptRoot',plain(contractText.slice(contractText.indexOf('export function makeDerivedOperation('),contractText.indexOf('export function assertHealthyContract(')))+'\nreturn makeDerivedOperation;')(assert,path,'health-probe-contract-readiness-supplement','D:/运营管理系统/tools');
const producerText=await read('producer-evidence.mjs');
const producer=new Function('assert','safeHealthEvidence','assertHealthyContract',plain(producerText.slice(producerText.indexOf('export function safeNativeWindow('),producerText.indexOf('async function safeRead('))+producerText.slice(producerText.indexOf('export function assertProducerSuccess(')))+'\nreturn {safeNativeWindow,isoUtc,safeProducerTrace,safeProducerReferences,assertProducerSuccess};')(assert,projection.safeHealthEvidence,assertHealthyContract);
const statusText=await read('status-evidence.mjs');
const safeReadiness=new Function('components','safeHealthEvidence',plain(statusText.slice(statusText.indexOf('export function safeReadiness('),statusText.indexOf('async function safePath(')))+'\nreturn safeReadiness;')(names,projection.safeHealthEvidence);
const protocolText=await read('protocol.mjs');
const protocolBody=plain(protocolText.replace(/^import .*;\r?\n/gm,''));
const protocolExports=[...protocolText.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map(m=>m[1]);
const p=new Function('assert','path','createHash','safeReadiness','makeDerivedOperation','assertHealthyContract','safeProducerReferences','assertProducerSuccess','safeNativeWindow','performance',protocolBody+'\nreturn {'+protocolExports.join(',')+'};')(assert,path,createHash,safeReadiness,makeDerivedOperation,assertHealthyContract,producer.safeProducerReferences,producer.assertProducerSuccess,producer.safeNativeWindow,performance);
const diagnosticRecord=new Function('assert','safeProcess','digest','safeReadiness',plain(statusText.slice(statusText.indexOf('export function diagnosticRecord('),statusText.indexOf('// Fixture factory')))+'\nreturn diagnosticRecord;')(assert,p.safeProcess,p.digest,safeReadiness);
const runtimeText=await read('runtime.mjs');
const retainText=runtimeText.slice(runtimeText.indexOf('export function retainReturnedEvidence('),runtimeText.indexOf('export async function makeRuntime('));
assert.ok(retainText.includes('captureReturned'));
const retention=new Function('safeFailure',plain(retainText)+'\nreturn {retainReturnedEvidence,captureReturned};')(p.safeFailure);
const stamp=Date.parse('2026-10-11T00:00:01.000Z');
const health=(t=stamp)=>({version:1,checkedAt:new Date(t-5).toISOString(),probes:Object.fromEntries(['live','helper','ready'].map(n=>[n,{called:true,requested:true,statusCode:200,parsedObject:true,okMatches:true,markerMatches:true,passed:true,degradedMatches:false,beforeDeadline:true,timeoutMs:n==='ready'?5000:3000,effectiveTimeoutMs:n==='ready'?5000:3000,elapsedMs:1,errorKind:'none'}]))});
function record(){return{version:'teruisi-health-producer-trace-v1',scopeSha256:'a'.repeat(64),producerSha256:'b'.repeat(64),authorityRawSha256:'c'.repeat(64),processId:111,at:new Date(stamp).toISOString(),functionReturned:true,observedState:'Running',healthEvidence:health(),rawBodyPersisted:false,rawReasonPersisted:false};}
const ref=v=>({sha256:H(JSON.stringify(v)),record:v});
const context=v=>({scopeSha256:v.scopeSha256,producerSha256:v.producerSha256,authorityRawSha256:v.authorityRawSha256,processId:v.processId,healthEvidence:v.healthEvidence,since:stamp-20,until:stamp+5,nativeElapsedMs:20});
test('producer flags and all unknown raw fields are rejected without private output',()=>{
  for(const mutate of [v=>v.rawBodyPersisted=true,v=>v.rawReasonPersisted='false',v=>v.rawBody='PRIVATE_SYNTHETIC',v=>v.healthEvidence.raw='PRIVATE_SYNTHETIC',v=>v.healthEvidence.probes.ready.reason='PRIVATE_SYNTHETIC']){const v=record();mutate(v);assert.equal(producer.safeProducerTrace(v),null);}
});
test('UTC ticks and repeated trace filtering are idempotent and do not rewrite raw proof hash',()=>{
  const v=record();v.at=v.at.replace('Z','1234Z');v.healthEvidence.checkedAt=v.healthEvidence.checkedAt.replace('Z','4321Z');const out=producer.safeProducerTrace(v);assert.deepEqual(producer.safeProducerTrace(out),out);const refs=producer.safeProducerReferences([ref(v)]);assert.equal(refs[0].sha256,H(JSON.stringify(v)));assert.deepEqual(producer.safeProducerReferences(refs),refs);
});
test('unique PID and each exact authority identity are mandatory',()=>{
  const v=record();producer.assertProducerSuccess([ref(v)],context(v));
  for(const key of ['scopeSha256','producerSha256','authorityRawSha256','processId']){const altered=structuredClone(v);altered[key]=key==='processId'?112:'d'.repeat(64);assert.throws(()=>producer.assertProducerSuccess([ref(altered)],context(v)));}
  for(const refs of [[],[ref(v),ref(v)]])assert.throws(()=>producer.assertProducerSuccess(refs,context(v)));
});
test('serial sum and complete observed interval must fit actual native elapsed',()=>{
  const v=record(),ctx=context(v);const tooOld=structuredClone(v);tooOld.healthEvidence.checkedAt=new Date(stamp-1000).toISOString();assert.throws(()=>producer.assertProducerSuccess([ref(tooOld)],{...ctx,since:stamp-5000,healthEvidence:tooOld.healthEvidence}));
  const tooMuch=structuredClone(v);tooMuch.healthEvidence.probes.live.elapsedMs=19;assert.throws(()=>producer.assertProducerSuccess([ref(tooMuch)],{...ctx,nativeElapsedMs:10,healthEvidence:tooMuch.healthEvidence}));
});
test('producer facts cannot substitute different parsed Status health facts',()=>{
  const v=record(),ctx=context(v),different=structuredClone(v.healthEvidence);different.probes.ready.elapsedMs=2;assert.throws(()=>producer.assertProducerSuccess([ref(v)],{...ctx,healthEvidence:different}));
  for(const n of ['live','helper','ready']){const bad=structuredClone(v);bad.healthEvidence.probes[n].elapsedMs=bad.healthEvidence.probes[n].effectiveTimeoutMs+1;assert.throws(()=>producer.assertProducerSuccess([ref(bad)],{...ctx,healthEvidence:bad.healthEvidence}));}
});
// The author fixture is used only as a data generator. All independent cases
// below are distinct; no author test callback or production module is executed.
const sourceRaw=await fs.readFile(path.join(p.sourceRoot,'exact-acceptance-scope.json')),sourceApprovalRaw=await fs.readFile(path.join(p.sourceRoot,'human-exact-acceptance-approval.json')),specRaw=await fs.readFile(path.join(p.originalRoot,'approved-batch.json')),priorRaw=await fs.readFile(path.join(p.priorRoot,'readiness-scope.json')),priorApprovalRaw=await fs.readFile(path.join(p.priorRoot,'human-readiness-approval.json'));
const sourceReviewRaw=await fs.readFile(path.join(directory,'../health-probe-contract/INDEPENDENT_SOURCE_REVIEW.json'));
const actualRaw=await fs.readFile('D:/.codex/worktrees/release-integration-review/运营管理系统/docs/release-integration-review/production/READINESS_SUPPLEMENT_ACTUAL_INDEPENDENT.json');
const original=JSON.parse(specRaw),source=JSON.parse(sourceRaw),prior=JSON.parse(priorRaw),sourceApproval=JSON.parse(sourceApprovalRaw),journalDir=path.join(original.journalRoot,original.batch.id),baseline=[];
for(let i=0;i<102;i++)baseline.push(JSON.parse(await fs.readFile(path.join(journalDir,String(i).padStart(6,'0')+'.json'))));
const fixtureText=await read('protocol.test.mjs');
const fixture=new Function('assert','path','p','original','source','prior','sourceApproval','baseline','journalDir','sourceRaw','sourceApprovalRaw','specRaw','priorRaw','priorApprovalRaw','sourceReviewRaw','actualRaw','health','makeDerivedOperation','diagnosticRecord','safeReadinessFailure',plain(fixtureText.slice(fixtureText.indexOf('const status=()'),fixtureText.indexOf('async function rejected(')))+'\nreturn fixture;')(assert,path,p,original,source,prior,sourceApproval,baseline,journalDir,sourceRaw,sourceApprovalRaw,specRaw,priorRaw,priorApprovalRaw,sourceReviewRaw,actualRaw,t=>health(t??Date.now()),makeDerivedOperation,diagnosticRecord,projection.safeReadinessFailure);
async function rejected(f){let error;try{await f.execute();}catch(e){error=e;}assert.ok(error);return error;}
test('a successful model preserves all three unknowns and runs only the new independent ID',async()=>{
  const f=fixture(),before=p.canonical(f.events);await f.execute();assert.equal(p.canonical(f.events.slice(0,102)),before);for(const id of [p.comparisonId,p.originalReadinessId,p.oldSupplementId])assert.equal(f.latest.get(id).status,'unknown');assert.deepEqual(f.calls.filter(c=>c[0]==='run').map(c=>c[1]),[p.operationId]);assert.equal(f.events.at(-1).necessaryAcceptanceClosed,true);assert.equal(f.events.at(-1).originalReadiness21Passed,false);
});
test('collector facts survive late binding rejection and failed failure-ledger append',async()=>{
  const f=fixture(),base=f.runtime.collectCurrent,write=f.runtime.writeOnce;f.runtime.collectCurrent=async(...args)=>{const current=await base(...args);current.processEvidence=f.valid().processEvidence;current.observationAttempts=[{attempt:1,status:'passed',stage:'closeout-admission-status',at:new Date(f.now).toISOString()}];current.binding={foreign:'PRIVATE_SYNTHETIC'};return current;};f.runtime.writeOnce=async(file,e)=>{if(e.status==='readiness-supplement-admission-failed')throw Object.assign(new Error('PRIVATE_DISK'),{code:'EIO'});return write(file,e);};const error=p.safeFailure(await rejected(f));assert.equal(error.processEvidence.exitCode,0);assert.equal(error.statusEvidence.length,1);assert.equal(error.producerTraces.length,1);assert.equal(error.observationAttempts.length,1);assert.ok(!JSON.stringify(error).includes('PRIVATE_'));assert.equal(f.calls.filter(c=>c[0]==='run').length,0);
});
test('foreign head at the pending boundary keeps returned native and owner without foreign append',async()=>{
  const f=fixture(),read=f.runtime.journalState;let triggered=false;f.runtime.journalState=async(...args)=>{const state=await read(...args);if(f.latest.get(p.operationId)?.status==='passed'){triggered=true;return{...state,previous:'0'.repeat(64)};}return state;};const error=p.safeFailure(await rejected(f));assert.equal(triggered,true);assert.equal(error.processEvidence.exitCode,0);assert.equal(error.resultReceiptSha256,'e'.repeat(64));assert.equal(error.producerTraces.length,1);assert.ok(f.active);assert.equal(f.events.filter(e=>e.status==='completed-with-approved-diagnostic-final-readiness').length,0);
});
test('late owner ack rejection and second WAL loss preserve known physical absence honestly',async()=>{
  const f=fixture(),write=f.runtime.writeOnce;f.runtime.writeOnce=async(file,e)=>{if(['completed-with-approved-diagnostic-final-readiness','readiness-ownership-release-failed'].includes(e.status))throw Object.assign(new Error('PRIVATE_DISK'),{code:'ENOSPC'});return write(file,e);};const error=p.safeFailure(await rejected(f));assert.equal(f.active,null);assert.equal(error.ownershipReleased,true);assert.ok(Number.isSafeInteger(error.ownershipAbsentObservedAtMs));assert.equal(error.resultReceiptSha256,'e'.repeat(64));assert.equal(error.producerTraces.length,1);
});
test('post-return reader failure preserves actual native/receipt/window through repeated sanitization',async()=>{
  const f=fixture(),result=f.valid();result.nativeWindow=structuredClone(result.statusEvidence[0].nativeWindow);let error;try{await retention.captureReturned(async()=>result,async()=>{throw Object.assign(new Error('PRIVATE_READER'),{code:'EACCES'});});}catch(e){error=e;}const once=p.safeFailure(error),twice=p.safeFailure(once);assert.equal(once.processEvidence.processId,result.processEvidence.processId);assert.equal(once.resultReceiptSha256,result.receiptSha256);assert.deepEqual(once.nativeWindow,result.nativeWindow);assert.deepEqual(once.producerTraces,twice.producerTraces);assert.deepEqual(once.nativeWindow,twice.nativeWindow);assert.ok(!JSON.stringify(once).includes('PRIVATE_READER'));
});
test('nonzero native evidence and side trace never become successful stdout parse',()=>{
  const f=fixture(),r=f.valid();const failure=p.safeFailure({code:'PROCESS_FAILED',processEvidence:{...r.processEvidence,exitCode:9,code:'nonzero_exit'},nativeWindow:r.statusEvidence[0].nativeWindow,producerTraces:r.producerTraces});assert.equal(failure.processEvidence.exitCode,9);assert.equal(failure.statusEvidence.length,0);assert.equal(failure.producerTraces.length,1);assert.deepEqual(p.safeFailure(failure).nativeWindow,failure.nativeWindow);
});
const prepareText=await read('prepare.mjs');
test('original seven args and new nine args accept only the fixed readonly identity',()=>{
  const body=plain(retryText.slice(retryText.indexOf('function isOriginalStatusOperation('))).replaceAll('import.meta.url','fixtureRetryUrl');
  const exact=new Function('path','fileURLToPath','fixtureRetryUrl',body+'\nreturn isExactStatusOperation;')(path,fileURLToPath,pathToFileURL(path.join(directory,'legacy','release-readonly-retry.mjs')).href);
  const originalOp=original.batch.operations[20],derived=makeDerivedOperation(originalOp,{outputRoot:directory,derivedControllerPath:path.join(directory,'readonly-control.ps1'),derivedControllerSha256:'b'.repeat(64)});
  assert.equal(exact(originalOp),true);assert.equal(exact(derived),true);
  for(const change of [x=>x.mutating=true,x=>x.id='other',x=>x.command.args[5]='Start',x=>x.command.args[8]='D:/foreign',x=>x.command.args[3]='D:/foreign/readonly-control.ps1',x=>x.command.args.push('-Open')]){const x=structuredClone(derived);change(x);assert.equal(exact(x),false);}
});
assert.ok(!/^import .* from ['"](?!node:)/m.test(prepareText));
const bootstrapBody=plain(prepareText.slice(prepareText.indexOf('export async function bootstrapClosure('),prepareText.indexOf('export async function main('))).replaceAll('import.meta.url','fixtureFileUrl');
const bootstrapClosure=new Function('assert','path','fileURLToPath','pathToFileURL','bootstrapDigest','fixtureFileUrl',bootstrapBody+'\nreturn bootstrapClosure;')(assert,path,fileURLToPath,pathToFileURL,H,pathToFileURL(path.join(directory,'prepare.mjs')).href);
const candidateReview={independent:true,acceptedHealthProbeCandidate:true,productionExecutionApproved:false,blockingFindings:[],legacySha256:Object.fromEntries(['release-readonly-retry.mjs','release-batch.mjs','release-batch-admission.mjs','collector.mjs'].map(n=>[n,'a'.repeat(64)]))};for(const k of ['apiSha256','callerSha256','runtimeSha256','sealerSha256','statusEvidenceSha256','derivedControllerSha256','producerEvidenceSha256','healthContractSha256','derivationSha256','legacyGeneratorSha256','producerFunctionsSha256'])candidateReview[k]='a'.repeat(64);
const bootstrapRead=async file=>file.endsWith('INDEPENDENT_REVIEW.json')?Buffer.from(JSON.stringify(candidateReview)):file.endsWith('INDEPENDENT_SOURCE_REVIEW.json')?sourceReviewRaw:file.endsWith('readiness-scope.json')?priorRaw:file.endsWith('human-readiness-approval.json')?priorApprovalRaw:specRaw;
test('even last old closure drift rejects prepare before a single dynamic import',async()=>{let imports=0,checks=0;const last=path.resolve(prior.files.at(-1).path);await assert.rejects(bootstrapClosure({read:bootstrapRead,verify:async pin=>{checks++;if(path.resolve(pin.path)===last)throw Object.assign(new Error('synthetic drift'),{code:'EACCES'});},load:async()=>{imports++;return{};}}));assert.ok(checks>=4700);assert.equal(imports,0);});
test('prepare verifies every declared old file and each new executable before import',async()=>{let imports=0;const checked=new Set();await bootstrapClosure({read:bootstrapRead,verify:async pin=>checked.add(path.resolve(pin.path)),load:async()=>{assert.ok(prior.files.every(f=>checked.has(path.resolve(f.path))));for(const name of ['protocol.mjs','execute.mjs','runtime.mjs','prepare.mjs','status-evidence.mjs','readonly-control.ps1','producer-evidence.mjs','health-contract.mjs','derive-control.mjs','copy-legacy.mjs','producer-functions.ps1'])assert.ok(checked.has(path.resolve(directory,name)));imports++;return{};}});assert.equal(imports,4);});
const ps='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';let temp;
const writerRunner=String.raw`param([string]$Functions,[string]$PrivateRoot,[switch]$WriteFault)
$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($Functions,[ref]$tokens,[ref]$errors);if($errors.Count){throw 'private parser error'}
foreach($name in @('Test-ProbeSafePath','ConvertTo-ProbeEvidence','Write-ReadonlyProbeTrace','Get-SystemHealthState')){$nodes=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true));if($nodes.Count -ne 1){throw 'private AST identity error'};. ([ScriptBlock]::Create($nodes[0].Extent.Text))}
$script:ReadonlyProbeContext=[pscustomobject]@{root=$PrivateRoot;scopeSha256=('a'*64);producerSha256=('b'*64);authorityRawSha256=('c'*64)}
$probes=@{};foreach($name in @('live','helper','ready')){$probes[$name]=[pscustomobject]@{called=$true;requested=$true;statusCode=200;parsedObject=$true;okMatches=$true;markerMatches=$true;passed=$true;degradedMatches=$false;beforeDeadline=$true;timeoutMs=$(if($name -eq 'ready'){5000}else{3000});effectiveTimeoutMs=1000;elapsedMs=1;errorKind='none';reason='PRIVATE_SYNTHETIC'}}
$script:lastHealthEvidence=[pscustomobject]@{version=1;checkedAt=[DateTimeOffset]::UtcNow.UtcDateTime.ToString('o');probes=[pscustomobject]$probes;raw='PRIVATE_SYNTHETIC'}
function Get-SourceSystemHealthState{param([switch]$Refresh)return 'Running'}
$returned=$null;$caught=$false;try{$returned=Get-SystemHealthState -Refresh}catch{$caught=$true}
[pscustomobject]@{privateFixture=$true;processId=$PID;returned=$returned;caught=$caught}|ConvertTo-Json -Compress
`;
test.before(async()=>{temp=await fs.mkdtemp(path.join(os.tmpdir(),'teruisi-independent-producer-'));await fs.writeFile(path.join(temp,'runner.ps1'),'\ufeff'+writerRunner);});
test.after(async()=>{const root=path.resolve(temp);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^teruisi-independent-producer-/);async function remove(dir){assert.ok(path.resolve(dir)===root||path.resolve(dir).startsWith(root+path.sep));for(const n of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,n.name);const s=await fs.lstat(p);assert.ok(!s.isSymbolicLink());if(s.isDirectory()){await remove(p);await fs.rmdir(p);}else{assert.ok(s.isFile());await fs.unlink(p);}}}await remove(root);await fs.rmdir(root);});
test('exact owner source really unlinks private file only after matching CAS and confirms ENOENT',async()=>{
  const f=fixture();let pending;const release=f.runtime.releaseOwnership;f.runtime.releaseOwnership=async request=>{pending={request,state:await f.runtime.journalState()};return release(request);};await f.execute();
  const fsBody=plain(runtimeText.slice(runtimeText.indexOf('export async function safePath('),runtimeText.indexOf('export async function nativeDigest(')));
  const io=new Function('assert','path','lstat','realpath','readFile',fsBody+'\nreturn {safePath,readSafe};')(assert,path,fs.lstat,fs.realpath,fs.readFile);
  const ownerBody=runtimeText.slice(runtimeText.indexOf('  async function releaseOwnership('),runtimeText.indexOf('  async function runOriginal('));
  const dependencies={assert,lstat:fs.lstat,unlink:fs.unlink,safePath:io.safePath,readSafe:io.readSafe,readOnlyJournal:async()=>pending.state,spec:f.spec,scope:f.scope,canonical:p.canonical,digest:p.digest,comparisonId:p.comparisonId,originalHead:p.originalHead,originalReadinessId:p.originalReadinessId,oldReadinessHead:p.oldReadinessHead,oldSupplementId:p.oldSupplementId,expectedHead:p.expectedHead,historicalAuditId:p.historicalAuditId,historicalAuditReceipt:'fde84841af84e80f02dad80e6d1b3c6b8f3f38bab3c54a2e24755723438cbacf',operationId:p.operationId,acceptedHead:p.acceptedHead};
  const make=deps=>new Function(...Object.keys(deps),ownerBody+'\nreturn releaseOwnership;')(...Object.values(deps));
  const file=path.join(temp,'owner-good.json');await fs.writeFile(file,p.canonical(pending.request.expectedActive)+'\n',{flag:'wx'});const result=await make(dependencies)({...pending.request,activePath:file,deadlineUnixMs:Date.now()+1000});assert.deepEqual(result,{released:true});await assert.rejects(fs.lstat(file),e=>e.code==='ENOENT');
  const other=path.join(temp,'owner-cas.json');await fs.writeFile(other,p.canonical(pending.request.expectedActive)+'\n',{flag:'wx'});await assert.rejects(make({...dependencies,readOnlyJournal:async()=>({...pending.state,previous:'0'.repeat(64)})})({...pending.request,activePath:other,deadlineUnixMs:Date.now()+1000}));assert.ok((await fs.lstat(other)).isFile());
});
async function nativeWriter(fault){const root=path.join(temp,fault?'fault':'okay');await fs.mkdir(root);if(fault)await fs.writeFile(path.join(root,'production'),'private fixture file');const args=['-NoProfile','-NonInteractive','-File',path.join(temp,'runner.ps1'),'-Functions',path.join(directory,'producer-functions.ps1'),'-PrivateRoot',root];const child=spawn(ps,args,{cwd:temp,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,PSModulePath:'C:/Windows/System32/WindowsPowerShell/v1.0/Modules'}});const out=[],err=[];child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>err.push(b));const limit=setTimeout(()=>child.kill(),5000);try{const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});assert.equal(exit.code,0,Buffer.concat(err).toString('utf8'));assert.equal(exit.signal,null);const result=JSON.parse(Buffer.concat(out).toString('utf8'));assert.equal(result.processId,child.pid);assert.throws(()=>process.kill(child.pid,0),e=>e.code==='ESRCH');console.log(JSON.stringify({privateWriterLeaf:true,pid:child.pid,exitCode:exit.code,ownPidAbsent:true,writeFault:fault,returned:result.returned,caught:result.caught,noControlMain:true,noHealthHttp:true}));return{root,result};}finally{clearTimeout(limit);}}
test('real PS writer finally creates one flushed bounded trace and never saves synthetic raw fields',async()=>{const {root,result}=await nativeWriter(false);assert.equal(result.returned,'Running');assert.equal(result.caught,false);const dir=path.join(root,'production','health-probe-evidence'),files=await fs.readdir(dir);assert.equal(files.length,1);const raw=await fs.readFile(path.join(dir,files[0]));assert.ok(!raw.toString().includes('PRIVATE_SYNTHETIC'));const v=JSON.parse(raw);assert.equal(v.processId,result.processId);assert.equal(v.functionReturned,true);assert.equal(v.rawBodyPersisted,false);assert.equal(v.rawReasonPersisted,false);assert.equal(producer.safeProducerTrace(v).healthEvidence.probes.ready.timeoutMs,5000);});
test('real PS finally write failure blocks returned Running and creates no fake success trace',async()=>{const {root,result}=await nativeWriter(true);assert.equal(result.returned,null);assert.equal(result.caught,true);assert.ok((await fs.lstat(path.join(root,'production'))).isFile());});
