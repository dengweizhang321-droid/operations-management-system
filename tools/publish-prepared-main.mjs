/** Execute one frozen, scoped main delivery using the original native engines. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {assertPublicationReady,waitForPublicationReady,publicationDeadline,readyRequestTimeoutMs,PublicationReadinessError} from './publication-readiness.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {assertFrozenSource} from './frozen-main-source.mjs';
import {createMainPublicationStep} from './publish-main-step.mjs';
import {reconcileMainPiUpgrade,verifyUpgradeReceipt} from './publish-main-pi-reconciliation.mjs';
import {capturePublicationOwner} from './publish-main-owner.mjs';
import {finishMainPublication} from './publish-main-tail.mjs';
import {schemaForRequest,verifyMainSchemaRelease} from './main-schema-release.mjs';
import {continueFirstMaintenance,isFirstMaintenancePredecessor,continuePiMaintenance,isPiMaintenancePredecessor,maintenanceReadiness,piMaintenancePredecessor} from './manual-maintenance-continuation.mjs';

export const piWorkspaceImage='sha256:ab4ee452bfc6f66dedac6e874dec7ed492b687d24f217c75e80fc9535a26bbb2';
export const piBusinessImage='sha256:4466957e80e75b04fedc888029defa897d9d1b26173a3228558ccdadf169486f';
export const piNativeImage='sha256:87e41e7e4d646d779eba8b552a213d5356c4afa935d42dbb618d19fab7e15956';
function verifyPiUpgrade(record,expectedImage=piWorkspaceImage){assert.equal(record?.prepared,true,'缺少已准备Pi Runner升级');assert.equal(record?.started,false,'准备不能启动Runner');assert.match(record.registeredPlanSha256??'',/^[a-f0-9]{64}$/);assert.match(record.sourceSha256??'',/^[a-f0-9]{64}$/);assert.equal(record.image,expectedImage,'Runner升级镜像与本次交付不一致');return record;}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=async file=>{try{await fs.access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const noProgress={begin(){},complete(){},log(){},success(){}};
// Worker source bindings persist the Windows spelling of one frozen source.
// Normalize separators, dot segments and a trailing separator before binding,
// but preserve case: existing prepared packages bind the original spelling and
// windowsPathSha256 already folds case for the identity hash.
export function normalizePreparedSourceRoot(value){
 if(typeof value!=='string'||!/^[A-Za-z]:[\\/]/.test(value))return value;
 let normalized=path.win32.normalize(value.replaceAll('/','\\'));
 if(normalized.length>3)normalized=normalized.replace(/[\\]+$/,'');
 return normalized;
}
export const releaseLeaseVersion='teruisi-release-publication-lease-v1';
export const releaseLeaseTtlMs=18*60*1000;
export function releaseLeasePath(installedRoot){return path.join(path.dirname(installedRoot),'run','release-publication-lease.json');}

// A production CLI invocation either prepares or deploys. Its default must
// never turn a missing package into a build inside the publication attempt.
export function mainPublicationMode(args){
 const prepareOnly=args.includes('--prepare-only');
 const deployOnly=args.includes('--deploy-only');
 assert.ok(!(prepareOnly&&deployOnly),'准备与发布模式不能同时使用');
 return {prepareOnly,deployOnly:!prepareOnly};
}

export async function requireMainPreparation(out){
 if(await exists(path.join(out,'STARTED.json'))&&!await exists(path.join(out,'SUCCESS.json')))
  throw Error('此发布已有STARTED且无SUCCESS，结果未知；禁止自动重试：'+out);
 if(await exists(path.join(out,'SUCCESS.json')))return;
 assert.ok(await exists(path.join(out,'preparation','PREPARED.json')),
  '目标main尚未准备好；先完成 --prepare-only，再执行发布。本次未构建、未部署');
}

export function preparedComponents(request){
 assert.match(request.mainCommit??'',/^[a-f0-9]{40}$/,'发布目标必须是冻结的完整提交');
 schemaForRequest(request);
 assert.ok(Array.isArray(request.components),'缺少发布组件范围');
 assert.ok(request.components.every(c=>c==='worker'||c==='django')&&new Set(request.components).size===request.components.length,'发布组件无效');
 return {worker:request.components.includes('worker'),django:request.components.includes('django')};
}

/** Optional seams runStep/sourceIdentity/sha/fetch are for private fixture engines. */
export async function publishPreparedMain(request,context){
 assert.ok(!(context.prepareOnly&&context.deployOnly),'准备与发布模式不能同时使用');
 // Explicit false is retained for private, in-process orchestration fixtures;
 // omitted mode and every production CLI are deploy-only.
 const deployOnly=context.deployOnly??!context.prepareOnly;
 const components=preparedComponents(request);
 const schema=schemaForRequest(request);
 // Runner host sources are deployed separately from Django, including fixes
 // that do not introduce another database migration. The complete frozen Git
 // diff binds this decision; tests alone do not change the installed Runner.
 const piRuntimeChanged=(request.releasePlan?.changes??[]).some(change=>[change.path,change.before].some(file=>
  typeof file==='string'&&file.startsWith('backend/pi_runner/')&&file.endsWith('.py')&&
  !file.split('/').some(part=>part==='tests'||part.startsWith('test_'))));
 const piUpgradeKind=['PiWorkspace','PiBusiness','PiNative'].includes(schema?.additionKind)?schema.additionKind:piRuntimeChanged?'PiNative':null;
 const piUpgradeRequired=piUpgradeKind!==null;
  // Role contracts can change alongside any schema addition, not just their original additions.
  const aiRolesChanged=(request.releasePlan?.changes??[]).some(change=>[change.path,change.before].includes('backend/ai_assistant/database_contract.py'));
  const inventoryRolesChanged=(request.releasePlan?.changes??[]).some(change=>[change.path,change.before].includes('tools/django-inventory-service.ps1'));
 assert.ok(!piUpgradeRequired||components.django,'Pi Runner升级必须绑定本次Django准备包');
 const piUpgradeImage=piUpgradeKind==='PiNative'?piNativeImage:piUpgradeKind==='PiBusiness'?piBusinessImage:piWorkspaceImage;
 const {out,api,rotation,transport}=context;
 const source=normalizePreparedSourceRoot(context.source);
 const progress=context.progress??noProgress;
 const installed=context.installedRoot??'D:/teruisi-runtime/django-sales/app';
 const runtime=context.workerRuntimeRoot??api.workerRuntimeRoot;
 const sha=context.sha??(async file=>digest(await fs.readFile(file)));
 const sourceIdentity=context.sourceIdentity??(()=>assertFrozenSource({source,mainCommit:request.mainCommit,sourceTree:request.sourceTree}));
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
 const leaseFile=releaseLeasePath(installed);
 let leaseState=null,leaseWarnings=0;
 const leaseWarning=async(phaseName,error)=>{
  leaseWarnings++;
  try{
   await fs.mkdir(out,{recursive:true});
   await fs.writeFile(path.join(out,'LEASE-WARNING.json'),JSON.stringify({version:'teruisi-release-lease-warning-v1',at:new Date().toISOString(),phase:phaseName,error:String(error?.message??error).slice(0,800),attempts:leaseWarnings,fallback:'original-maintenance-drain-gate'},null,2)+'\n');
  }catch{}
 };
 const refreshLease=async phaseName=>{
  if(!leaseState)return;
  leaseState.phase=phaseName;
  const now=new Date(),record={version:releaseLeaseVersion,ownerPid:process.pid,phase:phaseName,createdAt:leaseState.createdAt,updatedAt:now.toISOString(),expiresAt:new Date(now.getTime()+releaseLeaseTtlMs).toISOString(),mainCommit:request.mainCommit,maintenanceId,out},temporary=leaseFile+'.'+randomUUID()+'.tmp';
  try{
   await fs.mkdir(path.dirname(leaseFile),{recursive:true});
   await fs.writeFile(temporary,JSON.stringify(record)+'\n',{flag:'wx'});
   try{await fs.rename(temporary,leaseFile);}catch(error){await fs.unlink(temporary).catch(()=>{});throw error;}
  }catch(error){await leaseWarning(phaseName,error);}
 };
 const beginLease=async()=>{leaseState={createdAt:new Date().toISOString()};await refreshLease(phase);};
 const endLease=async()=>{
  if(!leaseState)return;leaseState=null;
  try{
   const saved=JSON.parse(await fs.readFile(leaseFile,'utf8'));
   if(saved?.ownerPid!==process.pid||saved?.maintenanceId!==maintenanceId)return;
   await fs.unlink(leaseFile);
  }catch(error){if(error.code!=='ENOENT')await leaseWarning('清理发布租约',error);}
 };
 const step=createMainPublicationStep({out,request,api,transport,runStep:context.runStep,progress,phase:label=>{phase=label;},refreshLease});
 const deadlineUnixMs=publicationDeadline(context.deadlineUnixMs??process.env.TERUISI_PROCESS_DEADLINE_UNIX_MS);
 const ready=()=>assertPublicationReady({fetchImpl:context.fetch??fetch,deadlineUnixMs,timeoutMs:readyRequestTimeoutMs});
 let observationWrites=Promise.resolve();
 // Only the tail opts into waiting; an existing SUCCESS still uses one probe.
 const waitReady=()=>waitForPublicationReady({...context.readinessWaitOptions,fetchImpl:context.fetch??fetch,deadlineUnixMs,
  onObservation:observation=>{
   const line=JSON.stringify({at:new Date().toISOString(),mainCommit:request.mainCommit,...observation})+'\n';
   observationWrites=observationWrites.then(()=>fs.appendFile(path.join(out,'readiness-observations.jsonl'),line))
    .catch(()=>{try{progress.log('就绪诊断记录未能写入；继续按原就绪结果判定。');}catch{}});
  }});
 const preparationDeadline=Math.min(Date.now()+1800000,Number(process.env.TERUISI_PROCESS_DEADLINE_UNIX_MS)||Infinity);
 const preparationWait=context.prepareOnly?{requestId:digest(Buffer.from(JSON.stringify(request))),deadlineUnixMs:preparationDeadline}:undefined;
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
  const preparationFile=path.join(preparationOut,'PREPARED.json');
  const requestSha256=digest(Buffer.from(JSON.stringify(request)));
  let publicationStarted=false,workerDrainOpen=false;
  const oldWorker=path.join(runtime,'releases',before.head.releaseId,'tools/worker-local-service.ps1');
  try{
   await beginLease();
   if(schema)await (context.verifySchemaRelease??(()=>verifyMainSchemaRelease(request,source)))();
   await refreshLease(phase);
   let plan=null,pkg=null,piRunnerUpgrade=null,piUpgradeReceipt=null,reusedPreparation=false,djangoExpected=djangoBefore;
   if(await exists(preparationFile)){
    reusedPreparation=true;const prepared=await read(preparationFile);
    assert.equal(prepared.version,'teruisi-main-preparation-v1');
    assert.equal(prepared.requestSha256,requestSha256,'准备包的请求已变化');
    assert.deepEqual(prepared.sourceIdentity,identity,'准备包的源码版本已变化');
    plan=prepared.workerPlan;pkg=prepared.djangoPackage;djangoExpected=prepared.djangoManifestSha256;
    if(piUpgradeRequired)piRunnerUpgrade=verifyPiUpgrade(prepared.piRunnerUpgrade,piUpgradeImage);
    assert.equal(Boolean(plan),components.worker,'准备包Worker范围不一致');
    assert.equal(Boolean(pkg),components.django,'准备包Django范围不一致');
    // Cheap predecessor/controller qualification must fail before the expensive
    // Worker and prepared-app verification. The full readiness check stays at
    // the pre-STARTED boundary so dynamic facts are still fresh.
    if(components.django&&!context.prepareOnly){
     phase='核对维护前驱资格';progress.begin(phase);
     await (context.maintenanceReadiness??maintenanceReadiness)({source,head:before.head,djangoManifestSha256:djangoBefore,installed,runtime,sha});
     progress.complete();
    }
    if(plan){
     phase='复验已准备前端';progress.begin(phase);
     const bindingFile=path.join(preparationOut,'source-binding.json');
     assert.equal((await read(bindingFile)).sourceRoot,source,'前端准备包来源不属于本次main');
     await refreshLease(phase);
     const verified=await rotation.planWorkerReleaseRotation({prepareOnline:true,reusePlanSha256:plan.planSha256,sourceBindingFile:bindingFile,sourceBindingSha256:await sha(bindingFile),rotationLease});
     await refreshLease(phase);
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
    assert.ok(!deployOnly,'目标main尚未准备好；先完成 --prepare-only，再执行发布。本次未部署');
    if(await exists(path.join(preparationOut,'PREPARING.json')))throw Error('准备包有未完成记录，请查看原准备日志，不能自动重放：'+preparationOut);
    await fs.writeFile(path.join(preparationOut,'PREPARING.json'),JSON.stringify({at:new Date().toISOString(),requestSha256,sourceIdentity:identity}),{flag:'wx'});
   if(components.worker){
    phase='构建前端';progress.begin(phase);
    const preparationIdentity=await api.workerPreparationIdentity(source);
    const binding={version:api.workerSourceBindingVersion,sourceRoot:source,sourceRootPathSha256:api.windowsPathSha256(source),predecessor:before.head,predecessorChainStateSha256:before.chainStateSha256,identity:preparationIdentity};
    const raw=api.canonicalJson(binding)+'\n',bindingFile=path.join(preparationOut,'source-binding.json');
    await fs.writeFile(bindingFile,raw,{flag:'wx'});
    await refreshLease(phase);
    plan=await rotation.planWorkerReleaseRotation({prepareOnline:true,sourceBindingFile:bindingFile,sourceBindingSha256:digest(Buffer.from(raw)),rotationLease});
    await refreshLease(phase);
    await fs.writeFile(path.join(preparationOut,'worker-plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});assert.equal(plan.status,'planned');progress.complete();
   }
   if(components.django){
    pkg=await step('准备后台',path.join(source,'tools/django-local-service.ps1'),'PrepareApp',schemaArgs,{directory:preparationOut});
    assert.match(pkg.id??'',/^[a-f0-9]{32}$/,'后台准备ID无效');assert.match(pkg.receiptSha256??'',/^[a-f0-9]{64}$/,'后台准备凭证无效');
    djangoExpected=await sha(path.join(path.dirname(installed),'app.deploy-'+pkg.id,'deployment.json'));
   }
    if(piUpgradeRequired){
     piRunnerUpgrade=verifyPiUpgrade(await step('准备Pi Runner升级',path.join(source,'tools/django-ai.ps1'),'PreparePiUpgrade',['-PiImage',piUpgradeImage,...(piUpgradeKind==='PiNative'?['-PiSkillVersion','1.3.0']:piUpgradeKind==='PiBusiness'?['-PiSkillVersion','1.2.0']:[]),'-PiPreparedAppId',pkg.id,'-PiPreparedAppSha256',pkg.receiptSha256],{directory:preparationOut}),piUpgradeImage);
    }
    assert.deepEqual(await sourceIdentity(),identity,'打包期间源码变化');
    assert.deepEqual((await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true})).head,before.head,'准备期间Worker前驱改变');
    assert.equal(await sha(path.join(installed,'deployment.json')),djangoBefore,'准备期间Django前驱改变');
    await refreshLease(phase);
    if(schema)await (context.verifySchemaRelease??(()=>verifyMainSchemaRelease(request,source)))();
    await refreshLease(phase);
   if(piRunnerUpgrade){
    const checked=await step('复验Pi Runner升级计划',path.join(source,'tools/django-ai.ps1'),'PiUpgradeCheck',['-PiUpgradePlanSha256',piRunnerUpgrade.registeredPlanSha256,'-PiPreparedAppId',pkg.id,'-PiPreparedAppSha256',pkg.receiptSha256],{directory:await fs.mkdtemp(path.join(preparationOut,'pi-check-'))});
    assert.equal(checked.checked,true);verifyPiUpgrade(checked,piUpgradeImage);assert.equal(checked.registeredPlanSha256,piRunnerUpgrade.registeredPlanSha256);assert.equal(checked.sourceSha256,piRunnerUpgrade.sourceSha256);
   }
    const temporary=preparationFile+'.'+randomUUID()+'.tmp';
    await fs.writeFile(temporary,JSON.stringify({version:'teruisi-main-preparation-v1',at:new Date().toISOString(),requestSha256,sourceIdentity:identity,workerPlan:plan,djangoPackage:pkg,djangoManifestSha256:djangoExpected,...(piRunnerUpgrade?{piRunnerUpgrade}:{})},null,2)+'\n',{flag:'wx'});
    await fs.rename(temporary,preparationFile);
   }
   if(piRunnerUpgrade&&reusedPreparation){
    const checked=await step('复验Pi Runner升级计划',path.join(source,'tools/django-ai.ps1'),'PiUpgradeCheck',['-PiUpgradePlanSha256',piRunnerUpgrade.registeredPlanSha256,'-PiPreparedAppId',pkg.id,'-PiPreparedAppSha256',pkg.receiptSha256],{directory:await fs.mkdtemp(path.join(preparationOut,'pi-check-'))});
    assert.equal(checked.checked,true);verifyPiUpgrade(checked,piUpgradeImage);assert.equal(checked.registeredPlanSha256,piRunnerUpgrade.registeredPlanSha256);assert.equal(checked.sourceSha256,piRunnerUpgrade.sourceSha256);
   }
   if(context.prepareOnly){
    await endLease();
    progress.log('打包完成，等待发布负责人执行。目标main：'+request.mainCommit+'；准备记录：'+preparationFile);
    return {status:'prepared-only',mainCommit:request.mainCommit,publicationPerformed:false,preparationFile};
   }
   // Recheck both predecessor bindings after potentially long preparation.
   assert.deepEqual((await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true})).head,before.head,'准备期间Worker前驱改变');
   assert.equal(await sha(path.join(installed,'deployment.json')),djangoBefore,'准备期间Django前驱改变');
   await refreshLease(phase);
   if(schema)await (context.verifySchemaRelease??(()=>verifyMainSchemaRelease(request,source)))();
   await refreshLease(phase);
   const readiness=components.django?await (context.maintenanceReadiness??maintenanceReadiness)({source,head:before.head,djangoManifestSha256:djangoBefore,installed,runtime,sha}):null;
   await refreshLease(phase);
   if(readiness){
    const directory=await fs.mkdtemp(path.join(out,'maintenance-preflight-')),file=path.join(directory,'readiness.json');
    await fs.writeFile(file,JSON.stringify(readiness,null,2)+'\n',{flag:'wx'});
    const checked=await step('维护前只读检查',path.join(source,'tools/manual-maintenance-preflight.ps1'),'Check',['-InputPath',file,'-InputSha256',await sha(file)],{directory});
    assert.equal(checked.ready,true,'维护恢复入口尚未就绪');assert.equal(checked.route,readiness.route,'维护前检查路线变化');
   }
   // Assemble all inputs that can fail due to missing materials before STARTED.
   // This inventory explains existing evidence; it is not another admission.
   const targetWorker=plan?path.join(runtime,'releases',plan.candidateReleaseId,'tools/worker-local-service.ps1'):oldWorker;
   let maintenanceMaterials=null;
   const workerEntries=[];
   for(const file of new Set([oldWorker,targetWorker]))workerEntries.push({file,sha256:await sha(file)});
   if(components.django){
    const originalRequest=path.join(out,'maintenance-first-request.json'),requestRaw=JSON.stringify(request);
    if(await exists(originalRequest))assert.equal(await fs.readFile(originalRequest,'utf8'),requestRaw,'维护前原请求已变化');
    else await fs.writeFile(originalRequest,requestRaw,{flag:'wx'});
    const pandasConfig=path.join(path.dirname(installed),'config/pandas-sandbox.json');
    maintenanceMaterials={version:'manual-maintenance-first-attempt-v2',workerScript:oldWorker,workerScriptSha256:await sha(oldWorker),workerReceiptSha256:await sha(path.join(runtime,'state/worker-process.json')),djangoManifestSha256:djangoBefore,maintenanceId,source,sourceCommit:identity.commit,sourceTree:identity.tree??null,sourcePins:readiness.sourcePins,attempt:out,requestSha256,rotationOwnerPid:process.pid,releaseId:before.head.releaseId,workerManifestSha256:before.head.manifestSha256,djangoScriptSha256:await sha(path.join(installed,'tools/django-local-service.ps1')),pandasConfigSha256:await exists(pandasConfig)?await sha(pandasConfig):null,
     readinessRoute:readiness.route,maintenanceReadiness:readiness,...(readiness.route==='pi19db'?{djangoAiScriptSha256:piMaintenancePredecessor.djangoAiScriptSha256,piWorkerReceiptSha256:readiness.piWorkerReceiptSha256,piWorkerIdentity:readiness.piWorkerIdentity,piConfigurationSha256:readiness.piConfigurationSha256}:{})};
    maintenanceMaterials.workerTransportSha256=await sha(path.join(path.dirname(oldWorker),'process-deadline.ps1'));
   }
   const materialsFile=path.join(await fs.mkdtemp(path.join(out,'publication-materials-')),'inventory.json');
   await fs.writeFile(materialsFile,JSON.stringify({version:'teruisi-publication-materials-v1',diagnosticOnly:true,at:new Date().toISOString(),mainCommit:request.mainCommit,sourceIdentity:identity,requestSha256,components:request.components,preparation:{file:preparationFile,sha256:await sha(preparationFile),reused:reusedPreparation,workerPlanSha256:plan?.planSha256??null,djangoPackage:pkg??null,djangoManifestSha256:djangoExpected},predecessor:{worker:before.head,chainStateSha256:before.chainStateSha256,djangoManifestSha256:djangoBefore},workerEntries,maintenanceReadiness:readiness,schemaRelease:schema},null,2)+'\n',{flag:'wx'});
   progress.log('维护前材料已齐备；复用仍有效的原生准备结果，现场身份、锁与排空仍即时检查。材料清单：'+materialsFile);
   assert.deepEqual(await sourceIdentity(),identity,'维护前冻结源码变化');
   await refreshLease(phase);
   const publisherOwner=context.runStep?null:await capturePublicationOwner();
   await save('STARTED.json',{resumeProtocol:'teruisi-pi-main-resume-v1',publisherOwner,at:new Date().toISOString(),mainCommit:request.mainCommit,components:request.components,maintenanceId,source,sourceTree:identity.tree??null,requestSha256,predecessorChainStateSha256:before.chainStateSha256,...(schema?{operationId,schemaRelease:schema}:{})});
   publicationStarted=true;
   maintenanceStarted=true;
   if(!components.django){
    // The gate may be persisted before BeginWorkerDrain returns or throws.
    workerDrainOpen=true;
    const drained=await step('排空前端请求',oldWorker,'BeginWorkerDrain',['-MaintenanceId',maintenanceId]);
    assert.equal(drained.status,'worker_drained');assert.equal(drained.maintenanceId,maintenanceId);assert.equal(drained.drainConfirmed,true);assert.equal(drained.backendStopped,false);
    // CancelDrain does not check Worker state: close this window before stop.
    workerDrainOpen=false;
    await step('停止旧前端',oldWorker,'StopForRelease',['-MaintenanceId',maintenanceId]);
   }else{
    // Wait for the shared report lock once, then call the complete native entry.
    const admission={...maintenanceMaterials,preparedAt:new Date().toISOString(),startedSha256:await sha(path.join(out,'STARTED.json'))};
    const admissionPath=path.join(out,'maintenance-admission.json');await save('maintenance-admission.json',admission);
    const admissionSha256=await sha(admissionPath);
    let entered;
    try{entered=await step('进入维护',path.join(source,'tools/manual-maintenance-start.ps1'),'EnterMaintenance',['-InputPath',admissionPath,'-InputSha256',admissionSha256]);}
    catch(error){
     const actorFile=path.join(out,'maintenance-first-actor.json');
     await save('maintenance-first-FAILED.json',{at:new Date().toISOString(),maintenanceId,admissionSha256,originalActorSha256:await exists(actorFile)?await sha(actorFile):null,error:String(error.message).slice(0,1600),processEvidence:error.processEvidence??null,automaticRetry:false});
     const continuation=isPiMaintenancePredecessor(before.head,djangoBefore)?continuePiMaintenance:isFirstMaintenancePredecessor(before.head,djangoBefore)?continueFirstMaintenance:null;
     if(!continuation)throw error;
     entered=await continuation({admission,admissionPath,admissionSha256,originalFailureSha256:await sha(path.join(out,'maintenance-first-FAILED.json')),step,recheck:async()=>{
      await rotation.assertActiveBatchOwnership(runtime);
      const current=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});
      assert.deepEqual(current.head,before.head,'首次维护期间前驱变化');assert.equal(current.chainStateSha256,before.chainStateSha256,'首次维护期间前驱链变化');
      assert.equal(await sha(path.join(installed,'deployment.json')),djangoBefore,'首次维护期间Django变化');
      assert.deepEqual(await sourceIdentity(),identity,'首次维护期间源码变化');
     }});
    }
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
    if(schema.additionKind==='TmallWarehouse'||inventoryRolesChanged)await step('配置天猫库存权限',path.join(installed,'tools/django-inventory-service.ps1'),'ProvisionRoles',[],{json:false});
    if(['PiAgent','PiWorkspace','PiBusiness','PiNative','AiTaskFeedbackCandidates','AiUnifiedTasks'].includes(schema.additionKind)||aiRolesChanged)await step('配置Pi运行账本权限',path.join(installed,'tools/django-ai.ps1'),'ProvisionRoles',[],{json:false});
    const finalized=await step('完成结构迁移',path.join(installed,'tools/bi-app-adopt.ps1'),'Finalize',adoption,{addJson:false});
    assert.equal(finalized.status,'verified');assert.equal(finalized.result.status,'verified');assert.equal(finalized.result.migrationCount,schema.toGeneration);assert.deepEqual(finalized.result.steps,schema.steps);
    schemaReceipt={operationId,maintenanceId,release:schema,installed:installedSchema,finalized};
   }
   if(piRunnerUpgrade){
    try{piUpgradeReceipt=verifyUpgradeReceipt(await step('升级Pi Runner',path.join(installed,'tools/django-ai.ps1'),'UpgradePi',['-PiUpgradePlanSha256',piRunnerUpgrade.registeredPlanSha256]),piRunnerUpgrade);}
    catch(error){
     await save('PiUpgrade-original-failure.json',{at:new Date().toISOString(),error:String(error.message).slice(0,800),processEvidence:error.processEvidence??null});
     try{piUpgradeReceipt=await reconcileMainPiUpgrade({prepared:piRunnerUpgrade,installed,out,step,originalError:error,requireDirectExit:!context.runStep,requireReconcileDirectExit:!context.runStep});}
     catch(reconciliationError){reconciliationError.message=String(error.message)+'；Pi协调未闭合：'+reconciliationError.message;throw reconciliationError;}
    }
    await save('PiUpgrade-completed.json',{at:new Date().toISOString(),registeredPlanSha256:piRunnerUpgrade.registeredPlanSha256,value:piUpgradeReceipt});
   }
   return await finishMainPublication({request,components,source,identity,installed,out,api,rotation,rotationLease,before,plan,pkg,djangoExpected,maintenanceId,schema,schemaReceipt,piUpgradeReceipt,step,save,sha,ready,waitReady,refreshLease,endLease,progress,phase:label=>{phase=label;}});
  }catch(error){
   const failure={at:new Date().toISOString(),mainCommit:request.mainCommit,phase,error:String(error.message).slice(0,1600),processEvidence:error.processEvidence??null,maintenanceStarted,automaticRetry:false};
   if(error instanceof PublicationReadinessError)failure.readiness=error.readiness;
   // Deliberate exception to no automatic cleanup: only the pre-stop drain.
   // maintenanceStarted means STARTED was saved, not that drain completed.
   if(publicationStarted&&!components.django&&workerDrainOpen){
    try{
     await step('取消前端排空',oldWorker,'CancelDrain',['-MaintenanceId',maintenanceId]);
     failure.drainCancelled=true;
    }catch(cancelError){
     failure.drainCancelled=false;
     failure.drainCancelError=String(cancelError.message).slice(0,1600);
     failure.drainCancelManualHandlingRequired=true;
     try{progress.log('取消前端排空失败，需人工核对原排空状态；本次发布仍失败，不可自动重试。');}catch{}
    }
   }
   await endLease();
   // Preserve every preparation rejection without turning it into a deployment.
   if(publicationStarted)await save('FAILED.json',failure);
   else await fs.writeFile(path.join(preparationOut,'FAILED-'+randomUUID()+'.json'),JSON.stringify(failure,null,2)+'\n',{flag:'wx'});
   throw error;
  }
 },preparationWait);
}
