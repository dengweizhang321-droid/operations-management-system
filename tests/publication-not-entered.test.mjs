import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {durableCreate,submitPreparation,drainPreparationQueue,readPreparationQueueInventory,retiredPreparationPackets,preparationPacketSlot,writePublicationRetirement,preparedDispatchForPacket,ticketResult,isNotEnteredAttemptMember,publicationRetirementVersion,canonical,sha} from '../tools/main-prebuild-queue.mjs';
import {inspectNotEnteredPublication,retireNotEnteredPublication,probePublicationPreconditions,publicationProbeScript,publicationProbeVersion,assertPublicationPreconditions,reportPublicationPreconditions,describePreconditionFailures,deployReadyMain,evaluateForeignServiceChildren,foreignChildrenAdvice,scanMaintenanceLog,maintenanceLogWindowBytes,prepareLatestMain,prepareLatestMainOnce,drainLatestMainQueue,packetBaseName,preconditionFailures} from '../tools/publish-latest-main.mjs';
// S19: publication preflight and not-entered retirement. Everything runs against
// temp directories and stubs; the single real process is a read-only PowerShell
// 5.1 smoke of the probe script with checkDjango:false (never touches the live runtime).
const h=c=>c.repeat(64),a='a'.repeat(40),binding={configSha256:h('1'),bundleSha256:h('2')};
const live={mainCommit:'0'.repeat(40),head:{bindingSha256:h('3')},djangoManifestSha256:h('4'),chainStateSha256:h('5')};
const baseOf=target=>target.slice(0,12)+'-33333333-44444444',key=file=>path.resolve(file).toLowerCase();
const maintenanceId='e'.repeat(32),aclMessage='运行目录 ACL 规则数量不符合精确契约（root expected=3 actual=11）';
const owner={processId:41001,creationDate:'2026-10-24T01:00:00.000Z',sessionId:1,commandLineSha256:h('6'),executablePathSha256:h('7')};
const actor={processId:41002,creationDate:'2026-10-24T01:00:01.000Z',executablePath:'x',commandLine:'y'},rotationOwner={processId:41003,creationDate:'2026-10-24T01:00:02.000Z',executablePath:'x',commandLine:'y'};
const exists=async file=>{try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'publication-not-entered-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:50}));const packages=path.join(root,'packages'),runtime=path.join(root,'runtime');await fs.mkdir(packages);await fs.mkdir(path.join(runtime,'run'),{recursive:true});return {root,queue:path.join(root,'queue'),packages,runtime};}
const observer=f=>async({retiredPackets}={})=>({targetCommit:a,packet:preparationPacketSlot(f.packages,baseOf(a),retiredPackets),live:structuredClone(live)});
async function prepared(selected){
 const packet=selected.packet,request={mainCommit:selected.targetCommit,deployedCommit:selected.live.mainCommit,predecessorWorker:selected.live.head,predecessorDjangoSha256:selected.live.djangoManifestSha256,components:['worker']};
 const file=path.join(packet,'publish-'+selected.targetCommit.slice(0,12),'preparation/PREPARED.json');await fs.mkdir(path.dirname(file),{recursive:true});
 await fs.writeFile(path.join(packet,'main-release-request.json'),JSON.stringify(request));
 const bytes=JSON.stringify({version:'teruisi-main-preparation-v1',requestSha256:sha(JSON.stringify(request)),sourceIdentity:{commit:selected.targetCommit,tree:'6'.repeat(40)},workerPlan:{id:'private'},djangoPackage:null});
 await fs.writeFile(file,bytes);
 return {status:'prepared-only',mainCommit:selected.targetCommit,publicationPerformed:false,preparationFile:file,preparationSha256:sha(bytes)};
}
/** A prepared packet whose publication then failed while entering maintenance. */
async function failedEntry(t,{attemptFiles={}}={}){
 const f=await fixture(t),item=await submitPreparation(f.queue,{...binding,observedTarget:null,origin:'manual'});
 await drainPreparationQueue(f.queue,{...binding,observe:observer(f),prepare:prepared});
 const inventory=await readPreparationQueueInventory(f.queue),dispatchRead=inventory.dispatches[0],packet=dispatchRead.value.selection.packet;
 assert.equal(inventory.terminals.get(item.requestId).status,'prepared');
 const attempt=path.join(packet,'publish-'+a.slice(0,12));
 const files={'STARTED.json':{at:'2026-10-24T01:00:00.000Z',mainCommit:a,maintenanceId,publisherOwner:owner,predecessorChainStateSha256:live.chainStateSha256},
  'FAILED.json':{at:'2026-10-24T01:00:30.000Z',phase:'进入维护',mainCommit:a,automaticRetry:false,error:'Original maintenance entry did not complete; reconcile this attempt'},
  'maintenance-admission.json':{maintenanceId},'maintenance-first-FAILED.json':{maintenanceId,automaticRetry:false},
  'maintenance-first-actor.json':{maintenanceId,actor,rotationOwner},...attemptFiles};
 for(const [name,value] of Object.entries(files))await fs.writeFile(path.join(attempt,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
 const selection={packet,targetCommit:a,live:structuredClone(live)};
 return {...f,item,inventory,dispatchRead,packet,attempt,selection};
}
const okChecks={'Assert-RuntimeAclHardened':{ok:true},'Assert-DeployedApplication':{ok:true}};
const probeWith=(checks=okChecks,aliveIds=[])=>async(config,{actors=[]})=>({checks,actors:actors.map(item=>({processId:item.processId,alive:aliveIds.includes(item.processId)}))});
const aclFailure={...okChecks,'Assert-RuntimeAclHardened':{ok:false,message:aclMessage}};
const readyOk=async()=>({status:200,json:async()=>({ok:true,status:'ready'})});
const stubs=(f,over={})=>({inventory:f.inventory,probe:probeWith(aclFailure),probeRotation:async()=>true,fetchReady:readyOk,runtimeRoot:f.runtime,now:()=>new Date('2026-10-24T02:00:00.000Z'),readMaintenanceLog:async()=>({entered:null,ended:null}),...over});
const inspect=(f,over={},selection=f.selection)=>inspectNotEnteredPublication({},selection,stubs(f,over));

test('a bound not-entered record retires the packet, moves the slot to -r2 and keeps every original byte',async t=>{
 const f=await failedEntry(t),before=new Map();for(const name of await fs.readdir(f.attempt))if(name!=='preparation')before.set(name,await fs.readFile(path.join(f.attempt,name)));
 const result=await inspect(f);assert.equal(result.eligible,true);assert.deepEqual(result.failures,['Assert-RuntimeAclHardened：'+aclMessage]);
 assert.match(result.record.reason,/Assert-RuntimeAclHardened/);assert.match(result.record.reason,/HardenAcl/);
 assert.equal(result.record.version,publicationRetirementVersion);assert.equal(result.record.consumePermitted,false);assert.equal(result.record.basis.maintenanceId,maintenanceId);
 assert.equal(preparedDispatchForPacket(f.inventory,f.packet).value.dispatchId,f.dispatchRead.value.dispatchId);
 const written=await writePublicationRetirement(f.queue,result.record);assert.equal(path.basename(written.file),f.dispatchRead.value.dispatchId+'.json');
 const inventory=await readPreparationQueueInventory(f.queue);assert.equal(inventory.publicationRetirements.size,1);
 const retired=retiredPreparationPackets(inventory);assert.ok(retired.has(key(f.packet)));
 assert.equal(path.basename(preparationPacketSlot(f.packages,baseOf(a),retired)),baseOf(a)+'-r2');
 for(const [name,bytes] of before)assert.deepEqual(await fs.readFile(path.join(f.attempt,name)),bytes,name);
 assert.deepEqual((await fs.readdir(f.attempt)).sort(),[...before.keys(),'preparation'].sort(),'nothing forged or removed');
 assert.equal(await exists(path.join(f.queue,'abandoned')),false);
 await assert.rejects(writePublicationRetirement(f.queue,result.record),/already retired/);
});
test('a passing probe is still eligible and records no reason; retireNotEnteredPublication writes under the lock scope',async t=>{
 const f=await failedEntry(t),logs=[];
 const result=await inspect(f,{probe:probeWith(okChecks)});assert.equal(result.eligible,true);assert.equal(result.record.reason,null);assert.deepEqual(result.failures,[]);
 const config={stateDirectory:path.join(f.root,'state')};
 const queueLink=path.join(config.stateDirectory,'prebuild-queue-v2');await fs.mkdir(config.stateDirectory,{recursive:true});await fs.rename(f.queue,queueLink);
 const written=await retireNotEnteredPublication(config,f.selection,{retirementScope:undefined,log:line=>logs.push(line),inspect:(cfg,selection,options)=>inspectNotEnteredPublication(cfg,selection,stubs({...f,inventory:options.inventory,runtime:f.runtime},{inventory:options.inventory,probe:probeWith(aclFailure)}))});
 assert.equal(written.status,'retired');assert.ok(await exists(written.file));assert.match(logs.join('\n'),/已核实线上系统未被改动/);assert.match(logs.join('\n'),/Assert-RuntimeAclHardened/);
 assert.equal((await readPreparationQueueInventory(queueLink)).publicationRetirements.size,1);
});
test('no STARTED record (or no attempt directory) gives null',async t=>{
 const f=await failedEntry(t);await fs.rm(path.join(f.attempt,'STARTED.json'));assert.equal(await inspect(f),null);
 const g=await failedEntry(t);await fs.rm(g.attempt,{recursive:true});assert.equal(await inspect(g),null);
});
const refusals={
 'native-complete member':{prep:{attemptFiles:{'maintenance-first-native-complete.json':{}}},reason:/维护开始后/},
 'stopped old frontend member':{prep:{attemptFiles:{'停止旧前端-started.json':{}}},reason:/维护开始后/},
 'a success record':{prep:{attemptFiles:{'SUCCESS.json':{}}},reason:/成功记录/},
 'missing required evidence':{mutate:async f=>fs.rm(path.join(f.attempt,'maintenance-admission.json')),reason:/缺少失败证据/},
 'other phase':{mutate:async f=>fs.writeFile(path.join(f.attempt,'FAILED.json'),JSON.stringify({phase:'停止旧前端',automaticRetry:false,mainCommit:a})),reason:/不是进入维护/},
 'retryable failure':{mutate:async f=>fs.writeFile(path.join(f.attempt,'FAILED.json'),JSON.stringify({phase:'进入维护',automaticRetry:true,mainCommit:a})),reason:/不是终态/},
 'maintenance id mismatch':{mutate:async f=>fs.writeFile(path.join(f.attempt,'maintenance-admission.json'),JSON.stringify({maintenanceId:'d'.repeat(32)})),reason:/维护编号不一致/},
 'live version moved on':{selection:f=>({...f.selection,live:{...f.selection.live,mainCommit:'1'.repeat(40)}}),reason:/前一版本/},
 'chain state changed':{selection:f=>({...f.selection,live:{...f.selection.live,chainStateSha256:h('9')}}),reason:/前端版本链已变化/},
 'worker head changed':{selection:f=>({...f.selection,live:{...f.selection.live,head:{bindingSha256:h('8')}}}),reason:/前端版本已变化/},
 'django changed':{selection:f=>({...f.selection,live:{...f.selection.live,djangoManifestSha256:h('8')}}),reason:/后台版本已变化/},
 'rotation lock busy':{over:{probeRotation:async()=>false},reason:/轮换锁/},
 'publisher still alive':{over:f=>({probe:probeWith(aclFailure,[owner.processId])}),reason:/仍在运行/},
 'recorded actor alive':{over:f=>({probe:probeWith(aclFailure,[actor.processId])}),reason:/仍在运行/},
 'rotation owner alive':{over:f=>({probe:probeWith(aclFailure,[rotationOwner.processId])}),reason:/仍在运行/},
 'health not ready (503)':{over:{fetchReady:async()=>({status:503,json:async()=>({})})},reason:/未就绪/},
 'health not ok':{over:{fetchReady:async()=>({status:200,json:async()=>({ok:false,status:'starting'})})},reason:/未就绪/},
 'health unreachable':{over:{fetchReady:async()=>{throw Error('ECONNREFUSED');}},reason:/未就绪/},
 'maintenance marker':{mutate:async f=>fs.writeFile(path.join(f.runtime,'run','system-maintenance.json'),'{}'),reason:/维护或排空/},
 'drain marker':{mutate:async f=>fs.writeFile(path.join(f.runtime,'run','automation-drain.json'),'{}'),reason:/维护或排空/},
 'owner identity missing':{mutate:async f=>{const file=path.join(f.attempt,'STARTED.json'),value=JSON.parse(await fs.readFile(file,'utf8'));delete value.publisherOwner;await fs.writeFile(file,JSON.stringify(value));},reason:/进程身份/},
 'exit code 0':{prep:{attemptFiles:{'进入维护-started.json':{},'进入维护-process.json':{processEvidence:{exitCode:0,treeCleanupPending:false}}}},reason:/非零退出码/},
 'started without process record':{prep:{attemptFiles:{'进入维护-started.json':{}}},reason:/没有结束记录/},
 'process exit code not an integer':{prep:{attemptFiles:{'进入维护-started.json':{},'进入维护-process.json':{processEvidence:{exitCode:null,treeCleanupPending:false}}}},reason:/非零退出码/},
 'tree cleanup pending':{prep:{attemptFiles:{'进入维护-started.json':{},'进入维护-process.json':{processEvidence:{exitCode:1,treeCleanupPending:true}}}},reason:/清理未完成/},
 'tree cleanup unknown':{prep:{attemptFiles:{'进入维护-started.json':{},'进入维护-process.json':{processEvidence:{exitCode:1}}}},reason:/清理未完成/}, 'unprepared packet':{selection:f=>({...f.selection,packet:path.join(f.packages,'elsewhere')}),skip:true}};
for(const [name,spec] of Object.entries(refusals)){
 if(spec.skip)continue;
 test('refuses to retire: '+name,async t=>{
  const f=await failedEntry(t,spec.prep);if(spec.mutate)await spec.mutate(f);
  const over=typeof spec.over==='function'?spec.over(f):spec.over,result=await inspect(f,over,spec.selection?spec.selection(f):f.selection);
  assert.equal(result.eligible,false);assert.match(result.reasons.join('；'),spec.reason);assert.equal(result.record,undefined);
  assert.equal(await exists(path.join(f.queue,'publication-retired')),false);
 });
}
test('a record is refused before any write when it is not bound to a prepared packet and the live predecessor',async t=>{
 const f=await failedEntry(t),good=(await inspect(f)).record;
 const cases={
  'consumePermitted':[{...good,consumePermitted:true},/never consumed/],
  'extra key':[{...good,extra:1},/schema/],
  'wrong predecessor':[{...good,basis:{...good.basis,liveMainCommit:'1'.repeat(40)}},/predecessor differs/],
  'wrong chain state':[{...good,basis:{...good.basis,chainStateSha256:h('9')}},/Expected|equal/],
  'wrong worker binding':[{...good,basis:{...good.basis,workerBindingSha256:h('9')}},/Expected|equal/],
  'wrong django manifest':[{...good,basis:{...good.basis,djangoManifestSha256:h('9')}},/Expected|equal/],
  'unproven health':[{...good,basis:{...good.basis,healthReady:false}},/not proven/],
  'unknown phase':[{...good,basis:{...good.basis,phase:'停止旧前端'}},/ok|assert/i],
  'success member':[{...good,basis:{...good.basis,attemptMembers:[...good.basis.attemptMembers,'SUCCESS.json'].sort()}},/ok|assert/i],
  'unsorted members':[{...good,basis:{...good.basis,attemptMembers:[...good.basis.attemptMembers].reverse()}},/ok|assert/i],
  'foreign member':[{...good,basis:{...good.basis,attemptMembers:[...good.basis.attemptMembers,'退出维护-started.json'].sort()}},/ok|assert/i],
  'evidence changed':[{...good,evidence:{...good.evidence,'STARTED.json':h('9')}},/evidence changed/],
  'unknown evidence':[{...good,evidence:{...good.evidence,'SUCCESS.json':h('9')}},/Unknown publication retirement evidence/],
  'huge reason':[{...good,reason:'x'.repeat(1601)},/reason invalid/],
  'attempt outside packet':[{...good,attempt:path.join(f.packages,'other','publish-'+a.slice(0,12))},/outside its packet/],
  'unknown dispatch':[{...good,dispatchId:randomUUID()},/names no dispatch/],
  'wrong dispatch digest':[{...good,dispatchSha256:h('9')},/dispatch changed/]};
 for(const [name,[record,pattern]] of Object.entries(cases)){await assert.rejects(writePublicationRetirement(f.queue,record),pattern,name);assert.equal(await exists(path.join(f.queue,'publication-retired')),false,name);}
 assert.equal(isNotEnteredAttemptMember('SUCCESS.json'),false);assert.equal(isNotEnteredAttemptMember('maintenance-preflight-Ab12Cd'),true);assert.equal(isNotEnteredAttemptMember('maintenance-preflight-x'),false);
});
test('a dispatch whose terminal is not prepared cannot be retired',async t=>{
 const f=await fixture(t);await submitPreparation(f.queue,{...binding,observedTarget:null,origin:'manual'});
 await drainPreparationQueue(f.queue,{...binding,observe:observer(f),prepare:async()=>{const error=Error('rejected');error.preparationTerminal={kind:'rejected-before-native',stage:'freeze-source'};throw error;}});
 const inventory=await readPreparationQueueInventory(f.queue),dispatchRead=inventory.dispatches[0];
 const g=await failedEntry(t),record=(await inspect(g)).record;
 await assert.rejects(writePublicationRetirement(f.queue,{...record,dispatchId:dispatchRead.value.dispatchId,dispatchSha256:dispatchRead.sha256,packet:dispatchRead.value.selection.packet,attempt:path.join(dispatchRead.value.selection.packet,'publish-'+a.slice(0,12))}),/Only a prepared packet/);
 assert.equal(preparedDispatchForPacket(inventory,dispatchRead.value.selection.packet),null);
});
test('stored records bind only queue-internal data: a later change to the attempt neither breaks the inventory nor un-retires the packet',async t=>{
 const f=await failedEntry(t),record=(await inspect(f)).record,written=await writePublicationRetirement(f.queue,record),original=await fs.readFile(written.file);
 const stillRetired=async label=>{const inventory=await readPreparationQueueInventory(f.queue);assert.equal(inventory.publicationRetirements.size,1,label);assert.ok(retiredPreparationPackets(inventory).has(key(f.packet)),label);};
 await stillRetired('initial');
 for(const name of Object.keys(record.evidence)){const file=path.join(f.attempt,name),bytes=await fs.readFile(file);await fs.writeFile(file,Buffer.concat([bytes,Buffer.from(' ')]));await stillRetired('changed '+name);await fs.rm(file);await stillRetired('deleted '+name);await fs.writeFile(file,bytes);}
 await fs.writeFile(path.join(f.attempt,'SUCCESS.json'),'{}');await stillRetired('success added');
 for(const name of await fs.readdir(f.attempt))if(name!=='preparation')await fs.rm(path.join(f.attempt,name),{recursive:true});await stillRetired('all publication evidence removed');
 for(const [value,pattern] of [[{...JSON.parse(original),consumePermitted:true},/never consumed/],[{...JSON.parse(original),basis:{...JSON.parse(original).basis,liveMainCommit:'1'.repeat(40)}},/predecessor differs/],[{...JSON.parse(original),extra:true},/schema/]]){await fs.writeFile(written.file,canonical(value));await assert.rejects(readPreparationQueueInventory(f.queue),pattern);}
 await fs.writeFile(written.file,original.toString('utf8').trimEnd());await assert.rejects(readPreparationQueueInventory(f.queue),/Noncanonical/);
 await fs.writeFile(written.file,original);await stillRetired('restored');
 const orphan=path.join(f.queue,'publication-retired',randomUUID()+'.json');await fs.writeFile(orphan,original);await assert.rejects(readPreparationQueueInventory(f.queue),/Orphan publication retirement/);await fs.rm(orphan);
 await stillRetired('orphan removed');
});
test('writing a retirement still verifies the attempt bytes and refuses a success record',async t=>{
 const f=await failedEntry(t),record=(await inspect(f)).record;
 await fs.writeFile(path.join(f.attempt,'SUCCESS.json'),'{}');await assert.rejects(writePublicationRetirement(f.queue,record),/success record/);await fs.rm(path.join(f.attempt,'SUCCESS.json'));
 const file=path.join(f.attempt,'FAILED.json'),bytes=await fs.readFile(file);await fs.writeFile(file,Buffer.concat([bytes,Buffer.from(' ')]));await assert.rejects(writePublicationRetirement(f.queue,record),/evidence changed/);
 assert.equal(await exists(path.join(f.queue,'publication-retired')),false);await fs.writeFile(file,bytes);await writePublicationRetirement(f.queue,record);
});
test('preparedDispatchForPacket accepts duplicate prepared dispatches with identical selections (earliest wins) and rejects differing ones',async()=>{
 const packet=path.join(os.tmpdir(),'packet-x'),selection={targetCommit:a,packet,live:structuredClone(live)};
 const make=(dispatchId,dispatchedAt,over={})=>({value:{dispatchId,requestId:'req-'+dispatchId,dispatchedAt,selection:structuredClone({...selection,...over})},sha256:h('a')});
 const early=make('b-late-id','2026-10-24T01:00:00.000Z'),tie=make('a-early-id','2026-10-24T01:00:00.000Z'),later=make('0-first-id','2026-10-24T03:00:00.000Z');
 const inventory=(...reads)=>({dispatches:reads,terminals:new Map(reads.map(read=>[read.value.requestId,{status:'prepared'}]))});
 assert.equal(preparedDispatchForPacket(inventory(later,early),packet).value.dispatchId,'b-late-id','earliest dispatchedAt');
 assert.equal(preparedDispatchForPacket(inventory(early,tie,later),packet).value.dispatchId,'a-early-id','tie goes to the smaller dispatchId');
 assert.equal(preparedDispatchForPacket(inventory(early,make('other','2026-10-24T02:00:00.000Z',{targetCommit:'b'.repeat(40)})),packet),null,'differing selections');
 assert.equal(preparedDispatchForPacket(inventory(early,make('live-moved','2026-10-24T02:00:00.000Z',{live:{...live,mainCommit:'1'.repeat(40)}})),packet),null);
 const mixed=inventory(early,tie);mixed.terminals.set(tie.value.requestId,{status:'failed'});assert.equal(preparedDispatchForPacket(mixed,packet).value.dispatchId,'b-late-id','only prepared dispatches count');
 assert.equal(preparedDispatchForPacket(inventory(),packet),null);assert.equal(preparedDispatchForPacket(inventory(early),path.join(os.tmpdir(),'elsewhere')),null);
});
test('a failed maintenance process record is required, non-zero and fully cleaned up; its logs are hashed as evidence',async t=>{
 const processRecord=exitCode=>({processEvidence:{exitCode,treeCleanupPending:false}});
 const f=await failedEntry(t,{attemptFiles:{'进入维护-started.json':{at:'x'},'进入维护-process.json':processRecord(1),'进入维护.stdout.log':'out','进入维护.stderr.log':'err'}});
 const result=await inspect(f);assert.equal(result.eligible,true);
 for(const name of ['进入维护-process.json','进入维护.stdout.log','进入维护.stderr.log'])assert.equal(result.record.evidence[name],sha(await fs.readFile(path.join(f.attempt,name))),name);
 assert.equal(result.record.evidence['进入维护-started.json'],undefined,'only the listed evidence members are hashed');
 await writePublicationRetirement(f.queue,result.record);
});test('a failing preflight throws before the publisher runs and before STARTED exists; a passing one runs it once',async t=>{
 const f=await readinessFixture(t);await fs.writeFile(f.file,JSON.stringify(f.receipt));const order=[];
 const failing=()=>assertPublicationPreconditions({}, {probe:probeWith(aclFailure),runtimeRoot:f.root,log:line=>order.push(line)});
 await assert.rejects(deployReadyMain(f.prepared,{git:f.git,progress:f.progress,preflight:failing,run:async()=>{order.push('run');}}),error=>{assert.match(error.message,/Assert-RuntimeAclHardened/);assert.match(error.message,/HardenAcl/);assert.match(error.message,/发布包保持可用/);return true;});
 assert.ok(!order.includes('run'));assert.equal(await exists(path.join(f.attempt,'STARTED.json')),false);
 const original={status:'already-current',mainCommit:f.prepared.targetCommit,publicationPerformed:false};let calls=0;
 const result=await deployReadyMain(f.prepared,{git:f.git,progress:f.progress,preflight:()=>assertPublicationPreconditions({}, {probe:probeWith(okChecks),runtimeRoot:f.root,log:line=>order.push(line)}),run:async()=>{calls++;order.push('run');return original;}});
 assert.equal(result,original);assert.equal(calls,1);assert.equal(order.at(-1),'run');assert.match(order.join('\n'),/发布前检查通过/);
});
test('an unready package never reaches the preflight, and the default preflight changes nothing',async t=>{
 const f=await readinessFixture(t);let preflight=0,calls=0;
 const result=await deployReadyMain(f.prepared,{git:f.git,progress:f.progress,preflight:async()=>{preflight++;},run:async()=>{calls++;}});
 assert.equal(result.status,'not-ready');assert.equal(preflight,0);assert.equal(calls,0);
 await fs.writeFile(f.file,JSON.stringify(f.receipt));await deployReadyMain(f.prepared,{git:f.git,progress:f.progress,run:async()=>{calls++;return {status:'already-current'};}});assert.equal(calls,1);
});
test('maintenance markers refuse the preflight without calling the probe; report is non-fatal',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.runtime,'run','system-maintenance.json'),'{}');let probes=0;
 await assert.rejects(assertPublicationPreconditions({}, {probe:async()=>{probes++;return {checks:okChecks,actors:[]};},runtimeRoot:f.runtime}),/维护或排空/);assert.equal(probes,0);
 const logs=[];assert.equal(await reportPublicationPreconditions({}, {probe:probeWith(aclFailure),runtimeRoot:path.join(f.root,'none'),log:line=>logs.push(line)}),false);
 assert.match(logs.join('\n'),/现在发布会被拒绝/);assert.match(logs.join('\n'),/HardenAcl/);
 assert.equal(await reportPublicationPreconditions({}, {probe:probeWith(okChecks),runtimeRoot:path.join(f.root,'none'),log:()=>{}}),true);
 assert.equal(describePreconditionFailures(['Assert-DeployedApplication：x']).includes('HardenAcl'),false);
});

