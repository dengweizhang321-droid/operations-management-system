/** Install the local Git preparation trigger and stable manual entry helpers. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {publisherEnvironment} from './publish-latest-main.mjs';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const configFile=process.argv[process.argv.indexOf('--config')+1];
assert.ok(process.argv.includes('--config')&&path.isAbsolute(configFile),'需要绝对配置路径 --config');
const config=JSON.parse(await fs.readFile(configFile,'utf8'));
const git=args=>execFileSync('git',['-C',config.repository,...args],{encoding:'utf8',windowsHide:true}).trim();
const gitExecutable=execFileSync('C:/Windows/System32/where.exe',['git.exe'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0];
assert.ok(path.isAbsolute(gitExecutable)&&(await fs.stat(gitExecutable)).isFile(),'无法定位本机Git');
config.gitDirectory=path.dirname(gitExecutable);
// Preserve the original bounded base on upgrades, not the installer's shell.
config.publisherBaseEnvironment=publisherEnvironment(process.env,config.gitDirectory,config.publisherBaseEnvironment);
execFileSync(gitExecutable,['--version'],{env:undefined,windowsHide:true});
let hooksPath='';try{hooksPath=git(['config','--get','core.hooksPath']);}catch(error){if(error.status!==1)throw error;}
assert.equal(hooksPath,'','已有自定义hooksPath，请先合并钩子，不能覆盖');
const common=git(['rev-parse','--path-format=absolute','--git-common-dir']),hook=path.join(common,'hooks','reference-transaction');
const target=path.join(config.stateDirectory,'control','tools');await fs.mkdir(target,{recursive:true});
const names=['publish-latest-main.mjs','publish-main-progress.mjs','release-scope-plan.mjs','main-prebuild-hook.mjs','main-schema-release.mjs'];
const hashes={};
for(const name of names){const bytes=await fs.readFile(path.join(source,'tools',name));await fs.writeFile(path.join(target,name),bytes);hashes[name]=createHash('sha256').update(bytes).digest('hex');}
const quote=value=>"'"+value.replaceAll('\\','/').replaceAll("'","'\\''")+"'";
const hookText='#!/bin/sh\n# TERUISI main-prebuild v1: prepare only, never deploy.\n'+quote(process.execPath)+' '+quote(path.join(target,'main-prebuild-hook.mjs'))+' event '+quote(path.resolve(configFile))+' "$1"\n';
let old;try{old=await fs.readFile(hook,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
assert.ok(!old||old.includes('# TERUISI main-prebuild v1:'),'已有reference-transaction钩子，不能覆盖');
await fs.writeFile(hook,hookText,{mode:0o755});
await fs.writeFile(configFile,JSON.stringify(config,null,2)+'\n');
const bat='@echo off\r\nsetlocal\r\nchcp 65001 >nul\r\n"'+process.execPath+'" "%~dp0control\\tools\\publish-latest-main.mjs" --config "%~dp0main-publisher-config.json" --prepare-only %*\r\nset "release_exit=%errorlevel%"\r\necho.\r\nif /i not "%~1"=="--no-pause" pause\r\nexit /b %release_exit%\r\n';
await fs.writeFile(path.join(config.stateDirectory,'准备main.bat'),bat);
const commit=execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
await fs.writeFile(path.join(config.stateDirectory,'CONTROL-TOOLS.json'),JSON.stringify({version:'teruisi-main-prebuild-control-v1',commit,hashes,hook,preparationOnly:true},null,2)+'\n');
console.log('已安装main更新自动打包。发布main.bat仅发布准备好的包；准备main.bat可手动打包。本次没有部署。');
