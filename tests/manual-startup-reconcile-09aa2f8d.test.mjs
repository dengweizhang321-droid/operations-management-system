import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {knownStartupRecovery as k,assertStartupRecoverySnapshot,canonicalRecoveryEnvironment,runStartupRecovery,assertCompletedStartupRecovery,recoveryRecordNames,verifyRecoverySourceClosure,waitReadyBounded,environmentHash} from '../tools/manual-startup-reconcile-09aa2f8d.mjs';

function fixture(){
 const candidate={releaseId:k.releaseId,manifestSha256:k.manifestSha256,bindingSha256:k.bindingSha256};
 const shortcut={path:'C:/fixture/startup.lnk',target:'C:/Windows/powershell.exe',arguments:'-File '+k.predecessorReleaseId+' -Action Start',workingDirectory:'D:/fixture/old'};
 const config={candidate,sid:'fixture-sid',successorSha256:'s',sourceTree:'t',shortcut,shortcutIdentity:{ino:'1'},shortcutSha256:'old-link',entrypointHashes:{guard:'candidate'},environment:{PATH:'C:/Windows;D:/git',SYSTEMROOT:'C:/Windows',TEMP:'C:/Temp',USERPROFILE:'C:/User',LOGONSERVER:''},originalFailureSha256:k.originalFailureSha256,configSha256:'c'.repeat(64),djangoPreparedId:'fixture-prepared'};
 const snapshot={planSha256:k.planSha256,protectedEntrypointCount:14,head:candidate,chainStateSha256:k.chainStateSha256,sequence:k.sequence,successorSha256:'s',djangoManifestSha256:k.djangoManifestSha256,sourceCommit:k.mainCommit,sourceTree:'t',sourceStatus:'',maintenance:{id:k.maintenanceId,keepPostgres:true,drainedStopped:true,version:'teruisi-system-maintenance-v1',runtimeRoot:'D:/teruisi-runtime/django-sales'},drain:{id:k.maintenanceId,version:'teruisi-automation-drain-v1',keepPostgres:true,phase:'requests',runtimeRoot:'D:/teruisi-runtime/django-sales'},consumptionPresent:false,consumptionSidecarPresent:false,probe:{version:'manual-startup-preflight-09aa2f8d-v1',sid:'fixture-sid',administrator:false,originalProcessPresent:false,originalDescendants:[],publishers:[],listeners:[],shortcutExclusive:{opened:true,error:null},shortcut:{...shortcut,controlled:true,temporaryFiles:[]}},shortcutIdentity:{ino:'1'},shortcutSha256:'old-link',entrypointHashes:{guard:'candidate'}};
 const events=[],records=new Map();let fail=null;
 const gate=name=>{events.push(name);if(name===fail)throw Error('simulated unknown '+name);};
 const ctx={withLock:fn=>fn('lease'),pinInputs:async()=>gate('pins'),successExists:async()=>records.has('SUCCESS'),verifyExistingSuccess:async()=>{gate('verify-existing');return {status:'already-completed',productionExecuted:false};},startedExists:async()=>records.has('RECOVERY-STARTED.json'),snapshot:async()=>{gate('snapshot');return structuredClone(snapshot);},save:async(name,value)=>{assert.equal(records.has(name),false);records.set(name,value);events.push('save:'+name);},apply:async lease=>{assert.equal(lease,'lease');gate('apply');return {status:'already_activated',planSha256:k.planSha256,releaseId:k.releaseId,manifestSha256:k.manifestSha256,successorSha256:'s'};},verifyConsumption:async()=>gate('consumption'),lifecycle:async(action,extra)=>{gate(action);if(action==='ExitMaintenance'){assert.deepEqual(extra,['-MaintenanceId',k.maintenanceId]);return {status:'maintenance_ended',maintenanceId:k.maintenanceId};}if(action==='Start')return {status:'started',manifestSha256:k.manifestSha256};return {status:'verified',startupVerified:true,releaseId:k.releaseId,manifestSha256:k.manifestSha256};},assertMaintenanceCleared:async()=>gate('cleared'),finishProof:async()=>{gate('ready');return {status:'ready',workerRelease:k.releaseId,workerManifestSha256:k.manifestSha256,djangoManifestSha256:k.djangoManifestSha256,maintenanceCleared:true};},publishSuccess:async()=>{gate('publish-success');records.set('SUCCESS',true);return 'original/SUCCESS.json';}};
 return {config,snapshot,events,records,ctx,setFailure:name=>fail=name};
}

