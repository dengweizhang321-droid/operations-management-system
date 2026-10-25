import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile,execFileSync,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import assert from 'node:assert/strict';
import {makeReleasePlan} from './release-scope-plan.mjs';
import {createReleaseProgress} from './publish-main-progress.mjs';
import {prepareMainSchemaRelease} from './main-schema-release.mjs';
import {wakePreparationTask,currentPreparationIdentity,assertOrdinaryIdentity} from './main-prebuild-task.mjs';
import {submitPreparation,drainPreparationQueue,ticketResult,acquireQueueLock,readPreparationQueueInventory,retiredPreparationPackets,isRetiredPacket,preparationPacketSlot,assertPreparationPacket,inspectPreparationAttempt,defaultAbandonmentGraceMs,nativePreparationFailureVersion,publicationRetirementVersion,notEnteredPhases,notEnteredRequiredMembers,notEnteredEvidenceMembers,isNotEnteredAttemptMember,preparedDispatchForPacket,writePublicationRetirement} from './main-prebuild-queue.mjs';
import {readAdoptedControl,assertControlGeneration,controlExecution} from './main-control-dispatch.mjs';
import {submitAbandonOnlyRequest,reconciliationGeneration} from './main-preparation-reconcile.mjs';
import {assertRetirementAdmission,withRetirementReadScope,invalidateRetirementReadScope} from './preparation-retirement-admission.mjs';

