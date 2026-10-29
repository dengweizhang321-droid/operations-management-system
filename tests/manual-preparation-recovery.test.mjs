import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {submitPreparation,drainPreparationQueue,readPreparationQueueInventory,durableCreate,sha,queueVersion,canonical,acquireQueueSubmissionLock} from '../tools/main-prebuild-queue.mjs';
import {submitAbandonOnlyRequest,readReconciliationInventory} from '../tools/main-preparation-reconcile.mjs';
import {assertDisabledPreparationPredecessor,assertPreparationTask,taskPowerShell} from '../tools/main-prebuild-task.mjs';
import {retirementEntryPolicies} from '../tools/preparation-retirement-entry.mjs';

const old={configSha256:'1'.repeat(64),bundleSha256:'2'.repeat(64)},target='a'.repeat(40),generation={installId:randomUUID(),stateSha256:'3'.repeat(64),bundleSha256:'4'.repeat(64),configSha256:old.configSha256};
async function fixture(t,{deadlineUnixMs=Date.now()-3600000,terminal=true}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'manual-abandon-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:50}));const queue=path.join(root,'queue'),packet=path.join(root,'packet');
 const ticket=await submitPreparation(queue,{...old,origin:'manual'}),dispatchId=randomUUID();
 const live={mainCommit:'b'.repeat(40),head:{bindingSha256:'5'.repeat(64)},djangoManifestSha256:'6'.repeat(64),chainStateSha256:'7'.repeat(64)};
 const dispatch={version:queueVersion,dispatchId,requestId:ticket.requestId,mode:'prepare-only',...old,selectedTarget:target,selection:{targetCommit:target,packet,live},deadlineUnixMs,dispatchedAt:new Date(deadlineUnixMs-3600000).toISOString(),tickets:[{requestId:ticket.requestId,ticketSha256:ticket.ticketSha256,observedTarget:null}]};
 const dispatchSha256=await durableCreate(path.join(queue,'dispatches',dispatchId+'.json'),dispatch),resultFile=path.join(queue,'results',ticket.requestId+'.json');
 const result={version:queueVersion,requestId:ticket.requestId,ticketSha256:ticket.ticketSha256,status:'unknown',at:new Date().toISOString(),...old,dispatchId,dispatchSha256,selectedTarget:target,winnerRequestId:ticket.requestId,error:'private original unknown'};
 const originalResultSha256=terminal?await durableCreate(resultFile,result):sha(canonical(result));
 const attempt=path.join(packet,'publish-'+target.slice(0,12));await fs.mkdir(path.join(attempt,'preparation'),{recursive:true});
 await fs.writeFile(path.join(attempt,'preparation/PREPARING.json'),'private-original');
 const options={generation,dispatchId,dispatchSha256,originalResultSha256,selectedTarget:target,packet};
 const submit=()=>submitAbandonOnlyRequest(queue,options);
 const consume=(extra={})=>drainPreparationQueue(queue,{configSha256:generation.configSha256,bundleSha256:generation.bundleSha256,reconciliationBinding:generation,observe:()=>assert.fail('abandon-only must never fetch/observe'),prepare:()=>assert.fail('abandon-only must never prepare'),abandonment:{probeRotationLock:async()=>true},...extra});
 return {root,queue,packet,ticket,dispatch,attempt,resultFile,options,submit,consume};
}
test('one request abandons the old packet, preserves unknown bytes, exits without preparation, and repeats without waking',async t=>{
 const f=await fixture(t),before=await fs.readFile(f.resultFile),submitted=await f.submit();assert.equal(submitted.wakeRequired,true);
 const result=await f.consume();assert.equal(result.status,'abandoned');assert.equal(result.preparationPerformed,false);assert.deepEqual(await fs.readFile(f.resultFile),before);
 const inventory=await readPreparationQueueInventory(f.queue);assert.equal(inventory.tickets.length,1);assert.equal(inventory.abandonments.size,1);assert.equal(inventory.abandonments.get(f.dispatch.dispatchId).value.consumePermitted,false);
 const repeat=await f.submit();assert.equal(repeat.wakeRequired,false);assert.equal(repeat.result.status,'abandoned');
 await assert.rejects(submitAbandonOnlyRequest(f.queue,{...f.options,packet:path.join(f.root,'other')}));
});
test('crash after an exact abandoned append completes only the independent result',async t=>{
 const f=await fixture(t);await f.submit();await f.consume();const abandonmentFile=path.join(f.queue,'abandoned',f.dispatch.dispatchId+'.json'),before=await fs.readFile(abandonmentFile);
 await fs.unlink(path.join(f.queue,'reconciliation-results',f.dispatch.dispatchId+'.json'));
 assert.equal((await f.consume({abandonment:{probeRotationLock:()=>assert.fail('already-abandoned has no new write')}})).status,'already-abandoned');assert.deepEqual(await fs.readFile(abandonmentFile),before);
});
test('not due, publication markers, busy rotation, ordinary rejection, pending tickets and generation drift all refuse and exit',async t=>{
 for(const variant of ['not-due','publication','busy','ordinary','pending','generation']){
  const f=await fixture(t,variant==='not-due'?{deadlineUnixMs:Date.now()+3600000}:{});await f.submit();const extra={};
  if(variant==='publication')await fs.writeFile(path.join(f.attempt,'STARTED.json'),'private');
  if(variant==='busy')extra.abandonment={probeRotationLock:async()=>false};
  if(variant==='ordinary')extra.admitPreparation=()=>{throw Error('not ordinary');};
  if(variant==='pending')await submitPreparation(f.queue,{...old,origin:'manual'});
  if(variant==='generation')extra.reconciliationBinding={...generation,stateSha256:'9'.repeat(64)};
  assert.equal((await f.consume(extra)).status,'refused',variant);assert.equal((await f.submit()).wakeRequired,false,'refusal is never automatically retried');
  assert.equal((await readPreparationQueueInventory(f.queue)).abandonments.size,0);
 }
});
test('incomplete original results, malformed requests and multiple pending reconciliations block before work',async t=>{
 const missing=await fixture(t,{terminal:false});await assert.rejects(missing.submit());
 const malformed=await fixture(t);await malformed.submit();await fs.writeFile(path.join(malformed.queue,'reconciliation-requests','partial.tmp'),'{');await assert.rejects(malformed.consume(),/Malformed/);
 const multiple=await fixture(t);await multiple.submit();const otherId=randomUUID();await durableCreate(path.join(multiple.queue,'reconciliation-requests',otherId+'.json'),{...((await readReconciliationInventory(multiple.queue)).requests[0].value),dispatchId:otherId});await assert.rejects(multiple.consume(),/Multiple/);
});
test('short submission lock serializes pending admission and never holds the long queue lock',async t=>{
 const f=await fixture(t),release=await acquireQueueSubmissionLock(f.queue);
 try{await assert.rejects(submitPreparation(f.queue,{...old,origin:'manual'}),/submission is busy/);await f.submit();assert.equal((await f.consume()).status,'refused');}finally{await release();}
 assert.equal((await readPreparationQueueInventory(f.queue)).tickets.length,1);
});
test('a concurrent manual submit cannot enter between abandon-only pending=0 and the abandonment append',async t=>{
 const f=await fixture(t);await f.submit();let submissions=0;
 const result=await f.consume({abandonment:{probeRotationLock:async()=>{await assert.rejects(submitPreparation(f.queue,{...old,origin:'manual'}),/submission is busy/);submissions++;return true;}}});
 assert.equal(result.status,'abandoned');assert.equal(submissions,1);assert.equal((await readPreparationQueueInventory(f.queue)).tickets.length,1);
});
test('committed manual-only hook returns before missing config or any side effect',()=>{
 const result=spawnSync(process.execPath,['tools/main-prebuild-hook.mjs','event','Z:/missing-config.json','committed'],{input:'0'.repeat(40)+' '+target+' refs/remotes/origin/main\n',encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'');
});
test('disabled migration accepts exactly enabled=false; PS5 registration refuses state/instances drift',async()=>{
 const owned={version:'teruisi-main-preparation-task-v1',definition:{enabled:true,hidden:true}},preimage={enabled:false,hidden:true};assertDisabledPreparationPredecessor(preimage,owned);
 await assert.rejects(assertPreparationTask({...owned,definition:preimage}),/must remain enabled/);
 for(const actual of [{...preimage,hidden:false},{...preimage,enabled:true},{...preimage,extra:true}])assert.throws(()=>assertDisabledPreparationPredecessor(actual,owned));
 const source=await fs.readFile(new URL('../tools/main-prebuild-task.mjs',import.meta.url),'utf8'),literal=source.match(/await taskPowerShell\(taskPrelude\+projection\+`([^`]+)`/)[1];
 const guard=literal.slice(0,literal.indexOf('$d=$s.NewTask(0)'));
 const seam="$task=[pscustomobject]@{State=$v.state};$task|Add-Member ScriptMethod GetInstances {param($flags);if($v.instances -gt 0){1..$v.instances}};$folder=New-Object psobject;$folder|Add-Member ScriptMethod GetTask {param($name);return $task};function Projection($definition){return @{enabled=[bool]$v.actual.enabled;hidden=[bool]$v.actual.hidden}};";
 const payload={expectedDefinition:preimage,actual:preimage,expectedState:1,disabledRecovery:true,state:1,instances:0};assert.equal(await taskPowerShell(seam+guard+"'true'",payload),true);
 for(const change of [{state:3},{instances:1},{disabledRecovery:false},{actual:{...preimage,hidden:false}},{expectedState:3}])await assert.rejects(taskPowerShell(seam+guard+"'true'",{...payload,...change}));
 assert.equal(await taskPowerShell(seam+guard+"'true'",{...payload,expectedDefinition:owned.definition,actual:owned.definition,expectedState:3,disabledRecovery:false,state:3}),true);
});
test('R1b current pins bind exact final source bytes and preserve historical pins',async()=>{
 assert.equal(sha(await fs.readFile(new URL('../tools/publish-latest-main.mjs',import.meta.url))),retirementEntryPolicies.currentLatest);
 assert.equal(sha(await fs.readFile(new URL('../tools/install-main-prebuild.mjs',import.meta.url))),retirementEntryPolicies.currentInstaller);
 assert.ok(retirementEntryPolicies.previousCurrentLatest.includes('1fa234d5f3bdc5ba5fa028d91756d53a7ed79569e5a054270c73e280f22c67ac'));
 assert.ok(retirementEntryPolicies.previousCurrentInstaller.includes('a0865630915a5b60ec08db93939bdb3f50149fb48ecd37a40493ed7b4abca54c'));
});
