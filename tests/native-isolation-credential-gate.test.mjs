import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const guardedApplication='b7280770fa5ff81e3939d6516f021c9f50b496a3';
export const removed="'Configure','ConfigureCredentials','ProvisionRoles'";
export const replacement="'Configure','ProvisionRoles'";

test('credential rejection changes exactly one unused action in the proven helper bytes',async()=>{
 const before=execFileSync('git',['show',guardedApplication+':tools/native-isolation.ps1'],{cwd:repository,windowsHide:true}).toString('utf8');
 const after=await fs.readFile(path.join(repository,'tools/native-isolation.ps1'));
 assert.equal(before.split(removed).length,2);
 assert.deepEqual(after,Buffer.from(before.replace(removed,replacement)));
});

test('real PS5 and PS7 AI credential entry rejects at the private action gate before production reads',async t=>{
 if(process.platform!=='win32'){t.skip('Windows native entry');return;}
 const id='gate-'+randomBytes(6).toString('hex');
 const root=path.win32.join('D:\\codex-isolated','native-control-'+id);
 await fs.mkdir(root);
 const file=path.join(root,'isolation.json');
 t.after(async()=>{assert.equal(await fs.realpath(root),root);await fs.unlink(file);await fs.rmdir(root);});
 const profile={version:1,id,root,sourceRoot:'D:\\.codex\\worktrees\\2949\\运营管理系统',wslDistribution:'Codex-AI-Batch2-20261108'};
 const raw=Buffer.from(JSON.stringify(profile));await fs.writeFile(file,raw,{flag:'wx'});
 const environment={...process.env,TERUISI_NATIVE_ISOLATION_FILE:file,TERUISI_NATIVE_ISOLATION_SHA256:createHash('sha256').update(raw).digest('hex')};
 delete environment.PSModulePath;
 for(const shell of [process.env.TERUISI_NATIVE_PS5??'powershell.exe',process.env.TERUISI_NATIVE_PS7??'pwsh.exe']){
  const result=spawnSync(shell,['-NoProfile','-NonInteractive','-File',path.join(repository,'tools/django-ai.ps1'),'-Action','ConfigureCredentials','-RuntimeRoot',path.join(root,'django'),'-Json'],
   {cwd:repository,env:environment,windowsHide:true,timeout:30000});
  assert.equal(result.status,1);assert.match(result.stderr.toString('utf8'),/Action is outside the private native lifecycle scope/);
  const source="$ErrorActionPreference='Stop'; . ./tools/native-isolation.ps1; foreach($Action in @('Start','Stop')) { $mapped=Get-NativeRuntimeRoot 'django' '' $false; if($mapped -cne (Join-Path $NativeIsolation.root 'django') -or $NativePorts[3000] -ne 23000 -or $NativePorts[5432] -ne 25432) { throw 'positive mapping changed' } }; 'positive_mapping_verified'";
  assert.match(execFileSync(shell,['-NoProfile','-NonInteractive','-Command',source],{cwd:repository,env:environment,windowsHide:true,timeout:30000}).toString(),/positive_mapping_verified/);
  const defaultEnvironment={...environment};delete defaultEnvironment.TERUISI_NATIVE_ISOLATION_FILE;delete defaultEnvironment.TERUISI_NATIVE_ISOLATION_SHA256;
  const defaults="$ErrorActionPreference='Stop'; . ./tools/native-isolation.ps1; $Action='ConfigureCredentials'; if($NativeIsolation -or $NativePorts[5432] -ne 5432 -or (Get-NativeRuntimeRoot 'django' 'D:\\teruisi-runtime\\django-sales' $false) -cne 'D:\\teruisi-runtime\\django-sales') { throw 'production default changed' }; 'default_mapping_verified'";
  assert.match(execFileSync(shell,['-NoProfile','-NonInteractive','-Command',defaults],{cwd:repository,env:defaultEnvironment,windowsHide:true,timeout:30000}).toString(),/default_mapping_verified/);
 }
});
