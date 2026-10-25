import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {submitPreparation,drainPreparationQueue,ticketResult,readPreparationQueueInventory,retiredPreparationPackets,preparationPacketSlot,assertPreparationPacket,publicationMarkers,durableCreate,canonical,sha,queueVersion} from '../tools/main-prebuild-queue.mjs';
import {readNativePreparationFailure,probeRotationLock,drainLatestMainQueue,inspectMainPreparation} from '../tools/publish-latest-main.mjs';
// S05d general mechanism: structured preparation terminals and abandonment of
// preparation-stage unknown. No child process; runs in the sandbox runner.
const h=c=>c.repeat(64),a='a'.repeat(40),binding={configSha256:h('1'),bundleSha256:h('2')};
const live={mainCommit:'0'.repeat(40),head:{bindingSha256:h('3')},djangoManifestSha256:h('4'),chainStateSha256:h('5')};
const baseOf=target=>target.slice(0,12)+'-33333333-44444444',key=file=>path.resolve(file).toLowerCase();
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'prebuild-abandon-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:50}));const packages=path.join(root,'packages');await fs.mkdir(packages);return {root,queue:path.join(root,'queue'),packages};}
const submit=f=>submitPreparation(f.queue,{...binding,observedTarget:null,origin:'manual'});
const result=(f,item)=>ticketResult(f.queue,item.requestId,item.ticketSha256);
const observer=(f,target=a,seen=[])=>async({retiredPackets}={})=>{seen.push(retiredPackets);return {targetCommit:target,packet:preparationPacketSlot(f.packages,baseOf(target),retiredPackets),live:structuredClone(live)};};
const noWork={observe:()=>assert.fail('blocked queue cannot observe'),prepare:()=>assert.fail('blocked queue cannot prepare')};
async function prepared(selected){
 const packet=selected.packet,request={mainCommit:selected.targetCommit,predecessorWorker:selected.live.head,predecessorDjangoSha256:selected.live.djangoManifestSha256,components:['worker']};
 const file=path.join(packet,'publish-'+selected.targetCommit.slice(0,12),'preparation/PREPARED.json');await fs.mkdir(path.dirname(file),{recursive:true});
 await fs.writeFile(path.join(packet,'main-release-request.json'),JSON.stringify(request));
 const bytes=JSON.stringify({version:'teruisi-main-preparation-v1',requestSha256:sha(JSON.stringify(request)),sourceIdentity:{commit:selected.targetCommit,tree:'6'.repeat(40)},workerPlan:{id:'private'},djangoPackage:null});
 await fs.writeFile(file,bytes);
 return {status:'prepared-only',mainCommit:selected.targetCommit,publicationPerformed:false,preparationFile:file,preparationSha256:sha(bytes)};
}
async function nativeFailure(packet,target=a,{receipt=true,mutate=value=>value}={}){
 await fs.mkdir(path.join(packet,'invocations'),{recursive:true});
 await fs.writeFile(path.join(packet,'main-release-request.json'),JSON.stringify({mainCommit:target}));
 let failureReceipt=null;
 if(receipt){const preparation=path.join(packet,'publish-'+target.slice(0,12),'preparation');await fs.mkdir(preparation,{recursive:true});const file=path.join(preparation,'FAILED-'+randomUUID()+'.json'),raw=JSON.stringify({phase:'构建前端',error:'private'},null,2)+'\n';await fs.writeFile(file,raw);failureReceipt={path:file,sha256:sha(raw)};}
 const resultFile=path.join(packet,'invocations',randomUUID()+'.json');
 await fs.writeFile(resultFile,JSON.stringify(mutate({version:'teruisi-native-preparation-failure-v1',status:'preparation-failed',mainCommit:target,publicationPerformed:false,publicationStarted:false,maintenanceStarted:false,phase:'构建前端',error:'private native rejection',failureReceipt}))+'\n');
 return resultFile;
}
const failWith=terminal=>{const error=Error('本次目标发布未完成，退出码：1');error.preparationTerminal=terminal;throw error;};
// An old dispatched preparation unknown, shaped like a3d53227: only
// preparation/PREPARING.json and source-binding.json exist in the attempt.
async function unknownDispatch(f,{deadlineUnixMs=Date.now()-60*60*1000,target=a,packet=path.join(f.packages,baseOf(target)),terminal=true}={}){
 const item=await submit(f),dispatchId=randomUUID();
 const dispatch={version:queueVersion,dispatchId,requestId:item.requestId,mode:'prepare-only',...binding,selectedTarget:target,selection:{targetCommit:target,packet,live:structuredClone(live)},deadlineUnixMs,dispatchedAt:new Date(deadlineUnixMs-60*60*1000).toISOString(),tickets:[{requestId:item.requestId,ticketSha256:item.ticketSha256,observedTarget:null}]};
 const dispatchSha256=await durableCreate(path.join(f.queue,'dispatches',dispatchId+'.json'),dispatch),resultFile=path.join(f.queue,'results',item.requestId+'.json');
 if(terminal)await durableCreate(resultFile,{version:queueVersion,requestId:item.requestId,ticketSha256:item.ticketSha256,status:'unknown',at:new Date(deadlineUnixMs-30*60*1000).toISOString(),...binding,dispatchId,dispatchSha256,selectedTarget:target,winnerRequestId:item.requestId,error:'本次目标发布未完成，退出码：1'});
 const attempt=path.join(packet,'publish-'+target.slice(0,12)),preparation=path.join(attempt,'preparation');await fs.mkdir(preparation,{recursive:true});
 await fs.writeFile(path.join(preparation,'PREPARING.json'),'{"private":true}');await fs.writeFile(path.join(preparation,'source-binding.json'),'{"private":true}');
 return {item,dispatchId,dispatch,dispatchSha256,resultFile,original:terminal?await fs.readFile(resultFile):null,packet,attempt};
}
const abandonFile=(f,old)=>path.join(f.queue,'abandoned',old.dispatchId+'.json');
const exists=async file=>{try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};

