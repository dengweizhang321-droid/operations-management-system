import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { scheduledBackup, readScheduledBackupStatus } from '../tools/release-daily-backup.mjs';
import { runProcess } from '../tools/worker-local-release.mjs';

const receipt={status:'completed',serviceStateChanged:false,retention:{status:'completed'},backupId:'fixture-point',manifestSha256:'1'.repeat(64)};
async function fixture(){const dir=await mkdtemp(path.join(tmpdir(),'teruisi-d-daily-'));const root=path.join(dir,'proof'),schedule=path.join(dir,'schedule.toml');await mkdir(root);await writeFile(schedule,'status = "ACTIVE"\n');return {dir,root,schedule,lock:action=>action({})};}

test('D: successful wrapper alone cannot prove the latest native scheduled run',async()=>{
  const f=await fixture();
  await scheduledBackup({...f,run:async()=>({stdout:JSON.stringify(receipt)})});
  const observed=await readScheduledBackupStatus(f);
  assert.equal(observed.schedule.wrapperLastResult,'success');
  assert.equal(observed.schedule.lastResult,'unknown');
  assert.equal(observed.schedule.latestAttemptCoverageVerified,false);
});
test('D: later lock failure remains durable and cannot expose the earlier success',async()=>{
  const f=await fixture();await scheduledBackup({...f,run:async()=>({stdout:JSON.stringify(receipt)})});
  await assert.rejects(scheduledBackup({...f,lock:async()=>{throw Error('synthetic lock busy');}}),/unresolved/);
  assert.equal((await readScheduledBackupStatus(f)).schedule.lastResult,'unknown');
  const names=(await readdir(f.root)).filter(name=>name!=='active.json').sort();
  assert.equal(JSON.parse(await readFile(path.join(f.root,names.at(-1),'result.json'))).status,'unknown');
});
test('D: a late failure marker blocks new backup work even if an old result says success',async()=>{
  const f=await fixture();const r=await scheduledBackup({...f,run:async()=>({stdout:JSON.stringify(receipt)})});
  await writeFile(path.join(f.root,r.id,'failure.json'),'{}');let calls=0;
  await assert.rejects(scheduledBackup({...f,run:async()=>{calls++;return {stdout:JSON.stringify(receipt)};}}),/unresolved/);
  assert.equal(calls,0);assert.equal((await readScheduledBackupStatus(f)).schedule.wrapperLastResult,'unknown');
});
test('D: original PS5 Unicode transport and child-only module environment are used',async()=>{
  const f=await fixture();const parent=process.env.PSModulePath;let observed;
  await scheduledBackup({...f,run:async(exe,args,options)=>{observed={exe,args,options};return {stdout:JSON.stringify(receipt)};}});
  assert.equal(observed.args[2],'-EncodedCommand');
  const script=Buffer.from(observed.args[3],'base64').toString('utf16le');
  const payload=/FromBase64String\('([^']+)'\)/.exec(script)[1];
  const request=JSON.parse(Buffer.from(payload,'base64'));
  assert.equal(request.file,'D:\\teruisi-runtime\\django-sales\\app\\tools\\django-postgres-maintenance.ps1');
  assert.equal(request.parameters.Execute,true);
  assert.equal(observed.options.env.PSModulePath,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
  assert.equal(process.env.PSModulePath,parent);
});
test('D: real direct child exits while service-like descendant holds both streams',async()=>{
  const f=await fixture();let childPid;
  const script=path.join(f.dir,'child.mjs');
  await writeFile(script,`import {spawn} from 'node:child_process'; const p=spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{stdio:['ignore',1,2],detached:true,windowsHide:true}); console.log(JSON.stringify({...${JSON.stringify(receipt)},grandchildPid:p.pid})); p.unref();`);
  try{
    const result=await scheduledBackup({...f,timeoutMs:5000,run:async(_exe,_args,options)=>{const value=await runProcess(process.execPath,[script],options);childPid=JSON.parse(value.stdout).grandchildPid;return value;}});
    assert.equal(result.status,'success');assert.equal(result.processEvidence.exitCode,0);
    assert.equal(result.processEvidence.outputProtocol,'direct-exit-files');assert.equal(result.processEvidence.cleanup,'preserve');
    assert.doesNotThrow(()=>process.kill(childPid,0));
  } finally {if(childPid)try{process.kill(childPid);}catch(error){if(error.code!=='ESRCH')throw error;}}
});
