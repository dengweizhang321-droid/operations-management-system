import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { classifyImpact, hash, canonical, sourceInventory, sourceTreeDigest, requirements, readSourceTree, safeRead, safeFileDigest } from '../tools/release-impact.mjs';
import { makeBatch, executeBatch, verifyBatch, journalState } from '../tools/release-batch.mjs';
import { createPreparationEvidenceSession } from '../tools/release-preparation-evidence.mjs';
import { requiresCompleteAdmission } from '../tools/release-batch-admission.mjs';
import { windowsPathSha256, hashTree, workerRuntimeRoot, workerReleaseBundledSourcePaths, workerReleaseKeyFilePaths } from '../tools/worker-local-release.mjs';
import { admissionTimer } from '../tools/release-admission-timing.mjs';

const h = c => c.repeat(64);
const effects={data:false,permissions:false,writes:false,imports:false,automation:false,lifecycle:false,backup:false,dependencyBehavior:false};
export function witness(before,after) {
  const proof=classifyImpact({before,after});
  return {kind:'display',independent:true,status:'passed',reviewer:'independent fixture reviewer',effects,deltaSha256:proof.deltaSha256,closureSha256:proof.closureSha256};
}
const classify=(before,after)=>classifyImpact({before,after,witness:witness(before,after)});
const view='"use client";export default function V(){return <p className="x">Title</p>}';
test('CSS values are proven; rules/resources/security properties remain byte-bound',()=>{
  const before={'app/globals.css':'.card { color: #fff; padding: 4px; } @media (max-width: 600px) { .card { margin: 2px; } }'};
  assert.equal(classify(before,{'app/globals.css':before['app/globals.css'].replace('#fff','#000').replace('4px','8px')}).level,'display');
  for(const after of ['.admin { color: #000; padding: 4px; }', '.card { background-image: url(https://example.com); }', '.card { color: #fff; pointer-events: none; }', '.card { color: expression(run()); padding: 4px; }', '.card { color: #fff; padding: 4px !important; }', '.card { color: #fff; --x: url(/api/write); }']) {
    assert.equal(classify(before,{'app/globals.css':after}).level,'strict');
  }
});
test('bounded static PNG replacement is allowed; SVG/new/deleted/redirected resource is rejected',()=>{
  const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
  const chunk=(kind,data)=>{const length=Buffer.alloc(4);length.writeUInt32BE(data.length);const core=Buffer.concat([Buffer.from(kind),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(core));return Buffer.concat([length,core,crc]);};
  const makePng=value=>{const header=Buffer.from('00000001000000010806000000','hex');return `\u0000binary:${Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,value,0,0,255]))),chunk('IEND',Buffer.alloc(0))]).toString('base64')}`;};
  const png=makePng(0),replacement=makePng(255);
  const before={'public/pixel.png':png};
  assert.equal(classify(before,{'public/pixel.png':replacement}).level,'display');
  for(const after of [{}, {'public/other.png':png}, {'public/pixel.png':'<svg onload="write()"/>'}, {'public/pixel.png':png+'AAAA'}])assert.equal(classify(before,after).level,'strict');
  assert.equal(classify({'public/x.svg':'<svg/>'},{'public/x.svg':'<svg><script/></svg>'}).level,'strict');
});
test('pure local Boolean button toggle is proven, aliases/custom calls/server components are not',()=>{
  const before={'app/ui/toggle.tsx':'"use client";import {useState} from "react";export default function V(){const [expanded,setExpanded]=useState(false);return <div><button type="button" onClick={()=>setExpanded(true)}>Open</button>{expanded && <p>Details</p>}</div>}'};
  const after={'app/ui/toggle.tsx':before['app/ui/toggle.tsx'].replace('setExpanded(true)','setExpanded(!expanded)')};
  assert.equal(classify(before,after).level,'display');
  for(const replacement of ['send(true)','setExpanded(fetch("/api/read"))','setExpanded(runWrite())'])assert.equal(classify(before,{'app/ui/toggle.tsx':after['app/ui/toggle.tsx'].replace('setExpanded(!expanded)',replacement)}).level,'strict');
  for(const rewrite of [s=>s.replace('"use client";',''),s=>s.replace('type="button"','type="submit"'),s=>s.replace('import {useState} from "react"','import {useState} from "./custom"'),s=>s.replace('return <div>','return <div>{runWrite(expanded)}')]) {
    assert.equal(classify({'app/ui/toggle.tsx':rewrite(before['app/ui/toggle.tsx'])},{'app/ui/toggle.tsx':rewrite(after['app/ui/toggle.tsx'])}).level,'strict');
  }
  for(const content of ['<img src={expanded ? "/api/trigger" : "/ok.png"} />','<button type="submit" disabled={expanded}>Run</button>','{expanded && <span>{window.location.href = "/api/run"}</span>}','{expanded && <span>{new Date()}</span>}']) {
    const change=s=>s.replace('{expanded && <p>Details</p>}',content);
    assert.equal(classify({'app/ui/toggle.tsx':change(before['app/ui/toggle.tsx'])},{'app/ui/toggle.tsx':change(after['app/ui/toggle.tsx'])}).level,'strict');
  }
  for(const prefix of ['(globalThis.counter++,','(globalThis.saved=']) {
    const change=s=>s.replace('return <div>',`return ${prefix}<div>`).replace('</div>}','</div>)}');
    assert.equal(classify({'app/ui/toggle.tsx':change(before['app/ui/toggle.tsx'])},{'app/ui/toggle.tsx':change(after['app/ui/toggle.tsx'])}).level,'strict');
  }
});
test('API/server execution, frontend writes, permissions, dependencies, config and mixed changes stay strict',()=>{
  const before={'app/view.tsx':view}, after={'app/view.tsx':view.replace('Title','New title')};
  for(const [name,value] of Object.entries({'app/api/view.tsx':view,'app/api/read/route.ts':'export const GET=()=>1','package-lock.json':'{}','vite.config.ts':'export default {}','app/config.ts':'export const x=1','backend/.env.example':'A=1','lib/auth/permissions.ts':'grant()','app/view.tsx':view.replace('Title','<button onClick={()=>fetch("/api/write",{method:"POST"})}>Write</button>')}))assert.equal(classify(before,{...after,[name]:value}).level,'strict');
  assert.equal(classify({'app/server.tsx':view.replace('"use client";','')},{'app/server.tsx':view.replace('"use client";','').replace('Title','New title')}).level,'strict');
  assert.equal(classify(before,{'app/view.tsx':view.replace('className="x"','className="bg-[url(https://example.com/track)]"')}).level,'strict');
});
test('actual production predecessor snapshots bind the real four-file delta and reject its ownership/permission logic',async(t)=>{
  const root=path.join(workerRuntimeRoot,'releases');
  // Read-only historical immutable snapshots. No runtime operators or secret
  // values. The fixture remains reproducible from these precise Git commits.
  let before,after,source='immutable-source-snapshot';
  try {
    before=await readSourceTree(path.join(root,'20261009T030646Z-9f93e52aa005de7c','source-snapshot'));
    after=await readSourceTree(path.join(root,'20261009T080026Z-d5fb5b62de630ae2','source-snapshot'));
  } catch(e) {
    if(e.code!=='ENOENT')throw e;
    source='historical-git-content'; before={};after={};
    for(const name of ['app/page.tsx','app/customer-service-view.tsx','app/ui/stable-read-content.tsx','app/globals.css']) {
      before[name]=execFileSync('git',['show',`22496380:${name}`],{encoding:'utf8',windowsHide:true});
      after[name]=execFileSync('git',['show',`01a0ea6d:${name}`],{encoding:'utf8',windowsHide:true});
    }
  }
  const proof=classify(before,after);
  assert.deepEqual(proof.changed,['app/customer-service-view.tsx','app/globals.css','app/page.tsx','app/ui/stable-read-content.tsx']);
  assert.equal(proof.level,'strict',source);
  t.diagnostic(canonical({source,completeSnapshots:source==='immutable-source-snapshot',beforeFiles:Object.keys(before).length,afterFiles:Object.keys(after).length,changed:proof.changed,level:proof.level,beforeSourceSha256:sourceTreeDigest(before),afterSourceSha256:sourceTreeDigest(after)}));
});
test('new admission modules are copied and key-file bound in the immutable release',()=>{
  for(const name of ['tools/release-admission-timing.mjs','tools/release-preparation-evidence.mjs']) {
    assert.ok(workerReleaseBundledSourcePaths.includes(name));assert.ok(workerReleaseKeyFilePaths.includes(name));
  }
});

export function fixtureBatch(mode='reuse',id='fastpath-fixture-0001') {
  const before={'app/view.tsx':view},after={'app/view.tsx':view.replace('Title','Caption')},now=Date.now();
  const fields={manifestSha256:h('1'),dumpSha256:h('2'),environmentSha256:h('3'),schemaSha256:h('4'),rolesSha256:h('5'),operatorSha256:h('6'),retentionSha256:h('7'),scheduleSha256:h('8'),backupId:'fixture-point'};
  const evidence={...fields,version:'teruisi-release-recovery-evidence-v1',backupCompletedAt:new Date(now-1000).toISOString(),restoredAt:new Date(now-2000).toISOString(),restoreStatus:'passed',cleanupStatus:'passed',contentEqual:true,rolesEqual:true,permissionsEqual:true,migrationsEqual:true,sequencesValid:true};
  const current={...fields,pointExists:true,verifyStatus:'passed',retained:true,sequencesValid:true,softwareCompatible:true,schedule:{active:mode==='reuse',lastResult:'success',lastSuccessAt:new Date(now-1000).toISOString()}};
  const tests={status:'passed',sourceSha256:sourceTreeDigest(after),artifactSha256:h('b'),checks:requirements.display.tests};
  const binding={sourceSha256:sourceTreeDigest(after),predecessorSourceSha256:sourceTreeDigest(before),sourceInventorySha256:hash(sourceInventory(after)),predecessorInventorySha256:hash(sourceInventory(before)),dependencySha256:h('c'),configurationSha256:h('d'),toolchainSha256:h('e'),artifactSha256:h('b'),testsSha256:hash(tests),predecessorSha256:h('f'),workerPlanSha256:h('1'),maintenanceId:'a'.repeat(32),djangoPredecessorSha256:h('a'),djangoCandidateSha256:h('a')};
  const life=(step,phase)=>({id:`op-${step.toLowerCase()}`,step,phase,kind:'lifecycle',mutating:true,command:{args:['-File','D:/isolated/tools/release-lifecycle-step.ps1','-Step',step,'-MaintenanceId',binding.maintenanceId],files:[{path:'D:/isolated/tools/release-lifecycle-step.ps1',sha256:h('a')}]},assertions:[{path:'drainConfirmed',equals:true}]});
  const database=suffix=>['backup','restore'].map(kind=>({id:`op-${kind}-${suffix}`,phase:`${kind}-${suffix}`,kind,mutating:true,...(kind==='restore'?{backupOperationId:`op-backup-${suffix}`}:{ }),
    command:{args:['-File','D:/isolated/tools/django-postgres-maintenance.ps1','-Action',kind==='backup'?'Backup':'RestoreRehearsal','-Execute',...(kind==='restore'?['-ConfirmedIsolatedRestore','-BackupDirectory',`{receipt:op-backup-${suffix}:backupDirectory}`,'-ApprovedManifestSha256',`{receipt:op-backup-${suffix}:manifestSha256}`]:[])],files:[{path:'D:/isolated/tools/django-postgres-maintenance.ps1',sha256:h('a')}]},
    assertions:[{path:'status',equals:'completed'},{path:'serviceStateChanged',equals:false},...(kind==='restore'?[{path:'productionDatabaseTouched',equals:false},{path:'cleanupStatus',equals:'isolated_data_removed'},{path:'profileRestoreVerified',equals:true},{path:'sequenceHealthVerified',equals:true}]:[])]}));
  return makeBatch({id,binding,before,after,witness:witness(before,after),evidence,current,tests,acceptance:requirements.display.acceptance,rollback:{application:'precise predecessor',compatibility:'same backend',failureState:'retain exact requests gate'},
    operations:[{id:'op-prepare',phase:'prepare',kind:'worker-plan',planSha256:h('1'),mutating:false},...(mode==='full'?database('pre'):[]),life('BeginWorkerDrain','drain'),life('StopWorker','switch'),{id:'op-apply',phase:'switch',kind:'worker-apply',planSha256:h('1'),mutating:true},life('StartWorker','switch'),life('EndWorkerDrain','switch'),{id:'op-acceptance',phase:'acceptance',mutating:false,covers:requirements.display.acceptance},...(mode==='full'?database('post'):[]),{id:'op-closeout',phase:'closeout',mutating:false}],now});
}
const fakeLock=async f=>f({});
const pass=async()=>({status:'passed'});
test('database decisions are sealed; rehashed omissions, duplicate lifecycles and arbitrary display writes fail',()=>{
  for(const mode of ['full','reuse']) {
    const b=fixtureBatch(mode);
    assert.equal(b.databaseOperations.required,mode==='full');assert.equal(b.databaseOperations.operationIds.length,mode==='full'?4:0);
    for(const mutate of [b=>b.databaseOperations.required=!b.databaseOperations.required,b=>b.operations.splice(3,0,{...b.operations[2],id:'op-duplicate'}),b=>{b.operations.find(o=>o.phase==='acceptance').mutating=true;},b=>{b.operations=b.operations.filter(o=>o.step!=='EndWorkerDrain');},b=>Object.assign(b.operations.find(o=>o.step==='StartWorker'),{kind:'unrelated-observer',mutating:false,command:{args:['--nothing'],files:[]}})]) {
      const bad=structuredClone(b);mutate(bad);delete bad.batchSha256;bad.batchSha256=hash(bad);assert.throws(()=>verifyBatch(bad,bad.batchSha256));
    }
  }
});
for(const step of ['BeginWorkerDrain','EndWorkerDrain'])test(`unknown ${step} retains ownership and is never replayed`,async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'teruisi-fastpath-')),b=fixtureBatch();let called=0;
  try {
    const run=async op=>{if(op.step===step){called++;throw Error('unknown fixture');}return pass();};
    const collectCurrent=async()=>({binding:b.binding,recovery:b.recoveryCurrent});
    await assert.rejects(executeBatch({batch:b,approved:b.batchSha256,root,lock:fakeLock,run,collectCurrent}),/unknown/);
    await assert.rejects(executeBatch({batch:b,approved:b.batchSha256,root,lock:fakeLock,run,collectCurrent}),/never replay/);
    assert.equal(called,1);assert.equal((await journalState(root,b)).unknown.length,1);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('recovery failure at any boundary blocks; sealed full DB steps cannot be skipped',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'teruisi-fastpath-'));
  try {
    const b=fixtureBatch();let calls=0;
    await assert.rejects(executeBatch({batch:b,approved:b.batchSha256,root,lock:fakeLock,run:async()=>{calls++;return pass();},collectCurrent:async(_,__,op)=>({binding:b.binding,recovery:{...b.recoveryCurrent,retained:!op}})}),/Recovery point/);assert.equal(calls,0);
    const other=fixtureBatch('full','different-fastpath-0002');
    await assert.rejects(executeBatch({batch:other,approved:other.batchSha256,root,lock:fakeLock,run:pass,collectCurrent:async()=>({binding:other.binding})}),/Another release/);
  } finally {await rm(root,{recursive:true,force:true});}
});