test('pinned identities are exactly this batch (not the 2f875fb0 batch)',()=>{
 assert.equal(k.mainCommit,'09aa2f8db9b36b1a2d795bf1f7bdc96b47f54c90');assert.equal(k.planSha256,'79de63943dfbbfb38a22883168d566b05586299433b69a31bc312370538e72a7');
 assert.equal(k.releaseId,'20261114T090844Z-11ad15dba2e78d98');assert.equal(k.maintenanceId,'07be145675d34d66bbacf1e5dfff5820');assert.equal(k.djangoManifestSha256,'6b3dd65c071c6afc17120a0f1c31b34a28a8a4fe3aad5c2fc037e6c56cc942c2');
 assert.ok(Object.isFrozen(k));assert.ok(!Object.hasOwn(k,'operationId'));
});

test('canonical environment changes only Windows PATH representation and rejects executable injection',()=>{
 const f=fixture(),actual=canonicalRecoveryEnvironment(f.config.environment);assert.deepEqual(actual,{...f.config.environment,PATH:'C:\\Windows;D:\\git'});assert.throws(()=>canonicalRecoveryEnvironment({...f.config.environment,NODE_OPTIONS:'untrusted'}));
 assert.equal(environmentHash({...f.config.environment,TERUISI_PROCESS_DEADLINE_UNIX_MS:'1'}),environmentHash(f.config.environment));
});

test('exact pre-state is admitted',()=>{const f=fixture();assert.doesNotThrow(()=>assertStartupRecoverySnapshot(f.snapshot,f.config));});

const rejections={
 'consumption present':s=>s.consumptionPresent=true,
 'consumption sidecar present':s=>s.consumptionSidecarPresent=true,
 'maintenance id mismatch':s=>s.maintenance.id='different',
 'drain id mismatch':s=>s.drain.id='different',
 'drain phase not requests':s=>s.drain.phase='done',
 'maintenance keepPostgres false':s=>s.maintenance.keepPostgres=false,
 'head not candidate (predecessor)':s=>s.head.releaseId=k.predecessorReleaseId,
 'head binding changed':s=>s.head.bindingSha256='0'.repeat(64),
 'chain state changed':s=>s.chainStateSha256='changed',
 'sequence changed':s=>s.sequence++,
 'successor record changed':s=>s.successorSha256='other',
 'django manifest mismatch':s=>s.djangoManifestSha256='old',
 'wrong plan':s=>s.planSha256='f'.repeat(64),
 'entrypoint count changed':s=>s.protectedEntrypointCount=13,
 'source commit changed':s=>s.sourceCommit='foreign',
 'source tree changed':s=>s.sourceTree='foreign',
 'source dirty':s=>s.sourceStatus=' M x',
 'listeners non-empty':s=>s.probe.listeners=[3000],
 'original process present':s=>s.probe.originalProcessPresent=true,
 'original descendants':s=>s.probe.originalDescendants=[1],
 'publisher running':s=>s.probe.publishers=[1],
 'administrator':s=>s.probe.administrator=true,
 'wrong sid':s=>s.probe.sid='other',
 'wrong preflight version':s=>s.probe.version='manual-startup-preflight-v1',
 'shortcut temp files':s=>s.probe.shortcut.temporaryFiles=['TERUISI Operations Worker.lnk.tmp-x.lnk'],
 'shortcut not controlled':s=>s.probe.shortcut.controlled=false,
 'shortcut not exclusively openable':s=>s.probe.shortcutExclusive={opened:false,error:'locked'},
 'shortcut exclusivity missing':s=>delete s.probe.shortcutExclusive,
 'shortcut no longer predecessor':s=>{s.probe.shortcut.arguments='-File other';},
 'shortcut bytes changed':s=>s.shortcutSha256='new',
 'shortcut identity changed':s=>s.shortcutIdentity={ino:'2'},
 'mixed entrypoints':s=>s.entrypointHashes.guard='mixed'
};
for(const [name,mutate] of Object.entries(rejections))test('snapshot rejects: '+name,()=>{const f=fixture(),changed=structuredClone(f.snapshot);mutate(changed);assert.throws(()=>assertStartupRecoverySnapshot(changed,f.config));});

