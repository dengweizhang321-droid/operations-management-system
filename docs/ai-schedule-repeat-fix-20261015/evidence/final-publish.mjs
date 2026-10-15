import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const source='D:/codex-isolated/ai-schedule-repeat-fix-20261015-v2/source',out='D:/codex-artifacts/ai-schedule-repeat-fix-20261015-v2',runtime='D:/teruisi-runtime/django-sales';
const shell='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const hash=b=>createHash('sha256').update(b).digest('hex'),sha=async f=>hash(await fs.readFile(f)),read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const qraw=await fs.readFile(out+'/publication-request.json');
assert.equal(hash(qraw),process.argv[2]);
const q=JSON.parse(qraw);
assert(!q.executionScripts,'Same-lease request requires the frozen deliver entry');
assert.equal(await sha(new URL(import.meta.url)),q.publishScriptSha256);
assert.equal(await sha(process.execPath),q.nodeExecutableSha256);
assert.equal(await sha(shell),q.shellExecutableSha256);
for(const [name,h] of Object.entries(q.inputFiles))assert.equal(await sha(out+'/'+name),h,name);
const composition=await read(out+'/composition-final.json'),plan=await read(out+'/worker-plan.json'),pkg=await read(out+'/django-prepared.json'),pre=await read(out+'/predecessor-observation.json');
assert.equal(q.sourceCommit,composition.sourceCommit);assert.equal(q.mainCommit,composition.mainCommit);
assert.equal(q.noNewBackupOrRestore,true);assert.equal(q.noMigrationChanges,true);
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8',windowsHide:true}).trim(),q.sourceCommit);
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:source,encoding:'utf8',windowsHide:true}).trim(),'');
for(const [f,h]of Object.entries(composition.files))assert.equal(await sha(source+'/'+f),h,f);
const api=await import(pathToFileURL(source+'/tools/worker-local-release.mjs')),rotation=await import(pathToFileURL(source+'/tools/worker-local-release-rotation.mjs'));
const helper='D:/codex-isolated/market-ai-round2-release-20261015/source';
assert.equal(await sha(source+'/tools/release-batch.mjs'),await sha(helper+'/tools/release-batch.mjs'));
const {productionCommandEnvironment,productionCommandArguments,writeOnce}=await import(pathToFileURL(helper+'/tools/release-batch.mjs'));
const host=await read('D:/codex-artifacts/ordinary-user-controls-20261014/HOST_PLAN.json');
assert.equal(await sha(path.join(host.target,'pwsh.exe')),host.pwshSha256);process.env.PATH=host.target+';'+(process.env.PATH??process.env.Path??'');
const role=await api.runProcess(shell,['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],{timeoutMs:30000,label:'repeat-fix-ordinary-token'});assert.equal(role.stdout.trim(),'False');
async function run(label,script,args,check,json=true){
 assert.equal(await sha(script),q.stageScripts[label],label+' script drift');
 const full=['-NoProfile','-NonInteractive','-File',script,...args];
 await writeOnce(out+'/'+label+'-started.json',{at:new Date().toISOString(),scriptSha256:await sha(script),args:full});
 try{
  const result=await api.runProcess(shell,productionCommandArguments(shell,full),{cwd:source,env:productionCommandEnvironment(shell),timeoutMs:1200000,outputProtocol:'direct-exit-files',cleanup:'preserve',label:'repeat-fix-'+label});
  await fs.writeFile(out+'/'+label+'.stdout.log',result.stdout,{flag:'wx'});await fs.writeFile(out+'/'+label+'.stderr.log',result.stderr,{flag:'wx'});
  const value=json?JSON.parse(result.stdout.trim()):{completed:true};
  await check(value);await writeOnce(out+'/'+label+'-returned.json',{at:new Date().toISOString(),value,processEvidence:result.processEvidence});return value;
 }catch(error){await writeOnce(out+'/'+label+'-unknown.json',{at:new Date().toISOString(),name:error.name,code:error.code??null,message:String(error.message).slice(0,500),processEvidence:error.processEvidence??null});throw error;}
}
const worker='D:/运营管理系统/tools/worker-local-service.ps1';
await rotation.withRotationLock(async rotationLease=>{
 await rotation.assertActiveBatchOwnership(api.workerRuntimeRoot);
 const chain=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});
 assert.deepEqual(chain.head,pre.workerHead);assert.equal(chain.chainStateSha256,pre.chainStateSha256);
 assert.equal(await sha(runtime+'/app/deployment.json'),pre.djangoManifestSha256);
 assert.equal(await sha(runtime+'/app.prepare-'+pkg.id+'.json'),pkg.receiptSha256);
 assert.equal(await sha(runtime+'/app.deploy-'+pkg.id+'/deployment.json'),pkg.manifestSha256);
 for(const entry of pre.guardEntries)assert.equal(await sha('D:/运营管理系统/'+entry.path),entry.expected);
 await writeOnce(out+'/PUBLICATION_STARTED.json',{at:new Date().toISOString(),requestSha256:process.argv[2],sourceCommit:q.sourceCommit,mainCommit:q.mainCommit,maintenanceId:q.maintenanceId,noNewBackupOrRestore:true});
 await run('EnterMaintenance',worker,['-Action','EnterMaintenance','-MaintenanceId',q.maintenanceId,'-KeepPostgres','-Json'],v=>{assert.equal(v.status,'maintenance');assert.equal(v.maintenanceId,q.maintenanceId);assert.equal(v.postgresPreserved,true);});
 await run('Stop',worker,['-Action','Stop','-Json'],v=>assert(['stopped','already_stopped','stale_receipt_cleared'].includes(v.status)));
 await run('DeployApp',source+'/tools/django-local-service.ps1',['-Action','DeployApp','-PreparedAppId',pkg.id,'-PreparedAppSha256',pkg.receiptSha256,'-Json'],async()=>assert.equal(await sha(runtime+'/app/deployment.json'),pkg.manifestSha256),false);
 await run('HardenAcl',runtime+'/app/tools/django-local-service.ps1',['-Action','HardenAcl','-Json'],()=>{},false);
 await writeOnce(out+'/WorkerApply-started.json',{at:new Date().toISOString(),workerPlanSha256:plan.planSha256});
 try{const result=await rotation.applyApprovedRotationPlan({approvedPlanSha256:plan.planSha256,rotationLease});await writeOnce(out+'/WorkerApply-returned.json',result);}catch(error){await writeOnce(out+'/WorkerApply-unknown.json',{at:new Date().toISOString(),name:error.name,message:String(error.message).slice(0,500)});throw error;}
 await run('ExitMaintenance',worker,['-Action','ExitMaintenance','-MaintenanceId',q.maintenanceId,'-Json'],v=>assert.equal(v.status,'maintenance_ended'));
 await run('Start',worker,['-Action','Start','-Json'],v=>{assert(['started','already_running'].includes(v.status));assert.equal(v.manifestSha256,plan.candidateManifestSha256);});
 await run('VerifyStartup',worker,['-Action','VerifyStartup','-Json'],v=>assert.equal(v.startupVerified,true));
 const effective=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});assert.equal(effective.head.releaseId,plan.candidateReleaseId);
 assert.equal(await sha(runtime+'/app/deployment.json'),pkg.manifestSha256);
 const home=await fetch('http://127.0.0.1:3000/',{signal:AbortSignal.timeout(30000)});assert.equal(home.status,200);
 await writeOnce(out+'/PUBLICATION_RESULT.json',{at:new Date().toISOString(),status:'deployed',sourceCommit:q.sourceCommit,mainCommit:q.mainCommit,worker:plan.candidateReleaseId,workerManifestSha256:plan.candidateManifestSha256,djangoManifestSha256:pkg.manifestSha256,maintenanceId:q.maintenanceId,homepageHttpStatus:200,startupVerified:true,noNewBackupOrRestore:true,noMigrationChanges:true,noManualModelProbeOrDelivery:true});
 console.log(JSON.stringify({status:'deployed',worker:plan.candidateReleaseId,django:pkg.id}));
});
