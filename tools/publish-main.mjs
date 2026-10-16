/** Manual main build/deploy entry. Uses the existing lifecycle and finite migration operators. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createReleaseProgress} from './publish-main-progress.mjs';

const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const requestFile=path.resolve(source,'..','main-release-request.json');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const exists=async file=>{try{await fs.access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
let progress;

async function verifyPowerShellHost(request,smoke=false){
 const executable=path.join(request.pwshDirectory,'pwsh.exe');
 let bytes;
 try{bytes=await fs.readFile(executable);}catch(error){if(error.code==='ENOENT')throw Error('发布所需的PowerShell文件不存在：'+executable);throw error;}
 assert.equal(createHash('sha256').update(bytes).digest('hex'),request.pwshSha256,'受控PowerShell运行环境已变化');
 const version=smoke?execFileSync(executable,['-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.ToString()'],{encoding:'utf8',windowsHide:true,timeout:15000}).trim():null;
 return {executable,version};
}

async function main(){
 if(!process.argv.includes('--check')){progress=createReleaseProgress(path.resolve(source,'..','logs'));progress.begin('准备发布');}
 const request=await read(requestFile);
 const head=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
 assert.equal(head,request.mainCommit,'main来源版本已变化，请使用本次合并后生成的入口');
 assert.equal(execFileSync('git',['status','--porcelain'],{cwd:source,encoding:'utf8'}).trim(),'','发布来源有未提交修改');
 if(process.argv.includes('--check')){const host=await verifyPowerShellHost(request,true);console.log(JSON.stringify({powerShellHostVerified:true,powerShellVersion:host.version,sourceCommit:head,mode:'manual-main-build-and-publish',steps:['构建打包','部署','必要的结构迁移','启动及必要服务确认'],backup:false,fullTests:false,productionExecuted:false}));return;}
 const out=path.resolve(source,'..','publish-'+head.slice(0,12));await fs.mkdir(out,{recursive:true});
 const save=async(name,value)=>fs.writeFile(path.join(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
 progress.log('main版本：'+head+'；步骤详细日志：'+out);
 if(await exists(path.join(out,'SUCCESS.json'))){progress.success('此main版本已经成功发布，无需重复部署。结果：'+path.join(out,'SUCCESS.json'));return;}
 if(await exists(path.join(out,'STARTED.json')))throw Error('此版本已有执行记录，不能重复执行未知结果。日志目录：'+out);
 const api=await import(pathToFileURL(path.join(source,'tools/worker-local-release.mjs')));
 const rotation=await import(pathToFileURL(path.join(source,'tools/worker-local-release-rotation.mjs')));
 const transport=await import(pathToFileURL(path.join(source,'tools/release-batch.mjs')));
 const sha=async file=>api.sha256Bytes(await fs.readFile(file));
 await verifyPowerShellHost(request);
 process.env.PATH=request.pwshDirectory+';'+(process.env.PATH??process.env.Path??'');process.env.WRANGLER_HIDE_BANNER='true';
 const shell='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
 const token=await api.runProcess(shell,['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],{timeoutMs:30000});
 assert.equal(token.stdout.trim(),'False','请使用普通用户双击，不需要管理员权限');
 const installed='D:/teruisi-runtime/django-sales/app';
 const needsMigration=Boolean(request.schemaEvidencePath);
 const schemaArgs=needsMigration?['-IntegrationEvidencePath',request.schemaEvidencePath,'-IntegrationEvidenceSha256',request.schemaEvidenceSha256]:[];
 const maintenanceId=randomUUID().replaceAll('-',''),operationId=randomUUID().replaceAll('-','');
 let phase='准备',maintenanceStarted=false;
 const step=async(label,script,action,extra=[],{json=true,addJson=true}={})=>{
  phase=label;progress.begin(label);await save(label+'-started.json',{at:new Date().toISOString(),script,action,extra});
  const args=['-NoProfile','-NonInteractive','-File',script,'-Action',action,...extra,...(addJson?['-Json']:[])];
  const result=await api.runProcess(shell,transport.productionCommandArguments(shell,args),{cwd:path.dirname(script),env:transport.productionCommandEnvironment(shell),timeoutMs:1800000,outputProtocol:'direct-exit-files',cleanup:'preserve',label:'manual-main-'+label});
  await fs.writeFile(path.join(out,label+'.stdout.log'),result.stdout,{flag:'wx'});await fs.writeFile(path.join(out,label+'.stderr.log'),result.stderr,{flag:'wx'});
  const value=json?JSON.parse(result.stdout.trim()):null;await save(label+'-result.json',{at:new Date().toISOString(),value,processEvidence:result.processEvidence});progress.complete();return value;
 };
 await rotation.withRotationLock(async rotationLease=>{
  await rotation.assertActiveBatchOwnership(api.workerRuntimeRoot);
  const before=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});
  assert.deepEqual(before.head,request.predecessorWorker,'运行版本已被其他发布改变');
  assert.equal(await sha(installed+'/deployment.json'),request.predecessorDjangoSha256,'后台版本已被其他发布改变');
  await save('STARTED.json',{at:new Date().toISOString(),mainCommit:head,maintenanceId,operationId,manual:true});
  try{
   progress.complete();phase='构建前端';progress.begin('构建前端原生发布包');
   const identity=await api.workerPreparationIdentity(source);
   const binding={version:api.workerSourceBindingVersion,sourceRoot:source,sourceRootPathSha256:api.windowsPathSha256(source),predecessor:before.head,predecessorChainStateSha256:before.chainStateSha256,identity};
   const raw=api.canonicalJson(binding)+'\n',bindingFile=path.join(out,'source-binding.json');await fs.writeFile(bindingFile,raw,{flag:'wx'});
   const plan=await rotation.planWorkerReleaseRotation({prepareOnline:true,sourceBindingFile:bindingFile,sourceBindingSha256:api.sha256Bytes(Buffer.from(raw)),rotationLease});await save('worker-plan.json',plan);assert.equal(plan.status,'planned');
   progress.complete();
   const pkg=await step('准备后台',path.join(source,'tools/django-local-service.ps1'),'PrepareApp',schemaArgs);
   const candidateDjangoSha256=await sha('D:/teruisi-runtime/django-sales/app.deploy-'+pkg.id+'/deployment.json');
   const oldWorker=path.join(api.workerRuntimeRoot,'releases',before.head.releaseId,'tools/worker-local-service.ps1');
   const newWorker=path.join(api.workerRuntimeRoot,'releases',plan.candidateReleaseId,'tools/worker-local-service.ps1');
   const adoption=['-AdditionKind','JdMonitorPreferences','-SourceRoot',source,'-OperationId',operationId,'-MaintenanceId',maintenanceId,'-SchemaOnly','-Execute'];
   const {DatabaseSync}=await import('node:sqlite');
   const workflowDb=new DatabaseSync('C:/Users/86137/.n8n/database.sqlite',{readOnly:true});
   try{workflowDb.exec('PRAGMA query_only=ON');assert.equal(workflowDb.prepare("SELECT COUNT(*) n FROM execution_entity WHERE workflowId=? AND status IN ('new','running','waiting')").get('JdLogisticsDaily2026').n,0,'京东采集任务尚在运行，请等待完成');}finally{workflowDb.close();}
   maintenanceStarted=true;
   const entered=await step('进入维护',oldWorker,'EnterMaintenance',['-MaintenanceId',maintenanceId,'-KeepPostgres']);assert.equal(entered.status,'maintenance');assert.equal(entered.maintenanceId,maintenanceId);assert.equal(entered.postgresPreserved,true);
   await step('停止旧前端',oldWorker,'Stop');
   if(needsMigration)await step('登记结构迁移',path.join(source,'tools/bi-app-adopt.ps1'),'Plan',[...adoption,'-PreparedAppId',pkg.id,'-PreparedAppSha256',pkg.receiptSha256,'-CandidateEvidencePath',request.schemaEvidencePath,'-CandidateEvidenceSha256',request.schemaEvidenceSha256],{addJson:false});
   await step('部署后台',path.join(source,'tools/django-local-service.ps1'),'DeployApp',['-PreparedAppId',pkg.id,'-PreparedAppSha256',pkg.receiptSha256,...(needsMigration?['-IntegrationOperationId',operationId,...schemaArgs]:[])],{json:false});
   assert.equal(await sha(installed+'/deployment.json'),candidateDjangoSha256);
   await step('应用后台权限',installed+'/tools/django-local-service.ps1','HardenAcl',[],{json:false});
   if(needsMigration){
   const migration=await step('迁移配置字段',installed+'/tools/bi-app-adopt.ps1','Install',adoption,{addJson:false});assert.equal(migration.status,'verified');assert.equal(migration.result.migrationCount,147);
   const finalized=await step('完成结构迁移',installed+'/tools/bi-app-adopt.ps1','Finalize',adoption,{addJson:false});assert.equal(finalized.status,'verified');assert.equal(finalized.result.status,'verified');
   }
   phase='切换前端';progress.begin(phase);await save('WorkerApply-started.json',{at:new Date().toISOString(),planSha256:plan.planSha256});
   const applied=await rotation.applyApprovedRotationPlan({approvedPlanSha256:plan.planSha256,rotationLease});await save('WorkerApply-result.json',applied);assert.ok(['activated','already_activated'].includes(applied.status));assert.equal(applied.releaseId,plan.candidateReleaseId);
   progress.complete();
   await step('退出维护',newWorker,'ExitMaintenance',['-MaintenanceId',maintenanceId]);
   const started=await step('启动服务',newWorker,'Start');assert.ok(['started','already_running'].includes(started.status));assert.equal(started.manifestSha256,plan.candidateManifestSha256);
   const startup=await step('确认启动版本',newWorker,'VerifyStartup');assert.equal(startup.startupVerified,true);
   phase='确认服务可用';progress.begin(phase);
   const after=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});assert.equal(after.head.releaseId,plan.candidateReleaseId);assert.equal(after.head.manifestSha256,plan.candidateManifestSha256);
   const response=await fetch('http://127.0.0.1:3000/_teruisi/local/health/ready',{signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);await response.body.cancel();
   progress.complete();
   await save('SUCCESS.json',{at:new Date().toISOString(),mainCommit:head,workerRelease:after.head.releaseId,djangoPreparedId:pkg.id,migration:needsMigration?'inventory.0015_jd_monitor_preferences':null,backupPerformed:false});
   progress.success('main版本：'+head+'；步骤详细日志：'+out);
  }catch(error){await save('FAILED.json',{at:new Date().toISOString(),phase,error:String(error.message).slice(0,1600),processEvidence:error.processEvidence??null,maintenanceStarted,automaticRetry:false});throw error;}
 });
}
main().catch(error=>{if(progress)progress.fail(error);else console.error('\n发布已停止：'+error.message);process.exitCode=1;}).finally(()=>progress?.close());