const jsonLine=value=>'noise before\n'+JSON.stringify(value)+'\n';
test('probePublicationPreconditions parses the probe line and rejects malformed results',async t=>{
 const good={version:publicationProbeVersion,checks:okChecks,actors:[{processId:7,alive:false}],snapshot:{roots:[],processes:[]}};let script;
 const probed=await probePublicationPreconditions({}, {actors:[{processId:7,creationDate:'2026-10-24T01:00:00.000Z'}],run:async(config,text)=>{script=text;return jsonLine(good);}});
 assert.deepEqual(probed,{checks:{...okChecks,'Assert-NoForeignServiceChildren':{ok:true}},actors:good.actors});const input=JSON.parse(Buffer.from(/FromBase64String\('([^']+)'\)/.exec(script)[1],'base64').toString('utf8'));assert.deepEqual(input.checks,['Assert-RuntimeAclHardened','Assert-DeployedApplication']);assert.deepEqual(input.actors,[{processId:7,creationDate:'2026-10-24T01:00:00.000Z'}]);assert.match(script,/TERUISI_DJANGO_SERVICE_LIBRARY_ONLY/);assert.doesNotMatch(script+JSON.stringify(input),/HardenAcl|-Action/);
 // A single actor serialised by Windows PowerShell as an object (not an array) is accepted.
 assert.equal((await probePublicationPreconditions({}, {actors:[{processId:7,creationDate:'2026-10-24T01:00:00.000Z'}],run:async()=>jsonLine({...good,actors:good.actors[0]})})).actors.length,1);
 const bad={'wrong version':[{...good,version:'old'},/版本无效/],'missing check':[{...good,checks:{'Assert-RuntimeAclHardened':{ok:true}}},/缺少/],'non boolean check':[{...good,checks:{...okChecks,'Assert-DeployedApplication':{ok:'yes'}}},/缺少/],
  'actor count':[{...good,actors:[]},/数量不符/],'actor id':[{...good,actors:[{processId:8,alive:false}]},/无效/],'actor alive flag':[{...good,actors:[{processId:7,alive:'no'}]},/无效/]};
 for(const [name,[value,pattern]] of Object.entries(bad))await assert.rejects(probePublicationPreconditions({}, {actors:[{processId:7,creationDate:'2026-10-24T01:00:00.000Z'}],run:async()=>jsonLine(value)}),pattern,name);
 await assert.rejects(probePublicationPreconditions({}, {run:async()=>'no json here'}),/没有返回结果/);
 await assert.rejects(probePublicationPreconditions({}, {actors:[{processId:-1,creationDate:'2026-10-24T01:00:00.000Z'}],run:async()=>assert.fail('invalid identity never reaches PowerShell')}),/进程身份无效/);
 // checkDjango:false does not demand the Django checks.
 assert.deepEqual((await probePublicationPreconditions({}, {checkDjango:false,run:async()=>jsonLine({version:publicationProbeVersion,checks:{},actors:[]})})).checks,{});
});

const powershell5='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const runReal=async(config,script)=>execFileSync(powershell5,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:120000});
test('real Windows PowerShell 5.1 smoke: actor liveness without touching the Django runtime',{skip:process.platform!=='win32'||!await exists(powershell5)},async()=>{
 let creation=null;
 try{creation=(await runReal({}, "[Console]::Out.WriteLine((Get-CimInstance Win32_Process -Filter 'ProcessId="+process.pid+"').CreationDate.ToUniversalTime().ToString('o'))")).trim();}catch{}
 const dead=2147483000,actors=[{processId:dead,creationDate:'2026-10-24T01:00:00.000Z'}];
 if(creation&&Number.isFinite(Date.parse(creation)))actors.unshift({processId:process.pid,creationDate:creation});
 const probed=await probePublicationPreconditions({}, {actors,checkDjango:false,run:runReal});
 assert.deepEqual(probed.checks,{});assert.equal(probed.actors.length,actors.length);
 assert.equal(probed.actors.at(-1).alive,false);assert.equal(probed.actors.at(-1).processId,dead);
 if(creation&&Number.isFinite(Date.parse(creation))){assert.equal(probed.actors[0].processId,process.pid);assert.equal(probed.actors[0].alive,true);
  // Same PID with a different creation time is a recycled PID, not the recorded actor.
  const recycled=await probePublicationPreconditions({}, {actors:[{processId:process.pid,creationDate:'2001-01-01T00:00:00.000Z'}],checkDjango:false,run:runReal});assert.equal(recycled.actors[0].alive,false);}
 assert.match(publicationProbeScript({actors:[],checkDjango:false,controller:'x',runtimeRoot:'y',checks:[]}),/checkDjango|pgDjango/);
});

test('the probe isolates the dot-sourced controller and round-trips a Chinese failure message (stub controller, real PowerShell 5.1)',{skip:process.platform!=='win32'||!await exists(powershell5)},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'probe-stub-controller-'));t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:50}));
 const controller=path.join(dir,'stub controller.ps1'),runtimeRoot=path.join(dir,'runtime root');await fs.mkdir(runtimeRoot);
 const stub=['param([string]$RuntimeRoot = "unset")',
  // Top-level variables named like the probe's own; they must not leak into the probe.
  "$pgResult = 'hijacked'","$pgInput = 'hijacked'","$pgChecks = 'hijacked'","$pgController = 'hijacked'","$pgRoot = 'hijacked'","$pgDjango = $false","$pgRun = 'hijacked'","$pgFound = 'hijacked'","$pgKey = 'hijacked'","$__pgOut = 'hijacked'","$__pgName = 'hijacked'","$ErrorActionPreference = 'Continue'",
  "Write-Output 'noise from the controller'",
  "function Assert-RuntimeAclHardened { throw '"+aclMessage+"' }",
  "function Assert-DeployedApplication { if ($RuntimeRoot -ne '"+runtimeRoot.replace(/'/g,"''")+"') { throw 'runtime root was not passed' } }"].join('\r\n')+'\r\n';
 await fs.writeFile(controller,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(stub,'utf8')]));
 const probed=await probePublicationPreconditions({}, {actors:[],checkDjango:true,run:runReal,controller,runtimeRoot,runDirectory:path.join(dir,'run'),workerReceipt:path.join(dir,'worker-process.json')});
 assert.deepEqual(probed.actors,[]);
 assert.deepEqual(probed.checks,{'Assert-RuntimeAclHardened':{ok:false,message:aclMessage},'Assert-DeployedApplication':{ok:true},'Assert-NoForeignServiceChildren':{ok:true}});
 assert.deepEqual(preconditionFailures(probed),['Assert-RuntimeAclHardened：'+aclMessage]);
 assert.match(describePreconditionFailures(preconditionFailures(probed)),/HardenAcl/);
});

