import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { hash, sourceInventory, sourceTreeDigest, classifyImpactV3, requirementsForImpact, recoveryDecision, bindDeploymentImpact, effectReviewSurfaces, makeImpactProof, verifyImpactProof, noDataPolicyVersion } from '../tools/release-impact.mjs';
import { makeBatch, verifyBatch, executeBatch, journalState, validateNoDataCollector, noDataCollectorFiles } from '../tools/release-batch.mjs';
import { collectBatchRecovery, requiresCompleteArtifact, requiresCompleteAdmission } from '../tools/release-batch-admission.mjs';
import { validateNoDataObservation } from '../tools/release-no-data-observation.mjs';

const tools=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../tools'),h=c=>c.repeat(64);
const base={'app/globals.css':'.market-master-toolbar { gap: 16px; color: #fff; }','app/view.tsx':'"use client";export default function V(){return <div>Market</div>}','package.json':'{"scripts":{"start":"trusted"}}','backend/read.py':'def get(): return read_only()'};
const next={...base,'app/globals.css':base['app/globals.css'].replace('16px','18px')};
const pin=p=>({path:p,sha256:hash(readFileSync(p))});
function witness(before,after) {const p=classifyImpactV3({before,after});return {independent:true,status:'passed',reviewer:'separate reviewer',deltaSha256:p.deltaSha256,closureSha256:p.closureSha256};}
const classify=(before,after)=>classifyImpactV3({before,after,witness:witness(before,after)});
export function noDataFixture(id='no-data-fixture-0001') {
  const impact=classify(base,next),required=requirementsForImpact(impact);
  const tests={status:'passed',sourceSha256:sourceTreeDigest(next),artifactSha256:h('b'),checks:required.tests};
  const binding={sourceSha256:tests.sourceSha256,predecessorSourceSha256:sourceTreeDigest(base),sourceInventorySha256:hash(sourceInventory(next)),predecessorInventorySha256:hash(sourceInventory(base)),dependencySha256:h('c'),configurationSha256:h('d'),toolchainSha256:h('e'),artifactSha256:h('b'),testsSha256:hash(tests),predecessorSha256:h('f'),workerPlanSha256:h('1'),maintenanceId:'a'.repeat(32),djangoCandidateSha256:h('3'),djangoPredecessorSha256:h('3')};
  binding.observationBrowserSha256=h('5');binding.observationLibrarySha256=h('6');
  const identity={version:'teruisi-worker-preparation-identity-v1',nodeExecutableSha256:h('4'),runtimeConfigurationSha256:h('5'),environmentSha256:h('6'),toolchain:{version:'isolated-fixture'},externalNpmConfiguration:{user:null,global:null}};
  binding.configurationSha256=hash({environment:identity.environmentSha256,runtime:identity.runtimeConfigurationSha256,npm:identity.externalNpmConfiguration});binding.toolchainSha256=hash({node:identity.nodeExecutableSha256,toolchain:identity.toolchain});
  binding.predecessorWorkerPlanSha256=h('7');binding.predecessorArtifactSha256=h('8');
  const receipt=side=>JSON.stringify({version:'teruisi-worker-prepared-build-v1',planSha256:binding[side==='before'?'predecessorWorkerPlanSha256':'workerPlanSha256'],candidateManifestSha256:binding[side==='before'?'predecessorArtifactSha256':'artifactSha256'],identity:{...identity,sourceTree:{sha256:binding[side==='before'?'predecessorSourceSha256':'sourceSha256']},sourceInventorySha256:binding[side==='before'?'predecessorInventorySha256':'sourceInventorySha256']}});
  const deploymentProof={beforeRaw:receipt('before'),afterRaw:receipt('after')};binding.predecessorPreparationSha256=hash(deploymentProof.beforeRaw);binding.candidatePreparationSha256=hash(deploymentProof.afterRaw);
  const reviewed=witness(base,next);reviewed.reportRaw=JSON.stringify({version:'teruisi-no-data-effect-review-v1',reviewer:reviewed.reviewer,conclusion:'no-change-related-persistent-effects',...Object.fromEntries(['sourceSha256','predecessorSourceSha256','artifactSha256','workerPlanSha256'].map(key=>[key,binding[key]])),deltaSha256:reviewed.deltaSha256,closureSha256:reviewed.closureSha256,findings:Object.fromEntries(effectReviewSurfaces.map(key=>[key,'Synthetic fixture: full source has no observer, handlers or hook change; original fixed operations only.']))});binding.effectReviewSha256=hash(reviewed.reportRaw);
  const collector={transport:'in-process-content-evidence-v1',executable:process.execPath,args:[path.join(tools,'release-batch-admission.mjs'),'collect',path.join(tools,'../isolated-batch.json'),path.join(tools,'../isolated-tests.json')],files:noDataCollectorFiles.map(pin)};
  const life=(step,phase)=>({id:'op-'+step.toLowerCase(),phase,step,kind:'lifecycle',mutating:!['VerifyStartup','AggregateStatus'].includes(step),
    command:{executable:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',args:['-NoProfile','-NonInteractive','-File',path.join(tools,'release-lifecycle-step.ps1'),'-Step',step,...(['VerifyStartup','AggregateStatus'].includes(step)?[]:['-MaintenanceId',binding.maintenanceId]),...(step==='StartWorker'?['-ExpectedWorkerManifestSha256',binding.artifactSha256,'-ExpectedDjangoManifestSha256',binding.djangoCandidateSha256,'-ExpectedDrainId',binding.maintenanceId]:[])],files:[...['release-lifecycle-step.ps1','process-deadline.ps1'].map(p=>pin(path.join(tools,p))),pin('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')]},assertions:[{path:'status',equals:'completed'},{path:'drainConfirmed',equals:true}],covers:step==='VerifyStartup'?['startup']:step==='AggregateStatus'?['components']:[]});
  const observation=(action,phase='acceptance')=>({id:'op-'+action,phase,kind:'no-data-observation',mutating:false,observation:action==='display'?{action,resources:['/assets/style.css'],assertions:[{selector:'.market-master-toolbar',property:'gap',equals:'18px'}]}:{action},covers:action==='display'?['behavior','resources','task-specific']:[action==='permissions'?'permissions':'natural-watchdog']});
  const operations=[{id:'op-prepare',phase:'prepare',kind:'worker-plan',mutating:false,planSha256:binding.workerPlanSha256},life('BeginWorkerDrain','drain'),life('StopWorker','switch'),{id:'op-apply',phase:'switch',kind:'worker-apply',mutating:true,planSha256:binding.workerPlanSha256},life('StartWorker','switch'),life('EndWorkerDrain','switch'),observation('display'),observation('permissions'),life('VerifyStartup','acceptance'),life('AggregateStatus','acceptance'),observation('natural-watchdog','closeout')];
  return {batch:makeBatch({id,binding,before:base,after:next,witness:reviewed,tests,acceptance:required.acceptance,rollback:{application:'exact predecessor',compatibility:'Django unchanged',failureState:'retain gate and journal'},operations,collector,deploymentProof}),collector};
}
const rehash=b=>{const {batchSha256,...core}=b;void batchSha256;b.batchSha256=hash(core);return b;};

test('v3 CSS candidate seals zero DB operations without any recovery/daily prerequisites',async()=>{
  const {batch}=noDataFixture();assert.equal(batch.version,'teruisi-release-batch-v3');assert.equal(batch.state,'SEALED');assert.equal(batch.recovery.mode,'not-required');
  assert.deepEqual(batch.databaseOperations,{required:false,operationIds:[]});assert.equal(batch.recoveryEvidence,null);assert.equal(batch.recoveryCurrent,null);
  let calls=0;assert.equal(await collectBatchRecovery(batch,()=>{calls++;throw Error('daily disabled/no restore');}),null);assert.equal(calls,0);
  assert.equal(verifyBatch(batch,batch.batchSha256),batch);
});
test('intrinsic client text/layout can prove no data; custom text and event changes cannot',()=>{
  for(const replacement of [s=>s.replace('Market','Markets'),s=>s.replace('<div>','<div className="p-4">')]) {
    const original=replacement===null?base:base;
    const candidate={...base,'app/view.tsx':replacement(base['app/view.tsx'])};
    if(candidate['app/view.tsx'].includes('className'))assert.equal(classify(original,candidate).axes.persistentData.effect,'unproven'); // attribute addition changes structure
    else assert.equal(classify(original,candidate).axes.persistentData.effect,'none');
  }
  const custom={...base,'app/view.tsx':'"use client";export default()=> <Writer>Market</Writer>'};
  assert.equal(classify(custom,{...custom,'app/view.tsx':custom['app/view.tsx'].replace('Market','Markets')}).axes.persistentData.effect,'unproven');
  const writer={...base,'app/view.tsx':'"use client";export default function V(){return <button onClick={e=>e.currentTarget.textContent==="Danger"&&fetch("/write",{method:"POST"})}>Safe</button>}'};
  assert.equal(classify(writer,{...writer,'app/view.tsx':writer['app/view.tsx'].replace('>Safe<','>Danger<')}).axes.persistentData.effect,'unproven');
});
for(const [name,code] of Object.entries({'backend/read.py':'def get(): write_rows(); return read_only()','backend/migrations/0002.py':'migrate()','package.json':'{"scripts":{"postinstall":"migrate"}}','tools/start.mjs':'migrate()','lib/auth.ts':'allow_all()','app/api/read/route.ts':'export const GET=()=>write()','app/globals.css':'.market-master-toolbar { gap: url(/api/write); color: #fff; }'}))test('unproven change cannot forge no-data: '+name,()=>{
  const after={...next,[name]:code},w={...witness(base,after),noData:true,readOnly:true,effects:{data:false,writes:false,lifecycle:false,backup:false}};
  const impact=classifyImpactV3({before:base,after,witness:w});assert.equal(recoveryDecision({impact}).mode,'full');assert.ok(impact.axes.persistentData.gaps.length);
});
test('incomplete inventory, changed delta bytes and predecessor binding fail',()=>{
  const {batch}=noDataFixture(),proof=makeImpactProof(base,next,witness(base,next));
  for(const mutate of [p=>delete p.inventory.after['package.json'],p=>p.after['app/globals.css']+='x',p=>delete p.before['app/globals.css']]) {
    const p=structuredClone(proof);mutate(p);assert.throws(()=>verifyImpactProof(p,batch.binding,noDataPolicyVersion));
  }
  assert.throws(()=>verifyImpactProof(proof,{...batch.binding,predecessorInventorySha256:h('9')},noDataPolicyVersion));
});
test('independent-review alleged missing source bytes disproved by actual proof JSON roundtrip',()=>{
  const proof=JSON.parse(JSON.stringify(makeImpactProof(base,next,witness(base,next))));
  assert.equal(proof.before['app/globals.css'],base['app/globals.css']);assert.equal(proof.after['app/globals.css'],next['app/globals.css']);
  const {batch}=noDataFixture();assert.equal(verifyImpactProof(proof,batch.binding,noDataPolicyVersion).axes.persistentData.effect,'none');assert.equal(verifyBatch(JSON.parse(JSON.stringify(batch)),batch.batchSha256).recovery.mode,'not-required');
});
test('missing Django hash and moved pre-switch observations reject after digest recompute',()=>{
  for(const value of [undefined,'invalid']) {
    const {batch}=noDataFixture();batch.binding.djangoCandidateSha256=value;
    const op=batch.operations.find(o=>o.step==='StartWorker');op.command.args[op.command.args.indexOf('-ExpectedDjangoManifestSha256')+1]=value;
    rehash(batch);assert.throws(()=>verifyBatch(batch,batch.batchSha256),/Django/);
  }
  for(const phase of ['prepare','drain']) {
    const {batch}=noDataFixture(),index=batch.operations.findIndex(o=>o.observation?.action==='display');const [op]=batch.operations.splice(index,1);op.phase=phase;
    batch.operations.splice(phase==='prepare'?0:1,0,op);rehash(batch);assert.throws(()=>verifyBatch(batch,batch.batchSha256));
  }
});
for(const [label,mutate] of Object.entries({
  policy:b=>b.impact.axes.persistentData.effect='unproven',database:b=>b.databaseOperations.required=true,
  permission:b=>b.tests.checks=b.tests.checks.filter(v=>v!=='permissions-regression'),
  dataCommand:b=>b.operations.find(o=>o.observation?.action==='permissions').command={executable:process.execPath,args:['migrate.js']},
  omittedPermission:b=>b.operations=b.operations.filter(o=>o.observation?.action!=='permissions'),
  forgedGet:b=>b.operations.find(o=>o.observation?.action==='display').observation.resources=['/api/read'],
  lifecycleArg:b=>b.operations.find(o=>o.step==='StartWorker').command.args.push('-KeepPostgres'),
  arbitraryLifecycle:b=>b.operations.find(o=>o.step==='StopWorker').command.args[3]='D:/evil.ps1',
  forgedReadOnly:b=>Object.assign(b.operations.find(o=>o.observation?.action==='permissions'),{kind:'command',mutating:false}),
  backupInserted:b=>b.operations.splice(0,0,{id:'op-backup-fake',phase:'prepare',kind:'backup',mutating:false}),
}))test('digest recompute cannot waive '+label,()=>{const {batch}=noDataFixture();mutate(batch);rehash(batch);assert.throws(()=>verifyBatch(batch,batch.batchSha256));});
test('caller-controlled collector and trusted adapter hash forgery reject',()=>{
  const {collector}=noDataFixture();for(const mutate of [c=>c.args[0]='D:/fake.mjs',c=>c.transport=undefined,c=>c.files[0].sha256=h('9')]){const c=structuredClone(collector);mutate(c);assert.throws(()=>validateNoDataCollector(c));}
});
test('configuration/toolchain/start hooks outside source cannot hide behind CSS-only delta',()=>{
  const {batch}=noDataFixture();
  for(const key of ['runtimeConfigurationSha256','environmentSha256','nodeExecutableSha256','toolchain','externalNpmConfiguration']) {
    const proof=structuredClone(batch.deploymentProof),after=JSON.parse(proof.afterRaw);after.identity[key]=typeof after.identity[key]==='string'?h('0'):{different:true};proof.afterRaw=JSON.stringify(after);
    const binding={...batch.binding,candidatePreparationSha256:hash(proof.afterRaw)};
    assert.equal(recoveryDecision({impact:bindDeploymentImpact(classify(base,next),proof,binding,batch.impactProof.witness)}).mode,'full');
  }
  assert.equal(recoveryDecision({impact:bindDeploymentImpact(classify(base,next),null,batch.binding)}).mode,'full');
});
test('independent effect report is exact candidate evidence, not an effects=false checkbox',()=>{
  const {batch}=noDataFixture();
  for(const mutate of [w=>delete w.reportRaw,w=>{const report=JSON.parse(w.reportRaw);delete report.findings['layout-observers'];w.reportRaw=JSON.stringify(report);},w=>{const report=JSON.parse(w.reportRaw);report.artifactSha256=h('9');w.reportRaw=JSON.stringify(report);}]) {
    const w=structuredClone(batch.impactProof.witness);mutate(w);const binding={...batch.binding,effectReviewSha256:w.reportRaw?hash(w.reportRaw):h('0')};
    assert.equal(recoveryDecision({impact:bindDeploymentImpact(classify(base,next),batch.deploymentProof,binding,w)}).mode,'full');
  }
});
test('original engine WAL runs no-data phases; any source/artifact/predecessor drift stops before actions',async()=>{
  for(const key of [null,'sourceSha256','artifactSha256','predecessorSha256']) {
    const root=await mkdtemp(path.join(tmpdir(),'teruisi-no-data-')), {batch}=noDataFixture();let count=0;
    try {
      const action=()=>executeBatch({batch,approved:batch.batchSha256,root,lock:async f=>f({}),collectCurrent:async()=>({binding:key?{...batch.binding,[key]:h('0')}:batch.binding}),beforeOperation:async()=>{},run:async op=>{assert.ok(!['backup','restore'].includes(op.kind));count++;return {status:'passed'};}});
      if(key){await assert.rejects(action(),/binding changed/);assert.equal(count,0);}else{assert.equal((await action()).completed,true);assert.equal(count,batch.operations.length);assert.equal((await journalState(root,batch)).unknown.length,0);await assert.rejects(readFile(path.join(root,'active.json')),/ENOENT/);}
    } finally {await rm(root,{recursive:true,force:true});}
  }
});
test('complete content gates and negative permissions remain required',()=>{
  for(const phase of ['admission','drain','closeout']){assert.equal(requiresCompleteArtifact(phase),true);assert.equal(requiresCompleteAdmission(phase),true);}
  assert.equal(requiresCompleteArtifact('switch','worker-apply'),true);assert.equal(requiresCompleteAdmission('switch','StartWorker'),true);
  assert.throws(()=>validateNoDataObservation({kind:'no-data-observation',mutating:false,phase:'acceptance',covers:['permissions'],observation:{action:'permissions',url:'http://127.0.0.1/write'}}));
});
test('backend-not-ready Start failure retains unknown ownership and never unfreezes or replays',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'teruisi-no-data-unready-')),{batch}=noDataFixture();const calls=[];
  const execute=()=>executeBatch({batch,approved:batch.batchSha256,root,lock:async action=>action({}),collectCurrent:async()=>({binding:batch.binding}),run:async op=>{calls.push(op.step??op.kind);if(op.step==='StartWorker')throw Error('Worker-only Start requires an already-ready backend');return {status:'passed'};}});
  try {
    await assert.rejects(execute(),/unknown/);const state=await journalState(root,batch);
    assert.equal(state.latest.get('op-startworker').status,'unknown');assert.equal(calls.includes('EndWorkerDrain'),false);
    assert.equal(JSON.parse(await readFile(path.join(root,'active.json'))).batchSha256,batch.batchSha256);
    const previous=calls.length;await assert.rejects(execute(),/never replay/);assert.equal(calls.length,previous);
  } finally {await rm(root,{recursive:true,force:true});}
});
