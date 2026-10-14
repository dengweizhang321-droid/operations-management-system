import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const source='D:/codex-isolated/jackyun-unbound-closure-source-20261014';
const engine='D:/codex-isolated/jackyun-unified-recovery-20261013/tools';
const out='D:/codex-artifacts/jackyun-live-test-20261014/unbound-helper-adoption';
const {withRotationLock,applyApprovedRotationPlan,resolveEffectiveReleaseChain}=await import(pathToFileURL(source+'/tools/worker-local-release-rotation.mjs'));
const {runProcess}=await import(pathToFileURL(engine+'/worker-local-release.mjs'));
const {productionCommandArguments,productionCommandEnvironment,writeOnce}=await import(pathToFileURL(engine+'/release-batch.mjs'));
const {safeFileDigest}=await import(pathToFileURL(engine+'/release-impact.mjs'));
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const exists=async p=>{try{await fs.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const worker='D:\\运营管理系统\\tools\\worker-local-service.ps1';
const shell='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const django='D:/teruisi-runtime/django-sales/app/deployment.json',djangoSha='8b4fed2c3cb8e0206ae8cc492e15f9646ef2dbbd7bbccde2b386fe9770ce02ac';
const runtime='D:/teruisi-runtime/teruisi-worker-sales',drain='D:/teruisi-runtime/django-sales/run/automation-drain.json';
const prepared=await read(out+'/result.json'),plan=await read(out+'/worker-plan.json');
assert.equal(prepared.status,'prepared_not_deployed');assert.equal(prepared.workerPlanSha256,plan.planSha256);
assert.equal(prepared.scope,'verified-unbound-closures-v1-v2-v4');
assert.equal(plan.predecessorReleaseId,'20261013T145450Z-fe391dce49a258cf');
assert.match(plan.candidateReleaseId,/^\d{8}T\d{6}Z-[a-f0-9]{16}$/);
const planFile=out+'/publication-plan.json';
if(process.argv[2]==='plan'){
 assert.equal(await safeFileDigest(django),djangoSha);
 const pins={};for(const f of [worker,shell,source+'/tools/worker-local-release.mjs',source+'/tools/worker-local-release-rotation.mjs'])pins[f]=await safeFileDigest(f);
 await writeOnce(planFile,{version:1,workerPlanSha256:plan.planSha256,maintenanceId:randomUUID().replaceAll('-',''),djangoSha,pins,steps:['BeginWorkerDrain','StopForRelease','applyApprovedRotationPlan','Start RequireReady','VerifyStartup','EndWorkerDrain'],backendStop:false,postgresStop:false,newBackup:false,migration:false});
 console.log(JSON.stringify({status:'plan_ready',candidateReleaseId:plan.candidateReleaseId,planFile}));
}else if(process.argv[2]==='execute'){
 const approval=await read(planFile);assert.equal(approval.workerPlanSha256,plan.planSha256);assert.equal(approval.djangoSha,djangoSha);assert.match(approval.maintenanceId,/^[a-f0-9]{32}$/);
 await withRotationLock(async rotationLease=>{
  assert.equal(await exists(runtime+'/state/release-batches/active.json'),false);assert.equal(await exists(drain),false);
  assert.equal(await exists('D:/teruisi-runtime/django-sales/run/system-maintenance.json'),false);assert.equal(await safeFileDigest(django),djangoSha);
  for(const [f,digest] of Object.entries(approval.pins))assert.equal(await safeFileDigest(f),digest);
  const chain=await resolveEffectiveReleaseChain({verifyInstalledHead:true});assert.equal(chain.head.releaseId,plan.predecessorReleaseId);assert.equal(chain.head.manifestSha256,'51aefd56a68ae84df34e606db2c508092511b1ae24d118fd50cca33333016c6d');
  await writeOnce(out+'/publication-started.json',{at:new Date().toISOString(),approval});
  const run=async(id,args)=>{
   assert.equal(await safeFileDigest(django),djangoSha);assert.equal(await safeFileDigest(worker),approval.pins[worker]);
   await writeOnce(out+'/'+id+'-started.json',{at:new Date().toISOString(),args});
   try{
    const result=await runProcess(shell,productionCommandArguments(shell,['-NoProfile','-NonInteractive','-File',worker,...args]),{cwd:path.dirname(worker),env:productionCommandEnvironment(shell),outputProtocol:'direct-exit-files',cleanup:'preserve',timeoutMs:600000,label:id});
    await writeOnce(out+'/'+id+'-result.json',{at:new Date().toISOString(),processEvidence:result.processEvidence,stdout:result.stdout,stderr:result.stderr});
    console.log(JSON.stringify({step:id,status:'completed'}));return JSON.parse(result.stdout);
   }catch(error){await writeOnce(out+'/'+id+'-failure.json',{at:new Date().toISOString(),error:error.message,processEvidence:error.processEvidence??null});throw error;}
  };
  const entered=await run('begin-worker-drain',['-Action','BeginWorkerDrain','-MaintenanceId',approval.maintenanceId,'-Json']);assert.equal(entered.maintenanceId,approval.maintenanceId);
  await run('stop-for-release',['-Action','StopForRelease','-MaintenanceId',approval.maintenanceId,'-Json']);
  await writeOnce(out+'/apply-started.json',{at:new Date().toISOString(),approvedPlanSha256:plan.planSha256});
  try{const result=await applyApprovedRotationPlan({approvedPlanSha256:plan.planSha256,rotationLease});assert(['activated','already_activated'].includes(result.status));assert.equal(result.planSha256,plan.planSha256);assert.equal(result.releaseId,plan.candidateReleaseId);assert.equal(result.manifestSha256,plan.candidateManifestSha256);await writeOnce(out+'/apply-result.json',{at:new Date().toISOString(),result});console.log(JSON.stringify({step:'apply',status:'completed'}));}
  catch(error){await writeOnce(out+'/apply-failure.json',{at:new Date().toISOString(),error:error.message});throw error;}
  assert.equal(await safeFileDigest(django),djangoSha);
  const started=await run('start-new-worker',['-Action','Start','-BackendStartPolicy','RequireReady','-Json']);assert(['started','already_running'].includes(started.status));assert.equal(started.releaseId,plan.candidateReleaseId);assert.equal(started.manifestSha256,plan.candidateManifestSha256);
  await run('verify-startup',['-Action','VerifyStartup','-Json']);
  const ended=await run('end-worker-drain',['-Action','EndWorkerDrain','-MaintenanceId',approval.maintenanceId,'-Json']);assert.equal(ended.status,'worker_drain_ended');
  assert.equal(await exists(drain),false);assert.equal(await safeFileDigest(django),djangoSha);
  await writeOnce(out+'/publication-result.json',{status:'deployed',at:new Date().toISOString(),candidateReleaseId:plan.candidateReleaseId,candidateManifestSha256:plan.candidateManifestSha256,djangoRetained:djangoSha});
 });
}else throw Error('Use plan or execute');
