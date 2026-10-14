import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const engine='D:/codex-isolated/jackyun-unified-recovery-20261013/tools';
for(const name of ['release-batch.mjs','release-impact.mjs','worker-local-release.mjs','worker-local-release-rotation.mjs'])assert.deepEqual(await fs.readFile(engine+'/'+name),await fs.readFile(path.resolve(import.meta.dirname,'../../tools',name)),'Reusable operator differs');
const {withRotationLock}=await import(pathToFileURL(engine+'/worker-local-release-rotation.mjs'));
const {runProcess}=await import(pathToFileURL(engine+'/worker-local-release.mjs'));
const {productionCommandArguments,productionCommandEnvironment,writeOnce}=await import(pathToFileURL(engine+'/release-batch.mjs'));
const {safeFileDigest}=await import(pathToFileURL(engine+'/release-impact.mjs'));
const out='D:/codex-artifacts/jackyun-live-test-20261014';
const worker='D:\\运营管理系统\\tools\\worker-local-service.ps1';
const source='D:\\codex-isolated\\jackyun-live-adoption-source-20261014';
const root='D:\\teruisi-runtime\\django-sales';
const deployment=root+'\\app\\deployment.json';
const shell='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const before='4fb134f17cd22018045b87a2852ea874d5d9f3e3c36900a3e8750dc0e572e321';
const after='8b4fed2c3cb8e0206ae8cc492e15f9646ef2dbbd7bbccde2b386fe9770ce02ac';
const preparedId='2eac13dfda7e4938a87a7acf71f0af72';
const preparedSha='27ceef8d092c6fdb976eee0d4d0f08c4bd244c26b5021e26a07fc1cdf7fcebea';
const exists=async p=>{try{await fs.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const scope=JSON.parse(await fs.readFile(out+'/backend-release-scope.json','utf8'));
assert.equal(scope.planSha256,'0ac56b73b222e33f90f933f171d02ddfb00a4bd6a692d287e1c76d489d865e2b');
assert.deepEqual(scope.components,['django']);assert.equal(scope.migrate,false);
const planPath=out+'/backend-publication-plan.json';
if(process.argv[2]==='plan'){
 assert.equal(await safeFileDigest(deployment),before);
 assert.equal(await safeFileDigest(root+'\\app.prepare-'+preparedId+'.json'),preparedSha);
 const pins={};for(const p of [worker,source+'\\tools\\django-local-service.ps1',shell])pins[p]=await safeFileDigest(p);
 await writeOnce(planPath,{version:1,maintenanceId:randomUUID().replaceAll('-',''),before,after,preparedId,preparedSha,pins,scopeSha256:scope.planSha256,steps:['EnterMaintenance KeepPostgres','DeployApp exact prepared receipt','HardenAcl installed','ExitMaintenance same ID','Start original Worker','VerifyStartup'],newBackup:false,newMigration:false});
 console.log(JSON.stringify({status:'plan_ready',planPath}));
}else if(process.argv[2]==='execute'){
 const plan=JSON.parse(await fs.readFile(planPath,'utf8'));assert.equal(plan.before,before);assert.equal(plan.after,after);assert.equal(plan.preparedSha,preparedSha);assert.match(plan.maintenanceId,/^[a-f0-9]{32}$/);
 await withRotationLock(async()=>{
  assert.equal(await exists('D:/teruisi-runtime/teruisi-worker-sales/state/release-batches/active.json'),false,'Original batch must close first');
  assert.equal(await exists(root+'\\run\\system-maintenance.json'),false);assert.equal(await exists(root+'\\run\\automation-drain.json'),false);
  assert.equal(await safeFileDigest(deployment),before);assert.equal(await safeFileDigest(root+'\\app.prepare-'+preparedId+'.json'),preparedSha);
  for(const [file,digest] of Object.entries(plan.pins))assert.equal(await safeFileDigest(file),digest);
  await writeOnce(out+'/backend-publication-started.json',{at:new Date().toISOString(),plan});
  const run=async(id,script,args,expectedManifest)=>{
   if(expectedManifest)assert.equal(await safeFileDigest(deployment),expectedManifest);
   if(plan.pins[script])assert.equal(await safeFileDigest(script),plan.pins[script]);
   await writeOnce(out+'/'+id+'-started.json',{at:new Date().toISOString(),script,args});
   try{
    const result=await runProcess(shell,productionCommandArguments(shell,['-NoProfile','-NonInteractive','-File',script,...args]),{cwd:path.dirname(script),env:productionCommandEnvironment(shell),outputProtocol:'direct-exit-files',cleanup:'preserve',timeoutMs:600000,label:id});
    await writeOnce(out+'/'+id+'-result.json',{at:new Date().toISOString(),processEvidence:result.processEvidence,stdout:result.stdout,stderr:result.stderr});
    console.log(JSON.stringify({step:id,status:'completed'}));return result.stdout;
   }catch(error){await writeOnce(out+'/'+id+'-failure.json',{at:new Date().toISOString(),message:error.message,processEvidence:error.processEvidence??null});throw error;}
  };
  const entered=JSON.parse(await run('backend-enter-maintenance',worker,['-Action','EnterMaintenance','-MaintenanceId',plan.maintenanceId,'-KeepPostgres','-Json'],before));assert.equal(entered.status,'maintenance');assert.equal(entered.maintenanceId,plan.maintenanceId);
  await run('backend-deploy',source+'\\tools\\django-local-service.ps1',['-Action','DeployApp','-PreparedAppId',preparedId,'-PreparedAppSha256',preparedSha],before);
  assert.equal(await safeFileDigest(deployment),after);
  await run('backend-harden',root+'\\app\\tools\\django-local-service.ps1',['-Action','HardenAcl'],after);
  const exited=JSON.parse(await run('backend-exit-maintenance',worker,['-Action','ExitMaintenance','-MaintenanceId',plan.maintenanceId,'-Json'],after));assert.equal(exited.status,'maintenance_ended');
  const started=JSON.parse(await run('backend-start',worker,['-Action','Start','-Json'],after));assert(['started','already_running'].includes(started.status));assert.equal(started.manifestSha256,'51aefd56a68ae84df34e606db2c508092511b1ae24d118fd50cca33333016c6d');
  await run('backend-verify-startup',worker,['-Action','VerifyStartup','-Json'],after);
  assert.equal(await exists(root+'\\run\\system-maintenance.json'),false);assert.equal(await exists(root+'\\run\\automation-drain.json'),false);assert.equal(await safeFileDigest(deployment),after);
  await writeOnce(out+'/backend-publication-result.json',{status:'deployed',at:new Date().toISOString(),djangoManifest:after,sourceCommit:'d9ccdd82ff049b5d47db26f00f0da6bdb20cbad2',workerUnchanged:started.manifestSha256});
 });
}else throw Error('Use plan or execute');