async function consumerFixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'publication-consumer-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:50}));
 const repository=path.join(root,'repo'),remote=path.join(root,'remote.git');await fs.mkdir(repository);
 const git=(cwd,args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
 execFileSync('git',['init','--bare','--quiet',remote]);git(repository,['init','--quiet','--initial-branch=main']);git(repository,['config','user.name','fixture']);git(repository,['config','user.email','fixture@example.invalid']);
 await fs.mkdir(path.join(repository,'app'));await fs.writeFile(path.join(repository,'app/view.tsx'),'old');const lock=Buffer.from('{}\n');await fs.writeFile(path.join(repository,'package-lock.json'),lock);await fs.writeFile(path.join(repository,'.gitignore'),'node_modules/\n');
 git(repository,['add','.']);git(repository,['commit','--quiet','-m','old online']);const old=git(repository,['rev-parse','HEAD']);git(repository,['remote','add','origin',remote]);git(repository,['push','--quiet','origin','main']);
 await fs.writeFile(path.join(repository,'app/view.tsx'),'new merged task');git(repository,['add','.']);git(repository,['commit','--quiet','-m','new merged task']);const latest=git(repository,['rev-parse','HEAD']);git(repository,['push','--quiet','origin','main']);
 const stateDirectory=path.join(root,'state'),dependenciesDirectory=path.join(root,'dependencies');await fs.mkdir(stateDirectory);await fs.mkdir(dependenciesDirectory);
 const liveRecord={mainCommit:old,source:repository,head:{releaseId:'old',bindingSha256:'1'.repeat(64),manifestSha256:'2'.repeat(64)},djangoManifestSha256:'3'.repeat(64),chainStateSha256:'5'.repeat(64)};
 const config={repository,stateDirectory,releaseDirectory:path.join(root,'packets'),dependenciesDirectory,cacheLockSha256:createHash('sha256').update(lock).digest('hex'),pwshDirectory:'fixture-host',pwshSha256:'4'.repeat(64),npmCacheDirectory:'fixture-cache'};
 return {root,git,old,latest,live:liveRecord,config};
}
// The consumer path: a hook ticket or a prepare run after a publication failed while entering maintenance.
async function consumerRun(t,{rotationFree=true,readMaintenanceLog=async()=>({entered:null,ended:null})}={}){
 let freeNow=rotationFree;const probeRotation=async()=>freeNow;
 const f=await consumerFixture(t),binding={config:f.config,state:{configSha256:'6'.repeat(64),bundleSha256:'7'.repeat(64)}};
 const directory=path.join(f.config.stateDirectory,'prebuild-queue-v2'),submit=()=>submitPreparation(directory,{origin:'hook',observedTarget:f.latest,...binding.state});
 const packets=[],used=[];let runs=0;
 const runtime=path.join(f.root,'runtime');await fs.mkdir(path.join(runtime,'run'),{recursive:true});
 const options={binding,assertGeneration:async()=>{},assertConsumerIdentity:async()=>{},admit:async()=>{},admitSelected:async()=>{},once:prepareLatestMainOnce,
  observe:async(config,{retiredPackets})=>{const packet=preparationPacketSlot(config.releaseDirectory,packetBaseName(f.latest,f.live),retiredPackets);packets.push(path.basename(packet));return {targetCommit:f.latest,packet,live:f.live};},
  // Real proof logic with stubbed live facts; the real retirement write under the queue lock.
  retireNotEntered:(config,selection,opts)=>retireNotEnteredPublication(config,selection,{...opts,inspect:(cfg,sel,o)=>inspectNotEnteredPublication(cfg,sel,{...o,probe:probeWith(aclFailure),probeRotation,fetchReady:readyOk,runtimeRoot:runtime,readMaintenanceLog})}),
  run:async(source)=>{runs++;const packet=path.dirname(source);used.push(path.basename(packet));const preparation=path.join(packet,'publish-'+f.latest.slice(0,12),'preparation');await fs.mkdir(preparation,{recursive:true});const preparationFile=path.join(preparation,'PREPARED.json');
   await fs.writeFile(preparationFile,JSON.stringify({version:'teruisi-main-preparation-v1',requestSha256:createHash('sha256').update(JSON.stringify(JSON.parse(await fs.readFile(path.join(packet,'main-release-request.json'),'utf8')))).digest('hex'),sourceIdentity:{commit:f.latest,tree:f.git(source,['rev-parse','HEAD^{tree}'])},workerPlan:{id:'private-native-fixture'},djangoPackage:null}));
   return {status:'prepared-only',mainCommit:f.latest,publicationPerformed:false,preparationFile};}};
 const ticket=async()=>{const item=await submit();await drainLatestMainQueue('unused',options);return ticketResult(directory,item.requestId,item.ticketSha256);};
 // 1. an ordinary preparation, then the native publisher fails while entering maintenance
 const first=await ticket();assert.equal(first.status,'prepared');
 const inventory=await readPreparationQueueInventory(directory),packet=inventory.dispatches[0].value.selection.packet,attempt=path.join(packet,'publish-'+f.latest.slice(0,12));
 const evidence={'STARTED.json':{at:new Date().toISOString(),mainCommit:f.latest,maintenanceId,publisherOwner:owner,predecessorChainStateSha256:f.live.chainStateSha256},'FAILED.json':{phase:'进入维护',automaticRetry:false,mainCommit:f.latest},
  'maintenance-admission.json':{maintenanceId},'maintenance-first-FAILED.json':{maintenanceId,automaticRetry:false},'maintenance-first-actor.json':{maintenanceId,actor,rotationOwner}};
 for(const [name,value] of Object.entries(evidence))await fs.writeFile(path.join(attempt,name),JSON.stringify(value,null,2)+'\n');
 const before=new Map();for(const name of await fs.readdir(attempt))if(name!=='preparation')before.set(name,await fs.readFile(path.join(attempt,name)));
 return {f,directory,packet,attempt,before,packets,used,ticket,setRotationFree:value=>{freeNow=value;},runs:()=>runs};
}
test('consumer: a provably not-entered publication retires its packet and the same target prepares in -r2; nothing is rewritten',async t=>{
 const c=await consumerRun(t),runsBefore=c.runs();
 const second=await c.ticket();
 assert.equal(second.status,'prepared');assert.equal(c.used.at(-1),packetBaseName(c.f.latest,c.f.live)+'-r2');assert.equal(c.runs(),runsBefore+1);
 const inventory=await readPreparationQueueInventory(c.directory);
 assert.equal(inventory.publicationRetirements.size,1);assert.ok(retiredPreparationPackets(inventory).has(key(c.packet)));
 assert.equal([...inventory.terminals.values()].filter(terminal=>['unknown','blocked','failed'].includes(terminal.status)).length,0,'no unknown, blocked or failed terminal is written');
 for(const [name,bytes] of c.before)assert.deepEqual(await fs.readFile(path.join(c.attempt,name)),bytes,name);
 assert.equal(await exists(path.join(c.attempt,'SUCCESS.json')),false);
 const third=await c.ticket();assert.equal(third.status,'prepared');assert.equal(c.packets.at(-1),packetBaseName(c.f.latest,c.f.live)+'-r2','the new slot is reused, not retired again');
});
test('consumer: a refused proof defers the ticket before any dispatch (failed, no dispatch, packet not retired); a later ticket retires and prepares once the proof passes',async t=>{
 const c=await consumerRun(t,{rotationFree:false}),dispatchesBefore=(await fs.readdir(path.join(c.directory,'dispatches'))).sort(),runsBefore=c.runs();
 const second=await c.ticket();
 assert.equal(second.status,'failed');assert.equal(second.preparationTerminal,undefined);assert.equal(second.dispatchId,undefined);
 assert.match(second.error,/上一次发布有开始记录，但现在不能证明系统未被改动（.*轮换锁.*）；本次未准备，原记录保留，稍后重试或交 AI 排查/);
 assert.deepEqual((await fs.readdir(path.join(c.directory,'dispatches'))).sort(),dispatchesBefore,'no dispatch file is created for the deferred ticket');
 assert.equal(c.runs(),runsBefore);assert.ok(!c.used.some(name=>name.endsWith('-r2')));
 const inventory=await readPreparationQueueInventory(c.directory);assert.equal(inventory.publicationRetirements.size,0);assert.equal(retiredPreparationPackets(inventory).has(key(c.packet)),false);
 for(const [name,bytes] of c.before)assert.deepEqual(await fs.readFile(path.join(c.attempt,name)),bytes,name);
 // The queue is not blocked: once the proof passes the next ticket retires the packet and prepares the same target in -r2.
 c.setRotationFree(true);const third=await c.ticket();
 assert.equal(third.status,'prepared');assert.equal(c.used.at(-1),packetBaseName(c.f.latest,c.f.live)+'-r2');
 assert.equal((await readPreparationQueueInventory(c.directory)).publicationRetirements.size,1);
 for(const [name,bytes] of c.before)assert.deepEqual(await fs.readFile(path.join(c.attempt,name)),bytes,name);
});
test('retireNotEnteredPublication reports none, refused and retired distinctly',async t=>{
 const f=await failedEntry(t),config={stateDirectory:path.join(f.root,'state')};await fs.mkdir(config.stateDirectory,{recursive:true});
 const queueLink=path.join(config.stateDirectory,'prebuild-queue-v2');await fs.rename(f.queue,queueLink);
 const via=over=>retireNotEnteredPublication(config,f.selection,{log:()=>{},inspect:(cfg,selection,o)=>inspectNotEnteredPublication(cfg,selection,stubs({...f,runtime:f.runtime},{inventory:o.inventory,...over}))});
 assert.deepEqual(await retireNotEnteredPublication({stateDirectory:path.join(f.root,'empty')},f.selection,{}),{status:'none'});
 await fs.rm(path.join(f.attempt,'STARTED.json'));const none=await via({});assert.deepEqual(none,{status:'none'});
 await fs.writeFile(path.join(f.attempt,'STARTED.json'),JSON.stringify({at:'2026-10-24T01:00:00.000Z',mainCommit:a,maintenanceId,publisherOwner:owner,predecessorChainStateSha256:live.chainStateSha256}));
 const refused=await via({probeRotation:async()=>false});assert.equal(refused.status,'refused');assert.match(refused.reasons.join(),/轮换锁/);assert.equal(refused.attempt,f.attempt);assert.equal(await exists(path.join(queueLink,'publication-retired')),false);
 const retired=await via({});assert.equal(retired.status,'retired');assert.ok(await exists(retired.file));assert.match(retired.sha256,/^[a-f0-9]{64}$/);
});
async function readinessFixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'publication-preflight-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const targetCommit='a'.repeat(40),tree='b'.repeat(40),request={mainCommit:targetCommit,components:['worker','django'],migrate:false};
 const prepared={packet:root,source:path.join(root,'source'),targetCommit,request};
 const attempt=path.join(root,'publish-'+targetCommit.slice(0,12)),preparation=path.join(attempt,'preparation');await fs.mkdir(preparation,{recursive:true});
 const receipt={version:'teruisi-main-preparation-v1',requestSha256:createHash('sha256').update(JSON.stringify(request)).digest('hex'),sourceIdentity:{commit:targetCommit,tree}};
 const file=path.join(preparation,'PREPARED.json'),logs=[];
 const git=async(source,args)=>{assert.equal(source,prepared.source);if(args[0]==='status')return '';if(args.length===4)return [targetCommit,tree,tree].join('\n');if(args[1]==='HEAD')return targetCommit;return tree;};
 const progress={log:line=>logs.push(line),begin:line=>logs.push(line),complete:()=>logs.push('complete')};
 return {root,prepared,attempt,preparation,file,receipt,git,progress,logs};
}


