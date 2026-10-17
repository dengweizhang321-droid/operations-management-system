import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {firstMaintenancePredecessor as k,assertFirstMaintenanceContinuation,continueFirstMaintenance,isFirstMaintenancePredecessor} from '../tools/manual-maintenance-continuation.mjs';
import {publishPreparedMain} from '../tools/publish-prepared-main.mjs';
// Execute the actual pure adapter declaration without importing release-impact's
// TypeScript-dependent deployment analysis into this dependency-free fixture.
async function loadProductionCommandArguments(){
 const actual=(await fs.readFile(new URL('../tools/release-batch.mjs',import.meta.url),'utf8')).match(/export function productionCommandArguments\(executable, args\) \{[\s\S]*?\n\}/)?.[0];
 const canonical=(await fs.readFile(new URL('../tools/release-impact.mjs',import.meta.url),'utf8')).match(/export function canonical\(value\) \{[\s\S]*?\n\}/)?.[0];
 assert.ok(actual&&canonical,'Actual pure adapter declarations must remain available');
 return new Function('path',canonical.replace('export ','')+'\n'+actual.replace('export ','')+'\nreturn productionCommandArguments;')(path);
}
const execute=promisify(execFile),id='a'.repeat(32),hash='b'.repeat(64);
const expected={maintenanceId:id,requestSha256:hash,startedSha256:hash,admissionSha256:hash,originalFailureSha256:hash};
function snapshot(){return {version:'manual-maintenance-continuation-v1',...k,...expected,sourceBound:true,rotationOwnerBound:true,originalActorBound:true,originalActorExited:true,controlParticipants:[],fullNativeStopScopeVerified:true,workerStatus:{state:'stopped',releaseId:k.releaseId,manifestSha256:k.workerManifestSha256},workerReceiptAbsent:true,applicationProcesses:[],postgresPreservedReady:true,downstreamEffects:[],maintenance:{version:'teruisi-system-maintenance-v1',id,runtimeRoot:'D:\\teruisi-runtime\\django-sales',keepPostgres:true},drain:{version:'teruisi-automation-drain-v1',id,runtimeRoot:'D:\\teruisi-runtime\\django-sales',keepPostgres:true,phase:'requests'},pandasConfigured:true,pandas:{distribution:'TERUISI-Pandas',user:'teruisi-pandas',unit:'teruisi-pandas.service',activeState:'inactive',subState:'dead',mainPid:0,controlPid:0,containers:[]},durableCompleteCommit:false};}
test('finite old pair only; native Stop exit0 is not a precondition or inferred claim',()=>{
 assert.equal(isFirstMaintenancePredecessor({releaseId:k.releaseId,manifestSha256:k.workerManifestSha256},k.djangoManifestSha256),true);
 assert.equal(isFirstMaintenancePredecessor({releaseId:k.releaseId,manifestSha256:hash},k.djangoManifestSha256),false);
 const value=snapshot();assert.equal(assertFirstMaintenanceContinuation(value,expected),'enter-same-id-once');
 assert.equal(value.originalStopExitCode,undefined);
 value.maintenance.drainedStopped=true;assert.throws(()=>assertFirstMaintenanceContinuation(value,expected));
 value.durableCompleteCommit=true;assert.equal(assertFirstMaintenanceContinuation(value,expected),'coordinate-completed');
});
const failures={
 'wrong maintenance ID':s=>s.maintenance.id='c'.repeat(32),
 'coerced maintenance keepPG':s=>s.maintenance.keepPostgres='true',
 'maintenance array':s=>s.maintenance=[s.maintenance],
 'wrong native runtime root':s=>s.drain.runtimeRoot='D:\\private',
 'wrong request phase':s=>s.drain.phase='helpers',
 'coerced drainedStopped':s=>s.maintenance.drainedStopped=1,
 'source bytes changed':s=>s.sourceBound=false,
 'request drift':s=>s.requestSha256='d'.repeat(64),
 'rotation owner changed':s=>s.rotationOwnerBound=false,
 'no pre-bound actor':s=>s.originalActorBound=false,
 'original actor still alive':s=>s.originalActorExited=false,
 'late Report participant':s=>s.controlParticipants=[{action:'Report'}],
 'only vacant Windows ports':s=>s.fullNativeStopScopeVerified=false,
 'partial stopped services':s=>s.applicationProcesses=[{service:'ai-reader'}],
 'Worker supervisor receipt remains':s=>s.workerReceiptAbsent=false,
 'ambiguous native Worker state':s=>s.workerStatus.state='foreign_or_ambiguous',
 'owned PostgreSQL unknown':s=>s.postgresPreservedReady=false,
 'Linux observation unavailable':s=>s.pandas=null,
 'Linux service active':s=>s.pandas.activeState='active',
 'Linux containers unresolved':s=>s.pandas.containers=['container'],
 'wrong Linux user':s=>s.pandas.user='root',
 'unknown Pandas configuration':s=>delete s.pandasConfigured,
 'downstream deployment possible':s=>s.downstreamEffects=['DeployApp'],
 'old Django bytes changed':s=>s.djangoScriptSha256=hash,
 'completion evidence contradicts current state':s=>s.durableCompleteCommit=true
};
for(const [name,change] of Object.entries(failures))test(name+' fails closed',()=>{const value=snapshot();change(value);assert.throws(()=>assertFirstMaintenanceContinuation(value,expected));});
test('no Linux requirement is added when the original Stop has no configured Pandas',()=>{const value=snapshot();value.pandasConfigured=false;value.pandas=null;assert.equal(assertFirstMaintenanceContinuation(value,expected),'enter-same-id-once');});
for(const completed of [false,true])test('one in-call continuation '+(completed?'coordinates durable commit':'calls same-ID once')+'; no build/migrate/publisher seam',async()=>{
 const calls=[],value=snapshot();value.maintenance.drainedStopped=completed;value.durableCompleteCommit=completed;
 const result=await continueFirstMaintenance({admission:{...expected,source:'D:/private-source'},admissionPath:'D:/private-attempt/admission.json',admissionSha256:hash,originalFailureSha256:hash,recheck:async()=>calls.push('recheck'),step:async(label,script,action,extra)=>{
  calls.push(action);assert.equal(path.basename(script),'manual-maintenance-continuation.ps1');assert.ok(extra.includes(hash));
  return action==='Check'?value:{status:'maintenance',maintenanceId:id,postgresPreserved:true,continuationDecision:completed?'coordinate-completed':'enter-same-id-once',before:value};
 }});
 assert.equal(result.status,'maintenance');assert.deepEqual(calls,['recheck','Check','recheck','EnterMaintenance']);
});
test('bad fresh proof cannot reach continuation Enter; second failure is not retried',async()=>{
 const value=snapshot();value.originalActorExited=false;let calls=0;
 const options={admission:{...expected,source:'D:/private-source'},admissionPath:'D:/private-attempt/admission.json',admissionSha256:hash,originalFailureSha256:hash,recheck:async()=>{},step:async()=>{calls++;return value;}};
 await assert.rejects(continueFirstMaintenance(options));assert.equal(calls,1);
 value.originalActorExited=true;calls=0;options.step=async(label,script,action)=>{calls++;if(action==='Check')return value;throw Error('still locked');};
 await assert.rejects(continueFirstMaintenance(options),/still locked/);assert.equal(calls,2);
});