test('preparation-stage unknown blocks until deadline plus grace, then is abandoned without touching its bytes; same target prepares in -r2',async t=>{
 const f=await fixture(t),old=await unknownDispatch(f,{deadlineUnixMs:Date.now()-5*60*1000});let probes=0,calls=0,packet;
 const probe=async()=>{probes++;return true;};
 const first=await submit(f);await drainPreparationQueue(f.queue,{...binding,...noWork,abandonment:{probeRotationLock:probe}});
 assert.equal((await result(f,first)).status,'blocked');assert.equal(probes,0,'default 15 minute grace not reached');assert.equal(await exists(path.join(f.queue,'abandoned')),false);
 const second=await submit(f),seen=[];
 await drainPreparationQueue(f.queue,{...binding,abandonment:{graceMs:0,probeRotationLock:probe},observe:observer(f,a,seen),prepare:async selected=>{calls++;packet=selected.packet;return prepared(selected);}});
 assert.equal(probes,1);assert.equal(calls,1);assert.equal(path.basename(packet),baseOf(a)+'-r2');assert.ok(seen.at(-1).has(key(old.packet)));
 assert.equal((await result(f,second)).status,'prepared');assert.equal((await result(f,first)).status,'blocked');
 assert.deepEqual(await fs.readFile(old.resultFile),old.original,'original unknown bytes are preserved');assert.equal((await result(f,old.item)).status,'unknown');
 const record=JSON.parse(await fs.readFile(abandonFile(f,old),'utf8'));
 assert.equal(record.version,'teruisi-preparation-abandonment-v1');assert.equal(record.consumePermitted,false);assert.equal(record.originalResultSha256,sha(old.original));assert.equal(record.dispatchSha256,old.dispatchSha256);
 assert.equal(record.packet,old.packet);assert.equal(record.selectedTarget,a);assert.deepEqual(record.basis,{deadlineUnixMs:old.dispatch.deadlineUnixMs,graceMs:0,publicationMarkersChecked:publicationMarkers,preparedReceiptPresent:false,rotationLockFree:true});
 const inventory=await readPreparationQueueInventory(f.queue);assert.equal(inventory.abandonments.size,1);assert.ok(retiredPreparationPackets(inventory).has(key(old.packet)));
 assert.deepEqual(await fs.readdir(old.attempt),['preparation'],'no FAILED/SUCCESS/resolution forged for the old unknown');assert.equal(await exists(path.join(f.queue,'resolutions')),false);
 // The abandoned dispatch no longer blocks and its target is not banned.
 const third=await submit(f);await drainPreparationQueue(f.queue,{...binding,abandonment:{graceMs:0,probeRotationLock:probe},observe:observer(f),prepare:prepared});
 assert.equal((await result(f,third)).status,'prepared');assert.equal(probes,1);
});
test('without the abandonment option a past-deadline preparation unknown keeps blocking exactly as before',async t=>{
 const f=await fixture(t),old=await unknownDispatch(f),first=await submit(f);
 await drainPreparationQueue(f.queue,{...binding,...noWork});
 const blocked=await result(f,first);assert.equal(blocked.status,'blocked');assert.equal(blocked.blockedDispatchId,old.dispatchId);assert.equal(blocked.error,'Prior dispatch lacks a complete terminal result; no preparation replay');
 assert.equal(await exists(path.join(f.queue,'abandoned')),false);
 const second=await submit(f);await drainPreparationQueue(f.queue,{...binding,abandonment:{probeRotationLock:async()=>true},observe:observer(f),prepare:prepared});
 assert.equal((await result(f,second)).status,'prepared');assert.ok(await exists(abandonFile(f,old)));
});
test('any publication-stage marker in the attempt directory keeps the unknown blocking forever',async t=>{
 for(const marker of [...publicationMarkers,'resume-0123456789abcdef','maintenance-admission.json']){
  const f=await fixture(t),old=await unknownDispatch(f);let probes=0;
  if(marker.startsWith('resume-'))await fs.mkdir(path.join(old.attempt,marker));else await fs.writeFile(path.join(old.attempt,marker),'original publication evidence');
  const item=await submit(f);await drainPreparationQueue(f.queue,{...binding,...noWork,abandonment:{graceMs:0,probeRotationLock:async()=>{probes++;return true;}}});
  assert.equal((await result(f,item)).status,'blocked',marker);assert.equal(await exists(path.join(f.queue,'abandoned')),false,marker);assert.equal(probes,0,marker);
  assert.equal((await fs.readFile(path.join(old.attempt,marker)).catch(()=>null))?.toString()??null,marker.startsWith('resume-')?null:'original publication evidence');
 }
});
test('a held or unprobeable rotation lock and a missing terminal keep the dispatch blocking',async t=>{
 for(const probe of [async()=>false,async()=>{throw Error('probe denied');},async()=>'true']){
  const f=await fixture(t);await unknownDispatch(f);const item=await submit(f);
  await drainPreparationQueue(f.queue,{...binding,...noWork,abandonment:{graceMs:0,probeRotationLock:probe}});
  assert.equal((await result(f,item)).status,'blocked');assert.equal(await exists(path.join(f.queue,'abandoned')),false);
 }
 const f=await fixture(t);await unknownDispatch(f,{terminal:false});let probes=0;
 await drainPreparationQueue(f.queue,{...binding,...noWork,abandonment:{graceMs:0,probeRotationLock:async()=>{probes++;return true;}}});
 assert.equal(probes,0);assert.equal(await exists(path.join(f.queue,'abandoned')),false);
 await assert.rejects(drainPreparationQueue(f.queue,{...binding,...noWork,abandonment:{}}),/explicit rotation lock probe/);
});
test('abandonment is evaluated only after ordinary preparation admission; a rejected host writes no abandonment record',async t=>{
 const f=await fixture(t),old=await unknownDispatch(f),order=[];
 const probe=async()=>{order.push('probe');return true;};
 const first=await submit(f);
 await drainPreparationQueue(f.queue,{...binding,...noWork,admitPreparation:async()=>{order.push('admit');throw Error('elevated host cannot prepare');},abandonment:{graceMs:0,probeRotationLock:probe}});
 const blocked=await result(f,first);assert.equal(blocked.status,'blocked');assert.equal(blocked.blockedDispatchId,old.dispatchId);assert.equal(blocked.error,'Prior dispatch lacks a complete terminal result; no preparation replay');
 assert.deepEqual(order,['admit'],'no rotation probe and no abandonment write without admission');assert.equal(await exists(path.join(f.queue,'abandoned')),false);
 assert.deepEqual(await fs.readFile(old.resultFile),old.original);
 order.length=0;const second=await submit(f);
 await drainPreparationQueue(f.queue,{...binding,admitPreparation:async()=>{order.push('admit');},abandonment:{graceMs:0,probeRotationLock:probe},observe:observer(f),prepare:prepared});
 assert.equal(order[0],'admit');assert.equal(order[1],'probe');assert.ok(await exists(abandonFile(f,old)));assert.equal((await result(f,second)).status,'prepared');
});
test('tampered, orphan or premature abandonment records and changed unknown bytes fail closed',async t=>{
 const f=await fixture(t),old=await unknownDispatch(f);await submit(f);
 await drainPreparationQueue(f.queue,{...binding,abandonment:{graceMs:0,probeRotationLock:async()=>true},observe:observer(f),prepare:prepared});
 const file=abandonFile(f,old),original=await fs.readFile(file),record=JSON.parse(original);
 const cases=[[{...record,consumePermitted:true},/never consumed/],[{...record,extra:true},/schema/],[{...record,at:new Date(old.dispatch.deadlineUnixMs-1).toISOString()},/precedes/],[{...record,packet:path.join(f.packages,'other')},/Expected|deepStrictEqual|strictEqual|equal/],[{...record,basis:{...record.basis,rotationLockFree:false}},/Expected|equal/]];
 for(const [value,pattern] of cases){await fs.writeFile(file,canonical(value));await assert.rejects(readPreparationQueueInventory(f.queue),pattern);await submit(f);await assert.rejects(drainPreparationQueue(f.queue,{...binding,...noWork,abandonment:{graceMs:0,probeRotationLock:async()=>true}}));}
 await fs.writeFile(file,original.toString('utf8').trimEnd());await assert.rejects(readPreparationQueueInventory(f.queue),/Noncanonical/);
 await fs.writeFile(file,original);await readPreparationQueueInventory(f.queue);
 const orphan=path.join(f.queue,'abandoned',randomUUID()+'.json');await fs.writeFile(orphan,original);await assert.rejects(readPreparationQueueInventory(f.queue),/Orphan preparation abandonment/);await fs.rm(orphan);
 const terminal=JSON.parse(old.original);await fs.writeFile(old.resultFile,canonical({...terminal,error:'rewritten unknown'}));await assert.rejects(readPreparationQueueInventory(f.queue),/Abandoned unknown result changed/);
 await fs.writeFile(old.resultFile,old.original);await readPreparationQueueInventory(f.queue);
});
test('a valid native preparation failure is a dispatched failed terminal; the next ticket prepares the same target in -r2',async t=>{
 const f=await fixture(t),first=await submit(f);let terminal;
 await drainPreparationQueue(f.queue,{...binding,observe:observer(f),prepare:async selected=>{const file=await nativeFailure(selected.packet);terminal=await readNativePreparationFailure(file,selected.packet);assert.ok(terminal);failWith(terminal);}});
 const failed=await result(f,first);assert.equal(failed.status,'failed');assert.deepEqual(failed.preparationTerminal,terminal);assert.equal(failed.preparationTerminal.kind,'native-preparation-failed');assert.ok(failed.dispatchId&&failed.dispatchSha256&&failed.winnerRequestId===first.requestId);
 const second=await submit(f);let packet;
 await drainPreparationQueue(f.queue,{...binding,observe:observer(f),prepare:async selected=>{packet=selected.packet;return prepared(selected);}});
 assert.equal(path.basename(packet),baseOf(a)+'-r2');assert.equal((await result(f,second)).status,'prepared');
 const inventory=await readPreparationQueueInventory(f.queue);assert.ok(retiredPreparationPackets(inventory).has(key(path.join(f.packages,baseOf(a)))));
 // The terminal stays bound to the exact native result bytes.
 await fs.appendFile(terminal.resultFile,' ');await assert.rejects(result(f,first),/Native failure result changed/);
});
test('a consumer rejection before native start is failed and does not block; a plain failure is still unknown',async t=>{
 const f=await fixture(t),first=await submit(f);
 await drainPreparationQueue(f.queue,{...binding,observe:observer(f),prepare:async()=>failWith({kind:'rejected-before-native',stage:'freeze-source'})});
 const failed=await result(f,first);assert.equal(failed.status,'failed');assert.deepEqual(failed.preparationTerminal,{kind:'rejected-before-native',stage:'freeze-source'});
 const second=await submit(f);let packet;
 await drainPreparationQueue(f.queue,{...binding,observe:observer(f),prepare:async selected=>{packet=selected.packet;throw Error('native child result unknown');}});
 assert.equal(path.basename(packet),baseOf(a)+'-r2');assert.equal((await result(f,second)).status,'unknown');
 const third=await submit(f);await drainPreparationQueue(f.queue,{...binding,...noWork});assert.equal((await result(f,third)).status,'blocked');
});
test('invalid preparation terminals and terminals beside publication markers stay unknown',async t=>{
 const variants={
  kind:async()=>({kind:'native-preparation-succeeded'}),
  extra:async()=>({kind:'rejected-before-native',stage:'freeze-source',note:'x'}),
  stage:async()=>({kind:'rejected-before-native',stage:'Freeze Source'}),
  digest:async packet=>({...await readNativePreparationFailure(await nativeFailure(packet),packet),resultSha256:h('9')}),
  outside:async packet=>{const file=await nativeFailure(packet),terminal=await readNativePreparationFailure(file,packet),moved=path.join(packet,'logs',path.basename(file));await fs.mkdir(path.dirname(moved),{recursive:true});await fs.copyFile(file,moved);return {...terminal,resultFile:moved};},
  started:async packet=>{const terminal=await readNativePreparationFailure(await nativeFailure(packet),packet);await fs.writeFile(path.join(packet,'publish-'+a.slice(0,12),'STARTED.json'),'original');return terminal;},
  primitive:async()=>'failed'};
 for(const [name,make] of Object.entries(variants)){
  const f=await fixture(t),first=await submit(f);
  await drainPreparationQueue(f.queue,{...binding,observe:observer(f),prepare:async selected=>failWith(await make(selected.packet))});
  const terminal=await result(f,first);assert.equal(terminal.status,'unknown',name);assert.equal(terminal.preparationTerminal,undefined,name);
  const later=await submit(f);await drainPreparationQueue(f.queue,{...binding,...noWork});assert.equal((await result(f,later)).status,'blocked',name);
 }
});
test('dispatched failed terminals validate exactly; the pre-dispatch failed shape is unchanged',async t=>{
 const f=await fixture(t),first=await submit(f);
 await drainPreparationQueue(f.queue,{...binding,observe:async()=>{throw Error('fetch failed before dispatch');},prepare:()=>assert.fail('no dispatch')});
 const early=await result(f,first);assert.equal(early.status,'failed');assert.equal(early.dispatchId,undefined);assert.deepEqual(Object.keys(early).sort(),['at','bundleSha256','configSha256','error','requestId','status','ticketSha256','version']);
 const second=await submit(f);await drainPreparationQueue(f.queue,{...binding,observe:observer(f),prepare:async()=>failWith({kind:'rejected-before-native',stage:'inspect'})});
 const file=path.join(f.queue,'results',second.requestId+'.json'),original=await fs.readFile(file),value=JSON.parse(original);
 for(const mutated of [(({preparationTerminal,...rest})=>rest)(value),{...value,preparationTerminal:{kind:'rejected-before-native'}},{...value,preparationTerminal:{kind:'other',stage:'inspect'}},{...value,extra:1},{...value,dispatchSha256:h('9')}]){
  await fs.writeFile(file,canonical(mutated));await assert.rejects(result(f,second));
 }
 await fs.writeFile(file,original);assert.equal((await result(f,second)).status,'failed');
});
test('packet slot helper picks the first non-retired slot and the freeze path accepts only base or -r2..-r64',()=>{
 const root=path.resolve(os.tmpdir(),'private-packages'),base=baseOf(a),slot=n=>path.join(root,n===1?base:base+'-r'+n);
 assert.equal(preparationPacketSlot(root,base),slot(1));
 assert.equal(preparationPacketSlot(root,base,new Set([key(slot(1))])),slot(2));
 assert.equal(preparationPacketSlot(root,base,new Set([key(slot(1)),key(slot(2)),key(slot(4))])),slot(3));
 assert.throws(()=>preparationPacketSlot(root,base,new Set(Array.from({length:64},(_,i)=>key(slot(i+1))))),/64/);
 assert.throws(()=>preparationPacketSlot(root,'not-a-base'),/Packet base/);
 for(const n of [1,2,64])assert.equal(assertPreparationPacket(root,base,slot(n)),path.basename(slot(n)));
 for(const packet of [path.join(root,base+'-r1'),path.join(root,base+'-r65'),path.join(root,base+'-r02'),path.join(root,baseOf('b'.repeat(40))),path.join(root,'nested',base),path.join(root,base+'-x')])assert.throws(()=>assertPreparationPacket(root,base,packet),/Frozen packet changed/);
});
test('native preparation-failure result validator accepts only the exact record',async t=>{
 const f=await fixture(t),packet=path.join(f.packages,baseOf(a)),file=await nativeFailure(packet),terminal=await readNativePreparationFailure(file,packet);
 assert.deepEqual(terminal,{kind:'native-preparation-failed',resultFile:path.resolve(file),resultSha256:sha(await fs.readFile(file)),phase:'构建前端'});
 assert.ok(await readNativePreparationFailure(await nativeFailure(packet,a,{receipt:false}),packet));
 assert.ok(await readNativePreparationFailure(await nativeFailure(packet,a,{mutate:value=>({...value,mainCommit:null})}),packet));
 const rejected={extra:value=>({...value,extra:1}),version:value=>({...value,version:'v0'}),status:value=>({...value,status:'prepared-only'}),published:value=>({...value,publicationPerformed:true}),started:value=>({...value,publicationStarted:true}),maintenance:value=>({...value,maintenanceStarted:true}),target:value=>({...value,mainCommit:'b'.repeat(40)}),phase:value=>({...value,phase:''}),receiptKeys:value=>({...value,failureReceipt:{...value.failureReceipt,extra:1}}),receiptOutside:value=>({...value,failureReceipt:{...value.failureReceipt,path:path.join(packet,path.basename(value.failureReceipt.path))}}),receiptDigest:value=>({...value,failureReceipt:{...value.failureReceipt,sha256:h('9')}}),array:()=>[]};
 for(const [name,mutate] of Object.entries(rejected))assert.equal(await readNativePreparationFailure(await nativeFailure(packet,a,{mutate}),packet),null,name);
 assert.equal(await readNativePreparationFailure(path.join(packet,'invocations',randomUUID()+'.json'),packet),null,'missing');
 assert.equal(await readNativePreparationFailure(file,path.join(f.packages,'other')),null,'outside invocations');
 const garbage=path.join(packet,'invocations',randomUUID()+'.json');await fs.writeFile(garbage,'{');assert.equal(await readNativePreparationFailure(garbage,packet),null,'partial');
 await fs.rm(path.join(packet,'main-release-request.json'));assert.equal(await readNativePreparationFailure(file,packet),null,'unbound target');
});
test('rotation lock probe is true only when the pipe can be taken and released',async t=>{
 const pipe='\\\\.\\pipe\\TERUISI.Test.AbandonRotation.'+randomUUID(),server=createServer(socket=>socket.destroy());
 await new Promise(resolve=>server.listen(pipe,resolve));t.after(()=>{try{server.close();}catch{}});
 assert.equal(await probeRotationLock(pipe),false);await new Promise(resolve=>server.close(resolve));
 assert.equal(await probeRotationLock(pipe),true);assert.equal(await probeRotationLock(pipe),true,'the probe released its own listener');
});
test('consumer wiring: rejection before native and validated native failure are failed; plain native failure stays unknown; retired packets reach observe and deploy inspection',async t=>{
 const f=await fixture(t),config={stateDirectory:f.root,releaseDirectory:f.packages},state={...binding},directory=path.join(f.root,'prebuild-queue-v2'),seen=[],packets=[];
 let mode='freeze',runs=0;
 const options={binding:{config,state},assertGeneration:async()=>{},assertConsumerIdentity:async()=>{},admit:async()=>{},admitSelected:async()=>{},probeRotation:async()=>true,
  observe:async(cfg,{retiredPackets})=>{seen.push(retiredPackets);return {targetCommit:a,packet:preparationPacketSlot(cfg.releaseDirectory,baseOf(a),retiredPackets),live:structuredClone(live)};},
  once:async(cfg,selection)=>{packets.push(selection.packet);if(mode==='freeze')throw Error('依赖锁已变化，需要先准备对应离线依赖；本次未部署');return {status:'prepared',targetCommit:a,currentCommit:live.mainCommit,packet:selection.packet,source:path.join(selection.packet,'source'),request:{mainCommit:a},publicationPerformed:false};},
  inspect:async()=>({status:'not-ready'}),
  run:async source=>{runs++;const packet=path.resolve(source,'..');if(mode==='plain')throw Error('本次目标发布未完成，退出码：1');const error=Error('本次目标发布未完成，退出码：1');error.preparationTerminal=await readNativePreparationFailure(await nativeFailure(packet),packet);throw error;}};
 const first=await submitPreparation(directory,{...state,origin:'manual'});await drainLatestMainQueue('private-only',options);
 const rejected=await ticketResult(directory,first.requestId,first.ticketSha256);assert.equal(rejected.status,'failed');assert.deepEqual(rejected.preparationTerminal,{kind:'rejected-before-native',stage:'freeze-source'});assert.equal(runs,0);
 mode='native';const second=await submitPreparation(directory,{...state,origin:'manual'});await drainLatestMainQueue('private-only',options);
 const native=await ticketResult(directory,second.requestId,second.ticketSha256);assert.equal(native.status,'failed');assert.equal(native.preparationTerminal.kind,'native-preparation-failed');assert.equal(runs,1);
 mode='plain';const third=await submitPreparation(directory,{...state,origin:'manual'});await drainLatestMainQueue('private-only',options);
 assert.equal((await ticketResult(directory,third.requestId,third.ticketSha256)).status,'unknown');assert.equal(runs,2);
 assert.deepEqual(packets.map(packet=>path.basename(packet)),[baseOf(a),baseOf(a)+'-r2',baseOf(a)+'-r3']);assert.ok(seen[2].has(key(packets[1])));
 const fourth=await submitPreparation(directory,{...state,origin:'manual'});await drainLatestMainQueue('private-only',options);
 assert.equal((await ticketResult(directory,fourth.requestId,fourth.ticketSha256)).status,'blocked','a fresh unknown still blocks before deadline plus grace');
 const retired=retiredPreparationPackets(await readPreparationQueueInventory(directory));
 await assert.rejects(inspectMainPreparation({packet:packets[0],source:path.join(packets[0],'source'),targetCommit:a,request:{}},{retiredPackets:retired}),/已退役/);
});