// ---- S19b: foreign service children -------------------------------------------------------------------------
const T0='2026-10-22T05:30:19.000Z',T1='2026-10-22T05:30:20.000Z',T2='2026-10-22T05:30:21.000Z',OLD='2026-10-17T01:00:00.000Z';
const proc=(processId,parentProcessId,name,creationDate,readable=true)=>({processId,parentProcessId,name,creationDate,readable});
const asArray=value=>Array.isArray(value)?value:value==null?[]:[value];
test('foreign service child check: true children pass; an older or unreadable child of a live root is flagged',()=>{
 const base=[proc(100,1,'waitress-serve.exe',T0),proc(101,100,'conhost.exe',T1),proc(102,101,'python.exe',T2),proc(1,0,'System',OLD)];
 const roots=[{source:'django-reader.pid.json',processId:100,creationDate:T0}];
 assert.deepEqual(evaluateForeignServiceChildren({roots,processes:base}),{ok:true});
 // The 15:22 outage: an unrelated, unreadable, much older process whose recorded parent id equals a child of the reader root.
 const incident=evaluateForeignServiceChildren({roots,processes:[...base,proc(14720,101,'readertray.exe',OLD,false)]});
 assert.equal(incident.ok,false);assert.match(incident.message,/readertray\.exe/);assert.match(incident.message,/14720/);assert.match(incident.message,/101/);assert.match(incident.message,/身份无法读取/);assert.ok(incident.message.includes(foreignChildrenAdvice));assert.match(incident.message,/父进程号与后台服务进程相同/);
 // A readable foreign process in the same position would be killed instead: older than its claimed parent.
 const older=evaluateForeignServiceChildren({roots,processes:[...base,proc(14721,101,'tool.exe',OLD,true)]});assert.equal(older.ok,false);assert.match(older.message,/创建时间早于其声称的父进程/);assert.match(older.message,/tool\.exe/);
 // A direct child of the root is checked too, and an unreadable CreationDate counts as unreadable.
 assert.equal(evaluateForeignServiceChildren({roots,processes:[...base,proc(103,100,'x.exe',null,false)]}).ok,false);
 // Equal creation time is not older; a child of a flagged process is not descended into.
 assert.equal(evaluateForeignServiceChildren({roots,processes:[...base,proc(104,100,'same.exe',T0)]}).ok,true);
 const nested=evaluateForeignServiceChildren({roots,processes:[...base,proc(105,100,'bad.exe',OLD),proc(106,105,'under-bad.exe',OLD,false)]});assert.match(nested.message,/发现 1 个/);
});
test('foreign service child check: stale roots, recycled root pids, parentless noise and single-object PowerShell output are handled',()=>{
 const processes=[proc(100,1,'waitress-serve.exe',T0),proc(555,100,'child.exe',T1),proc(777,200,'orphan.exe',OLD,false),proc(300,300,'self-parent.exe',T0)];
 // Dead root pid, or a different process now holding the pid: not a live service root, so nothing under it is judged.
 assert.deepEqual(evaluateForeignServiceChildren({roots:[{source:'a',processId:999,creationDate:T0},{source:'b',processId:100,creationDate:'2026-01-01T00:00:00.000Z'}],processes:[...processes,proc(998,999,'z.exe',OLD,false)]}),{ok:true});
 // A root record without a creationDate is judged by the live process's own start time.
 assert.deepEqual(evaluateForeignServiceChildren({roots:[{source:'a',processId:100,creationDate:null},{source:'self',processId:300,creationDate:T0}],processes}),{ok:true});
 // Windows PowerShell 5.1 emits a lone array element as a bare object.
 assert.equal(evaluateForeignServiceChildren({roots:{source:'a',processId:100,creationDate:T0},processes:[proc(100,1,'w.exe',T0),proc(555,100,'child.exe',OLD,false)]}).ok,false);
 assert.deepEqual(evaluateForeignServiceChildren({roots:[],processes:[]}),{ok:true});
});
test('the probe adds the foreign-children check, which fails the publication preflight with advice; checkProcesses:false skips it',async t=>{
 const f=await fixture(t),snapshot={roots:[{source:'django-reader.pid.json',processId:100,creationDate:T0}],processes:[proc(100,1,'waitress-serve.exe',T0),proc(101,100,'conhost.exe',T1),proc(14720,101,'readertray.exe',OLD,false)]};
 const run=async()=>jsonLine({version:publicationProbeVersion,checks:okChecks,actors:[],snapshot});
 const probe=(config,options)=>probePublicationPreconditions(config,{...options,run});
 const probed=await probe({}, {checkDjango:true});assert.equal(probed.checks['Assert-NoForeignServiceChildren'].ok,false);
 await assert.rejects(assertPublicationPreconditions({}, {probe,runtimeRoot:f.runtime}),error=>{assert.match(error.message,/Assert-NoForeignServiceChildren/);assert.match(error.message,/readertray\.exe/);assert.match(error.message,/发布包保持可用/);return true;});
 const logs=[];assert.equal(await reportPublicationPreconditions({}, {probe,runtimeRoot:f.runtime,log:line=>logs.push(line)}),false);assert.match(logs.join('\n'),/现在发布会被拒绝/);
 assert.equal((await probePublicationPreconditions({}, {checkDjango:false,run})).checks['Assert-NoForeignServiceChildren'],undefined);
 await assert.rejects(probePublicationPreconditions({}, {checkDjango:true,run:async()=>jsonLine({version:publicationProbeVersion,checks:okChecks,actors:[]})}),/进程快照/);
});
test('real PowerShell 5.1 snapshot: live roots come from the run records and the Worker receipt; the current process is readable',{skip:process.platform!=='win32'||!await exists(powershell5)},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'probe-snapshot-'));t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:50}));
 const run=path.join(dir,'run');await fs.mkdir(run);
 const creation=(await runReal({}, "[Console]::Out.WriteLine((Get-CimInstance Win32_Process -Filter 'ProcessId="+process.pid+"').CreationDate.ToUniversalTime().ToString('o'))")).trim();
 await fs.writeFile(path.join(run,'django-self.pid.json'),JSON.stringify({version:2,service:'django-self',processId:process.pid,creationDate:creation}));
 await fs.writeFile(path.join(run,'django-dead.pid.json'),JSON.stringify({version:2,service:'django-dead',processId:2147483000,creationDate:T0}));
 await fs.writeFile(path.join(run,'broken.pid.json'),'not json');await fs.writeFile(path.join(run,'other.txt'),'ignored');
 const receipt=path.join(dir,'worker-process.json');await fs.writeFile(receipt,JSON.stringify({supervisorPid:process.pid,supervisorCreationDate:creation,version:'teruisi-local-worker-process-v1'}));
 let raw;const probed=await probePublicationPreconditions({}, {actors:[],checkDjango:false,checkProcesses:true,runDirectory:run,workerReceipt:receipt,run:async(config,script)=>raw=await runReal(config,script)});
 const snapshot=JSON.parse(raw.trim().split(/\r?\n/).filter(line=>line.startsWith('{')).at(-1)).snapshot;
 assert.deepEqual(asArray(snapshot.roots).map(root=>root.source).sort(),['django-dead.pid.json','django-self.pid.json','worker-process.json']);
 const self=asArray(snapshot.processes).find(item=>item.processId===process.pid);assert.ok(self&&self.readable===true&&Math.abs(Date.parse(self.creationDate)-Date.parse(creation))<2000&&self.parentProcessId>0);
 assert.equal(probed.checks['Assert-NoForeignServiceChildren'].ok,true,'node and its ordinary children are not foreign');
});

