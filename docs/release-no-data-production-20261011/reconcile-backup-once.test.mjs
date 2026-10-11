import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {fixed,validateBackupRecovery,reconciliationEvent,digest,validLinkCount,assertKernelAbsence} from './reconcile-backup-once.mjs';
const source=JSON.parse(await readFile('E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/BACKUP_RECONCILIATION_TEST_INPUT.json'));
test('only exact PowerShell identity has exactly two links; all others single-link',()=>{
 assert.equal(validLinkCount(fixed.ps,fixed.psSha,2n,true),true);
 for(const n of [1n,3n,283n])assert.equal(validLinkCount(fixed.ps,fixed.psSha,n,true),false);
 assert.equal(validLinkCount('C:\\other.exe',fixed.psSha,2n,true),false);assert.equal(validLinkCount(fixed.ps,'0'.repeat(64),2n,true),false);
 assert.equal(validLinkCount('C:\\ordinary',undefined,1n,false),true);assert.equal(validLinkCount('C:\\ordinary',undefined,2n,false),false);
});
test('both exact PIDs require CIM absence and OpenProcess error87; alive/denied/other/omitted reject',()=>{
 const records=[14972,36576].map(pid=>({pid,cimAbsent:true,openSucceeded:false,error:87}));assert.deepEqual(assertKernelAbsence(records),[14972,36576]);
 for(const delta of [{cimAbsent:false},{openSucceeded:true},{error:5},{error:0},{pid:999}]){const v=structuredClone(records);Object.assign(v[0],delta);assert.throws(()=>assertKernelAbsence(v));}
 assert.throws(()=>assertKernelAbsence(records.slice(1)));
});
test('native source requests only0x1000 and closes any successful handle before rejecting',async()=>{
 const raw=await readFile(new URL('./reconcile-backup-once.mjs',import.meta.url),'utf8');assert.ok(raw.includes('OpenProcess(0x1000,$false,[uint32]$targetPid)'));assert.ok(raw.includes("try{throw 'Kernel process still exists'}finally{[void][ReconcilePidAbsence]::CloseHandle($handle)}"));assert.ok(raw.includes('if($nativeError -ne 87)'));assert.ok(!raw.includes('SeDebugPrivilege'));
});
function fixture(){const v=structuredClone(source),latest=new Map();for(const e of v.events)if(e.operationId)latest.set(e.operationId,e);return {...v,state:{events:v.events,previous:fixed.head,latest,unknown:[latest.get('backup-pre')]},active:{batchSha256:fixed.batch,id:'first-adoption-live-guard-20261011'},maintenance:null,drain:null,processesAbsent:[14972,36576],verifyRaw:Buffer.from(v.verifyRaw),verify:JSON.parse(v.verifyRaw),op:{id:'backup-pre',kind:'backup',phase:'backup-pre',assertions:[{path:'status',equals:'completed'},{path:'serviceStateChanged',equals:false}]}};}
test('exact captured Backup stdout plus independent Verify yields only five original outputs',()=>{
 const f=fixture(),o=validateBackupRecovery(f);assert.equal(Object.keys(o).length,5);assert.equal(o.maintenanceId,undefined);assert.equal(o.backupId,fixed.backupId);assert.equal(o.contentSha256,fixed.contentSha);
 assert.equal(digest(Buffer.from(JSON.stringify(f.audit.result)+'\r\n')),fixed.stdoutSha);
});
for(const [name,change]of [
 ['changed WAL head',f=>f.state.previous='0'.repeat(64)],
 ['extra WAL event / repeated invocation',f=>f.state.events.push({})],
 ['wrong owner',f=>f.active.batchSha256='0'.repeat(64)],
 ['maintenance present',f=>f.maintenance={}],['drain present',f=>f.drain={}],
 ['old Node still alive',f=>f.processesAbsent=[36576]],['backup process still alive',f=>f.processesAbsent=[14972]],
 ['unconfirmed process exit',f=>f.finished.exitCode=null],
 ['unrelated stdout',f=>f.state.unknown[0].processEvidence.stdoutSha256='0'.repeat(64)],
 ['audit receipt edited',f=>f.audit.result.backupId='another'],
 ['retention incomplete',f=>f.audit.result.retention.status='failed'],
 ['release cleanup disguised as passed',f=>f.audit.result.releaseRetention.status='completed'],
 ['wrong manifest backup',f=>f.manifest.backupId='another'],
 ['wrong dump',f=>f.manifest.dump.sha256='0'.repeat(64)],
 ['wrong content',f=>f.manifest.evidence.contentSha256='0'.repeat(64)],
 ['Verify wrong backup',f=>f.verify.backupId='another'],
 ['Verify claims state change',f=>f.verify.serviceStateChanged=true],
 ['Verify failed',f=>f.verifyExecution.exitCode=1],
 ['Verify old point args',f=>f.verifyExecution.argv[7]='E:\\other'],
 ['Verify stdout drift',f=>f.verifyRaw=Buffer.from('{}')],
 ['Verify predated failure',f=>f.verifyExecution.startedAt='2026-10-10T00:00:00Z'],
 ['missing backup outputs cannot be called confirmed',f=>f.state.unknown[0].status='passed'],
 ])test('reject '+name,()=>{const f=fixture();change(f);assert.throws(()=>validateBackupRecovery(f));});
test('maintenanceId cannot be fabricated into event',()=>assert.throws(()=>reconciliationEvent({...validateBackupRecovery(fixture()),maintenanceId:'fake'},{},new Date().toISOString())));
test('original writeOnce/journalState read the supplemental event and preserve unknown history; second append refuses',async()=>{
 const candidate='D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T090355Z-21c2645a63247749';
 const spec=JSON.parse(await readFile(fixed.spec));for(const f of spec.collector.files)assert.equal(digest(await readFile(f.path)),f.sha256);
 const api=await import(pathToFileURL(path.join(candidate,'tools/release-batch.mjs')));
 const root=await mkdtemp(path.join(os.tmpdir(),'teruisi-reconcile-unit-')),batch={id:'first-adoption-live-guard-20261011',batchSha256:fixed.batch};
 try{
  await mkdir(path.join(root,batch.id));for(let i=0;i<source.events.length;i++)await api.writeOnce(path.join(root,batch.id,String(i).padStart(6,'0')+'.json'),source.events[i]);
  const before=await api.journalState(root,batch);assert.equal(before.unknown.length,1);assert.equal(before.previous,fixed.head);
  const event=reconciliationEvent(validateBackupRecovery(fixture()),{fixture:true},new Date().toISOString());const target=path.join(root,batch.id,'000010.json');
  await api.writeOnce(target,event);const after=await api.journalState(root,batch);assert.equal(after.unknown.length,0);assert.equal(after.events[9].status,'unknown');assert.deepEqual(after.latest.get('backup-pre').outputs,event.outputs);
  assert.equal(after.previous,event.eventSha256);await assert.rejects(()=>api.writeOnce(target,event),{code:'EEXIST'});
 }finally{assert.ok(root.startsWith(path.join(os.tmpdir(),'teruisi-reconcile-unit-')));await rm(root,{recursive:true});}
});
