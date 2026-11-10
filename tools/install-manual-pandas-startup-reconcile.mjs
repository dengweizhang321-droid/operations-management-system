/**
 * Prepare the one-batch manual Pandas-startup recovery kit: copy
 * tools/manual-pandas-startup-reconcile.mjs into the recovery state
 * directory and write two BAT entry points (check / execute), mirroring the
 * existing tools/install-manual-startup-reconcile.mjs precedent. This script
 * itself never starts, stops, or writes to production; it only verifies the
 * driver module is internally consistent with the one known binding and
 * copies files under D:/codex-isolated/main-manual-release-20261016/.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {knownPandasStartup as k,frozenSourceRoot,assertFrozenSourceIdentity,extractedFunctionNames} from './manual-pandas-startup-reconcile.mjs';

const execute=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const state='D:/codex-isolated/main-manual-release-20261016';
const sha=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const git=args=>execute('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,timeout:15000});

// 1. The driver must be committed (reviewable) before it is installed as an entry point.
assert.equal((await git(['status','--porcelain','--','tools/manual-pandas-startup-reconcile.mjs'])).stdout.trim(),'','请先提交 manual-pandas-startup-reconcile.mjs，再安装执行入口');

// 2. The frozen source this release actually built from is still exactly c7604df9, clean.
await assertFrozenSourceIdentity(frozenSourceRoot);

// 3. The installed Pandas-domain controller and its deployment manifest are still the exact
//    bytes this one-off binding recognizes -- same identity check the driver performs at
//    runtime, repeated here so a stale installation is caught before any BAT is written.
const installedToolsRoot='D:/teruisi-runtime/django-sales/app/tools';
assert.equal(await sha(path.join(installedToolsRoot,'django-ai.ps1')),k.djangoAiScriptSha256,'已安装 django-ai.ps1 字节已变化，拒绝安装本次一次性恢复入口');
assert.equal(await sha('D:/teruisi-runtime/django-sales/app/deployment.json'),k.deploymentManifestSha256,'已安装 deployment.json 字节已变化，拒绝安装本次一次性恢复入口');

// 4. The installed django-ai.ps1 must still contain exactly the functions this driver extracts,
//    by name -- a renamed or removed function must block installation, not surface later as a
//    runtime failure after the BAT has already been handed to the user.
const probe=['$tokens=$null;$e=$null',
 "$ast=[System.Management.Automation.Language.Parser]::ParseFile('"+path.join(installedToolsRoot,'django-ai.ps1').replaceAll('\\','/')+"',[ref]$tokens,[ref]$e)",
 'if($e.Count){throw "parse failed"}',
 '$names=@('+extractedFunctionNames.map(n=>"'"+n+"'").join(',')+')',
 '$found=@($ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -cin $names},$false)).Name',
 'Write-Output (($found | Sort-Object) -join ",")'].join("\n");
const probeResult=await execute('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
 ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(probe,'utf16le').toString('base64')],
 {encoding:'utf8',windowsHide:true,timeout:30000});
assert.equal(probeResult.stdout.trim(),[...extractedFunctionNames].sort().join(','),'已安装 django-ai.ps1 的函数清单与本次驱动的提取清单不符');

const driverSha256=await sha(path.join(root,'tools/manual-pandas-startup-reconcile.mjs'));
const kitHash=createHash('sha256').update(driverSha256).digest('hex');
const kitName='recovery-c7604df99c55-pandas-startup-'+kitHash.slice(0,12);
const target=path.join(state,kitName);

if(process.argv.includes('--check-only')){
  console.log(JSON.stringify({status:'recovery-kit-checked',mainCommit:k.mainCommit,planSha256:k.planSha256,driverSha256,productionExecuted:false}));
  process.exit(0);
}

await fs.mkdir(target,{recursive:false});
await fs.copyFile(path.join(root,'tools/manual-pandas-startup-reconcile.mjs'),path.join(target,'manual-pandas-startup-reconcile.mjs'));

for(const [name,mode] of [['检查Pandas首启补完.bat','--check'],['执行Pandas首启补完.bat','--execute']]){
  const evidenceDirectory=path.join(target,'evidence');
  const bat='@echo off\r\nrem TERUISI c7604df9 Pandas startup recovery entry (one-off)\r\nsetlocal\r\nchcp 65001 >nul\r\n"'+process.execPath+'" "%~dp0'+kitName+'\\manual-pandas-startup-reconcile.mjs" '+mode+' --evidence-directory "'+evidenceDirectory.replaceAll('\\','\\\\')+'" %*\r\nset "recovery_exit=%errorlevel%"\r\necho.\r\nif /i not "%~1"=="--no-pause" pause\r\nexit /b %recovery_exit%\r\n';
  try{
    const old=await fs.readFile(path.join(state,name),'utf8');
    assert.ok(old.includes('rem TERUISI c7604df9 Pandas startup recovery entry'),'已有不属于本恢复的同名入口，拒绝覆盖');
  }catch(e){if(e.code!=='ENOENT')throw e;}
  await fs.writeFile(path.join(state,name),bat);
}

console.log('已生成本次Pandas首启补完的检查/执行BAT；本次安装未执行任何production动作。');
console.log(JSON.stringify({status:'recovery-kit-installed',kitDirectory:target,driverSha256,mainCommit:k.mainCommit,planSha256:k.planSha256,productionExecuted:false}));
