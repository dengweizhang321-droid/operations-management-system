import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {mkdtemp,writeFile,readFile,access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const evidence='E:/codex-artifacts/release-first-adoption-targeted-20261011';
const candidate='D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T090355Z-21c2645a63247749',tools=path.join(candidate,'tools');
const impact=await import(pathToFileURL(path.join(tools,'release-impact.mjs'))),engine=await import(pathToFileURL(path.join(tools,'release-batch.mjs'))),worker=await import(pathToFileURL(path.join(tools,'worker-local-release.mjs')));
const {hash,canonical}=impact;
const self=path.join(evidence,'fresh-adoption-entry-v2.mjs'),raw=readFileSync(self,'utf8'),body=raw.slice(raw.indexOf('export async function executeFreshAdoption('),raw.indexOf('\nif(process.argv[1]')).replace(/^export /,'');
const testRoot=path.resolve('tests');
const fixture=readFileSync(path.join(testRoot,'release-tools-no-migration.test.mjs'),'utf8'),fixtureSource=fixture.slice(fixture.indexOf('const tools='),fixture.indexOf('const qualified=')).replace("path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../tools')",JSON.stringify(tools));
const {request,rebind}=new Function('path','fileURLToPath','readFileSync','moduleURL',...Object.keys(impact),fixtureSource.replaceAll('import.meta.url','moduleURL')+';return {request,rebind};')(path,fileURLToPath,readFileSync,pathToFileURL(path.join(testRoot,'release-tools-no-migration.test.mjs')).href,...Object.values(impact));
const targeted=readFileSync(path.join(testRoot,'release-first-adoption-targeted.test.mjs'),'utf8'),inputSource=targeted.slice(targeted.indexOf('function input()'),targeted.indexOf('function reseal('));
const fixtureRead=p=>path.resolve(p)===path.join(tools,'release-payload-retention.mjs')?readFileSync(path.join(candidate,'source-snapshot/tools/release-payload-retention.mjs')):readFileSync(p);
const input=new Function('request','rebind','path','readFileSync','tools','hash','targetedBatchVersion','noDataCollectorFiles','process',inputSource+';return input;')(request,rebind,path,fixtureRead,tools,hash,impact.targetedBatchVersion,engine.noDataCollectorFiles,process);
async function setup(options={}) {
 const root=await mkdtemp(path.join(evidence,'fresh-entry-private-')),workerRoot=path.join(root,'worker'),specPath=path.join(root,'spec.json'),testsPath=path.join(root,'tests.json');
 const r=input();r.id='fresh-private-'+randomUUID();
 r.binding.artifactSha256=r.tests.artifactSha256='6cff8886e533244997b65d2a8668776cee5178b95e4e2a99ed14bd25bf2733f4';r.binding.workerPlanSha256='0afdb3de501e415e707670a471d245c24a6043139571099a8b9433b617a89881';
 for(const op of r.operations){if(op.planSha256)op.planSha256=r.binding.workerPlanSha256;if(op.step==='StartWorker')op.command.args[op.command.args.indexOf('-ExpectedWorkerManifestSha256')+1]=r.binding.artifactSha256;}
 const entry={kind:'first-adoption-execution',mode:'fresh-no-reuse-v1',path:self,sha256:hash(raw)};r.tests.evidence=[entry];options.changeRequest?.(r,entry);
 r.binding.testsSha256=hash(r.tests);const testsRaw=Buffer.from(JSON.stringify(r.tests));await writeFile(testsPath,testsRaw,{flag:'wx'});
 r.collector.args[2]=specPath;r.collector.args[3]=testsPath;r.collector.files.push({path:testsPath,sha256:hash(testsRaw)});
 const batch=engine.makeBatch(r),spec={batch,collector:r.collector,journalRoot:path.join(workerRoot,'state','release-batches')};options.changeSpec?.(spec);
 const saved=Buffer.from(JSON.stringify(spec));await writeFile(specPath,saved,{flag:'wx'});
 let clock=Date.now(),collected=0,executed=0;const probes=[],ops=[],digests=new Map(spec.collector.files.map(f=>[f.path,f.sha256]));
 // Real candidate verifyBatch/validateNoDataCollector/executeBatch/UTF8 WAL.
 // Only native operators, live environment collector and large immutable file
 // digest reads are controlled. All self/spec/tests file reads are actual private I/O.
 const context={assert,path,hash,canonical,candidate,self,mode:'fresh-no-reuse-v1',workerRuntimeRoot:workerRoot,processDeadline:worker.processDeadline,randomUUID,process,Date:{now:()=>clock},
  verifyBatch:engine.verifyBatch,validateNoDataCollector:engine.validateNoDataCollector,writeOnce:async(p,v)=>{if(options.failEvidence&&path.basename(p).startsWith('freshness-'))throw Object.assign(Error('private persistence denial'),{code:'EACCES'});return engine.writeOnce(p,v);},
  safeRead:impact.safeRead,safeFileDigest:async p=>{if(options.digestDrift&&collected>0&&p===options.digestDrift)return '0'.repeat(64);if(p===self||p===testsPath)return impact.safeFileDigest(p);return digests.get(p)??impact.safeFileDigest(p);},
  runApprovedOperation:async op=>{ops.push(op.id);if(options.failOperator)throw Error('Private operator failure');return{status:'passed'};},
  executeBatch:async value=>{executed++;return engine.executeBatch({...value,lock:async fn=>fn({})});},
  collectBatchAdmission:async(b,t,phase,settings)=>{collected++;probes.push({phase,step:settings.step,hasSession:Object.hasOwn(settings,'session')});assert.equal(t,testsPath);assert.equal(Object.hasOwn(settings,'session'),false);assert.equal(Object.hasOwn(settings,'observeInputs'),false);await options.onCollect?.({specPath,testsPath});const current={batchSha256:b.batchSha256,binding:b.binding,observedAtMs:clock+(options.timeOffset??0),admissionStages:[{stage:'complete-status',category:'dynamic-state',status:'passed',durationMs:1}],statusObservation:{value:{ready:true},attempts:[{attempt:1,status:'passed'}]}};if(options.expireAfterCollect)clock+=5001;return current;}};
 const draft=readFileSync(path.join(evidence,'fresh-adoption-entry-prebootstrap-draft.mjs'),'utf8');
 const validation=draft.slice(draft.indexOf('  const raw=await safeRead(specPath)'),draft.indexOf('  let lastAdmission=null;')).replace(/^  for\(const op of batch.operations\)processDeadline.*\n/m,'');
 const gate=new Function(...Object.keys(context),'return async function(specPath,approved){'+validation+';return {spec,verifyPins,verifyInputs,api:{verifyBatch,validateNoDataCollector,executeBatch,runApprovedOperation,writeOnce,collectBatchAdmission,processDeadline}};}')(...Object.values(context));
 // Bootstrap physical/tree/import ordering is tested separately on real small
 // files; this suite controls the accepted bootstrap result to test real engine wiring.
 context.bootstrapFreshEntry=gate;
 const run=new Function(...Object.keys(context),body+';return executeFreshAdoption;')(...Object.values(context));
 return{root,spec,probes,ops,run:(command='execute',at=new Date().toISOString())=>run(command,specPath,batch.batchSha256,command==='qualify'?undefined:at),collected:()=>collected,executed:()=>executed};
}
test('qualification uses original verifier and fresh collector once, never reserves ownership or invokes engine operations',async()=>{
 const f=await setup(),result=await f.run('qualify');assert.equal(result.executionMode,'fresh-no-reuse-v1');assert.equal(f.collected(),1);assert.equal(f.executed(),0);assert.equal(f.ops.length,0);await assert.rejects(access(path.join(f.spec.journalRoot,'active.json')));
});
test('execute uses original engine/WAL, performs fresh collection at every boundary and closes private ownership',async()=>{
 const f=await setup(),result=await f.run();assert.equal(result.completed,true);assert.equal(f.collected(),f.spec.batch.operations.length+1);assert.deepEqual(f.ops,f.spec.batch.operations.map(o=>o.id));assert.ok(f.probes.every(p=>!p.hasSession));await assert.rejects(access(path.join(f.spec.journalRoot,'active.json')));
});
test('wrong/missing/duplicate entry declaration or self path/hash cannot enter the engine',async()=>{
 for(const changeRequest of [r=>r.tests.evidence=[],r=>r.tests.evidence.push({...r.tests.evidence[0]}),(_r,e)=>e.mode='cached',(_r,e)=>e.path='D:/wrong/entry.mjs',(_r,e)=>e.sha256='0'.repeat(64)]){const f=await setup({changeRequest});await assert.rejects(f.run());assert.equal(f.executed(),0);}
});
test('deleting required in-process transport is rejected rather than selecting another caller',async()=>{
 const f=await setup({changeSpec:s=>{delete s.collector.transport;s.batch.collectorSha256=hash(s.collector);const core={...s.batch};delete core.batchSha256;s.batch.batchSha256=hash(core);}});await assert.rejects(f.run());assert.equal(f.executed(),0);
});
test('actual original deadline rejects a 3600000ms declared DB budget before ownership',async()=>{
 const f=await setup({changeRequest:r=>r.operations.find(o=>o.kind==='backup').command.timeoutMs=3600000});await assert.rejects(f.run());assert.equal(f.executed(),0);
});
test('explicit approval timestamp is mandatory for execute',async()=>{
 const f=await setup();await assert.rejects(f.run('execute',''),/approval timestamp/);assert.equal(f.executed(),0);
});
test('spec and raw tests drift after sampling are rejected before native action',async()=>{
 for(const key of ['specPath','testsPath']){const f=await setup({onCollect:async files=>writeFile(files[key],Buffer.concat([await readFile(files[key]),Buffer.from(' ')]))});await assert.rejects(f.run(),/bytes changed/);assert.equal(f.ops.length,0);}
});
test('entrypoint drift after sampling is rejected before native action',async()=>{
 const f=await setup({digestDrift:self});await assert.rejects(f.run(),/entrypoint bytes changed/);assert.equal(f.ops.length,0);
});
test('stale/future sample and post-sampling expiry never reach the native operator',async()=>{
 for(const options of [{timeOffset:-5001},{timeOffset:1},{expireAfterCollect:true}]){const f=await setup(options);await assert.rejects(f.run(),/Stale live admission/);assert.equal(f.ops.length,0);}
});
test('unknown operation retains original WAL ownership and cannot replay',async()=>{
 const f=await setup({failOperator:true});await assert.rejects(f.run(),/unknown/);const count=f.ops.length;await assert.rejects(f.run(),/never replay/);assert.equal(f.ops.length,count);assert.equal(JSON.parse(await readFile(path.join(f.spec.journalRoot,'active.json'))).batchSha256,f.spec.batch.batchSha256);
});

test('stale returned observation retains stages/attempts even when its evidence save fails',async()=>{
 const f=await setup({timeOffset:-5001,failEvidence:true});await assert.rejects(f.run('qualify'),e=>e.code==='STALE_ADMISSION_SNAPSHOT'&&e.admissionStages[0].stage==='complete-status'&&e.observationAttempts.length===1&&e.statusObservation.value.ready===true&&e.evidenceSaveFailure.code==='EACCES');assert.equal(f.ops.length,0);
});
test('normal stale snapshot creates bound failure evidence before rejection',async()=>{
 const f=await setup({timeOffset:-5001});await assert.rejects(f.run('qualify'),e=>e.code==='STALE_ADMISSION_SNAPSHOT'&&e.admissionStages.length===1&&e.observationAttempts.length===1);const dirs=await import('node:fs/promises').then(fs=>fs.readdir(path.join(f.spec.journalRoot,'_observations')));assert.equal(dirs.length,1);
});
test('entry uses exactly the original runner budget priority',()=>{assert.ok(raw.includes('processDeadline(op.readOnlyRetry?.totalTimeoutMs??op.command?.timeoutMs)'));});
