/** Execute one frozen, scoped main delivery using the original native engines. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {manualStepCommand} from './publish-main-command.mjs';
import {schemaForRequest,verifyMainSchemaRelease} from './main-schema-release.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=async file=>{try{await fs.access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const noProgress={begin(){},complete(){},log(){},success(){}};

export function preparedComponents(request){
 assert.match(request.mainCommit??'',/^[a-f0-9]{40}$/,'发布目标必须是冻结的完整提交');
 schemaForRequest(request);
 assert.ok(Array.isArray(request.components),'缺少发布组件范围');
 assert.ok(request.components.every(c=>c==='worker'||c==='django')&&new Set(request.components).size===request.components.length,'发布组件无效');
 return {worker:request.components.includes('worker'),django:request.components.includes('django')};
}

/** Optional seams runStep/sourceIdentity/sha/fetch are for private fixture engines. */
export async function publishPreparedMain(request,context){
 const components=preparedComponents(request);
 const schema=schemaForRequest(request);
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
 const preparationOut=path.join(out,'preparation');
 await fs.mkdir(preparationOut,{recursive:true});
 const save=(name,value)=>fs.writeFile(path.join(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
 const maintenanceId=randomUUID().replaceAll('-','');
 const operationId=schema?randomUUID().replaceAll('-',''):null;
 const schemaArgs=schema?['-IntegrationEvidencePath',schema.evidencePath,'-IntegrationEvidenceSha256',schema.evidenceSha256]:[];
 const adoption=schema?['-AdditionKind',schema.additionKind,'-SourceRoot',source,'-OperationId',operationId,'-MaintenanceId',maintenanceId,'-SchemaOnly','-Execute']:[];
 let phase='核对前驱',maintenanceStarted=false;
 const step=async(label,script,action,extra=[],{json=true,addJson=true,directory=out}={})=>{
  phase=label;progress.begin(label);
  const record=(name,value)=>fs.writeFile(path.join(directory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  await record(label+'-started.json',{at:new Date().toISOString(),script,action,extra});
  let value;
  if(context.runStep)value=await context.runStep({label,script,action,extra,json,addJson});
  else{
   const command=manualStepCommand({systemHost:'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',powerShellDirectory:request.pwshDirectory,script,action,extra,addJson});
   const result=await api.runProcess(command.host,transport.productionCommandArguments(command.host,command.args),{cwd:path.dirname(script),env:transport.productionCommandEnvironment(command.host),timeoutMs:1800000,outputProtocol:'direct-exit-files',cleanup:'preserve',label:'manual-main-'+label});
   await fs.writeFile(path.join(directory,label+'.stdout.log'),result.stdout,{flag:'wx'});
   await fs.writeFile(path.join(directory,label+'.stderr.log'),result.stderr,{flag:'wx'});
   value=json?JSON.parse(result.stdout.trim()):null;
   await record(label+'-process.json',{processEvidence:result.processEvidence});
  }
  await record(label+'-result.json',{at:new Date().toISOString(),value});progress.complete();return value;
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
   if(schema){assert.equal(receipt.migration,schema.steps[0],'成功凭证缺少本次结构迁移');assert.deepEqual(receipt.schemaReceipt?.release,schema,'成功凭证结构发布范围不一致');assert.equal(receipt.schemaReceipt?.maintenanceId,receipt.maintenanceId);assert.match(receipt.schemaReceipt?.operationId??'',/^[a-f0-9]{32}$/);}
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
  if(schema)await (context.verifySchemaRelease??(()=>verifyMainSchemaRelease(request,source)))();
  const preparationFile=path.join(preparationOut,'PREPARED.json');
  const requestSha256=digest(Buffer.from(JSON.stringify(request)));
  let publicationStarted=false;
  try{
   let plan=null,pkg=null,djangoExpected=djangoBefore;
   if(await exists(preparationFile)){
    const prepared=await read(preparationFile);
    assert.equal(prepared.version,'teruisi-main-preparation-v1');
    assert.equal(prepared.requestSha256,requestSha256,'准备包的请求已变化');
    assert.deepEqual(prepared.sourceIdentity,identity,'准备包的源码版本已变化');
    plan=prepared.workerPlan;pkg=prepared.djangoPackage;djangoExpected=prepared.djangoManifestSha256;
    assert.equal(Boolean(plan),components.worker,'准备包Worker范围不一致');
    assert.equal(Boolean(pkg),components.django,'准备包Django范围不一致');
    if(plan){
     phase='复验已准备前端';progress.begin(phase);
     const bindingFile=path.join(preparationOut,'source-binding.json');
     assert.equal((await read(bindingFile)).sourceRoot,source,'前端准备包来源不属于本次main');
     const verified=await rotation.planWorkerReleaseRotation({prepareOnline:true,reusePlanSha256:plan.planSha256,sourceBindingFile:bindingFile,sourceBindingSha256:await sha(bindingFile),rotationLease});
     assert.equal(verified.planSha256,plan.planSha256);assert.equal(verified.candidateManifestSha256,plan.candidateManifestSha256);
     assert.equal(verified.candidateReleaseId,plan.candidateReleaseId);progress.complete();
    }
    if(pkg){
     assert.match(pkg.id??'',/^[a-f0-9]{32}$/);assert.match(pkg.receiptSha256??'',/^[a-f0-9]{64}$/);
     assert.equal(await sha(path.join(path.dirname(installed),'app.prepare-'+pkg.id+'.json')),pkg.receiptSha256,'后台准备凭证变化');
     assert.equal(await sha(path.join(path.dirname(installed),'app.deploy-'+pkg.id,'deployment.json')),djangoExpected,'后台准备包变化');
     const verifiedDirectory=await fs.mkdtemp(path.join(preparationOut,'verify-'));
     const verified=await step('复验已准备后台',path.join(source,'tools/django-local-service.ps1'),'VerifyPreparedApp',['-PreparedAppId',pkg.id,'-PreparedAppSha256',pkg.receiptSha256],{directory:verifiedDirectory});
     assert.equal(verified.status,'prepared_verified');assert.equal(verified.id,pkg.id);
    }
    progress.log('复用本次main已准备的包，不再构建或安装依赖。');
   }else{
    assert.ok(!context.deployOnly,'目标main尚未准备好，请等待自动打包完成，或运行准备main.bat；本次未部署');
    if(await exists(path.join(preparationOut,'PREPARING.json')))throw Error('准备包有未完成记录，请查看原准备日志，不能自动重放：'+preparationOut);
    await fs.writeFile(path.join(preparationOut,'PREPARING.json'),JSON.stringify({at:new Date().toISOString(),requestSha256,sourceIdentity:identity}),{flag:'wx'});
   if(components.worker){
    phase='构建前端';progress.begin(phase);
    const preparationIdentity=await api.workerPreparationIdentity(source);
    const binding={version:api.workerSourceBindingVersion,sourceRoot:source,sourceRootPathSha256:api.windowsPathSha256(source),predecessor:before.head,predecessorChainStateSha256:before.chainStateSha256,identity:preparationIdentity};
    const raw=api.canonicalJson(binding)+'\n',bindingFile=path.join(preparationOut,'source-binding.json');
    await fs.writeFile(bindingFile,raw,{flag:'wx'});
    plan=await rotation.planWorkerReleaseRotation({prepareOnline:true,sourceBindingFile:bindingFile,sourceBindingSha256:digest(Buffer.from(raw)),rotationLease});
    await fs.writeFile(path.join(preparationOut,'worker-plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});assert.equal(plan.status,'planned');progress.complete();
   }
   if(components.django){
    pkg=await step('准备后台',path.join(source,'tools/django-local-service.ps1'),'PrepareApp',schemaArgs,{directory:preparationOut});
    assert.match(pkg.id??'',/^[a-f0-9]{32}$/,'后台准备ID无效');assert.match(pkg.receiptSha256??'',/^[a-f0-9]{64}$/,'后台准备凭证无效');
    djangoExpected=await sha(path.join(path.dirname(installed),'app.deploy-'+pkg.id,'deployment.json'));
   }
    assert.deepEqual(await sourceIdentity(),identity,'打包期间源码变化');
    assert.deepEqual((await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true})).head,before.head,'准备期间Worker前驱改变');
    assert.equal(await sha(path.join(installed,'deployment.json')),djangoBefore,'准备期间Django前驱改变');
    if(schema)await (context.verifySchemaRelease??(()=>verifyMainSchemaRelease(request,source)))();
    const temporary=preparationFile+'.'+randomUUID()+'.tmp';
    await fs.writeFile(temporary,JSON.stringify({version:'teruisi-main-preparation-v1',at:new Date().toISOString(),requestSha256,sourceIdentity:identity,workerPlan:plan,djangoPackage:pkg,djangoManifestSha256:djangoExpected},null,2)+'\n',{flag:'wx'});
    await fs.rename(temporary,preparationFile);
   }
   if(context.prepareOnly){
    progress.log('打包完成，等待手动发布。目标main：'+request.mainCommit+'；准备记录：'+preparationFile);
    return {status:'prepared-only',mainCommit:request.mainCommit,publicationPerformed:false,preparationFile};
   }
   // Recheck both predecessor bindings after potentially long preparation.
   assert.deepEqual((await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true})).head,before.head,'准备期间Worker前驱改变');
   assert.equal(await sha(path.join(installed,'deployment.json')),djangoBefore,'准备期间Django前驱改变');
   if(schema)await (context.verifySchemaRelease??(()=>verifyMainSchemaRelease(request,source)))();
   await save('STARTED.json',{at:new Date().toISOString(),mainCommit:request.mainCommit,components:request.components,maintenanceId,source,sourceTree:identity.tree??null,...(schema?{operationId,schemaRelease:schema}:{})});
   publicationStarted=true;
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
    if(schema)await step('登记结构迁移',path.join(source,'tools/bi-app-adopt.ps1'),'Plan',[...adoption,'-PreparedAppId',pkg.id,'-PreparedAppSha256',pkg.receiptSha256,'-CandidateEvidencePath',schema.evidencePath,'-CandidateEvidenceSha256',schema.evidenceSha256],{addJson:false});
    await step('部署后台',path.join(source,'tools/django-local-service.ps1'),'DeployApp',['-PreparedAppId',pkg.id,'-PreparedAppSha256',pkg.receiptSha256,...(schema?['-IntegrationOperationId',operationId,...schemaArgs]:[])],{json:false});
    assert.equal(await sha(path.join(installed,'deployment.json')),djangoExpected,'后台部署manifest不匹配');
    await step('应用后台权限',path.join(installed,'tools/django-local-service.ps1'),'HardenAcl',[],{json:false});
   }
   let schemaReceipt=null;
   if(schema){
    const installedSchema=await step('迁移监控字段',path.join(installed,'tools/bi-app-adopt.ps1'),'Install',adoption,{addJson:false});
    assert.equal(installedSchema.status,'verified');assert.equal(installedSchema.result.status,'schema_installed');assert.equal(installedSchema.result.migrationCount,schema.toGeneration);
    assert.deepEqual(installedSchema.result.steps,schema.steps);
    if(schema.additionKind==='TmallWarehouse')await step('配置天猫库存权限',path.join(installed,'tools/django-inventory-service.ps1'),'ProvisionRoles',[],{json:false});
    if(schema.additionKind==='PiAgent')await step('配置Pi运行账本权限',path.join(installed,'tools/django-ai.ps1'),'ProvisionRoles',[],{json:false});
    const finalized=await step('完成结构迁移',path.join(installed,'tools/bi-app-adopt.ps1'),'Finalize',adoption,{addJson:false});
    assert.equal(finalized.status,'verified');assert.equal(finalized.result.status,'verified');assert.equal(finalized.result.migrationCount,schema.toGeneration);assert.deepEqual(finalized.result.steps,schema.steps);
    schemaReceipt={operationId,maintenanceId,release:schema,installed:installedSchema,finalized};
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
   const receipt={status:'deployed_and_ready',at:new Date().toISOString(),mainCommit:request.mainCommit,components:request.components,workerRelease:after.head.releaseId,workerManifestSha256:after.head.manifestSha256,djangoManifestSha256:djangoExpected,source,sourceTree:identity.tree??null,djangoPreparedId:pkg?.id??null,maintenanceId,migration:schema?.steps[0]??null,...(schemaReceipt?{schemaReceipt}:{}),backupPerformed:false};
   await save('SUCCESS.json',receipt);
   progress.success('main版本：'+request.mainCommit+'；步骤详细日志：'+out);
   return {...receipt,receiptPath:path.join(out,'SUCCESS.json')};
  }catch(error){
   const failure={at:new Date().toISOString(),mainCommit:request.mainCommit,phase,error:String(error.message).slice(0,1600),processEvidence:error.processEvidence??null,maintenanceStarted,automaticRetry:false};
   // Preserve every preparation rejection without turning it into a deployment.
   if(publicationStarted)await save('FAILED.json',failure);
   else await fs.writeFile(path.join(preparationOut,'FAILED-'+randomUUID()+'.json'),JSON.stringify(failure,null,2)+'\n',{flag:'wx'});
   throw error;
  }
 });
}
