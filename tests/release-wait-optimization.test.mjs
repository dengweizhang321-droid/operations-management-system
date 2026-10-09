import assert from 'node:assert/strict';
import test from 'node:test';
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { hash, canonical, safeFileDigest, sourceInventory, sourceTreeDigest, classifyImpact, backupReuseDecision, requirements, backupMaxAgeMs, rehearsalMaxAgeMs } from '../tools/release-impact.mjs';
import { makeBatch, executeBatch, reconcileOperation, journalState, timingReport, verifyBatch } from '../tools/release-batch.mjs';
import { assertActiveBatchOwnership, withRotationLock } from '../tools/worker-local-release-rotation.mjs';
import { scheduledBackup } from '../tools/release-daily-backup.mjs';

const now = Date.now();
const h = c => c.repeat(64);
const base = { 'app/view.tsx': '"use client"; export default function V(){ return <div className="p-2">Title</div>; }', 'lib/read.ts': 'export const GET_ONLY = 1;' };
const display = { ...base, 'app/view.tsx': base['app/view.tsx'].replace('p-2','p-4').replace('Title','Caption') };
const effects = { data:false, permissions:false, writes:false, imports:false, automation:false, lifecycle:false, backup:false, dependencyBehavior:false };
function witness(before,after,kind='display') {
  const info = classifyImpact({ before, after });
  return { deltaSha256:info.deltaSha256, closureSha256:info.closureSha256, kind, independent:true, status:'passed', reviewer:'non-author', effects };
}
const classify = (before, after, kind='display') => classifyImpact({ before, after, witness:witness(before,after,kind) });
function recovery() {
  const fields = { manifestSha256:h('1'), dumpSha256:h('2'), environmentSha256:h('3'), schemaSha256:h('4'), rolesSha256:h('5'), operatorSha256:h('6'), retentionSha256:h('7'), scheduleSha256:h('8'), backupId:'daily-point-1' };
  return { evidence: { ...fields, version:'teruisi-release-recovery-evidence-v1', backupCompletedAt:new Date(now-1000).toISOString(), restoredAt:new Date(now-2000).toISOString(), restoreStatus:'passed',cleanupStatus:'passed',contentEqual:true,rolesEqual:true,permissionsEqual:true,migrationsEqual:true,sequencesValid:true },
    current:{ ...fields, pointExists:true, verifyStatus:'passed',retained:true,sequencesValid:true,softwareCompatible:true,schedule:{ active:true,lastResult:'success',lastSuccessAt:new Date(now-1000).toISOString() } } };
}
function batch(mode='full', id='test-release-0001') {
  const impact = classify(base,display);
  const {evidence,current} = recovery();
  if (mode === 'full') current.schedule.active = false;
  const tests = { status:'passed',sourceSha256:sourceTreeDigest(display),artifactSha256:h('b'),checks:requirements.display.tests };
  const binding = { sourceSha256:sourceTreeDigest(display),predecessorSourceSha256:sourceTreeDigest(base),sourceInventorySha256:hash(sourceInventory(display)),predecessorInventorySha256:hash(sourceInventory(base)),dependencySha256:h('c'),configurationSha256:h('d'),toolchainSha256:h('e'),artifactSha256:h('b'),testsSha256:hash(tests),predecessorSha256:h('f'),workerPlanSha256:h('1'),maintenanceId:'a'.repeat(32),djangoCandidateSha256:h('3'),djangoPredecessorSha256:h('3') };
  const names = ['prepare',...(mode==='full'?['backup-pre','restore-pre']:[]),'drain','switch','acceptance',...(mode==='full'?['backup-post','restore-post']:[]),'closeout'];
  const life=(step,phase,id)=>({id,phase,kind:'lifecycle',step,mutating:true,command:{args:['-File','D:/isolated/tools/release-lifecycle-step.ps1','-Step',step,'-MaintenanceId','a'.repeat(32),...(step==='StartWorker'?['-ExpectedWorkerManifestSha256',binding.artifactSha256,'-ExpectedDjangoManifestSha256',binding.djangoCandidateSha256,'-ExpectedDrainId',binding.maintenanceId]:[])],files:[{path:'D:/isolated/tools/release-lifecycle-step.ps1',sha256:h('a')},{path:'D:/isolated/tools/process-deadline.ps1',sha256:h('2')}]},assertions:[{path:'drainConfirmed',equals:true}]});
  return makeBatch({ id,binding,before:base,after:display,witness:witness(base,display),evidence,current,tests,acceptance:requirements[impact.level].acceptance,
    rollback:{application:'exact predecessor',compatibility:'same schema',failureState:'maintenance retained'},operations:names.flatMap(phase=>phase==='drain'?life('BeginWorkerDrain','drain','op-drain'):phase==='switch'?[life('StopWorker','switch','op-stop'),{id:'op-switch',phase,kind:'worker-apply',mutating:true,planSha256:h('1')},life('StartWorker','switch','op-start'),life('EndWorkerDrain','switch','op-end-drain')]:phase.startsWith('backup')||phase.startsWith('restore')?{
      id:`op-${phase}`,phase,mutating:true,kind:phase.startsWith('backup')?'backup':'restore',
      ...(phase.startsWith('restore')?{backupOperationId:`op-backup-${phase.endsWith('pre')?'pre':'post'}`}:{ }),
      command:{args:['-File','D:/isolated/tools/django-postgres-maintenance.ps1','-Action',phase.startsWith('backup')?'Backup':'RestoreRehearsal','-Execute','-ConfirmedIsolatedRestore',...(phase.startsWith('restore')?['-BackupDirectory',`{receipt:op-backup-${phase.endsWith('pre')?'pre':'post'}:backupDirectory}`,'-ApprovedManifestSha256',`{receipt:op-backup-${phase.endsWith('pre')?'pre':'post'}:manifestSha256}`]:[])],files:[{path:'D:/isolated/tools/django-postgres-maintenance.ps1',sha256:h('a')}]},
      assertions:[{path:'status',equals:'completed'},{path:'serviceStateChanged',equals:false},...(phase.startsWith('restore')?[{path:'productionDatabaseTouched',equals:false},{path:'cleanupStatus',equals:'isolated_data_removed'},{path:'profileRestoreVerified',equals:true},{path:'sequenceHealthVerified',equals:true}]:[])],
    }:{id:`op-${phase}`,phase,mutating:phase==='switch',covers:phase==='acceptance'?requirements.display.acceptance:[]}),now });
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(),'teruisi-release-wait-'));
  return {root,dispose:()=>rm(root,{recursive:true,force:true})};
}
const fakeLock = async f => f({});
const collect = b => async()=>({binding:b.binding,recovery:b.recoveryCurrent});
const pass = async()=>({status:'passed',receiptSha256:h('0')});

