import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import * as impact from '../tools/release-impact.mjs';
import {makeBatch,verifyBatch,executeBatch,journalState,validateOperation,noDataCollectorFiles,auditBatchVersion} from '../tools/release-batch.mjs';
import {performance} from 'node:perf_hooks';
import {processDeadline,safeProcessEvidence} from '../tools/worker-local-release.mjs';
import {productionCommandArguments,productionCommandEnvironment} from '../tools/release-batch.mjs';
import {collectBatchRecovery} from '../tools/release-batch-admission.mjs';
const {hash,canonical,requireHash,targetedBatchVersion,targetedRecoveryPolicy}=impact;
const tools=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../tools');
// Reuse the unchanged full ten-file/dual-manifest fixture, not a fake scope boolean.
const fixtureRaw=readFileSync(new URL('./release-tools-no-migration.test.mjs',import.meta.url),'utf8');
const fixtureSource=fixtureRaw.slice(fixtureRaw.indexOf('const tools='),fixtureRaw.indexOf('const qualified='));
const {request,rebind}=new Function('path','fileURLToPath','readFileSync','moduleURL',...Object.keys(impact),fixtureSource.replaceAll('import.meta.url','moduleURL')+';return {request,rebind};')(path,fileURLToPath,readFileSync,new URL('./release-tools-no-migration.test.mjs',import.meta.url).href,...Object.values(impact));
function input() {
 const r=request();r.version=targetedBatchVersion;
 for(const name of ['release-payload-retention.mjs','d1-retirement-proof.mjs'])for(const side of ['before','after'])r.tests.scopeValidation[side].inventory['tools/'+name]=hash(readFileSync(path.join(tools,name)));
 rebind(r);
 r.tests.checks.push('targeted-recovery-negative');r.binding.testsSha256=hash(r.tests);
 r.acceptance=[...r.acceptance,'installed-recovery-consumer'];
 const restore=structuredClone(r.operations.find(o=>o.kind==='restore'));
 r.operations=r.operations.filter(o=>!['restore-pre','backup-post','restore-post'].includes(o.phase));
 const life=step=>{const value=structuredClone(r.operations.find(o=>o.step==='ExitMaintenance'));value.id='op-'+step.toLowerCase();value.step=step;value.command.args[value.command.args.indexOf('-Step')+1]=step;return value;};
 r.operations.splice(r.operations.findIndex(o=>o.kind==='worker-apply'),0,life('StopWorker'));
 restore.phase='switch';restore.id='restore-installed';
 r.operations.splice(r.operations.findIndex(o=>o.step==='ExitMaintenance'),0,life('HardenAcl'),{id:'installed-consumer',phase:'switch',kind:'recovery-consumer',mutating:false,covers:['installed-recovery-consumer']},restore);
 for(const o of r.operations.filter(o=>['backup','restore'].includes(o.kind))){
  const entry='D:\\teruisi-runtime\\django-sales\\app\\tools\\django-postgres-maintenance.ps1';
  o.command.executable='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  o.command.args=['-NoProfile','-NonInteractive','-File',entry,...o.command.args.slice(2)];o.command.files[0].path=entry;o.command.files.push({path:o.command.executable,sha256:'5'.repeat(64)});
 }
 r.collector={transport:'in-process-content-evidence-v1',executable:process.execPath,args:[path.join(tools,'release-batch-admission.mjs'),'collect',path.join(tools,'private-batch.json'),path.join(tools,'private-tests.json')],files:noDataCollectorFiles.map(p=>({path:p,sha256:hash(readFileSync(p))}))};
 return r;
}
function reseal(batch){const core={...batch};delete core.batchSha256;batch.batchSha256=hash(core);return batch;}
test('v4 binds one pre-backup and one new-installed restore without changing strict impact',()=>{
 const b=makeBatch(input());assert.equal(b.version,targetedBatchVersion);assert.equal(b.state,'SEALED');assert.equal(b.impact.level,'strict');assert.equal(b.recovery.mode,'targeted-first-adoption');
 assert.equal(b.databaseOperations.policy,targetedRecoveryPolicy);assert.deepEqual(b.databaseOperations.operationIds,['backup-pre','restore-installed']);
 assert.equal(b.requirements.backup,'pre-backup-and-installed-restore');assert.ok(b.requirements.tests.includes('migration-closure'));assert.ok(b.requirements.tests.includes('backup-recovery'));
 assert.equal(verifyBatch(structuredClone(b),b.batchSha256).batchSha256,b.batchSha256);
});
test('default v3 retains full pre/post four stages',()=>{const b=makeBatch(request());assert.equal(b.version,'teruisi-release-batch-v3');assert.equal(b.recovery.mode,'full');assert.equal(b.databaseOperations.operationIds.length,4);});
for(const mode of ['full','reuse','not-required'])test('rehashing cannot replace targeted policy with '+mode,()=>{const b=makeBatch(input());b.recovery.mode=mode;reseal(b);assert.throws(()=>verifyBatch(b,b.batchSha256),/altered/);});
test('policy, database list or protocol edits cannot grant targeted qualification',()=>{
 for(const mutate of [b=>b.recovery.policy='caller-approved',b=>b.databaseOperations.required=false,b=>b.databaseOperations.operationIds.pop(),b=>b.version='teruisi-release-batch-v3']){const b=makeBatch(input());mutate(b);reseal(b);assert.throws(()=>verifyBatch(b,b.batchSha256));}
});
test('no boolean/missing closure/prior recovery reuse or arbitrary collector grants v4',()=>{
 for(const mutate of [r=>delete r.tests.scopeValidation,r=>r.tests.scopeValidation=true,r=>r.evidence={approved:true},r=>r.current={approved:true},r=>r.collector.args[0]='D:/arbitrary.mjs']){const r=input();mutate(r);r.binding.testsSha256=hash(r.tests);assert.throws(()=>makeBatch(r));}
});
test('migration, dependency, backup operator or consumer inventory drift rejects even after manifest rehash',()=>{
 for(const name of ['backend/domain/migrations/0001.py','runtime-tools/node_modules/miniflare/index.js','tools/postgres-consistent-backup.py','tools/release-payload-retention.mjs']){const r=input();r.tests.scopeValidation.after.inventory[name]=hash('changed');rebind(r);assert.throws(()=>makeBatch(r),/outside the two/);}
});
test('missing or additional data/consumer steps cannot be hidden by rehash',()=>{
 for(const kind of ['backup','restore','recovery-consumer']){const b=makeBatch(input());b.operations=b.operations.filter(o=>o.kind!==kind);b.databaseOperations.operationIds=b.operations.filter(o=>['backup','restore'].includes(o.kind)).map(o=>o.id);reseal(b);assert.throws(()=>verifyBatch(b,b.batchSha256));}
 const r=input();const extra=structuredClone(r.operations.find(o=>o.kind==='backup'));extra.id='extra-backup';r.operations.splice(2,0,extra);assert.throws(()=>makeBatch(r),/single/);
});
test('new installed chain must precede restore and restore must precede exit/start',()=>{
 for(const other of ['op-apply','op-deployapp','op-hardenacl','op-exitmaintenance','op-startworker']){const r=input(),a=r.operations.findIndex(o=>o.id==='restore-installed'),b=r.operations.findIndex(o=>o.id===other);[r.operations[a],r.operations[b]]=[r.operations[b],r.operations[a]];assert.throws(()=>makeBatch(r),/ordering|order/);}
});
test('prepared/old operator, another backup and missing isolated restore assertions reject',()=>{
 for(const mutate of [o=>o.command.args[3]='D:/old/django-postgres-maintenance.ps1',o=>o.command.args.push('-PreparedToolAppId','c'.repeat(32)),o=>o.backupOperationId='unknown-backup',o=>o.assertions=o.assertions.filter(a=>a.path!=='productionDatabaseTouched'),o=>o.assertions=o.assertions.filter(a=>a.path!=='sequenceHealthVerified')]){const r=input();mutate(r.operations.find(o=>o.kind==='restore'));assert.throws(()=>makeBatch(r));}
});
test('consumer cannot be caller JS/command or an extra business write',()=>{
 const r=input();r.operations.find(o=>o.kind==='recovery-consumer').command={args:['arbitrary']};assert.throws(()=>makeBatch(r),/fixed/);
 const b=input();b.operations.find(o=>o.id==='op-accept').mutating=true;assert.throws(()=>makeBatch(b),/additional write/);
});
test('targeted recovery does not query daily/reuse qualification',async()=>{const b=makeBatch(input());assert.equal(await collectBatchRecovery(b,()=>{throw Error('No daily query');}),null);});

