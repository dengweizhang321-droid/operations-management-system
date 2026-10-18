import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {piMaintenancePredecessor as k,maintenanceSourceNames,maintenanceReadiness,assertPiMaintenanceContinuation,continuePiMaintenance} from '../tools/manual-maintenance-continuation.mjs';
import {publishPreparedMain} from '../tools/publish-prepared-main.mjs';
import {productionCommandArguments,productionCommandEnvironment} from '../tools/release-batch.mjs';
const id='a'.repeat(32),h='b'.repeat(64),expected={maintenanceId:id,requestSha256:h,startedSha256:h,admissionSha256:h,originalFailureSha256:h};
const record=version=>({version,id,runtimeRoot:'D:\\teruisi-runtime\\django-sales',keepPostgres:true});
function snapshot(){return {version:'manual-maintenance-pi-continuation-v1',at:new Date().toISOString(),...k,...expected,sourceBound:true,rotationOwnerBound:true,originalActorBound:true,originalActorExited:true,piStopBound:true,piWorkerAbsent:true,piStopBinding:{controlSha256:h,ackSha256:h},workerReceiptAbsent:true,postgresPreservedReady:true,nativeStopIdentityGatePreserved:true,controlParticipants:[],downstreamEffects:[],maintenance:record('teruisi-system-maintenance-v1'),drain:{...record('teruisi-automation-drain-v1'),phase:'requests'},fullNativeStopScopeVerified:false};}
test('Pi finite continuation accepts partial native scope only after token stop and absence; completed needs full stop proof',()=>{
 const s=snapshot();assert.equal(assertPiMaintenanceContinuation(s,expected),'enter-same-id-once');
 s.maintenance.drainedStopped=true;assert.throws(()=>assertPiMaintenanceContinuation(s,expected));
 s.fullNativeStopScopeVerified=true;s.durableCompleteCommit=true;assert.equal(assertPiMaintenanceContinuation(s,expected),'coordinate-completed');
});
for(const [label,mutate] of Object.entries({
 'wrong predecessor':s=>s.djangoAiScriptSha256=h,'actor alive':s=>s.originalActorExited=false,'owner not bound':s=>s.rotationOwnerBound=false,
 'Pi absence unknown':s=>s.piWorkerAbsent=false,'Pi ack wrong':s=>s.piStopBound=false,'downstream':s=>s.downstreamEffects=['DeployApp'],
 'late actor':s=>s.controlParticipants=[1],'wrong ID':s=>s.maintenance.id='c'.repeat(32),'wrong phase':s=>s.drain.phase='helpers',
 'coerced keep PG':s=>s.maintenance.keepPostgres='true','stale observer':s=>s.at=new Date(Date.now()-121000).toISOString(),
 'future observer':s=>s.at=new Date(Date.now()+10000).toISOString(),'request drift':s=>s.requestSha256='c'.repeat(64),
}))test(label+' refuses continuation',()=>{const s=snapshot();mutate(s);assert.throws(()=>assertPiMaintenanceContinuation(s,expected));});
for(const completed of [false,true])test('independent observation binds one continuation: '+completed,async()=>{
 const calls=[],s=snapshot();if(completed){s.maintenance.drainedStopped=true;s.fullNativeStopScopeVerified=true;s.durableCompleteCommit=true;}
 const admission={...expected,source:'D:/private/source',attempt:'D:/private/attempt'};
 const result=await continuePiMaintenance({admission,admissionPath:'D:/private/attempt/admission.json',admissionSha256:h,originalFailureSha256:h,recheck:async()=>calls.push('recheck'),step:async(label,script,action,args)=>{
  calls.push(action);assert.ok(args.includes('pi19db'));
  if(action==='Check')return {snapshot:s,observationPath:'D:/private/attempt/maintenance-pi-observation-'+id+'.json',observationSha256:h};
  assert.ok(args.includes('-ObservationSha256'));return {status:'maintenance',maintenanceId:id,postgresPreserved:true,observationSha256:h,continuationDecision:completed?'coordinate-completed':'enter-same-id-once',before:s};
 }});assert.equal(result.status,'maintenance');assert.deepEqual(calls,['recheck','Check','recheck','EnterMaintenance']);
});
test('unknown independent observation cannot call Enter; failed one continuation never retries',async()=>{
 const admission={...expected,source:'D:/private/source',attempt:'D:/private/attempt'},s=snapshot();let calls=0;
 const options={admission,admissionPath:'D:/private/attempt/admission.json',admissionSha256:h,originalFailureSha256:h,recheck:async()=>{},step:async()=>{calls++;s.piStopBound=false;return {snapshot:s};}};
 await assert.rejects(continuePiMaintenance(options));assert.equal(calls,1);
 s.piStopBound=true;calls=0;options.step=async(label,script,action)=>{calls++;if(action==='Check')return {snapshot:s,observationPath:'D:/private/attempt/maintenance-pi-observation-'+id+'.json',observationSha256:h};throw Error('still unknown');};
 await assert.rejects(continuePiMaintenance(options),/still unknown/);assert.equal(calls,2);
});
test('static readiness binds actual predecessor and existing recovery tools before STARTED',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pi-readiness-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const installed=path.join(root,'django/app'),source=path.join(root,'source'),runtime=path.join(root,'worker');await fs.mkdir(path.join(root,'django/run'),{recursive:true});
 const pi={version:2,service:'django-ai-pi-worker',processId:123,creationDate:new Date().toISOString(),executablePath:'C:/private/python.exe',commandLine:'private worker',arguments:['--control-token',id]};
 await fs.writeFile(path.join(root,'django/run/django-ai-pi-worker.pid.json'),JSON.stringify(pi));
 const pins={'deployment.json':k.djangoManifestSha256,'deployment-manifest.json':k.workerManifestSha256,'worker-local-service.ps1':k.workerScriptSha256,'django-local-service.ps1':k.djangoScriptSha256,'django-ai.ps1':k.djangoAiScriptSha256,'process-deadline.ps1':k.workerTransportSha256};
 const pidSha=createHash('sha256').update(JSON.stringify(pi)).digest('hex');
 const options={source,installed,runtime,head:{releaseId:k.releaseId,manifestSha256:k.workerManifestSha256},djangoManifestSha256:k.djangoManifestSha256,sha:async file=>file.endsWith('.pid.json')?pidSha:pins[path.basename(file)]??h};
 const result=await maintenanceReadiness(options);assert.equal(result.route,'pi19db');assert.deepEqual(result.piWorkerIdentity,pi);assert.equal(Object.keys(result.sourcePins).length,maintenanceSourceNames.length);
 options.sha=async file=>path.basename(file)==='django-ai.ps1'?'c'.repeat(64):file.endsWith('.pid.json')?pidSha:pins[path.basename(file)]??h;
 await assert.rejects(maintenanceReadiness(options));
});
test('readiness rejection leaves no STARTED and cannot enter maintenance',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pi-prestart-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const out=path.join(root,'attempt');
 const head={releaseId:'private',manifestSha256:h};let calls=0;
 const request={mainCommit:'a'.repeat(40),components:['django'],predecessorWorker:head,predecessorDjangoSha256:h};
 await assert.rejects(publishPreparedMain(request,{source:root,out,installedRoot:path.join(root,'app'),workerRuntimeRoot:path.join(root,'worker'),deployOnly:false,sourceIdentity:async()=>({commit:request.mainCommit,tree:'b'.repeat(40)}),sha:async()=>h,api:{workerRuntimeRoot:path.join(root,'worker')},rotation:{withRotationLock:async f=>f({}),assertActiveBatchOwnership:async()=>{},resolveEffectiveReleaseChain:async()=>({head})},runStep:async({action})=>{calls++;assert.equal(action,'PrepareApp');return {id,receiptSha256:h};},maintenanceReadiness:async()=>{throw Error('predecessor recovery missing');}}),/predecessor recovery missing/);
 assert.equal(calls,1);await assert.rejects(fs.access(path.join(out,'STARTED.json')));await assert.rejects(fs.access(path.join(out,'maintenance-admission.json')));
});
for(const unknown of [false,true])test('publisher keeps original 19db attempt and uses its finite in-call branch: '+unknown,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pi-publisher-route-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const out=path.join(root,'attempt'),installed=path.join(root,'app'),runtime=path.join(root,'worker'),head={releaseId:k.releaseId,manifestSha256:k.workerManifestSha256};let django=k.djangoManifestSha256,admission;const events=[];
 const request={mainCommit:'a'.repeat(40),components:['django'],predecessorWorker:head,predecessorDjangoSha256:django};
 const sourcePins=Object.fromEntries(['manual-maintenance-start.ps1','manual-maintenance-lock.psm1','manual-maintenance-continuation.ps1','manual-maintenance-continuation.mjs','publish-prepared-main.mjs','publish-main-command.mjs'].map(name=>[name,h]));
 const context={source:root,out,installedRoot:installed,workerRuntimeRoot:runtime,deployOnly:false,sourceIdentity:async()=>({commit:request.mainCommit,tree:'b'.repeat(40)}),sha:async file=>file===path.join(installed,'deployment.json')?django:h,api:{workerRuntimeRoot:runtime},rotation:{withRotationLock:async f=>f({}),assertActiveBatchOwnership:async()=>{},resolveEffectiveReleaseChain:async()=>({head,chainStateSha256:h})},maintenanceReadiness:async()=>({route:'pi19db',sourcePins,piWorkerReceiptSha256:h,piWorkerIdentity:{private:true},piConfigurationSha256:h}),fetch:async()=>new Response(JSON.stringify({ok:true,status:'ready'})),runStep:async({action,script,extra})=>{
  events.push(action);
  if(path.basename(script)==='manual-maintenance-preflight.ps1'){events.pop();return {ready:true,route:'pi19db'};}
  if(action==='PrepareApp')return {id,receiptSha256:h};
  if(action==='EnterMaintenance'&&path.basename(script)==='manual-maintenance-start.ps1'){admission=JSON.parse(await fs.readFile(extra[1],'utf8'));assert.equal(admission.readinessRoute,'pi19db');throw Error('original Pi metadata unknown');}
  if(path.basename(script)==='manual-maintenance-continuation.ps1'){
   const s={...snapshot(),maintenanceId:admission.maintenanceId,maintenance:{...record('teruisi-system-maintenance-v1'),id:admission.maintenanceId},drain:{...record('teruisi-automation-drain-v1'),id:admission.maintenanceId,phase:'requests'},requestSha256:admission.requestSha256,startedSha256:h};
   if(unknown)s.piWorkerAbsent=false;
   if(action==='Check')return {snapshot:s,observationPath:path.join(out,'maintenance-pi-observation-'+id+'.json'),observationSha256:h};
   return {status:'maintenance',maintenanceId:admission.maintenanceId,postgresPreserved:true,observationSha256:h,continuationDecision:'enter-same-id-once',before:s};
  }
  if(action==='DeployApp')django=h;
  if(action==='ExitMaintenance')return {status:'maintenance_ended',maintenanceId:extra[1]};
  if(action==='Start')return {status:'started',manifestSha256:k.workerManifestSha256};
  if(action==='VerifyStartup')return {startupVerified:true};return {};
 }};
 if(unknown){await assert.rejects(publishPreparedMain(request,context),/piWorkerAbsent/);assert.deepEqual(events,['PrepareApp','EnterMaintenance','Check']);const original=await fs.readFile(path.join(out,'maintenance-first-FAILED.json'));await assert.rejects(publishPreparedMain(request,context),/结果未知/);assert.deepEqual(await fs.readFile(path.join(out,'maintenance-first-FAILED.json')),original);}
 else{assert.equal((await publishPreparedMain(request,context)).status,'deployed_and_ready');assert.deepEqual(events,['PrepareApp','EnterMaintenance','Check','EnterMaintenance','Stop','DeployApp','HardenAcl','ExitMaintenance','Start','VerifyStartup']);assert.equal(JSON.parse(await fs.readFile(path.join(out,'maintenance-first-FAILED.json'),'utf8')).error,'original Pi metadata unknown');}
});
for(const host of ['powershell.exe','pwsh.exe'])test(host+' actual CLI accepts finite route and observer arguments before any side-effect boundary',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pi-native-params-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.resolve('tools/manual-maintenance-continuation.ps1');
 // The first executable boundary hashes InputPath before module import, mutex
 // acquisition or any runtime read. Its private missing file fails closed.
 const executable=host==='powershell.exe'?'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe':host;
 const parameters=['-NoProfile','-NonInteractive','-File',file,'-Action','EnterMaintenance','-InputPath',path.join(root,'input.json'),'-InputSha256',h,'-OriginalFailureSha256',h,'-Route','pi19db','-ObservationPath',path.join(root,'observation.json'),'-ObservationSha256',h,'-Json'];
 let run;try{execFileSync(executable,productionCommandArguments(executable,parameters),{env:productionCommandEnvironment(executable),windowsHide:true,stdio:'pipe'});}catch(error){run=error;}
 assert.equal(run?.status,1,run?.stderr?.toString());assert.match(run.stderr.toString(),/input\.json/);assert.doesNotMatch(run.stderr.toString(),/parameter.*Route|parameter.*Observation/);assert.deepEqual(await fs.readdir(root),[]);
});
for(const host of ['powershell.exe','pwsh.exe'])test(host+' exact native validators reject late native control grandchildren and unbound Pi stop',()=>{
 const env=host==='powershell.exe'?{...process.env,PSModulePath:path.join(process.env.SYSTEMROOT??process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules')}:process.env;
 const result=execFileSync(host,['-NoProfile','-NonInteractive','-File',path.resolve('tests/manual-maintenance-pi.fixture.ps1')],{env,encoding:'utf8',windowsHide:true});assert.match(result,/PI_CONTINUATION_NATIVE_ASSERTIONS_PASSED/);
});