test('v1 records stay readable and keep the packet retired; v2 shape rules; only v2 is written',async t=>{
 const f=await failedEntry(t),v2=(await inspect(f)).record;
 const {maintenanceEntered,maintenanceEndedAt,...v1basis}=v2.basis;assert.equal(maintenanceEntered,false);assert.equal(maintenanceEndedAt,null);
 const v1={...v2,version:'teruisi-publication-not-entered-v1',basis:v1basis};
 await assert.rejects(writePublicationRetirement(f.queue,v1),/Only the current publication retirement version/);assert.equal(await exists(path.join(f.queue,'publication-retired')),false);
 // A record exactly as production holds it (v1) is read unchanged.
 await fs.mkdir(path.join(f.queue,'publication-retired'));await durableCreate(path.join(f.queue,'publication-retired',v1.dispatchId+'.json'),v1);
 const inventory=await readPreparationQueueInventory(f.queue);assert.equal(inventory.publicationRetirements.size,1);assert.equal(inventory.publicationRetirements.get(v1.dispatchId).value.version,'teruisi-publication-not-entered-v1');
 const retired=retiredPreparationPackets(inventory);assert.ok(retired.has(key(f.packet)));assert.equal(path.basename(preparationPacketSlot(f.packages,baseOf(a),retired)),baseOf(a)+'-r2');
 await assert.rejects(writePublicationRetirement(f.queue,v2),/already retired/);
 // v1 must not carry v2 fields, v2 must carry them
 const mixed=await failedEntry(t),ids={dispatchId:mixed.dispatchRead.value.dispatchId,dispatchSha256:mixed.dispatchRead.sha256,packet:mixed.packet,attempt:mixed.attempt};
 await assert.rejects(readOnlyShape(mixed,{...v2,...ids,version:'teruisi-publication-not-entered-v1'}),/basis changed|Expected|equal/i);
 await assert.rejects(readOnlyShape(mixed,{...v2,...ids,basis:v1basis}),/basis changed|Expected|equal/i);
 const g=await failedEntry(t),good=(await inspect(g)).record;
 const cases={'entered without end time':{...good,basis:{...good.basis,maintenanceEntered:true,maintenanceEndedAt:null}},'not entered with end time':{...good,basis:{...good.basis,maintenanceEntered:false,maintenanceEndedAt:'2026-10-24T01:50:00.000Z'}},'entered with bad end time':{...good,basis:{...good.basis,maintenanceEntered:true,maintenanceEndedAt:'soon'}},'non-boolean entered':{...good,basis:{...good.basis,maintenanceEntered:'yes'}},'unknown version':{...good,version:'teruisi-publication-retired-v3'}};
 for(const [name,record] of Object.entries(cases))await assert.rejects(writePublicationRetirement(g.queue,record),/maintenance|version|Only the current|record/i,name);
 assert.equal(await exists(path.join(g.queue,'publication-retired')),false);
 await writePublicationRetirement(g.queue,{...good,basis:{...good.basis,maintenanceEntered:true,maintenanceEndedAt:'2026-10-24T01:50:00.000Z'}});
});
// A stored record is validated by the reader, not by the writer: put it on disk exactly as given.
async function readOnlyShape(entry,record){
 await fs.mkdir(path.join(entry.queue,'publication-retired'),{recursive:true});const file=path.join(entry.queue,'publication-retired',record.dispatchId+'.json');
 await fs.rm(file,{force:true});await durableCreate(file,record);
 try{return await readPreparationQueueInventory(entry.queue);}finally{await fs.rm(file,{force:true});}
}
test('deploy path and consumer path both retire an entered-then-restored publication with a v2 record',async t=>{
 const f=await logFixture(t,{'launcher.jsonl':enteredLine+endedLine}),config={stateDirectory:path.join(f.root,'state')};await fs.mkdir(config.stateDirectory,{recursive:true});await fs.rename(f.queue,path.join(config.stateDirectory,'prebuild-queue-v2'));
 const logs=[],outcome=await retireNotEnteredPublication(config,f.selection,{log:line=>logs.push(line),inspect:(cfg,selection,o)=>inspectNotEnteredPublication(cfg,selection,stubs(f,{inventory:o.inventory,readMaintenanceLog:undefined,runtimeRoot:f.runtime}))});
 assert.equal(outcome.status,'retired');assert.match(logs.join('\n'),/上次发布已进入维护但已人工恢复为发布前版本（版本、标记、服务、进程已核实）；原记录全部保留，该包已退役/);
 assert.equal(JSON.parse(await fs.readFile(outcome.file,'utf8')).version,'teruisi-publication-retired-v2');
 const c=await consumerRun(t,{readMaintenanceLog:async()=>({entered:'2026-10-24T01:22:29.000Z',ended:'2026-10-24T01:50:00.000Z'})});
 const second=await c.ticket();assert.equal(second.status,'prepared');assert.equal(c.used.at(-1),packetBaseName(c.f.latest,c.f.live)+'-r2');
 const stored=[...(await readPreparationQueueInventory(c.directory)).publicationRetirements.values()][0].value;assert.equal(stored.version,'teruisi-publication-retired-v2');assert.equal(stored.basis.maintenanceEntered,true);
 const open=await consumerRun(t,{readMaintenanceLog:async()=>({entered:'2026-10-24T01:22:29.000Z',ended:null})});
 const deferred=await open.ticket();assert.equal(deferred.status,'failed');assert.match(deferred.error,/已进入维护，且没有结束维护的记录/);
});


