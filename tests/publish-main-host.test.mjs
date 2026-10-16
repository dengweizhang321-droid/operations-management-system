import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'publish-main-host-'));
const source=path.join(root,'source');await fs.mkdir(path.join(source,'tools'),{recursive:true});
const script=path.join(source,'tools/publish-main.mjs');
await fs.copyFile(fileURLToPath(new URL('../tools/publish-main.mjs',import.meta.url)),script);
await fs.copyFile(fileURLToPath(new URL('../tools/publish-main-progress.mjs',import.meta.url)),path.join(source,'tools/publish-main-progress.mjs'));
await fs.copyFile(fileURLToPath(new URL('../tools/publish-main-known-resume.mjs',import.meta.url)),path.join(source,'tools/publish-main-known-resume.mjs'));
for(const name of ['publish-main-completed.mjs','publish-main-command.mjs'])await fs.copyFile(fileURLToPath(new URL('../tools/'+name,import.meta.url)),path.join(source,'tools',name));
execFileSync('git',['init','--quiet'],{cwd:source});execFileSync('git',['add','tools'],{cwd:source});
execFileSync('git',['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','fixture'],{cwd:source});
const mainCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
const directory='D:/codex-isolated/main-manual-release-20261016/control-host';
const digest=createHash('sha256').update(await fs.readFile(path.join(directory,'pwsh.exe'))).digest('hex');
const cache=path.join(root,'npm-cache');await fs.mkdir(path.join(cache,'_cacache','content-v2'),{recursive:true});
async function check(values){
 await fs.writeFile(path.join(root,'main-release-request.json'),JSON.stringify({mainCommit,pwshDirectory:directory,pwshSha256:digest,npmCacheDirectory:cache,...values}));
 return spawnSync(process.execPath,[script,'--check'],{cwd:os.tmpdir(),encoding:'utf8',timeout:30000,windowsHide:true});
}
test('check refuses a missing PowerShell before any release starts',async()=>{
 const result=await check({pwshDirectory:path.join(root,'missing')});assert.equal(result.status,1);assert.match(result.stderr,/PowerShell文件不存在/);
});
test('check keeps the executable hash requirement',async()=>{
 const result=await check({pwshSha256:'0'.repeat(64)});assert.equal(result.status,1);assert.match(result.stderr,/运行环境已变化/);
});
test('check starts the packaged engine and remains read-only',async()=>{
 const result=await check({});assert.equal(result.status,0,result.stderr);const data=JSON.parse(result.stdout);assert.equal(data.powerShellHostVerified,true);assert.equal(data.powerShellVersion,'7.6.5');assert.equal(data.productionExecuted,false);
 await assert.rejects(fs.access(path.join(root,'publish-'+mainCommit.slice(0,12))),{code:'ENOENT'});
});
test('check refuses an absent offline cache without starting a release',async()=>{
 const result=await check({npmCacheDirectory:path.join(root,'absent-cache')});assert.equal(result.status,1);assert.doesNotMatch(result.stdout,/productionExecuted.*true/);
 await assert.rejects(fs.access(path.join(root,'publish-'+mainCommit.slice(0,12))),{code:'ENOENT'});
});
test('normal entry logs a preflight failure without reporting success or starting a release',async()=>{
 await check({mainCommit:'invalid-fixture-head'});
 const result=spawnSync(process.execPath,[script],{cwd:os.tmpdir(),encoding:'utf8',timeout:30000,windowsHide:true});
 assert.equal(result.status,1);assert.match(result.stdout,/失败步骤：准备发布/);assert.doesNotMatch(result.stdout,/发布成功/);
 const logs=await fs.readdir(path.join(root,'logs'));assert.equal(logs.length,1);
 assert.match(await fs.readFile(path.join(root,'logs',logs[0]),'utf8'),/main来源版本已变化/);
 await assert.rejects(fs.access(path.join(root,'publish-'+mainCommit.slice(0,12))),{code:'ENOENT'});
});