const batchRaw=readFileSync(path.join(tools,'release-batch.mjs'),'utf8');
const helperSource=batchRaw.slice(batchRaw.indexOf('function databaseOperationsFor('),batchRaw.indexOf('const requiredOperatorResults ='));
function consumerFixture(options={}) {
 const batch=makeBatch(input()),releaseId='20261011T051645Z-3032ae332a32f1a0',head={releaseId,manifestSha256:batch.binding.artifactSha256,bindingSha256:'b'.repeat(64)};
 const chain={head,headManifestPath:'D:/private/head.json',chainStateSha256:'c'.repeat(64),records:[{value:{approvedPlanSha256:batch.binding.workerPlanSha256}}]};
 const inventory=batch.tests.scopeValidation.after.inventory,calls=[];let chainReads=0;
 const receipt={version:'teruisi-release-payload-retention-v1',createdAt:new Date().toISOString(),chainStateSha256:chain.chainStateSha256,headReleaseId:releaseId,retainedReleaseIds:[releaseId],targets:[],retainedKeys:[],preservedMetadata:[]};
 if(options.badHead)receipt.headReleaseId='old-release';if(options.badShape)receipt.status='passed';if(options.badArray)receipt.retainedReleaseIds=[];
 const context={path,canonical,requireHash,targetedBatchVersion,targetedRecoveryPolicy,hash,validateOperation,Date,process,workerRuntimeRoot:'D:\\teruisi-runtime\\teruisi-worker-sales',
  safeFileDigest:async p=>{calls.push(['digest',p]);if(options.badBytes)return '0'.repeat(64);return p.endsWith('deployment.json')?batch.binding.djangoCandidateSha256:inventory['tools/'+path.basename(p)];},
  resolveEffectiveReleaseChain:async()=>{chainReads++;return options.chainDrift&&chainReads>1?{...chain,chainStateSha256:'e'.repeat(64)}:chain;},
  runProcess:async(executable,args,options)=>{calls.push(['native',executable,args,options]);return{stdout:JSON.stringify(receipt),processEvidence:{processId:123,exitCode:0}};}};
 const run=new Function(...Object.keys(context),helperSource.replace(/^export /gm,'')+';return runTargetedRecoveryConsumer;')(...Object.values(context));
 const state={latest:new Map(batch.operations.map(o=>[o.id,{status:'passed'}]))};if(options.unconfirmed)state.latest.delete('op-deployapp');
 return{calls,run:()=>run(batch,state,Date.now()+30000)};
}
test('actual consumer executor calls only installed original planner with no args and captures exact chain',async()=>{
 const f=consumerFixture(),r=await f.run();assert.equal(r.status,'passed');assert.equal(r.processEvidence.processId,123);assert.equal(r.outputs.headReleaseId,'20261011T051645Z-3032ae332a32f1a0');assert.equal(r.outputs.chainStateSha256,'c'.repeat(64));
 const native=f.calls.find(c=>c[0]==='native');assert.equal(native[1],process.execPath);assert.deepEqual(native[2],['D:\\teruisi-runtime\\django-sales\\app\\tools\\release-payload-retention.mjs']);assert.equal(native[3].cleanup,'direct');
 assert.equal(f.calls.filter(c=>c[0]==='digest').length,10);
});
for(const option of ['badHead','badShape','badArray','badBytes','chainDrift','unconfirmed'])test('actual consumer executor rejects '+option,async()=>{
 const f=consumerFixture({[option]:true});await assert.rejects(f.run());if(['badBytes','unconfirmed'].includes(option))assert.equal(f.calls.some(c=>c[0]==='native'),false);
});
test('failed consumer leaves WAL unknown, prevents restore/start and cannot replay',async()=>{
 const batch=makeBatch(input()),root=await mkdtemp(path.join(tmpdir(),'targeted-first-adoption-')),seen=[];
 const run=()=>executeBatch({batch,approved:batch.batchSha256,root,lock:async fn=>fn({}),collectCurrent:async()=>({binding:batch.binding}),run:async op=>{seen.push(op.id);if(op.kind==='recovery-consumer')throw Error('private consumer failure');return{status:'passed'};}});
 await assert.rejects(run(),/unknown/);const state=await journalState(root,batch);assert.equal(state.latest.get('installed-consumer').status,'unknown');assert.equal(seen.includes('restore-installed'),false);assert.equal(seen.includes('op-startworker'),false);
 const count=seen.length;await assert.rejects(run(),/never replay/);assert.equal(seen.length,count);assert.equal(JSON.parse(await readFile(path.join(root,'active.json'))).batchSha256,batch.batchSha256);
});

