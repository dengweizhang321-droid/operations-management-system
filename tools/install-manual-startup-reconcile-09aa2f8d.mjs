/** Prepare the sealed one-batch recovery kit for main 09aa2f8d. Writes ONLY the new kit directory. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile,spawnSync} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {knownStartupRecovery as k,recoverySource,environmentHash,canonicalRecoveryEnvironment,verifyRecoverySourceClosure} from './manual-startup-reconcile-09aa2f8d.mjs';
const execute=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const state='D:/codex-isolated/main-manual-release-20261016',source=path.resolve(recoverySource),attempt=path.resolve(source,'..','publish-'+k.mainCommit.slice(0,12));
const runtime='D:/teruisi-runtime/teruisi-worker-sales',django='D:/teruisi-runtime/django-sales';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8')),sha=async f=>createHash('sha256').update(await fs.readFile(f)).digest('hex');
const exists=async f=>{try{await fs.access(f);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const driverFile=path.join(root,'tools/manual-startup-reconcile-09aa2f8d.mjs'),helper=path.join(root,'tools/manual-startup-preflight-09aa2f8d.ps1');
const driverSha256=await sha(driverFile),helperSha256=await sha(helper);
const kitHash=createHash('sha256').update([driverSha256,helperSha256,await sha(fileURLToPath(import.meta.url))].join(':')).digest('hex');
const kitName='recovery-09aa2f8db9b3-'+kitHash.slice(0,12),target=path.join(state,kitName);
// 1. Original attempt: exactly the failed-at-InstallStartup shape.
const main=await read(path.join(state,'main-publisher-config.json')),request=await read(path.resolve(source,'..','main-release-request.json')),prepared=await read(path.join(attempt,'preparation/PREPARED.json')),started=await read(path.join(attempt,'STARTED.json')),failed=await read(path.join(attempt,'FAILED.json'));
assert.equal(await sha(path.join(attempt,'FAILED.json')),k.originalFailureSha256);assert.equal(await sha(path.join(attempt,'STARTED.json')),k.originalStartedSha256);
assert.equal(request.mainCommit,k.mainCommit);assert.deepEqual(request.components,['worker','django']);assert.equal(request.migrate,false);assert.ok(!Object.hasOwn(request,'schemaRelease'),'本批次不应有结构迁移');
assert.equal(started.maintenanceId,k.maintenanceId);assert.equal(failed.phase,'切换前端');assert.equal(failed.maintenanceStarted,true);assert.equal(failed.automaticRetry,false);assert.equal(failed.processEvidence.engineFailure.stage,'InstallStartup');assert.equal(failed.processEvidence.engineFailure.processId,38384);
assert.equal(started.publisherOwner.processId,23688);assert.equal(started.sourceTree,prepared.sourceIdentity.tree);
assert.equal(prepared.workerPlan.planSha256,k.planSha256);assert.equal(prepared.workerPlan.candidateReleaseId,k.releaseId);assert.equal(prepared.workerPlan.candidateManifestSha256,k.manifestSha256);assert.equal(prepared.djangoManifestSha256,k.djangoManifestSha256);
for(const key of ['piRunnerUpgrade','schemaRelease'])assert.ok(!Object.hasOwn(prepared,key),'准备回执含本工具不支持的组件：'+key);
assert.ok(!Object.hasOwn(prepared,'pandasBrokerRotation')||prepared.pandasBrokerRotation?.configured===false,'准备回执含Pandas轮换');
assert.equal(await exists(path.join(attempt,'SUCCESS.json')),false);assert.equal(await exists(path.join(attempt,'WorkerApply-result.json')),false);assert.equal(await exists(path.join(attempt,'WorkerApply-started.json')),true);assert.equal(await exists(path.join(attempt,'reconciliation')),false,'已存在续接目录');
// 2. Release scope really excludes Pi runner / Pandas / migrations.
const changes=request.releasePlan?.changes??[],paths=changes.flatMap(c=>[c.path,c.before]).filter(f=>typeof f==='string');
const nonTest=f=>!f.split('/').some(part=>part==='tests'||part.startsWith('test_'));
assert.ok(!paths.some(f=>f.startsWith('backend/pi_runner/')&&f.endsWith('.py')&&nonTest(f)),'含Pi runner改动');
assert.ok(!paths.some(f=>f.startsWith('backend/pandas_runner/')&&f.endsWith('.py')&&nonTest(f)),'含Pandas runner改动');
assert.ok(!paths.some(f=>f.startsWith('containers/pi-agent/')||f.startsWith('backend/pi_runner/bundled_skills/')),'含Pi镜像输入');
assert.ok(!paths.some(f=>/(^|\/)migrations\//.test(f)),'含Django迁移');
// 3. Plan, candidate, predecessor and chain identity.
const planFile=path.join(runtime,'state/worker-release-rotation-plans',k.planSha256+'.json'),plan=await read(planFile);assert.equal(await sha(planFile),k.planSha256);
assert.equal(plan.candidate.bindingSha256,k.bindingSha256);assert.equal(plan.candidate.releaseId,k.releaseId);assert.equal(plan.candidate.manifestSha256,k.manifestSha256);assert.equal(plan.predecessor.bindingSha256,k.predecessorBindingSha256);assert.equal(plan.predecessor.releaseId,k.predecessorReleaseId);assert.equal(plan.protectedEntrypoints.length,k.protectedEntrypointCount);assert.equal(plan.predecessorSequence,k.sequence-1);
const approvedBinding=JSON.parse(plan.sourceBinding.raw);assert.equal(createHash('sha256').update(plan.sourceBinding.raw).digest('hex'),plan.sourceBinding.sha256);assert.equal(path.resolve(approvedBinding.sourceRoot),source);
const gitFile=(await execute('C:/Windows/System32/where.exe',['git.exe'],{encoding:'utf8',windowsHide:true})).stdout.trim().split(/\r?\n/)[0],gitSha256=await sha(gitFile);
await verifyRecoverySourceClosure(source,approvedBinding.identity.sourceInventorySha256,gitFile,gitSha256);
const executablePins=[];
for(const tuple of [plan.candidate,plan.predecessor]){
 const releaseRoot=path.join(runtime,'releases',tuple.releaseId),manifestFile=path.join(releaseRoot,'deployment-manifest.json');assert.equal(await sha(manifestFile),tuple.manifestSha256);executablePins.push({path:manifestFile,sha256:tuple.manifestSha256});
 for(let dir=releaseRoot;;dir=path.dirname(dir)){const stat=await fs.lstat(dir);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());if(path.dirname(dir)===dir)break;}
 const manifest=await read(manifestFile);
 for(const item of manifest.artifacts.keyFiles){assert.ok(!item.relativePath.startsWith('../')&&!path.posix.isAbsolute(item.relativePath));const file=path.join(releaseRoot,...item.relativePath.split('/'));const info=await fs.lstat(file);assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1);assert.equal(await sha(file),item.sha256);executablePins.push({path:file,sha256:item.sha256});}
}
// 4. Reproduce the original build environment exactly.
const original=await import(pathToFileURL(path.join(source,'tools/publish-latest-main.mjs')));
const environment=original.publisherEnvironment(process.env,main.gitDirectory,main.publisherBaseEnvironment);
environment.PATH=main.pwshDirectory+';'+environment.PATH;environment.WRANGLER_HIDE_BANNER='true';environment.npm_config_cache=main.npmCacheDirectory;environment.npm_config_offline='true';environment.npm_config_prefer_online='false';environment.npm_config_prefer_offline='true';
const binding=await read(path.join(attempt,'preparation/source-binding.json'));assert.equal(environmentHash(environment),binding.identity.environmentSha256,'原构建环境已无法精确重建');assert.equal(await sha(process.execPath),binding.identity.nodeExecutableSha256);
// 5. Live preflight (read-only), run under the exact recovery environment.
const env=canonicalRecoveryEnvironment(environment);
const probeResult=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-File',helper],{env,encoding:'utf8',windowsHide:true,timeout:60000});assert.equal(probeResult.status,0,probeResult.stderr);
const probe=JSON.parse(probeResult.stdout);assert.equal(probe.version,'manual-startup-preflight-09aa2f8d-v1');assert.equal(probe.shortcut.controlled,true);assert.equal(probe.administrator,false);assert.deepEqual(probe.publishers,[]);assert.equal(probe.originalProcessPresent,false);assert.deepEqual(probe.originalDescendants,[]);assert.deepEqual(probe.listeners,[]);assert.deepEqual(probe.shortcut.temporaryFiles,[]);assert.equal(probe.shortcutExclusive.opened,true,'启动项当前被占用：'+probe.shortcutExclusive.error);
assert.ok(probe.shortcut.arguments.includes(k.predecessorReleaseId),'启动项并非指向前驱release');
// 6. Pins.
const files=[path.resolve(source,'..','main-release-request.json'),planFile,planFile+'.sha256',probe.expectedPowerShell,process.execPath];
for(const name of await fs.readdir(attempt)){const file=path.join(attempt,name);if((await fs.lstat(file)).isFile())files.push(file);}
for(const name of ['PREPARED.json','source-binding.json'])files.push(path.join(attempt,'preparation',name));
for(const name of ['worker-local-release.mjs','worker-local-release-rotation.mjs','release-batch.mjs'])files.push(path.join(source,'tools',name));
const pins=[...executablePins];for(const file of [...new Set(files)])pins.push({path:file,sha256:await sha(file)});
const entrypointHashes={};for(const item of plan.protectedEntrypoints){const file=path.join('D:/运营管理系统',...item.relativePath.split('/'));entrypointHashes[item.relativePath]=await sha(file);assert.equal(entrypointHashes[item.relativePath],item.candidateSha256);}
const l=await fs.lstat(probe.shortcut.path,{bigint:true});assert.ok(l.isFile()&&!l.isSymbolicLink()&&l.nlink===1n);
const successor=path.join(runtime,'state/worker-release-successors',k.predecessorBindingSha256+'.json');pins.push({path:successor,sha256:await sha(successor)},{path:successor+'.sha256',sha256:await sha(successor+'.sha256')});
assert.equal((await fs.readFile(successor+'.sha256','utf8')).trim(),await sha(successor));
const consumption=path.join(runtime,'state/worker-release-rotation-consumptions',k.planSha256+'.json');assert.equal(await exists(consumption),false);assert.equal(await exists(consumption+'.sha256'),false);
assert.equal(await sha(path.join(django,'app/deployment.json')),k.djangoManifestSha256);
const git=args=>execute('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});
const config={
 version:'manual-startup-recovery-09aa2f8d-v1',mainCommit:k.mainCommit,driverSha256,
 preflightFile:path.join(target,'manual-startup-preflight-09aa2f8d.ps1'),preflightSha256:helperSha256,
 environment,originalEnvironmentSha256:environmentHash(environment),executionEnvironmentSha256:environmentHash(env),
 sid:probe.sid,shortcut:probe.shortcut,shortcutIdentity:{dev:String(l.dev),ino:String(l.ino),size:String(l.size),mtimeNs:String(l.mtimeNs)},shortcutSha256:await sha(probe.shortcut.path),
 candidate:plan.candidate,successorSha256:await sha(successor),entrypointHashes,sourceTree:started.sourceTree,djangoPreparedId:prepared.djangoPackage.id,
 originalFailureSha256:k.originalFailureSha256,sourceInventorySha256:approvedBinding.identity.sourceInventorySha256,gitFile,gitSha256,
 pins,preparedByCommit:(await git(['rev-parse','HEAD'])).stdout.trim()
};
if(process.argv.includes('--check-only')){console.log(JSON.stringify({status:'recovery-configuration-checked',mainCommit:k.mainCommit,pinCount:pins.length,driverSha256,kitName,productionExecuted:false}));process.exit(0);}
assert.equal((await git(['status','--porcelain'])).stdout.trim(),'','请先提交并审查恢复工具，再安装执行入口');
await fs.mkdir(target,{recursive:false});
const driverCopy=path.join(target,'manual-startup-reconcile-09aa2f8d.mjs');
await fs.copyFile(driverFile,driverCopy,fs.constants.COPYFILE_EXCL);await fs.copyFile(helper,config.preflightFile,fs.constants.COPYFILE_EXCL);
const configRaw=JSON.stringify(config,null,2)+'\n',configSha256=createHash('sha256').update(configRaw).digest('hex');await fs.writeFile(path.join(target,'recovery-config.json'),configRaw,{flag:'wx'});
const command=mode=>'"'+process.execPath+'" "'+driverCopy+'" --config "'+path.join(target,'recovery-config.json')+'" --config-sha256 '+configSha256+' '+mode;
console.log('已生成恢复工具目录：'+target+'（本次未执行apply、退出维护或启动）。');
console.log('只读检查：'+command('--check'));
console.log('执行恢复：'+command('--execute'));