async function publisherFixture(t,negative=false){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'maintenance-private-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const source=path.join(root,'source'),out=path.join(root,'attempt'),runtime=path.join(root,'worker'),installed=path.join(root,'django/app');
 const head={releaseId:k.releaseId,manifestSha256:k.workerManifestSha256};let django=k.djangoManifestSha256;const events=[];
 const request={mainCommit:'a'.repeat(40),components:['django'],predecessorWorker:head,predecessorDjangoSha256:django};
 let admission;
 const context={source,out,installedRoot:installed,workerRuntimeRoot:runtime,sourceIdentity:async()=>({commit:request.mainCommit,tree:'c'.repeat(40)}),sha:async file=>file===path.join(installed,'deployment.json')?django:file.endsWith('django-local-service.ps1')?k.djangoScriptSha256:file.endsWith('worker-local-service.ps1')?k.workerScriptSha256:hash,api:{workerRuntimeRoot:runtime},rotation:{withRotationLock:async fn=>fn({}),assertActiveBatchOwnership:async()=>{},resolveEffectiveReleaseChain:async()=>({head,chainStateSha256:hash})},fetch:async()=>new Response(JSON.stringify({ok:true,status:'ready'})),runStep:async args=>{
  events.push(args.action);
  if(args.action==='PrepareApp')return {id:'d'.repeat(32),receiptSha256:hash};
  if(args.action==='EnterMaintenance'&&path.basename(args.script)==='manual-maintenance-start.ps1'){
   admission=JSON.parse(await fs.readFile(args.extra[1],'utf8'));
   await fs.writeFile(path.join(out,'maintenance-first-actor.json'),'{}');throw Error('original mutex contention');
  }
  if(path.basename(args.script)==='manual-maintenance-continuation.ps1'){
   const proof={...snapshot(),maintenanceId:admission.maintenanceId,maintenance:{...snapshot().maintenance,id:admission.maintenanceId},drain:{...snapshot().drain,id:admission.maintenanceId},requestSha256:admission.requestSha256,startedSha256:admission.startedSha256,admissionSha256:hash,originalFailureSha256:hash};
   if(negative)proof.controlParticipants=[{action:'Report'}];
   return args.action==='Check'?proof:{status:'maintenance',maintenanceId:admission.maintenanceId,postgresPreserved:true,continuationDecision:'enter-same-id-once',before:proof};
  }
  if(args.action==='DeployApp')django=hash;
  if(args.action==='ExitMaintenance')return {status:'maintenance_ended',maintenanceId:args.extra[1]};
  if(args.action==='Start')return {status:'started',manifestSha256:k.workerManifestSha256};
  if(args.action==='VerifyStartup')return {startupVerified:true};return {};
 }};
 return {request,context,out,events};
}
test('publisher preserves original failure, then advances only after finite proof and native continuation',async t=>{
 const f=await publisherFixture(t);const result=await publishPreparedMain(f.request,f.context);
 assert.equal(result.status,'deployed_and_ready');assert.deepEqual(f.events,['PrepareApp','EnterMaintenance','Check','EnterMaintenance','Stop','DeployApp','HardenAcl','ExitMaintenance','Start','VerifyStartup']);
 const failed=JSON.parse(await fs.readFile(path.join(f.out,'maintenance-first-FAILED.json'),'utf8'));assert.equal(failed.error,'original mutex contention');assert.equal(failed.automaticRetry,false);
 assert.equal(await fs.readFile(path.join(f.out,'maintenance-first-actor.json'),'utf8'),'{}');
});
test('publisher late-actor rejection preserves unknown STARTED and cannot re-enter on another invocation',async t=>{
 const f=await publisherFixture(t,true);await assert.rejects(publishPreparedMain(f.request,f.context),/控制参与者/);
 assert.deepEqual(f.events,['PrepareApp','EnterMaintenance','Check']);const failed=await fs.readFile(path.join(f.out,'maintenance-first-FAILED.json'),'utf8');
 await assert.rejects(publishPreparedMain(f.request,f.context),/结果未知/);assert.equal(await fs.readFile(path.join(f.out,'maintenance-first-FAILED.json'),'utf8'),failed);
 await assert.rejects(fs.access(path.join(f.out,'SUCCESS.json')));
});
if(process.platform==='win32')test('the exact old manifest pins an existing original Worker process transport',async()=>{
 const release=path.join('D:/teruisi-runtime/teruisi-worker-sales/releases',k.releaseId);
 const manifestRaw=await fs.readFile(path.join(release,'deployment-manifest.json'));
 assert.equal(createHash('sha256').update(manifestRaw).digest('hex'),k.workerManifestSha256);
 const matches=JSON.parse(manifestRaw).artifacts.keyFiles.filter(f=>f.relativePath==='tools/process-deadline.ps1');assert.equal(matches.length,1);assert.equal(matches[0].sha256,k.workerTransportSha256);
 const transport=path.join(release,matches[0].relativePath);assert.ok((await fs.stat(transport)).isFile());
 assert.equal(createHash('sha256').update(await fs.readFile(transport)).digest('hex'),k.workerTransportSha256);
});
if(process.platform==='win32')for(const host of ['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','pwsh.exe'])test(host+' production assertions reject actual transport bootstraps on private process objects',async t=>{
 const transport=path.join('D:/teruisi-runtime/teruisi-worker-sales/releases',k.releaseId,'tools/process-deadline.ps1');
 const fixtureRoot=await fs.mkdtemp(path.join(os.tmpdir(),'maintenance-encoded-report-'));t.after(()=>fs.rm(fixtureRoot,{recursive:true,force:true}));
 const productionCommandArguments=await loadProductionCommandArguments();
 const systemHost='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',file='C:\\private-fixture\\django\\app\\tools\\django-local-service.ps1';
 const argv=productionCommandArguments(systemHost,['-NoProfile','-NonInteractive','-File',file,'-Action','Report','-RuntimeRoot','C:\\private-fixture\\django','-Json']);
 assert.equal(argv[2],'-EncodedCommand');
 const bootstrap=Buffer.from(argv[3],'base64').toString('utf16le');assert.ok(!bootstrap.includes(file)&&!bootstrap.includes('Report'),'fixture must retain the real inner JSON payload');
 const payload=JSON.parse(Buffer.from(bootstrap.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)[1],'base64').toString('utf8'));assert.equal(payload.file,file);assert.equal(payload.parameters.Action,'Report');
 const commandFile=path.join(fixtureRoot,'real-adapter-report.json');await fs.writeFile(commandFile,JSON.stringify({commandLine:systemHost+' '+argv.join(' ')}));
 const {stdout}=await execute(host,['-NoProfile','-NonInteractive','-File',path.resolve('tests/manual-maintenance-continuation.fixture.ps1'),'-SourceFile',path.resolve('tools/manual-maintenance-continuation.ps1'),'-TransportFile',transport,'-AdapterCommandPath',commandFile],{windowsHide:true,timeout:30000});assert.match(stdout,/PRIVATE_FIXTURES_PASSED/);assert.match(stdout,/REJECTED_REAL_ADAPTER_ENCODED_REPORT/);assert.match(stdout,/REJECTED_REAL_NATIVE_TRANSPORT_ENCODED_REPORT/);
});
