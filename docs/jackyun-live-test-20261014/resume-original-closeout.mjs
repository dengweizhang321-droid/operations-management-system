import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const aligned=process.argv[2]==='aligned-retry';
assert(process.argv.length===2||aligned,'Unknown closeout retry mode');
const suffix=aligned?'-aligned':'';
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
const {runProcess}=await import(pathToFileURL(engine+'/tools/worker-local-release.mjs'));
verifyBatch(spec.batch,spec.batch.batchSha256);
assert.equal(spec.batch.batchSha256,'639f410937aae7aa05d6a2418bf4050f6ee21a7a91ca03df806860916efa6d7f');
const failed=await read(spec.journalRoot+'/'+spec.batch.id+(aligned?'/000074.json':'/000068.json'));
assert.equal(failed.eventSha256,aligned?'9e82cc4e14a3fc0600f08db8b2cb3f6431066e91f0eeb53c169ddbfe583d33f7':'0fd0d04cc8dfb02b25a0f6024db69b662565cc39a1f258f6757cfaeb3346a46f');
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
const bad=await read(observationRoot+'/natural-observed-2.json');
assert.equal(bad.healthy,aligned);assert.equal(bad.probeError,!aligned);
if(aligned){const started=await read(spec.journalRoot+'/'+spec.batch.id+'/000073.json');assert(Date.parse(bad.at)<Date.parse(started.at));assert(Date.parse(bad.completedAt)>Date.parse(started.at));}
const archived=path.join(observationRoot,aligned?'natural-attempt-after-repair-before-alignment':'natural-before-monitor-repair');
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
await writeOnce(evidence+'/original-natural-failure-archive'+suffix+'.json',{failedEvent:failed.eventSha256,files:inventory});
const proof={independent:true,batchSha256:spec.batch.batchSha256,operationId:op.id,noReplay:true,noEffect:true,observationsSha256:hash({failed,inventory,ready,installed}),reason:aligned?'Original read-only observer rejected a newly published healthy sample whose start preceded the observation window. No production effect. Preserve failure and align next window with scheduled idle.':'Original read-only observer exited 1 on a retained unhealthy frame. Monitor repaired separately; previous failure remains failed, eligible for a fresh observation attempt.'};
await writeOnce(evidence+'/natural-failure-reconciliation'+suffix+'.json',proof);
await reconcileOperation({root:spec.journalRoot,batch:spec.batch,approved:spec.batch.batchSha256,operationId:op.id,resolution:'failed',proof});
await writeOnce(evidence+'/original-closeout-retry-started'+suffix+'.json',{at:new Date().toISOString(),batchSha256:spec.batch.batchSha256});
async function waitForNaturalBoundary(operation){
 assert.equal(operation.id,op.id);
 const desired='D:/teruisi-runtime/django-sales/run/django-supervisor-desired-state.json';
 const desiredHash=await safeFileDigest(desired),deadline=Date.now()+180000;
 const command="$t=Get-ScheduledTask -TaskName 'TERUISI Operations Watchdog'; $i=Get-ScheduledTaskInfo -TaskName 'TERUISI Operations Watchdog'; [pscustomobject]@{state=[string]$t.State;action=[string]$t.Actions.Execute;last=$i.LastRunTime.ToUniversalTime().ToString('o');next=$i.NextRunTime.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress";
 while(Date.now()<deadline){
  const result=await runProcess('C:/Users/86137/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe',['-NoProfile','-NonInteractive','-Command',command],{outputProtocol:'direct-exit-files',cleanup:'direct',timeoutMs:15000,label:'read-only natural boundary'});
  const task=JSON.parse(result.stdout);assert(task.action.includes('ceee38dabd66ea9cc77622679d35bf601367f0582ac00fcfe5074dc10940c940'));assert.notEqual(task.state,'Disabled');
  const latest=await read('D:/teruisi-runtime/operations-watchdog/latest.json');
  assert.equal(await safeFileDigest(desired),desiredHash,'Running intent changed during alignment');
  if(task.state==='Ready'&&Date.parse(task.next)-Date.now()>6000&&Date.parse(latest.at)>=Date.parse(task.last)&&Date.parse(latest.completedAt)<=Date.now()){
   assert.equal(latest.healthy,true);assert.equal(latest.probeError,false);
   await writeOnce(evidence+'/natural-observation-alignment.json',{at:new Date().toISOString(),task,latestAt:latest.at,latestCompletedAt:latest.completedAt,desiredHash,manualTaskTrigger:false});return;
  }
  await new Promise(r=>setTimeout(r,1000));
 }
 throw Error('No natural idle boundary within bounded observation');
}
try{
 const result=await executeBatch({batch:spec.batch,approved:spec.batch.batchSha256,approvedAt:direction.approvedAt,root:spec.journalRoot,beforeOperation:aligned?waitForNaturalBoundary:undefined,
  run:(operation,context)=>{assert.equal(operation.id,op.id,'No other original operations may replay');return runApprovedOperation(operation,context);},
  collectCurrent:async(_batch,_lease,operation)=>{
   for(const f of spec.collector.files)assert.equal(await safeFileDigest(f.path),f.sha256);
   const dest=path.join(spec.journalRoot,'_observations',spec.batch.id+'-'+randomUUID());
   const current=await collectBatchAdmission(spec.batch,spec.collector.args[3],operation?.phase??'admission',{step:operation?.step??operation?.kind,onStatusAttempt:r=>writeOnce(path.join(dest,r.attempt+'.json'),{version:'teruisi-status-attempt-v1',batchSha256:spec.batch.batchSha256,observation:r})});
   assert.equal(current.batchSha256,spec.batch.batchSha256);assert(Math.abs(Date.now()-current.observedAtMs)<=5000);return current;
  }});
 await writeOnce(evidence+'/original-closeout-retry-result'+suffix+'.json',{status:'original_batch_completed',result,at:new Date().toISOString()});
 console.log(JSON.stringify({status:'original_batch_completed'}));
}catch(error){await writeOnce(evidence+'/original-closeout-retry-failure'+suffix+'.json',{error:error.message,at:new Date().toISOString()});throw error;}