test('Start candidate/drain/dependency bindings reject at sealing before any operation',()=>{
  for(const fault of ['worker','django','owner','duplicate-drain','transport']) {
    const b=batch(), op=b.operations.find(o=>o.step==='StartWorker');
    if(fault==='worker')op.command.args[op.command.args.indexOf('-ExpectedWorkerManifestSha256')+1]=h('9');
    if(fault==='django')op.command.args[op.command.args.indexOf('-ExpectedDjangoManifestSha256')+1]=h('9');
    if(fault==='owner')op.command.args[op.command.args.indexOf('-MaintenanceId')+1]='9'.repeat(32);
    if(fault==='duplicate-drain')op.command.args.push('-expecteddrainid',b.binding.maintenanceId);
    if(fault==='transport')op.command.files=op.command.files.filter(f=>!f.path.endsWith('process-deadline.ps1'));
    const core={...b};delete core.batchSha256;b.batchSha256=hash(core);
    assert.throws(()=>verifyBatch(b,b.batchSha256),/Start|transport/);
  }
});

test('unknown operation retains exit/deadline metadata and cannot replay',async()=>{
  const f=await fixture(),b=batch();let calls=0;
  try {
    const run=async op=>{
      calls++;
      if(op.kind==='worker-apply') {const e=new Error('private-body-not-for-journal');e.processEvidence={code:'process_timeout',stage:'direct-exit',exitCode:9,timeoutType:'direct-exit',stdoutBytes:12,stderrBytes:7};throw e;}
      return pass();
    };
    await assert.rejects(executeBatch({batch:b,approved:b.batchSha256,root:f.root,lock:fakeLock,collectCurrent:collect(b),run}),/unknown/);
    const state=await journalState(f.root,b),record=state.latest.get('op-switch');
    assert.equal(record.processEvidence.exitCode,9);assert.equal(record.processEvidence.timeoutType,'direct-exit');assert.equal(record.reason,'process_timeout');
    assert.doesNotMatch(JSON.stringify(record),/private-body/);
    const before=calls;
    await assert.rejects(executeBatch({batch:b,approved:b.batchSha256,root:f.root,lock:fakeLock,collectCurrent:collect(b),run}),/never replay/);assert.equal(calls,before);
  } finally {await f.dispose();}
});

