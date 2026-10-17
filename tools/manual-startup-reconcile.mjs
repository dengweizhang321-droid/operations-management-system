/** One original activated/absent-consumption batch only. Never re-enter publisher. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify,parseArgs} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';

const execute=promisify(execFile),self=fileURLToPath(import.meta.url);
export const knownStartupRecovery=Object.freeze({mainCommit:'2f875fb01c790c5539d407bae5acf9c90aa33612',planSha256:'c7d3bf1245b80409a165f9c4cbe07ccc3783ff3e721ad6f1cf25cc92c88f1484',releaseId:'20261017T063128Z-5d4113ddb3c5cada',manifestSha256:'bf272f0f0053f10719362aa5698b12c23f34ee261c2eb50e7559ba710e33aeaa',bindingSha256:'37756aa0736006b9092bea6b7634cb641bf67a77a886064696ad2220bfe7b956',chainStateSha256:'e1459ed674a7af227dae637d65144f65e80b5f61d180c3a66cb5bbc6c5ca2346',sequence:243,maintenanceId:'a6aafa9d2cc1448b954a98d7f4bd653c',operationId:'c1f782ee873241589c011e7f466b5d34',djangoManifestSha256:'357789c699f1e3d96fcca421186137bf65cd6e15ec051d4092240f7a1b830359'});
export const recoverySource='D:/codex-isolated/main-release-packages/2f875fb01c79-614f2724-69977619/source';
const runtime='D:/teruisi-runtime/teruisi-worker-sales',django='D:/teruisi-runtime/django-sales';
const digest=raw=>createHash('sha256').update(raw).digest('hex');
const exists=async file=>{try{await fs.access(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const hash=async file=>digest(await fs.readFile(file));
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
export const environmentHash=env=>digest(Buffer.from(canonical(Object.fromEntries(Object.entries(env).filter(([k])=>k.toUpperCase()!=='TERUISI_PROCESS_DEADLINE_UNIX_MS')))));
async function stableHash(file,{singleLink=false}={}){const before=await fs.lstat(file,{bigint:true});assert.ok(before.isFile()&&!before.isSymbolicLink()&&(!singleLink||before.nlink===1n),'输入并非普通文件或源码出现硬链接');const result=await hash(file),after=await fs.lstat(file,{bigint:true});for(const key of ['dev','ino','size','mtimeNs'])assert.equal(after[key],before[key],'输入读取时改变');return result;}
export async function verifyRecoverySourceClosure(source,expectedInventorySha256,gitFile,gitSha256){
 assert.equal(await stableHash(gitFile),gitSha256,'Git执行文件已改变');
 const {stdout}=await execute(gitFile,['-c','core.fsmonitor=false','-C',source,'ls-files','-z','--cached','--others','--exclude-standard'],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:4*1024*1024});
 const excluded=['dist/','node_modules/','.git/','.runtime/','outputs/','tmp/'];
 const files=stdout.split('\0').filter(Boolean).map(f=>f.replaceAll('\\','/')).filter(f=>f!=='.dev.vars'&&!excluded.some(p=>f.startsWith(p)));
 assert.ok(files.length&&new Set(files).size===files.length);const directories=new Set([path.resolve(source)]);
 for(let dir=path.dirname(path.resolve(source));;dir=path.dirname(dir)){directories.add(dir);if(path.dirname(dir)===dir)break;}
 for(const file of files){assert.ok(!file.startsWith('../')&&!path.posix.isAbsolute(file));let dir=path.dirname(path.resolve(source,...file.split('/')));while(dir.startsWith(path.resolve(source))){directories.add(dir);if(dir===path.resolve(source))break;dir=path.dirname(dir);}}
 for(const dir of directories){const stat=await fs.lstat(dir);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink(),'源码目录包含重解析点');}
 const inventory={};let cursor=0;
 await Promise.all(Array.from({length:8},async()=>{while(cursor<files.length){const file=files[cursor++];inventory[file]=await stableHash(path.join(source,...file.split('/')),{singleLink:true});}}));
 assert.equal(digest(Buffer.from(canonical(inventory))),expectedInventorySha256,'原封存源码或传递依赖改变，禁止加载');return files.length;
}
async function verifyPinnedFiles(config){for(const item of config.pins)assert.equal(await stableHash(item.path),item.sha256,'原封存输入变化：'+item.path);}
function nativeCommand(script,action,extra){
 const parameters={};if(action){assert.ok(['ExitMaintenance','Start','VerifyStartup'].includes(action));parameters.Action=action;parameters.Json=true;assert.ok(extra.length===0||(extra.length===2&&extra[0]==='-MaintenanceId'&&extra[1]===knownStartupRecovery.maintenanceId));if(extra.length)parameters.MaintenanceId=extra[1];}
 const payload=Buffer.from(JSON.stringify({file:script,parameters})).toString('base64');
 const code=["$ErrorActionPreference='Stop'","$utf8=[Text.UTF8Encoding]::new($false)",'[Console]::InputEncoding=$utf8;[Console]::OutputEncoding=$utf8;$OutputEncoding=$utf8',`$request=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json`,'$parameters=@{};foreach($p in $request.parameters.PSObject.Properties){$parameters[$p.Name]=$p.Value}','$global:LASTEXITCODE=0','& ([string]$request.file) @parameters','$invocationSucceeded=$?','if($global:LASTEXITCODE -ne 0){exit $global:LASTEXITCODE}','if(-not $invocationSucceeded){exit 1}','exit 0'].join('\n');
 const env={...process.env};for(const key of Object.keys(env))if(['PSMODULEPATH','TERUISI_DJANGO_SERVICE_LIBRARY_ONLY','TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY'].includes(key.toUpperCase()))delete env[key];env.PSModulePath='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules';
 return {host:'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',args:['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],env};
}
export function canonicalRecoveryEnvironment(original){
 const names='APPDATA COMMONPROGRAMFILES COMMONPROGRAMFILES(X86) COMSPEC HOMEDRIVE HOMEPATH LOCALAPPDATA LOGONSERVER NUMBER_OF_PROCESSORS OS PATH PATHEXT PROCESSOR_ARCHITECTURE PROGRAMDATA PROGRAMFILES PROGRAMFILES(X86) SYSTEMDRIVE SYSTEMROOT TEMP TMP USERDOMAIN USERNAME USERPROFILE WINDIR WRANGLER_HIDE_BANNER NPM_CONFIG_CACHE NPM_CONFIG_OFFLINE NPM_CONFIG_PREFER_ONLINE NPM_CONFIG_PREFER_OFFLINE'.split(' ');
 const seen=new Set();for(const [key,value] of Object.entries(original)){assert.ok(names.includes(key.toUpperCase())&&!seen.has(key.toUpperCase())&&typeof value==='string'&&!value.includes('\0'),'恢复环境含未知或歧义输入');seen.add(key.toUpperCase());}
 for(const key of ['PATH','SYSTEMROOT','TEMP','USERPROFILE','LOGONSERVER'])assert.ok(Object.hasOwn(original,key),'恢复环境不完整');
 return {...original,PATH:original.PATH.split(';').map(p=>path.win32.normalize(p)).join(';')};
}
export function assertStartupRecoverySnapshot(snapshot,config){
 const k=knownStartupRecovery;
 assert.deepEqual(snapshot.head,config.candidate);assert.equal(snapshot.head.releaseId,k.releaseId);assert.equal(snapshot.head.manifestSha256,k.manifestSha256);assert.equal(snapshot.head.bindingSha256,k.bindingSha256);
 assert.equal(snapshot.chainStateSha256,k.chainStateSha256);assert.equal(snapshot.sequence,k.sequence);assert.equal(snapshot.successorSha256,config.successorSha256);
 assert.equal(snapshot.djangoManifestSha256,k.djangoManifestSha256);assert.equal(snapshot.sourceCommit,k.mainCommit);assert.equal(snapshot.sourceTree,config.sourceTree);assert.equal(snapshot.sourceStatus,'');
 assert.equal(snapshot.maintenance?.id,k.maintenanceId);assert.equal(snapshot.maintenance?.keepPostgres,true);assert.equal(snapshot.maintenance?.drainedStopped,true);
 assert.equal(snapshot.maintenance?.version,'teruisi-system-maintenance-v1');assert.equal(path.win32.normalize(snapshot.maintenance?.runtimeRoot??'').toUpperCase(),path.win32.normalize(django).toUpperCase());
 assert.equal(snapshot.drain?.id,k.maintenanceId);assert.equal(snapshot.drain?.version,'teruisi-automation-drain-v1');assert.equal(snapshot.drain?.keepPostgres,true);assert.equal(snapshot.drain?.phase,'requests');
 assert.equal(path.win32.normalize(snapshot.drain?.runtimeRoot??'').toUpperCase(),path.win32.normalize(django).toUpperCase());
 assert.equal(snapshot.consumptionPresent,false,'已有consumption，不能套用本次缺失分支');assert.equal(snapshot.consumptionSidecarPresent,false,'孤立consumption sidecar');
 assert.equal(snapshot.probe.version,'manual-startup-preflight-v1');assert.equal(snapshot.probe.sid,config.sid);assert.equal(snapshot.probe.administrator,false);assert.equal(snapshot.probe.originalProcessPresent,false);
 for(const key of ['originalDescendants','publishers','listeners'])assert.deepEqual(snapshot.probe[key],[],key+'尚未清空');
 assert.equal(snapshot.probe.shortcut.controlled,true);assert.deepEqual(snapshot.probe.shortcut.temporaryFiles,[]);
 for(const key of ['target','arguments','workingDirectory','path'])assert.equal(snapshot.probe.shortcut[key],config.shortcut[key]);
 assert.deepEqual(snapshot.shortcutIdentity,config.shortcutIdentity,'旧启动项已改变');assert.equal(snapshot.shortcutSha256,config.shortcutSha256);
 assert.deepEqual(snapshot.entrypointHashes,config.entrypointHashes,'受保护入口并非全部已安装candidate');
}
export const recoveryRecordNames=['RECOVERY-STARTED.json',...['WorkerApplyRecovery','ExitMaintenance','Start','VerifyStartup','FinalVerification'].flatMap(stage=>[stage+'-started.json',stage+'-result.json'])];
export function assertCompletedStartupRecovery(receipt,config,records){
 const k=knownStartupRecovery;
 assert.equal(receipt.status,'deployed_and_ready');assert.equal(receipt.recoveryProtocol,'activated-startup-path-v1');assert.equal(receipt.originalFailureSha256,config.originalFailureSha256);assert.equal(receipt.mainCommit,k.mainCommit);assert.equal(receipt.maintenanceId,k.maintenanceId);
 assert.deepEqual(receipt.components,['worker','django']);assert.equal(receipt.workerRelease,k.releaseId);assert.equal(receipt.workerManifestSha256,k.manifestSha256);assert.equal(receipt.djangoManifestSha256,k.djangoManifestSha256);assert.equal(receipt.sourceTree,config.sourceTree);assert.equal(receipt.djangoPreparedId,config.djangoPreparedId);assert.equal(receipt.backendDeploymentReplayed,false);assert.equal(receipt.schemaInstallationReplayed,false);
 assert.equal(receipt.schemaReceipt?.operationId,k.operationId);assert.equal(receipt.schemaReceipt?.maintenanceId,k.maintenanceId);assert.deepEqual(receipt.schemaReceipt?.release,config.schemaRelease);assert.deepEqual(receipt.schemaReceipt?.installed,config.schemaInstalled);assert.deepEqual(receipt.schemaReceipt?.finalized,config.schemaFinalized);
 assert.deepEqual(Object.keys(receipt.recoveryRecords??{}).sort(),[...recoveryRecordNames].sort());
 for(const name of recoveryRecordNames){assert.ok(records[name]);assert.equal(digest(records[name]),receipt.recoveryRecords[name],'续接步骤原件摘要变化：'+name);assert.ok(Number.isFinite(Date.parse(JSON.parse(records[name]).at)));}
 const record=name=>JSON.parse(records[name]),start=record('RECOVERY-STARTED.json');
 assert.equal(start.protocol,'activated-startup-path-v1');assert.equal(start.configSha256,config.configSha256);assert.equal(start.originalFailureSha256,config.originalFailureSha256);assert.equal(start.maintenanceId,k.maintenanceId);assert.equal(start.operationId,k.operationId);assert.equal(start.planSha256,k.planSha256);assertStartupRecoverySnapshot(start.snapshot,config);
 const applied=record('WorkerApplyRecovery-result.json').value;assert.deepEqual(applied,receipt.workerApplyRecovery);assert.equal(applied.status,'already_activated');assert.equal(applied.planSha256,k.planSha256);assert.equal(applied.releaseId,k.releaseId);assert.equal(applied.manifestSha256,k.manifestSha256);assert.equal(applied.successorSha256,config.successorSha256);
 const exited=record('ExitMaintenance-result.json').value;assert.equal(exited.status,'maintenance_ended');assert.equal(exited.maintenanceId,k.maintenanceId);
 const run=record('Start-result.json').value;assert.ok(['started','already_running'].includes(run.status));assert.equal(run.manifestSha256,k.manifestSha256);
 const shortcut=record('VerifyStartup-result.json').value;assert.equal(shortcut.status,'verified');assert.equal(shortcut.startupVerified,true);assert.equal(shortcut.releaseId,k.releaseId);assert.equal(shortcut.manifestSha256,k.manifestSha256);
 const final=record('FinalVerification-result.json').value;assert.equal(final.status,'ready');assert.equal(final.workerRelease,k.releaseId);assert.equal(final.workerManifestSha256,k.manifestSha256);assert.equal(final.djangoManifestSha256,k.djangoManifestSha256);assert.equal(final.maintenanceCleared,true);
}
export async function runStartupRecovery(config,ctx,{check=false}={}){
 const k=knownStartupRecovery;
 return ctx.withLock(async lease=>{
  await ctx.pinInputs();
  if(await ctx.successExists())return ctx.verifyExistingSuccess();
  assert.equal(await ctx.startedExists(),false,'本次续接已有开始记录且未完成，禁止重放，请保留日志核对');
  const snapshot=await ctx.snapshot();assertStartupRecoverySnapshot(snapshot,config);
  if(check)return {status:'checked-recovery-inputs',mainCommit:k.mainCommit,productionExecuted:false};
  await ctx.save('RECOVERY-STARTED.json',{at:new Date().toISOString(),protocol:'activated-startup-path-v1',configSha256:config.configSha256,originalFailureSha256:config.originalFailureSha256,maintenanceId:k.maintenanceId,operationId:k.operationId,planSha256:k.planSha256,snapshot,originalEnvironmentSha256:environmentHash(config.environment),executionEnvironmentSha256:environmentHash(canonicalRecoveryEnvironment(config.environment)),changedEnvironmentKeys:['PATH']});
  const step=async(name,action,verify)=>{await ctx.save(name+'-started.json',{at:new Date().toISOString()});const result=await action();await verify(result);await ctx.save(name+'-result.json',{at:new Date().toISOString(),value:result});return result;};
  try{
   const applied=await step('WorkerApplyRecovery',()=>ctx.apply(lease),async result=>{
    assert.equal(result.status,'already_activated');assert.equal(result.planSha256,k.planSha256);assert.equal(result.releaseId,k.releaseId);assert.equal(result.manifestSha256,k.manifestSha256);assert.equal(result.successorSha256,config.successorSha256);await ctx.verifyConsumption(result);
   });
   await step('ExitMaintenance',()=>ctx.lifecycle('ExitMaintenance',['-MaintenanceId',k.maintenanceId]),async result=>{assert.equal(result.status,'maintenance_ended');assert.equal(result.maintenanceId,k.maintenanceId);await ctx.assertMaintenanceCleared();});
   await step('Start',()=>ctx.lifecycle('Start',[]),async result=>{assert.ok(['started','already_running'].includes(result.status));assert.equal(result.manifestSha256,k.manifestSha256);});
   await step('VerifyStartup',()=>ctx.lifecycle('VerifyStartup',[]),async result=>{assert.equal(result.status,'verified');assert.equal(result.startupVerified,true);assert.equal(result.releaseId,k.releaseId);assert.equal(result.manifestSha256,k.manifestSha256);});
   await step('FinalVerification',()=>ctx.finishProof(),async result=>{assert.equal(result.status,'ready');assert.equal(result.workerRelease,k.releaseId);assert.equal(result.workerManifestSha256,k.manifestSha256);assert.equal(result.djangoManifestSha256,k.djangoManifestSha256);assert.equal(result.maintenanceCleared,true);});
   const receipt=await ctx.publishSuccess(applied);
   return {status:'deployed_and_ready',mainCommit:k.mainCommit,receiptPath:receipt,productionExecuted:true};
  }catch(error){await ctx.save('FAILED.json',{at:new Date().toISOString(),error:String(error.message).slice(0,1800),processEvidence:error.processEvidence??null,automaticRetry:false});throw error;}
 });
}
async function fileIdentity(file){const s=await fs.lstat(file,{bigint:true});assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n);return {dev:String(s.dev),ino:String(s.ino),size:String(s.size),mtimeNs:String(s.mtimeNs)};}
async function productionContext(config){
 const k=knownStartupRecovery,source=path.resolve(recoverySource),attempt=path.resolve(source,'..','publish-'+k.mainCommit.slice(0,12)),out=path.join(attempt,'reconciliation','startup-path-v1');
 // Validate all transitive source bytes before any original code is loaded.
 await verifyPinnedFiles(config);await verifyRecoverySourceClosure(source,config.sourceInventorySha256,config.gitFile,config.gitSha256);
 const api=await import(pathToFileURL(path.join(source,'tools/worker-local-release.mjs'))),rotation=await import(pathToFileURL(path.join(source,'tools/worker-local-release-rotation.mjs')));
 const manifest=path.join(runtime,'releases',k.releaseId,'deployment-manifest.json'),service=path.join(path.dirname(manifest),'tools/worker-local-service.ps1');
 const consumptionFile=path.join(runtime,'state/worker-release-rotation-consumptions',k.planSha256+'.json');
 const plan=await read(path.join(runtime,'state/worker-release-rotation-plans',k.planSha256+'.json'));
 const successorFile=path.join(runtime,'state/worker-release-successors',plan.predecessor.bindingSha256+'.json');
 const command=async(script,action,extra=[])=>{
  const cmd=nativeCommand(script,action,extra);
  const result=await api.runProcess(cmd.host,cmd.args,{cwd:path.dirname(script),env:cmd.env,timeoutMs:1800000,outputProtocol:'direct-exit-files',cleanup:'preserve',label:'original-startup-recovery-'+(action??'preflight')});
  return JSON.parse(result.stdout.trim());
 };
 const pins=()=>verifyPinnedFiles(config);
 const chain=()=>rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});
 const entrypoints=async()=>{const values={};for(const item of plan.protectedEntrypoints){const file=path.join('D:/运营管理系统',...item.relativePath.split('/'));values[item.relativePath]=await hash(file);assert.equal(values[item.relativePath],item.candidateSha256);}return values;};
 const cleared=async()=>{for(const name of ['system-maintenance.json','automation-drain.json'])assert.equal(await exists(path.join(django,'run',name)),false,'维护或排空尚未退出');};
 const finish=async()=>{
  const current=await chain();assert.equal(current.head.releaseId,k.releaseId);assert.equal(current.head.manifestSha256,k.manifestSha256);assert.equal(current.chainStateSha256,k.chainStateSha256);assert.equal(await hash(path.join(django,'app/deployment.json')),k.djangoManifestSha256);await cleared();
  const response=await fetch('http://127.0.0.1:3000/_teruisi/local/health/ready',{headers:{'x-teruisi-local-health':'1'},signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);const health=await response.json();assert.equal(health.ok,true);assert.equal(health.status,'ready');
  return {status:'ready',workerRelease:k.releaseId,workerManifestSha256:k.manifestSha256,djangoManifestSha256:k.djangoManifestSha256,maintenanceCleared:true};
 };
 return {
  withLock:fn=>rotation.withRotationLock(async lease=>{await rotation.assertActiveBatchOwnership(runtime);return fn(lease);}),pinInputs:pins,
  successExists:()=>exists(path.join(attempt,'SUCCESS.json')),startedExists:()=>exists(path.join(out,'RECOVERY-STARTED.json')),
  verifyExistingSuccess:async()=>{
   const done=await read(path.join(attempt,'SUCCESS.json'));assert.equal(path.resolve(done.source),source);assert.equal(path.resolve(done.reconciliationDirectory),out);
   const records={};for(const name of recoveryRecordNames)records[name]=await fs.readFile(path.join(out,name));assertCompletedStartupRecovery(done,config,records);
   assert.equal(await hash(consumptionFile),done.workerApplyRecovery.consumptionSha256);assert.equal((await fs.readFile(consumptionFile+'.sha256','utf8')).trim(),done.workerApplyRecovery.consumptionSha256);
   const verified=await command(service,'VerifyStartup');assert.equal(verified.startupVerified,true);assert.equal(verified.manifestSha256,k.manifestSha256);assert.equal(verified.releaseId,k.releaseId);await finish();return {status:'already-completed',productionExecuted:false};
  },
  snapshot:async()=>{
   const current=await chain(),git=async args=>(await execute(config.gitFile,['-C',source,...args],{encoding:'utf8',windowsHide:true,timeout:15000})).stdout.trim();
   return {head:current.head,chainStateSha256:current.chainStateSha256,sequence:current.successorCount,successorSha256:await hash(successorFile),djangoManifestSha256:await hash(path.join(django,'app/deployment.json')),sourceCommit:await git(['rev-parse','HEAD']),sourceTree:await git(['rev-parse','HEAD^{tree}']),sourceStatus:await git(['status','--porcelain']),maintenance:await read(path.join(django,'run/system-maintenance.json')),drain:await read(path.join(django,'run/automation-drain.json')),consumptionPresent:await exists(consumptionFile),consumptionSidecarPresent:await exists(consumptionFile+'.sha256'),probe:await command(config.preflightFile),shortcutIdentity:await fileIdentity(config.shortcut.path),shortcutSha256:await hash(config.shortcut.path),entrypointHashes:await entrypoints()};
  },
  save:async(name,value)=>{await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});console.log('['+new Date().toISOString()+'] '+name);},
  apply:lease=>rotation.applyApprovedRotationPlan({approvedPlanSha256:k.planSha256,rotationLease:lease}),
  verifyConsumption:async result=>{
   const raw=await fs.readFile(consumptionFile),value=JSON.parse(raw);assert.equal(digest(raw),result.consumptionSha256);assert.equal((await fs.readFile(consumptionFile+'.sha256','utf8')).trim(),result.consumptionSha256);assert.equal(raw.toString(),api.canonicalJson(value)+'\n');
   assert.equal(value.approvedPlanSha256,k.planSha256);assert.equal(value.successorRecordSha256,config.successorSha256);assert.equal(value.successorBindingSha256,k.bindingSha256);assert.equal(value.startupBinding.releaseId,k.releaseId);assert.equal(value.startupBinding.manifestSha256,k.manifestSha256);assert.equal(value.startupBinding.bindingSha256,result.startupBindingSha256);
   const current=await chain();assert.equal(current.chainStateSha256,k.chainStateSha256);assert.equal(current.successorCount,k.sequence);assert.deepEqual(await entrypoints(),config.entrypointHashes);
  },
  lifecycle:(action,extra)=>command(service,action,extra),assertMaintenanceCleared:cleared,finishProof:finish,
  publishSuccess:async applied=>{
   await pins();const request=await read(path.resolve(source,'..','main-release-request.json'));
   const installed=(await read(path.join(attempt,'迁移监控字段-result.json'))).value,finalized=(await read(path.join(attempt,'完成结构迁移-result.json'))).value;
   const recoveryRecords={},rawRecords={};for(const name of recoveryRecordNames){const raw=await fs.readFile(path.join(out,name));rawRecords[name]=raw;recoveryRecords[name]=digest(raw);}
   const receipt={status:'deployed_and_ready',at:new Date().toISOString(),mainCommit:k.mainCommit,components:request.components,workerRelease:k.releaseId,workerManifestSha256:k.manifestSha256,djangoManifestSha256:k.djangoManifestSha256,source,sourceTree:config.sourceTree,djangoPreparedId:config.djangoPreparedId,maintenanceId:k.maintenanceId,migration:request.schemaRelease.steps[0],schemaReceipt:{operationId:k.operationId,maintenanceId:k.maintenanceId,release:request.schemaRelease,installed,finalized},backupPerformed:false,recoveryProtocol:'activated-startup-path-v1',originalFailureSha256:config.originalFailureSha256,reconciliationDirectory:out,workerApplyRecovery:applied,backendDeploymentReplayed:false,schemaInstallationReplayed:false,recoveryRecords};
   assertCompletedStartupRecovery(receipt,config,rawRecords);
   const target=path.join(attempt,'SUCCESS.json');await fs.writeFile(target,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return target;
  }
 };
}
async function main(){
 const {values}=parseArgs({options:{config:{type:'string'},'config-sha256':{type:'string'},check:{type:'boolean'},execute:{type:'boolean'},host:{type:'boolean'},'no-pause':{type:'boolean'}}});
 assert.ok(values.config&&Boolean(values.check)!==Boolean(values.execute),'只支持明确 --check 或 --execute');
 assert.match(values['config-sha256']??'',/^[a-f0-9]{64}$/);const rawConfig=await fs.readFile(values.config);assert.equal(digest(rawConfig),values['config-sha256'],'恢复配置原始摘要不匹配');
 const config=JSON.parse(rawConfig);config.configSha256=values['config-sha256'];assert.equal(config.version,'manual-startup-recovery-2f875fb0-v1');assert.equal(config.mainCommit,knownStartupRecovery.mainCommit);assert.equal(await stableHash(self,{singleLink:true}),config.driverSha256);assert.equal(await stableHash(config.preflightFile,{singleLink:true}),config.preflightSha256);
 const env=canonicalRecoveryEnvironment(config.environment);assert.equal(environmentHash(config.environment),config.originalEnvironmentSha256);assert.equal(environmentHash(env),config.executionEnvironmentSha256);
 if(!values.host){
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[self,'--config',values.config,'--config-sha256',values['config-sha256'],values.check?'--check':'--execute','--host'],{env,stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',(code,signal)=>{process.exitCode=code??1;signal?reject(Error(signal)):resolve();});});return;
 }
 assert.equal(environmentHash(process.env),config.executionEnvironmentSha256,'恢复宿主实际环境不匹配');
 const ctx=await productionContext(config),save=ctx.save;let phase='核对原批次现场';const started=Date.now();
 ctx.save=async(name,value)=>{if(name.endsWith('-started.json'))phase=name.replace('-started.json','');return save(name,value);};
 const timer=setInterval(()=>console.log('['+new Date().toISOString()+'] '+phase+' 仍在进行，续接已用 '+Math.floor((Date.now()-started)/1000)+' 秒，请保持窗口打开。'),30000);timer.unref();
 try{const result=await runStartupRecovery(config,ctx,{check:values.check});console.log(JSON.stringify(result));if(result.status==='deployed_and_ready')console.log('========== 本次发布续接成功 ==========');}finally{clearInterval(timer);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===self)main().catch(error=>{console.error('续接已停止：'+error.message);process.exitCode=1;});
