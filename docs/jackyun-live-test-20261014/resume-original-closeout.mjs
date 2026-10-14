import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const original='D:/codex-artifacts/jackyun-migration-adoption-20261013/direct-publication-final';
const evidence='D:/codex-artifacts/jackyun-live-test-20261014';
const engine='D:/codex-isolated/jackyun-unified-recovery-20261013';
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const spec=await read(original+'/approved-batch.json');
const direction=await read(original+'/authorization-source.json');
const {executeBatch,runApprovedOperation,reconcileOperation,writeOnce,verifyBatch}=await import(pathToFileURL(engine+'/tools/release-batch.mjs'));
const {collectBatchAdmission}=await import(pathToFileURL(engine+'/tools/release-batch-admission.mjs'));
const {safeFileDigest,hash,canonical}=await import(pathToFileURL(engine+'/tools/release-impact.mjs'));
verifyBatch(spec.batch,spec.batch.batchSha256);
assert.equal(spec.batch.batchSha256,'639f410937aae7aa05d6a2418bf4050f6ee21a7a91ca03df806860916efa6d7f');
const failed=await read(spec.journalRoot+'/'+spec.batch.id+'/000068.json');
assert.equal(failed.eventSha256,'0fd0d04cc8dfb02b25a0f6024db69b662565cc39a1f258f6757cfaeb3346a46f');
assert.equal(failed.status,'unknown');assert.equal(failed.processEvidence.exitCode,1);
const op=spec.batch.operations.find(x=>x.id==='check-natural-watchdog');assert.equal(op.mutating,false);
for(const f of op.command.files)assert.equal(await safeFileDigest(f.path),f.sha256);
assert.equal(spec.collector.executable,process.execPath);
assert.equal(hash(spec.collector),spec.batch.collectorSha256);
const ready=await read(evidence+'/watchdog-candidate-after-repair.json');
assert.equal(ready.healthy,true);assert.equal(ready.probeError,false);
const installed=await read(evidence+'/watchdog-installed-result.json');assert.equal(installed.status,'installed');
const config=await read(original+'/adoption-config.json');
const observationRoot=path.resolve(config.observationRoot);
assert.equal(observationRoot,path.resolve(original+'/observations'));
const bad=await read(observationRoot+'/natural-observed-2.json');assert.equal(bad.healthy,false);assert.equal(bad.probeError,true);
const archived=path.join(observationRoot,'natural-before-monitor-repair');
await fs.mkdir(archived); // create-only; do not repeat after an interrupted archive
const inventory=[];
for(const name of (await fs.readdir(observationRoot)).sort()){
 if(!/^natural-observed-\d+(?:\.json(?:\.sha256)?|-(?:seen|classification)\.json)$/.test(name))continue;
 const from=path.resolve(observationRoot,name),to=path.resolve(archived,name);
 assert.equal(path.dirname(from),observationRoot);assert.equal(path.dirname(to),archived);
 const bytes=await fs.readFile(from);inventory.push({original:from,archive:to,sha256:sha(bytes)});
 await fs.rename(from,to);assert.equal(await safeFileDigest(to),sha(bytes));
}
assert(inventory.length>=5);
await writeOnce(evidence+'/original-natural-failure-archive.json',{failedEvent:failed.eventSha256,files:inventory});
const proof={independent:true,batchSha256:spec.batch.batchSha256,operationId:op.id,noReplay:true,noEffect:true,observationsSha256:hash({failed,inventory,ready,installed}),reason:'Original read-only observer exited 1 on a retained unhealthy frame. Monitor repaired separately; previous failure remains failed, eligible for a fresh observation attempt.'};
await writeOnce(evidence+'/natural-failure-reconciliation.json',proof);
await reconcileOperation({root:spec.journalRoot,batch:spec.batch,approved:spec.batch.batchSha256,operationId:op.id,resolution:'failed',proof});
await writeOnce(evidence+'/original-closeout-retry-started.json',{at:new Date().toISOString(),batchSha256:spec.batch.batchSha256});
try{
 const result=await executeBatch({batch:spec.batch,approved:spec.batch.batchSha256,approvedAt:direction.approvedAt,root:spec.journalRoot,
  run:(operation,context)=>{assert.equal(operation.id,op.id,'No other original operations may replay');return runApprovedOperation(operation,context);},
  collectCurrent:async(_batch,_lease,operation)=>{
   for(const f of spec.collector.files)assert.equal(await safeFileDigest(f.path),f.sha256);
   const dest=path.join(spec.journalRoot,'_observations',spec.batch.id+'-'+randomUUID());
   const current=await collectBatchAdmission(spec.batch,spec.collector.args[3],operation?.phase??'admission',{step:operation?.step??operation?.kind,onStatusAttempt:r=>writeOnce(path.join(dest,r.attempt+'.json'),{version:'teruisi-status-attempt-v1',batchSha256:spec.batch.batchSha256,observation:r})});
   assert.equal(current.batchSha256,spec.batch.batchSha256);assert(Math.abs(Date.now()-current.observedAtMs)<=5000);return current;
  }});
 await writeOnce(evidence+'/original-closeout-retry-result.json',{status:'original_batch_completed',result,at:new Date().toISOString()});
 console.log(JSON.stringify({status:'original_batch_completed'}));
}catch(error){await writeOnce(evidence+'/original-closeout-retry-failure.json',{error:error.message,at:new Date().toISOString()});throw error;}
