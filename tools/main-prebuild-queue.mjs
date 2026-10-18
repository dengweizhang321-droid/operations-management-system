/** V2 preparation queue. A durable dispatch precedes every preparation effect. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';

const hex=/^[a-f0-9]{64}$/,id=/^[a-f0-9-]{36}$/,commit=/^[a-f0-9]{40}$/;
export const queueVersion='teruisi-main-prebuild-queue-v2';
export const sha=raw=>createHash('sha256').update(raw).digest('hex');
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])])):value;
export const canonical=value=>JSON.stringify(ordered(value))+'\n';
export async function durableCreate(file,value){
 const raw=canonical(value),handle=await fs.open(file,'wx');
 try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
 return sha(Buffer.from(raw));
}
export async function readQueueObject(file){
 const stat=await fs.lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.size<=1024*1024,'Unsafe queue evidence');
 const raw=await fs.readFile(file,'utf8'),value=JSON.parse(raw);assert.equal(raw,canonical(value),'Noncanonical, duplicate or partial queue JSON');
 return {value,sha256:sha(Buffer.from(raw))};
}
export function queuePipe(directory){return '\\\\.\\pipe\\TERUISI.MainPrebuild.v2.'+sha(path.resolve(directory).toLowerCase());}
export async function acquireQueueLock(directory){
 const server=createServer(socket=>socket.destroy());
 return new Promise((resolve,reject)=>{
  server.once('error',error=>error.code==='EADDRINUSE'?resolve(null):reject(error));
  server.listen(queuePipe(directory),()=>resolve(()=>new Promise((done,fail)=>server.close(error=>error?fail(error):done()))));
 });
}
export async function initializeQueue(directory){
 for(const leaf of ['tickets','dispatches','results'])await fs.mkdir(path.join(directory,leaf),{recursive:true});
}
export async function submitPreparation(directory,{origin,observedTarget=null,configSha256,bundleSha256}){
 assert.ok(['hook','manual'].includes(origin)&& (observedTarget===null||commit.test(observedTarget)));
 assert.ok(hex.test(configSha256)&&hex.test(bundleSha256));await initializeQueue(directory);
 const requestId=randomUUID(),ticket={version:queueVersion,requestId,mode:'prepare-latest-main',origin,observedTarget,queuedAt:new Date().toISOString(),configSha256,bundleSha256};
 const ticketSha256=await durableCreate(path.join(directory,'tickets',requestId+'.json'),ticket);
 return {requestId,ticketSha256,ticket};
}
const entries=async(directory,leaf)=>{const names=await fs.readdir(path.join(directory,leaf));assert.ok(names.every(name=>id.test(name.slice(0,-5))&&name.endsWith('.json')),'Unknown or partial queue artifact');return names.sort();};
function validateTicket(value,name){
 assert.deepEqual(Object.keys(value).sort(),['bundleSha256','configSha256','mode','observedTarget','origin','queuedAt','requestId','version']);
 assert.equal(value.version,queueVersion);assert.equal(value.requestId+'.json',name);assert.ok(id.test(value.requestId));
 assert.equal(value.mode,'prepare-latest-main');assert.ok(['hook','manual'].includes(value.origin));
 assert.ok(value.observedTarget===null||commit.test(value.observedTarget));assert.ok(hex.test(value.configSha256)&&hex.test(value.bundleSha256)&&Number.isFinite(Date.parse(value.queuedAt)));
}
async function allTickets(directory){
 const result=[];
 for(const name of await entries(directory,'tickets')){
  const read=await readQueueObject(path.join(directory,'tickets',name));validateTicket(read.value,name);result.push({...read,name});
 }
 return result.sort((a,b)=>a.value.queuedAt.localeCompare(b.value.queuedAt)||a.name.localeCompare(b.name));
}
export async function ticketResult(directory,requestId,ticketSha256){
 assert.ok(id.test(requestId)&&hex.test(ticketSha256));
 let terminal;
 try{terminal=await readQueueObject(path.join(directory,'results',requestId+'.json'));}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
 const {value}=terminal;
  assert.equal(value.version,queueVersion);assert.equal(value.requestId,requestId);assert.equal(value.ticketSha256,ticketSha256);
  assert.ok(['prepared','current','non-production','superseded','failed','unknown','blocked'].includes(value.status));
  const base=['version','requestId','ticketSha256','status','at','configSha256','bundleSha256'];
  const refs=['dispatchId','dispatchSha256','selectedTarget','winnerRequestId'];
  const extra=value.status==='blocked'?['blockedDispatchId','blockedDispatchSha256','error']:value.status==='failed'?['error']:value.status==='unknown'?[...refs,'error']:value.status==='superseded'?refs:[...refs,'nativeResult'];
  assert.deepEqual(Object.keys(value).sort(),[...base,...extra].sort(),'Queue terminal schema is incomplete or changed');
  assert.ok(hex.test(value.configSha256)&&hex.test(value.bundleSha256)&&Number.isFinite(Date.parse(value.at)));
  const ticket=await readQueueObject(path.join(directory,'tickets',requestId+'.json'));validateTicket(ticket.value,requestId+'.json');
  assert.equal(ticket.sha256,ticketSha256);assert.equal(ticket.value.configSha256,value.configSha256);assert.equal(ticket.value.bundleSha256,value.bundleSha256);
  if(value.status==='failed'){assert.equal(typeof value.error,'string');return value;}
  if(value.status==='blocked'){
   assert.ok(id.test(value.blockedDispatchId)&&hex.test(value.blockedDispatchSha256)&&typeof value.error==='string');
   const prior=await readQueueObject(path.join(directory,'dispatches',value.blockedDispatchId+'.json'));validateDispatch(prior.value,value.blockedDispatchId+'.json');
   assert.equal(prior.sha256,value.blockedDispatchSha256);assert.equal(prior.value.configSha256,value.configSha256);assert.equal(prior.value.bundleSha256,value.bundleSha256);return value;
  }
  assert.ok(id.test(value.dispatchId)&&hex.test(value.dispatchSha256)&&commit.test(value.selectedTarget)&&id.test(value.winnerRequestId));
  const read=await readQueueObject(path.join(directory,'dispatches',value.dispatchId+'.json')),dispatch=read.value;validateDispatch(dispatch,value.dispatchId+'.json');
  assert.equal(read.sha256,value.dispatchSha256);assert.equal(dispatch.selectedTarget,value.selectedTarget);assert.equal(dispatch.requestId,value.winnerRequestId);
  assert.equal(dispatch.configSha256,value.configSha256);assert.equal(dispatch.bundleSha256,value.bundleSha256);
  assert.ok(dispatch.tickets.some(ref=>ref.requestId===requestId&&ref.ticketSha256===ticketSha256),'Terminal belongs to another dispatch');
  if(value.status==='unknown'){assert.equal(typeof value.error,'string');return value;}
  if(value.status==='superseded'){assert.ok(ticket.value.observedTarget&&ticket.value.observedTarget!==value.selectedTarget);return value;}
  const result=value.nativeResult;assert.ok(result&&typeof result==='object'&&!Array.isArray(result));
  assert.equal(result.mainCommit??result.targetCommit,value.selectedTarget);assert.equal(result.publicationPerformed,false);
  assert.equal(result.status,value.status==='prepared'?'prepared-only':value.status==='current'?'already-current':'non-production');
  if(value.status==='prepared'){
   assert.deepEqual(Object.keys(result).sort(),['mainCommit','preparationFile','preparationSha256','publicationPerformed','status']);
   const preparationFile=path.join(dispatch.selection.packet,'publish-'+value.selectedTarget.slice(0,12),'preparation/PREPARED.json');
   assert.equal(path.resolve(result.preparationFile),path.resolve(preparationFile));assert.ok(hex.test(result.preparationSha256));
   const nativeRaw=await fs.readFile(preparationFile);assert.equal(sha(nativeRaw),result.preparationSha256,'Native preparation receipt changed');
   const native=JSON.parse(nativeRaw),request=JSON.parse(await fs.readFile(path.join(dispatch.selection.packet,'main-release-request.json'),'utf8'));
   assert.equal(native.version,'teruisi-main-preparation-v1');assert.equal(native.requestSha256,sha(Buffer.from(JSON.stringify(request))));
   assert.equal(native.sourceIdentity?.commit,value.selectedTarget);assert.equal(request.mainCommit,value.selectedTarget);
   assert.deepEqual(request.predecessorWorker,dispatch.selection.live.head);assert.equal(request.predecessorDjangoSha256,dispatch.selection.live.djangoManifestSha256);
   assert.equal(Boolean(native.workerPlan),request.components.includes('worker'));assert.equal(Boolean(native.djangoPackage),request.components.includes('django'));
  }else if(value.status==='current')assert.deepEqual(Object.keys(result).sort(),['currentCommit','publicationPerformed','status','targetCommit']);
  else assert.deepEqual(Object.keys(result).sort(),['currentCommit','packet','publicationPerformed','source','status','targetCommit']);
  return value;
}
function validateDispatch(value,name){
 assert.deepEqual(Object.keys(value).sort(),['bundleSha256','configSha256','deadlineUnixMs','dispatchId','dispatchedAt','mode','requestId','selectedTarget','selection','tickets','version']);
 assert.equal(value.version,queueVersion);assert.equal(value.dispatchId+'.json',name);assert.ok(id.test(value.dispatchId)&&id.test(value.requestId));
 assert.equal(value.mode,'prepare-only');assert.ok(hex.test(value.configSha256)&&hex.test(value.bundleSha256)&&commit.test(value.selectedTarget));
 assert.ok(Number.isSafeInteger(value.deadlineUnixMs)&&Number.isFinite(Date.parse(value.dispatchedAt)));
 assert.ok(value.selection&&value.selection.targetCommit===value.selectedTarget&&path.isAbsolute(value.selection.packet));
 assert.deepEqual(Object.keys(value.selection).sort(),['live','packet','targetCommit']);
 const live=value.selection.live;assert.ok(live&&commit.test(live.mainCommit)&&hex.test(live.chainStateSha256)&&hex.test(live.djangoManifestSha256)&&hex.test(live.head?.bindingSha256));
 assert.ok(Object.keys(live).every(key=>['mainCommit','source','sourceTree','head','chainStateSha256','djangoManifestSha256','completedReceiptPath','resolvedOriginalAttempt'].includes(key)),'Unknown predecessor selection field');
 assert.ok(Array.isArray(value.tickets)&&value.tickets.length>0&&value.tickets.length<4096);
 const seen=new Set();for(const ref of value.tickets){assert.deepEqual(Object.keys(ref).sort(),['observedTarget','requestId','ticketSha256']);assert.ok(id.test(ref.requestId)&&hex.test(ref.ticketSha256)&&!seen.has(ref.requestId));seen.add(ref.requestId);assert.ok(ref.observedTarget===null||commit.test(ref.observedTarget));}
 assert.ok(seen.has(value.requestId),'Dispatch winner missing');
}
/** observe may fetch/read only. prepare receives its exact frozen selection. */
export async function drainPreparationQueue(directory,{configSha256,bundleSha256,observe,prepare,assertGeneration=async()=>{},afterUnlock=async()=>{},onStage=async()=>{}}){
 assert.ok(hex.test(configSha256)&&hex.test(bundleSha256));await initializeQueue(directory);let handled=0;
 for(;;){
  const unlock=await acquireQueueLock(directory);if(!unlock)return {status:'queued',handled};
  try{
   for(;;){
    const tickets=await allTickets(directory),pending=[];
    for(const item of tickets)if(!await ticketResult(directory,item.value.requestId,item.sha256))pending.push(item);
    if(!pending.length)break;
    await assertGeneration();
    for(const item of pending)assert.ok(item.value.configSha256===configSha256&&item.value.bundleSha256===bundleSha256,'Queued configuration/code generation differs; preserve original ticket');
    // Any dispatched operation lacking all terminal receipts blocks new work.
    // Partial/invalid dispatch files block too; they are never treated as absent.
    let unresolved=null;
    for(const name of await entries(directory,'dispatches')){
     const read=await readQueueObject(path.join(directory,'dispatches',name)),dispatch=read.value;
     validateDispatch(dispatch,name);
     for(const ref of dispatch.tickets){
      assert.ok(id.test(ref.requestId)&&hex.test(ref.ticketSha256));
      const original=tickets.find(t=>t.value.requestId===ref.requestId);assert.ok(original&&original.sha256===ref.ticketSha256,'Dispatch ticket binding changed');
      const terminal=await ticketResult(directory,ref.requestId,ref.ticketSha256);
      if(!terminal||['unknown','failed','blocked'].includes(terminal.status))unresolved={dispatch,sha256:read.sha256};
     }
    }
    const finish=async(item,status,fields={})=>{
     await durableCreate(path.join(directory,'results',item.value.requestId+'.json'),{version:queueVersion,requestId:item.value.requestId,ticketSha256:item.sha256,status,at:new Date().toISOString(),configSha256,bundleSha256,...fields});handled++;
    };
    if(unresolved){
     for(const item of pending)await finish(item,'blocked',{blockedDispatchId:unresolved.dispatch.dispatchId,blockedDispatchSha256:unresolved.sha256,error:'Prior dispatch lacks a complete terminal result; no preparation replay'});
     break;
    }
    let selection;
    try{await onStage('before-observe');selection=await observe();await onStage('after-observe');}
    catch(error){for(const item of pending)await finish(item,'failed',{error:String(error.message)});continue;}
    assert.ok(commit.test(selection.targetCommit)&&selection.live&&commit.test(selection.live.mainCommit));
    assert.ok(selection.live.head&&hex.test(selection.live.head.bindingSha256)&&hex.test(selection.live.djangoManifestSha256)&&hex.test(selection.live.chainStateSha256),'Observed predecessor is incomplete');
    assert.ok(path.isAbsolute(selection.packet),'Frozen packet identity missing');
    await assertGeneration();
    const winner=pending.at(-1),dispatchId=randomUUID(),dispatch={version:queueVersion,dispatchId,requestId:winner.value.requestId,
     tickets:pending.map(item=>({requestId:item.value.requestId,ticketSha256:item.sha256,observedTarget:item.value.observedTarget})),
     mode:'prepare-only',configSha256,bundleSha256,selectedTarget:selection.targetCommit,selection,
     deadlineUnixMs:Date.now()+30*60*1000,dispatchedAt:new Date().toISOString()};
    await onStage('before-dispatch');
    const dispatchSha256=await durableCreate(path.join(directory,'dispatches',dispatchId+'.json'),dispatch);
    await onStage('after-dispatch');
    let result,error=null;
    try{await onStage('before-prepare');result=await prepare(selection,dispatch);await onStage('after-prepare');
     assert.equal(result.mainCommit??result.targetCommit,selection.targetCommit,'Preparation result target changed');
     assert.equal(result.publicationPerformed,false,'Queue cannot deploy');
     assert.ok(['prepared-only','already-current','non-production'].includes(result.status),'Native preparation did not complete');
    }catch(failure){error=failure;}
    // Never claim the target read before fetch is prepared when fetch selected
    // another commit. Manual latest requests with null target bind selection.
    for(const item of pending){
     const reference={dispatchId,dispatchSha256,selectedTarget:selection.targetCommit,winnerRequestId:winner.value.requestId};
     if(error)await finish(item,'unknown',{...reference,error:String(error.message)});
     else if(item.value.observedTarget&&item.value.observedTarget!==selection.targetCommit)await finish(item,'superseded',reference);
     else await finish(item,result.status==='prepared-only'?'prepared':result.status==='already-current'?'current':'non-production',{...reference,nativeResult:result});
    }
   }
  }finally{await unlock();}
  await afterUnlock();
  const remaining=await allTickets(directory);let more=false;
  for(const item of remaining)if(!await ticketResult(directory,item.value.requestId,item.sha256)){more=true;break;}
  if(!more)return {status:'drained',handled};
 }
}
