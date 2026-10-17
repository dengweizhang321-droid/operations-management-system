/** Manual main build/deploy entry. Uses the existing lifecycle and finite migration operators. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createReleaseProgress} from './publish-main-progress.mjs';
import {knownResume,loadKnownResume} from './publish-main-known-resume.mjs';
import {manualStepCommand} from './publish-main-command.mjs';

const controlRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const resumeMode=process.argv.includes('--resume-premaintenance');
const source=resumeMode?knownResume.source:controlRoot;
const requestFile=path.resolve(controlRoot,'..','main-release-request.json');
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

async function verifyOfflineCache(request){
 assert.ok(typeof request.npmCacheDirectory==='string'&&path.isAbsolute(request.npmCacheDirectory),'发布包缺少离线依赖缓存配置，请使用更新后的入口');
 const cache=path.join(request.npmCacheDirectory,'_cacache','content-v2');
 assert.ok((await fs.stat(cache)).isDirectory(),'发布包离线依赖缓存不存在：'+cache);
}

async function main(){
 if(!process.argv.includes('--check')){progress=createReleaseProgress(path.resolve(source,'..','logs'),{taskName:process.argv.includes('--prepare-only')?'打包':'发布'});progress.begin('准备发布');}
 const request=await read(requestFile);
 const head=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
 assert.equal(head,request.mainCommit,'main来源版本已变化，请使用本次合并后生成的入口');
 assert.equal(execFileSync('git',['status','--porcelain'],{cwd:source,encoding:'utf8'}).trim(),'','发布来源有未提交修改');
 if(request.latestMainRelease){
  assert.equal(request.version,'teruisi-frozen-latest-main-request-v1');
  assert.equal(resumeMode,false,'最新main发布不能套用旧任务续接');
  assert.equal(request.completedTask,undefined,'最新main发布不能使用旧完成证明');
  assert.equal(request.releasePlan?.headSha,head,'发布范围不属于本次main');assert.equal(request.releasePlan?.baseSha,request.deployedCommit);
  assert.deepEqual(request.components,request.releasePlan.components);
  const {schemaForRequest,verifyMainSchemaRelease}=await import('./main-schema-release.mjs');
  const schema=schemaForRequest(request);assert.equal(request.releasePlan.migrate,Boolean(schema));
  await verifyPowerShellHost(request,process.argv.includes('--check'));await verifyOfflineCache(request);
  if(process.argv.includes('--check')){if(schema)await verifyMainSchemaRelease(request,source);console.log(JSON.stringify({mode:'frozen-latest-main',targetCommit:head,migration:schema?.steps[0]??null,publicationPerformed:false}));return;}
  process.env.PATH=request.pwshDirectory+';'+(process.env.PATH??process.env.Path??'');process.env.WRANGLER_HIDE_BANNER='true';
  process.env.npm_config_cache=request.npmCacheDirectory;process.env.npm_config_offline='true';process.env.npm_config_prefer_online='false';process.env.npm_config_prefer_offline='true';
  const api=await import(pathToFileURL(path.join(source,'tools/worker-local-release.mjs')));
  const rotation=await import(pathToFileURL(path.join(source,'tools/worker-local-release-rotation.mjs')));
  const transport=await import(pathToFileURL(path.join(source,'tools/release-batch.mjs')));
  const token=await api.runProcess('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],{timeoutMs:30000});
  assert.equal(token.stdout.trim(),'False','请用普通用户执行固定发布入口，不需要管理员权限');
  const {publishPreparedMain}=await import('./publish-prepared-main.mjs');
  const out=path.resolve(source,'..','publish-'+head.slice(0,12));
  const resultIndex=process.argv.indexOf('--result-file');
  let resultFile;
  if(resultIndex!==-1){
   resultFile=path.resolve(process.argv[resultIndex+1]??'');
   assert.equal(path.dirname(resultFile),path.resolve(source,'..','invocations'),'调用结果必须写入本包独立记录目录');
   assert.equal(await exists(resultFile),false,'调用结果文件已存在，禁止覆盖或开始部署');
  }
  const result=await publishPreparedMain(request,{source,out,progress,api,rotation,transport,prepareOnly:process.argv.includes('--prepare-only'),deployOnly:process.argv.includes('--deploy-only')});
  if(resultFile){
   await fs.writeFile(resultFile,JSON.stringify({status:result.status,mainCommit:request.mainCommit,publicationPerformed:result.status==='deployed_and_ready'})+'\n',{flag:'wx'});
  }
  return;
 }
 if(process.argv.includes('--prepare-only')||process.argv.includes('--deploy-only'))throw Error('准备/只发布模式仅支持冻结的最新main请求，禁止用旧发布入口执行');
 if(request.completedTask){
  throw Error('这是旧任务的历史完成入口，不能发布最新main；请使用固定发布main.bat入口。本次未执行发布。');
 }
 const originalOut=path.resolve(source,'..','publish-'+head.slice(0,12));
 const resumedOut=path.join(originalOut,'resume-'+knownResume.maintenanceId);
 if(resumeMode&&await exists(path.join(resumedOut,'SUCCESS.json'))){
  const completed=await read(path.join(resumedOut,'SUCCESS.json'));
  assert.equal(completed.mainCommit,knownResume.commit);assert.equal(completed.maintenanceId,knownResume.maintenanceId);
  assert.equal(completed.resumedOriginalFailureSha256,knownResume.records['FAILED.json']);
  if(process.argv.includes('--check'))console.log(JSON.stringify({mode:'already-published',productionExecuted:false}));
  else progress.log('这是已完成的历史续接，本次没有执行发布。结果：'+path.join(resumedOut,'SUCCESS.json'));
  return;
 }
 const resume=resumeMode?await loadKnownResume(originalOut,request,head):null;
 if(process.argv.includes('--check')){const host=await verifyPowerShellHost(request,true);await verifyOfflineCache(request);console.log(JSON.stringify({powerShellHostVerified:true,powerShellVersion:host.version,dependencyMode:'offline',sourceCommit:head,mode:resume?'resume-reviewed-premaintenance':'manual-main-build-and-publish',steps:['构建打包','部署','必要的结构迁移','启动及必要服务确认'],backup:false,fullTests:false,productionExecuted:false}));return;}
 const out=resume?resumedOut:originalOut;await fs.mkdir(out,{recursive:true});
 const save=async(name,value)=>fs.writeFile(path.join(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
 progress.log('main版本：'+head+'；步骤详细日志：'+out);
 if(await exists(path.join(out,'SUCCESS.json')))throw Error('此入口存在历史成功记录，请从固定入口核对最新main。本次未执行发布。');
 if(await exists(path.join(out,'STARTED.json')))throw Error('此版本已有执行记录，不能重复执行未知结果。日志目录：'+out);
 const api=await import(pathToFileURL(path.join(source,'tools/worker-local-release.mjs')));
 const rotation=await import(pathToFileURL(path.join(source,'tools/worker-local-release-rotation.mjs')));
 const transport=await import(pathToFileURL(path.join(source,'tools/release-batch.mjs')));
 const sha=async file=>api.sha256Bytes(await fs.readFile(file));
 await verifyPowerShellHost(request);
 await verifyOfflineCache(request);
 process.env.PATH=request.pwshDirectory+';'+(process.env.PATH??process.env.Path??'');process.env.WRANGLER_HIDE_BANNER='true';
 // This frozen delivery carries its lockfile-verified cache; never fall back to network.
 process.env.npm_config_cache=request.npmCacheDirectory;
 process.env.npm_config_offline='true';
 process.env.npm_config_prefer_online='false';
 process.env.npm_config_prefer_offline='true';
 progress.log('依赖安装使用发布包内缓存（离线模式，不联网下载），继续按锁文件安装和校验。');
 const shell='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
 const token=await api.runProcess(shell,['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],{timeoutMs:30000});
 assert.equal(token.stdout.trim(),'False','请使用普通用户双击，不需要管理员权限');
 const installed='D:/teruisi-runtime/django-sales/app';
 const needsMigration=Boolean(request.schemaEvidencePath);
 const schemaArgs=needsMigration?['-IntegrationEvidencePath',request.schemaEvidencePath,'-IntegrationEvidenceSha256',request.schemaEvidenceSha256]:[];
 const maintenanceId=resume?resume.started.maintenanceId:randomUUID().replaceAll('-',''),operationId=resume?resume.started.operationId:randomUUID().replaceAll('-','');
 let phase='准备',maintenanceStarted=false;
 const step=async(label,script,action,extra=[],{json=true,addJson=true}={})=>{
  phase=label;progress.begin(label);await save(label+'-started.json',{at:new Date().toISOString(),script,action,extra});
  const command=manualStepCommand({systemHost:shell,powerShellDirectory:request.pwshDirectory,script,action,extra,addJson});
  const args=resume&&action==='EnterMaintenance'
   ?['-NoProfile','-NonInteractive','-File',path.join(controlRoot,'tools/manual-maintenance-entry.ps1'),'-WorkerScript',script,'-MaintenanceId',maintenanceId,'-ReviewPath',resume.reviewFile,'-ReviewSha256',resume.reviewSha256]
   :command.args;
  const result=await api.runProcess(command.host,transport.productionCommandArguments(command.host,args),{cwd:path.dirname(script),env:transport.productionCommandEnvironment(command.host),timeoutMs:1800000,outputProtocol:'direct-exit-files',cleanup:'preserve',label:'manual-main-'+label});
  await fs.writeFile(path.join(out,label+'.stdout.log'),result.stdout,{flag:'wx'});await fs.writeFile(path.join(out,label+'.stderr.log'),result.stderr,{flag:'wx'});
  const value=json?JSON.parse(result.stdout.trim()):null;await save(label+'-result.json',{at:new Date().toISOString(),value,processEvidence:result.processEvidence});progress.complete();return value;
 };
 await rotation.withRotationLock(async rotationLease=>{
  await rotation.assertActiveBatchOwnership(api.workerRuntimeRoot);
  const before=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});
  assert.deepEqual(before.head,request.predecessorWorker,'运行版本已被其他发布改变');
  assert.equal(await sha(installed+'/deployment.json'),request.predecessorDjangoSha256,'后台版本已被其他发布改变');
  await save('STARTED.json',{at:new Date().toISOString(),mainCommit:head,maintenanceId,operationId,manual:true,...(resume?{reviewSha256:resume.reviewSha256,originalFailureSha256:knownResume.records['FAILED.json']}: {})});
  try{
   progress.complete();phase=resume?'复用已准备制品':'构建前端';progress.begin(resume?'复用已准备的前后台包':'构建前端原生发布包');
   let bindingFile,bindingSha;
   if(resume){bindingFile=path.join(originalOut,'source-binding.json');bindingSha=knownResume.records['source-binding.json'];}
   else{
    const identity=await api.workerPreparationIdentity(source);
    const binding={version:api.workerSourceBindingVersion,sourceRoot:source,sourceRootPathSha256:api.windowsPathSha256(source),predecessor:before.head,predecessorChainStateSha256:before.chainStateSha256,identity};
    const raw=api.canonicalJson(binding)+'\n';bindingFile=path.join(out,'source-binding.json');await fs.writeFile(bindingFile,raw,{flag:'wx'});bindingSha=api.sha256Bytes(Buffer.from(raw));
   }
   const plan=await rotation.planWorkerReleaseRotation({prepareOnline:true,sourceBindingFile:bindingFile,sourceBindingSha256:bindingSha,rotationLease,...(resume?{reusePlanSha256:resume.plan.planSha256}:{})});await save('worker-plan.json',plan);assert.equal(plan.status,'planned');
   if(resume){assert.equal(plan.reused,true);assert.equal(plan.planSha256,resume.plan.planSha256);assert.equal(plan.candidateReleaseId,resume.plan.candidateReleaseId);}
   progress.complete();
   const pkg=resume?resume.pkg:await step('准备后台',path.join(source,'tools/django-local-service.ps1'),'PrepareApp',schemaArgs);
   if(resume)assert.equal(await sha('D:/teruisi-runtime/django-sales/app.prepare-'+pkg.id+'.json'),pkg.receiptSha256,'原后台准备收据变化');
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
   const response=await fetch('http://127.0.0.1:3000/_teruisi/local/health/ready',{headers:{'x-teruisi-local-health':'1'},signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);await response.body.cancel();
   progress.complete();
   await save('SUCCESS.json',{at:new Date().toISOString(),mainCommit:head,workerRelease:after.head.releaseId,djangoPreparedId:pkg.id,migration:needsMigration?'inventory.0015_jd_monitor_preferences':null,backupPerformed:false,...(resume?{maintenanceId,resumedOriginalFailureSha256:knownResume.records['FAILED.json']}: {})});
   progress.success('main版本：'+head+'；步骤详细日志：'+out);
  }catch(error){await save('FAILED.json',{at:new Date().toISOString(),phase,error:String(error.message).slice(0,1600),processEvidence:error.processEvidence??null,maintenanceStarted,automaticRetry:false});throw error;}
 });
}
main().catch(error=>{if(progress)progress.fail(error);else console.error('\n发布已停止：'+error.message);process.exitCode=1;}).finally(()=>progress?.close());
