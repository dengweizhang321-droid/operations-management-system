/** Execute one frozen, scoped main delivery using the original native engines. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {manualStepCommand} from './publish-main-command.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=async file=>{try{await fs.access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const noProgress={begin(){},complete(){},log(){},success(){}};

export function preparedComponents(request){
 assert.match(request.mainCommit??'',/^[a-f0-9]{40}$/,'发布目标必须是冻结的完整提交');
 assert.ok(!request.migrate&&!request.releasePlan?.migrate&&!request.schemaEvidencePath,'通用发布入口尚不支持结构迁移，请生成专用批准入口');
 assert.ok(Array.isArray(request.components),'缺少发布组件范围');
 assert.ok(request.components.every(c=>c==='worker'||c==='django')&&new Set(request.components).size===request.components.length,'发布组件无效');
 return {worker:request.components.includes('worker'),django:request.components.includes('django')};
}

/** Optional seams runStep/sourceIdentity/sha/fetch are for private fixture engines. */
export async function publishPreparedMain(request,context){
 const components=preparedComponents(request);
 const {source,out,api,rotation,transport}=context;
 const progress=context.progress??noProgress;
 const installed=context.installedRoot??'D:/teruisi-runtime/django-sales/app';
 const runtime=context.workerRuntimeRoot??api.workerRuntimeRoot;
 const sha=context.sha??(async file=>digest(await fs.readFile(file)));
 const sourceIdentity=context.sourceIdentity??(async()=>{
  const git=args=>execFileSync('git',args,{cwd:source,encoding:'utf8',windowsHide:true}).trim();
  assert.equal(git(['status','--porcelain']),'','发布来源有未提交修改');
  return {commit:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}'])};
 });
 const identity=await sourceIdentity();
 assert.equal(identity.commit,request.mainCommit,'冻结的main来源已变化');
 if(!components.worker&&!components.django)return {status:'non-production',mainCommit:request.mainCommit,components:request.components};
 await fs.mkdir(out,{recursive:true});
 const save=(name,value)=>fs.writeFile(path.join(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
 const maintenanceId=randomUUID().replaceAll('-','');
 let phase='核对前驱',maintenanceStarted=false;
 const step=async(label,script,action,extra=[],{json=true}={})=>{
  phase=label;progress.begin(label);
  await save(label+'-started.json',{at:new Date().toISOString(),script,action,extra});
  let value;
  if(context.runStep)value=await context.runStep({label,script,action,extra,json});
  else{
   const command=manualStepCommand({systemHost:'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',powerShellDirectory:request.pwshDirectory,script,action,extra});
   const result=await api.runProcess(command.host,transport.productionCommandArguments(command.host,command.args),{cwd:path.dirname(script),env:transport.productionCommandEnvironment(command.host),timeoutMs:1800000,outputProtocol:'direct-exit-files',cleanup:'preserve',label:'manual-main-'+label});
   await fs.writeFile(path.join(out,label+'.stdout.log'),result.stdout,{flag:'wx'});
   await fs.writeFile(path.join(out,label+'.stderr.log'),result.stderr,{flag:'wx'});
   value=json?JSON.parse(result.stdout.trim()):null;
   await save(label+'-process.json',{processEvidence:result.processEvidence});
  }
  await save(label+'-result.json',{at:new Date().toISOString(),value});progress.complete();return value;
 };
 const ready=async()=>{
  const response=await (context.fetch??fetch)('http://127.0.0.1:3000/_teruisi/local/health/ready',{headers:{'x-teruisi-local-health':'1'},signal:AbortSignal.timeout(15000)});
  try{
   assert.equal(response.status,200,'服务尚未就绪');
   const health=await response.json();
   assert.equal(health?.ok,true,'服务就绪响应ok不匹配');
   assert.equal(health?.status,'ready','服务就绪响应status不匹配');
  }finally{
   // JSON consumes (and may retain a lock on) a real Fetch body. Cancel only
   // an unread, unlocked body, such as an HTTP rejection before JSON parsing.
   if(!response.bodyUsed&&!response.body?.locked)await response.body?.cancel();
  }
 };
 return rotation.withRotationLock(async rotationLease=>{
  await rotation.assertActiveBatchOwnership(runtime);
  const before=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});
  const djangoBefore=await sha(path.join(installed,'deployment.json'));
  if(await exists(path.join(out,'SUCCESS.json'))){
   const receipt=await read(path.join(out,'SUCCESS.json'));
   assert.equal(receipt.status,'deployed_and_ready','成功凭证不完整');
   assert.equal(receipt.mainCommit,request.mainCommit,'旧成功凭证不属于本次目标');
   assert.deepEqual(receipt.components,request.components,'成功凭证组件范围不一致');
   assert.equal(before.head.releaseId,receipt.workerRelease,'当前Worker已改变');
   assert.equal(before.head.manifestSha256,receipt.workerManifestSha256,'当前Worker manifest已改变');
   assert.equal(djangoBefore,receipt.djangoManifestSha256,'当前Django已改变');
   await ready();
   progress.log('当前已是目标main，本次没有发布：'+request.mainCommit);
   return {...receipt,status:'already-current',receiptPath:path.join(out,'SUCCESS.json')};
  }
  if(await exists(path.join(out,'STARTED.json')))throw Error('此发布已有STARTED且无SUCCESS，结果未知；禁止自动重试：'+out);
  assert.deepEqual(before.head,request.predecessorWorker,'运行版本已被其他发布改变');
  assert.equal(djangoBefore,request.predecessorDjangoSha256,'后台版本已被其他发布改变');
  await save('STARTED.json',{at:new Date().toISOString(),mainCommit:request.mainCommit,components:request.components,maintenanceId,source,sourceTree:identity.tree??null});
  try{
   let plan=null,pkg=null;
   if(components.worker){
    phase='构建前端';progress.begin(phase);
    const preparationIdentity=await api.workerPreparationIdentity(source);
    const binding={version:api.workerSourceBindingVersion,sourceRoot:source,sourceRootPathSha256:api.windowsPathSha256(source),predecessor:before.head,predecessorChainStateSha256:before.chainStateSha256,identity:preparationIdentity};
    const raw=api.canonicalJson(binding)+'\n',bindingFile=path.join(out,'source-binding.json');
    await fs.writeFile(bindingFile,raw,{flag:'wx'});
    plan=await rotation.planWorkerReleaseRotation({prepareOnline:true,sourceBindingFile:bindingFile,sourceBindingSha256:digest(Buffer.from(raw)),rotationLease});
    await save('worker-plan.json',plan);assert.equal(plan.status,'planned');progress.complete();
   }
   let djangoExpected=djangoBefore;
   if(components.django){
    pkg=await step('准备后台',path.join(source,'tools/django-local-service.ps1'),'PrepareApp');
    assert.match(pkg.id??'',/^[a-f0-9]{32}$/,'后台准备ID无效');assert.match(pkg.receiptSha256??'',/^[a-f0-9]{64}$/,'后台准备凭证无效');
    djangoExpected=await sha(path.join(path.dirname(installed),'app.deploy-'+pkg.id,'deployment.json'));
   }
   // Recheck both predecessor bindings after potentially long preparation.
   assert.deepEqual((await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true})).head,before.head,'准备期间Worker前驱改变');
   assert.equal(await sha(path.join(installed,'deployment.json')),djangoBefore,'准备期间Django前驱改变');
   const oldWorker=path.join(runtime,'releases',before.head.releaseId,'tools/worker-local-service.ps1');
   const targetWorker=plan?path.join(runtime,'releases',plan.candidateReleaseId,'tools/worker-local-service.ps1'):oldWorker;
   maintenanceStarted=true;
   if(!components.django){
    const drained=await step('排空前端请求',oldWorker,'BeginWorkerDrain',['-MaintenanceId',maintenanceId]);
    assert.equal(drained.status,'worker_drained');assert.equal(drained.maintenanceId,maintenanceId);assert.equal(drained.drainConfirmed,true);assert.equal(drained.backendStopped,false);
    await step('停止旧前端',oldWorker,'StopForRelease',['-MaintenanceId',maintenanceId]);
   }else{
    // Wait for the shared report lock once, then call the complete native entry.
    const admission={version:'manual-maintenance-first-attempt-v1',workerScript:oldWorker,workerScriptSha256:await sha(oldWorker),workerReceiptSha256:await sha(path.join(runtime,'state/worker-process.json')),djangoManifestSha256:djangoBefore,maintenanceId,preparedAt:new Date().toISOString()};
    const admissionPath=path.join(out,'maintenance-admission.json');await save('maintenance-admission.json',admission);
    const entered=await step('进入维护',path.join(source,'tools/manual-maintenance-start.ps1'),'EnterMaintenance',['-InputPath',admissionPath,'-InputSha256',await sha(admissionPath)]);
    assert.equal(entered.status,'maintenance');assert.equal(entered.maintenanceId,maintenanceId);assert.equal(entered.postgresPreserved,true);
    await step('停止旧前端',oldWorker,'Stop');
    await step('部署后台',path.join(source,'tools/django-local-service.ps1'),'DeployApp',['-PreparedAppId',pkg.id,'-PreparedAppSha256',pkg.receiptSha256],{json:false});
    assert.equal(await sha(path.join(installed,'deployment.json')),djangoExpected,'后台部署manifest不匹配');
    await step('应用后台权限',path.join(installed,'tools/django-local-service.ps1'),'HardenAcl',[],{json:false});
   }
   if(plan){
    phase='切换前端';progress.begin(phase);await save('WorkerApply-started.json',{planSha256:plan.planSha256});
    const applied=await rotation.applyApprovedRotationPlan({approvedPlanSha256:plan.planSha256,rotationLease});
    await save('WorkerApply-result.json',applied);assert.ok(['activated','already_activated'].includes(applied.status));assert.equal(applied.releaseId,plan.candidateReleaseId);progress.complete();
   }
   if(components.django){const ended=await step('退出维护',targetWorker,'ExitMaintenance',['-MaintenanceId',maintenanceId]);assert.equal(ended.status,'maintenance_ended');assert.equal(ended.maintenanceId,maintenanceId);}
   const started=await step('启动服务',targetWorker,'Start',components.django?[]:['-BackendStartPolicy','RequireReady']);
   assert.ok(['started','already_running'].includes(started.status));assert.equal(started.manifestSha256,plan?.candidateManifestSha256??before.head.manifestSha256);
   if(!components.django){const ended=await step('结束前端排空',targetWorker,'EndWorkerDrain',['-MaintenanceId',maintenanceId]);assert.equal(ended.status,'worker_drain_ended');assert.equal(ended.maintenanceId,maintenanceId);}
   const startup=await step('确认启动版本',targetWorker,'VerifyStartup');assert.equal(startup.startupVerified,true);
   phase='确认服务可用';progress.begin(phase);
   const after=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});
   assert.equal(after.head.releaseId,plan?.candidateReleaseId??before.head.releaseId);
   assert.equal(after.head.manifestSha256,plan?.candidateManifestSha256??before.head.manifestSha256);
   assert.equal(await sha(path.join(installed,'deployment.json')),djangoExpected,'最终后台manifest不匹配');
   await ready();progress.complete();
   const receipt={status:'deployed_and_ready',at:new Date().toISOString(),mainCommit:request.mainCommit,components:request.components,workerRelease:after.head.releaseId,workerManifestSha256:after.head.manifestSha256,djangoManifestSha256:djangoExpected,source,sourceTree:identity.tree??null,djangoPreparedId:pkg?.id??null,maintenanceId,migration:null,backupPerformed:false};
   await save('SUCCESS.json',receipt);
   progress.success('main版本：'+request.mainCommit+'；步骤详细日志：'+out);
   return {...receipt,receiptPath:path.join(out,'SUCCESS.json')};
  }catch(error){
   await save('FAILED.json',{at:new Date().toISOString(),mainCommit:request.mainCommit,phase,error:String(error.message).slice(0,1600),processEvidence:error.processEvidence??null,maintenanceStarted,automaticRetry:false});
   throw error;
  }
 });
}
