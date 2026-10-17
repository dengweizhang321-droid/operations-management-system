/** One forward repair of the completed Pi150 adoption / failed f374 startup. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {publisherEnvironment} from './publish-latest-main.mjs';
import {makeReleasePlan} from './release-scope-plan.mjs';
import {manualStepCommand} from './publish-main-command.mjs';

const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output='D:/codex-artifacts/pi-publish-recovery-20261017-v2';
const original='D:/codex-isolated/main-release-packages/f3748d8e03e2-60dc61d1-622cb632';
const attempt=path.join(original,'publish-f3748d8e03e2');
const django='D:/teruisi-runtime/django-sales',worker='D:/teruisi-runtime/teruisi-worker-sales';
const state='D:/codex-isolated/main-manual-release-20261016';
const maintenanceId='ca1bc9efd18d4263aeb298353ca93714';
const originalCommit='f3748d8e03e27073af8c7e599036861ae16e46dd';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const hash=async f=>sha(await fs.readFile(f));
const exists=async f=>{try{await fs.access(f);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const save=async(name,value)=>fs.writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const git=args=>execFileSync('git',args,{cwd:source,encoding:'utf8',windowsHide:true}).trim();
const config=await read(path.join(state,'main-publisher-config.json'));
const environment=publisherEnvironment({},config.gitDirectory,config.publisherBaseEnvironment);
environment.PATH=config.pwshDirectory+';'+environment.PATH;
environment.WRANGLER_HIDE_BANNER='true';environment.npm_config_cache=config.npmCacheDirectory;
environment.npm_config_offline='true';environment.npm_config_prefer_online='false';environment.npm_config_prefer_offline='true';
const mode=process.argv[2];assert.ok(['prepare','execute'].includes(mode));
if(!process.argv.includes('--fixed-environment')){
 const child=spawn(process.execPath,[fileURLToPath(import.meta.url),...process.argv.slice(2),'--fixed-environment'],{cwd:source,env:environment,windowsHide:true,stdio:'inherit'});
 process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>signal?reject(Error('Recovery transport interrupted')):resolve(code??1));});
}else{
 const api=await import('./worker-local-release.mjs');
 const rotation=await import('./worker-local-release-rotation.mjs');
 const transport=await import('./release-batch.mjs');
 await fs.mkdir(output,{recursive:true});
 const log=message=>console.log(new Date().toISOString()+' '+message);
 const identity=()=>({commit:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}'])});
 const clean=()=>assert.equal(git(['status','--porcelain']),'','Recovery source must be committed and frozen');
 const originalFacts=async()=>{
  const failed=await read(path.join(attempt,'FAILED.json'));
  assert.equal(failed.mainCommit,originalCommit);assert.equal(failed.phase,'启动服务');
  assert.equal(failed.processEvidence.engineFailure.processId,38776);assert.equal(failed.processEvidence.engineFailure.exitCode,1);
  const started=await read(path.join(attempt,'STARTED.json'));
  assert.equal(started.maintenanceId,maintenanceId);assert.equal(started.operationId,'ff28fd7d584547dea301b9f3561ae2aa');
  const applied=await read(path.join(attempt,'WorkerApply-result.json'));
  assert.equal(applied.status,'activated');assert.equal(applied.releaseId,'20261017T100706Z-1090ea88f6fe3094');
  const finalized=(await read(path.join(attempt,'完成结构迁移-result.json'))).value;
  assert.equal(finalized.result.migrationCount,150);assert.equal(finalized.result.status,'verified');
  assert.equal((await read(path.join(attempt,'退出维护-result.json'))).value.status,'maintenance_ended');
  return {originalAttempt:attempt,originalStartedSha256:await hash(path.join(attempt,'STARTED.json')),originalFailureSha256:await hash(path.join(attempt,'FAILED.json')),schemaOperationId:started.operationId,maintenanceId};
 };
 const step=async(label,script,action,extra=[],addJson=true)=>{
  await save(label+'-started.json',{at:new Date().toISOString(),script,action,extra});log(label+' 开始');
  const command=manualStepCommand({systemHost:'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',powerShellDirectory:config.pwshDirectory,script,action,extra,addJson});
  const result=await api.runProcess(command.host,transport.productionCommandArguments(command.host,command.args),{cwd:path.dirname(script),env:transport.productionCommandEnvironment(command.host),timeoutMs:1800000,outputProtocol:'direct-exit-files',cleanup:'preserve',label:'pi150-forward-'+label});
  await fs.writeFile(path.join(output,label+'.stdout.log'),result.stdout,{flag:'wx'});await fs.writeFile(path.join(output,label+'.stderr.log'),result.stderr,{flag:'wx'});
  const value=action==='DeployApp'||action==='HardenAcl'?null:JSON.parse(result.stdout.trim());
  await save(label+'-result.json',{value,processEvidence:result.processEvidence});log(label+' 完成');return value;
 };
 await rotation.withRotationLock(async lease=>{
  await rotation.assertActiveBatchOwnership(worker);clean();
  const facts=await originalFacts();
  const chain=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});
  const beforeDjango='67696b506801744faf048141b5b4e342e1afa062e48d97669f6e44cf3634fbc2';
  assert.equal(chain.head.releaseId,'20261017T100706Z-1090ea88f6fe3094');
  assert.equal(chain.head.manifestSha256,'5bc9c99602822aa3342e1548e33a7b2ba2b42bb1a446af381bfdcf6a4203041d');
  assert.equal(await hash(path.join(django,'app/deployment.json')),beforeDjango);
  for(const name of ['system-maintenance.json','automation-drain.json'])assert.equal(await exists(path.join(django,'run',name)),false,'Existing maintenance must be reconciled');
  if(mode==='prepare'){
   const releasePlan=makeReleasePlan({base:originalCommit,head:identity().commit,cwd:source});
   assert.deepEqual(releasePlan.components,['worker','django']);assert.equal(releasePlan.migrate,false);
   await save('PREPARING.json',{at:new Date().toISOString(),sourceIdentity:identity(),facts,releasePlan});
   assert.equal(releasePlan.databaseProtection,'verified-current');
   const backupDirectory='E:/运营管理系统业务数据/daily-20261015T041546Z-e45dddeb5a15';
   const backupManifestSha256='d027dc04cfeb3cde06801b7f200ba355fb5afae84da311ca5fe295e2284fa34d';
   assert.equal(await hash(path.join(backupDirectory,'backup-manifest.json')),backupManifestSha256);
   const backup=await step('VerifyExistingBackup',path.join(django,'app/tools/django-postgres-maintenance.ps1'),'Verify',['-BackupDirectory',backupDirectory,'-ApprovedManifestSha256',backupManifestSha256],false);
   assert.equal(backup.status,'completed');assert.equal(backup.manifestSha256,backupManifestSha256);assert.equal(backup.serviceStateChanged,false);
   const sourceIdentity=await api.workerPreparationIdentity(source);
   const binding={version:api.workerSourceBindingVersion,sourceRoot:source,sourceRootPathSha256:api.windowsPathSha256(source),predecessor:chain.head,predecessorChainStateSha256:chain.chainStateSha256,identity:sourceIdentity};
   const bindingRaw=api.canonicalJson(binding)+'\n',bindingFile=path.join(output,'source-binding.json');
   await fs.writeFile(bindingFile,bindingRaw,{flag:'wx'});log('准备前向 Worker successor 开始');
   const plan=await rotation.planWorkerReleaseRotation({prepareOnline:true,sourceBindingFile:bindingFile,sourceBindingSha256:sha(Buffer.from(bindingRaw)),rotationLease:lease});
   await save('worker-plan.json',plan);log('准备前向 Worker successor 完成');
   const pkg=await step('PrepareApp',path.join(source,'tools/django-local-service.ps1'),'PrepareApp');
   const ready={version:'pi150-forward-recovery-v1',at:new Date().toISOString(),source,sourceIdentity:identity(),facts,releasePlan,backup:{directory:backupDirectory,manifestSha256:backupManifestSha256,result:backup},predecessor:chain.head,predecessorChainStateSha256:chain.chainStateSha256,predecessorDjangoSha256:beforeDjango,plan,pkg,djangoManifestSha256:await hash(path.join(django,'app.deploy-'+pkg.id,'deployment.json'))};
   clean();await save('READY.json',ready);log('两组件前向恢复制品已准备；尚未操作生产');return;
  }
  const ready=await read(path.join(output,'READY.json'));
  assert.equal(ready.version,'pi150-forward-recovery-v1');assert.equal(ready.source,source);assert.deepEqual(ready.sourceIdentity,identity());assert.deepEqual(ready.facts,facts);
  assert.deepEqual(ready.predecessor,chain.head);assert.equal(ready.predecessorChainStateSha256,chain.chainStateSha256);
  assert.equal(ready.backup.result.status,'completed');assert.equal(await hash(path.join(ready.backup.directory,'backup-manifest.json')),ready.backup.manifestSha256);
  const proofFile=path.join(output,'absent-helper-proof.json'),proof=await read(proofFile);
  const approved=process.argv[3];assert.match(approved??'',/^[a-f0-9]{64}$/);assert.equal(await hash(proofFile),approved);
  assert.equal(proof.operationId,maintenanceId);assert.equal(proof.preparedAppId,ready.pkg.id);
  for(const file of [path.join(output,'RECOVERY-STARTED.json'),path.join(output,'SUCCESS.json')])assert.equal(await exists(file),false,'Original recovery has started; no automatic replay');
  const verified=await step('VerifyPrepared',path.join(source,'tools/django-local-service.ps1'),'VerifyPreparedApp',['-PreparedAppId',ready.pkg.id,'-PreparedAppSha256',ready.pkg.receiptSha256]);assert.equal(verified.status,'prepared_verified');
  // Reuse the exact prepared source-bound plan; do not build or call the old plan.
  const reused=await rotation.planWorkerReleaseRotation({prepareOnline:true,reusePlanSha256:ready.plan.planSha256,sourceBindingFile:path.join(output,'source-binding.json'),sourceBindingSha256:await hash(path.join(output,'source-binding.json')),rotationLease:lease});
  assert.equal(reused.candidateManifestSha256,ready.plan.candidateManifestSha256);
  await save('RECOVERY-STARTED.json',{at:new Date().toISOString(),sourceIdentity:identity(),facts,proofSha256:approved,readySha256:await hash(path.join(output,'READY.json'))});
  try{
   const entered=await step('EnterMaintenance',path.join(source,'tools/worker-local-service.ps1'),'EnterMaintenance',['-MaintenanceId',maintenanceId,'-KeepPostgres','-RecoveryProofPath',proofFile,'-RecoveryProofSha256',approved]);assert.equal(entered.status,'maintenance');assert.equal(entered.maintenanceId,maintenanceId);assert.equal(entered.postgresPreserved,true);
   await step('DeployApp',path.join(source,'tools/django-local-service.ps1'),'DeployApp',['-PreparedAppId',ready.pkg.id,'-PreparedAppSha256',ready.pkg.receiptSha256]);
   assert.equal(await hash(path.join(django,'app/deployment.json')),ready.djangoManifestSha256);
   await step('HardenAcl',path.join(django,'app/tools/django-local-service.ps1'),'HardenAcl');
   await save('WorkerApply-started.json',{planSha256:ready.plan.planSha256});log('应用新的前向 Worker successor');
   const applied=await rotation.applyApprovedRotationPlan({approvedPlanSha256:ready.plan.planSha256,rotationLease:lease});await save('WorkerApply-result.json',applied);assert.ok(['activated','already_activated'].includes(applied.status));assert.equal(applied.releaseId,ready.plan.candidateReleaseId);
   const workerScript=path.join(worker,'releases',ready.plan.candidateReleaseId,'tools/worker-local-service.ps1');
   const ended=await step('ExitMaintenance',workerScript,'ExitMaintenance',['-MaintenanceId',maintenanceId]);assert.equal(ended.status,'maintenance_ended');
   const started=await step('Start',workerScript,'Start');assert.ok(['started','already_running'].includes(started.status));assert.equal(started.manifestSha256,ready.plan.candidateManifestSha256);
   const startup=await step('VerifyStartup',workerScript,'VerifyStartup');assert.equal(startup.startupVerified,true);
   const after=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});assert.equal(after.head.manifestSha256,ready.plan.candidateManifestSha256);assert.equal(await hash(path.join(django,'app/deployment.json')),ready.djangoManifestSha256);
   const response=await fetch('http://127.0.0.1:3000/_teruisi/local/health/ready',{headers:{'x-teruisi-local-health':'1'},signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);const health=await response.json();assert.equal(health.ok,true);assert.equal(health.status,'ready');
   const receipt={status:'deployed_and_ready',at:new Date().toISOString(),mainCommit:ready.sourceIdentity.commit,components:ready.releasePlan.components,workerRelease:after.head.releaseId,workerManifestSha256:after.head.manifestSha256,djangoManifestSha256:ready.djangoManifestSha256,source,sourceTree:await api.hashRelativeFiles(source,await api.listGitSourceFiles(source)),djangoPreparedId:ready.pkg.id,maintenanceId,migration:null,originalRecovery:facts,backupPerformed:false};
   await save('SUCCESS.json',receipt);
   const catalog={...receipt,receiptPath:path.join(output,'SUCCESS.json'),receiptSha256:await hash(path.join(output,'SUCCESS.json'))};
   await fs.copyFile(path.join(state,'PUBLISHED-MAIN.json'),path.join(output,'previous-PUBLISHED-MAIN.json'),fs.constants.COPYFILE_EXCL);
   const temporary=path.join(state,'PUBLISHED-MAIN.json.'+randomUUID()+'.tmp');await fs.writeFile(temporary,JSON.stringify(catalog,null,2)+'\n',{flag:'wx'});await fs.rename(temporary,path.join(state,'PUBLISHED-MAIN.json'));
   log('前向发布成功，原失败证据保持不变');
  }catch(error){await save('RECOVERY-FAILED.json',{at:new Date().toISOString(),message:String(error.message),processEvidence:error.processEvidence??null,automaticRetry:false});throw error;}
 });
}