function evidenceFixture() {
  let time=0,full=0;const target=path.resolve('fixture.npmrc');
  const identity={sourceTree:{sha256:h('a')},sourceInventorySha256:h('b'),nodeExecutableSha256:h('c'),toolchain:{npmPackageTree:{sha256:h('d')}},runtimeConfigurationSha256:h('e'),environmentSha256:h('f'),externalNpmConfiguration:{userconfig:{contentSha256:null,pathSha256:windowsPathSha256(target)},globalconfig:{contentSha256:null,pathSha256:windowsPathSha256(target)}}};
  let snapshot={sourceSha256:h('a'),sourceInventorySha256:h('b'),toolchain:{node:h('c'),npm:{sha256:h('d')}},configuration:{runtime:h('e'),environment:h('f'),external:{userconfig:{path:target,sha256:null},globalconfig:{path:target,sha256:null}}}};
  let observe=async()=>structuredClone(snapshot);
  const session=createPreparationEvidenceSession({batchSha256:h('1'),sourceRoot:process.cwd(),clock:()=>time,identify:async()=>{full++;return structuredClone(identity);},execute:async()=>({stdout:target}),observeInputs:()=>observe()});
  return {session,snapshot,identity,collect:()=>session.collect({approvedBatchSha256:h('1')}),full:()=>full,setTime:t=>time=t,setObserver:fn=>observe=fn};
}
test('same-batch content evidence is bounded, forced at switch barriers and cannot be mutated by callers',async()=>{
  const f=evidenceFixture();const first=await f.collect();first.sourceTree.sha256=h('0');
  assert.equal((await f.collect()).sourceTree.sha256,h('a'));assert.equal(f.full(),1);
  await f.session.collect({approvedBatchSha256:h('1'),full:true});assert.equal(f.full(),2);
  f.setTime(600001);await f.collect();assert.equal(f.full(),3);
  for(let i=0;i<24;i++)await f.collect();assert.equal(f.full(),4);
  for(const pair of [['admission'],['drain'],['switch','worker-apply'],['switch','StartWorker'],['closeout']])assert.equal(requiresCompleteAdmission(...pair),true);
  assert.equal(requiresCompleteAdmission('acceptance','probe'),false);
});
for(const key of ['sourceSha256','sourceInventorySha256','toolchain','configuration'])test(`content change invalidates ${key} even with unchanged timestamps`,async()=>{
  const f=evidenceFixture();await f.collect();f.snapshot[key]=key.includes('Sha256')?h('0'):{};
  await assert.rejects(f.collect(),/invalidated/);
});
test('evidence checked before work is rechecked after; other batches/concurrent use/disposal are refused',async()=>{
  const f=evidenceFixture();await f.collect();f.snapshot.configuration.runtime=h('0');await assert.rejects(f.session.recheck(),/after admission/);
  const g=evidenceFixture();await assert.rejects(g.session.collect({approvedBatchSha256:h('2')}),/another batch/);
  const c=evidenceFixture();await c.collect();let release;const gate=new Promise(r=>release=r);c.setObserver(async()=>{await gate;return structuredClone(c.snapshot);});
  const running=c.collect();await assert.rejects(c.collect(),/concurrently/);c.session.dispose();release();await assert.rejects(running,/disposed/);
  await assert.rejects(c.collect(),/disposed/);
  assert.equal(evidenceFixture().full(),0,'process restart must rebuild evidence');
});
test('full verification observation race and unsuccessful result never seed reusable evidence',async()=>{
  const f=evidenceFixture();f.setObserver(async()=>{const out=structuredClone(f.snapshot);out.sourceSha256=h('0');return out;});
  await assert.rejects(f.collect(),/changed during/);f.setObserver(async()=>structuredClone(f.snapshot));await f.collect();assert.equal(f.full(),2);
});
test('expiry covers the whole observation and source changes after admission block before WAL intent',async()=>{
  const f=evidenceFixture();await f.collect();f.setTime(599999);f.setObserver(async()=>{f.setTime(600001);return structuredClone(f.snapshot);});
  await assert.rejects(f.session.recheck(),/expired/);
  const root=await mkdtemp(path.join(tmpdir(),'teruisi-source-fence-')),b=fixtureBatch();let calls=0;
  try {
    await assert.rejects(executeBatch({batch:b,approved:b.batchSha256,root,lock:fakeLock,collectCurrent:async()=>({binding:b.binding,recovery:b.recoveryCurrent}),beforeOperation:async()=>{throw Error('source observation invalidated');},run:async()=>{calls++;return pass();}}),/invalidated/);
    assert.equal(calls,0);assert.equal((await journalState(root,b)).unknown.length,0);
  } finally{await rm(root,{recursive:true,force:true});}
});
test('snapshot inventory includes environment examples and same-mtime tampering is detected by bytes',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'teruisi-source-fixture-'));
  try {await mkdir(path.join(root,'backend'));const target=path.join(root,'backend','.env.example');await writeFile(target,'EXAMPLE=1');const stamp=new Date(0);await utimes(target,stamp,stamp);const first=sourceTreeDigest(await readSourceTree(root));await writeFile(target,'EXAMPLE=2');await utimes(target,stamp,stamp);assert.notEqual(sourceTreeDigest(await readSourceTree(root)),first);assert.equal((await safeRead(target)).toString(),'EXAMPLE=2');}
  finally{await rm(root,{recursive:true,force:true});}
});
test('missing config parent creation invalidates; unrelated ancestor siblings do not',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'teruisi-config-watch-')),source=path.join(root,'source'),runtime=path.join(root,'runtime.vars');
  const targets={userconfig:path.join(root,'absent','user','npmrc'),globalconfig:path.join(root,'absent','global','npmrc')};
  let session;
  try {
    await mkdir(source);await writeFile(path.join(source,'view.tsx'),view);await writeFile(runtime,'SYNTHETIC=1');
    const identify=async()=>{const files=await readSourceTree(source);return {
      sourceTree:{sha256:sourceTreeDigest(files)},sourceInventorySha256:hash(sourceInventory(files)),nodeExecutableSha256:await safeFileDigest(process.execPath),
      toolchain:{npmPackageTree:await hashTree(path.join(path.dirname(process.execPath),'node_modules','npm'))},runtimeConfigurationSha256:hash(await safeRead(runtime)),environmentSha256:hash(process.env),
      externalNpmConfiguration:Object.fromEntries(Object.entries(targets).map(([key,target])=>[key,{pathSha256:windowsPathSha256(target),contentSha256:null}]))};};
    session=createPreparationEvidenceSession({batchSha256:h('1'),sourceRoot:source,devVarsSource:runtime,identify,execute:async(_exe,args)=>({stdout:targets[args.at(-1)]})});
    await session.collect({approvedBatchSha256:h('1')});await writeFile(path.join(root,'unrelated.txt'),'not an input');await new Promise(r=>setImmediate(r));
    await session.recheck();await mkdir(path.join(root,'absent'));await new Promise(r=>setTimeout(r,20));
    await assert.rejects(session.recheck(),/changed/);
  }finally{session?.dispose();await rm(root,{recursive:true,force:true});}
});
test('timings are disjoint children and retain failure status without sensitive diagnostics',async()=>{
  const timer=admissionTimer();await timer.measure('classification','sealed-evidence',async()=>1);
  await assert.rejects(timer.measure('source','mutable-input',async()=>{throw Error('secret fixture value');}));
  const result=timer.result();assert.equal(result.length,2);assert.equal(result[1].status,'failed');assert.ok(result.every(s=>s.durationMs>=0));assert.doesNotMatch(canonical(result),/secret/);
});
test('failed live collector stages persist in the actual journal without error values',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'teruisi-failed-admission-')),b=fixtureBatch();
  try {
    await assert.rejects(executeBatch({batch:b,approved:b.batchSha256,root,lock:fakeLock,run:pass,collectCurrent:async()=>{const e=Error('private path');e.admissionStages=[{stage:'source-content',category:'mutable-input',status:'failed',durationMs:3}];throw e;}}));
    const state=await journalState(root,b),failed=state.events.find(e=>e.status==='admission-failed');
    assert.equal(failed.admissionStages[0].durationMs,3);assert.doesNotMatch(canonical(state.events),/private path/);
    assert.equal(state.unknown.length,0);
  }finally{await rm(root,{recursive:true,force:true});}
});