// ---- S19b: entered-then-restored retirement ----------------------------------------------------------------
const logLine=(event,message,timestamp)=>JSON.stringify({timestamp,runId:'x',action:'a',level:'INFO',event,message})+'\n';
async function logFixture(t,files){
 const f=await failedEntry(t);
 await fs.mkdir(path.join(f.runtime,'logs'),{recursive:true});
 for(const [name,text] of Object.entries(files))await fs.writeFile(path.join(f.runtime,'logs',name),text);
 return f;
}
const real=f=>({readMaintenanceLog:undefined,runtimeRoot:f.runtime});
const since=Date.parse('2026-10-24T01:00:00.000Z');
const enteredLine=logLine('system_maintenance_entered',maintenanceId,'2026-10-24T09:22:29.000+08:00'),endedLine=logLine('system_maintenance_ended',maintenanceId,'2026-10-24T09:50:00.000+08:00');
test('scanMaintenanceLog: entered and ended, rotated siblings, other ids and events before STARTED are handled',async t=>{
 const other='f'.repeat(32),noise=logLine('ai_action_failed','x','2026-10-24T03:00:00.000+08:00');
 const f=await logFixture(t,{'launcher.jsonl':noise+logLine('system_maintenance_entered',other,'2026-10-24T09:20:00.000+08:00')+enteredLine+endedLine});
 assert.deepEqual(await scanMaintenanceLog(f.runtime,maintenanceId,since),{entered:'2026-10-24T01:22:29.000Z',ended:'2026-10-24T01:50:00.000Z'});
 assert.deepEqual(await scanMaintenanceLog(f.runtime,'d'.repeat(32),since),{entered:null,ended:null});
 // An entered event older than STARTED belongs to an earlier use of the id and does not count.
 const older=await logFixture(t,{'launcher.jsonl':logLine('system_maintenance_entered',maintenanceId,'2026-10-24T08:00:00.000+08:00')+logLine('system_maintenance_ended',maintenanceId,'2026-10-24T08:10:00.000+08:00')});
 assert.deepEqual(await scanMaintenanceLog(older.runtime,maintenanceId,since),{entered:null,ended:null});
 // entered but never ended; an ended event before the entered one does not count
 const open=await logFixture(t,{'launcher.jsonl':logLine('system_maintenance_ended',maintenanceId,'2026-10-24T09:00:00.000+08:00')+enteredLine});
 assert.deepEqual(await scanMaintenanceLog(open.runtime,maintenanceId,since),{entered:'2026-10-24T01:22:29.000Z',ended:null});
 // rotation: the entered event sits in launcher.jsonl.1 while the newest file starts after STARTED
 const rotated=await logFixture(t,{'launcher.jsonl':logLine('ai_action_failed','x','2026-10-24T10:00:00.000+08:00')+logLine('system_maintenance_ended',maintenanceId,'2026-10-24T10:30:00.000+08:00'),'launcher.jsonl.1':logLine('ai_action_failed','x','2026-10-24T08:00:00.000+08:00')+enteredLine,'launcher.jsonl.2':'not read\n','launcher.jsonl.bak':'ignored'});
 assert.deepEqual(await scanMaintenanceLog(rotated.runtime,maintenanceId,since),{entered:'2026-10-24T01:22:29.000Z',ended:'2026-10-24T02:30:00.000Z'});
});
test('scanMaintenanceLog fails closed: no log, and a 32 MiB window that does not reach back to STARTED',async t=>{
 const f=await failedEntry(t);
 await assert.rejects(scanMaintenanceLog(f.runtime,maintenanceId,since),/ENOENT/);
 await fs.mkdir(path.join(f.runtime,'logs'));await assert.rejects(scanMaintenanceLog(f.runtime,maintenanceId,since),/后台启动器日志不存在/);
 await fs.writeFile(path.join(f.runtime,'logs','launcher.jsonl.1'),'');await assert.rejects(scanMaintenanceLog(f.runtime,maintenanceId,since),/后台启动器日志不存在/);
 const filler=logLine('ai_action_failed','x'.repeat(900),'2026-10-24T12:00:00.000+08:00'),big=filler.repeat(Math.ceil(maintenanceLogWindowBytes/filler.length)+10);
 await fs.writeFile(path.join(f.runtime,'logs','launcher.jsonl'),big);
 await assert.rejects(scanMaintenanceLog(f.runtime,maintenanceId,since),/没有覆盖到发布开始时间/);
 // An entered line that fell out of the window is exactly why a truncated window that starts after STARTED must refuse.
 await fs.writeFile(path.join(f.runtime,'logs','launcher.jsonl'),enteredLine+big);
 await assert.rejects(scanMaintenanceLog(f.runtime,maintenanceId,since),/没有覆盖到发布开始时间/);
});
test('entered then restored: v2 retirement with the real log scan; entered without ended, unreadable log and not-entered all behave',async t=>{
 const f=await logFixture(t,{'launcher.jsonl':enteredLine+endedLine}),result=await inspect(f,real(f));
 assert.equal(result.eligible,true);assert.equal(result.record.version,publicationRetirementVersion);assert.equal(publicationRetirementVersion,'teruisi-publication-retired-v2');
 assert.equal(result.record.basis.maintenanceEntered,true);assert.equal(result.record.basis.maintenanceEndedAt,'2026-10-24T01:50:00.000Z');
 await writePublicationRetirement(f.queue,result.record);
 const stored=JSON.parse(await fs.readFile(path.join(f.queue,'publication-retired',f.dispatchRead.value.dispatchId+'.json'),'utf8'));assert.equal(stored.basis.maintenanceEntered,true);
 assert.ok(retiredPreparationPackets(await readPreparationQueueInventory(f.queue)).has(key(f.packet)));
 const open=await logFixture(t,{'launcher.jsonl':enteredLine}),refused=await inspect(open,real(open));assert.equal(refused.eligible,false);assert.match(refused.reasons.join(),/已进入维护，且没有结束维护的记录/);
 for(const [label,over,pattern] of [['rotation busy',{probeRotation:async()=>false},/轮换锁/],['health',{fetchReady:async()=>({status:503,json:async()=>({})})},/未就绪/],['actor alive',{probe:probeWith(aclFailure,[owner.processId])},/仍在运行/]]){
  const g=await logFixture(t,{'launcher.jsonl':enteredLine+endedLine}),r=await inspect(g,{...real(g),...over});assert.equal(r.eligible,false,label);assert.match(r.reasons.join(),pattern,label);
 }
 const marker=await logFixture(t,{'launcher.jsonl':enteredLine+endedLine});await fs.writeFile(path.join(marker.runtime,'run','system-maintenance.json'),'{}');const m=await inspect(marker,real(marker));assert.equal(m.eligible,false);assert.match(m.reasons.join(),/维护或排空/);
 const none=await failedEntry(t),unreadable=await inspect(none,real(none));assert.equal(unreadable.eligible,false);assert.match(unreadable.reasons.join(),/无法读取后台启动器日志/);
 const quiet=await logFixture(t,{'launcher.jsonl':logLine('ai_action_failed','x','2026-10-24T10:00:00.000+08:00')}),q=await inspect(quiet,real(quiet));
 assert.equal(q.eligible,true);assert.equal(q.record.basis.maintenanceEntered,false);assert.equal(q.record.basis.maintenanceEndedAt,null);await writePublicationRetirement(quiet.queue,q.record);
 const bad=await logFixture(t,{'launcher.jsonl':enteredLine+endedLine});const file=path.join(bad.attempt,'STARTED.json'),value=JSON.parse(await fs.readFile(file,'utf8'));value.at='yesterday';await fs.writeFile(file,JSON.stringify(value));
 const b=await inspect(bad,real(bad));assert.equal(b.eligible,false);assert.match(b.reasons.join(),/没有有效时间/);
});
