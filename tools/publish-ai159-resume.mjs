/** One-time recovery of the already deployed AI159 publication e030caba1271. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assertFrozenSource} from './frozen-main-source.mjs';
import {schemaForRequest} from './main-schema-release.mjs';
import {assertControlGeneration,readAdoptedControl} from './main-control-dispatch.mjs';
import {assertOrdinaryIdentity,currentPreparationIdentity,taskHost} from './main-prebuild-task.mjs';
import {acquireMainPublicationQueue,publisherEnvironment} from './publish-latest-main.mjs';
import {assertPublicationReady,publicationDeadline,waitForPublicationReady} from './publication-readiness.mjs';
import {manualStepCommand} from './publish-main-command.mjs';
import {resumeAi159OriginalTail} from './publish-main-resume.mjs';
import {mainResumeCatalog} from './publish-main-status.mjs';
import {createMainPublicationStep} from './publish-main-step.mjs';

const protocol='teruisi-ai159-e030caba-pi-recovery-v1';
const mainCommit='e030caba1271d47fced663649f288855234a02e2';
const operationId='0115fcfb85c14110b02f7392564d330b';
const maintenanceId='eaf8c8abb0984e2482a9eb3edfed1429';
const attemptPath='D:/codex-isolated/main-release-packages/e030caba1271-aaab2674-b0c1080e/publish-e030caba1271';
const controlPath='D:/codex-isolated/main-manual-release-20261016/main-publisher-config.json';
const operatorPath='D:/.codex/worktrees/ai159-pi-recovery-20261107';
const installed='D:/teruisi-runtime/django-sales/app';
const resumeLeaf='resume-ai159';
const piGuardName='PiRunnerRecovery-started.json';
const predecessorCatalogSha256='f776dfab17edecbd7a1acf0399d1b109cc3dde834493cf40c2d1b5db3bfdeff6';
const originalPins=Object.freeze({
 'STARTED.json':'fa16a6ba406f55213bdac1d9c1c92120ca76cb78eb8191c5704c5d405045a01b',
 'FAILED.json':'2b70da417a977fb6a32b666181adcf3b70402f5449fa986239a0687bb8ad8ef0',
 'preparation/PREPARED.json':'c0f08e9849eb4182f83a147b229f5be22238e46a20a41fe90e42121292ac4a4f',
 '../main-release-request.json':'f8461ff0d09902e101cbbcc3762542e6f65f5fe4e2063e3f4c664765bb2eedbb',
 '../schema/ai-0090-evidence.json':'c3e0eaf5b0b692c333664c9c29b0ae76e0852a5a75350203c7378079ca460665',
 '部署后台-process.json':'9178090f5ed1b6d9c52106e52328e8eae208b8de6987d4e17ba59edce7c102e4',
 '部署后台-result.json':'97a4c42593d130ac92295dd54b2a74789be171287fcd811d93907ff7faabc1aa',
 '部署后台-started.json':'a7940d5d7f53c11932fda649b991e1a2a94a2c99a67f395e4b3533e3936f389a',
 '应用后台权限-process.json':'250dac3048b76d589a95a81394f481c346acaed068e7c479f07c2f6142c050c5',
 '应用后台权限-result.json':'62ba9dfca42f280678fba906a20b4053467c9f216f7cf71b0bb087741afdbba4',
 '应用后台权限-started.json':'3b2f71b16d5178a87b4c8277c07ec1b2345cd208bf358a05b1294435340ed515',
 '登记结构迁移-process.json':'2770080f35fef25d91cd0dc715789699c9dedb10cb05464297f2c5a9ebefdfa0',
 '登记结构迁移-result.json':'d1b42f74d44b30bfd40a38d238a157c014af201d96254cd4448111212306af89',
 '登记结构迁移-started.json':'e9214879895290200373ab99d5a54e9dacf643143e787520e60547af4f8b035e',
 '迁移监控字段-process.json':'12f51e3adb21e61001fc515c08757375168ef187c41dcff143d35bd490769ad6',
 '迁移监控字段-result.json':'9a4a4b91081a96f7b6a8c140c234149a326dbe94e72e8d77ba3a12615e13feff',
 '迁移监控字段-started.json':'d42ec32b1e99b2e4b975ee12690b69a4b4106692bf0d8f3d0117cee8ae344333',
 '配置Pi运行账本权限-process.json':'dfc8318f4c67b793fb9ee1da8cdb2b579ea90e1a62933af893ca6414cbf425fd',
 '配置Pi运行账本权限-result.json':'6e7e084098178e54791d826b264b7da0cf83d7e6f5c35b41b821448e0148b892',
 '配置Pi运行账本权限-started.json':'bdefa49aaec1024f60755606f41f6e1389d34783305956335e865ad31729d144',
 '完成结构迁移-process.json':'4b1433accb4fc1685daca9775778cd2909ed73e35f455b062a056e97a869e04a',
 '完成结构迁移-result.json':'9232e27e6f497e4b7eaf9abfc0ad7debf9cdf644975b5441d813f4f6d4e5edc3',
 '完成结构迁移-started.json':'0fe071363c1437dca17228197b42b815792a5b096fca708dbd209f1c8b670f52',
 '升级Pi Runner-process.json':'a5bc26ed6988a4c3617d1db8ddb122763513eac070911c3fc649e9d0397a31cc',
 '升级Pi Runner-started.json':'889dafb67515bca125833a02452aed6f8935728dfbe920e2d866c1bc934539f7',
 'PiUpgrade-original-failure.json':'1b0a1481ea31f38ba64ef3722f51e9e6f806d95949b515ee790b1b4daa1a1b68',
 '核对Pi升级原结果-process.json':'b64fb8e84aae23ed1674ccccb89b5008e4c39b68b2de6d32dd1d98f1ee79dc05',
 '核对Pi升级原结果-result.json':'a6e2b731cc22560ceb3983daf3f628456c9ebba5cc02b66b71105451a637153f',
 '核对Pi升级原结果-started.json':'abf725fc460627374ebd53d2ed45ed8ac463688541092b84ecf20253b82789e3',
});
const activeSha256='1f1bb5b273a40847046719c1a9fba03f783a252bf338af63758b543291c4ed46';
const nativePins=Object.freeze({
 'app/tools/django-local-service.ps1':'37c6dc571aeefe4954f977f5b3a64ec08516362a67775729f45f60b17bca99a6',
 'app/tools/integration_release_gate.py':'e08975977a629f0f7481c95cca45c9f7fd1008e59607d7c489bc2cc0ced388b2',
 'app/tools/ai_unified_tasks_addition.py':'66f6231ac971120e84fa92599ca7ba56576bea0d4d21a003ea4e666fe02051f7',
 'ai-unified-tasks-addition-active.json':activeSha256,
 [`ai-unified-tasks-additions/${operationId}/finalized.json`]:'8ca4da8d5443bcc001594906e0c0479c2c76832f6575a7131036f2344e04d348',
 [`ai-unified-tasks-additions/${operationId}/installed.json`]:'abf8e7fdaa4f4cc084dac90be05191f76eac507d475d358d4c041d3a5c558ad6',
 [`ai-unified-tasks-additions/${operationId}/plan.json`]:'0567d3d2771054504d0aae08396d66839acd39e0e1b720810fced9b3d6ae0e6a',
});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=async file=>{try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};

async function pinnedFiles(root,pins){
 const records={};
 for(const [name,expected] of Object.entries(pins)){
  const file=path.resolve(root,name),stat=await fs.lstat(file);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.size<4*1024*1024,'AI159原证据不是有界独立文件：'+name);
  assert.equal(path.resolve(await fs.realpath(file)).toLowerCase(),file.toLowerCase(),'AI159原证据路径重定向：'+name);
  const bytes=await fs.readFile(file);
  assert.equal(sha(bytes),expected,'AI159原证据摘要已变化：'+name);
  records[name]=bytes;
 }
 return records;
}

export function assertAi159InitialPi(pi,prepared){
 for(const field of ['operationId','planSha256','registeredPlanSha256','sourceSha256','image'])assert.equal(pi[field],prepared[field],'原Pi计划字段变化：'+field);
 assert.equal(pi.status,'blocked','原Pi恢复只接受候选未启动');
 assert.equal(pi.reason,'linux_successor_not_active','原Pi恢复阻断原因发生变化');
 assert.equal(pi.postconditionsVerified,false);
 assert.equal(pi.upgradeReceipt,null);
}

async function verifyOriginal({request,prepared,started,out,source,failure}){
 const records=await pinnedFiles(out,originalPins);
 for(const [name,value] of [['../main-release-request.json',request],['preparation/PREPARED.json',prepared],['STARTED.json',started],['FAILED.json',failure]]){
  assert.deepEqual(JSON.parse(records[name]),value,'AI159原证据在读取期间变化：'+name);
 }
 assert.equal(request.mainCommit,mainCommit);
 assert.equal(started.operationId,operationId);
 assert.equal(started.maintenanceId,maintenanceId);
 const release=schemaForRequest(request);
 assert.equal(release.additionKind,'AiUnifiedTasks');
 assert.equal(release.fromGeneration,158);
 assert.equal(release.toGeneration,159);
 assert.deepEqual(release,started.schemaRelease);
 assert.equal(path.resolve(release.evidencePath),path.join(path.dirname(source),'schema/ai-0090-evidence.json'));
 assert.equal(failure.phase,'核对Pi升级原结果');
 assert.equal(failure.automaticRetry,false);
 for(const label of ['登记结构迁移','迁移监控字段','配置Pi运行账本权限','完成结构迁移','核对Pi升级原结果']){
  const {processEvidence,originalBytesRetained}=JSON.parse(records[label+'-process.json']);
  assert.equal(originalBytesRetained,true);
  assert.equal(processEvidence.code,'completed');
  assert.equal(processEvidence.exitCode,0);
  assert.equal(processEvidence.timeoutType,null);
  assert.equal(processEvidence.outputProtocol,'direct-exit-files');
 }
 assertAi159InitialPi(JSON.parse(records['核对Pi升级原结果-result.json']).value,prepared.piRunnerUpgrade);
 const installed=JSON.parse(records['迁移监控字段-result.json']).value;
 const finalized=JSON.parse(records['完成结构迁移-result.json']).value;
 assert.equal(installed.result.status,'schema_installed');
 assert.equal(finalized.result.status,'verified');
 assert.equal(finalized.result.permissionsVerified,true);
 for(const item of [installed,finalized]){
  assert.equal(item.status,'verified');
  assert.equal(item.result.migrationCount,159);
  assert.deepEqual(item.result.steps,release.steps);
  assert.equal(item.result.planSha256,nativePins[`ai-unified-tasks-additions/${operationId}/plan.json`]);
 }
 return {operationId,maintenanceId,release,installed,finalized};
}

const schemaProbe=String.raw`
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new()
$runtime='D:\teruisi-runtime\django-sales';$app=Join-Path $runtime 'app'
$prior=[Environment]::GetEnvironmentVariable('TERUISI_DJANGO_SERVICE_LIBRARY_ONLY','Process')
try{$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1';. (Join-Path $app 'tools\django-local-service.ps1') -Action Status -RuntimeRoot $runtime}
finally{[Environment]::SetEnvironmentVariable('TERUISI_DJANGO_SERVICE_LIBRARY_ONLY',$prior,'Process')}
Invoke-WithServiceMutex {
 Assert-DeployedApplication | Out-Null
 Assert-RuntimeAclHardened | Out-Null
 Assert-ProductionMaintenance 'AI159 recovery read-only database proof' | Out-Null
 Assert-ApplicationDeploymentStopped 'AI159 recovery read-only database proof' | Out-Null
 $maintenance=Read-SystemMaintenance
 if($maintenance.id -cne '${maintenanceId}' -or -not (Test-MaintenanceKeepsPostgres $maintenance)){throw 'AI159 maintenance changed'}
 $active=Join-Path $runtime 'ai-unified-tasks-addition-active.json'
 if((Get-FileSha256 $active) -cne '${activeSha256}'){throw 'AI159 active receipt changed'}
 $secrets=Read-Secrets
 $url=(Database-Url 'teruisi_sales_owner' $secrets.OwnerPassword 'teruisi_ai159_recovery_readonly' $WriterStatementTimeoutMs)+'%20-c%20default_transaction_read_only%3Don'
 try {
  Invoke-WithDjangoEnvironment $secrets $url 'migration_writer' $true $WriterMaxBodyBytes '' '' {
   $env:DJANGO_SETTINGS_MODULE='teruisi_backend.settings';$env:PYTHONDONTWRITEBYTECODE='1'
   $check=Invoke-BoundedNativeProcess $Python @((Join-Path $app 'tools\integration_release_gate.py'),'database','--root',$app,'--runtime',$runtime) (Join-Path $app 'backend')
   $proof=ConvertFrom-UniqueNativeJson $check 'Verify already completed AI159 in read-only PostgreSQL'
   if($proof.status -cne 'verified' -or $proof.result.status -cne 'complete' -or $proof.result.migrationCount -ne 159){throw 'AI159 database proof refused'}
   if((Get-FileSha256 $active) -cne '${activeSha256}'){throw 'AI159 active receipt changed during proof'}
   $proof | ConvertTo-Json -Depth 4 -Compress
  }
 } finally { $secrets=$null;$url=$null }
}`;

async function verifyDatabase({api,transport,invocation}){
 await pinnedFiles(path.dirname(installed),nativePins);
 const result=await api.runProcess(taskHost,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(schemaProbe,'utf16le').toString('base64')],{
  cwd:installed,env:transport.productionCommandEnvironment(taskHost),timeoutMs:240000,outputProtocol:'direct-exit-files',cleanup:'preserve',captureOutputBuffers:true,label:'read-only AI159 database proof',
 });
 const proof=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(result.rawOutput.stdout));
 assert.deepEqual(proof,{status:'verified',result:{status:'complete',migrationCount:159}});
 assert.equal(result.processEvidence.code,'completed');
 assert.equal(result.processEvidence.exitCode,0);
 assert.equal(result.processEvidence.timeoutType,null);
 const evidence=JSON.stringify({at:new Date().toISOString(),operationId,activeSha256,proof,processEvidence:result.processEvidence})+'\n';
 await fs.writeFile(path.join(invocation,'AI159-SCHEMA-VERIFIED.json'),evidence,{flag:'wx'});
 return {schemaDatabaseVerified:proof.result.migrationCount===159,schemaDatabaseProofSha256:sha(evidence)};
}

export async function runAi159PreparedRecovery({configFile=controlPath,attempt=attemptPath,operatorCommit}={}){
 const out=path.resolve(attempt),operatorRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 assert.equal(out,path.resolve(attemptPath),'AI159恢复仅接受原发布目录');
 assert.equal(path.resolve(configFile),path.resolve(controlPath),'AI159恢复需要原固定发布配置');
 assert.equal(operatorRoot,path.resolve(operatorPath),'AI159恢复需要独立受审操作源码');
 assert.notEqual(operatorCommit,mainCommit,'操作代码身份必须与原发布目标分离');
 assert.match(operatorCommit??'',/^[a-f0-9]{40}$/,'需要独立审定的完整操作代码提交');
 const binding=await readAdoptedControl(path.resolve(configFile)),{config}=binding;
 assert.equal(binding.state.version,'teruisi-main-control-installation-v3');
 assertOrdinaryIdentity(await currentPreparationIdentity(),binding.state.preparationTask.sid);
 assert.equal(sha(await fs.readFile(process.execPath)),binding.state.preparationTask.nodeSha256,'原发布Node身份不匹配');
 const source=path.join(path.dirname(out),'source');
 assert.equal(path.dirname(path.dirname(out)),path.resolve(config.releaseDirectory));
 const original=await pinnedFiles(out,originalPins),request=JSON.parse(original['../main-release-request.json']);
 const preparedPi=JSON.parse(original['preparation/PREPARED.json']).piRunnerUpgrade;
 assert.equal(sha(await fs.readFile(path.join(request.pwshDirectory,'pwsh.exe'))),request.pwshSha256,'原PowerShell身份不一致');
 const deadlineUnixMs=publicationDeadline();
 const fixed=publisherEnvironment(process.env,config.gitDirectory,config.publisherBaseEnvironment);
 for(const key of Object.keys(process.env))delete process.env[key];
 Object.assign(process.env,fixed,{PATH:request.pwshDirectory+';'+fixed.PATH});
 if(deadlineUnixMs!==undefined)process.env.TERUISI_PROCESS_DEADLINE_UNIX_MS=String(deadlineUnixMs);
 const verifyOperator=()=>assertFrozenSource({source:operatorRoot,mainCommit:operatorCommit});
 const operatorSource={root:operatorRoot,...await verifyOperator()};
 execFileSync('git',['merge-base','--is-ancestor',mainCommit,operatorCommit],{cwd:operatorRoot,windowsHide:true,stdio:'pipe'});
 await assertFrozenSource({source,mainCommit,sourceTree:JSON.parse(original['STARTED.json']).sourceTree});
 const load=name=>import(pathToFileURL(path.join(source,'tools',name)));
 const [api,rotation,transport,pi,adapter]=await Promise.all([
  load('worker-local-release.mjs'),load('worker-local-release-rotation.mjs'),load('release-batch.mjs'),
  load('publish-main-pi-reconciliation.mjs'),import('./ai159-pi-source-recovery.mjs'),
 ]);
 const ready=()=>assertPublicationReady({deadlineUnixMs});
 const waitReady=()=>waitForPublicationReady({deadlineUnixMs});
 const observePi=async prepared=>{
  const script=path.join(installed,'tools/django-ai.ps1');
  const {host,args}=manualStepCommand({systemHost:taskHost,powerShellDirectory:request.pwshDirectory,script,action:'PiUpgradeStatus',extra:['-PiUpgradePlanSha256',prepared.registeredPlanSha256]});
  const result=await api.runProcess(host,transport.productionCommandArguments(host,args),{cwd:path.dirname(script),env:transport.productionCommandEnvironment(host),timeoutMs:240000,outputProtocol:'direct-exit-files',cleanup:'preserve',captureOutputBuffers:true,label:'read-only original Pi upgrade status'});
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(result.rawOutput.stdout));
 };
 const catalog=mainResumeCatalog({config,out,binding,rotation,installed,ready,source,api,predecessorCatalogSha256,resumeLeaf});
 const recovery={
  protocol,resumeLeaf,operatorSource,preparationSha256:originalPins['preparation/PREPARED.json'],verifyOriginal,
  async verifySuccess(success,file,state){
   assert.equal(file,path.join(state.resumed,'SUCCESS.json'));
   const auditRoot=path.join(state.resumed,'attempts');
   assert.match(success.recoveryInvocationId??'',/^[a-f0-9]{32}$/);
   assert.deepEqual(await fs.readdir(auditRoot),[success.recoveryInvocationId]);
   const invocation=path.join(auditRoot,success.recoveryInvocationId);
   assert.match(success.schemaDatabaseProofSha256??'',/^[a-f0-9]{64}$/);
   const evidence=await pinnedFiles(invocation,{'AI159-SCHEMA-VERIFIED.json':success.schemaDatabaseProofSha256});
   const db=JSON.parse(evidence['AI159-SCHEMA-VERIFIED.json']);
   assert.equal(db.operationId,operationId);
   assert.equal(db.activeSha256,activeSha256);
   assert.deepEqual(db.proof,{status:'verified',result:{status:'complete',migrationCount:159}});
   assert.equal(db.processEvidence.code,'completed');
   assert.equal(db.processEvidence.exitCode,0);
   assert.equal(db.processEvidence.timeoutType,null);
   const audit=JSON.parse(await fs.readFile(path.join(invocation,'STARTED.json'),'utf8'));
   assert.equal(audit.recoveryProtocol,protocol);
   assert.equal(audit.originalFailureSha256,originalPins['FAILED.json']);
   assert.deepEqual(audit.operatorSource,success.operatorSource);
   assert.equal(success.recoveryProtocol,protocol);
   assert.equal(success.originalAttempt,out);
   assert.equal(success.originalStartedSha256,originalPins['STARTED.json']);
   assert.equal(success.originalFailureSha256,originalPins['FAILED.json']);
   assert.equal(success.originalPreparationSha256,originalPins['preparation/PREPARED.json']);
   assert.equal(success.schemaDatabaseVerified,true);
   assert.deepEqual(success.schemaReceipt,state.schemaReceipt);
   assert.equal(success.migration,state.schemaReceipt.release.steps[0]);
   assert.equal(success.workerRelease,state.prepared.workerPlan.candidateReleaseId);
   assert.equal(success.workerManifestSha256,state.prepared.workerPlan.candidateManifestSha256);
   assert.equal(success.djangoManifestSha256,state.prepared.djangoManifestSha256);
   assert.equal(success.maintenanceId,maintenanceId);
   pi.verifyUpgradeReceipt(success.piRunnerUpgrade,state.prepared.piRunnerUpgrade);
  },
  async cleanupRecordedKeeper(state){
   await assertControlGeneration(binding);
   assert.deepEqual(await verifyOperator(),{commit:operatorSource.commit,tree:operatorSource.tree});
   const invocation=path.join(state.resumed,'attempts',state.success.recoveryInvocationId);
   const progress={begin(){},complete(){}};
   const native=createMainPublicationStep({request,api,transport,progress,out:invocation});
   const directory=path.join(invocation,'keeper-release-'+randomUUID());
   const step=async(label,script,action,extra,options)=>{
    await fs.mkdir(directory,{recursive:true});
    return native(label,script,action,extra,{...options,directory});
   };
   await adapter.releaseAi159RecordedKeeper({prepared:preparedPi,installed,source,originalAttempt:out,invocation,step,directory});
  },
  async canResume({pi,steps,reconciliationAttempted,resumed}){
   assert.equal(reconciliationAttempted,false,'原Pi协调已开始，禁止再次恢复');
   assert.ok(Object.values(steps).every(step=>step.state==='not_started'),'AI159原发布尾部已开始');
   for(const name of await fs.readdir(out))assert.ok(!Object.keys(steps).some(label=>name.startsWith(label+'-')||name.startsWith(label+'.')),'AI159原尾部存在未完成原证据：'+name);
   assert.equal(await exists(path.join(out,piGuardName)),false,'AI159 Pi一次性启动已经开始');
   assert.equal(await exists(path.join(resumed,'attempts')),false,'AI159恢复已开始，保留原记录');
   assertAi159InitialPi(pi,preparedPi);
   return true;
  },
  async runPi({state,invocation,step}){
   const schemaProof=await verifyDatabase({api,transport,invocation});
   await assertControlGeneration(binding);
   assert.deepEqual(await verifyOperator(),{commit:operatorSource.commit,tree:operatorSource.tree});
   assert.deepEqual(await assertFrozenSource({source,mainCommit,sourceTree:state.identity.tree}),state.identity);
   const prepared=state.prepared.piRunnerUpgrade;
   const recovered=await adapter.recoverAi159Pi({prepared,installed,source,originalAttempt:out,invocation,step,reconcileMainPiUpgrade:pi.reconcileMainPiUpgrade});
   pi.verifyUpgradeReceipt(recovered.receipt,prepared);
   assert.equal(typeof recovered.releaseKeeper,'function');
   return {...recovered,...schemaProof};
  },
 };
 const unlock=await acquireMainPublicationQueue(binding);
 try{
  return await resumeAi159OriginalTail(out,{api,rotation,transport,installedRoot:path.resolve(installed),observePi,ready,waitReady,...catalog},recovery);
 }finally{await unlock();}
}