const operationSource=batchRaw.slice(batchRaw.indexOf('export async function runApprovedOperation('),batchRaw.indexOf('export async function cancelUnswitchedBatch(')).replace(/^export /gm,'');
function restoreFixture(change={}) {
 const batch=makeBatch(input()),op=batch.operations.find(o=>o.kind==='restore'),calls=[];
 const backup={backupId:'private-test-point',backupDirectory:'E:\\运营管理系统业务数据\\private-test-point',manifestSha256:'1'.repeat(64),dumpSha256:'2'.repeat(64),contentSha256:'3'.repeat(64)};
 const receipt={backupId:backup.backupId,status:'completed',serviceStateChanged:false,productionDatabaseTouched:false,cleanupStatus:'isolated_data_removed',profileRestoreVerified:true,sequenceHealthVerified:true,
  backupManifestSha256:backup.manifestSha256,dumpSha256:backup.dumpSha256,expectedContentSha256:backup.contentSha256,restoredContentSha256:backup.contentSha256,...change};
 const state={latest:new Map(batch.operations.map(o=>[o.id,{status:'passed',...(o.kind==='backup'?{outputs:backup}:{})}]))};
 const context={path,canonical,requireHash,targetedBatchVersion,targetedRecoveryPolicy,auditBatchVersion,hash,validateOperation,Date,process,performance,processDeadline,safeProcessEvidence,productionCommandArguments,productionCommandEnvironment,
  assertStartBinding:()=>{},safeFileDigest:async p=>op.command.files.find(f=>f.path===p)?.sha256,
  runProcess:async(executable,args)=>{calls.push({executable,args});return{stdout:JSON.stringify(receipt),processEvidence:{processId:321,exitCode:0}};}};
 const run=new Function(...Object.keys(context),helperSource.replace(/^export /gm,'')+operationSource+';return runApprovedOperation;')(...Object.values(context));
 return{calls,state,batch,run:()=>run(op,{batch,state,lease:{}})};
}
test('actual original operation runner expands the same confirmed backup point for installed restore',async()=>{
 const f=restoreFixture(),result=await f.run();assert.equal(result.status,'passed');assert.equal(f.calls.length,1);
 const script=Buffer.from(f.calls[0].args.at(-1),'base64').toString('utf16le');
 const encoded=/FromBase64String\('([^']+)'\)/.exec(script)[1],request=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
 assert.equal(request.parameters.BackupDirectory,'E:\\运营管理系统业务数据\\private-test-point');assert.equal(request.parameters.ApprovedManifestSha256,'1'.repeat(64));
 assert.equal(request.file,'D:\\teruisi-runtime\\django-sales\\app\\tools\\django-postgres-maintenance.ps1');assert.equal(request.parameters.Action,'RestoreRehearsal');
});
for(const [key,value] of [['backupId','other-point'],['backupManifestSha256','4'.repeat(64)],['dumpSha256','4'.repeat(64)],['restoredContentSha256','4'.repeat(64)],['productionDatabaseTouched',true],['profileRestoreVerified',false],['sequenceHealthVerified',false],['cleanupStatus','incomplete']])test('real result contract refuses '+key,async()=>{
 const f=restoreFixture({[key]:value});await assert.rejects(f.run(),e=>e.processEvidence?.code==='invalid_result'&&e.processEvidence.processId===321);
});
test('installed restore refuses missing consumer evidence before invoking any native operator',async()=>{
 const f=restoreFixture();f.state.latest.delete('installed-consumer');await assert.rejects(f.run(),/confirmed new installed consumer/);assert.equal(f.calls.length,0);
});
