import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkdtemp,mkdir,writeFile,readFile,rm,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { hash,sourceInventory,sourceTreeDigest,makeImpactProof,classifyImpactV3,requirements,applicationInventoryFingerprint,validateToolsNoMigrationScope,toolsNoMigrationPaths,toolsNoMigrationVersion } from '../tools/release-impact.mjs';
import { makeBatch,verifyBatch,executeBatch,journalState } from '../tools/release-batch.mjs';
import { readToolsScopeApplication } from '../tools/release-batch-admission.mjs';
import { runNoDataObservation } from '../tools/release-no-data-observation.mjs';

const tools=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../tools'),h=c=>c.repeat(64);
const manifest=inventory=>JSON.stringify({version:2,deployedAt:'2026-10-11T00:00:00.000Z',sourceRoot:'D:\\isolated-source',fingerprintAlgorithm:'relative-path-file-sha256-ordinal-v2',...applicationInventoryFingerprint(inventory)});
function request({cache=false}={}) {
  const before=Object.fromEntries(toolsNoMigrationPaths.map(name=>[name,'previous reviewed '+name]));
  const after=Object.fromEntries(toolsNoMigrationPaths.map(name=>[name,readFileSync(path.join(tools,path.posix.basename(name)),'utf8')]));
  before['backend/domain/migrations/0001.py']=after['backend/domain/migrations/0001.py']='unchanged migration';
  const previous=Object.fromEntries(['backend/domain/migrations/0001.py','config/business.json','config/other.json','drizzle/retired.sql','runtime-tools/node_modules/miniflare/index.js','tools/django-local-service.ps1','tools/django-postgres-maintenance.ps1','tools/postgres-consistent-backup.py','tools/worker-local-release.mjs','tools/worker-local-release-rotation.mjs'].map(name=>[name,hash('original '+name)]));
  const next={...previous,...Object.fromEntries(['tools/worker-local-release.mjs','tools/worker-local-release-rotation.mjs'].map(name=>[name,hash(after[name])]))};
  const scopeValidation={version:toolsNoMigrationVersion,before:{inventory:previous,manifestRaw:manifest(previous)},after:{inventory:next,manifestRaw:manifest(next)}};
  if(cache) {
    previous['.wrangler/cache/cf.json']=hash('{"tlsClientRandom":"before","country":"same"}');next['.wrangler/cache/cf.json']=hash('{"tlsClientRandom":"after","country":"same"}');
    scopeValidation.before.manifestRaw=manifest(previous);scopeValidation.after.manifestRaw=manifest(next);
    scopeValidation.cfCacheReview={version:'teruisi-generated-request-cf-v1',beforeSha256:previous['.wrangler/cache/cf.json'],afterSha256:next['.wrangler/cache/cf.json'],changedPaths:['tlsClientRandom'],reviewEvidenceSha256:h('7')};
  }
  const tests={status:'passed',sourceSha256:sourceTreeDigest(after),artifactSha256:h('b'),checks:requirements.strict.tests.map(name=>name==='migration-rehearsal'?'migration-closure':name),scopeValidation};
  const binding={sourceSha256:tests.sourceSha256,predecessorSourceSha256:sourceTreeDigest(before),sourceInventorySha256:hash(sourceInventory(after)),predecessorInventorySha256:hash(sourceInventory(before)),dependencySha256:h('c'),configurationSha256:h('d'),toolchainSha256:h('e'),artifactSha256:h('b'),testsSha256:hash(tests),predecessorSha256:h('f'),workerPlanSha256:h('1'),maintenanceId:'a'.repeat(32),djangoPredecessorSha256:hash(scopeValidation.before.manifestRaw),djangoCandidateSha256:hash(scopeValidation.after.manifestRaw),djangoPreparedAppId:'c'.repeat(32),djangoPreparedReceiptSha256:h('9')};
  const life=(step,phase)=>({id:'op-'+step.toLowerCase(),phase,step,kind:step==='DeployApp'?'django-deploy':'lifecycle',mutating:true,command:{args:['-File','D:/isolated/tools/release-lifecycle-step.ps1','-Step',step,'-MaintenanceId',binding.maintenanceId,...(step==='StartWorker'?['-ExpectedWorkerManifestSha256',binding.artifactSha256,'-ExpectedDjangoManifestSha256',binding.djangoCandidateSha256]:[]),...(step==='DeployApp'?['-PreparedAppId',binding.djangoPreparedAppId,'-PreparedAppSha256',binding.djangoPreparedReceiptSha256]:[])],files:[{path:'D:/isolated/tools/release-lifecycle-step.ps1',sha256:h('1')},{path:'D:/isolated/tools/process-deadline.ps1',sha256:h('2')}]},assertions:[{path:'status',equals:'completed'},{path:'drainConfirmed',equals:true}]});
  const database=suffix=>['backup','restore'].map(kind=>({id:`${kind}-${suffix}`,phase:`${kind}-${suffix}`,kind,mutating:true,...(kind==='restore'?{backupOperationId:'backup-'+suffix}:{}),command:{args:['-File','D:/isolated/tools/django-postgres-maintenance.ps1','-Action',kind==='backup'?'Backup':'RestoreRehearsal','-Execute',...(kind==='restore'?['-ConfirmedIsolatedRestore','-BackupDirectory',`{receipt:backup-${suffix}:backupDirectory}`,'-ApprovedManifestSha256',`{receipt:backup-${suffix}:manifestSha256}`]:[])],files:[{path:'D:/isolated/tools/django-postgres-maintenance.ps1',sha256:h('1')}]},assertions:[{path:'status',equals:'completed'},{path:'serviceStateChanged',equals:false},...(kind==='restore'?[{path:'productionDatabaseTouched',equals:false},{path:'cleanupStatus',equals:'isolated_data_removed'},{path:'profileRestoreVerified',equals:true},{path:'sequenceHealthVerified',equals:true}]:[])]}));
  return {id:'tools-scope-fixture-0001',before,after,binding,tests,acceptance:requirements.strict.acceptance,rollback:{application:'compatible predecessor business code',compatibility:'retain compatible resolver',failureState:'maintenance retained'},operations:[{id:'op-prepare',phase:'prepare',kind:'worker-plan',mutating:false,planSha256:binding.workerPlanSha256},...database('pre'),life('EnterMaintenance','drain'),{id:'op-apply',phase:'switch',kind:'worker-apply',mutating:true,planSha256:binding.workerPlanSha256},life('DeployApp','switch'),life('ExitMaintenance','switch'),life('StartWorker','switch'),{id:'op-accept',phase:'acceptance',kind:'command',mutating:false,covers:requirements.strict.acceptance},...database('post'),{id:'op-close',phase:'closeout',kind:'command',mutating:false}]};
}
function rebind(input) {
  for(const side of ['before','after'])input.tests.scopeValidation[side].manifestRaw=manifest(input.tests.scopeValidation[side].inventory);
  input.binding.djangoPredecessorSha256=hash(input.tests.scopeValidation.before.manifestRaw);input.binding.djangoCandidateSha256=hash(input.tests.scopeValidation.after.manifestRaw);
  input.tests.sourceSha256=input.binding.sourceSha256=sourceTreeDigest(input.after);input.binding.sourceInventorySha256=hash(sourceInventory(input.after));input.binding.testsSha256=hash(input.tests);
  const start=input.operations.find(o=>o.step==='StartWorker');start.command.args[start.command.args.indexOf('-ExpectedDjangoManifestSha256')+1]=input.binding.djangoCandidateSha256;
}
const qualified=input=>({scopeValidation:input.tests.scopeValidation,impact:classifyImpactV3(input),impactProof:makeImpactProof(input.before,input.after),binding:input.binding,batchVersion:'teruisi-release-batch-v3'});
test('exact tools/no-migration proof changes only one validation name and retains strict/full four DB stages',()=>{
  const input=request(),batch=makeBatch(input);assert.equal(batch.impact.level,'strict');assert.equal(batch.recovery.mode,'full');assert.equal(batch.databaseOperations.required,true);assert.equal(batch.databaseOperations.operationIds.length,4);
  assert.ok(batch.requirements.tests.includes('migration-closure'));assert.equal(batch.requirements.tests.includes('migration-rehearsal'),false);assert.ok(batch.requirements.tests.includes('backup-recovery'));
  assert.equal(verifyBatch(JSON.parse(JSON.stringify(batch)),batch.batchSha256).batchSha256,batch.batchSha256);
  const legacy=request();delete legacy.tests.scopeValidation;legacy.tests.checks=requirements.strict.tests;legacy.binding.testsSha256=hash(legacy.tests);assert.ok(makeBatch(legacy).requirements.tests.includes('migration-rehearsal'));
});
test('missing closure test, v2 qualifier, unknown version or caller boolean never qualifies',()=>{
  const input=request();input.tests.checks=input.tests.checks.filter(k=>k!=='migration-closure');input.binding.testsSha256=hash(input.tests);assert.throws(()=>makeBatch(input),/test evidence/);
  for(const mutate of [r=>r.version='teruisi-release-batch-v2',r=>r.tests.scopeValidation=true,r=>r.tests.scopeValidation.version='unknown',r=>r.tests.scopeValidation.noMigration=true]){const r=request();mutate(r);r.binding.testsSha256=hash(r.tests);assert.throws(()=>makeBatch(r));}
});
for(const name of ['backend/domain/migrations/0001.py','config/business.json','drizzle/retired.sql','runtime-tools/node_modules/miniflare/index.js','tools/django-postgres-maintenance.ps1'])test('recomputed manifest/proof cannot hide changed '+name,()=>{
  const r=request();r.tests.scopeValidation.after.inventory[name]=h('9');rebind(r);assert.throws(()=>makeBatch(r),/outside the two/);
});
test('omitted inventories, wrong manifest and unreviewed source bytes reject',()=>{
  for(const mutate of [r=>delete r.tests.scopeValidation.after.inventory['backend/domain/migrations/0001.py'],r=>r.tests.scopeValidation.after.manifestRaw+=' ',r=>r.after['backend/new-migration.py']='migrate()',r=>r.after['tools/release-batch.mjs']+='\nmaliciousMigration();']) {
    const r=request();mutate(r);r.binding.sourceSha256=r.tests.sourceSha256=sourceTreeDigest(r.after);r.binding.sourceInventorySha256=hash(sourceInventory(r.after));r.binding.testsSha256=hash(r.tests);assert.throws(()=>makeBatch(r));
  }
});
test('coherently fabricated smaller manifests cannot match actual live package evidence',()=>{
  const r=request(),observedDjango=structuredClone(r.tests.scopeValidation);delete r.tests.scopeValidation.before.inventory['config/other.json'];delete r.tests.scopeValidation.after.inventory['config/other.json'];rebind(r);
  validateToolsNoMigrationScope(qualified(r)); // Self-consistent declarations still need the actual package/receipt anchor.
  assert.throws(()=>validateToolsNoMigrationScope({...qualified(r),observedDjango}));
});
test('exact generated cache review binds both hashes; live comparison rejects other fields without recording private values',()=>{
  const r=request({cache:true}),batch=makeBatch(r);assert.equal(batch.recovery.mode,'full');
  const observedDjango={before:structuredClone(r.tests.scopeValidation.before),after:structuredClone(r.tests.scopeValidation.after)};
  const observedCf={beforeRaw:'{"tlsClientRandom":"before","country":"same"}',afterRaw:'{"tlsClientRandom":"after","country":"same"}'};
  validateToolsNoMigrationScope({...qualified(r),observedDjango,observedCf});
  assert.throws(()=>validateToolsNoMigrationScope({...qualified(r),observedDjango}),/Missing live/);
  const bad=request({cache:true});bad.tests.scopeValidation.cfCacheReview.changedPaths=['country'];rebind(bad);assert.throws(()=>makeBatch(bad));
  const changed='{ "tlsClientRandom":"after", "country":"different" }';r.tests.scopeValidation.after.inventory['.wrangler/cache/cf.json']=hash(changed);r.tests.scopeValidation.cfCacheReview.afterSha256=hash(changed);rebind(r);
  assert.throws(()=>validateToolsNoMigrationScope({...qualified(r),observedDjango:{before:r.tests.scopeValidation.before,after:r.tests.scopeValidation.after},observedCf:{...observedCf,afterRaw:changed}}),/unreviewed/);
  const malformed=request({cache:true}),privateText='{private-cache-example';malformed.tests.scopeValidation.after.inventory['.wrangler/cache/cf.json']=hash(privateText);malformed.tests.scopeValidation.cfCacheReview.afterSha256=hash(privateText);rebind(malformed);
  assert.throws(()=>validateToolsNoMigrationScope({...qualified(malformed),observedCf:{...observedCf,afterRaw:privateText}}),error=>{assert.equal(error.message,'Generated cf cache is not valid JSON');return true;});
});
test('qualified batch cannot rehash away required backup/restore operations',()=>{
  const batch=makeBatch(request());batch.operations=batch.operations.filter(o=>o.kind!=='restore');batch.databaseOperations.operationIds=batch.operations.filter(o=>['backup','restore'].includes(o.kind)).map(o=>o.id);const core={...batch};delete core.batchSha256;batch.batchSha256=hash(core);assert.throws(()=>verifyBatch(batch,batch.batchSha256),/restore/);
});
test('live inventory reader binds exact raw manifest and before/app.previous-after/app bytes',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'tools-migration-closure-'));
  try {
    for(const name of ['app','app.previous','app.deploy-candidate']) {
      const dir=path.join(root,name);await mkdir(path.join(dir,'__pycache__'),{recursive:true});await writeFile(path.join(dir,'visible.py'),name);await writeFile(path.join(dir,'__pycache__','ignored.pyc'),'ignored');await writeFile(path.join(dir,'deployment.json'),'original raw '+name);
      const proof=await readToolsScopeApplication(dir);assert.equal(proof.manifestRaw,'original raw '+name);assert.deepEqual({...proof.inventory},{'visible.py':hash(name)});
    }
  } finally {await rm(root,{recursive:true,force:true});}
});
test('actual failed observer saves evidence outside WAL and subsequent journal reads/unknown retention remain valid',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'observer-wal-')),batch=makeBatch(request());
  try {
    const state=await journalState(root,batch);
    const invalid={id:'invalid-observation',phase:'acceptance',kind:'no-data-observation',mutating:false,observation:{action:'invalid'}};
    await assert.rejects(runNoDataObservation(invalid,{batch,state}));
    assert.equal((await journalState(root,batch)).events.length,0);
    const children=await readdir(path.join(root,'_observations'));assert.equal(children.length,1);assert.ok(children[0].startsWith(batch.id+'-'+invalid.id+'-'));
    const evidence=path.join(root,'_observations',children[0]);assert.equal(JSON.parse(await readFile(path.join(evidence,'started.json'))).batchSha256,batch.batchSha256);assert.equal(JSON.parse(await readFile(path.join(evidence,'failure.json'))).status,'failed');
    let calls=0;const run=()=>executeBatch({batch,approved:batch.batchSha256,root,lock:async f=>f({}),collectCurrent:async()=>({binding:batch.binding}),run:async(op,context)=>{calls++;if(op.phase==='acceptance')return runNoDataObservation(invalid,context);return {status:'passed'};}});
    await assert.rejects(run(),/unknown/);assert.equal((await journalState(root,batch)).latest.get('op-accept').status,'unknown');const count=calls;await assert.rejects(run(),/never replay/);assert.equal(calls,count);
  } finally {await rm(root,{recursive:true,force:true});}
});