test('check is read-only: no record is saved and no lifecycle step runs',async()=>{
 const f=fixture();const result=await runStartupRecovery(f.config,f.ctx,{check:true});
 assert.equal(result.status,'checked-recovery-inputs');assert.equal(result.productionExecuted,false);assert.equal(f.records.size,0);assert.deepEqual(f.events,['pins','snapshot']);
});

test('happy path writes records in order and SUCCESS; re-run after success is already-completed without replay',async()=>{
 const f=fixture();const result=await runStartupRecovery(f.config,f.ctx);
 assert.equal(result.status,'deployed_and_ready');assert.equal(result.productionExecuted,true);
 assert.deepEqual(f.events.filter(e=>!e.startsWith('save:')),['pins','snapshot','apply','consumption','ExitMaintenance','cleared','Start','VerifyStartup','ready','publish-success']);
 assert.deepEqual([...f.records.keys()].filter(n=>n!=='SUCCESS'),recoveryRecordNames);assert.ok(f.records.has('SUCCESS'));assert.equal(f.records.has('FAILED.json'),false);
 f.events.length=0;const again=await runStartupRecovery(f.config,f.ctx);assert.equal(again.status,'already-completed');assert.equal(again.productionExecuted,false);assert.deepEqual(f.events,['pins','verify-existing']);
});

for(const stage of ['apply','consumption','ExitMaintenance','cleared','Start','VerifyStartup','ready','publish-success'])test('failure at '+stage+' writes FAILED, never SUCCESS, and forbids replay',async()=>{
 const f=fixture();f.setFailure(stage);await assert.rejects(runStartupRecovery(f.config,f.ctx),/simulated unknown/);
 assert.ok(f.records.has('RECOVERY-STARTED.json'));assert.ok(f.records.has('FAILED.json'));assert.equal(f.records.has('SUCCESS'),false);
 f.setFailure(null);const applies=f.events.filter(e=>e==='apply').length;await assert.rejects(runStartupRecovery(f.config,f.ctx),/禁止重放/);assert.equal(f.events.filter(e=>e==='apply').length,applies);
});

test('an existing RECOVERY-STARTED (started but unfinished) refuses replay and performs no write',async()=>{
 const f=fixture();f.records.set('RECOVERY-STARTED.json',{at:'x'});
 await assert.rejects(runStartupRecovery(f.config,f.ctx),/禁止重放/);assert.equal(f.records.size,1);assert.ok(!f.events.includes('apply'));assert.ok(!f.events.includes('snapshot'));
});

test('changed admission or pinned inputs cannot start recovery writes',async()=>{
 const f=fixture();f.snapshot.consumptionPresent=true;await assert.rejects(runStartupRecovery(f.config,f.ctx));assert.equal(f.records.size,0);
 const g=fixture();g.snapshot.probe.shortcutExclusive={opened:false,error:'locked'};await assert.rejects(runStartupRecovery(g.config,g.ctx),/占用/);assert.equal(g.records.size,0);assert.ok(!g.events.includes('apply'));
 const h=fixture();h.setFailure('pins');await assert.rejects(runStartupRecovery(h.config,h.ctx));assert.equal(h.records.size,0);
});

