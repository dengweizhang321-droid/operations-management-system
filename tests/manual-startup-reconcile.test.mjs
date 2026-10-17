import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {knownStartupRecovery as k,assertStartupRecoverySnapshot,canonicalRecoveryEnvironment,runStartupRecovery,assertCompletedStartupRecovery,recoveryRecordNames,verifyRecoverySourceClosure} from '../tools/manual-startup-reconcile.mjs';
function fixture(){
 const candidate={releaseId:k.releaseId,manifestSha256:k.manifestSha256,bindingSha256:k.bindingSha256};
 const shortcut={path:'C:/fixture/startup.lnk',target:'C:/Windows/powershell.exe',arguments:'exact predecessor',workingDirectory:'D:/fixture/old'};
 const config={candidate,sid:'fixture-sid',successorSha256:'s',sourceTree:'t',shortcut,shortcutIdentity:{ino:'1'},shortcutSha256:'old-link',entrypointHashes:{guard:'candidate'},environment:{PATH:'C:/Windows;D:/git',SYSTEMROOT:'C:/Windows',TEMP:'C:/Temp',USERPROFILE:'C:/User',LOGONSERVER:''},originalFailureSha256:'f',configSha256:'c'.repeat(64),djangoPreparedId:'fixture-prepared',schemaRelease:{steps:['0016','0017'],toGeneration:149},schemaInstalled:{status:'verified'},schemaFinalized:{status:'verified'}};
 const snapshot={head:candidate,chainStateSha256:k.chainStateSha256,sequence:k.sequence,successorSha256:'s',djangoManifestSha256:k.djangoManifestSha256,sourceCommit:k.mainCommit,sourceTree:'t',sourceStatus:'',maintenance:{id:k.maintenanceId,keepPostgres:true,drainedStopped:true,version:'teruisi-system-maintenance-v1',runtimeRoot:'D:/teruisi-runtime/django-sales'},drain:{id:k.maintenanceId,version:'teruisi-automation-drain-v1',keepPostgres:true,phase:'requests',runtimeRoot:'D:/teruisi-runtime/django-sales'},consumptionPresent:false,consumptionSidecarPresent:false,probe:{version:'manual-startup-preflight-v1',sid:'fixture-sid',administrator:false,originalProcessPresent:false,originalDescendants:[],publishers:[],listeners:[],shortcut:{...shortcut,controlled:true,temporaryFiles:[]}},shortcutIdentity:{ino:'1'},shortcutSha256:'old-link',entrypointHashes:{guard:'candidate'}};
 const events=[],records=new Map();let fail=null;
 const gate=name=>{events.push(name);if(name===fail)throw Error('simulated unknown '+name);};
 const ctx={withLock:fn=>fn('lease'),pinInputs:async()=>gate('pins'),successExists:async()=>records.has('SUCCESS'),verifyExistingSuccess:async()=>{gate('verify-existing');return {status:'already-completed',productionExecuted:false};},startedExists:async()=>records.has('RECOVERY-STARTED.json'),snapshot:async()=>{gate('snapshot');return structuredClone(snapshot);},save:async(name,value)=>{assert.equal(records.has(name),false);records.set(name,value);events.push('save:'+name);},apply:async lease=>{assert.equal(lease,'lease');gate('apply');return {status:'already_activated',planSha256:k.planSha256,releaseId:k.releaseId,manifestSha256:k.manifestSha256,successorSha256:'s'};},verifyConsumption:async()=>gate('consumption'),lifecycle:async(action,extra)=>{gate(action);if(action==='ExitMaintenance'){assert.deepEqual(extra,['-MaintenanceId',k.maintenanceId]);return {status:'maintenance_ended',maintenanceId:k.maintenanceId};}if(action==='Start')return {status:'started',manifestSha256:k.manifestSha256};return {status:"verified",startupVerified:true,releaseId:k.releaseId,manifestSha256:k.manifestSha256};},assertMaintenanceCleared:async()=>gate('cleared'),finishProof:async()=>{gate('ready');return {status:'ready',workerRelease:k.releaseId,workerManifestSha256:k.manifestSha256,djangoManifestSha256:k.djangoManifestSha256,maintenanceCleared:true};},publishSuccess:async()=>{gate('publish-success');records.set('SUCCESS',true);return 'original/SUCCESS.json';}};
 return {config,snapshot,events,records,ctx,setFailure:name=>fail=name};
}
test('canonical environment changes only Windows PATH representation and rejects executable injection',()=>{
 const f=fixture(),actual=canonicalRecoveryEnvironment(f.config.environment);assert.deepEqual(actual,{...f.config.environment,PATH:'C:\\Windows;D:\\git'});assert.throws(()=>canonicalRecoveryEnvironment({...f.config.environment,NODE_OPTIONS:'untrusted'}));
});
test('only exact activated/missing-consumption original tuple is admitted',()=>{
 const f=fixture();assert.doesNotThrow(()=>assertStartupRecoverySnapshot(f.snapshot,f.config));
 for(const mutate of [s=>s.head.releaseId='old',s=>s.chainStateSha256='changed',s=>s.sequence++,s=>s.maintenance.id='different',s=>s.drain.id='different',s=>s.consumptionPresent=true,s=>s.consumptionSidecarPresent=true,s=>s.probe.originalProcessPresent=true,s=>s.probe.originalDescendants=[1],s=>s.probe.publishers=[1],s=>s.probe.listeners=[1],s=>s.probe.administrator=true,s=>s.shortcutSha256='new',s=>s.probe.shortcut.temporaryFiles=['partial'],s=>s.entrypointHashes.guard='mixed',s=>s.djangoManifestSha256='old']){const changed=structuredClone(f.snapshot);mutate(changed);assert.throws(()=>assertStartupRecoverySnapshot(changed,f.config));}
});
test('check is read-only; execution only recovers apply then exits original maintenance and starts',async()=>{
 const f=fixture();assert.equal((await runStartupRecovery(f.config,f.ctx,{check:true})).productionExecuted,false);assert.equal(f.records.size,0);f.events.length=0;
 const result=await runStartupRecovery(f.config,f.ctx);assert.equal(result.status,'deployed_and_ready');assert.deepEqual(f.events.filter(e=>!e.startsWith('save:')),['pins','snapshot','apply','consumption','ExitMaintenance','cleared','Start','VerifyStartup','ready','publish-success']);
 assert.equal((await runStartupRecovery(f.config,f.ctx)).status,'already-completed');assert.equal(f.events.filter(e=>e==='apply').length,1);
});
for(const stage of ['apply','consumption','ExitMaintenance','cleared','Start','VerifyStartup','ready','publish-success'])test('unknown at '+stage+' preserves recovery intent, forbids replay and never fabricates success',async()=>{
 const f=fixture();f.setFailure(stage);await assert.rejects(runStartupRecovery(f.config,f.ctx),/simulated unknown/);assert.ok(f.records.has('RECOVERY-STARTED.json'));assert.ok(f.records.has('FAILED.json'));assert.equal(f.records.has('SUCCESS'),false);
 f.setFailure(null);const before=f.events.filter(e=>e==='apply').length;await assert.rejects(runStartupRecovery(f.config,f.ctx),/禁止重放/);assert.equal(f.events.filter(e=>e==='apply').length,before);
});
test('changed admission or original inputs cannot start recovery writes',async()=>{
 const f=fixture();f.snapshot.consumptionPresent=true;await assert.rejects(runStartupRecovery(f.config,f.ctx));assert.equal(f.records.size,0);
 const g=fixture();g.setFailure('pins');await assert.rejects(runStartupRecovery(g.config,g.ctx));assert.equal(g.records.size,0);
});
test('complete success binds every original identity and every recovery record, rejecting foreign or partial success',async()=>{
 const f=fixture();await runStartupRecovery(f.config,f.ctx);
 const records={},recordHashes={};for(const name of recoveryRecordNames){records[name]=Buffer.from(JSON.stringify(f.records.get(name)));recordHashes[name]=createHash('sha256').update(records[name]).digest('hex');}
 const receipt={status:'deployed_and_ready',recoveryProtocol:'activated-startup-path-v1',originalFailureSha256:f.config.originalFailureSha256,mainCommit:k.mainCommit,maintenanceId:k.maintenanceId,components:['worker','django'],workerRelease:k.releaseId,workerManifestSha256:k.manifestSha256,djangoManifestSha256:k.djangoManifestSha256,sourceTree:f.config.sourceTree,djangoPreparedId:f.config.djangoPreparedId,backendDeploymentReplayed:false,schemaInstallationReplayed:false,schemaReceipt:{operationId:k.operationId,maintenanceId:k.maintenanceId,release:f.config.schemaRelease,installed:f.config.schemaInstalled,finalized:f.config.schemaFinalized},workerApplyRecovery:f.records.get('WorkerApplyRecovery-result.json').value,recoveryRecords:recordHashes};
 assert.doesNotThrow(()=>assertCompletedStartupRecovery(receipt,f.config,records));
 for(const mutate of [s=>s.status='failed',s=>s.mainCommit='foreign',s=>s.maintenanceId='foreign',s=>s.components=['worker'],s=>s.workerRelease='foreign',s=>s.schemaReceipt.operationId='foreign',s=>s.schemaReceipt.release.toGeneration=147,s=>delete s.recoveryRecords['Start-result.json'],s=>s.originalFailureSha256='foreign']){const changed=structuredClone(receipt);mutate(changed);assert.throws(()=>assertCompletedStartupRecovery(changed,f.config,records));}
 const incomplete={recoveryProtocol:receipt.recoveryProtocol,originalFailureSha256:receipt.originalFailureSha256,mainCommit:'foreign',status:'failed',maintenanceId:'foreign'};assert.throws(()=>assertCompletedStartupRecovery(incomplete,f.config,records));
 const altered={...records},value=JSON.parse(records['Start-result.json']);value.value.manifestSha256='foreign';altered['Start-result.json']=Buffer.from(JSON.stringify(value));const changed=structuredClone(receipt);changed.recoveryRecords['Start-result.json']=createHash('sha256').update(altered['Start-result.json']).digest('hex');assert.throws(()=>assertCompletedStartupRecovery(changed,f.config,altered));
});
test('entire source closure is verified before loading and detects modified or new transitive sources',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reconcile-source-pin-'));assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const gitFile=execFileSync('C:/Windows/System32/where.exe',['git.exe'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0],gitSha=createHash('sha256').update(await fs.readFile(gitFile)).digest('hex');
 execFileSync(gitFile,['init','--quiet',root]);await fs.mkdir(path.join(root,'tools'));const files={'.gitignore':'node_modules/\n','package.json':'{}','tools/api.mjs':'import "./dependency.mjs";','tools/dependency.mjs':'export const value=1;'};
 for(const [name,value] of Object.entries(files))await fs.writeFile(path.join(root,name),value);execFileSync(gitFile,['-C',root,'add','.']);
 const inventory=Object.fromEntries(Object.keys(files).sort().map(name=>[name,createHash('sha256').update(files[name]).digest('hex')])),expected=createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
 assert.equal(await verifyRecoverySourceClosure(root,expected,gitFile,gitSha),4);
 await fs.writeFile(path.join(root,'tools/dependency.mjs'),'throw Error("must never execute");');await assert.rejects(verifyRecoverySourceClosure(root,expected,gitFile,gitSha),/禁止加载/);
 await fs.writeFile(path.join(root,'tools/dependency.mjs'),files['tools/dependency.mjs']);await fs.writeFile(path.join(root,'tools/new-dependency.mjs'),'untracked');await assert.rejects(verifyRecoverySourceClosure(root,expected,gitFile,gitSha),/禁止加载/);
});