test('passed WAL retains bounded original engine completion and separate timings',async()=>{
  const f=await fixture(),b=batch();
  try {
    const run=async op=>op.step==='StartWorker'?{status:'passed',receiptSha256:h('0'),processEvidence:{exitCode:0,engine:[{exitCode:0,code:'completed',stage:'completed',stdoutBytes:100,stderrBytes:0}]},timing:{engineMs:100,validationMs:20,adapterMs:125}}:pass();
    await executeBatch({batch:b,approved:b.batchSha256,root:f.root,lock:fakeLock,collectCurrent:collect(b),run});
    const record=(await journalState(f.root,b)).latest.get('op-start');
    assert.equal(record.processEvidence.engine[0].exitCode,0);assert.deepEqual(record.timing,{engineMs:100,validationMs:20,adapterMs:125});
  } finally {await f.dispose();}
});

test('literal display delta is proven across unchanged dependency closure',()=>{
  assert.equal(classify(base,display).level,'display');
  assert.equal(classifyImpact({before:base,after:display}).level,'strict');
  const stale = witness(base,display); stale.closureSha256=h('0');
  assert.equal(classifyImpact({before:base,after:display,witness:stale}).level,'strict');
});
for (const [name,value] of Object.entries({
  'backend/sales/migrations/9001.py':'writes()', 'lib/auth/permissions.ts':'grant()', 'tools/runtime.mjs':'stop()', 'config/runtime.json':'{}', 'worker/index.ts':'export const POST=1', 'package-lock.json':'{}',
  'lib/read.ts':'export const GET_ONLY=2;', 'app/view.tsx':base['app/view.tsx'].replace('<div','<div onClick={()=>fetch("/api/import",{method:"POST"})}'),
})) test(`mixed high/unproven impact blocks display: ${name}`,()=>{
  const mixed = {...display,[name]:value};
  assert.notEqual(classify(base,mixed).level,'display');
});
test('business read change uses full safeguards; unresolved dependencies stay strict',()=>{
  const after={...base,'lib/read.ts':'export const GET_ONLY=2;'};
  assert.equal(classify(base,after,'business').level,'business');
  assert.equal(classify(base,{...after,'lib/authz.ts':'checkPermission()'},'business').level,'strict');
});
test('empty/add/delete/malformed display and witness effect escalates',()=>{
  for (const after of [base,{...base,'app/new.tsx':'<div>Text</div>'},{'lib/read.ts':base['lib/read.ts']},{...base,'app/view.tsx':'<div'}]) assert.equal(classify(base,after).level,'strict');
  for (const key of Object.keys(effects)) {
    const w={...witness(base,display),effects:{...effects,[key]:true}};
    assert.equal(classifyImpact({before:base,after:display,witness:w}).level,'strict');
  }
});
test('recent complete recovery with continuous daily backup permits reuse',()=>{
  assert.equal(backupReuseDecision({impact:classify(base,display),...recovery(),now}).mode,'reuse');
});
for (const key of ['manifestSha256','dumpSha256','environmentSha256','schemaSha256','rolesSha256','operatorSha256','retentionSha256','scheduleSha256','backupId']) test(`recovery binding changed: ${key}`,()=>{
  const r=recovery(); r.current[key]='changed';
  assert.equal(backupReuseDecision({impact:classify(base,display),...r,now}).mode,'full');
});
for (const mutate of [
  r=>r.current.schedule.active=false,r=>r.current.schedule.lastResult='failed',r=>r.current.schedule.lastSuccessAt=new Date(now-backupMaxAgeMs-1).toISOString(),
  r=>r.evidence.backupCompletedAt=new Date(now-backupMaxAgeMs-1).toISOString(),r=>r.evidence.restoredAt=new Date(now-rehearsalMaxAgeMs-1).toISOString(),
  r=>r.evidence.restoredAt=new Date(now+1).toISOString(),r=>r.evidence.restoreStatus='failed',r=>r.evidence.cleanupStatus='unknown',r=>r.current.pointExists=false,r=>r.current.retained=false,r=>r.current.verifyStatus='failed',
  ...['contentEqual','rolesEqual','permissionsEqual','migrationsEqual','sequencesValid'].map(k=>r=>r.evidence[k]=false),
]) test(`invalid recovery prerequisite ${mutate.toString()}`,()=>{
  const r=recovery();mutate(r);assert.equal(backupReuseDecision({impact:classify(base,display),...r,now}).mode,'full');
});
test('strict/business releases never reuse recovery',()=>{
  for(const level of ['strict','business']) assert.equal(backupReuseDecision({impact:{level},...recovery(),now}).mode,'full');
});
test('exact binding changes block every executable release',async()=>{
  for(const key of Object.keys(batch().binding)) {
    const f=await fixture(),b=batch();let calls=0;
    try { await assert.rejects(executeBatch({batch:b,approved:b.batchSha256,root:f.root,lock:fakeLock,run:async()=>{calls++;return pass();},collectCurrent:async()=>({binding:{...b.binding,[key]:h('0')}})}),/binding changed/);assert.equal(calls,0); }
    finally{await f.dispose();}
  }
});
test('approval scope change and incomplete acceptance/tests reject',()=>{
  const b=batch();assert.throws(()=>verifyBatch({...b,operations:[]},b.batchSha256),/scope changed/);
  const core={...b,acceptance:[],before:base,after:display,witness:witness(base,display),evidence:b.recoveryEvidence,current:b.recoveryCurrent};
  assert.throws(()=>makeBatch(core),/acceptance/);
});
test('backup failure retains active ownership and safe resumption skips passed stages',async()=>{
  const f=await fixture(),b=batch();const calls=[];let fail=true;
  const run=async op=>{calls.push(op.id);return op.phase==='backup-pre'&&fail?{status:'failed',reason:'verified-zero-effect-backup-failure'}:pass();};
  try {
    await assert.rejects(executeBatch({batch:b,approved:b.batchSha256,root:f.root,lock:fakeLock,collectCurrent:collect(b),run}),/failed/);
    assert.equal(JSON.parse(await readFile(path.join(f.root,'active.json'))).batchSha256,b.batchSha256);
    const other=batch('full','other-release-0002');
    await assert.rejects(executeBatch({batch:other,approved:other.batchSha256,root:f.root,lock:fakeLock,collectCurrent:collect(other),run:pass}),/Another release/);
    fail=false;const result=await executeBatch({batch:b,approved:b.batchSha256,root:f.root,lock:fakeLock,collectCurrent:collect(b),run});
    assert.equal(calls.filter(k=>k==='op-prepare').length,1);assert.equal(result.completed,true);
    assert.equal((await journalState(f.root,b)).unknown.length,0);
  } finally{await f.dispose();}
});
test('unknown mutation is never replayed; independent exact reconciliation is required',async()=>{
  const f=await fixture(),b=batch();let calls=0;
  try {
    const run=async op=>{calls++;if(op.kind==='worker-apply')throw Error('lost result');return pass();};
    await assert.rejects(executeBatch({batch:b,approved:b.batchSha256,root:f.root,lock:fakeLock,collectCurrent:collect(b),run}),/unknown/);
    const count=calls;
    await assert.rejects(executeBatch({batch:b,approved:b.batchSha256,root:f.root,lock:fakeLock,collectCurrent:collect(b),run}),/never replay/);assert.equal(calls,count);
    await assert.rejects(reconcileOperation({root:f.root,batch:b,approved:b.batchSha256,operationId:'op-switch',resolution:'failed',proof:{},lock:fakeLock}),/reconciliation/);
    await reconcileOperation({root:f.root,batch:b,approved:b.batchSha256,operationId:'op-switch',resolution:'passed',proof:{batchSha256:b.batchSha256,operationId:'op-switch',independent:true,noReplay:true,observationsSha256:h('0')},lock:fakeLock});
    await executeBatch({batch:b,approved:b.batchSha256,root:f.root,lock:fakeLock,collectCurrent:collect(b),run});
    assert.equal(calls,count+6);
  }finally{await f.dispose();}
});
test('crash after write-ahead started record blocks replay; damaged journal blocks',async()=>{
  const f=await fixture(),b=batch();
  try{
    await executeBatch({batch:b,approved:b.batchSha256,root:f.root,lock:fakeLock,collectCurrent:collect(b),run:pass});
    const state=await journalState(f.root,b);
    const last=state.events.find(e=>e.operationId==='op-switch'&&e.status==='started');assert.ok(last);
    const target=path.join(state.dir,'000000.json');await writeFile(target,'{}');
    await assert.rejects(journalState(f.root,b),/binding/);
  }finally{await f.dispose();}
});
test('an actual subprocess exit after started retains unknown state and cannot replay',async()=>{
  const f=await fixture(),b=batch();let calls=0;
  try{
    const spec=path.join(f.root,'batch.json');await writeFile(spec,JSON.stringify(b));
    const moduleUrl=new URL('../tools/release-batch.mjs',import.meta.url).href;
    const code=`import {readFile} from 'node:fs/promises';import {executeBatch} from ${JSON.stringify(moduleUrl)};const b=JSON.parse(await readFile(process.env.TERUISI_RELEASE_TEST_SPEC));await executeBatch({batch:b,approved:b.batchSha256,root:process.env.TERUISI_RELEASE_TEST_ROOT,lock:async f=>f({}),collectCurrent:async()=>({binding:b.binding,recovery:b.recoveryCurrent}),run:async op=>{if(op.kind==='worker-apply')process.exit(17);return {status:'passed'};}});`;
    const result=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,TERUISI_RELEASE_TEST_SPEC:spec,TERUISI_RELEASE_TEST_ROOT:f.root},encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(result.status,17,result.stderr);assert.equal((await journalState(f.root,b)).unknown[0].status,'started');
    await assert.rejects(executeBatch({batch:b,approved:b.batchSha256,root:f.root,lock:fakeLock,collectCurrent:collect(b),run:async()=>{calls++;return pass();}}),/never replay/);assert.equal(calls,0);
  }finally{await f.dispose();}
});
test('recovery invalidation immediately before switching blocks the fast batch',async()=>{
  const f=await fixture(),b=batch('reuse');let calls=0;
  try{
    await assert.rejects(executeBatch({batch:b,approved:b.batchSha256,root:f.root,lock:fakeLock,run:async()=>{calls++;return pass();},collectCurrent:async(_,__,op)=>({binding:b.binding,recovery:{...b.recoveryCurrent,pointExists:op?.phase!=='switch'}})}),/Recovery point/);assert.equal(calls,2);
  }finally{await f.dispose();}
});
test('legacy plan/apply cannot claim a predecessor owned by another batch',async()=>{
  const f=await fixture();try{
    await mkdir(path.join(f.root,'state','release-batches'),{recursive:true});
    await writeFile(path.join(f.root,'state','release-batches','active.json'),`${canonical({batchSha256:h('1'),id:'active-release'})}\n`);
    await assert.rejects(assertActiveBatchOwnership(f.root),/Another release/);
    await assertActiveBatchOwnership(f.root,h('1'));
  }finally{await f.dispose();}
});
test('real original rotation mutex serializes independent preparation chats',async()=>{
  let nested=false;
  await withRotationLock(async()=>{await assert.rejects(withRotationLock(async()=>{nested=true;}),/唯一锁/);});
  assert.equal(nested,false);
});
test('timing includes explicit approval, incomplete closeout does not declare completion',()=>{
  const events=[{phase:'queue',status:'approved',at:'2026-10-08T00:00:00.000Z',durationMs:5},{phase:'switch',status:'started',at:'2026-10-08T00:00:01.000Z'},{phase:'switch',status:'passed',at:'2026-10-08T00:00:03.000Z',durationMs:2000},{phase:'closeout',status:'passed',at:'2026-10-08T00:00:05.000Z'}];
  assert.equal(timingReport(events).completed,false);
  events.push({phase:'closeout',status:'completed',at:'2026-10-08T00:00:06.000Z'});
  assert.equal(timingReport(events).approvedToCompleteMs,6000);assert.equal(timingReport(events).switchSpanMs,2000);
});