const execute=promisify(execFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=async file=>{try{await fs.access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
export async function gitAt(cwd,args){
 try{return (await execute('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})).stdout.trim();}
 catch(error){throw Error('Git '+args[0]+' 失败（'+(error.code??'unknown')+'），未使用旧版本继续发布');}
}
async function writeOnceOrSame(file,value){
 try{await fs.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
 catch(error){if(error.code!=='EEXIST')throw error;assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),value,'已冻结发布请求变化，拒绝覆盖原批次');}
}
export async function readLivePublication(config){
 const api=await import(pathToFileURL(path.join(config.nativeToolsSource,'tools/worker-local-release.mjs')));
 const rotation=await import(pathToFileURL(path.join(config.nativeToolsSource,'tools/worker-local-release-rotation.mjs')));
 const chain=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});
 const manifest=JSON.parse(await fs.readFile(path.join(api.workerRuntimeRoot,'releases',chain.head.releaseId,'deployment-manifest.json'),'utf8'));
 const djangoRaw=await fs.readFile('D:/teruisi-runtime/django-sales/app/deployment.json');
 for(const name of ['system-maintenance.json','automation-drain.json'])assert.equal(await exists(path.join('D:/teruisi-runtime/django-sales/run',name)),false,'当前仍有维护或排空状态，不能视为已发布完成');
 let source,commit,expectedTree,receiptPath,receiptRaw;
 const catalogFile=path.join(config.stateDirectory,'PUBLISHED-MAIN.json');
 const catalog=await exists(catalogFile)?JSON.parse(await fs.readFile(catalogFile,'utf8')):null;
 if(catalog&&catalog.workerManifestSha256===chain.head.manifestSha256&&catalog.workerRelease===chain.head.releaseId&&catalog.djangoManifestSha256===sha(djangoRaw)){
  source=catalog.source;commit=catalog.mainCommit;expectedTree=catalog.sourceTree;
  receiptPath=catalog.receiptPath;receiptRaw=await fs.readFile(receiptPath);assert.equal(sha(receiptRaw),catalog.receiptSha256,'发布目录成功回执变化');
 }else{
  source=JSON.parse(manifest.source.sourceBinding.raw).sourceRoot;
  assert.equal(path.resolve(JSON.parse(djangoRaw).sourceRoot),path.resolve(source),'前后台来源不同且没有匹配发布记录，不能推定已发布版本');
  commit=await gitAt(source,['rev-parse','HEAD']);expectedTree=manifest.source.tree;
  receiptPath=path.resolve(source,'..','publish-'+commit.slice(0,12),'SUCCESS.json');
  if(await exists(receiptPath))receiptRaw=await fs.readFile(receiptPath);
  else{
   assert.ok(config.bootstrapSuccess,'缺少与当前实际版本绑定的完成回执，不能把半切换当作已发布');
   receiptPath=config.bootstrapSuccess.path;receiptRaw=await fs.readFile(receiptPath);
   assert.equal(sha(receiptRaw),config.bootstrapSuccess.sha256,'初始成功回执已变化');
  }
 }
 const receipt=JSON.parse(receiptRaw);assert.equal(receipt.status,'deployed_and_ready');assert.equal(receipt.mainCommit,commit);
 assert.equal(receipt.workerRelease,chain.head.releaseId);assert.equal(receipt.workerManifestSha256,chain.head.manifestSha256);assert.equal(receipt.djangoManifestSha256,sha(djangoRaw));
 assert.equal(await gitAt(source,['status','--porcelain']),'','已部署版本来源存在未提交修改');
 assert.equal(await gitAt(source,['rev-parse','HEAD']),commit);
 const sourceTree=await api.hashRelativeFiles(source,await api.listGitSourceFiles(source));
 assert.deepEqual(sourceTree,expectedTree,'已部署来源与实际运行包不一致');
 const ready=await fetch('http://127.0.0.1:3000/_teruisi/local/health/ready',{headers:{'x-teruisi-local-health':'1'},signal:AbortSignal.timeout(15000)});
 assert.equal(ready.status,200,'当前运行版本尚未就绪');const health=await ready.json();assert.equal(health.ok,true);assert.equal(health.status,'ready');
 const ordinaryAttempt=path.resolve(source,'..','publish-'+commit.slice(0,12));
 return {mainCommit:commit,source,sourceTree,head:chain.head,chainStateSha256:chain.chainStateSha256,djangoManifestSha256:sha(djangoRaw),completedReceiptPath:receiptPath,resolvedOriginalAttempt:path.resolve(path.dirname(receiptPath))!==ordinaryAttempt};
}

export async function observeLatestMain(config,{git=gitAt,getLive=readLivePublication,log=()=>{},retirementScope,retiredPackets=new Set()}={}){
 await assertRetirementAdmission(config,undefined,{scope:retirementScope});
 log('获取 origin/main；旧任务 completedTask、旧成功回执和旧续接参数不参与目标选择。');
 await invalidateRetirementReadScope(retirementScope,'publisher-fetch');
 await git(config.repository,['fetch','origin','refs/heads/main:refs/remotes/origin/main']);
 const target=await git(config.repository,['rev-parse','--verify','refs/remotes/origin/main^{commit}']);assert.match(target,/^[a-f0-9]{40}$/);
 await assertRetirementAdmission(config,target,{scope:retirementScope});
 const live=await getLive(config);assert.match(live.mainCommit,/^[a-f0-9]{40}$/);
 assert.ok(typeof live.source==='string'&&path.isAbsolute(live.source),'缺少当前来源身份');
 const liveAttempt=path.resolve(live.source,'..','publish-'+live.mainCommit.slice(0,12));
 if(await exists(path.join(liveAttempt,'STARTED.json'))&&!await exists(path.join(liveAttempt,'SUCCESS.json'))&&!live.resolvedOriginalAttempt)throw Error('当前目标有STARTED但无成功完成，不能把半切换当作已发布');
 log('本次目标 main：'+target+'；当前线上：'+live.mainCommit);
 const name=packetBaseName(target,live);
 // A retired packet (failed or abandoned preparation) is never reused; the
 // same target and predecessor prepare again in the next '-rN' slot.
 return {targetCommit:target,live,packet:preparationPacketSlot(config.releaseDirectory,name,retiredPackets)};
}
export function packetBaseName(target,live){return target.slice(0,12)+'-'+live.head.bindingSha256.slice(0,8)+'-'+live.djangoManifestSha256.slice(0,8);}
export async function prepareLatestMain(config,options={}){
 return prepareLatestMainOnce(config,await observeLatestMain(config,options),options);
}
export async function prepareLatestMainOnce(config,selection,{git=gitAt,log=()=>{},makePlan=makeReleasePlan,prepareSchema=prepareMainSchemaRelease,retirementScope,retiredPackets}={}){
 const {targetCommit:target,live}=selection;
 assert.match(target,/^[a-f0-9]{40}$/);assert.match(live.mainCommit,/^[a-f0-9]{40}$/);
 await assertRetirementAdmission(config,target,{scope:retirementScope});
 if(target===live.mainCommit)return {status:'already-current',targetCommit:target,currentCommit:live.mainCommit,publicationPerformed:false};
 const base=target.slice(0,12)+'-'+live.head.bindingSha256.slice(0,8)+'-'+live.djangoManifestSha256.slice(0,8);
 // The frozen selection names the base slot or a later '-rN' slot after a retirement.
 const name=assertPreparationPacket(config.releaseDirectory,base,selection.packet);
 assert.ok(!isRetiredPacket(retiredPackets,selection.packet),'该准备包已退役，永不再准备或发布；本次未准备');
 const packet=path.join(config.releaseDirectory,name),source=path.join(packet,'source');
 assert.equal(path.resolve(selection.packet),path.resolve(packet),'Frozen packet changed');
 await invalidateRetirementReadScope(retirementScope,'publisher-freeze-source');
 await fs.mkdir(packet,{recursive:true});
 if(!await exists(path.join(source,'.git'))){
  await git(config.repository,['worktree','add','-b','codex/manual-main-'+name,source,target]);
  await git(config.repository,['worktree','lock','--reason','Manual latest-main release source; keep while package is in use',source]);
 }
 const {assertFrozenSource}=await import('./frozen-main-source.mjs');
 await assertFrozenSource({source,mainCommit:target},{git});
 const plan=makePlan({base:live.mainCommit,head:target,cwd:source});assert.equal(plan.headSha,target);assert.equal(plan.baseSha,live.mainCommit);
 if(!plan.components.length)return {status:'non-production',targetCommit:target,currentCommit:live.mainCommit,packet,source,publicationPerformed:false};
 const schemaRelease=plan.migrate?await prepareSchema({source,packet,plan}):null;
 const cacheLock=sha(await fs.readFile(path.join(source,'package-lock.json')));
 assert.equal(cacheLock,config.cacheLockSha256,'依赖锁已变化，需要先准备对应离线依赖；本次未部署');
 const modules=path.join(source,'node_modules');
 if(!await exists(modules))await fs.symlink(config.dependenciesDirectory,modules,'junction');
 const link=await fs.realpath(modules);assert.equal(path.resolve(link),path.resolve(config.dependenciesDirectory),'来源依赖目录变化');
 const request={version:'teruisi-frozen-latest-main-request-v1',latestMainRelease:true,mainCommit:target,deployedCommit:live.mainCommit,
  predecessorWorker:live.head,predecessorDjangoSha256:live.djangoManifestSha256,
  pwshDirectory:config.pwshDirectory,pwshSha256:config.pwshSha256,npmCacheDirectory:config.npmCacheDirectory,
  components:plan.components,migrate:plan.migrate,releasePlan:plan,backup:false,fullTests:false,...(schemaRelease?{schemaRelease}:{})};
 await writeOnceOrSame(path.join(packet,'release-scope-plan.json'),plan);
 await writeOnceOrSame(path.join(packet,'main-release-request.json'),request);
 const attempt=path.join(packet,'publish-'+target.slice(0,12));
 if(await exists(path.join(attempt,'STARTED.json'))&&!await exists(path.join(attempt,'SUCCESS.json')))throw Error('这个目标main已有未知结果的执行记录，禁止自动重试；原日志：'+attempt);
 if(await exists(path.join(attempt,'SUCCESS.json')))throw Error('该目标有历史成功记录，但当前线上不是此提交，不能把旧记录显示为本次成功');
 return {status:'prepared',targetCommit:target,currentCommit:live.mainCommit,packet,source,request,publicationPerformed:false};
}

const publisherVariableNames=['SystemRoot','WINDIR','SystemDrive','COMSPEC','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA','PROGRAMFILES','PROGRAMFILES(X86)','COMMONPROGRAMFILES','COMMONPROGRAMFILES(X86)','HOMEDRIVE','HOMEPATH','USERNAME','USERDOMAIN','LOGONSERVER','OS','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS'];
export function publisherEnvironment(environment=process.env,gitDirectory,baseEnvironment){
 // Both the Git-triggered prepare and manual BAT use this actual environment.
 // Freeze only this bounded Windows base at installation, never inherited
 // secrets/Git options. Native identity still hashes every actual child input.
 if(baseEnvironment!==undefined){
  assert.ok(baseEnvironment&&typeof baseEnvironment==='object'&&!Array.isArray(baseEnvironment),'固定发布环境格式无效');
  const allowed=new Set([...publisherVariableNames.map(name=>name.toUpperCase()),'PATH']);
  for(const [key,value] of Object.entries(baseEnvironment))assert.ok(allowed.has(key)&&typeof value==='string'&&!value.includes('\0'),'固定发布环境含未允许的变量或值');
  assert.ok(Object.hasOwn(baseEnvironment,'LOGONSERVER'),'固定发布环境缺少Windows子进程输入');
  for(const key of ['HOMEDRIVE','HOMEPATH','PATH','SYSTEMDRIVE','SYSTEMROOT','TEMP','USERDOMAIN','USERNAME','USERPROFILE','WINDIR'])assert.ok(typeof baseEnvironment[key]==='string'&&baseEnvironment[key].length>0,'固定发布环境缺少Windows必需输入：'+key);
  environment=baseEnvironment;
 }
 const result={};
 if(!gitDirectory)gitDirectory=path.dirname(execFileSync('C:/Windows/System32/where.exe',['git.exe'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0]);
 assert.ok(path.isAbsolute(gitDirectory),'需要本机Git的绝对安装目录');
 for(const name of publisherVariableNames){const key=Object.keys(environment).find(k=>k.toUpperCase()===name.toUpperCase());if(key)result[name.toUpperCase()]=environment[key];}
 // libuv silently inherits this required Windows variable when absent, even
 // with an explicit env object. Empty must also be explicit, never omitted.
 result.LOGONSERVER??='';
 result.PATH=[path.dirname(process.execPath),'C:/Windows/System32','C:/Windows','C:/Windows/System32/WindowsPowerShell/v1.0',gitDirectory].map(entry=>path.win32.normalize(entry)).join(path.delimiter);
 return result;
}
export async function runPublisher(source,args=[],gitDirectory,baseEnvironment,{deadlineUnixMs}={}){
 const directory=path.resolve(source,'..','invocations');await fs.mkdir(directory,{recursive:true});
 const resultFile=path.join(directory,randomUUID()+'.json'),check=args.includes('--check'),prepareOnly=args.includes('--prepare-only');
 await new Promise((resolve,reject)=>{
  const environment=publisherEnvironment(process.env,gitDirectory,baseEnvironment);
  if(deadlineUnixMs!==undefined){assert.ok(Number.isSafeInteger(deadlineUnixMs));environment.TERUISI_PROCESS_DEADLINE_UNIX_MS=String(deadlineUnixMs);}
  const child=spawn(process.execPath,[path.join(source,'tools/publish-main.mjs'),...args,...(check?[]:['--result-file',resultFile])],{cwd:source,env:environment,windowsHide:true,stdio:'inherit'});
  child.once('error',reject);child.once('exit',(code,signal)=>{
   if(!signal&&code===0)return resolve();
   const error=Error('本次目标发布未完成，退出码：'+(code??signal));
   // Only a strictly valid native preparation-failure result is structured;
   // a missing or invalid one keeps today's plain error (queue 'unknown').
   if(!prepareOnly)return reject(error);
   readNativePreparationFailure(resultFile,path.resolve(source,'..')).then(terminal=>{if(terminal)error.preparationTerminal=terminal;reject(error);},()=>reject(error));
  });
 });
 return check?null:JSON.parse(await fs.readFile(resultFile,'utf8'));
}
const sameFile=(left,right)=>path.resolve(left).toLowerCase()===path.resolve(right).toLowerCase();
/** Validate tools/publish-main.mjs --prepare-only failure result; null unless every field is exact. */
export async function readNativePreparationFailure(resultFile,packet){
 try{
  resultFile=path.resolve(resultFile);packet=path.resolve(packet);
  if(!sameFile(path.dirname(resultFile),path.join(packet,'invocations'))||!/^[a-f0-9-]{36}\.json$/.test(path.basename(resultFile)))return null;
  const stat=await fs.lstat(resultFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>64*1024)return null;
  const raw=await fs.readFile(resultFile),value=JSON.parse(raw.toString('utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  if(JSON.stringify(Object.keys(value).sort())!==JSON.stringify(['error','failureReceipt','mainCommit','maintenanceStarted','phase','publicationPerformed','publicationStarted','status','version']))return null;
  if(value.version!==nativePreparationFailureVersion||value.status!=='preparation-failed'||value.publicationPerformed!==false||value.publicationStarted!==false||value.maintenanceStarted!==false)return null;
  if(typeof value.phase!=='string'||!value.phase.length||value.phase.length>200||typeof value.error!=='string'||value.error.length>1600)return null;
  let target=null;try{target=JSON.parse(await fs.readFile(path.join(packet,'main-release-request.json'),'utf8')).mainCommit;}catch{target=null;}
  if(typeof target!=='string'||!/^[a-f0-9]{40}$/.test(target))target=null;
  if(value.mainCommit!==null&&(target===null||value.mainCommit!==target))return null;
  const receipt=value.failureReceipt;
  if(receipt!==null){
   if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||JSON.stringify(Object.keys(receipt).sort())!=='["path","sha256"]'||target===null)return null;
   if(typeof receipt.path!=='string'||!path.isAbsolute(receipt.path)||!sameFile(path.dirname(receipt.path),path.join(packet,'publish-'+target.slice(0,12),'preparation')))return null;
   if(!/^FAILED-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/.test(path.basename(receipt.path))||typeof receipt.sha256!=='string'||!/^[a-f0-9]{64}$/.test(receipt.sha256))return null;
   if(sha(await fs.readFile(receipt.path))!==receipt.sha256)return null;
  }
  return {kind:'native-preparation-failed',resultFile,resultSha256:sha(raw),phase:value.phase};
 }catch{return null;}
}
export const rotationLockPipe='\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1';
/** True only when the native rotation lock could be taken and released now. */
export function probeRotationLock(pipe=rotationLockPipe){
 return new Promise(resolve=>{
  const server=createServer(socket=>socket.destroy());
  server.once('error',()=>resolve(false));
  try{server.listen(pipe,()=>server.close(error=>resolve(!error)));}catch{resolve(false);}
 });
}
/** Read-only retired packet set for check/deploy; empty without a v2 queue. */
export async function readRetiredPackets(config){
 const directory=path.join(config.stateDirectory,'prebuild-queue-v2');
 if(!await exists(path.join(directory,'dispatches')))return new Set();
 return retiredPreparationPackets(await readPreparationQueueInventory(directory));
}

// An advisory check before spawning the native publisher. The native engines
// still own the rotation lock and revalidate every artifact before deployment.
export async function inspectMainPreparation(prepared,{git=gitAt,retiredPackets}={}){
 // A failed or abandoned preparation packet is retired: never verified, never deployed.
 if(isRetiredPacket(retiredPackets,prepared.packet))throw Error('该准备包已退役（准备失败或结果未知后另起新包），永不用于发布；本次未发布：'+prepared.packet);
 const {assertFrozenSource}=await import('./frozen-main-source.mjs');
 const identity=await assertFrozenSource({source:prepared.source,mainCommit:prepared.targetCommit,sourceTree:prepared.request.sourceTree},{git});
 const attempt=path.join(prepared.packet,'publish-'+prepared.targetCommit.slice(0,12));
 if(await exists(path.join(attempt,'STARTED.json'))&&!await exists(path.join(attempt,'SUCCESS.json')))throw Error('这个目标main已有未知结果的执行记录，禁止自动重试；原日志：'+attempt);
 if(await exists(path.join(attempt,'SUCCESS.json')))throw Error('目标出现成功记录，请重新从固定入口核对实际线上版本；本次未发布');
 const preparation=path.join(attempt,'preparation'),file=path.join(preparation,'PREPARED.json');
 if(!await exists(file))return {status:'not-ready',mainCommit:prepared.targetCommit,publicationPerformed:false,preparationFile:file,logsDirectory:path.join(prepared.packet,'logs')};
 const receipt=JSON.parse(await fs.readFile(file,'utf8'));
 assert.equal(receipt.version,'teruisi-main-preparation-v1','准备记录版本无效');
 assert.equal(receipt.requestSha256,sha(Buffer.from(JSON.stringify(prepared.request))),'准备包的请求不属于本次目标');
 assert.deepEqual(receipt.sourceIdentity,identity,'准备包的源码版本不属于本次目标');
 return {status:'ready-for-native-verification',mainCommit:prepared.targetCommit,publicationPerformed:false,preparationFile:file};
}

// PUBLICATION_GUARD_BEGIN
// Read-only (except the controller's own diagnostic log line) checks the live
// Django controller performs when entering maintenance, run BEFORE the native publisher writes STARTED. A failure here
// leaves the prepared packet reusable instead of turning it into an unknown.
export const liveDjangoRuntime='D:/teruisi-runtime/django-sales',liveDjangoController=liveDjangoRuntime+'/app/tools/django-local-service.ps1';
export const publicationProbeVersion='teruisi-publication-precondition-probe-v1',publicationProbeChecks=['Assert-RuntimeAclHardened','Assert-DeployedApplication'];
const windowsPowerShell='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
export function publicationProbeScript(input){
 const encoded=Buffer.from(JSON.stringify(input),'utf8').toString('base64');
 // The controller is dot-sourced inside its own scriptblock scope, so its top-level variables cannot reach the probe's.
 return ["$ErrorActionPreference='Stop'","$utf8=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=$utf8",
  "$pgInput=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+encoded+"'))|ConvertFrom-Json",
  "$pgResult=[ordered]@{version='"+publicationProbeVersion+"';checks=[ordered]@{};actors=@()}",
  "$pgChecks=@($pgInput.checks);$pgController=[string]$pgInput.controller;$pgRoot=[string]$pgInput.runtimeRoot;$pgDjango=[bool]$pgInput.checkDjango",
  // A recorded actor counts as alive when its PID exists with a creation time within 2s.
  "foreach($pgActor in @($pgInput.actors)){$pgAlive=$false;$pgProc=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$pgActor.processId) -ErrorAction SilentlyContinue;if($pgProc -and $pgProc.CreationDate){$pgAlive=[Math]::Abs(($pgProc.CreationDate.ToUniversalTime()-[DateTime]::Parse([string]$pgActor.creationDate).ToUniversalTime()).TotalSeconds) -lt 2};$pgResult.actors+=[ordered]@{processId=[int]$pgActor.processId;alive=[bool]$pgAlive}}",
  // Process snapshot for the foreign-child check (evaluated in Node): service roots from the run records and the Worker receipt, plus every process with its parent id.
  "$pgSnapshot=[ordered]@{roots=@();processes=@();unreadable=@()}",
  "if($pgInput.checkProcesses){$pgRootList=New-Object System.Collections.ArrayList;$pgBad=New-Object System.Collections.ArrayList;if(Test-Path -LiteralPath ([string]$pgInput.runDirectory) -PathType Container){foreach($pgFile in @(Get-ChildItem -LiteralPath ([string]$pgInput.runDirectory) -Filter '*.pid.json' -File)){try{$pgRec=[IO.File]::ReadAllText($pgFile.FullName,[Text.Encoding]::UTF8)|ConvertFrom-Json;if($null -eq $pgRec){throw 'empty'}}catch{[void]$pgBad.Add([string]$pgFile.Name);continue};if($pgRec.processId){[void]$pgRootList.Add([ordered]@{source=[string]$pgFile.Name;processId=[int]$pgRec.processId;creationDate=$(if($pgRec.creationDate){([DateTime]::Parse([string]$pgRec.creationDate)).ToUniversalTime().ToString('o')}else{$null})})}}};if(Test-Path -LiteralPath ([string]$pgInput.workerReceipt) -PathType Leaf){try{$pgRec=[IO.File]::ReadAllText([string]$pgInput.workerReceipt,[Text.Encoding]::UTF8)|ConvertFrom-Json;if($null -eq $pgRec){throw 'empty'};if($pgRec.supervisorPid){[void]$pgRootList.Add([ordered]@{source='worker-process.json';processId=[int]$pgRec.supervisorPid;creationDate=$(if($pgRec.supervisorCreationDate){([DateTime]::Parse([string]$pgRec.supervisorCreationDate)).ToUniversalTime().ToString('o')}else{$null})})}}catch{[void]$pgBad.Add([IO.Path]::GetFileName([string]$pgInput.workerReceipt))}};$pgSnapshot.roots=@($pgRootList);$pgSnapshot.unreadable=@($pgBad);$pgSnapshot.processes=@(Get-CimInstance Win32_Process -ErrorAction Stop|ForEach-Object{[ordered]@{processId=[int]$_.ProcessId;parentProcessId=[int]$_.ParentProcessId;name=[string]$_.Name;creationDate=$(if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}else{$null});readable=[bool]($_.CreationDate -and $_.ExecutablePath -and $_.CommandLine)}})}",
  "$pgResult.snapshot=$pgSnapshot",
  // Everything after the dot-source stays inside this scriptblock: the functions it defines are only visible here.
  "$pgRun={param($__pgController,$__pgRoot,$__pgNames);. $__pgController -RuntimeRoot $__pgRoot;$__pgOut=[ordered]@{};foreach($__pgName in $__pgNames){try{& $__pgName|Out-Null;$__pgOut[$__pgName]=[ordered]@{ok=$true}}catch{$__pgMessage=[string]$_.Exception.Message;$__pgOut[$__pgName]=[ordered]@{ok=$false;message=$__pgMessage.Substring(0,[Math]::Min(600,$__pgMessage.Length))}}};return $__pgOut}",
  "if($pgDjango){$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1';$pgFound=@(& $pgRun $pgController $pgRoot $pgChecks|Where-Object{$_ -is [System.Collections.Specialized.OrderedDictionary]});foreach($pgKey in $pgFound[$pgFound.Count-1].Keys){$pgResult.checks[$pgKey]=$pgFound[$pgFound.Count-1][$pgKey]}}",
  "[Console]::Out.WriteLine(($pgResult|ConvertTo-Json -Depth 5 -Compress))"].join('\n');
}
async function runPowerShellProbe(config,script){
 const result=await execute(windowsPowerShell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
  {encoding:'utf8',windowsHide:true,timeout:600000,maxBuffer:1024*1024,env:publisherEnvironment(process.env,config.gitDirectory,config.publisherBaseEnvironment)});
 return result.stdout;
}
export const liveWorkerReceipt='D:/teruisi-runtime/teruisi-worker-sales/state/worker-process.json',foreignChildrenCheck='Assert-NoForeignServiceChildren';
const asList=value=>Array.isArray(value)?value:value===undefined||value===null?[]:[value];
export const foreignChildrenAdvice='该程序的父进程号与后台服务进程相同，停止服务时会被误判或误杀；请先退出该程序（例如 360 办公的 readertray.exe）或重启电脑后再发布';
/**
 * Pure evaluation of a probe snapshot. The live controller walks a service root's
 * children by ParentProcessId, so a process that merely carries a recycled parent id
 * is either misjudged (unreadable) or killed (readable). A child older than its
 * claimed parent can only be a recycled id; an unreadable child cannot be verified.
 */
export function evaluateForeignServiceChildren(snapshot){
 const processes=new Map(),byParent=new Map();
 for(const item of asList(snapshot?.processes)){processes.set(item.processId,item);if(item.parentProcessId!==item.processId){if(!byParent.has(item.parentProcessId))byParent.set(item.parentProcessId,[]);byParent.get(item.parentProcessId).push(item);}}
 const unreadable=[...new Set(asList(snapshot?.unreadable).map(String))],flagged=[],seen=new Set();
 for(const root of asList(snapshot?.roots)){
  const live=processes.get(root.processId);
  // A stale record (dead pid, or a different process now holding the pid) is not a live service root.
  if(!live||!live.creationDate||(root.creationDate&&!(Math.abs(Date.parse(live.creationDate)-Date.parse(root.creationDate))<2000)))continue;
  const queue=[live];seen.add(live.processId);
  while(queue.length){
   const parent=queue.shift();
   for(const child of byParent.get(parent.processId)??[]){
    if(seen.has(child.processId))continue;seen.add(child.processId);
    const reason=child.readable!==true||!child.creationDate?'身份无法读取':Date.parse(child.creationDate)<Date.parse(parent.creationDate)?'创建时间早于其声称的父进程':null;
    if(reason){flagged.push({processId:child.processId,name:child.name,parentProcessId:parent.processId,parentName:parent.name,reason});continue;}
    queue.push(child);
   }
  }
 }
 const parts=[];
 if(unreadable.length)parts.push('无法解析进程记录文件：'+unreadable.slice(0,5).join('、')+(unreadable.length>5?'等':'')+'，不能确认哪些进程属于后台服务，请交 AI 检查这些文件后再发布');
 if(!flagged.length&&!parts.length)return {ok:true};
 if(!flagged.length)return {ok:false,message:parts.join('；').slice(0,1500)};
 const list=flagged.slice(0,5).map(item=>item.name+'（进程号 '+item.processId+'，声称的父进程 '+item.parentProcessId+' '+item.parentName+'，'+item.reason+'）').join('；');
 return {ok:false,message:(parts.concat('发现 '+flagged.length+' 个程序：'+list+(flagged.length>5?'等':'')+'。'+foreignChildrenAdvice).join('；')).slice(0,1500)};
}/** Read-only (except the controller's own diagnostic log line): live Django maintenance preconditions and liveness of recorded actors. */
export async function probePublicationPreconditions(config,{actors=[],checkDjango=true,checkProcesses=checkDjango,run=runPowerShellProbe,controller=liveDjangoController,runtimeRoot=liveDjangoRuntime,runDirectory=liveDjangoRuntime+'/run',workerReceipt=liveWorkerReceipt}={}){
 const input={actors:actors.map(actor=>({processId:actor.processId,creationDate:actor.creationDate})),checkDjango,controller:path.win32.normalize(controller),runtimeRoot:path.win32.normalize(runtimeRoot),checks:publicationProbeChecks,checkProcesses,runDirectory:path.win32.normalize(runDirectory),workerReceipt:path.win32.normalize(workerReceipt)};
 for(const actor of input.actors)assert.ok(Number.isSafeInteger(actor.processId)&&actor.processId>0&&Number.isFinite(Date.parse(actor.creationDate)),'记录的进程身份无效');
 const stdout=String(await run(config,publicationProbeScript(input))),line=stdout.trim().split(/\r?\n/).filter(text=>text.trim().startsWith('{')).at(-1);
 assert.ok(line,'发布前检查没有返回结果');const value=JSON.parse(line);
 assert.equal(value.version,publicationProbeVersion,'发布前检查结果版本无效');
 const actorResults=Array.isArray(value.actors)?value.actors:value.actors?[value.actors]:[];
 assert.equal(actorResults.length,input.actors.length,'进程检查结果数量不符');
 for(const [index,item] of actorResults.entries())assert.ok(item.processId===input.actors[index].processId&&typeof item.alive==='boolean','进程检查结果无效');
 const checks=value.checks&&typeof value.checks==='object'?value.checks:{};
 if(checkDjango)for(const name of publicationProbeChecks)assert.ok(checks[name]&&typeof checks[name].ok==='boolean','发布前检查缺少：'+name);
 if(checkProcesses){assert.ok(value.snapshot&&typeof value.snapshot==='object','发布前检查缺少进程快照');checks[foreignChildrenCheck]=evaluateForeignServiceChildren(value.snapshot);}
 return {checks,actors:actorResults};
}
export function preconditionFailures(probe){return Object.entries(probe.checks).filter(([,value])=>value.ok!==true).map(([name,value])=>name+'：'+(value.message||'未知原因'));}
const hardenHint='。修复办法：以普通权限运行 powershell -NoProfile -ExecutionPolicy Bypass -File "D:\\teruisi-runtime\\django-sales\\app\\tools\\django-local-service.ps1" -Action HardenAcl，完成后重新双击 发布main.bat';
export function describePreconditionFailures(failures){return failures.join('；')+(failures.some(text=>text.startsWith('Assert-RuntimeAclHardened'))?hardenHint:'');}
async function assertNoMaintenanceMarkers(runtimeRoot=liveDjangoRuntime){for(const name of ['system-maintenance.json','automation-drain.json'])assert.equal(await exists(path.join(runtimeRoot,'run',name)),false,'当前仍有维护或排空状态：'+name);}
/** Throws before any native publication write when entering maintenance would be refused. */
export async function assertPublicationPreconditions(config,{probe=probePublicationPreconditions,log=()=>{},runtimeRoot=liveDjangoRuntime}={}){
 try{await assertNoMaintenanceMarkers(runtimeRoot);}catch(error){throw Error('发布前检查未通过，本次未开始发布，发布包保持可用：'+error.message);}
 const failures=preconditionFailures(await probe(config,{checkDjango:true}));
 if(failures.length)throw Error('发布前检查未通过，本次未开始发布，发布包保持可用：'+describePreconditionFailures(failures));
 log('发布前检查通过：后台运行目录权限与部署清单符合进入维护的要求。');
}
/** Non-fatal variant for prepare/check: report whether a later publication would pass. */
export async function reportPublicationPreconditions(config,{probe=probePublicationPreconditions,log=()=>{},runtimeRoot=liveDjangoRuntime}={}){
 try{await assertPublicationPreconditions(config,{probe,log,runtimeRoot});return true;}
 catch(error){log('注意：现在发布会被拒绝。'+error.message.replace('，本次未开始发布，发布包保持可用',''));return false;}
}
async function readJsonObject(file){const value=JSON.parse(await fs.readFile(file,'utf8'));assert.ok(value&&typeof value==='object'&&!Array.isArray(value),'记录格式无效：'+path.basename(file));return value;}
/**
 * Read-only proof that a publication attempt failed while entering maintenance
 * and changed nothing. Returns null when the attempt has no STARTED record.
 */
export const maintenanceLogWindowBytes=32*1024*1024;
async function readLogTail(file){
 const handle=await fs.open(file,'r');
 try{
  const {size}=await handle.stat(),start=Math.max(0,size-maintenanceLogWindowBytes),buffer=Buffer.alloc(size-start);
  let read=0;while(read<buffer.length){const {bytesRead}=await handle.read(buffer,read,buffer.length-read,start+read);if(!bytesRead)break;read+=bytesRead;}
  const lines=buffer.subarray(0,read).toString('utf8').split(/\r?\n/);
  if(start>0)lines.shift();
  return {lines,truncated:start>0};
 }finally{await handle.close();}
}
/**
 * Read-only: did this maintenance id ever enter (and later end) according to the Django launcher log?
 * Reads the last 32 MiB of launcher.jsonl and of each rotated sibling (launcher.jsonl.N), newest first.
 * Throws when the log is missing or its readable window does not reach back to sinceMs.
 */
export async function scanMaintenanceLog(runtimeRoot,maintenanceId,sinceMs){
 const directory=path.join(runtimeRoot,'logs'),rank=name=>name==='launcher.jsonl'?0:Number(name.split('.').at(-1));
 const names=(await fs.readdir(directory)).filter(name=>/^launcher\.jsonl(?:\.\d+)?$/.test(name)).sort((x,y)=>rank(x)-rank(y));
 assert.ok(names[0]==='launcher.jsonl','后台启动器日志不存在');
 const events=[],uncovered='启动器日志窗口没有覆盖到发布开始时间，无法证明是否进入过维护';let covered=false;
 for(const name of names){
  const {lines,truncated}=await readLogTail(path.join(directory,name));let firstTimestamp=null;
  for(const line of lines){
   if(!line.trim().startsWith('{'))continue;
   const mentions=line.includes(maintenanceId);
   if(!mentions&&firstTimestamp!==null)continue;
   let item;try{item=JSON.parse(line);}catch{continue;}
   const at=Date.parse(item?.timestamp);if(!Number.isFinite(at))continue;
   if(firstTimestamp===null)firstTimestamp=at;
   if(mentions&&item.message===maintenanceId&&['system_maintenance_entered','system_maintenance_ended'].includes(item.event))events.push({event:item.event,at});
  }
  if(truncated&&(firstTimestamp===null||firstTimestamp>sinceMs))throw Error(uncovered);
  if(firstTimestamp!==null&&firstTimestamp<=sinceMs){covered=true;break;}
 }
 // Fail closed: if no file reaches back to STARTED.at, an entered event could lie before the readable history.
 if(!covered)throw Error(uncovered);
 const entered=events.filter(item=>item.event==='system_maintenance_entered'&&item.at>=sinceMs).sort((x,y)=>x.at-y.at)[0]??null;
 const ended=entered?events.filter(item=>item.event==='system_maintenance_ended'&&item.at>entered.at).sort((x,y)=>x.at-y.at)[0]??null:null;
 return {entered:entered?new Date(entered.at).toISOString():null,ended:ended?new Date(ended.at).toISOString():null};
}
export async function inspectNotEnteredPublication(config,selection,{inventory,probe=probePublicationPreconditions,probeRotation=probeRotationLock,fetchReady=()=>fetch('http://127.0.0.1:3000/_teruisi/local/health/ready',{headers:{'x-teruisi-local-health':'1'},signal:AbortSignal.timeout(15000)}),now=()=>new Date(),runtimeRoot=liveDjangoRuntime,readMaintenanceLog=scanMaintenanceLog}={}){
 const {packet,targetCommit:target,live}=selection,attempt=path.join(packet,'publish-'+target.slice(0,12));
 let names;try{names=(await fs.readdir(attempt)).sort();}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(!names.includes('STARTED.json'))return null;
 const reasons=[];const refuse=text=>{reasons.push(text);return {eligible:false,reasons,attempt};};
 if(names.includes('SUCCESS.json'))return refuse('已有成功记录');
 const unknown=names.filter(name=>!isNotEnteredAttemptMember(name));if(unknown.length)return refuse('发布记录含维护开始后才会出现的文件：'+unknown.join('、'));
 const missing=notEnteredRequiredMembers.filter(name=>!names.includes(name));if(missing.length)return refuse('缺少失败证据：'+missing.join('、'));
 const started=await readJsonObject(path.join(attempt,'STARTED.json')),failed=await readJsonObject(path.join(attempt,'FAILED.json'));
 const firstFailed=await readJsonObject(path.join(attempt,'maintenance-first-FAILED.json')),admission=await readJsonObject(path.join(attempt,'maintenance-admission.json'));
 const actorRecord=names.includes('maintenance-first-actor.json')?await readJsonObject(path.join(attempt,'maintenance-first-actor.json')):null;
 if(!notEnteredPhases.includes(failed.phase))return refuse('失败步骤不是进入维护：'+failed.phase);
 if(failed.automaticRetry!==false||firstFailed.automaticRetry!==false)return refuse('失败记录不是终态');
 if(started.mainCommit!==target||(failed.mainCommit!==undefined&&failed.mainCommit!==target))return refuse('失败记录不属于本次目标');
 if(!/^[a-f0-9]{32}$/.test(started.maintenanceId??'')||firstFailed.maintenanceId!==started.maintenanceId||admission.maintenanceId!==started.maintenanceId||(actorRecord&&actorRecord.maintenanceId!==started.maintenanceId))return refuse('维护编号不一致');
 if(names.includes('进入维护-started.json')||names.includes('进入维护-process.json')){
  if(!names.includes('进入维护-process.json'))return refuse('进入维护进程没有结束记录');
  const evidence=(await readJsonObject(path.join(attempt,'进入维护-process.json'))).processEvidence;
  if(!Number.isSafeInteger(evidence?.exitCode)||evidence.exitCode===0)return refuse('进入维护进程没有非零退出码');
  if(evidence.treeCleanupPending!==false)return refuse('进入维护进程的子进程清理未完成');
 }
 // Did this maintenance id ever enter? Only a launcher log that proves it can say; an entered one must also have ended.
 const sinceMs=Date.parse(started.at);if(!Number.isFinite(sinceMs))return refuse('发布开始记录没有有效时间');
 let maintenance;try{maintenance=await readMaintenanceLog(runtimeRoot,started.maintenanceId,sinceMs);}catch(error){return refuse('无法读取后台启动器日志，不能判断是否进入过维护：'+error.message);}
 if(maintenance.entered&&!maintenance.ended)return refuse('该次发布已进入维护，且没有结束维护的记录');
 const request=await readJsonObject(path.join(packet,'main-release-request.json'));
 if(request.mainCommit!==target||request.deployedCommit!==live.mainCommit)return refuse('线上版本已不是该包的前一版本');
 try{assert.deepEqual(request.predecessorWorker,live.head);}catch{return refuse('线上前端版本已变化');}
 if(request.predecessorDjangoSha256!==live.djangoManifestSha256)return refuse('线上后台版本已变化');
 if(started.predecessorChainStateSha256!==live.chainStateSha256)return refuse('前端版本链已变化');
 try{await assertNoMaintenanceMarkers(runtimeRoot);}catch(error){return refuse(error.message);}
 let health;try{const ready=await fetchReady();if(ready.status!==200)return refuse('当前服务未就绪');health=await ready.json();}catch{return refuse('当前服务未就绪');}
 if(health?.ok!==true||health.status!=='ready')return refuse('当前服务未就绪');
 if(!await probeRotation())return refuse('仍有发布或准备持有轮换锁');
 const dispatchRead=preparedDispatchForPacket(inventory,packet);if(!dispatchRead)return refuse('找不到准备出这个包的队列记录');
 if(!started.publisherOwner)return refuse('原发布缺少可核验的进程身份');
 const actors=[started.publisherOwner,actorRecord?.actor,actorRecord?.rotationOwner].filter(Boolean);
 const probed=await probe(config,{actors,checkDjango:true});
 if(probed.actors.some(item=>item.alive))return refuse('原发布进程仍在运行');
 const failures=preconditionFailures(probed);
 const evidence={};for(const name of notEnteredEvidenceMembers)if(names.includes(name))evidence[name]=sha(await fs.readFile(path.join(attempt,name)));
 const record={version:publicationRetirementVersion,at:now().toISOString(),dispatchId:dispatchRead.value.dispatchId,dispatchSha256:dispatchRead.sha256,selectedTarget:target,packet,attempt,consumePermitted:false,evidence,
  reason:failures.length?describePreconditionFailures(failures).slice(0,1600):null,
  basis:{phase:failed.phase,maintenanceId:started.maintenanceId,liveMainCommit:live.mainCommit,workerBindingSha256:live.head.bindingSha256,chainStateSha256:live.chainStateSha256,djangoManifestSha256:live.djangoManifestSha256,maintenanceMarkersAbsent:true,healthReady:true,rotationLockFree:true,actorsExited:true,attemptMembers:names,maintenanceEntered:Boolean(maintenance.entered),maintenanceEndedAt:maintenance.entered?maintenance.ended:null}};
 return {eligible:true,record,attempt,failures};
}
/** Under the queue lock: retire a provably not-entered publication so the target prepares again. */
export async function retireNotEnteredPublication(config,selection,{retirementScope,log=()=>{},inspect=inspectNotEnteredPublication}={}){
 const directory=path.join(config.stateDirectory,'prebuild-queue-v2');
 if(!await exists(path.join(directory,'dispatches')))return {status:'none'};
 const inventory=await readPreparationQueueInventory(directory);
 const result=await inspect(config,selection,{inventory});
 if(!result)return {status:'none'};
 if(!result.eligible)return {status:'refused',reasons:result.reasons,attempt:result.attempt};
 await invalidateRetirementReadScope(retirementScope,'publication-retirement-write');
 const written=await writePublicationRetirement(directory,result.record);
 if(result.record.basis.maintenanceEntered)log('上次发布已进入维护但已人工恢复为发布前版本（版本、标记、服务、进程已核实）；原记录全部保留，该包已退役：'+selection.packet+'。下一次发布会再次完整检查全部服务');else log('上次发布在“进入维护”时失败，已核实线上系统未被改动（版本、维护标记、服务、进程均与发布前一致）。原记录全部保留，该包已退役：'+selection.packet);
 if(result.record.reason)log('失败原因（只读诊断）：'+result.record.reason);
 log('退役记录：'+written.file);
 return {status:'retired',...written};
}
/** One sentence for both callers: why a STARTED attempt without a provable not-entered state is left untouched. */
export function describeRefusedRetirement(refused){return '上一次发布有开始记录，但现在不能证明系统未被改动（'+refused.reasons.join('；')+'）；本次未准备，原记录保留，稍后重试或交 AI 排查';}
// PUBLICATION_GUARD_END

export async function deployReadyMain(prepared,{progress,run=runPublisher,git=gitAt,gitDirectory,baseEnvironment,retirementScope,retiredPackets,preflight=async()=>{}}={}){
 const readiness=await inspectMainPreparation(prepared,{git,retiredPackets});
 if(readiness.status==='not-ready'){
  progress.log('========== 发布包尚未就绪，本次未发布 ==========');
  progress.log('目标main：'+prepared.targetCommit+'。原生制品尚未完成；请先双击 准备main.bat，准备成功后再双击 发布main.bat。');
  progress.log('打包日志目录：'+readiness.logsDirectory+'；若原打包已报错，请保留日志处理，不要重复启动。');
  return readiness;
 }
 progress.begin('发布前检查');
 await preflight();
 progress.complete();
 progress.begin('发布已准备好的目标main');
 progress.log('开始原生复验并发布目标 '+prepared.targetCommit+'，独立包：'+prepared.packet);
 await invalidateRetirementReadScope(retirementScope,'publisher-native-deploy');
 const result=await run(prepared.source,['--deploy-only'],gitDirectory,baseEnvironment);progress.complete();
 return result;
}
export async function preparationControlBinding(configFile){
 const config=JSON.parse(await fs.readFile(configFile,'utf8'));
 assert.equal(config.controlProtocol,'teruisi-main-control-v2','Preparation requires the controlled v2 entry');
 return readAdoptedControl(configFile,path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
}
export async function startPreparationConsumer(configFile){return wakePreparationTask(await preparationControlBinding(configFile));}
export async function assertPreparationConsumer(binding){assertOrdinaryIdentity(await currentPreparationIdentity(),binding.state.preparationTask?.sid);}
// PREPARATION_ELIGIBILITY_BEGIN
export async function assertOrdinaryPreparationContext(config,{probe=async()=>execute('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
 ['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],
 {encoding:'utf8',windowsHide:true,timeout:30000,env:publisherEnvironment(process.env,config.gitDirectory,config.publisherBaseEnvironment)})}={}){
 const result=await probe();assert.equal(result.stderr?.trim()??'','','Preparation token probe returned an error before DISPATCH');assert.equal(result.stdout.trim(),'False','Preparation requires ordinary-user admission before DISPATCH; no native preparation was started');
}
// PREPARATION_ELIGIBILITY_END
export async function assertSelectedPreparationSupported(config,selection,{makePlan=makeReleasePlan}={}){
 const plan=makePlan({base:selection.live.mainCommit,head:selection.targetCommit,cwd:config.repository});
 assert.equal(plan.baseSha,selection.live.mainCommit);assert.equal(plan.headSha,selection.targetCommit);
 const {assertMainSchemaPlanSupported}=await import('./main-schema-release.mjs');
 return assertMainSchemaPlanSupported(plan);
}
export async function assertSelectedDependencyCache(config,selection,{readLock=async()=>{
 const result=await execute('git',['-C',config.repository,'show',selection.targetCommit+':package-lock.json'],{encoding:null,windowsHide:true,env:publisherEnvironment(process.env,config.gitDirectory,config.publisherBaseEnvironment)});
 return result.stdout;
}}={}){
 assert.match(selection.targetCommit,/^[a-f0-9]{40}$/,'Frozen dependency target required');
 assert.match(config.cacheLockSha256??'',/^[a-f0-9]{64}$/,'Bound offline dependency lock required');
 const raw=await readLock();assert.ok(Buffer.isBuffer(raw),'Dependency admission requires exact Git object bytes');
 assert.equal(sha(raw),config.cacheLockSha256,'Selected main dependency lock has no matching offline cache; native preparation was not dispatched');
}
export async function drainLatestMainQueue(configFile,{binding,progress,observe=observeLatestMain,once=prepareLatestMainOnce,run=runPublisher,inspect=inspectMainPreparation,assertGeneration=assertControlGeneration,admit=assertOrdinaryPreparationContext,assertConsumerIdentity=assertPreparationConsumer,admitSelected=async(config,selection)=>{await assertSelectedPreparationSupported(config,selection);await assertSelectedDependencyCache(config,selection);},probeRotation=probeRotationLock,abandonmentGraceMs=defaultAbandonmentGraceMs,retirementScope,retireNotEntered=retireNotEnteredPublication}={}){
 binding??=await preparationControlBinding(configFile);
 const config=binding.config,directory=path.join(config.stateDirectory,'prebuild-queue-v2');
 if(retirementScope===undefined)return withRetirementReadScope(config,scope=>drainLatestMainQueue(configFile,{binding,progress,observe,once,run,inspect,assertGeneration,admit,assertConsumerIdentity,admitSelected,probeRotation,abandonmentGraceMs,retirementScope:scope,retireNotEntered}));
 // Consumer code that fails before the native process starts is a structured
 // rejection; native failures carry only what runPublisher validated.
 const beforeNative=async(stage,operation)=>{try{return await operation();}catch(error){if(error&&typeof error==='object')error.preparationTerminal={kind:'rejected-before-native',stage};throw error;}};
 return drainPreparationQueue(directory,{retirementScope,invalidateRetirementScope:reason=>invalidateRetirementReadScope(retirementScope,reason),configSha256:binding.state.configSha256,bundleSha256:binding.state.bundleSha256,
  reconciliationBinding:reconciliationGeneration(binding),
  abandonment:{graceMs:abandonmentGraceMs,probeRotationLock:()=>probeRotation(),inspectAttempt:inspectPreparationAttempt},
  assertGeneration:async()=>{await assertGeneration(binding);await assertRetirementAdmission(config,undefined,{scope:retirementScope});},admitPreparation:async()=>{await assertConsumerIdentity(binding);await admit(config);},admitSelectedPreparation:async selection=>{await assertRetirementAdmission(config,selection.targetCommit,{scope:retirementScope});await admitSelected(config,selection);},observe:async({retiredPackets}={})=>{
    const log=message=>progress?.log(message),selection=await observe(config,{retirementScope,retiredPackets,log});
    // Already under the queue lock. A publication that failed while entering maintenance and provably changed nothing retires its packet here,
    // so the same target prepares in the next '-rN' slot instead of leaving an unknown attempt that blocks every later ticket.
    if(selection&&typeof selection.packet==='string'&&selection.live&&selection.targetCommit!==selection.live.mainCommit){
     const outcome=await retireNotEntered(config,selection,{retirementScope,log});
     // A refused proof defers this ticket before any dispatch; the attempt and the queue are left exactly as they were.
     if(outcome?.status==='refused')throw Error(describeRefusedRetirement(outcome));
     if(outcome?.status==='retired'){
      log('准备队列在核实期间被占用（最长约 10 分钟）；此时双击 发布main 会提示“准备队列正在处理”，稍后再试即可。');
      return {...selection,packet:preparationPacketSlot(config.releaseDirectory,packetBaseName(selection.targetCommit,selection.live),await readRetiredPackets(config))};
     }
    }
    return selection;
   },
  prepare:async(selection,dispatch,reusablePreparation)=>{
   const prepared=await beforeNative('freeze-source',()=>once(config,selection,{retirementScope,log:message=>progress?.log(message)}));
   if(['already-current','non-production'].includes(prepared.status))return prepared;
   await beforeNative('pointer-write',()=>writeMainPreparationPointer(config,prepared,'request-frozen',{retirementScope}));
   // PREPARED remains native evidence. The queue never turns its own ticket
   // receipt into artifact integrity or deployment authorization.
   const existing=await beforeNative('inspect',()=>inspect(prepared));
   if(existing.status==='ready-for-native-verification'&&reusablePreparation)return beforeNative('reuse-check',async()=>{
    assert.equal(path.resolve(existing.preparationFile),path.resolve(reusablePreparation.preparationFile));
    assert.equal(sha(await fs.readFile(existing.preparationFile)),reusablePreparation.preparationSha256,'原生准备回执变化，不能复用原完成结果');
    await writeMainPreparationPointer(config,prepared,'prepared',{retirementScope});
    return reusablePreparation;
   });
   await invalidateRetirementReadScope(retirementScope,'publisher-native-prepare');
   const result=await run(prepared.source,['--prepare-only'],config.gitDirectory,config.publisherBaseEnvironment,{deadlineUnixMs:dispatch.deadlineUnixMs});
   assert.equal(result.mainCommit,prepared.targetCommit);assert.equal(result.status,'prepared-only');assert.equal(result.publicationPerformed,false);
   const readiness=await inspect(prepared);assert.equal(readiness.status,'ready-for-native-verification');
   await writeMainPreparationPointer(config,prepared,'prepared',{retirementScope});
   return {...result,preparationFile:readiness.preparationFile,preparationSha256:sha(await fs.readFile(readiness.preparationFile))};
  }});
}
export async function acquireMainPublicationQueue(binding,{assertGeneration=assertControlGeneration}={}){
 const release=await acquireQueueLock(path.join(binding.config.stateDirectory,'prebuild-queue-v2'));
 assert.ok(release,'准备队列正在处理，请等待打包完成后再发布；本次未开始发布');
 try{await assertGeneration(binding);return release;}catch(error){await release();throw error;}
}
export async function runLatestMainCli(args=process.argv.slice(2),binding){
 const {values}=parseArgs({args,options:{config:{type:'string'},check:{type:'boolean',default:false},'prepare-only':{type:'boolean',default:false},'consume-preparation':{type:'boolean',default:false},'no-pause':{type:'boolean',default:false},'abandon-dispatch':{type:'string'},'dispatch-sha256':{type:'string'},'result-sha256':{type:'string'},target:{type:'string'},packet:{type:'string'}}});
 const abandon=values['abandon-dispatch']!==undefined,evidence=['dispatch-sha256','result-sha256','target','packet'];
 assert.ok(!abandon||(!values.check&&!values['prepare-only']&&!values['consume-preparation']),'Abandon-only cannot prepare, check or publish');
 assert.ok(evidence.every(field=>abandon?typeof values[field]==='string':values[field]===undefined),'Abandon-only requires exact dispatch/result/target/packet evidence');
 assert.ok(!values['consume-preparation']||(!values.check&&!values['prepare-only']),'Consumer cannot submit or deploy');
 assert.ok(!(values.check&&values['prepare-only']),'检查与打包模式不能同时使用');
 assert.ok(values.config,'需要固定发布入口配置 --config');
 const config=JSON.parse(await fs.readFile(values.config,'utf8'));
 return withRetirementReadScope(config,scope=>runLatestMainCliOperation(values,config,binding,scope));
}
async function runLatestMainCliOperation(values,config,binding,retirementScope){
 await assertRetirementAdmission(config,undefined,{scope:retirementScope});
 if(config.controlProtocol==='teruisi-main-control-v2'){
  binding??=await preparationControlBinding(values.config);
  await invalidateRetirementReadScope(retirementScope,'control-execution-write');
  await controlExecution(binding,fileURLToPath(import.meta.url),values['abandon-dispatch']!==undefined?'abandon-only-submit':values['consume-preparation']?'consume-preparation':values['prepare-only']?'prepare-only':values.check?'check':'deploy-ready');
 }
 assert.ok(config.publisherBaseEnvironment,'缺少固定Windows发布环境，请更新发布入口；本次未部署');
 publisherEnvironment(process.env,config.gitDirectory,config.publisherBaseEnvironment);
 if(values['abandon-dispatch']!==undefined){
  assert.ok(binding,'Controlled reconciliation required');await invalidateRetirementReadScope(retirementScope,'abandon-only-submit');
  const submitted=await submitAbandonOnlyRequest(path.join(config.stateDirectory,'prebuild-queue-v2'),{generation:reconciliationGeneration(binding),dispatchId:values['abandon-dispatch'],dispatchSha256:values['dispatch-sha256'],originalResultSha256:values['result-sha256'],selectedTarget:values.target,packet:values.packet,assertGeneration:()=>assertControlGeneration(binding)});
  if(submitted.wakeRequired){await invalidateRetirementReadScope(retirementScope,'abandon-only-wake');await startPreparationConsumer(values.config);}
  const result={...submitted,publicationPerformed:false,preparationPerformed:false};console.log(JSON.stringify(result));return result;
 }
 if(values['consume-preparation']){assert.ok(binding,'Controlled consumer required');const result=await drainLatestMainQueue(values.config,{binding,retirementScope});console.log(JSON.stringify(result));return result;}
 await invalidateRetirementReadScope(retirementScope,'publisher-progress-write');
 const progress=createReleaseProgress(path.join(config.stateDirectory,'logs'),{taskName:values.check?'发布检查':values['prepare-only']?'打包':'发布'});
 let releaseQueue;
 try{
  if(values['prepare-only']){
   binding??=await preparationControlBinding(values.config);
   const directory=path.join(config.stateDirectory,'prebuild-queue-v2');
   await invalidateRetirementReadScope(retirementScope,'publisher-submit-ticket');
   const submitted=await submitPreparation(directory,{origin:'manual',configSha256:binding.state.configSha256,bundleSha256:binding.state.bundleSha256});
   await invalidateRetirementReadScope(retirementScope,'publisher-task-wake');
   await startPreparationConsumer(values.config,config);
   await invalidateRetirementReadScope(retirementScope,'publisher-wait');
   const until=Date.now()+1800000;
   for(;;){
    const result=await ticketResult(directory,submitted.requestId,submitted.ticketSha256);
    if(result){
     console.log(JSON.stringify(result));
     if(!['prepared','current','non-production','superseded'].includes(result.status))throw Error('准备请求需要处理，原记录保留：'+submitted.requestId+' / '+result.status);
     progress.log(result.status==='prepared'?'打包完成，等待新的上线授权。':'准备请求已完成：'+result.status+'；本次未部署。');
     if(result.status==='prepared')await reportPublicationPreconditions(config,{log:message=>progress.log(message)});
     return result;
    }
    if(Date.now()>=until){process.exitCode=2;progress.log('已退出等待，原准备请求仍保留；关闭观察不取消任务：'+submitted.requestId);return {status:'queued-or-running',requestId:submitted.requestId,publicationPerformed:false};}
    await new Promise(resolve=>setTimeout(resolve,500));
   }
  }
  if(!values.check&&binding){
   // Same queue -> rotation order as preparation. Own it before fetch can
   // emit a physical ref transaction for this very target.
   releaseQueue=await acquireMainPublicationQueue(binding);
  }
  progress.begin(values.check?'检查最新main（不部署）':'准备本次最新main');
  // Same retired packet set as the consumer; deploy reads it under the queue lock.
  let retiredPackets=await readRetiredPackets(config);
  let selection=await observeLatestMain(config,{retirementScope,retiredPackets,log:message=>progress.log(message)});
  if(!values.check&&releaseQueue&&selection.targetCommit!==selection.live.mainCommit){
   // A publication that failed while entering maintenance and provably changed
   // nothing retires its packet; the same target then needs a new preparation.
   const outcome=await retireNotEnteredPublication(config,selection,{retirementScope,log:message=>progress.log(message)});
   if(outcome.status==='refused')progress.log(describeRefusedRetirement(outcome)+'：'+outcome.attempt);
   if(outcome.status==='retired'){
    retiredPackets=await readRetiredPackets(config);
    selection={...selection,packet:preparationPacketSlot(config.releaseDirectory,packetBaseName(selection.targetCommit,selection.live),retiredPackets)};
    progress.log('下一步：先双击 准备main.bat 在新包 '+path.basename(selection.packet)+' 重新准备（约 25 分钟），完成后再双击 发布main.bat。');
   }
  }
  const prepared=await prepareLatestMainOnce(config,selection,{retirementScope,retiredPackets,log:message=>progress.log(message)});
  progress.complete();
  if(prepared.status==='already-current'){
   progress.log('当前线上已经是目标main '+prepared.targetCommit+'；本次没有执行发布。');
   console.log(JSON.stringify(prepared));return;
  }
  if(prepared.status==='non-production'){progress.log('最新main没有生产载荷变更，本次未执行发布。');console.log(JSON.stringify(prepared));return;}
  await writeMainPreparationPointer(config,prepared,'request-frozen',{retirementScope});
  if(values.check){await invalidateRetirementReadScope(retirementScope,'publisher-native-check');await runPublisher(prepared.source,['--check'],config.gitDirectory,config.publisherBaseEnvironment);const readiness=await inspectMainPreparation(prepared,{retiredPackets});await reportPublicationPreconditions(config,{log:message=>progress.log(message)});progress.log('检查通过：有新main待发布；'+(readiness.status==='not-ready'?'发布包尚未准备完成':'已有准备记录，正式发布时仍需原生复验')+'；本次未打包、未部署。');console.log(JSON.stringify({status:prepared.status,preparationStatus:readiness.status,targetCommit:prepared.targetCommit,currentCommit:prepared.currentCommit,packet:prepared.packet,source:prepared.source,components:prepared.request.components,migrate:prepared.request.migrate,publicationPerformed:false}));return;}
  const result=await deployReadyMain(prepared,{progress,retirementScope,retiredPackets,gitDirectory:config.gitDirectory,baseEnvironment:config.publisherBaseEnvironment,preflight:()=>assertPublicationPreconditions(config,{log:message=>progress.log(message)})});
  if(result.status==='not-ready'){process.exitCode=2;return;}
  assert.equal(result.mainCommit,prepared.targetCommit);
  if(result.status==='already-current'){progress.log('当前线上已经是目标main '+prepared.targetCommit+'；本次没有执行发布。');return;}
  assert.equal(result.status,'deployed_and_ready');assert.equal(result.publicationPerformed,true);
  const receiptPath=path.join(prepared.packet,'publish-'+prepared.targetCommit.slice(0,12),'SUCCESS.json');
  const receiptRaw=await fs.readFile(receiptPath),success=JSON.parse(receiptRaw);
  assert.equal(success.mainCommit,prepared.targetCommit,'成功记录不属于本次目标main');
  const rotation=await import(pathToFileURL(path.join(config.nativeToolsSource,'tools/worker-local-release-rotation.mjs')));
  const after=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});
  assert.equal(after.head.releaseId,success.workerRelease);assert.equal(after.head.manifestSha256,success.workerManifestSha256);
  assert.equal(sha(await fs.readFile('D:/teruisi-runtime/django-sales/app/deployment.json')),success.djangoManifestSha256);
  const api=await import(pathToFileURL(path.join(config.nativeToolsSource,'tools/worker-local-release.mjs')));
  const sourceTree=await api.hashRelativeFiles(prepared.source,await api.listGitSourceFiles(prepared.source));
  const catalog={...success,source:prepared.source,sourceTree,receiptPath,receiptSha256:sha(receiptRaw)};
  const catalogFile=path.join(config.stateDirectory,'PUBLISHED-MAIN.json'),temporary=catalogFile+'.'+process.pid+'.tmp';
  await invalidateRetirementReadScope(retirementScope,'publisher-catalog-write');
  await fs.writeFile(temporary,JSON.stringify(catalog,null,2)+'\n',{flag:'wx'});await fs.rename(temporary,catalogFile);
  progress.success('已确认本次目标main '+prepared.targetCommit+' 已切换，成功记录属于本次发布。');
 }catch(error){progress.fail(error);process.exitCode=1;}finally{
  if(releaseQueue){
   try{await invalidateRetirementReadScope(retirementScope,'publisher-unlock');}finally{await releaseQueue();}
   // A fetch hook may have queued a ticket while our lease was held.
   await startPreparationConsumer(values.config,config);
  }
  progress.close();
 }
}
export async function writeMainPreparationPointer(config,prepared,status,{retirementScope}={}){
 assert.ok(['request-frozen','prepared'].includes(status));
 await invalidateRetirementReadScope(retirementScope,'publisher-pointer-write');
 const file=path.join(config.stateDirectory,'LATEST-PREPARED.json'),temporary=file+'.'+randomUUID()+'.tmp';
 await fs.writeFile(temporary,JSON.stringify({...prepared,status,nativePreparationVerified:status==='prepared'},null,2)+'\n',{flag:'wx'});
 await fs.rename(temporary,file);
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url)))runLatestMainCli().catch(error=>{console.error(error.message);process.exitCode=1;});
