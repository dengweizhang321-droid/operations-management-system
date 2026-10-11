import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import test from 'node:test';
import {prepareStatusDriver} from '../tools/prepare-watchdog-status-driver.mjs';
test('readonly status driver pins its exact predecessor and refuses lifecycle actions',{skip:process.platform!=='win32'},async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'watchdog-driver-'));
 try{
  const tools=path.join(directory,'tools'),runtime=path.join(directory,'runtime'),backendTools=path.join(runtime,'app','tools'),out=path.join(directory,'driver');
  await mkdir(tools,{recursive:true});await mkdir(backendTools,{recursive:true});
  const controlFile=path.join(tools,'operations-system-control.ps1'),workerFile=path.join(tools,'worker-local-service.ps1'),backendFile=path.join(backendTools,'django-local-service.ps1'),transportFile=path.join(tools,'process-deadline.ps1');
  await writeFile(controlFile,execFileSync('git',['show','7f05da96c6cad16d7d6c43da1f21deed117101b2:tools/operations-system-control.ps1']));
  await writeFile(workerFile,'fixture worker, never executed');await writeFile(backendFile,'fixture backend, never executed');await writeFile(transportFile,'fixture transport, never executed');
  const binding=await prepareStatusDriver({outputDirectory:out,controlFile,workerFile,backendFile,transportFile,coreTemplateFile:path.resolve('tools/django-local-service.ps1'),controlTemplateFile:path.resolve('tools/operations-system-control.ps1')});
  assert.deepEqual(Object.keys(binding.assetHashes),['control','backend','worker','transport']);
  const controller=await readFile(path.join(out,'watchdog-status-control.ps1'),'utf8'),backend=await readFile(path.join(out,'watchdog-status-backend.ps1'),'utf8');
  assert.match(controller,/ValidateSet\("Status"\)/);assert.ok(controller.includes('CoreDiagnostics = Get-CoreReadinessDiagnostic'));assert.ok(controller.includes('statusTimings ='));
  assert.match(backend,/ValidateSet\('Status','AggregateStatus'\)/);assert.ok(backend.includes("TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1'"));assert.ok(!backend.includes('Start-ScheduledTask'));
  for(const file of ['watchdog-status-control.ps1','watchdog-status-backend.ps1']){
   const r=spawnSync('pwsh.exe',['-NoProfile','-File',path.join(out,file),'-Action','Start'],{windowsHide:true,encoding:'utf8',timeout:10000});assert.notEqual(r.status,0);assert.match(r.stderr,/ValidateSet|validation|验证/i);
  }
  for(const flag of ['-StopWorker','-Open']){const r=spawnSync('pwsh.exe',['-NoProfile','-File',path.join(out,'watchdog-status-control.ps1'),flag],{windowsHide:true,encoding:'utf8',timeout:10000});assert.notEqual(r.status,0);assert.match(r.stderr,/readonly_status_only/);}
 }finally{assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('watchdog-driver-'));await rm(directory,{recursive:true,force:true})}
});