test('rehashing a hand edited batch cannot remove gates, forge impact or escape journals',()=>{
  const original=batch();
  for(const mutate of [b=>b.id='../outside',b=>b.operations=[],b=>b.operations=b.operations.filter(o=>o.phase!=='backup-pre'),b=>b.acceptance=[],b=>b.impact.level='business',b=>b.binding.sourceInventorySha256=h('0'),b=>b.operations[0].mutating='false',b=>b.binding.toolchainSha256='bad']){
    const b=structuredClone(original);mutate(b);delete b.batchSha256;b.batchSha256=hash(b);
    assert.throws(()=>verifyBatch(b,b.batchSha256));
  }
});
test('a batch cannot apply another plan, change drain owner or restore another point',()=>{
  for(const mutate of [
    b=>b.operations.find(o=>o.kind==='worker-apply').planSha256=h('2'),
    b=>b.binding.maintenanceId='b'.repeat(32),
    b=>b.operations.find(o=>o.kind==='restore').backupOperationId='op-backup-post',
    b=>b.operations=b.operations.filter(o=>o.phase!=='drain'),
    b=>{b.binding.djangoCandidateSha256=h('2');b.binding.djangoPredecessorSha256=h('3');},
  ]){
    const b=batch();mutate(b);delete b.batchSha256;b.batchSha256=hash(b);
    assert.throws(()=>verifyBatch(b,b.batchSha256));
  }
});
test('scheduled backup does nothing while paused; unknown result never gives reusable evidence',async()=>{
  const f=await fixture();const schedule=path.join(f.root,'automation.toml');let calls=0;
  try{
    await writeFile(schedule,'status = "PAUSED"\n');
    await assert.rejects(scheduledBackup({root:path.join(f.root,'daily'),schedule,run:async()=>{calls++;}}),/paused/);assert.equal(calls,0);
    await writeFile(schedule,'status = "ACTIVE"\n');
    await assert.rejects(scheduledBackup({root:path.join(f.root,'daily'),schedule,run:async()=>{calls++;throw Error('lost response');}}),/unresolved/);assert.equal(calls,1);
    await assert.rejects(scheduledBackup({root:path.join(f.root,'daily'),schedule,run:async()=>{calls++;throw Error('lost response');}}),/unresolved/);assert.equal(calls,1);
  }finally{await f.dispose();}
});
test('exact Windows OS PowerShell hash is usable while ordinary hard-linked tools stay forbidden',{skip:process.platform!=='win32'},async()=>{
  const host='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  assert.equal(await safeFileDigest(host),hash(await readFile(host)));
  const f=await fixture();try{
    const source=path.join(f.root,'tool.mjs'),alias=path.join(f.root,'alias.mjs');
    await writeFile(source,'export const synthetic = true;');await link(source,alias);
    await assert.rejects(safeFileDigest(alias),/Unsafe executable/);
  }finally{await f.dispose();}
});