test('complete success binds every identity and record; foreign or partial receipts are rejected and no schema receipt is accepted',async()=>{
 const f=fixture();await runStartupRecovery(f.config,f.ctx);
 const records={},recordHashes={};for(const name of recoveryRecordNames){records[name]=Buffer.from(JSON.stringify(f.records.get(name)));recordHashes[name]=createHash('sha256').update(records[name]).digest('hex');}
 const receipt={status:'deployed_and_ready',recoveryProtocol:'activated-startup-path-v1',originalFailureSha256:f.config.originalFailureSha256,mainCommit:k.mainCommit,maintenanceId:k.maintenanceId,components:['worker','django'],workerRelease:k.releaseId,workerManifestSha256:k.manifestSha256,djangoManifestSha256:k.djangoManifestSha256,sourceTree:f.config.sourceTree,djangoPreparedId:f.config.djangoPreparedId,backendDeploymentReplayed:false,migration:null,backupPerformed:false,startupVerified:true,readyVerified:true,workerApplyRecovery:f.records.get('WorkerApplyRecovery-result.json').value,recoveryRecords:recordHashes};
 assert.doesNotThrow(()=>assertCompletedStartupRecovery(receipt,f.config,records));
 for(const mutate of [s=>s.status='failed',s=>s.mainCommit='foreign',s=>s.maintenanceId='foreign',s=>s.components=['worker'],s=>s.workerRelease='foreign',s=>s.djangoManifestSha256='foreign',s=>s.startupVerified=false,s=>s.readyVerified=false,s=>s.migration='0001',s=>s.schemaReceipt={},s=>delete s.recoveryRecords['Start-result.json'],s=>s.originalFailureSha256='foreign']){const changed=structuredClone(receipt);mutate(changed);assert.throws(()=>assertCompletedStartupRecovery(changed,f.config,records));}
 const altered={...records},value=JSON.parse(records['Start-result.json']);value.value.manifestSha256='foreign';altered['Start-result.json']=Buffer.from(JSON.stringify(value));const changed=structuredClone(receipt);changed.recoveryRecords['Start-result.json']=createHash('sha256').update(altered['Start-result.json']).digest('hex');assert.throws(()=>assertCompletedStartupRecovery(changed,f.config,altered));
});

test('ready wait retries transient failures within the 120 s budget and fails after it',async()=>{
 let clock=0,calls=0;const sleep=async ms=>{clock+=ms;},now=()=>clock;
 const responses=[{status:503},{status:200,body:{ok:false,status:'starting'}},{status:200,body:{ok:true,status:'ready'}}];
 const fetchImpl=async()=>{const r=responses[calls++];return {status:r.status,json:async()=>r.body};};
 assert.deepEqual(await waitReadyBounded({fetchImpl,now,sleep}),{ok:true,status:'ready'});assert.equal(calls,3);
 clock=0;calls=0;await assert.rejects(waitReadyBounded({fetchImpl:async()=>{calls++;return {status:503,json:async()=>({})};},now,sleep}),/未通过：HTTP 503/);assert.ok(clock<=120000);assert.ok(calls>=20&&calls<=25);
 clock=0;await assert.rejects(waitReadyBounded({fetchImpl:async()=>{throw Error('ECONNREFUSED');},now,sleep}),/ECONNREFUSED/);
});

test('entire source closure is verified before loading and detects modified or new transitive sources',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reconcile-09aa-source-pin-'));assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const gitFile=execFileSync('C:/Windows/System32/where.exe',['git.exe'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0],gitSha=createHash('sha256').update(await fs.readFile(gitFile)).digest('hex');
 execFileSync(gitFile,['init','--quiet',root]);await fs.mkdir(path.join(root,'tools'));const files={'.gitignore':'node_modules/\n','package.json':'{}','tools/api.mjs':'import "./dependency.mjs";','tools/dependency.mjs':'export const value=1;'};
 for(const [name,value] of Object.entries(files))await fs.writeFile(path.join(root,name),value);execFileSync(gitFile,['-C',root,'add','.']);
 const inventory=Object.fromEntries(Object.keys(files).sort().map(name=>[name,createHash('sha256').update(files[name]).digest('hex')])),expected=createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
 assert.equal(await verifyRecoverySourceClosure(root,expected,gitFile,gitSha),4);
 await fs.writeFile(path.join(root,'tools/dependency.mjs'),'throw Error("must never execute");');await assert.rejects(verifyRecoverySourceClosure(root,expected,gitFile,gitSha),/禁止加载/);
 await fs.writeFile(path.join(root,'tools/dependency.mjs'),files['tools/dependency.mjs']);await fs.writeFile(path.join(root,'tools/new-dependency.mjs'),'untracked');await assert.rejects(verifyRecoverySourceClosure(root,expected,gitFile,gitSha),/禁止加载/);
});
