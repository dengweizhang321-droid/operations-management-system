/** Prepare the one-batch manual recovery kit. Writes tools/evidence only. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile,spawnSync} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {knownStartupRecovery as k,recoverySource,environmentHash,canonicalRecoveryEnvironment,verifyRecoverySourceClosure} from './manual-startup-reconcile.mjs';
const execute=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const state='D:/codex-isolated/main-manual-release-20261016',source=path.resolve(recoverySource),attempt=path.resolve(source,'..','publish-'+k.mainCommit.slice(0,12));
const read=async f=>JSON.parse(await fs.readFile(f,'utf8')),sha=async f=>createHash('sha256').update(await fs.readFile(f)).digest('hex');
const driverSha256=await sha(path.join(root,'tools/manual-startup-reconcile.mjs')),kitName='recovery-2f875fb01c79-'+driverSha256.slice(0,12),target=path.join(state,kitName);
const main=await read(path.join(state,'main-publisher-config.json')),request=await read(path.resolve(source,'..','main-release-request.json')),prepared=await read(path.join(attempt,'preparation/PREPARED.json')),started=await read(path.join(attempt,'STARTED.json')),failed=await read(path.join(attempt,'FAILED.json'));
assert.equal(request.mainCommit,k.mainCommit);assert.equal(request.schemaRelease.additionKind,'TmallWarehouse');assert.equal(request.schemaRelease.toGeneration,149);assert.equal(started.maintenanceId,k.maintenanceId);assert.equal(started.operationId,k.operationId);assert.equal(failed.phase,'切换前端');assert.equal(failed.maintenanceStarted,true);assert.equal(failed.processEvidence.engineFailure.stage,'InstallStartup');assert.equal(failed.processEvidence.engineFailure.processId,9332);assert.equal(prepared.workerPlan.planSha256,k.planSha256);
const planFile='D:/teruisi-runtime/teruisi-worker-sales/state/worker-release-rotation-plans/'+k.planSha256+'.json',plan=await read(planFile);assert.equal(await sha(planFile),k.planSha256);assert.equal(plan.candidate.bindingSha256,k.bindingSha256);
const approvedBinding=JSON.parse(plan.sourceBinding.raw);assert.equal(createHash('sha256').update(plan.sourceBinding.raw).digest('hex'),plan.sourceBinding.sha256);assert.equal(path.resolve(approvedBinding.sourceRoot),source);
const gitFile=(await execute('C:/Windows/System32/where.exe',['git.exe'],{encoding:'utf8',windowsHide:true})).stdout.trim().split(/\r?\n/)[0],gitSha256=await sha(gitFile);
await verifyRecoverySourceClosure(source,approvedBinding.identity.sourceInventorySha256,gitFile,gitSha256);
const executablePins=[];
for(const tuple of [plan.candidate,plan.predecessor]){
 const releaseRoot=path.join('D:/teruisi-runtime/teruisi-worker-sales/releases',tuple.releaseId),manifestFile=path.join(releaseRoot,'deployment-manifest.json');assert.equal(await sha(manifestFile),tuple.manifestSha256);executablePins.push({path:manifestFile,sha256:tuple.manifestSha256});
 for(let dir=releaseRoot;;dir=path.dirname(dir)){const stat=await fs.lstat(dir);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());if(path.dirname(dir)===dir)break;}
 const manifest=await read(manifestFile);
 for(const item of manifest.artifacts.keyFiles){assert.ok(!item.relativePath.startsWith('../')&&!path.posix.isAbsolute(item.relativePath));const file=path.join(releaseRoot,...item.relativePath.split('/'));const info=await fs.lstat(file);assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1);assert.equal(await sha(file),item.sha256);executablePins.push({path:file,sha256:item.sha256});}
}
const original=await import(pathToFileURL(path.join(source,'tools/publish-latest-main.mjs')));
const environment=original.publisherEnvironment(process.env,main.gitDirectory,main.publisherBaseEnvironment);
environment.PATH=main.pwshDirectory+';'+environment.PATH;environment.WRANGLER_HIDE_BANNER='true';environment.npm_config_cache=main.npmCacheDirectory;environment.npm_config_offline='true';environment.npm_config_prefer_online='false';environment.npm_config_prefer_offline='true';
const binding=await read(path.join(attempt,'preparation/source-binding.json'));assert.equal(environmentHash(environment),binding.identity.environmentSha256,'原构建环境已无法精确重建');assert.equal(await sha(process.execPath),binding.identity.nodeExecutableSha256);
const env=canonicalRecoveryEnvironment(environment),helper=path.join(root,'tools/manual-startup-preflight.ps1');
const probeResult=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-File',helper],{env,encoding:'utf8',windowsHide:true,timeout:60000});assert.equal(probeResult.status,0,probeResult.stderr);
const probe=JSON.parse(probeResult.stdout);assert.equal(probe.shortcut.controlled,true);assert.equal(probe.administrator,false);assert.deepEqual(probe.publishers,[]);assert.equal(probe.originalProcessPresent,false);assert.deepEqual(probe.originalDescendants,[]);assert.deepEqual(probe.listeners,[]);assert.deepEqual(probe.shortcut.temporaryFiles,[]);
const finalized=(await read(path.join(attempt,'完成结构迁移-result.json'))).value;assert.equal(finalized.status,'verified');assert.equal(finalized.result.status,'verified');assert.equal(finalized.result.migrationCount,149);assert.equal(finalized.result.permissionsVerified,true);assert.deepEqual(finalized.result.steps,request.schemaRelease.steps);
const active=await read('D:/teruisi-runtime/django-sales/tmall-warehouse-addition-active.json');assert.equal(active.version,'teruisi-tmall-warehouse-schema-addition-v1');assert.equal(active.operationId,k.operationId);assert.equal(active.receiptSha256,await sha('D:/teruisi-runtime/django-sales/tmall-warehouse-additions/'+k.operationId+'/finalized.json'));
const files=[path.resolve(source,'..','main-release-request.json'),request.schemaRelease.evidencePath,planFile,planFile+'.sha256',probe.expectedPowerShell,process.execPath];
for(const name of await fs.readdir(attempt)){const file=path.join(attempt,name);if((await fs.lstat(file)).isFile())files.push(file);}
for(const name of ['PREPARED.json','source-binding.json'])files.push(path.join(attempt,'preparation',name));
for(const name of ['worker-local-release.mjs','worker-local-release-rotation.mjs','release-batch.mjs'])files.push(path.join(source,'tools',name));
files.push('D:/teruisi-runtime/django-sales/tmall-warehouse-addition-active.json');
for(const name of ['candidate.json','finalized.json','install-intent.json','installed.json','plan.json'])files.push('D:/teruisi-runtime/django-sales/tmall-warehouse-additions/'+k.operationId+'/'+name);
const pins=[...executablePins];for(const file of [...new Set(files)])pins.push({path:file,sha256:await sha(file)});
const entrypointHashes={};for(const item of plan.protectedEntrypoints){const file=path.join('D:/运营管理系统',...item.relativePath.split('/'));entrypointHashes[item.relativePath]=await sha(file);assert.equal(entrypointHashes[item.relativePath],item.candidateSha256);}
const l=await fs.lstat(probe.shortcut.path,{bigint:true});assert.ok(l.isFile()&&!l.isSymbolicLink()&&l.nlink===1n);
const successor='D:/teruisi-runtime/teruisi-worker-sales/state/worker-release-successors/'+plan.predecessor.bindingSha256+'.json';pins.push({path:successor,sha256:await sha(successor)},{path:successor+'.sha256',sha256:await sha(successor+'.sha256')});
const git=args=>execute('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});
const config={version:'manual-startup-recovery-2f875fb0-v1',mainCommit:k.mainCommit,driverSha256,preflightFile:path.join(target,'manual-startup-preflight.ps1'),preflightSha256:await sha(helper),environment,originalEnvironmentSha256:environmentHash(environment),executionEnvironmentSha256:environmentHash(env),sid:probe.sid,shortcut:probe.shortcut,shortcutIdentity:{dev:String(l.dev),ino:String(l.ino),size:String(l.size),mtimeNs:String(l.mtimeNs)},shortcutSha256:await sha(probe.shortcut.path),candidate:plan.candidate,successorSha256:await sha(successor),sourceTree:started.sourceTree,djangoPreparedId:prepared.djangoPackage.id,originalFailureSha256:await sha(path.join(attempt,'FAILED.json')),sourceInventorySha256:approvedBinding.identity.sourceInventorySha256,gitFile,gitSha256,schemaRelease:request.schemaRelease,schemaInstalled:(await read(path.join(attempt,'迁移监控字段-result.json'))).value,schemaFinalized:finalized,pins,preparedByCommit:(await git(['rev-parse','HEAD'])).stdout.trim()};
assert.equal(await sha('D:/teruisi-runtime/django-sales/app/deployment.json'),k.djangoManifestSha256);
if(process.argv.includes('--check-only')){console.log(JSON.stringify({status:'recovery-configuration-checked',mainCommit:k.mainCommit,pinCount:pins.length,driverSha256,productionExecuted:false}));process.exit(0);}
assert.equal((await git(['status','--porcelain'])).stdout.trim(),'','请先提交并审查恢复工具，再安装执行入口');
await fs.mkdir(target,{recursive:false});
await fs.copyFile(path.join(root,'tools/manual-startup-reconcile.mjs'),path.join(target,'manual-startup-reconcile.mjs'));await fs.copyFile(helper,config.preflightFile);const configRaw=JSON.stringify(config,null,2)+'\n',configSha256=createHash('sha256').update(configRaw).digest('hex');await fs.writeFile(path.join(target,'recovery-config.json'),configRaw,{flag:'wx'});
for(const [name,mode] of [['续接本次发布.bat','--execute'],['检查本次续接.bat','--check']]){
 const bat='@echo off\r\nrem TERUISI original 2f875fb0 recovery entry\r\nsetlocal\r\nchcp 65001 >nul\r\n"'+process.execPath+'" "%~dp0'+kitName+'\\manual-startup-reconcile.mjs" --config "%~dp0'+kitName+'\\recovery-config.json" --config-sha256 '+configSha256+' '+mode+' %*\r\nset "release_exit=%errorlevel%"\r\necho.\r\nif /i not "%~1"=="--no-pause" pause\r\nexit /b %release_exit%\r\n';
 try{const old=await fs.readFile(path.join(state,name),'utf8');assert.ok(old.includes('rem TERUISI original 2f875fb0 recovery entry'),'已有不属于本恢复的入口');}catch(e){if(e.code!=='ENOENT')throw e;}
 await fs.writeFile(path.join(state,name),bat);
}
console.log('已生成原批次续接及只读检查BAT；本次未执行apply、退出维护或启动。');
