import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFile,execFileSync} from 'node:child_process';import {promisify} from 'node:util';
const run=promisify(execFile),quote=s=>`'${s.replaceAll("'","''")}'`;
const shells=process.platform==='win32'?[path.join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),execFileSync('C:/Windows/System32/where.exe',['pwsh.exe'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0]]:[];
test('real isolated PS5/PS7 lifecycle waits preserve deadline and start fences',{skip:process.platform!=='win32',concurrency:2,timeout:120000},async t=>{
 await Promise.all(shells.map(shell=>t.test(path.basename(path.dirname(shell)),async()=>{
  for(const mode of ['extended','deadline','fence','maintenance','abandoned']){
   const root=await fs.mkdtemp(path.join(os.tmpdir(),'teruisi-release-mutex-'));
   try{
    const fields={Source:path.resolve('tools/django-local-service.ps1'),DeadlineSource:path.resolve('tools/process-deadline.ps1'),Root:root,Shell:shell,Mode:mode};
    const code=`$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';& ${quote(path.resolve('tests/django-release-mutex.fixture.ps1'))} `+Object.entries(fields).map(([k,v])=>`-${k} ${quote(v)}`).join(' ');
    const result=await run(shell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,timeout:55000,env:{...process.env,TERUISI_PROCESS_DEADLINE_UNIX_MS:''},maxBuffer:1024*1024});
    const proof=JSON.parse(result.stdout.trim());assert.equal(proof.mode,mode);assert.equal(proof.passed,true);
   }finally{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});}
  }
 })));
});
