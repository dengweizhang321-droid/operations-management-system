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
  const admissionBlocked=value.status==='blocked'&&value.admission==='ordinary-user-before-dispatch-v1';
  const extra=admissionBlocked?['admission','error']:value.status==='blocked'?['blockedDispatchId','blockedDispatchSha256','error']:value.status==='failed'?['error']:value.status==='unknown'?[...refs,'error']:value.status==='superseded'?refs:[...refs,'nativeResult'];
  assert.deepEqual(Object.keys(value).sort(),[...base,...extra].sort(),'Queue terminal schema is incomplete or changed');
  assert.ok(hex.test(value.configSha256)&&hex.test(value.bundleSha256)&&Number.isFinite(Date.parse(value.at)));
  const ticket=await readQueueObject(path.join(directory,'tickets',requestId+'.json'));validateTicket(ticket.value,requestId+'.json');
  assert.equal(ticket.sha256,ticketSha256);assert.equal(ticket.value.configSha256,value.configSha256);assert.equal(ticket.value.bundleSha256,value.bundleSha256);
  if(value.status==='failed'){assert.equal(typeof value.error,'string');return value;}
  if(admissionBlocked){
   assert.equal(typeof value.error,'string');
   for(const name of await entries(directory,'dispatches')){const read=await readQueueObject(path.join(directory,'dispatches',name));validateDispatch(read.value,name);assert.ok(!read.value.tickets.some(ref=>ref.requestId===requestId),'A dispatched ticket cannot become a pre-dispatch admission rejection');}
   return value;
  }
  if(value.status==='blocked'){
   assert.ok(id.test(value.blockedDispatchId)&&hex.test(value.blockedDispatchSha256)&&typeof value.error==='string');
   const prior=await readQueueObject(path.join(directory,'dispatches',value.blockedDispatchId+'.json'));validateDispatch(prior.value,value.blockedDispatchId+'.json');
   assert.equal(prior.sha256,value.blockedDispatchSha256);
   return value;
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
export async function drainPreparationQueue(directory,{configSha256,bundleSha256,observe,prepare,assertGeneration=async()=>{},afterUnlock=async()=>{},onStage=async()=>{},admitPreparation=async()=>{},admitSelectedPreparation=async()=>{}}){
 assert.ok(hex.test(configSha256)&&hex.test(bundleSha256));await initializeQueue(directory);let handled=0;
 for(;;){
  const unlock=await acquireQueueLock(directory);if(!unlock)return {status:'queued',handled};
  try{
   for(;;){
    const tickets=await allTickets(directory),pending=[],completed=[];
    for(const item of tickets){
     const terminal=await ticketResult(directory,item.value.requestId,item.sha256);
     if(!terminal)pending.push(item);else if(terminal.status==='prepared')completed.push(terminal);
    }
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
      if(!terminal||['unknown','failed','blocked'].includes(terminal.status)){
       if(!terminal||(!await readFixedAdminRejectionResolution(directory,dispatch,terminal)&&!await readFixedSchemaRejectionResolution(directory,dispatch,terminal)&&!await readFixedCacheRejectionResolution(directory,dispatch,terminal)&&!await readFixedNativeAbandonmentResolution(directory,dispatch,terminal)&&!await readFixedCleanedPreparationResolution(directory,dispatch,terminal)&&!await readFixedStoppedNpmPreparationResolution(directory,dispatch,terminal)))unresolved={dispatch,sha256:read.sha256};
      }
     }
    }
    const finish=async(item,status,fields={})=>{
     await durableCreate(path.join(directory,'results',item.value.requestId+'.json'),{version:queueVersion,requestId:item.value.requestId,ticketSha256:item.sha256,status,at:new Date().toISOString(),configSha256,bundleSha256,...fields});handled++;
    };
    if(unresolved){
     for(const item of pending)await finish(item,'blocked',{blockedDispatchId:unresolved.dispatch.dispatchId,blockedDispatchSha256:unresolved.sha256,error:'Prior dispatch lacks a complete terminal result; no preparation replay'});
     break;
    }
    try{await admitPreparation();}
    catch(error){for(const item of pending)await finish(item,'blocked',{admission:'ordinary-user-before-dispatch-v1',error:String(error.message)});break;}
    let selection;
    try{await onStage('before-observe');selection=await observe();await onStage('after-observe');await admitSelectedPreparation(selection);assertFixedNativeNoReplay(directory,selection);assertFixedCleanedNoReplay(directory,selection);assertFixedStoppedNpmNoReplay(directory,selection);}
    catch(error){for(const item of pending)await finish(item,'failed',{error:String(error.message)});continue;}
    assert.ok(commit.test(selection.targetCommit)&&selection.live&&commit.test(selection.live.mainCommit));
    assert.ok(selection.live.head&&hex.test(selection.live.head.bindingSha256)&&hex.test(selection.live.djangoManifestSha256)&&hex.test(selection.live.chainStateSha256),'Observed predecessor is incomplete');
    assert.ok(path.isAbsolute(selection.packet),'Frozen packet identity missing');
    await assertGeneration();
    let reusablePreparation=null;
    for(const terminal of completed){
     if(terminal.configSha256!==configSha256||terminal.bundleSha256!==bundleSha256||terminal.selectedTarget!==selection.targetCommit)continue;
     const prior=await readQueueObject(path.join(directory,'dispatches',terminal.dispatchId+'.json'));
     if(canonical(prior.value.selection)===canonical(selection))reusablePreparation=terminal.nativeResult;
    }
    const winner=pending.at(-1),dispatchId=randomUUID(),dispatch={version:queueVersion,dispatchId,requestId:winner.value.requestId,
     tickets:pending.map(item=>({requestId:item.value.requestId,ticketSha256:item.sha256,observedTarget:item.value.observedTarget})),
     mode:'prepare-only',configSha256,bundleSha256,selectedTarget:selection.targetCommit,selection,
     deadlineUnixMs:Date.now()+60*60*1000,dispatchedAt:new Date().toISOString()};
    await onStage('before-dispatch');
    const dispatchSha256=await durableCreate(path.join(directory,'dispatches',dispatchId+'.json'),dispatch);
    await onStage('after-dispatch');
    let result,error=null;
    try{await onStage('before-prepare');result=await prepare(selection,dispatch,reusablePreparation);await onStage('after-prepare');
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

// FIXED_ADMIN_E2_BEGIN
const adminFixed=Object.freeze({
 version:'teruisi-admin-preparation-rejection-e2-v1',decision:'original-native-preparation-never-started-request-terminated',
 state:'D:/codex-isolated/main-manual-release-20261016',packet:'D:/codex-isolated/main-release-packages/4b733d1aed4b-c5d5bb6f-a9e3fdb9',
 dispatchId:'e2a76305-5a58-4814-8418-a35270a55efe',requestId:'d4dbd5aa-56b0-4705-834b-d6ee7dff1c79',
 target:'4b733d1aed4bdc619adccb37debd61d57f1ce6fb',
 bundleSha256:'0397f12e5f9a95d1b53d060d0007f89eb863543a5b43f7448ac60b61bfa896b3',
 configSha256:'635cc1db30275fd7a6840ce29a6d7a69bbc202e5a486a6d199367b66935eb09c',
 ticketSha256:'9257a54490f074083525a9e2eeb83cd5139ce0092673973a7917ff74b45aabd9',
 dispatchSha256:'d3fb28ce5a7f62c57c0be3d4d533d8eaa33f63ff1159332042ce3faed68649d2',
 resultSha256:'ac8b2ed476f023098ac1f7f291d48ab7da4012edd6b1d6204ac8d66a2b9f604f',
 progressSha256:'d3e598fa55e83240e2f0f472eb2b4e46af610a25795a05935c7cfc80a751bdc3',
 requestSha256:'018141b5fa288e4f2f6806e5d5e1b5fd5faed34838a50199e5f66656a4b0718c',
 scopeSha256:'0d665f8766c8e63511ce97a73b1dc04f98365a2f9e58fcc2601ea992190858fb',
 publisherSha256:'2a79dc481b8a2fc26eee6ccc271854e739c0c3a5614ed19cb0d4dd7557a607f2',
 bundleManifestSha256:'1814ab7284f75e80ba2f521415bf8f74edeada321cf173cf762bc0a4e5356856',
 bundlePublisherSha256:'b7d98d2ec2aaa7e0da15f92dce91d8655da3a355d15a09ce9db5bff42f115822',
 blockedRequestId:'b5f3a030-5238-4d78-98dd-cb593a142567',
 blockedTicketSha256:'e7e728608b97cf7a561697a0f89b91a796839bd594bce8f39c3969adc22e5ec0',
 blockedResultSha256:'3352a5553d26c76ab50fc738089a0e7b1f4278c08f371c140093510e6fa9f099',
});
const adminActors=Object.freeze([
 {file:'0627e438-5c1b-417d-929e-42d7afce5a9a.json',sha256:'f9c9c03f8cf11b707d543544fa46ca660d4b8698120b53289958217e0587de0a',pid:2552,birth:'2026-10-18T09:44:13.7429060Z'},
 {file:'f936a77f-337a-4d98-b156-730ecdd91dc8.json',sha256:'4ec51e536162607e8ff491c01f6ac64743efa0e18a4daa0e63c4af8872e5bf2d',pid:12376,birth:'2026-10-18T09:44:29.7396960Z'},
 {file:'06f749ac-ec1b-4707-a604-e895d1a392ca.json',sha256:'34af57bd948c1fb84fbe06c9f088eaf09a46be28ba50a61cc3dc7dcf4f270c36',pid:23444,birth:'2026-10-18T09:44:30.8690320Z'},
 {file:'1d131cff-b8d2-4847-8f85-ed82ec783bdb.json',sha256:'acf47c2d105d544c0864b3221065797912f878021e30aa87d731863e903ca24e',pid:34284,birth:'2026-10-18T09:44:12.7474900Z'},
]);
const adminQueueRoot=path.join(adminFixed.state,'prebuild-queue-v2');
const adminApprovedObserverSha256='5b3f2d4d4c19f7392ae4ec989d28800b01787ba2c5522e9bd84f80eaa2b7f973';
const adminScopedObserverSha256='dcb3dd18b81d8c680ac494dd705ed374374fe040469f873708031a84247f571d';
export const fixedAdminObserverQualifications=Object.freeze([adminApprovedObserverSha256,adminScopedObserverSha256]);
function adminObservationTicks(value){
 assert.match(value??'',/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}(?:Z|\+00:00)$/);
 const seconds=value.slice(0,19),milliseconds=Date.parse(seconds+'Z');assert.ok(Number.isFinite(milliseconds));assert.equal(new Date(milliseconds).toISOString().slice(0,19),seconds);
 return BigInt(milliseconds)*10000n+BigInt(value.slice(20,27));
}
function adminValidateScopedObservation(observation){
 assert.equal(observation.scope,'original-dispatch-and-known-controller-paths');assert.ok(Array.isArray(observation.opaqueExclusions));
 const earliest=adminObservationTicks('2026-10-18T09:44:12.7474900Z'),excluded=new Set();
 for(const exclusion of observation.opaqueExclusions){
  assert.equal(exclusion.reason,'not-descended-from-original-actors');assert.ok(Array.isArray(exclusion.chain)&&exclusion.chain.length>0&&exclusion.chain.length<=128);assert.equal(exclusion.pid,exclusion.chain[0].pid);assert.ok(!excluded.has(exclusion.pid));excluded.add(exclusion.pid);
  const seen=new Set();
  for(const [index,row] of exclusion.chain.entries()){
   assert.ok(Number.isSafeInteger(row.pid)&&row.pid>0&&row.pid<=0xffffffff);assert.ok(Number.isSafeInteger(row.parentPid)&&row.parentPid>=0&&row.parentPid<=0xffffffff);assert.ok(typeof row.name==='string'&&row.name.trim());assert.ok(!seen.has(row.pid));seen.add(row.pid);
   const birth=adminObservationTicks(row.birth),actor=observation.actors.find(actor=>actor.pid===row.pid);
   if(actor){assert.equal(actor.state,'reused-unrelated-pid');assert.equal(adminObservationTicks(actor.currentBirth),birth);}
   if(index===exclusion.chain.length-1)assert.ok(birth<earliest,'Opaque ancestry must reach a preexisting process');
   else{assert.ok(birth>=earliest,'Opaque ancestry must stop at its first preexisting process');const parent=exclusion.chain[index+1];assert.equal(row.parentPid,parent.pid);assert.ok(adminObservationTicks(parent.birth)<=birth,'Parent PID was reused after child creation');}
  }
 }
}

const controlNames=['publish-latest-main.mjs','publish-main-progress.mjs','release-scope-plan.mjs','main-prebuild-hook.mjs','main-schema-release.mjs','main-prebuild-status.mjs','main-prebuild-queue.mjs','main-control-dispatch.mjs'].map(name=>'tools/'+name).sort();
const adminSourceFiles=Object.freeze({
 'tools/publish-main.mjs':adminFixed.publisherSha256,
 'tools/main-schema-release.mjs':'d99a9ff211cb0a86be4d37eb4bfa5d2ff265f519d11089bd38403b99343a0eb4',
 'tools/publish-prepared-main.mjs':'d6fc255d217ec287a0c8f7dbd126373333b87fa0352ec85b13c7485b2b7e360e',
 'tools/worker-local-release.mjs':'dad4e7a1625c4d174541c81669b8c65c0e76bef43e723a87d014947cce362103',
 'tools/worker-local-release-rotation.mjs':'8b3ec38f47c247c6b0d69c62ab0efb105f63cada945ec40cf7debe76f5ff35d7',
 'tools/release-batch.mjs':'63fbc4d1bf8424d48a27077304a86892070d821f490208a2d26a4bf9894a6a96',
 'tools/publish-main-progress.mjs':'812d82d352fce8ce43a3b42aabcb2fa53cbcfa9c98b7524a33d0de3b521af714',
 'tools/publish-main-known-resume.mjs':'515c7a2ccdce60b277aeb42252ba2f61495002ebf828d5aa201aaeff387f61dc',
 'tools/publish-main-command.mjs':'b711a41c401e7619e175347e6ba3490e5d5655d5dca5c9dc840ac345b8a7bfc7',
 'tools/manual-maintenance-continuation.mjs':'bc7fc81301c81cd25573f8b40338882329bb16be3391d72d5ce88fbcf00de16d',
 'tools/d1-retirement-proof.mjs':'87cf58e5ab5cac1dd9e77a4502e24b2769e4a121b5bb173dd53d45d913f6bc76',
 'tools/release-no-data-observation.mjs':'ab29843bca7c9afa7ad328fb6ba33d2f330f0c49dbb59fe50965d7a041508d4d',
 'tools/release-impact.mjs':'197f570c641922bb5ea96e053e2f37497586fa4a86c1fa6f4a1367b29c3a4164',
 'tools/release-readonly-retry.mjs':'1139287b2f9633dce57d7ea0b525e082c66382f521577c594817119f3f234ef6',
});
function adminOriginalFiles(){return [
 [path.join(adminQueueRoot,'tickets',adminFixed.requestId+'.json'),adminFixed.ticketSha256],
 [path.join(adminQueueRoot,'dispatches',adminFixed.dispatchId+'.json'),adminFixed.dispatchSha256],
 [path.join(adminQueueRoot,'results',adminFixed.requestId+'.json'),adminFixed.resultSha256],
 [path.join(adminQueueRoot,'tickets',adminFixed.blockedRequestId+'.json'),adminFixed.blockedTicketSha256],
 [path.join(adminQueueRoot,'results',adminFixed.blockedRequestId+'.json'),adminFixed.blockedResultSha256],
 [path.join(adminFixed.packet,'main-release-request.json'),adminFixed.requestSha256],
 [path.join(adminFixed.packet,'release-scope-plan.json'),adminFixed.scopeSha256],
 [path.join(adminFixed.packet,'source/tools/publish-main.mjs'),adminFixed.publisherSha256],
 [path.join(adminFixed.packet,'logs/release-2026-10-18T09-44-54.221Z-26cbf96e-b964-4529-908a-842a0a60904f.log'),adminFixed.progressSha256],
 [path.join(adminQueueRoot,'runner-0847ec0f-044a-4305-8f3c-c3a7321cb2b0.log'),adminFixed.progressSha256],
 [path.join(adminFixed.state,'control-bundles',adminFixed.bundleSha256,'MANIFEST.json'),adminFixed.bundleManifestSha256],
 [path.join(adminFixed.state,'control-bundles',adminFixed.bundleSha256,'tools/publish-latest-main.mjs'),adminFixed.bundlePublisherSha256],
 ...adminActors.map(actor=>[path.join(adminFixed.state,'control-executions',actor.file),actor.sha256]),
 ];}
async function adminStableRead(file){
 assert.equal(path.resolve(await fs.realpath(file)).toLowerCase(),path.resolve(file).toLowerCase(),'Redirected finite resolution evidence');
 const before=await fs.lstat(file);assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1&&before.size<=4*1024*1024);
 const raw=await fs.readFile(file),after=await fs.lstat(file);
 for(const name of ['dev','ino','size','mtimeMs','ctimeMs','nlink'])assert.equal(after[name],before[name],'Finite evidence changed while read');
 return raw;
}
async function adminVerifyOriginals({read=adminStableRead,sourceIdentity=async()=>({commit:adminFixed.target,status:''})}={}){
 const raw=new Map(),bindings=Object.fromEntries(adminOriginalFiles());
 for(const [name,digest] of Object.entries(adminSourceFiles))bindings[path.join(adminFixed.packet,'source',name)]=digest;
 const manifestFile=path.join(adminFixed.state,'control-bundles',adminFixed.bundleSha256,'MANIFEST.json');
 const manifestRaw=await read(manifestFile);assert.equal(sha(manifestRaw),adminFixed.bundleManifestSha256);
 const manifest=JSON.parse(manifestRaw);assert.equal(manifest.bundleSha256,adminFixed.bundleSha256);assert.deepEqual(Object.keys(manifest.files).sort(),controlNames);
 for(const [name,digest] of Object.entries(manifest.files)){assert.match(name,/^tools\/[a-z0-9-]+\.mjs$/);bindings[path.join(adminFixed.state,'control-bundles',adminFixed.bundleSha256,name)]=digest;}
 for(const [file,expected] of Object.entries(bindings)){const bytes=await read(file);assert.equal(sha(bytes),expected,'Pinned original changed: '+file);raw.set(file,bytes);}
 const result=JSON.parse(raw.get(path.join(adminQueueRoot,'results',adminFixed.requestId+'.json')));
 const dispatch=JSON.parse(raw.get(path.join(adminQueueRoot,'dispatches',adminFixed.dispatchId+'.json')));
 assert.equal(result.status,'unknown');assert.equal(result.dispatchSha256,adminFixed.dispatchSha256);assert.equal(result.requestId,adminFixed.requestId);
 assert.equal(dispatch.selectedTarget,adminFixed.target);assert.equal(dispatch.bundleSha256,adminFixed.bundleSha256);assert.equal(dispatch.configSha256,adminFixed.configSha256);
 assert.deepEqual(dispatch.tickets,[{observedTarget:adminFixed.target,requestId:adminFixed.requestId,ticketSha256:adminFixed.ticketSha256}]);
 const blocked=JSON.parse(raw.get(path.join(adminQueueRoot,'results',adminFixed.blockedRequestId+'.json')));assert.equal(blocked.status,'blocked');assert.equal(blocked.blockedDispatchId,adminFixed.dispatchId);assert.equal(blocked.dispatchId,undefined);
 const identity=await sourceIdentity();assert.deepEqual(identity,{commit:adminFixed.target,status:''});
 const publisher=raw.get(path.join(adminFixed.packet,'source/tools/publish-main.mjs')).toString('utf8');
 const token=publisher.indexOf("assert.equal(token.stdout.trim(),'False','请用普通用户执行固定发布入口，不需要管理员权限')");
 const native=publisher.indexOf('await publishPreparedMain(request,');assert.ok(token>=0&&native>token,'The qualified elevation gate must precede the native call');
 const log=raw.get(path.join(adminQueueRoot,'runner-0847ec0f-044a-4305-8f3c-c3a7321cb2b0.log')).toString('utf8');
 assert.ok(log.includes("'True' !== 'False'")&&log.includes('请用普通用户执行固定发布入口，不需要管理员权限'));
 for(const actor of adminActors){const receipt=JSON.parse(raw.get(path.join(adminFixed.state,'control-executions',actor.file)));assert.equal(receipt.pid,actor.pid);assert.equal(receipt.createdAt,actor.birth);assert.equal(receipt.bundleSha256,adminFixed.bundleSha256);}
 return {version:adminFixed.version,dispatchId:adminFixed.dispatchId,requestId:adminFixed.requestId,originals:bindings,gate:'ordinary-user-admission-before-native-call',sourceIdentity:identity};
}
/** Historical proof validation: no comparison to the current newest bundle/time. */
function adminValidateResolution(value,{originals,observation,adoption}){
 assert.deepEqual(Object.keys(value).sort(),['adoptionSha256','at','decision','dispatchId','dispatchSha256','evidenceDirectory','historicalAdoption','nativePreparationStarted','observationSha256','originalResultSha256','originals','prepared','publicationPerformed','requestId','retryOriginal','targetCommit','version','writerPid'].sort());
 assert.equal(value.version,adminFixed.version);assert.equal(value.decision,adminFixed.decision);assert.equal(value.dispatchId,adminFixed.dispatchId);assert.equal(value.requestId,adminFixed.requestId);assert.equal(value.targetCommit,adminFixed.target);
 assert.equal(value.dispatchSha256,adminFixed.dispatchSha256);assert.equal(value.originalResultSha256,adminFixed.resultSha256);assert.deepEqual(value.originals,originals.originals);
 for(const name of ['nativePreparationStarted','prepared','publicationPerformed','retryOriginal'])assert.equal(value[name],false,name);
 assert.ok(['teruisi-admin-rejection-observation-e2-v1','teruisi-admin-rejection-observation-e2-v2'].includes(observation.version));if(observation.version.endsWith('-v2'))adminValidateScopedObservation(observation);assert.equal(observation.dispatchId,adminFixed.dispatchId);assert.equal(observation.originalsSha256,sha(Buffer.from(canonical(originals))));
 assert.deepEqual(observation.relatedControllers,[]);assert.equal(observation.packetPublishDirectoryAbsent,true);assert.equal(observation.invocationsEmpty,true);
 assert.ok(Number.isSafeInteger(observation.observerPid)&&observation.observerPid>0);
 assert.ok(Number.isSafeInteger(value.writerPid)&&value.writerPid>0&&value.writerPid!==observation.observerPid);assert.equal(observation.writerPid,value.writerPid);
 assert.equal(observation.observerCodeSha256,observation.version.endsWith('-v2')?adminScopedObserverSha256:adminApprovedObserverSha256);assert.match(observation.observerCommandLineSha256??'',/^[a-f0-9]{64}$/);assert.ok(Number.isFinite(Date.parse(observation.observerCreationDate)));
 assert.deepEqual(observation.actors.map(row=>({pid:row.pid,originalBirth:row.originalBirth})),adminActors.map(actor=>({pid:actor.pid,originalBirth:actor.birth})));
 for(const row of observation.actors){assert.ok(['absent','reused-unrelated-pid'].includes(row.state));if(row.state==='reused-unrelated-pid'){assert.ok(row.currentBirth&&Date.parse(row.currentBirth)>Date.parse(row.originalBirth));assert.ok(row.currentName);}}
 const delay=Date.parse(value.at)-Date.parse(observation.at);assert.ok(Number.isFinite(delay)&&delay>=0&&delay<60000,'Observation was not fresh at resolution write');
 assert.equal(adoption.version,'teruisi-main-control-installation-v2');assert.equal(adoption.status,'adopted');assert.notEqual(adoption.bundleSha256,adminFixed.bundleSha256);assert.match(adoption.bundleSha256,/^[a-f0-9]{64}$/);
 assert.ok(Date.parse(adoption.adoptedAt)<=Date.parse(value.at));
 return {status:'terminated-before-native-preparation',replayOriginal:false,prepared:false,publicationPerformed:false};
}
async function adminReadResolution({file=path.join(adminQueueRoot,'resolutions',adminFixed.dispatchId+'.json'),read=adminStableRead,sourceIdentity}={}){
 const raw=await read(file),value=JSON.parse(raw);assert.equal(raw.toString(),canonical(value));
 const evidence=path.join(adminQueueRoot,'resolutions',adminFixed.dispatchId+'-evidence');assert.equal(path.resolve(value.evidenceDirectory),path.resolve(evidence));
 const object=async digest=>{assert.match(digest,/^[a-f0-9]{64}$/);const bytes=await read(path.join(evidence,'objects',digest+'.bin'));assert.equal(sha(bytes),digest,'Archived dependency changed');return bytes;};
 const historicalRead=async originalFile=>{
  if(originalFile.startsWith(adminQueueRoot+path.sep)&&/^(tickets|results|dispatches)[\\/]/.test(path.relative(adminQueueRoot,originalFile)))return read(originalFile);
  const digest=value.originals[originalFile];assert.match(digest??'',/^[a-f0-9]{64}$/);return object(digest);
 };
 // The original source was clean when this historical closure was written.
 // Requiring a live source worktree forever would invalidate retention cleanup.
 const original=await adminVerifyOriginals({read:historicalRead,sourceIdentity:async()=>({commit:adminFixed.target,status:''})});
 const observationRaw=await object(value.observationSha256),adoptionRaw=await object(value.adoptionSha256);
 await object(JSON.parse(observationRaw).observerCodeSha256);
 assert.equal(sha(observationRaw),value.observationSha256);assert.equal(sha(adoptionRaw),value.adoptionSha256);
 const adoption=JSON.parse(adoptionRaw),history=value.historicalAdoption;
 assert.equal(history.bundleManifestSha256,adoption.bundleManifestSha256);assert.equal(history.intentSha256,adoption.intentSha256);assert.equal(history.transitionProofSha256,adoption.transitionProofSha256);
 const intent=JSON.parse(await object(history.intentSha256)),transition=JSON.parse(await object(history.transitionProofSha256));
 assert.equal(intent.version,'teruisi-main-control-upgrade-v2');assert.equal(intent.installId,adoption.installId);
 for(const name of ['bundleRoot','bundleSha256','bundleManifestSha256','dispatcherSha256','hook','hookSha256','configSha256'])assert.equal(intent[name],adoption[name]);
 assert.equal(path.resolve(intent.stateDirectory),path.resolve(adminFixed.state));assert.equal(path.resolve(intent.configFile),path.resolve(adminFixed.state,'main-publisher-config.json'));
 assert.equal(path.resolve(adoption.bundleRoot),path.resolve(adminFixed.state,'control-bundles',adoption.bundleSha256));
 assert.equal(path.dirname(path.resolve(adoption.transitionProofFile)),path.resolve(adminFixed.state,'control-upgrades',adoption.installId));assert.match(path.basename(adoption.transitionProofFile),/^TRANSITION-[a-f0-9-]{36}\.json$/);
 assert.equal(transition.version,'teruisi-main-control-transition-v2');assert.equal(transition.installId,adoption.installId);assert.equal(transition.intentSha256,adoption.intentSha256);
 assert.deepEqual(transition.lockOrder,['v1-queue','v2-queue','native-rotation']);assert.equal(transition.privateTestTopology,false);assert.equal(transition.rotationPipeSha256,sha('\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1'));assert.equal(transition.legacyWindowConverged,true);assert.equal(transition.productionDeploymentPerformed,false);
 assert.ok(Array.isArray(transition.frames)&&transition.frames.length>=3);for(const frame of transition.frames.slice(-3)){assert.deepEqual(frame.related,[]);assert.ok(Date.parse(frame.at)<=Date.parse(adoption.adoptedAt));}
 const config=JSON.parse(await object(adoption.configSha256));assert.equal(config.controlProtocol,'teruisi-main-control-v2');assert.equal(path.resolve(config.stateDirectory),path.resolve(adminFixed.state));
 await object(adoption.dispatcherSha256);await object(adoption.hookSha256);
 const bundle=JSON.parse(await object(history.bundleManifestSha256));assert.equal(bundle.version,'teruisi-main-control-bundle-v2');assert.equal(bundle.sourceCommit,intent.sourceCommit);assert.equal(bundle.sourceTree,intent.sourceTree);assert.equal(bundle.bundleSha256,adoption.bundleSha256);assert.equal(sha(Buffer.from(canonical(bundle.files))),adoption.bundleSha256);assert.deepEqual(Object.keys(bundle.files).sort(),controlNames);
 for(const [name,digest] of Object.entries(bundle.files)){assert.match(name,/^tools\/[a-z0-9-]+\.mjs$/);await object(digest);}
 return adminValidateResolution(value,{originals:original,observation:JSON.parse(observationRaw),adoption});
}

export const fixedAdminRejectionVersion=adminFixed.version;
export async function readFixedAdminRejectionResolution(directory,dispatch,terminal){
 if(path.resolve(directory).toLowerCase()!==path.resolve(adminQueueRoot).toLowerCase()||dispatch.dispatchId!==adminFixed.dispatchId||terminal?.requestId!==adminFixed.requestId||terminal.status!=='unknown')return false;
 const file=path.join(directory,'resolutions',adminFixed.dispatchId+'.json');
 try{await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return false;throw error;}
 await adminReadResolution({file});return true;
}
export async function assertFixedAdminResolutionInventory(directory){
 assert.equal(path.resolve(directory).toLowerCase(),path.resolve(adminQueueRoot).toLowerCase());
 for(const item of await allTickets(directory)){
  const terminal=await ticketResult(directory,item.value.requestId,item.sha256);assert.ok(terminal,'Pending ticket remains; no silent termination');
  if(terminal.status==='blocked'&&terminal.admission!=='ordinary-user-before-dispatch-v1')assert.equal(terminal.blockedDispatchId,adminFixed.dispatchId,'Other unresolved dispatch remains');
 }
 for(const name of await entries(directory,'dispatches')){
  const read=await readQueueObject(path.join(directory,'dispatches',name));validateDispatch(read.value,name);
  for(const reference of read.value.tickets){
   const terminal=await ticketResult(directory,reference.requestId,reference.ticketSha256);assert.ok(terminal);
   if(['unknown','failed','blocked'].includes(terminal.status)){assert.equal(read.value.dispatchId,adminFixed.dispatchId);assert.equal(read.sha256,adminFixed.dispatchSha256);assert.equal(terminal.requestId,adminFixed.requestId);assert.equal(terminal.status,'unknown');}
  }
 }
}
// FIXED_ADMIN_E2_END

// FIXED_SCHEMA_ECE_BEGIN: one awaited, terminated rejection; never a retry.
export const fixedSchemaRejection=Object.freeze({
 version:'teruisi-schema-before-native-ece-v1',state:'D:/codex-isolated/main-manual-release-20261016',
 packet:'D:/codex-isolated/main-release-packages/a7041338462a-997d0568-ca9c731a',
 target:'a7041338462acb766a50df376777c619557ea4eb',base:'6dc028139cc6e561dcad68d76c9d673596d9ec82',
 dispatchId:'ece64080-a14c-4314-9e91-c7a8c48171fb',requestId:'7964788d-da95-49ec-bb08-2ef409faf711',
 bundleSha256:'f5333eb4de9133305012cf545b6547a2e5293c278011bfab35ba7f7eb952f204',
 configSha256:'635cc1db30275fd7a6840ce29a6d7a69bbc202e5a486a6d199367b66935eb09c',
 ticketSha256:'7035d2df9de4bb4d8dd15607467f8f547603957109a1075a2c8ae31a8a2e7cde',
 dispatchSha256:'cf14be54c343d7fd171729f916acf017b0f7e27c4fa9908922d7851335a62487',
 resultSha256:'4f47838d15eb5ac8445181680fea1b79bad3a7e3a37b85b5bcccfbb6c3550789',
 manifestSha256:'2f6f1bec58d0f19c731d152a5a64d49d7c07573dd36a23266de9fbb0c9abcf13',
 oldInstallationSha256:'39109672bd8fd49c6c94a3db410ec18733e42878e76f49f9163065cd8e97d135',
 planSha256:'5b43666e67e5a41a14bdd81b3ab498a25ab2bc47915b732d440ac3c4601604c4',
 observerSha256:'43ceef9a9fc5f3aa443607bdc62a865598c346a0263771a73ba8bf9a49729e2e',
});
const schemaQueueRoot=path.join(fixedSchemaRejection.state,'prebuild-queue-v2');
const schemaControlNames=['main-control-dispatch.mjs','main-prebuild-hook.mjs','main-prebuild-queue.mjs','main-prebuild-status.mjs','main-prebuild-task.mjs','main-schema-release.mjs','publish-latest-main.mjs','publish-main-progress.mjs','release-scope-plan.mjs'].map(name=>'tools/'+name).sort();
const schemaOperatorNames=['main-prebuild-queue.mjs','main-prebuild-task.mjs','main-control-dispatch.mjs','main-schema-release.mjs','release-scope-plan.mjs','frozen-main-source.mjs','schema-rejection-writer.mjs','schema-rejection-observer.mjs'];
export async function assertSchemaArtifactDirectory(directory,{allowMissing=false}={}){
 const absolute=path.resolve(directory);assert.ok(absolute.toLowerCase().startsWith('d:\\codex-artifacts\\'),'Operator output must stay inside private artifact storage');
 for(let cursor=absolute;;cursor=path.dirname(cursor)){
  try{const info=await fs.lstat(cursor);assert.ok(info.isDirectory()&&!info.isSymbolicLink(),'Artifact parent is redirected');assert.equal(path.resolve(await fs.realpath(cursor)).toLowerCase(),cursor.toLowerCase(),'Artifact physical path differs');}catch(error){if(error.code!=='ENOENT'||!allowMissing)throw error;}
  if(path.dirname(cursor)===cursor)break;
 }
 return absolute;
}
export const schemaCensusScript='$probe=$PID;$rows=@(Get-CimInstance Win32_Process -ErrorAction Stop|Where-Object{$_.ProcessId -ne $probe}|ForEach-Object{@{processId=[int]$_.ProcessId;parentProcessId=[int]$_.ParentProcessId;name=[string]$_.Name;creationDate=$(if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString("o")}else{$null});executablePath=$_.ExecutablePath;commandLine=$_.CommandLine}});@{rows=$rows;elevated=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))}|ConvertTo-Json -Depth 5 -Compress';
const schemaControlName=name=>/^(powershell|pwsh|node|python|pythonw|wsl|workerd)(\.exe)?$/i.test(name??'');
function schemaControlPath(text){const state=fixedSchemaRejection.state.replaceAll('\\','/').toLowerCase(),releases=path.dirname(fixedSchemaRejection.packet).replaceAll('\\','/').toLowerCase();return text.includes(state+'/control/')||text.includes(state+'/control-bundles/')||text.includes(state+'/control-upgrades/')||(text.includes(releases+'/')&&(/\/source\/tools\//.test(text)||/publish-main|process-deadline|manual-maintenance/.test(text)))||/(?:worker-local-service|django-local-service|operations-system-(?:control|service))\.ps1/i.test(text);}
export function schemaCensusProjection(rows){return rows.map(row=>({processId:row.processId,parentProcessId:row.parentProcessId,name:row.name,creationDate:row.creationDate,commandLineSha256:row.commandLine?sha(Buffer.from(row.commandLine)):null,executablePathSha256:row.executablePath?sha(Buffer.from(row.executablePath)):null,controlCandidate:schemaControlName(row.name)||(row.commandLine?schemaControlPath(decodeSchemaControlCommand(row.commandLine)):false)})).sort((a,b)=>a.processId-b.processId);}
export function assertSchemaWitnessCensus(witness,current,{protectedActors=[]}={}){
 const projected=schemaCensusProjection(current),known=new Map(),seen=new Set();assert.ok(Array.isArray(witness)&&witness.length>0);
 for(const row of witness){assert.deepEqual(Object.keys(row).sort(),['processId','parentProcessId','name','creationDate','commandLineSha256','executablePathSha256','controlCandidate'].sort());assert.ok(Number.isSafeInteger(row.processId)&&row.processId>=0&&!seen.has(row.processId));seen.add(row.processId);assert.ok(Number.isSafeInteger(row.parentProcessId)&&row.parentProcessId>=0&&typeof row.name==='string'&&row.name);assert.equal(typeof row.controlCandidate,'boolean');for(const key of ['commandLineSha256','executablePathSha256'])assert.ok(row[key]===null||hex.test(row[key]));if(row.controlCandidate)known.set(row.processId,row);}
 const compare=(row,before)=>{assert.ok(before,'New opaque process after witness');for(const key of ['processId','parentProcessId','name','creationDate'])assert.equal(row[key],before[key],'Process identity changed after witness');for(const key of ['commandLineSha256','executablePathSha256']){assert.match(before[key]??'',hex,'Witness did not expose a complete possible-controller identity');if(row[key]!==null)assert.equal(row[key],before[key],'Visible metadata changed after witness');}};
 const protectedPids=new Map();for(const actor of protectedActors){const before=known.get(actor.processId),actual=projected.find(row=>row.processId===actor.processId);assert.ok(actual&&before,'Protected writer/observer is no longer live');compare(actual,before);assert.equal(before.creationDate,actor.creationDate);assert.equal(before.commandLineSha256,sha(Buffer.from(actor.commandLine)));assert.equal(before.executablePathSha256,sha(Buffer.from(actor.executablePath)));protectedPids.set(actor.processId,actual);}
 const byPid=new Map(projected.map(row=>[row.processId,row]));for(const row of current){
  if(protectedPids.has(row.processId))continue;
  const readable=!!(row.commandLine&&row.executablePath&&row.creationDate);
  if(schemaControlName(row.name)&&!readable)compare(byPid.get(row.processId),known.get(row.processId));
  else if(row.commandLine)assert.equal(schemaControlPath(decodeSchemaControlCommand(row.commandLine)),false,'A current lifecycle controller appeared after witness');
  const parent=protectedPids.get(row.parentProcessId);if(parent){assert.ok(row.creationDate&&Number.isFinite(Date.parse(row.creationDate))&&Number.isFinite(Date.parse(parent.creationDate)),'Protected actor descendant identity unknown');if(Date.parse(row.creationDate)>=Date.parse(parent.creationDate))throw Error('A protected writer/observer descendant remains');}
 }
 return true;
}
const schemaOriginalNames=()=>[
 ['prebuild-queue-v2/tickets/'+fixedSchemaRejection.requestId+'.json',fixedSchemaRejection.ticketSha256],
 ['prebuild-queue-v2/dispatches/'+fixedSchemaRejection.dispatchId+'.json',fixedSchemaRejection.dispatchSha256],
 ['prebuild-queue-v2/results/'+fixedSchemaRejection.requestId+'.json',fixedSchemaRejection.resultSha256],
 ['main-publisher-config.json',fixedSchemaRejection.configSha256],
 ['control-bundles/'+fixedSchemaRejection.bundleSha256+'/MANIFEST.json',fixedSchemaRejection.manifestSha256],
];
export async function schemaRejectionOriginals({read=adminStableRead}={}){
 const raw=new Map(),files={};
 for(const [name,expected] of schemaOriginalNames()){const file=path.join(fixedSchemaRejection.state,name),bytes=await read(file);assert.equal(sha(bytes),expected,'Original schema rejection changed');files[file]=expected;raw.set(name,bytes);}
 const manifest=JSON.parse(raw.get('control-bundles/'+fixedSchemaRejection.bundleSha256+'/MANIFEST.json'));
 assert.equal(manifest.version,'teruisi-main-control-bundle-v2');assert.equal(manifest.bundleSha256,fixedSchemaRejection.bundleSha256);assert.equal(manifest.sourceCommit,fixedSchemaRejection.base);assert.deepEqual(Object.keys(manifest.files).sort(),schemaControlNames);assert.equal(sha(Buffer.from(canonical(manifest.files))),manifest.bundleSha256);
 for(const [name,expected] of Object.entries(manifest.files)){const file=path.join(fixedSchemaRejection.state,'control-bundles',fixedSchemaRejection.bundleSha256,name),bytes=await read(file);assert.equal(sha(bytes),expected,'Original complete control closure changed');files[file]=expected;raw.set(name,bytes);}
 const ticket=JSON.parse(raw.get(schemaOriginalNames()[0][0])),dispatch=JSON.parse(raw.get(schemaOriginalNames()[1][0])),terminal=JSON.parse(raw.get(schemaOriginalNames()[2][0]));
 validateTicket(ticket,fixedSchemaRejection.requestId+'.json');validateDispatch(dispatch,fixedSchemaRejection.dispatchId+'.json');
 assert.equal(dispatch.selectedTarget,fixedSchemaRejection.target);assert.equal(dispatch.selection.live.mainCommit,fixedSchemaRejection.base);assert.equal(path.resolve(dispatch.selection.packet),path.resolve(fixedSchemaRejection.packet));assert.equal(dispatch.bundleSha256,fixedSchemaRejection.bundleSha256);assert.equal(dispatch.configSha256,fixedSchemaRejection.configSha256);
 assert.deepEqual(dispatch.tickets,[{observedTarget:fixedSchemaRejection.target,requestId:fixedSchemaRejection.requestId,ticketSha256:fixedSchemaRejection.ticketSha256}]);
 assert.equal(terminal.status,'unknown');assert.equal(terminal.dispatchSha256,fixedSchemaRejection.dispatchSha256);assert.equal(terminal.requestId,fixedSchemaRejection.requestId);assert.equal(terminal.error,'最新main含新增或改写迁移，尚无对应结构发布包；本次未部署');
 // Full pinned byte closure plus these fixed call edges prove the rejected
 // promise cannot later resume into binder/native. No historical PID is known.
 const publisher=raw.get('tools/publish-latest-main.mjs').toString(),queue=raw.get('tools/main-prebuild-queue.mjs').toString(),schema=raw.get('tools/main-schema-release.mjs').toString();
 assert.ok(publisher.includes('const prepared=await once(config,selection,')&&publisher.includes('const schemaRelease=plan.migrate?await prepareSchema('));
 assert.ok(queue.includes('result=await prepare(selection,dispatch,reusablePreparation)')&&queue.includes("if(error)await finish(item,'unknown'"));
 assert.ok(schema.includes('const spec=planSpec(plan);')&&schema.indexOf('const spec=planSpec(plan);')<schema.indexOf('let raw;try{raw=await regular'));
 return {files,raw,dispatch,terminal};
}
export async function assertSchemaRejectionPacket({sourceIdentity}={}){
 assert.deepEqual((await fs.readdir(fixedSchemaRejection.packet)).sort(),['source'],'Original packet contains effects beyond source');
 const root=await fs.lstat(fixedSchemaRejection.packet),source=path.join(fixedSchemaRejection.packet,'source'),leaf=await fs.lstat(source);assert.ok(root.isDirectory()&&!root.isSymbolicLink()&&leaf.isDirectory()&&!leaf.isSymbolicLink());
 assert.equal(path.resolve(await fs.realpath(source)).toLowerCase(),path.resolve(source).toLowerCase());
 if(sourceIdentity)await sourceIdentity(source);
 return {packetOnlySource:true,schemaAbsent:true,requestAbsent:true,invocationsAbsent:true,publishAbsent:true};
}
export async function assertSchemaResolutionInventory(directory,{allowOriginal=true}={}){
 assert.equal(path.resolve(directory).toLowerCase(),path.resolve(schemaQueueRoot).toLowerCase());
 const tickets=await allTickets(directory);
 for(const item of tickets){const terminal=await ticketResult(directory,item.value.requestId,item.sha256);assert.ok(terminal,'Pending ticket remains');}
 for(const name of await entries(directory,'dispatches')){
  const read=await readQueueObject(path.join(directory,'dispatches',name));validateDispatch(read.value,name);
  for(const ref of read.value.tickets){const terminal=await ticketResult(directory,ref.requestId,ref.ticketSha256);assert.ok(terminal);
   if(['unknown','failed','blocked'].includes(terminal.status)){
    if(await readFixedAdminRejectionResolution(directory,read.value,terminal))continue;
    if(allowOriginal&&read.value.dispatchId===fixedSchemaRejection.dispatchId&&read.sha256===fixedSchemaRejection.dispatchSha256&&terminal.requestId===fixedSchemaRejection.requestId&&terminal.status==='unknown')continue;
    if(await readFixedSchemaRejectionResolution(directory,read.value,terminal))continue;
    throw Error('Another unresolved dispatch remains');
   }
  }
 }
}
/** Bounded recursive decoding; never treat unreadable process paths as unrelated. */
export function decodeSchemaControlCommand(command){
 assert.ok(typeof command==='string'&&command.length<=1048576,'Unreadable or unbounded command');
 const seen=new Set(),pending=[command];let size=0;
 while(pending.length){const text=pending.shift();if(seen.has(text))continue;seen.add(text);size+=text.length;assert.ok(seen.size<=512&&size<=8*1048576,'Control transport decoding remains opaque');
  const encoded=/(?:^|\s)[-/](?:e|ec|en|enc|enco|encod|encode|encoded|encodedc|encodedco|encodedcom|encodedcomm|encodedcomma|encodedcomman|encodedcommand)\s+(\S+)/ig;
  if(/^\s*"?(?:[a-z]:[\\/][^"\r\n]*[\\/])?(?:powershell|pwsh)(?:\.exe)?"?(?:\s|$)/i.test(text))for(const match of text.matchAll(encoded)){const token=match[1].replace(/^"|"$/g,''),raw=Buffer.from(token,'base64');assert.ok(raw.length%2===0&&raw.length>0&&raw.toString('base64').replace(/=+$/,'')===token.replace(/=+$/,''),'Encoded controller remains opaque');const decoded=new TextDecoder('utf-16le',{fatal:true}).decode(raw);assert.ok(decoded&&!decoded.includes('\0'),'Encoded controller remains opaque');if(!seen.has(decoded))pending.push(decoded);}
  for(const match of text.matchAll(/[A-Za-z0-9+/]{32,}={0,2}/g)){const token=match[0],raw=Buffer.from(token,'base64');if(raw.toString('base64').replace(/=+$/,'')!==token.replace(/=+$/,''))continue;
   for(const encoding of ['utf8','utf16le']){try{const value=new TextDecoder(encoding,{fatal:true}).decode(raw);if(value&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)&&!seen.has(value))pending.push(value);}catch{}}
  }
 }
 return [...seen].join('\n').replaceAll('\\','/').replace(/\/{2,}/g,'/').toLowerCase();
}
export function classifySchemaControllers(rows,{writer,observer}){
 const selected=new Map(),excluded=new Set();
 for(const identity of [writer,observer]){const actual=rows.filter(row=>row.processId===identity.processId);assert.equal(actual.length,1);for(const key of ['creationDate','commandLine','executablePath'])assert.equal(actual[0][key],identity[key],'Writer/observer process identity changed');excluded.add(identity.processId);}
 for(const row of rows){if(excluded.has(row.processId))continue;
  if(schemaControlName(row.name)&&(!row.commandLine||!row.executablePath||!row.creationDate))throw Error('Current possible controller is opaque');
  if(!row.commandLine)continue;const text=decodeSchemaControlCommand(row.commandLine);
  if(schemaControlPath(text))selected.set(row.processId,row);
 }
 for(let changed=true;changed;){changed=false;for(const row of rows)if(!excluded.has(row.processId)&&selected.has(row.parentProcessId)&&!selected.has(row.processId)){selected.set(row.processId,row);changed=true;}}
 for(const row of selected.values())assert.ok(row.commandLine&&row.executablePath&&row.creationDate,'Related controller descendant is opaque');
 return [...selected.keys()].sort((a,b)=>a-b);
}
function schemaValidateObservation(value,request){
 assert.deepEqual(Object.keys(request).sort(),['version','dispatchId','phase','nonce','at','writer','taskDefinitionSha256','task','operatorSource','observerCodeSha256','sourceIdentity','operatorFiles'].sort());assert.equal(request.version,'teruisi-schema-rejection-request-ece-v1');assert.equal(request.dispatchId,fixedSchemaRejection.dispatchId);assert.match(request.nonce??'',/^[a-f0-9]{32}$/);assert.deepEqual(Object.keys(request.operatorFiles).sort(),schemaOperatorNames.toSorted());
 assert.deepEqual(Object.keys(value).sort(),['version','dispatchId','requestSha256','nonce','phase','at','writer','observer','observerCodeSha256','elevated','completeCensus','censusCount','census','relatedControllers','relatedOpaque','taskState','taskInstances','taskDefinitionSha256','sourceCommit','sourceTree','sourceClean','packet','operatorSourceIdentity','operatorFiles'].sort());assert.equal(typeof value.elevated,'boolean');assert.ok(Array.isArray(value.census)&&value.census.length===value.censusCount);assertSchemaWitnessCensus(value.census,value.census.map(row=>({...row,commandLine:null,executablePath:null})),{protectedActors:[request.writer,value.observer]});assert.deepEqual(value.operatorSourceIdentity,request.sourceIdentity);assert.deepEqual(value.operatorFiles,request.operatorFiles);
 assert.equal(value.version,'teruisi-schema-rejection-observation-ece-v1');assert.equal(value.dispatchId,fixedSchemaRejection.dispatchId);assert.equal(value.requestSha256,sha(Buffer.from(canonical(request))));assert.equal(value.nonce,request.nonce);assert.equal(value.phase,request.phase);assert.equal(value.writer.processId,request.writer.processId);assert.deepEqual(value.writer,request.writer);
 assert.equal(value.observerCodeSha256,fixedSchemaRejection.observerSha256);assert.ok(value.observer.processId>0&&value.observer.processId!==request.writer.processId);for(const key of ['creationDate','commandLine','executablePath'])assert.ok(typeof value.observer[key]==='string'&&value.observer[key]);
 assert.deepEqual(value.relatedControllers,[]);assert.equal(value.relatedOpaque,0);assert.equal(value.completeCensus,true);assert.equal(value.taskState,3);assert.equal(value.taskInstances,0);assert.equal(value.taskDefinitionSha256,request.taskDefinitionSha256);assert.equal(value.sourceCommit,fixedSchemaRejection.target);assert.equal(value.sourceClean,true);assert.match(value.sourceTree??'',/^[a-f0-9]{40}$/);for(const key of ['packetOnlySource','schemaAbsent','requestAbsent','invocationsAbsent','publishAbsent'])assert.equal(value.packet[key],true);
 assert.ok(Date.parse(value.at)>=Date.parse(request.at)&&Date.parse(value.at)-Date.parse(request.at)<60000,'Observation not fresh for its request');
 return value;
}
async function schemaReadResolution({read=adminStableRead}={}){
 const file=path.join(schemaQueueRoot,'resolutions',fixedSchemaRejection.dispatchId+'.json'),raw=await read(file),value=JSON.parse(raw);assert.equal(raw.toString(),canonical(value));
 assert.deepEqual(Object.keys(value).sort(),['version','decision','at','dispatchId','dispatchSha256','requestId','targetCommit','originalResultSha256','terminationBasis','historicalActorIdentityUnavailable','nativePreparationStarted','prepared','publicationPerformed','retryOriginal','writerPid','sourceIdentity','operatorFiles','originals','adoptionSha256','evidenceDirectory','observations'].sort());assert.equal(value.decision,'original-native-preparation-never-started-request-terminated');assert.deepEqual(Object.keys(value.operatorFiles).sort(),schemaOperatorNames.toSorted());
 assert.equal(value.version,fixedSchemaRejection.version);assert.equal(value.dispatchId,fixedSchemaRejection.dispatchId);assert.equal(value.requestId,fixedSchemaRejection.requestId);assert.equal(value.targetCommit,fixedSchemaRejection.target);assert.equal(value.dispatchSha256,fixedSchemaRejection.dispatchSha256);assert.equal(value.originalResultSha256,fixedSchemaRejection.resultSha256);assert.equal(value.terminationBasis,'awaited-preparation-rejection-before-native');assert.equal(value.historicalActorIdentityUnavailable,true);
 for(const key of ['nativePreparationStarted','prepared','publicationPerformed','retryOriginal'])assert.equal(value[key],false);
 const evidence=path.join(schemaQueueRoot,'resolutions',fixedSchemaRejection.dispatchId+'-evidence');assert.equal(path.resolve(value.evidenceDirectory),path.resolve(evidence));
 const object=async digest=>{assert.match(digest??'',hex);const bytes=await read(path.join(evidence,'objects',digest+'.bin'));assert.equal(sha(bytes),digest);return bytes;};
 const originals=await schemaRejectionOriginals({read:async file=>file.startsWith(schemaQueueRoot+path.sep)?read(file):object(value.originals[file])});assert.deepEqual(value.originals,originals.files);
 const plan=JSON.parse(await object(fixedSchemaRejection.planSha256));assert.equal(plan.baseSha,fixedSchemaRejection.base);assert.equal(plan.headSha,fixedSchemaRejection.target);
 const oldInstallation=JSON.parse(await object(fixedSchemaRejection.oldInstallationSha256));
 const adopted=JSON.parse(await object(value.adoptionSha256)),manifest=JSON.parse(await object(adopted.bundleManifestSha256));assert.equal(adopted.status,'adopted');assert.equal(adopted.version,'teruisi-main-control-installation-v3');assert.notEqual(adopted.bundleSha256,fixedSchemaRejection.bundleSha256);assert.equal(adopted.configSha256,fixedSchemaRejection.configSha256);assert.equal(path.resolve(adopted.bundleRoot),path.resolve(fixedSchemaRejection.state,'control-bundles',adopted.bundleSha256));assert.deepEqual(adopted.preparationTask,oldInstallation.preparationTask);
 assert.equal(manifest.bundleSha256,adopted.bundleSha256);assert.equal(sha(Buffer.from(canonical(manifest.files))),manifest.bundleSha256);assert.deepEqual(Object.keys(manifest.files).sort(),[...schemaControlNames,'tools/frozen-main-source.mjs'].sort());
 for(const [name,digest] of Object.entries(manifest.files))await object(digest);
 const intent=JSON.parse(await object(adopted.intentSha256)),transition=JSON.parse(await object(adopted.transitionProofSha256));assert.equal(intent.version,'teruisi-main-control-upgrade-v2');assert.equal(intent.installId,adopted.installId);for(const key of ['bundleRoot','bundleSha256','bundleManifestSha256','dispatcherSha256','hook','hookSha256','configSha256'])assert.equal(intent[key],adopted[key]);assert.equal(path.resolve(intent.stateDirectory),path.resolve(fixedSchemaRejection.state));assert.equal(path.resolve(intent.configFile),path.resolve(fixedSchemaRejection.state,'main-publisher-config.json'));assert.equal(manifest.sourceCommit,intent.sourceCommit);assert.equal(manifest.sourceTree,intent.sourceTree);assert.equal(transition.version,'teruisi-main-control-transition-v2');assert.equal(transition.installId,adopted.installId);assert.equal(transition.intentSha256,adopted.intentSha256);assert.deepEqual(transition.lockOrder,['v1-queue','v2-queue','native-rotation']);assert.equal(transition.rotationPipeSha256,sha('\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1'));assert.equal(transition.productionDeploymentPerformed,false);assert.equal(transition.privateTestTopology,false);assert.equal(transition.legacyWindowConverged,true);assert.ok(transition.frames?.length>=3);for(const frame of transition.frames.slice(-3)){assert.deepEqual(frame.related,[]);assert.ok(Date.parse(frame.at)<=Date.parse(adopted.adoptedAt));}await object(adopted.dispatcherSha256);await object(adopted.hookSha256);
 assert.equal(value.sourceIdentity.commit,manifest.sourceCommit);assert.equal(value.sourceIdentity.tree,manifest.sourceTree);assert.equal(value.sourceIdentity.status,'');
 for(const name of schemaOperatorNames){const digest=value.operatorFiles[name];await object(digest);if(manifest.files['tools/'+name])assert.equal(digest,manifest.files['tools/'+name]);}assert.equal(value.operatorFiles['schema-rejection-observer.mjs'],fixedSchemaRejection.observerSha256);
 assert.equal(value.observations.length,2);const observations=[];
 for(const [index,pair] of value.observations.entries()){const request=JSON.parse(await object(pair.requestSha256)),observation=schemaValidateObservation(JSON.parse(await object(pair.observationSha256)),request);assert.equal(request.phase,index===0?'before-archive':'after-archive');assert.deepEqual(request.sourceIdentity,value.sourceIdentity);assert.deepEqual(request.operatorFiles,value.operatorFiles);assert.equal(request.observerCodeSha256,fixedSchemaRejection.observerSha256);assert.deepEqual(request.task,adopted.preparationTask);assert.equal(request.writer.processId,value.writerPid);assert.equal(request.taskDefinitionSha256,sha(Buffer.from(canonical(adopted.preparationTask.definition))));assert.ok(Date.parse(observation.at)>=Date.parse(adopted.adoptedAt));assert.ok(Date.parse(value.at)>=Date.parse(observation.at)&&Date.parse(value.at)-Date.parse(observation.at)<60000);await object(observation.observerCodeSha256);observations.push(observation);}
 assert.equal(observations[0].sourceTree,observations[1].sourceTree);assert.notEqual(observations[0].nonce,observations[1].nonce);assert.ok(Date.parse(observations[1].at)>=Date.parse(observations[0].at));
 return true;
}
export async function readFixedSchemaRejectionResolution(directory,dispatch,terminal){
 if(path.resolve(directory).toLowerCase()!==path.resolve(schemaQueueRoot).toLowerCase()||dispatch.dispatchId!==fixedSchemaRejection.dispatchId||terminal?.requestId!==fixedSchemaRejection.requestId||terminal.status!=='unknown')return false;
 const file=path.join(directory,'resolutions',fixedSchemaRejection.dispatchId+'.json');try{await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return false;throw error;}
 return schemaReadResolution();
}
/** Operator only. The CLI has no target/retry/path override for original state. */
export async function writeFixedSchemaRejectionResolution({sourceRoot,out,observe,identity,ordinary,adopted,assertAdopted,git,plan,oldInstallation,acquireRotation,freshCensus}={}){
 const [{promisify},{execFile},{fileURLToPath}]=await Promise.all([import('node:util'),import('node:child_process'),import('node:url')]);const execute=promisify(execFile);
 git??=async(root,args)=>(await execute('git',['-C',root,...args],{encoding:'utf8',windowsHide:true})).stdout.trim();
 const sourceIdentity=async root=>({commit:await git(root,['rev-parse','HEAD']),tree:await git(root,['rev-parse','HEAD^{tree}']),status:await git(root,['status','--porcelain'])});
 const self=fileURLToPath(import.meta.url);assert.equal(path.resolve(sourceRoot,'tools/main-prebuild-queue.mjs'),path.resolve(self),'Writer must use its own frozen source');
 const {readAdoptedControl,assertControlGeneration}=await import('./main-control-dispatch.mjs');
 const task=await import('./main-prebuild-task.mjs');
 ordinary??=async()=>task.assertOrdinaryIdentity(await task.currentPreparationIdentity(),(await readAdoptedControl(path.join(fixedSchemaRejection.state,'main-publisher-config.json'))).state.preparationTask.sid);
 identity??=async()=>task.taskPowerShell('$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$v.pid);if(-not $p -or -not $p.CommandLine -or -not $p.ExecutablePath){throw "Writer process identity unavailable"};@{processId=[int]$p.ProcessId;creationDate=$p.CreationDate.ToUniversalTime().ToString("o");commandLine=$p.CommandLine;executablePath=$p.ExecutablePath}|ConvertTo-Json -Compress',{pid:process.pid});
 await ordinary();const writer=await identity();assert.equal(writer.processId,process.pid);
 const source=await sourceIdentity(sourceRoot);assert.equal(source.status,'');
 const binding=adopted??await readAdoptedControl(path.join(fixedSchemaRejection.state,'main-publisher-config.json'));
 assertAdopted??=()=>assertControlGeneration(binding);
 const archiveBinding=async()=>{
  await assertAdopted();assert.equal(binding.state.version,'teruisi-main-control-installation-v3');assert.notEqual(binding.state.bundleSha256,fixedSchemaRejection.bundleSha256);assert.equal(binding.state.configSha256,fixedSchemaRejection.configSha256);
  const manifestRaw=await adminStableRead(path.join(binding.bundleRoot,'MANIFEST.json')),manifest=JSON.parse(manifestRaw);assert.equal(sha(manifestRaw),binding.state.bundleManifestSha256);assert.equal(manifest.sourceCommit,source.commit);assert.equal(manifest.sourceTree,source.tree);
  const objects=new Map(),put=raw=>{objects.set(sha(raw),raw);return sha(raw);};const operatorFiles={};
  for(const name of schemaOperatorNames){const bytes=await adminStableRead(path.join(sourceRoot,'tools',name));operatorFiles[name]=put(bytes);if(manifest.files['tools/'+name])assert.equal(operatorFiles[name],manifest.files['tools/'+name]);}
  assert.equal(operatorFiles['schema-rejection-observer.mjs'],fixedSchemaRejection.observerSha256);
  const adoptionRaw=await adminStableRead(path.join(fixedSchemaRejection.state,'CONTROL-INSTALLATION.json'));assert.equal(sha(adoptionRaw),binding.stateSha256);put(adoptionRaw);put(manifestRaw);
  for(const [file,expected] of [[path.join(fixedSchemaRejection.state,'control-upgrades',binding.state.installId,'INTENT.json'),binding.state.intentSha256],[binding.state.transitionProofFile,binding.state.transitionProofSha256]]){const bytes=await adminStableRead(file);assert.equal(sha(bytes),expected);put(bytes);}
  for(const [file,expected] of [[path.join(fixedSchemaRejection.state,'control/tools/publish-latest-main.mjs'),binding.state.dispatcherSha256],[binding.state.hook,binding.state.hookSha256]]){const bytes=await adminStableRead(file);assert.equal(sha(bytes),expected);put(bytes);}
  for(const [name,expected] of Object.entries(manifest.files)){const bytes=await adminStableRead(path.join(binding.bundleRoot,name));assert.equal(sha(bytes),expected);put(bytes);}
  return {objects,operatorFiles,adoptionSha256:sha(adoptionRaw)};
 };
 await assertSchemaArtifactDirectory(out,{allowMissing:true});await fs.mkdir(out,{recursive:false});await assertSchemaArtifactDirectory(out);
 const releaseQueue=await acquireQueueLock(schemaQueueRoot);assert.ok(releaseQueue,'Queue is busy; no resolution write');let releaseRotation;
 try{
  acquireRotation??=()=>new Promise((resolve,reject)=>{const server=createServer(socket=>socket.destroy());server.once('error',reject);server.listen('\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1',()=>resolve(()=>new Promise(done=>server.close(done))));});
  releaseRotation=await acquireRotation();await assertAdopted();await assertSchemaResolutionInventory(schemaQueueRoot);
  const original=await schemaRejectionOriginals();await assertSchemaRejectionPacket({sourceIdentity:async root=>{const v=await sourceIdentity(root);assert.equal(v.commit,fixedSchemaRejection.target);assert.equal(v.status,'');}});
  const {makeReleasePlan}=await import('./release-scope-plan.mjs');plan??=makeReleasePlan({base:fixedSchemaRejection.base,head:fixedSchemaRejection.target,cwd:path.join(fixedSchemaRejection.packet,'source')});const planRaw=Buffer.from(canonical(plan));assert.equal(sha(planRaw),fixedSchemaRejection.planSha256);
  const oldSchemaRaw=original.raw.get('tools/main-schema-release.mjs'),oldSchema=await import('data:text/javascript;base64,'+oldSchemaRaw.toString('base64'));let rejected=false;
  try{await oldSchema.readSchemaRecipe(path.join(fixedSchemaRejection.packet,'source'),plan);}catch(error){assert.equal(error.message,original.terminal.error);rejected=true;}assert.equal(rejected,true,'Original installed capability did not reproduce its exact pre-native rejection');
  const schema=await import('./main-schema-release.mjs');assert.equal(schema.assertMainSchemaPlanSupported(plan).additionKind,'PiWorkspace');
  if(!oldInstallation){const fixture=JSON.parse(await fs.readFile(path.join(sourceRoot,'tests/fixtures/fixed-schema-ece-evidence.json'),'utf8'));oldInstallation=Buffer.from(fixture.objects[fixedSchemaRejection.oldInstallationSha256],'base64');}
  assert.equal(sha(oldInstallation),fixedSchemaRejection.oldInstallationSha256);const oldState=JSON.parse(oldInstallation);assert.deepEqual(binding.state.preparationTask,oldState.preparationTask);
  const closed=await archiveBinding();closed.objects.set(fixedSchemaRejection.oldInstallationSha256,oldInstallation);closed.objects.set(fixedSchemaRejection.planSha256,planRaw);
  for(const [file,expected] of Object.entries(original.files)){const bytes=await adminStableRead(file);assert.equal(sha(bytes),expected);closed.objects.set(expected,bytes);}
  const observations=[];
  const getObservation=async phase=>{
   const request={version:'teruisi-schema-rejection-request-ece-v1',dispatchId:fixedSchemaRejection.dispatchId,phase,nonce:randomUUID().replaceAll('-',''),at:new Date().toISOString(),writer,taskDefinitionSha256:sha(Buffer.from(canonical(binding.state.preparationTask.definition))),task:binding.state.preparationTask,operatorSource:sourceRoot,observerCodeSha256:fixedSchemaRejection.observerSha256,sourceIdentity:source,operatorFiles:closed.operatorFiles};
   const requestFile=path.join(out,'REQUEST-'+phase+'.json');await assertSchemaArtifactDirectory(out);await durableCreate(requestFile,request);await assertSchemaArtifactDirectory(out);
   const response=observe?await observe(request,requestFile):await (async()=>{const file=path.join(out,'OBSERVATION-'+phase+'.json'),deadline=Date.now()+120000;console.log(JSON.stringify({status:'awaiting-independent-read-only-observer',requestFile,requestSha256:sha(Buffer.from(canonical(request))),responseFile:file}));for(;;){try{return (await readQueueObject(file)).value;}catch(error){if(error.code!=='ENOENT')throw error;if(Date.now()>=deadline)throw Error('Independent read-only observation not supplied; no resolution');await new Promise(done=>setTimeout(done,250));}}})();
   schemaValidateObservation(response,request);assert.ok(Date.now()-Date.parse(response.at)>=0&&Date.now()-Date.parse(response.at)<60000,'Independent observation expired');
   const fresh=await (freshCensus?freshCensus():task.taskPowerShell(schemaCensusScript));assertSchemaWitnessCensus(response.census,fresh.rows,{protectedActors:[writer,response.observer]});assert.ok(Date.now()-Date.parse(response.at)<60000,'Cross-token census expired');
   await durableCreate(path.join(out,'ACK-'+phase+'.json'),{requestSha256:sha(Buffer.from(canonical(request))),writerPid:writer.processId});
   const requestRaw=Buffer.from(canonical(request)),observationRaw=Buffer.from(canonical(response));closed.objects.set(sha(requestRaw),requestRaw);closed.objects.set(sha(observationRaw),observationRaw);observations.push({requestSha256:sha(requestRaw),observationSha256:sha(observationRaw)});return response;
  };
  const first=await getObservation('before-archive'),evidence=path.join(schemaQueueRoot,'resolutions',fixedSchemaRejection.dispatchId+'-evidence');await fs.mkdir(path.dirname(evidence),{recursive:true});await fs.mkdir(evidence);await fs.mkdir(path.join(evidence,'objects'));
  const copy=async()=>{for(const [digest,bytes] of closed.objects){const file=path.join(evidence,'objects',digest+'.bin');try{const handle=await fs.open(file,'wx');try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}}catch(error){if(error.code!=='EEXIST')throw error;assert.equal(sha(await adminStableRead(file)),digest);}}};
  await copy();const second=await getObservation('after-archive');assert.equal(first.sourceTree,second.sourceTree);await copy();await assertAdopted();await assertSchemaResolutionInventory(schemaQueueRoot);await schemaRejectionOriginals();await assertSchemaRejectionPacket();assert.deepEqual(await sourceIdentity(sourceRoot),source);
  const value={version:fixedSchemaRejection.version,decision:'original-native-preparation-never-started-request-terminated',at:new Date().toISOString(),dispatchId:fixedSchemaRejection.dispatchId,dispatchSha256:fixedSchemaRejection.dispatchSha256,requestId:fixedSchemaRejection.requestId,targetCommit:fixedSchemaRejection.target,originalResultSha256:fixedSchemaRejection.resultSha256,terminationBasis:'awaited-preparation-rejection-before-native',historicalActorIdentityUnavailable:true,nativePreparationStarted:false,prepared:false,publicationPerformed:false,retryOriginal:false,writerPid:writer.processId,sourceIdentity:source,operatorFiles:closed.operatorFiles,originals:original.files,adoptionSha256:closed.adoptionSha256,evidenceDirectory:evidence,observations};
  for(const pair of observations){const observation=JSON.parse(closed.objects.get(pair.observationSha256));assert.ok(Date.parse(value.at)-Date.parse(observation.at)<60000);}
  await durableCreate(path.join(schemaQueueRoot,'resolutions',fixedSchemaRejection.dispatchId+'.json'),value);await schemaReadResolution();return {status:'terminated-before-native-preparation',prepared:false,publicationPerformed:false,replayOriginal:false};
 }finally{try{await releaseRotation?.();}finally{await releaseQueue();}}
}
// FIXED_SCHEMA_ECE_END

// FIXED_CACHE_0B_BEGIN: schema completed, exact lock rejection, never a retry.
export const fixedCacheRejection=Object.freeze({"version": "teruisi-cache-before-native-0b-v1", "state": "D:/codex-isolated/main-manual-release-20261016", "packet": "D:/codex-isolated/main-release-packages/b2ef81c7c6ee-997d0568-ca9c731a", "target": "b2ef81c7c6eecdb59894e55021b835b6a8baf0b4", "tree":"81bab93e9996fa9edd3c1ab5cd8869fad48eda73", "base": "6dc028139cc6e561dcad68d76c9d673596d9ec82", "dispatchId": "0b4674f2-287d-453a-9094-a8f3245886a0", "requestId": "773d38e0-19a5-47b3-ae7c-b69119885857", "bundleSha256": "c7f2cdeae297d7a7c3d9881478fe763236da98bad97979ecd1b17f525d96efad", "configSha256": "635cc1db30275fd7a6840ce29a6d7a69bbc202e5a486a6d199367b66935eb09c", "ticketSha256": "41446f1ce8dc71a8750d5406894ef2138ab57fc99a60869eff7ce0ee8d12c294", "dispatchSha256": "577476a6e39a05022c460480dc8d7d50a2663e01f484b6f60cbfebad9026064c", "resultSha256": "d2e980c5326749cf0e80a4c80fbfc3bec3c234a9d5864f63759fcfdd6d799435", "manifestSha256": "6637ac058bfb4f76f910f4155b4e78507bc5b6653f7e98e747112aaa552dd93c", "oldInstallationSha256": "a0fd23f06e221a4c59782e0cf4a6d6089aa00b1152b2a4fd4ad6bbaeca945311", "schemaSha256": "40a200cda1a4647254fe1c77f73092a188c38f8f29bedb4b9e578123f480118e", "oldLockSha256": "486154660ca7b1c32822078584c7938ae5de172a0dc8bcd47891100563af935e", "newLockSha256": "8ec00f801aff894796d783595d202811bccbe94296603ae26766864247d4a4ca", "planSha256": "0a6526f88f259b782c42f5de33f20603d14b282da0df5d1bfe4bde90523a8853", "observerSha256": "a9d995c782e7e161a7ca410151b2d705b41cac2eb97f07d0589e40dc731954e2"});
const cacheQueueRoot=path.join(fixedCacheRejection.state,'prebuild-queue-v2');
const cacheControlNames=[...schemaControlNames,'tools/frozen-main-source.mjs'].sort();
const cacheOperatorNames=["main-prebuild-queue.mjs", "main-prebuild-task.mjs", "main-control-dispatch.mjs", "main-schema-release.mjs", "release-scope-plan.mjs", "frozen-main-source.mjs", "cache-rejection-writer.mjs", "cache-rejection-observer.mjs"];
function cacheValidateConfig(old,next){assert.equal(next.cacheLockSha256,fixedCacheRejection.newLockSha256);assert.equal(path.resolve(next.dependenciesDirectory),path.resolve(fixedCacheRejection.state,'dependencies-8ec00f/node_modules'));const stripped=value=>{const copy={...value};delete copy.cacheLockSha256;delete copy.dependenciesDirectory;return copy;};assert.deepEqual(stripped(next),stripped(old),'Only the two reviewed dependency fields may change');}
// All original consumed inputs are fixed, including the old adopted generation.
const cacheOriginalPins=Object.freeze({"D:\\codex-isolated\\main-manual-release-20261016\\CONTROL-INSTALLATION.json": "a0fd23f06e221a4c59782e0cf4a6d6089aa00b1152b2a4fd4ad6bbaeca945311", "D:\\codex-isolated\\main-manual-release-20261016\\main-publisher-config.json": "635cc1db30275fd7a6840ce29a6d7a69bbc202e5a486a6d199367b66935eb09c", "D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\c7f2cdeae297d7a7c3d9881478fe763236da98bad97979ecd1b17f525d96efad\\MANIFEST.json": "6637ac058bfb4f76f910f4155b4e78507bc5b6653f7e98e747112aaa552dd93c", "D:\\codex-isolated\\main-manual-release-20261016\\control-upgrades\\e29df42e-32e3-4c9c-aa12-fcc0ac830196\\INTENT.json": "61db30fe74d272f64d1fb51251a8581e4fe238e5ddb0baac2cddbf9eab63905c", "D:\\codex-isolated\\main-manual-release-20261016\\control-upgrades\\e29df42e-32e3-4c9c-aa12-fcc0ac830196\\TRANSITION-a17e4e17-cb7f-49fd-8e55-1451c8ced950.json": "99d0ac5b691eea7afa27d9f997e6c18094395eed9c9beebf11ee05292ee358aa", "D:\\codex-isolated\\main-manual-release-20261016\\control\\tools\\publish-latest-main.mjs": "12791fc512e16dc913e41d14f191a54b8b59f064a34ed79eadf64eb4a5726e55", "D:\\运营管理系统\\.git\\hooks\\reference-transaction": "afeffd79982cb67baa4a4c4e3fd209aff5270900dfb88314d20a57f302d41ff8", "D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\c7f2cdeae297d7a7c3d9881478fe763236da98bad97979ecd1b17f525d96efad\\tools\\frozen-main-source.mjs": "b4bb57dff7a659a94520bc592e0f42b026d5b2a4def4dacfb928e8635f21f9c6", "D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\c7f2cdeae297d7a7c3d9881478fe763236da98bad97979ecd1b17f525d96efad\\tools\\main-control-dispatch.mjs": "68334ca9733c6f3652245534ed41d0bdae2ab5e70588729d17fc8edb81731fbc", "D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\c7f2cdeae297d7a7c3d9881478fe763236da98bad97979ecd1b17f525d96efad\\tools\\main-prebuild-hook.mjs": "c36f206c97c6fc1ed44604d72c5828bd080951e5fc0176164ce5d1072198ba77", "D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\c7f2cdeae297d7a7c3d9881478fe763236da98bad97979ecd1b17f525d96efad\\tools\\main-prebuild-queue.mjs": "fc9c6898e5fd3c120a1fb21fa2225bf9dba804ac4d62a7fedfaa063e43292d60", "D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\c7f2cdeae297d7a7c3d9881478fe763236da98bad97979ecd1b17f525d96efad\\tools\\main-prebuild-status.mjs": "9010056cc8b1ead2cfd4ba17ad5e427f0a0849f6b77ab708b8c3443795e12dc3", "D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\c7f2cdeae297d7a7c3d9881478fe763236da98bad97979ecd1b17f525d96efad\\tools\\main-prebuild-task.mjs": "d2860b916932baa485fc05e29712e4f4018a025986d73a08f380918cce7b4d70", "D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\c7f2cdeae297d7a7c3d9881478fe763236da98bad97979ecd1b17f525d96efad\\tools\\main-schema-release.mjs": "3f2e58b8628a5adbb16cdc5ba36f6de575e3c6a49dca2d8dbd01bff8111bdac0", "D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\c7f2cdeae297d7a7c3d9881478fe763236da98bad97979ecd1b17f525d96efad\\tools\\publish-latest-main.mjs": "bf9b5eb4a541573584c14b3b75a12b95dabd91b7bc0934cd3ceb6e02edd40d92", "D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\c7f2cdeae297d7a7c3d9881478fe763236da98bad97979ecd1b17f525d96efad\\tools\\publish-main-progress.mjs": "812d82d352fce8ce43a3b42aabcb2fa53cbcfa9c98b7524a33d0de3b521af714", "D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\c7f2cdeae297d7a7c3d9881478fe763236da98bad97979ecd1b17f525d96efad\\tools\\release-scope-plan.mjs": "e32e1e37ae99975b21816a021c266c360bb46c02254586796b09e2a6e3a281b2", "D:\\codex-isolated\\main-manual-release-20261016\\prebuild-queue-v2\\tickets\\773d38e0-19a5-47b3-ae7c-b69119885857.json": "41446f1ce8dc71a8750d5406894ef2138ab57fc99a60869eff7ce0ee8d12c294", "D:\\codex-isolated\\main-manual-release-20261016\\prebuild-queue-v2\\dispatches\\0b4674f2-287d-453a-9094-a8f3245886a0.json": "577476a6e39a05022c460480dc8d7d50a2663e01f484b6f60cbfebad9026064c", "D:\\codex-isolated\\main-manual-release-20261016\\prebuild-queue-v2\\results\\773d38e0-19a5-47b3-ae7c-b69119885857.json": "d2e980c5326749cf0e80a4c80fbfc3bec3c234a9d5864f63759fcfdd6d799435", "D:\\codex-isolated\\main-release-packages\\b2ef81c7c6ee-997d0568-ca9c731a\\schema\\ai-0085-evidence.json": "40a200cda1a4647254fe1c77f73092a188c38f8f29bedb4b9e578123f480118e", "D:\\codex-isolated\\main-release-packages\\b2ef81c7c6ee-997d0568-ca9c731a\\source\\config\\main-schema-releases\\ai-0085.json": "5b8e3bf30882342ce41c7539c6a6e0b82441d33d0a6317df05d9a202296f70d3", "D:\\codex-isolated\\main-release-packages\\b2ef81c7c6ee-997d0568-ca9c731a\\source\\docs\\release-schema-admission-20261018\\schema-validation-merged-3347.json": "d3c12481e71e5dd72a81f4393dda9e2d48407e56fcd7bdedd2c1229a7590279a", "D:\\codex-isolated\\main-manual-release-20261016\\control-executions\\e1bf0d7d-0f63-464f-968d-b865450dce19.json": "4367715b0bbf847a049760fb60a6f8ddb7faf1646326b3e96695acf346d457ec", "D:\\codex-isolated\\main-manual-release-20261016\\control-executions\\fbd2ba28-1caa-42c7-9c61-b1a977653d4e.json": "cfb771b18829c2095a32b3ae6e33beb527e94f1f7d77462e89fc9870baf1f8b2"});
const cacheActors=Object.freeze([{"file": "D:\\codex-isolated\\main-manual-release-20261016\\control-executions\\e1bf0d7d-0f63-464f-968d-b865450dce19.json", "sha256": "4367715b0bbf847a049760fb60a6f8ddb7faf1646326b3e96695acf346d457ec", "pid": 23116, "createdAt": "2026-10-18T15:27:57.9414950Z"}, {"file": "D:\\codex-isolated\\main-manual-release-20261016\\control-executions\\fbd2ba28-1caa-42c7-9c61-b1a977653d4e.json", "sha256": "cfb771b18829c2095a32b3ae6e33beb527e94f1f7d77462e89fc9870baf1f8b2", "pid": 29124, "createdAt": "2026-10-18T15:28:05.1480610Z"}]);
export async function cacheRejectionOriginals({read=adminStableRead}={}){
 const raw=new Map(),files={};for(const [file,expected] of Object.entries(cacheOriginalPins)){const bytes=await read(file);assert.equal(sha(bytes),expected,'Original cache rejection changed');raw.set(file,bytes);files[file]=expected;}
 const object=digest=>{for(const [file,hash] of Object.entries(files))if(hash===digest)return raw.get(file);throw Error('Missing original object');};
 const manifest=JSON.parse(object(fixedCacheRejection.manifestSha256));assert.equal(manifest.version,'teruisi-main-control-bundle-v2');assert.equal(manifest.sourceCommit,fixedCacheRejection.target);assert.deepEqual(Object.keys(manifest.files).sort(),cacheControlNames);assert.equal(sha(Buffer.from(canonical(manifest.files))),fixedCacheRejection.bundleSha256);assert.equal(manifest.bundleSha256,fixedCacheRejection.bundleSha256);
 for(const [name,digest] of Object.entries(manifest.files))assert.equal(files[path.join(fixedCacheRejection.state,'control-bundles',fixedCacheRejection.bundleSha256,name)],digest);
 const ticket=JSON.parse(object(fixedCacheRejection.ticketSha256)),dispatch=JSON.parse(object(fixedCacheRejection.dispatchSha256)),terminal=JSON.parse(object(fixedCacheRejection.resultSha256));validateTicket(ticket,fixedCacheRejection.requestId+'.json');validateDispatch(dispatch,fixedCacheRejection.dispatchId+'.json');
 assert.equal(dispatch.selectedTarget,fixedCacheRejection.target);assert.equal(dispatch.selection.live.mainCommit,fixedCacheRejection.base);assert.equal(path.resolve(dispatch.selection.packet),path.resolve(fixedCacheRejection.packet));assert.equal(dispatch.bundleSha256,fixedCacheRejection.bundleSha256);assert.equal(dispatch.configSha256,fixedCacheRejection.configSha256);assert.deepEqual(dispatch.tickets,[{observedTarget:null,requestId:fixedCacheRejection.requestId,ticketSha256:fixedCacheRejection.ticketSha256}]);assert.equal(terminal.status,'unknown');assert.equal(terminal.dispatchSha256,fixedCacheRejection.dispatchSha256);assert.equal(terminal.requestId,fixedCacheRejection.requestId);
 let rejection;try{assert.equal(fixedCacheRejection.newLockSha256,fixedCacheRejection.oldLockSha256,'依赖锁已变化，需要先准备对应离线依赖；本次未部署');}catch(error){rejection=error.message;}assert.equal(terminal.error,rejection);
 const old=JSON.parse(object(fixedCacheRejection.oldInstallationSha256)),config=JSON.parse(object(fixedCacheRejection.configSha256)),intent=JSON.parse(object(old.intentSha256)),transition=JSON.parse(object(old.transitionProofSha256));assert.equal(old.status,'adopted');assert.equal(old.bundleSha256,fixedCacheRejection.bundleSha256);assert.equal(old.bundleManifestSha256,fixedCacheRejection.manifestSha256);assert.equal(old.configSha256,fixedCacheRejection.configSha256);assert.equal(config.cacheLockSha256,fixedCacheRejection.oldLockSha256);assert.equal(intent.installId,old.installId);assert.equal(transition.intentSha256,old.intentSha256);for(const key of ['bundleSha256','bundleManifestSha256','configSha256','dispatcherSha256','hookSha256'])assert.equal(intent[key],old[key]);object(old.dispatcherSha256);object(old.hookSha256);
 for(const actor of cacheActors){const receipt=JSON.parse(object(actor.sha256));assert.equal(receipt.pid,actor.pid);assert.equal(receipt.createdAt,actor.createdAt);assert.equal(receipt.bundleSha256,fixedCacheRejection.bundleSha256);}
 // Exact complete old byte pins establish the synchronous await boundary. Only
 // the pure lock comparison above is replayed; binder/native are never called.
 const publisher=object(manifest.files['tools/publish-latest-main.mjs']).toString(),queue=object(manifest.files['tools/main-prebuild-queue.mjs']).toString();
 const schemaAt=publisher.indexOf('const schemaRelease=plan.migrate?await prepareSchema('),gate=publisher.indexOf("assert.equal(cacheLock,config.cacheLockSha256,"),junction=publisher.indexOf("if(!await exists(modules))await fs.symlink"),request=publisher.indexOf("await writeOnceOrSame(path.join(packet,'main-release-request.json')");assert.ok(schemaAt>=0&&schemaAt<gate&&gate<junction&&junction<request);assert.ok(publisher.includes('const prepared=await once(config,selection,')&&queue.includes('result=await prepare(selection,dispatch,reusablePreparation)')&&queue.includes("if(error)await finish(item,'unknown'"));
 return {files,raw,dispatch,terminal,object};
}
export async function assertCacheRejectionPacket({sourceIdentity}={}){
 assert.deepEqual((await fs.readdir(fixedCacheRejection.packet)).sort(),['schema','source'],'Original packet contains native effects');
 for(const leaf of ['', 'source','schema']){const file=path.join(fixedCacheRejection.packet,leaf),stat=await fs.lstat(file);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());assert.equal(path.resolve(await fs.realpath(file)).toLowerCase(),path.resolve(file).toLowerCase());}
 assert.deepEqual(await fs.readdir(path.join(fixedCacheRejection.packet,'schema')),['ai-0085-evidence.json']);assert.equal(sha(await adminStableRead(path.join(fixedCacheRejection.packet,'schema/ai-0085-evidence.json'))),fixedCacheRejection.schemaSha256);
 try{await fs.lstat(path.join(fixedCacheRejection.packet,'source/node_modules'));throw Error('Source already has dependencies');}catch(error){if(error.code!=='ENOENT')throw error;}
 if(sourceIdentity)await sourceIdentity(path.join(fixedCacheRejection.packet,'source'));
 return {packetOnlySourceAndSchema:true,schemaSha256:fixedCacheRejection.schemaSha256,requestAbsent:true,invocationsAbsent:true,publishAbsent:true,sourceModulesAbsent:true};
}
export function assertCacheActorsAbsent(rows){return cacheActors.map(actor=>{const row=rows.find(row=>row.processId===actor.pid);if(!row)return {pid:actor.pid,originalBirth:actor.createdAt,state:'absent'};assert.ok(row.creationDate&&Date.parse(row.creationDate)>Date.parse(actor.createdAt),'Original cache preparation actor remains or identity is ambiguous');assert.ok(row.commandLine&&row.executablePath&&row.name,'Reused actor PID is opaque');assert.equal(schemaControlPath(decodeSchemaControlCommand(row.commandLine)),false,'Reused PID is a related controller');return {pid:actor.pid,originalBirth:actor.createdAt,state:'reused-unrelated-pid',currentBirth:row.creationDate,currentName:row.name};});}
export async function assertCacheResolutionInventory(directory,{allowOriginal=true}={}){
 assert.equal(path.resolve(directory).toLowerCase(),path.resolve(cacheQueueRoot).toLowerCase());
 const tickets=await allTickets(directory);
 for(const item of tickets){const terminal=await ticketResult(directory,item.value.requestId,item.sha256);assert.ok(terminal,'Pending ticket remains');}
 for(const name of await entries(directory,'dispatches')){
  const read=await readQueueObject(path.join(directory,'dispatches',name));validateDispatch(read.value,name);
  for(const ref of read.value.tickets){const terminal=await ticketResult(directory,ref.requestId,ref.ticketSha256);assert.ok(terminal);
   if(['unknown','failed','blocked'].includes(terminal.status)){
    if(await readFixedAdminRejectionResolution(directory,read.value,terminal))continue;
    if(await readFixedSchemaRejectionResolution(directory,read.value,terminal))continue;
    if(allowOriginal&&read.value.dispatchId===fixedCacheRejection.dispatchId&&read.sha256===fixedCacheRejection.dispatchSha256&&terminal.requestId===fixedCacheRejection.requestId&&terminal.status==='unknown')continue;
    if(await readFixedCacheRejectionResolution(directory,read.value,terminal))continue;
    throw Error('Another unresolved dispatch remains');
   }
  }
 }
}
function cacheActorsFromProjection(rows){return cacheActors.map(actor=>{const row=rows.find(row=>row.processId===actor.pid);if(!row)return {pid:actor.pid,originalBirth:actor.createdAt,state:'absent'};assert.ok(row.creationDate&&Date.parse(row.creationDate)>Date.parse(actor.createdAt),'Original actor remains in historical census');assert.match(row.commandLineSha256??'',hex);assert.match(row.executablePathSha256??'',hex);return {pid:actor.pid,originalBirth:actor.createdAt,state:'reused-unrelated-pid',currentBirth:row.creationDate,currentName:row.name};});}
export function assertCacheActorWitness(witness,rows){
 const projected=schemaCensusProjection(rows);for(const actor of cacheActors){const current=projected.find(row=>row.processId===actor.pid);if(!current)continue;assert.ok(current.creationDate&&Date.parse(current.creationDate)>Date.parse(actor.createdAt),'Original cache actor remains or birth is unavailable');const known=witness.find(row=>row.processId===actor.pid);assert.ok(known,'Reused original PID appeared after witness');for(const key of ['processId','parentProcessId','name','creationDate'])assert.equal(current[key],known[key],'Original actor PID identity drifted after witness');for(const key of ['commandLineSha256','executablePathSha256']){assert.match(known[key]??'',hex,'Reused actor witness identity incomplete');if(current[key]!==null)assert.equal(current[key],known[key],'Reused actor visible metadata drifted');}}
 return true;
}
function cacheValidateObservation(value,request){
 assert.deepEqual(Object.keys(request).sort(),['version','dispatchId','phase','nonce','at','writer','taskDefinitionSha256','task','operatorSource','observerCodeSha256','sourceIdentity','operatorFiles'].sort());assert.equal(request.version,'teruisi-cache-rejection-request-0b-v1');assert.equal(request.dispatchId,fixedCacheRejection.dispatchId);assert.match(request.nonce??'',/^[a-f0-9]{32}$/);assert.deepEqual(Object.keys(request.operatorFiles).sort(),cacheOperatorNames.toSorted());
 assert.deepEqual(Object.keys(value).sort(),['version','dispatchId','requestSha256','nonce','phase','at','writer','observer','observerCodeSha256','elevated','completeCensus','censusCount','census','relatedControllers','relatedOpaque','taskState','taskInstances','taskDefinitionSha256','sourceCommit','sourceTree','sourceClean','packet','actors','operatorSourceIdentity','operatorFiles'].sort());assert.equal(typeof value.elevated,'boolean');assert.ok(Array.isArray(value.census)&&value.census.length===value.censusCount);assertSchemaWitnessCensus(value.census,value.census.map(row=>({...row,commandLine:null,executablePath:null})),{protectedActors:[request.writer,value.observer]});assert.deepEqual(value.operatorSourceIdentity,request.sourceIdentity);assert.deepEqual(value.operatorFiles,request.operatorFiles);
 assert.equal(value.version,'teruisi-cache-rejection-observation-0b-v1');assert.equal(value.dispatchId,fixedCacheRejection.dispatchId);assert.equal(value.requestSha256,sha(Buffer.from(canonical(request))));assert.equal(value.nonce,request.nonce);assert.equal(value.phase,request.phase);assert.equal(value.writer.processId,request.writer.processId);assert.deepEqual(value.writer,request.writer);
 assert.equal(value.observerCodeSha256,fixedCacheRejection.observerSha256);assert.ok(value.observer.processId>0&&value.observer.processId!==request.writer.processId);for(const key of ['creationDate','commandLine','executablePath'])assert.ok(typeof value.observer[key]==='string'&&value.observer[key]);
 assert.deepEqual(value.relatedControllers,[]);assert.equal(value.relatedOpaque,0);assert.equal(value.completeCensus,true);assert.equal(value.taskState,3);assert.equal(value.taskInstances,0);assert.equal(value.taskDefinitionSha256,request.taskDefinitionSha256);assert.equal(value.sourceCommit,fixedCacheRejection.target);assert.equal(value.sourceClean,true);assert.equal(value.sourceTree,fixedCacheRejection.tree);for(const key of ['packetOnlySourceAndSchema','requestAbsent','invocationsAbsent','publishAbsent','sourceModulesAbsent'])assert.equal(value.packet[key],true);
 assert.equal(value.elevated,true);assert.equal(value.packet.schemaSha256,fixedCacheRejection.schemaSha256);assert.deepEqual(value.actors.map(row=>({pid:row.pid,originalBirth:row.originalBirth})),cacheActors.map(row=>({pid:row.pid,originalBirth:row.createdAt})));assert.deepEqual(value.actors,cacheActorsFromProjection(value.census));
 assert.ok(Date.parse(value.at)>=Date.parse(request.at)&&Date.parse(value.at)-Date.parse(request.at)<60000,'Observation not fresh for its request');
 return value;
}
async function cacheReadResolution({read=adminStableRead}={}){
 const file=path.join(cacheQueueRoot,'resolutions',fixedCacheRejection.dispatchId+'.json'),raw=await read(file),value=JSON.parse(raw);assert.equal(raw.toString(),canonical(value));
 assert.deepEqual(Object.keys(value).sort(),['version','decision','at','dispatchId','dispatchSha256','requestId','targetCommit','originalResultSha256','terminationBasis','schemaBindingCompleted','schemaSha256','nativePreparationStarted','prepared','publicationPerformed','retryOriginal','writerPid','sourceIdentity','operatorFiles','originals','adoptionSha256','evidenceDirectory','observations'].sort());assert.equal(value.decision,'original-native-preparation-never-started-request-terminated');assert.deepEqual(Object.keys(value.operatorFiles).sort(),cacheOperatorNames.toSorted());
 assert.equal(value.version,fixedCacheRejection.version);assert.equal(value.dispatchId,fixedCacheRejection.dispatchId);assert.equal(value.requestId,fixedCacheRejection.requestId);assert.equal(value.targetCommit,fixedCacheRejection.target);assert.equal(value.dispatchSha256,fixedCacheRejection.dispatchSha256);assert.equal(value.originalResultSha256,fixedCacheRejection.resultSha256);assert.equal(value.terminationBasis,'awaited-cache-lock-rejection-before-native');assert.equal(value.schemaBindingCompleted,true);assert.equal(value.schemaSha256,fixedCacheRejection.schemaSha256);
 for(const key of ['nativePreparationStarted','prepared','publicationPerformed','retryOriginal'])assert.equal(value[key],false);
 const evidence=path.join(cacheQueueRoot,'resolutions',fixedCacheRejection.dispatchId+'-evidence');assert.equal(path.resolve(value.evidenceDirectory),path.resolve(evidence));
 const object=async digest=>{assert.match(digest??'',hex);const bytes=await read(path.join(evidence,'objects',digest+'.bin'));assert.equal(sha(bytes),digest);return bytes;};
 const originals=await cacheRejectionOriginals({read:async file=>file.startsWith(cacheQueueRoot+path.sep)?read(file):object(value.originals[file])});assert.deepEqual(value.originals,originals.files);
 const plan=JSON.parse(await object(fixedCacheRejection.planSha256));assert.equal(plan.baseSha,fixedCacheRejection.base);assert.equal(plan.headSha,fixedCacheRejection.target);
 const oldInstallation=JSON.parse(await object(fixedCacheRejection.oldInstallationSha256));
 const adopted=JSON.parse(await object(value.adoptionSha256));cacheValidateConfig(JSON.parse(await object(fixedCacheRejection.configSha256)),JSON.parse(await object(adopted.configSha256)));const manifest=JSON.parse(await object(adopted.bundleManifestSha256));assert.equal(adopted.status,'adopted');assert.equal(adopted.version,'teruisi-main-control-installation-v3');assert.notEqual(adopted.bundleSha256,fixedCacheRejection.bundleSha256);assert.notEqual(adopted.configSha256,fixedCacheRejection.configSha256);assert.equal(path.resolve(adopted.bundleRoot),path.resolve(fixedCacheRejection.state,'control-bundles',adopted.bundleSha256));assert.deepEqual(adopted.preparationTask,oldInstallation.preparationTask);
 assert.equal(manifest.bundleSha256,adopted.bundleSha256);assert.equal(sha(Buffer.from(canonical(manifest.files))),manifest.bundleSha256);assert.deepEqual(Object.keys(manifest.files).sort(),cacheControlNames);
 for(const [name,digest] of Object.entries(manifest.files))await object(digest);
 const intent=JSON.parse(await object(adopted.intentSha256)),transition=JSON.parse(await object(adopted.transitionProofSha256));assert.equal(intent.version,'teruisi-main-control-upgrade-v2');assert.equal(intent.installId,adopted.installId);for(const key of ['bundleRoot','bundleSha256','bundleManifestSha256','dispatcherSha256','hook','hookSha256','configSha256'])assert.equal(intent[key],adopted[key]);assert.equal(path.resolve(intent.stateDirectory),path.resolve(fixedCacheRejection.state));assert.equal(path.resolve(intent.configFile),path.resolve(fixedCacheRejection.state,'main-publisher-config.json'));assert.equal(manifest.sourceCommit,intent.sourceCommit);assert.equal(manifest.sourceTree,intent.sourceTree);assert.equal(transition.version,'teruisi-main-control-transition-v2');assert.equal(transition.installId,adopted.installId);assert.equal(transition.intentSha256,adopted.intentSha256);assert.deepEqual(transition.lockOrder,['v1-queue','v2-queue','native-rotation']);assert.equal(transition.rotationPipeSha256,sha('\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1'));assert.equal(transition.productionDeploymentPerformed,false);assert.equal(transition.privateTestTopology,false);assert.equal(transition.legacyWindowConverged,true);assert.ok(transition.frames?.length>=3);for(const frame of transition.frames.slice(-3)){assert.deepEqual(frame.related,[]);assert.ok(Date.parse(frame.at)<=Date.parse(adopted.adoptedAt));}await object(adopted.dispatcherSha256);await object(adopted.hookSha256);
 assert.equal(value.sourceIdentity.commit,manifest.sourceCommit);assert.equal(value.sourceIdentity.tree,manifest.sourceTree);assert.equal(value.sourceIdentity.status,'');
 for(const name of cacheOperatorNames){const digest=value.operatorFiles[name];await object(digest);if(manifest.files['tools/'+name])assert.equal(digest,manifest.files['tools/'+name]);}assert.equal(value.operatorFiles['cache-rejection-observer.mjs'],fixedCacheRejection.observerSha256);
 assert.equal(value.observations.length,2);const observations=[];
 for(const [index,pair] of value.observations.entries()){const request=JSON.parse(await object(pair.requestSha256)),observation=cacheValidateObservation(JSON.parse(await object(pair.observationSha256)),request);assert.equal(request.phase,index===0?'before-archive':'after-archive');assert.deepEqual(request.sourceIdentity,value.sourceIdentity);assert.deepEqual(request.operatorFiles,value.operatorFiles);assert.equal(request.observerCodeSha256,fixedCacheRejection.observerSha256);assert.deepEqual(request.task,adopted.preparationTask);assert.equal(request.writer.processId,value.writerPid);assert.equal(request.taskDefinitionSha256,sha(Buffer.from(canonical(adopted.preparationTask.definition))));assert.ok(Date.parse(observation.at)>=Date.parse(adopted.adoptedAt));assert.ok(Date.parse(value.at)>=Date.parse(observation.at)&&Date.parse(value.at)-Date.parse(observation.at)<60000);await object(observation.observerCodeSha256);observations.push(observation);}
 assert.equal(observations[0].sourceTree,observations[1].sourceTree);assert.notEqual(observations[0].nonce,observations[1].nonce);assert.ok(Date.parse(observations[1].at)>=Date.parse(observations[0].at));
 return true;
}
export async function readFixedCacheRejectionResolution(directory,dispatch,terminal){
 if(path.resolve(directory).toLowerCase()!==path.resolve(cacheQueueRoot).toLowerCase()||dispatch.dispatchId!==fixedCacheRejection.dispatchId||terminal?.requestId!==fixedCacheRejection.requestId||terminal.status!=='unknown')return false;
 const file=path.join(directory,'resolutions',fixedCacheRejection.dispatchId+'.json');try{await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return false;throw error;}
 return cacheReadResolution();
}
/** Operator only. The CLI has no target/retry/path override for original state. */
export async function writeFixedCacheRejectionResolution({sourceRoot,out,observe,identity,ordinary,adopted,assertAdopted,git,plan,oldInstallation,acquireRotation,freshCensus,originalArchive}={}){
 const [{promisify},{execFile},{fileURLToPath}]=await Promise.all([import('node:util'),import('node:child_process'),import('node:url')]);const execute=promisify(execFile);
 git??=async(root,args)=>(await execute('git',['-C',root,...args],{encoding:'utf8',windowsHide:true})).stdout.trim();
 const sourceIdentity=async root=>({commit:await git(root,['rev-parse','HEAD']),tree:await git(root,['rev-parse','HEAD^{tree}']),status:await git(root,['status','--porcelain'])});
 const self=fileURLToPath(import.meta.url);assert.equal(path.resolve(sourceRoot,'tools/main-prebuild-queue.mjs'),path.resolve(self),'Writer must use its own frozen source');
 const {readAdoptedControl,assertControlGeneration}=await import('./main-control-dispatch.mjs');
 const task=await import('./main-prebuild-task.mjs');
 ordinary??=async()=>task.assertOrdinaryIdentity(await task.currentPreparationIdentity(),(await readAdoptedControl(path.join(fixedCacheRejection.state,'main-publisher-config.json'))).state.preparationTask.sid);
 identity??=async()=>task.taskPowerShell('$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$v.pid);if(-not $p -or -not $p.CommandLine -or -not $p.ExecutablePath){throw "Writer process identity unavailable"};@{processId=[int]$p.ProcessId;creationDate=$p.CreationDate.ToUniversalTime().ToString("o");commandLine=$p.CommandLine;executablePath=$p.ExecutablePath}|ConvertTo-Json -Compress',{pid:process.pid});
 await ordinary();const writer=await identity();assert.equal(writer.processId,process.pid);
 const source=await sourceIdentity(sourceRoot);assert.equal(source.status,'');
 const binding=adopted??await readAdoptedControl(path.join(fixedCacheRejection.state,'main-publisher-config.json'));
 assertAdopted??=()=>assertControlGeneration(binding);
 let original;
 const archiveBinding=async()=>{
  await assertAdopted();assert.equal(binding.state.version,'teruisi-main-control-installation-v3');assert.notEqual(binding.state.bundleSha256,fixedCacheRejection.bundleSha256);assert.notEqual(binding.state.configSha256,fixedCacheRejection.configSha256);
  const manifestRaw=await adminStableRead(path.join(binding.bundleRoot,'MANIFEST.json')),manifest=JSON.parse(manifestRaw);assert.equal(sha(manifestRaw),binding.state.bundleManifestSha256);assert.equal(manifest.sourceCommit,source.commit);assert.equal(manifest.sourceTree,source.tree);
  const objects=new Map(),put=raw=>{objects.set(sha(raw),raw);return sha(raw);};const operatorFiles={};
  for(const name of cacheOperatorNames){const bytes=await adminStableRead(path.join(sourceRoot,'tools',name));operatorFiles[name]=put(bytes);if(manifest.files['tools/'+name])assert.equal(operatorFiles[name],manifest.files['tools/'+name]);}
  assert.equal(operatorFiles['cache-rejection-observer.mjs'],fixedCacheRejection.observerSha256);
  const adoptionRaw=await adminStableRead(path.join(fixedCacheRejection.state,'CONTROL-INSTALLATION.json'));assert.equal(sha(adoptionRaw),binding.stateSha256);put(adoptionRaw);put(manifestRaw);const configRaw=await adminStableRead(path.join(fixedCacheRejection.state,'main-publisher-config.json'));assert.equal(sha(configRaw),binding.state.configSha256);put(configRaw);cacheValidateConfig(JSON.parse(original.object(fixedCacheRejection.configSha256)),JSON.parse(configRaw));
  for(const [file,expected] of [[path.join(fixedCacheRejection.state,'control-upgrades',binding.state.installId,'INTENT.json'),binding.state.intentSha256],[binding.state.transitionProofFile,binding.state.transitionProofSha256]]){const bytes=await adminStableRead(file);assert.equal(sha(bytes),expected);put(bytes);}
  for(const [file,expected] of [[path.join(fixedCacheRejection.state,'control/tools/publish-latest-main.mjs'),binding.state.dispatcherSha256],[binding.state.hook,binding.state.hookSha256]]){const bytes=await adminStableRead(file);assert.equal(sha(bytes),expected);put(bytes);}
  for(const [name,expected] of Object.entries(manifest.files)){const bytes=await adminStableRead(path.join(binding.bundleRoot,name));assert.equal(sha(bytes),expected);put(bytes);}
  return {objects,operatorFiles,adoptionSha256:sha(adoptionRaw)};
 };
 await assertSchemaArtifactDirectory(out,{allowMissing:true});await fs.mkdir(out,{recursive:false});await assertSchemaArtifactDirectory(out);
 const releaseQueue=await acquireQueueLock(cacheQueueRoot);assert.ok(releaseQueue,'Queue is busy; no resolution write');let releaseRotation;
 try{
  acquireRotation??=()=>new Promise((resolve,reject)=>{const server=createServer(socket=>socket.destroy());server.once('error',reject);server.listen('\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1',()=>resolve(()=>new Promise(done=>server.close(done))));});
  releaseRotation=await acquireRotation();await assertAdopted();await assertCacheResolutionInventory(cacheQueueRoot);
  originalArchive??=JSON.parse(await fs.readFile(path.join(sourceRoot,'tests/fixtures/fixed-cache-0b-evidence.json'),'utf8'));const originalRead=async file=>{const expected=cacheOriginalPins[file];assert.match(expected??'',hex);if(file.startsWith(cacheQueueRoot+path.sep))return adminStableRead(file);return Buffer.from(originalArchive.objects[expected],'base64');};original=await cacheRejectionOriginals({read:originalRead});await assertCacheRejectionPacket({sourceIdentity:async root=>{const v=await sourceIdentity(root);assert.equal(v.commit,fixedCacheRejection.target);assert.equal(v.tree,fixedCacheRejection.tree);assert.equal(v.status,'');}});
  const {makeReleasePlan}=await import('./release-scope-plan.mjs');plan??=makeReleasePlan({base:fixedCacheRejection.base,head:fixedCacheRejection.target,cwd:path.join(fixedCacheRejection.packet,'source')});const planRaw=Buffer.from(canonical(plan));assert.equal(sha(planRaw),fixedCacheRejection.planSha256);
  assert.equal(sha(await adminStableRead(path.join(fixedCacheRejection.packet,'source/package-lock.json'))),fixedCacheRejection.newLockSha256);
  oldInstallation=original.object(fixedCacheRejection.oldInstallationSha256);const oldState=JSON.parse(oldInstallation);assert.deepEqual(binding.state.preparationTask,oldState.preparationTask);
  const closed=await archiveBinding();closed.objects.set(fixedCacheRejection.oldInstallationSha256,oldInstallation);closed.objects.set(fixedCacheRejection.planSha256,planRaw);
  for(const [file,expected] of Object.entries(original.files)){const bytes=await originalRead(file);assert.equal(sha(bytes),expected);closed.objects.set(expected,bytes);}
  const observations=[];
  const getObservation=async phase=>{
   const request={version:'teruisi-cache-rejection-request-0b-v1',dispatchId:fixedCacheRejection.dispatchId,phase,nonce:randomUUID().replaceAll('-',''),at:new Date().toISOString(),writer,taskDefinitionSha256:sha(Buffer.from(canonical(binding.state.preparationTask.definition))),task:binding.state.preparationTask,operatorSource:sourceRoot,observerCodeSha256:fixedCacheRejection.observerSha256,sourceIdentity:source,operatorFiles:closed.operatorFiles};
   const requestFile=path.join(out,'REQUEST-'+phase+'.json');await assertSchemaArtifactDirectory(out);await durableCreate(requestFile,request);await assertSchemaArtifactDirectory(out);
   const response=observe?await observe(request,requestFile):await (async()=>{const file=path.join(out,'OBSERVATION-'+phase+'.json'),deadline=Date.now()+120000;console.log(JSON.stringify({status:'awaiting-independent-read-only-observer',requestFile,requestSha256:sha(Buffer.from(canonical(request))),responseFile:file}));for(;;){try{return (await readQueueObject(file)).value;}catch(error){if(error.code!=='ENOENT')throw error;if(Date.now()>=deadline)throw Error('Independent read-only observation not supplied; no resolution');await new Promise(done=>setTimeout(done,250));}}})();
   cacheValidateObservation(response,request);assert.ok(Date.now()-Date.parse(response.at)>=0&&Date.now()-Date.parse(response.at)<60000,'Independent observation expired');
   const fresh=await (freshCensus?freshCensus():task.taskPowerShell(schemaCensusScript));assertSchemaWitnessCensus(response.census,fresh.rows,{protectedActors:[writer,response.observer]});assertCacheActorWitness(response.census,fresh.rows);assert.ok(Date.now()-Date.parse(response.at)<60000,'Cross-token census expired');
   await durableCreate(path.join(out,'ACK-'+phase+'.json'),{requestSha256:sha(Buffer.from(canonical(request))),writerPid:writer.processId});
   const requestRaw=Buffer.from(canonical(request)),observationRaw=Buffer.from(canonical(response));closed.objects.set(sha(requestRaw),requestRaw);closed.objects.set(sha(observationRaw),observationRaw);observations.push({requestSha256:sha(requestRaw),observationSha256:sha(observationRaw)});return response;
  };
  const first=await getObservation('before-archive'),evidence=path.join(cacheQueueRoot,'resolutions',fixedCacheRejection.dispatchId+'-evidence');await fs.mkdir(path.dirname(evidence),{recursive:true});await fs.mkdir(evidence);await fs.mkdir(path.join(evidence,'objects'));
  const copy=async()=>{for(const [digest,bytes] of closed.objects){const file=path.join(evidence,'objects',digest+'.bin');try{const handle=await fs.open(file,'wx');try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}}catch(error){if(error.code!=='EEXIST')throw error;assert.equal(sha(await adminStableRead(file)),digest);}}};
  await copy();const second=await getObservation('after-archive');assert.equal(first.sourceTree,second.sourceTree);await copy();await assertAdopted();await assertCacheResolutionInventory(cacheQueueRoot);await cacheRejectionOriginals({read:originalRead});await assertCacheRejectionPacket();assert.deepEqual(await sourceIdentity(sourceRoot),source);
  const value={version:fixedCacheRejection.version,decision:'original-native-preparation-never-started-request-terminated',at:new Date().toISOString(),dispatchId:fixedCacheRejection.dispatchId,dispatchSha256:fixedCacheRejection.dispatchSha256,requestId:fixedCacheRejection.requestId,targetCommit:fixedCacheRejection.target,originalResultSha256:fixedCacheRejection.resultSha256,terminationBasis:'awaited-cache-lock-rejection-before-native',schemaBindingCompleted:true,schemaSha256:fixedCacheRejection.schemaSha256,nativePreparationStarted:false,prepared:false,publicationPerformed:false,retryOriginal:false,writerPid:writer.processId,sourceIdentity:source,operatorFiles:closed.operatorFiles,originals:original.files,adoptionSha256:closed.adoptionSha256,evidenceDirectory:evidence,observations};
  for(const pair of observations){const observation=JSON.parse(closed.objects.get(pair.observationSha256));assert.ok(Date.parse(value.at)-Date.parse(observation.at)<60000);}
  await durableCreate(path.join(cacheQueueRoot,'resolutions',fixedCacheRejection.dispatchId+'.json'),value);await cacheReadResolution();return {status:'terminated-before-native-preparation',prepared:false,publicationPerformed:false,replayOriginal:false};
 }finally{try{await releaseRotation?.();}finally{await releaseQueue();}}
}
// FIXED_CACHE_0B_END

// FIXED_NATIVE_693E_BEGIN: native preparation started; abandon without publication or retry.
export const fixedNativeAbandonment=Object.freeze({"version":"teruisi-native-preparation-abandonment-693e-v2","state":"D:/codex-isolated/main-manual-release-20261016","packet":"D:/codex-isolated/main-release-packages/c36ea9964ea0-fee81c63-4ca6db6e","target":"c36ea9964ea0e57b73f0173b27d6991b4d5e19a7","tree":"1a8e9a3db8b7941dd23e8e58f21d667f7304c099","base":"b2ef81c7c6eecdb59894e55021b835b6a8baf0b4","dispatchId":"693e15d4-3390-49b1-9b7c-48fa4f737d48","requestId":"863e1fac-fe1c-4136-986e-c26ef30e4a7f","bundleSha256":"1624b830282ef24c0ee094fa42f913029a59296009106eda016dbfe871e87ecb","configSha256":"9879162ff8955bc616f457ad66a3817a53a92e2e8358c6c40dd87846d7188c58","ticketSha256":"80e5e1f80d83532825e061b34b719e4148f1a43136998e95b1785ec2a62cf0b1","dispatchSha256":"1f771c70d270912b839009dac77019f59ba63e3d1113ba215d83ab34df546f58","resultSha256":"2c1da3fb348ba238cf5fadfd54bc221db75db676dad2c9c94d6ac5fae2112f4f","manifestSha256":"2e97a78bc25e515e8091c0a5e54c249aeed8ed390ebc5c10f3873c8fb00d4d1b","oldInstallationSha256":"d11f4f3e5e129ca828a8b1cf4f7dd6e45decce43f85de8dd6bf4e8e3aa767e3c","candidate":"20261019T005631Z-9641179b90868db0","candidateManifestSha256":"9dfe7ac04b0431d8092efc8fdde46962063f023190590d609b95273dfd010853","sourceBindingSha256":"365acda22ee4677c9d8f55eda6a228137f4a543b0bcf5e9990a292bec1522f5d","sourceRootSha256":"5719215fd6b3c37b761a96c3caf6ebb3b3b6d7924ba0656569f723158f08b642","sourceFingerprint":"749333181b288a2350a9d33f26ab550ce619865661cc7f980c702a5ab79f7724","observerSha256":"c627f8d4a01d61e1a0ffa7e49d32bd0fd3b36577e95aefc99dd006bdb430efe9"});
const nativeQueueRoot=path.join(fixedNativeAbandonment.state,'prebuild-queue-v2');
const nativeControlNames=[...schemaControlNames,'tools/frozen-main-source.mjs'].sort();
const nativeOperatorNames=["main-prebuild-queue.mjs", "main-prebuild-task.mjs", "main-control-dispatch.mjs", "main-schema-release.mjs", "release-scope-plan.mjs", "frozen-main-source.mjs", "worker-local-release.mjs", "worker-local-release-rotation.mjs", "d1-retirement-proof.mjs", "native-abandonment-writer.mjs", "native-abandonment-observer.mjs"];
function nativeValidateConfig(old,next){assert.deepEqual(next,old,"The fixed abandonment does not change publisher configuration");}
// All original consumed inputs are fixed, including the old adopted generation.
const nativeOriginalPins=Object.freeze({"D:\\codex-isolated\\main-manual-release-20261016\\prebuild-queue-v2\\dispatches\\693e15d4-3390-49b1-9b7c-48fa4f737d48.json":"1f771c70d270912b839009dac77019f59ba63e3d1113ba215d83ab34df546f58","D:\\codex-isolated\\main-manual-release-20261016\\prebuild-queue-v2\\tickets\\863e1fac-fe1c-4136-986e-c26ef30e4a7f.json":"80e5e1f80d83532825e061b34b719e4148f1a43136998e95b1785ec2a62cf0b1","D:\\codex-isolated\\main-manual-release-20261016\\prebuild-queue-v2\\results\\863e1fac-fe1c-4136-986e-c26ef30e4a7f.json":"2c1da3fb348ba238cf5fadfd54bc221db75db676dad2c9c94d6ac5fae2112f4f","D:\\codex-isolated\\main-manual-release-20261016\\main-publisher-config.json":"9879162ff8955bc616f457ad66a3817a53a92e2e8358c6c40dd87846d7188c58","D:\\codex-isolated\\main-manual-release-20261016\\CONTROL-INSTALLATION.json":"d11f4f3e5e129ca828a8b1cf4f7dd6e45decce43f85de8dd6bf4e8e3aa767e3c","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\1624b830282ef24c0ee094fa42f913029a59296009106eda016dbfe871e87ecb\\MANIFEST.json":"2e97a78bc25e515e8091c0a5e54c249aeed8ed390ebc5c10f3873c8fb00d4d1b","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\1624b830282ef24c0ee094fa42f913029a59296009106eda016dbfe871e87ecb\\tools\\frozen-main-source.mjs":"b4bb57dff7a659a94520bc592e0f42b026d5b2a4def4dacfb928e8635f21f9c6","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\1624b830282ef24c0ee094fa42f913029a59296009106eda016dbfe871e87ecb\\tools\\main-control-dispatch.mjs":"68334ca9733c6f3652245534ed41d0bdae2ab5e70588729d17fc8edb81731fbc","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\1624b830282ef24c0ee094fa42f913029a59296009106eda016dbfe871e87ecb\\tools\\main-prebuild-hook.mjs":"c36f206c97c6fc1ed44604d72c5828bd080951e5fc0176164ce5d1072198ba77","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\1624b830282ef24c0ee094fa42f913029a59296009106eda016dbfe871e87ecb\\tools\\main-prebuild-queue.mjs":"8ad1cac020e6fffc354d6fd70868edc193f2ab8af992598aeb85a4f79058d79c","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\1624b830282ef24c0ee094fa42f913029a59296009106eda016dbfe871e87ecb\\tools\\main-prebuild-status.mjs":"9010056cc8b1ead2cfd4ba17ad5e427f0a0849f6b77ab708b8c3443795e12dc3","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\1624b830282ef24c0ee094fa42f913029a59296009106eda016dbfe871e87ecb\\tools\\main-prebuild-task.mjs":"9f05dedcb953fec984d9c6ee3938a6254f7d5875bbe43018ff88869264c7cb62","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\1624b830282ef24c0ee094fa42f913029a59296009106eda016dbfe871e87ecb\\tools\\main-schema-release.mjs":"3f2e58b8628a5adbb16cdc5ba36f6de575e3c6a49dca2d8dbd01bff8111bdac0","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\1624b830282ef24c0ee094fa42f913029a59296009106eda016dbfe871e87ecb\\tools\\publish-latest-main.mjs":"a5b567fb46981c9a8dc2d8ee2a23f41891ee8adb8c78ea13f7c07d27fbd8e345","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\1624b830282ef24c0ee094fa42f913029a59296009106eda016dbfe871e87ecb\\tools\\publish-main-progress.mjs":"812d82d352fce8ce43a3b42aabcb2fa53cbcfa9c98b7524a33d0de3b521af714","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\1624b830282ef24c0ee094fa42f913029a59296009106eda016dbfe871e87ecb\\tools\\release-scope-plan.mjs":"e32e1e37ae99975b21816a021c266c360bb46c02254586796b09e2a6e3a281b2","D:\\codex-isolated\\main-release-packages\\c36ea9964ea0-fee81c63-4ca6db6e\\main-release-request.json":"313cea6d922a9f94d26ef3f104bd4751d4699d494fe7410b0a4cd6920b75170c","D:\\codex-isolated\\main-release-packages\\c36ea9964ea0-fee81c63-4ca6db6e\\release-scope-plan.json":"26e81636dc50e0c0e42154fcdad3865b86d040f0601c7655735429c0b126e897","D:\\codex-isolated\\main-release-packages\\c36ea9964ea0-fee81c63-4ca6db6e\\publish-c36ea9964ea0\\preparation\\PREPARING.json":"c6cadbd98e9930699127532184a6a4dddfd30af2a486fcc1d78732a518c88480","D:\\codex-isolated\\main-release-packages\\c36ea9964ea0-fee81c63-4ca6db6e\\publish-c36ea9964ea0\\preparation\\source-binding.json":"365acda22ee4677c9d8f55eda6a228137f4a543b0bcf5e9990a292bec1522f5d","D:\\teruisi-runtime\\teruisi-worker-sales\\releases\\20261019T005631Z-9641179b90868db0\\deployment-manifest.json":"9dfe7ac04b0431d8092efc8fdde46962063f023190590d609b95273dfd010853","D:\\codex-isolated\\main-manual-release-20261016\\control-executions\\0550acbd-dd25-404f-a585-366519ad365c.json":"395586c5f90d40a946882d34a70ac42a68374ff8e38e732f1952fc86fd1de827","D:\\codex-isolated\\main-manual-release-20261016\\control-executions\\9da392fb-82a6-4579-af4f-9ab2f7cc0f3a.json":"4eff2314f0586adcff868420c7b4950015a20081e4e2699f1863b7642464bd93","D:\\codex-isolated\\main-release-packages\\c36ea9964ea0-fee81c63-4ca6db6e\\source\\tools\\publish-prepared-main.mjs":"bc746e2e45d495714bc6b2b2808755bb1f9edb448cdb47ff14abfa688343bde3","D:\\codex-isolated\\main-release-packages\\c36ea9964ea0-fee81c63-4ca6db6e\\source\\tools\\worker-local-release-rotation.mjs":"8b3ec38f47c247c6b0d69c62ab0efb105f63cada945ec40cf7debe76f5ff35d7","D:\\codex-isolated\\main-release-packages\\c36ea9964ea0-fee81c63-4ca6db6e\\source\\tools\\worker-local-release.mjs":"dad4e7a1625c4d174541c81669b8c65c0e76bef43e723a87d014947cce362103"});
const nativeActors=Object.freeze([{"file":"D:\\codex-isolated\\main-manual-release-20261016\\control-executions\\0550acbd-dd25-404f-a585-366519ad365c.json","sha256":"395586c5f90d40a946882d34a70ac42a68374ff8e38e732f1952fc86fd1de827","pid":30900,"createdAt":"2026-10-19T00:55:23.9994500Z"},{"file":"D:\\codex-isolated\\main-manual-release-20261016\\control-executions\\9da392fb-82a6-4579-af4f-9ab2f7cc0f3a.json","sha256":"4eff2314f0586adcff868420c7b4950015a20081e4e2699f1863b7642464bd93","pid":51468,"createdAt":"2026-10-19T00:55:16.3171470Z"}]);
export async function nativeAbandonmentOriginals({read=adminStableRead}={}){
 const raw=new Map(),files={};for(const [file,expected] of Object.entries(nativeOriginalPins)){const bytes=await read(file);assert.equal(sha(bytes),expected,'Original 693e input changed: '+file);raw.set(file,bytes);files[file]=expected;}
 const object=digest=>{for(const [file,hash] of Object.entries(files))if(hash===digest)return raw.get(file);throw Error('Missing original object');};
 const manifest=JSON.parse(object(fixedNativeAbandonment.manifestSha256));assert.equal(manifest.bundleSha256,fixedNativeAbandonment.bundleSha256);assert.equal(sha(Buffer.from(canonical(manifest.files))),manifest.bundleSha256);assert.deepEqual(Object.keys(manifest.files).sort(),nativeControlNames);
 for(const [name,digest] of Object.entries(manifest.files))assert.equal(files[path.join(fixedNativeAbandonment.state,'control-bundles',manifest.bundleSha256,name)],digest);
 const ticket=JSON.parse(object(fixedNativeAbandonment.ticketSha256)),dispatch=JSON.parse(object(fixedNativeAbandonment.dispatchSha256)),terminal=JSON.parse(object(fixedNativeAbandonment.resultSha256));validateTicket(ticket,fixedNativeAbandonment.requestId+'.json');validateDispatch(dispatch,fixedNativeAbandonment.dispatchId+'.json');
 assert.equal(dispatch.selectedTarget,fixedNativeAbandonment.target);assert.equal(dispatch.selection.live.mainCommit,fixedNativeAbandonment.base);assert.equal(path.resolve(dispatch.selection.packet),path.resolve(fixedNativeAbandonment.packet));assert.equal(dispatch.bundleSha256,fixedNativeAbandonment.bundleSha256);assert.equal(dispatch.configSha256,fixedNativeAbandonment.configSha256);assert.deepEqual(dispatch.tickets,[{observedTarget:fixedNativeAbandonment.target,requestId:fixedNativeAbandonment.requestId,ticketSha256:fixedNativeAbandonment.ticketSha256}]);assert.equal(terminal.status,'unknown');assert.equal(terminal.dispatchSha256,fixedNativeAbandonment.dispatchSha256);assert.equal(terminal.requestId,fixedNativeAbandonment.requestId);
 const request=JSON.parse(raw.get(path.join(fixedNativeAbandonment.packet,'main-release-request.json'))),preparing=JSON.parse(raw.get(path.join(fixedNativeAbandonment.packet,'publish-c36ea9964ea0/preparation/PREPARING.json')));assert.equal(preparing.requestSha256,sha(Buffer.from(JSON.stringify(request))));assert.equal(request.mainCommit,fixedNativeAbandonment.target);assert.equal(request.migrate,false);assert.deepEqual(request.predecessorWorker,dispatch.selection.live.head);assert.equal(request.predecessorDjangoSha256,dispatch.selection.live.djangoManifestSha256);
 const candidate=JSON.parse(object(fixedNativeAbandonment.candidateManifestSha256));assert.equal(candidate.releaseId,fixedNativeAbandonment.candidate);assert.equal(candidate.source.rootPathSha256,fixedNativeAbandonment.sourceRootSha256);assert.equal(candidate.source.sourceFingerprint,fixedNativeAbandonment.sourceFingerprint);assert.equal(candidate.source.sourceBinding.sha256,fixedNativeAbandonment.sourceBindingSha256);assert.equal(sha(Buffer.from(candidate.source.sourceBinding.raw)),fixedNativeAbandonment.sourceBindingSha256);
 // This exact original awaited plan must finish before PrepareApp or any
 // publication path can start. No registered candidate plan plus the complete
 // exited process closure establishes that the Django phase was never entered.
 const publisher=raw.get(path.join(fixedNativeAbandonment.packet,'source/tools/publish-prepared-main.mjs')).toString('utf8');const planAt=publisher.indexOf('plan=await rotation.planWorkerReleaseRotation('),workerReceiptAt=publisher.indexOf("await fs.writeFile(path.join(preparationOut,'worker-plan.json')"),djangoAt=publisher.indexOf("pkg=await step('准备后台'");assert.ok(planAt>=0&&workerReceiptAt>planAt&&djangoAt>workerReceiptAt);
 for(const actor of nativeActors){const receipt=JSON.parse(object(actor.sha256));assert.equal(receipt.pid,actor.pid);assert.equal(receipt.createdAt,actor.createdAt);assert.equal(receipt.bundleSha256,fixedNativeAbandonment.bundleSha256);}
 return {files,raw,dispatch,terminal,object};
}
export async function assertNativeAbandonmentPacket(){return collectNativeAbandonmentState();}
const nativeWorkerRoot='D:/teruisi-runtime/teruisi-worker-sales',nativeDjangoRoot='D:/teruisi-runtime/django-sales';
const nativeStateDomains=['release-batches','worker-prepared-builds','worker-release-publication-staging','worker-release-rotation-consumptions','worker-release-rotation-plans','worker-release-successors'];
const nativeNormalize=text=>text.replaceAll('\\','/').replace(/\/{2,}/g,'/').toLowerCase();
const nativeNeedles=()=>[fixedNativeAbandonment.target,fixedNativeAbandonment.dispatchId,fixedNativeAbandonment.requestId,fixedNativeAbandonment.candidate,fixedNativeAbandonment.candidateManifestSha256,fixedNativeAbandonment.sourceBindingSha256,fixedNativeAbandonment.sourceRootSha256,fixedNativeAbandonment.sourceFingerprint,fixedNativeAbandonment.packet].map(nativeNormalize);
export function assertNativeNoPublicationBytes(raw){
 const text=nativeNormalize(raw.toString('utf8'));for(const needle of nativeNeedles())assert.equal(text.includes(needle),false,'A native plan/publication/consumption references the abandoned candidate');
}
async function nativeDirectory(directory){
 for(let cursor=path.resolve(directory);;cursor=path.dirname(cursor)){const stat=await fs.lstat(cursor);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink(),'Native evidence directory is redirected');assert.equal(path.resolve(await fs.realpath(cursor)).toLowerCase(),cursor.toLowerCase());if(path.dirname(cursor)===cursor)break;}
}
async function nativeRead(file,{managedIdentity}={}){
 assert.equal(path.resolve(await fs.realpath(file)).toLowerCase(),path.resolve(file).toLowerCase(),'Native evidence traverses a redirected parent');
 const before=await fs.lstat(file);assert.ok(before.isFile()&&!before.isSymbolicLink()&&(before.nlink===1||managedIdentity),'Unsafe native evidence file');if(before.nlink!==1)for(const key of ['dev','ino','size'])assert.equal(before[key],managedIdentity[key],'Managed link target identity changed');
 const raw=await fs.readFile(file),after=await fs.lstat(file);for(const key of ['dev','ino','size','mtimeMs','ctimeMs','nlink'])assert.equal(after[key],before[key],'Native evidence changed during read');return raw;
}
async function nativeWalk(directory,visit){
 await nativeDirectory(directory);const files=[],directories=[];
 const parallel=async(items,action)=>{let index=0;const settled=await Promise.allSettled(Array.from({length:Math.min(16,items.length)},async()=>{for(;;){const item=items[index++];if(item===undefined)return;await action(item);}}));for(const result of settled)if(result.status==='rejected')throw result.reason;};
 const started=Date.now(),pending=[directory];let cursor=0;
 while(cursor<pending.length){const batch=pending.slice(cursor,cursor+16);cursor+=batch.length;await parallel(batch,async current=>{const stat=await fs.lstat(current);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());assert.equal(path.resolve(await fs.realpath(current)).toLowerCase(),path.resolve(current).toLowerCase());const entries=await fs.readdir(current,{withFileTypes:true}),names=entries.map(entry=>entry.name).sort();directories.push({path:current,names});for(const entry of entries){const file=path.join(current,entry.name);assert.equal(entry.isSymbolicLink(),false,'Native inventory contains redirected member');if(entry.isDirectory())pending.push(file);else{assert.ok(entry.isFile());files.push(file);}}});}
 const enumerationMs=Date.now()-started,readStarted=Date.now();
 await parallel(files,async file=>visit(file,await fs.lstat(file)));const readMs=Date.now()-readStarted,checkStarted=Date.now();
 await parallel(directories,async entry=>{assert.equal(path.resolve(await fs.realpath(entry.path)).toLowerCase(),path.resolve(entry.path).toLowerCase());assert.deepEqual((await fs.readdir(entry.path)).sort(),entry.names,'Native directory membership changed');});
 return {fileCount:files.length,directoryCount:directories.length,enumerationMs,readMs,membershipVerificationMs:Date.now()-checkStarted,elapsedMs:Date.now()-started};
}
export function assertNativeAbandonmentProof(value){
 assert.deepEqual(Object.keys(value).sort(),['version','candidateInventorySha256','stateInventorySha256','partialInventorySha256','head','chainStateSha256','djangoManifestSha256'].sort());assert.equal(value.version,'teruisi-native-quiescence-state-693e-v1');
 for(const key of ['candidateInventorySha256','stateInventorySha256','partialInventorySha256'])assert.match(value[key]??'',hex);
 assert.equal(value.head.releaseId,'20261018T162837Z-9a9245927d9aa8d5');assert.equal(value.head.bindingSha256,'fee81c63b551c652486266cf5ff25266b37e6810d5840aef5e06f85693415c73');assert.equal(value.head.manifestSha256,'dd027caf04991a93d6cf04dc07b1f874b6e823d7c7c5f8434835e5dc16153833');assert.equal(value.chainStateSha256,'2d9ccf0c151c53813ee8bfe211fa700a943e753de816af91cf8f4f2b0f7ab49b');assert.equal(value.djangoManifestSha256,'4ca6db6eb7e407cb456b7abb4ee29050fa7fe98b07de0d3fffe35e38e3244101');return true;
}
/** Read-only, fixed physical domains. Candidate payload hashes are evidence only;
 * no payload or secret bytes are copied into the archive. */
export async function collectNativeAbandonmentState({objects=new Map(),onStage=async()=>{}}={}){
 const measure=async(phase,action)=>{const at=new Date().toISOString(),started=Date.now();await onStage({phase,status:'started',at});const value=await action();await onStage({phase,status:'completed',at:new Date().toISOString(),elapsedMs:Date.now()-started,...(value&&typeof value==='object'?value:{})});return value;};
 const put=raw=>{objects.set(sha(raw),raw);return sha(raw);},json=value=>put(Buffer.from(canonical(value)));
 const candidateRoot=path.join(nativeWorkerRoot,'releases',fixedNativeAbandonment.candidate),candidate=[];
 const manifestRaw=await nativeRead(path.join(candidateRoot,'deployment-manifest.json'));assert.equal(sha(manifestRaw),fixedNativeAbandonment.candidateManifestSha256);const manifest=JSON.parse(manifestRaw);
 const managedSource=path.resolve(manifest.runtime.devVars.sourcePath);assert.equal(managedSource.toLowerCase(),path.resolve('D:/运营管理系统/.dev.vars').toLowerCase());assert.equal(path.resolve(await fs.realpath(managedSource)).toLowerCase(),managedSource.toLowerCase());const sourceStat=await fs.lstat(managedSource);assert.ok(sourceStat.isFile()&&!sourceStat.isSymbolicLink());
 await measure('candidate-complete-inventory',()=>nativeWalk(candidateRoot,async(file,stat)=>{const relative=path.relative(candidateRoot,file).replaceAll('\\','/');const managed=[manifest.runtime.devVars.releaseLink,manifest.runtime.devVars.workerLink].includes(relative);if(stat.nlink!==1){assert.equal(managed,true,'Unapproved candidate hard link');assert.equal(stat.dev,sourceStat.dev);assert.equal(stat.ino,sourceStat.ino);assert.equal(stat.size,sourceStat.size);}const raw=await nativeRead(file,{managedIdentity:managed?sourceStat:undefined});candidate.push({path:relative,size:raw.length,sha256:sha(raw)});}));
 const releaseInventory=[];const releases=path.join(nativeWorkerRoot,'releases');await nativeDirectory(releases);const releaseNames=(await fs.readdir(releases)).sort();for(const name of releaseNames){assert.match(name,/^\d{8}T\d{6}Z-[a-f0-9]{16}$/,'Unknown native release directory');await nativeDirectory(path.join(releases,name));const bytes=await nativeRead(path.join(releases,name,'deployment-manifest.json'));if(name===fixedNativeAbandonment.candidate)assert.equal(sha(bytes),fixedNativeAbandonment.candidateManifestSha256);else{assertNativeNoPublicationBytes(bytes);releaseInventory.push({path:'teruisi-worker-sales/releases/'+name+'/deployment-manifest.json',size:bytes.length,sha256:put(bytes)});}}assert.deepEqual((await fs.readdir(releases)).sort(),releaseNames,'Release inventory changed during closure');
 const state=[...releaseInventory];
 const addState=async file=>{const relative=path.relative('D:/teruisi-runtime',file).replaceAll('\\','/');assert.match(relative,/\.(json|json\.sha256)$/,'Unknown native state member');const raw=await nativeRead(file);if(file.endsWith('.json'))JSON.parse(raw.toString('utf8'));else{assert.match(raw.toString('ascii'),/^[a-f0-9]{64}\r?\n$/);assert.equal(raw.toString('ascii').trim(),sha(await nativeRead(file.slice(0,-7))),'Native state sidecar changed');}assertNativeNoPublicationBytes(raw);state.push({path:relative,size:raw.length,sha256:put(raw)});};
 for(const domain of nativeStateDomains)await measure('state-'+domain,()=>nativeWalk(path.join(nativeWorkerRoot,'state',domain),addState));
 await addState(path.join(nativeWorkerRoot,'current-deployment.json'));
 await nativeDirectory(nativeDjangoRoot);const djangoNames=(await fs.readdir(nativeDjangoRoot)).sort();
 for(const name of djangoNames){if(/^app\.prepare-[a-f0-9]{32}\.json$/.test(name))await addState(path.join(nativeDjangoRoot,name));else if(/^app\.deploy-[a-f0-9]{32}$/.test(name)){await nativeDirectory(path.join(nativeDjangoRoot,name));await addState(path.join(nativeDjangoRoot,name,'deployment.json'));}else if(name.startsWith('app.prepare-')||name.startsWith('app.deploy-'))throw Error('Unknown Django preparation member');}
 assert.deepEqual((await fs.readdir(nativeDjangoRoot)).sort(),djangoNames);await addState(path.join(nativeDjangoRoot,'app/deployment.json'));
 const partial=[];const preparation=path.join(fixedNativeAbandonment.packet,'publish-c36ea9964ea0');
 await nativeWalk(preparation,async(file)=>{const relative=path.relative(preparation,file).replaceAll('\\','/');assert.ok(['preparation/PREPARING.json','preparation/source-binding.json'].includes(relative),'Original packet gained a completion or publication artifact');const raw=await nativeRead(file);partial.push({path:relative,size:raw.length,sha256:put(raw)});});
 assert.deepEqual((await fs.readdir(path.join(fixedNativeAbandonment.packet,'invocations'))),[],'Original native invocations gained a late entry');
 const staging=path.join(nativeWorkerRoot,'.staging/deploy-2bad88cd-83fb-4530-a445-fb5e2644bf16');
 await measure('staging-complete-inventory',()=>nativeWalk(staging,async(file)=>{const raw=await nativeRead(file);partial.push({path:'staging/'+path.relative(staging,file).replaceAll('\\','/'),size:raw.length,sha256:sha(raw)});}));
 const {resolveEffectiveReleaseChain}=await import('./worker-local-release-rotation.mjs');const chain=await measure('effective-head-and-fence',async()=>{const value=await resolveEffectiveReleaseChain({verifyInstalledHead:true});return {head:value.head,chainStateSha256:value.chainStateSha256};});
 const value={version:'teruisi-native-quiescence-state-693e-v1',candidateInventorySha256:json(candidate.sort((a,b)=>a.path.localeCompare(b.path))),stateInventorySha256:json({domains:nativeStateDomains,entries:state.sort((a,b)=>a.path.localeCompare(b.path))}),partialInventorySha256:json(partial.sort((a,b)=>a.path.localeCompare(b.path))),head:chain.head,chainStateSha256:chain.chainStateSha256,djangoManifestSha256:sha(await nativeRead(path.join(nativeDjangoRoot,'app/deployment.json')))};
 assertNativeAbandonmentProof(value);return value;
}
async function verifyNativeAbandonmentArchive(proof,object){
 assertNativeAbandonmentProof(proof);
 for(const key of ['candidateInventorySha256','stateInventorySha256','partialInventorySha256']){const inventory=JSON.parse(await object(proof[key]));if(key==='stateInventorySha256'){assert.deepEqual(Object.keys(inventory).sort(),['domains','entries']);assert.deepEqual(inventory.domains,nativeStateDomains);}const entries=key==='stateInventorySha256'?inventory.entries:inventory;assert.ok(Array.isArray(entries)&&entries.length>0);const paths=new Set();for(const item of entries){assert.deepEqual(Object.keys(item).sort(),['path','sha256','size']);assert.ok(typeof item.path==='string'&&item.path&&!item.path.startsWith('/')&&!item.path.split('/').includes('..')&&!paths.has(item.path));paths.add(item.path);assert.ok(Number.isSafeInteger(item.size)&&item.size>=0);assert.match(item.sha256,hex);if(key==='stateInventorySha256'){assert.ok(item.path==='teruisi-worker-sales/current-deployment.json'||/^teruisi-worker-sales\/releases\/\d{8}T\d{6}Z-[a-f0-9]{16}\/deployment-manifest\.json$/.test(item.path)||nativeStateDomains.some(domain=>item.path.startsWith('teruisi-worker-sales/state/'+domain+'/'))||/^django-sales\/(?:app(?:\.deploy-[a-f0-9]{32})?\/deployment|app\.prepare-[a-f0-9]{32})\.json$/.test(item.path),'Unknown archived native domain');const raw=await object(item.sha256);assert.equal(raw.length,item.size);assertNativeNoPublicationBytes(raw);}}
  if(key==='candidateInventorySha256')assert.equal(entries.find(item=>item.path==='deployment-manifest.json')?.sha256,fixedNativeAbandonment.candidateManifestSha256);
 }
}
/** Independent observer verifies the two certified complete inventories without
 * re-reading the retained candidate payload. All of this precedes its CIM. */
export async function verifyNativeObservationInputs(request){
 nativeValidateEpoch(request.epoch,request.deadlineUnixMs,request.writer.processId);nativeValidateStatic(request.staticEvidence,request.epoch,request.deadlineUnixMs,{final:request.phase==='final-observation'});assert.ok(Date.now()<=request.deadlineUnixMs,'Finite observation epoch expired');
 assert.equal(path.resolve(request.evidenceDirectory),path.resolve(nativeQueueRoot,'resolutions',fixedNativeAbandonment.dispatchId+'-evidence'));
 const archive=JSON.parse(await fs.readFile(path.join(request.operatorSource,'tests/fixtures/fixed-native-693e-evidence.json'),'utf8'));
 await nativeAbandonmentOriginals({read:async file=>{const expected=nativeOriginalPins[file];assert.match(expected??'',hex);return file.startsWith(nativeQueueRoot+path.sep)||file.startsWith(path.resolve(fixedNativeAbandonment.packet)+path.sep)||file.includes(fixedNativeAbandonment.candidate)?adminStableRead(file):Buffer.from(archive.objects[expected],'base64');}});
 const {readAdoptedControl}=await import('./main-control-dispatch.mjs'),binding=await readAdoptedControl(path.join(fixedNativeAbandonment.state,'main-publisher-config.json'));assert.equal(binding.stateSha256,request.adoptionSha256);assert.deepEqual(binding.state.preparationTask,request.task);const manifest=JSON.parse(await nativeRead(path.join(binding.bundleRoot,'MANIFEST.json')));assert.equal(manifest.sourceCommit,request.sourceIdentity.commit);assert.equal(manifest.sourceTree,request.sourceIdentity.tree);
 const object=async digest=>{assert.match(digest??'',hex);const raw=await nativeArchiveRead(path.join(request.evidenceDirectory,'objects',digest+'.bin'));assert.equal(sha(raw),digest);return raw;};for(const record of [request.staticEvidence.initial,request.staticEvidence.final].filter(Boolean)){const raw=Buffer.from(canonical(record));assert.deepEqual(await object(sha(raw)),raw);}await verifyNativeAbandonmentArchive(request.staticEvidence.initial.proof,object);
 const preparing=path.join(fixedNativeAbandonment.packet,'publish-c36ea9964ea0');await nativeWalk(preparing,async file=>assert.ok(['preparation/PREPARING.json','preparation/source-binding.json'].includes(path.relative(preparing,file).replaceAll('\\','/')),'Late original preparation or publication artifact'));assert.deepEqual(await fs.readdir(path.join(fixedNativeAbandonment.packet,'invocations')),[]);
 const {resolveEffectiveReleaseChain}=await import('./worker-local-release-rotation.mjs'),chain=await resolveEffectiveReleaseChain({verifyInstalledHead:true});assert.deepEqual(chain.head,request.staticEvidence.initial.proof.head);assert.equal(chain.chainStateSha256,request.staticEvidence.initial.proof.chainStateSha256);assert.equal(sha(await nativeRead(path.join(nativeDjangoRoot,'app/deployment.json'))),request.staticEvidence.initial.proof.djangoManifestSha256);
 return request.staticEvidence.initial.proof;
}
function assertNativeAncestry(rows){
 const byPid=new Map(rows.map(row=>[row.processId,row]));assert.equal(byPid.size,rows.length,'Duplicate process identity');
 for(const actor of nativeActors)for(const row of rows){let current=row;const seen=new Set();while(current&&current.processId!==0){assert.ok(!seen.has(current.processId),'Process ancestry cycle');seen.add(current.processId);assert.ok(Number.isSafeInteger(current.parentProcessId)&&current.parentProcessId>=0,'Process ancestry unreadable');if(current.parentProcessId===actor.pid){assert.ok(current.creationDate&&Date.parse(current.creationDate)<Date.parse(actor.createdAt)||byPid.get(actor.pid)?.creationDate&&Date.parse(byPid.get(actor.pid).creationDate)>Date.parse(actor.createdAt)&&Date.parse(byPid.get(actor.pid).creationDate)<=Date.parse(current.creationDate),'Original actor descendant remains or ancestry is ambiguous');break;}const parent=byPid.get(current.parentProcessId);if(!parent)break;assert.ok(current.creationDate&&parent.creationDate,'Process ancestry birth is unreadable');if(Date.parse(parent.creationDate)>Date.parse(current.creationDate))break;current=parent;}}
 return byPid;
}
export function assertNativeActorsAbsent(rows){
 const byPid=assertNativeAncestry(rows);
 return nativeActors.map(actor=>{const row=byPid.get(actor.pid);if(!row)return {pid:actor.pid,originalBirth:actor.createdAt,state:'absent'};assert.ok(row.creationDate&&Date.parse(row.creationDate)>Date.parse(actor.createdAt),'Original native preparation actor remains or identity is ambiguous');assert.ok(row.commandLine&&row.executablePath&&row.name,'Reused actor PID is opaque');assert.equal(nativeControlText(decodeSchemaControlCommand(row.commandLine)),false,'Reused PID is a related controller');return {pid:actor.pid,originalBirth:actor.createdAt,state:'reused-unrelated-pid',currentBirth:row.creationDate,currentName:row.name};});
}
function nativeControlText(text){return schemaControlPath(text)||nativeNormalize(text).includes(nativeNormalize(fixedNativeAbandonment.packet))||nativeNormalize(text).includes(nativeNormalize(path.join(nativeWorkerRoot,'releases',fixedNativeAbandonment.candidate)))||nativeNormalize(text).includes('deploy-2bad88cd-83fb-4530-a445-fb5e2644bf16');}
function nativeBuildCommand(row,text){return schemaControlName(row.name)&&Date.parse(row.creationDate)>=Date.parse('2026-10-19T00:55:16.3171470Z')&&/(?:npm-cli\.js|npx-cli\.js|[ /"']vinext(?:[ /"'.]|$)|vite\/bin\/vite|(?:^|\s)(?:run\s+)?build(?:\s|$)|process-deadline\.mjs)/.test(text);}
export function classifyNativeControllers(rows,{writer,observer}){
 const related=new Set(classifySchemaControllers(rows,{writer,observer}));for(const row of rows){if([writer.processId,observer.processId].includes(row.processId))continue;if(row.commandLine){const text=decodeSchemaControlCommand(row.commandLine);if(nativeControlText(text)||nativeBuildCommand(row,text))related.add(row.processId);}}
 for(let changed=true;changed;){changed=false;for(const row of rows)if(related.has(row.parentProcessId)&&!related.has(row.processId)){related.add(row.processId);changed=true;}}
 assertNativeActorsAbsent(rows);return [...related].sort((a,b)=>a-b);
}
export async function assertNativeResolutionInventory(directory,{allowOriginal=true}={}){
 assert.equal(path.resolve(directory).toLowerCase(),path.resolve(nativeQueueRoot).toLowerCase());
 const tickets=await allTickets(directory);
 for(const item of tickets){const terminal=await ticketResult(directory,item.value.requestId,item.sha256);assert.ok(terminal,'Pending ticket remains');}
 for(const name of await entries(directory,'dispatches')){
  const read=await readQueueObject(path.join(directory,'dispatches',name));validateDispatch(read.value,name);
  for(const ref of read.value.tickets){const terminal=await ticketResult(directory,ref.requestId,ref.ticketSha256);assert.ok(terminal);
   if(['unknown','failed','blocked'].includes(terminal.status)){
    if(await readFixedAdminRejectionResolution(directory,read.value,terminal))continue;
    if(await readFixedSchemaRejectionResolution(directory,read.value,terminal))continue;
    if(await readFixedCacheRejectionResolution(directory,read.value,terminal))continue;
    if(allowOriginal&&read.value.dispatchId===fixedNativeAbandonment.dispatchId&&read.sha256===fixedNativeAbandonment.dispatchSha256&&terminal.requestId===fixedNativeAbandonment.requestId&&terminal.status==='unknown')continue;
    if(await readFixedNativeAbandonmentResolution(directory,read.value,terminal))continue;
    throw Error('Another unresolved dispatch remains');
   }
  }
 }
}
function nativeActorsFromProjection(rows){assertNativeAncestry(rows);return nativeActors.map(actor=>{const row=rows.find(row=>row.processId===actor.pid);if(!row)return {pid:actor.pid,originalBirth:actor.createdAt,state:'absent'};assert.ok(row.creationDate&&Date.parse(row.creationDate)>Date.parse(actor.createdAt),'Original actor remains in historical census');assert.match(row.commandLineSha256??'',hex);assert.match(row.executablePathSha256??'',hex);return {pid:actor.pid,originalBirth:actor.createdAt,state:'reused-unrelated-pid',currentBirth:row.creationDate,currentName:row.name};});}
export function nativeCrossTokenDiagnostic(witness,current){
 const low=schemaCensusProjection(current),known=new Map(witness.filter(row=>row.controlCandidate).map(row=>[row.processId,row]));
 const newOpaque=current.filter(row=>schemaControlName(row.name)&&(!row.commandLine||!row.executablePath||!row.creationDate)&&!known.has(row.processId)).map(row=>({processId:row.processId,parentProcessId:row.parentProcessId,name:row.name,creationDate:row.creationDate,reason:'New opaque process after witness'}));
 return {high:witness,low,newOpaque};
}
export function assertNativeActorWitness(witness,rows){
 assertNativeAncestry(rows);const projected=schemaCensusProjection(rows);for(const actor of nativeActors){const current=projected.find(row=>row.processId===actor.pid);if(!current)continue;assert.ok(current.creationDate&&Date.parse(current.creationDate)>Date.parse(actor.createdAt),'Original native actor remains or birth is unavailable');const known=witness.find(row=>row.processId===actor.pid);assert.ok(known,'Reused original PID appeared after witness');for(const key of ['processId','parentProcessId','name','creationDate'])assert.equal(current[key],known[key],'Original actor PID identity drifted after witness');for(const key of ['commandLineSha256','executablePathSha256']){assert.match(known[key]??'',hex,'Reused actor witness identity incomplete');if(current[key]!==null)assert.equal(current[key],known[key],'Reused actor visible metadata drifted');}}
 return true;
}
function nativeValidateObservation(value,request){
 assert.deepEqual(Object.keys(request).sort(),['version','dispatchId','phase','nonce','at','writer','taskDefinitionSha256','task','operatorSource','observerCodeSha256','sourceIdentity','operatorFiles','epoch','deadlineUnixMs','staticEvidence','evidenceDirectory','adoptionSha256'].sort());assert.equal(request.version,'teruisi-native-abandonment-request-693e-v2');assert.equal(request.dispatchId,fixedNativeAbandonment.dispatchId);assert.match(request.nonce??'',/^[a-f0-9]{32}$/);assert.deepEqual(Object.keys(request.operatorFiles).sort(),nativeOperatorNames.toSorted());
 nativeValidateEpoch(request.epoch,request.deadlineUnixMs,request.writer.processId);nativeValidateStatic(request.staticEvidence,request.epoch,request.deadlineUnixMs,{final:request.phase==='final-observation'});assert.ok(Date.parse(request.at)>=Date.parse((request.staticEvidence.final??request.staticEvidence.initial).completedAt)&&Date.parse(request.at)<=request.deadlineUnixMs,'Challenge predates its certified complete inventory');assert.equal(path.resolve(request.evidenceDirectory),path.resolve(nativeQueueRoot,'resolutions',fixedNativeAbandonment.dispatchId+'-evidence'));assert.match(request.adoptionSha256,hex);
 assert.deepEqual(Object.keys(value).sort(),['version','dispatchId','requestSha256','nonce','phase','at','writer','observer','observerCodeSha256','elevated','completeCensus','censusCount','census','relatedControllers','relatedOpaque','taskState','taskInstances','taskDefinitionSha256','sourceCommit','sourceTree','sourceClean','packet','actors','operatorSourceIdentity','operatorFiles','dynamicStartedAt','dynamicCompletedAt','staticEvidenceSha256'].sort());assert.equal(typeof value.elevated,'boolean');assert.ok(Array.isArray(value.census)&&value.census.length===value.censusCount);assertSchemaWitnessCensus(value.census,value.census.map(row=>({...row,commandLine:null,executablePath:null})),{protectedActors:[request.writer,value.observer]});assert.deepEqual(value.operatorSourceIdentity,request.sourceIdentity);assert.deepEqual(value.operatorFiles,request.operatorFiles);
 assert.equal(value.version,'teruisi-native-abandonment-observation-693e-v2');assert.equal(value.dispatchId,fixedNativeAbandonment.dispatchId);assert.equal(value.requestSha256,sha(Buffer.from(canonical(request))));assert.equal(value.nonce,request.nonce);assert.equal(value.phase,request.phase);assert.equal(value.writer.processId,request.writer.processId);assert.deepEqual(value.writer,request.writer);assert.equal(value.staticEvidenceSha256,sha(Buffer.from(canonical(request.staticEvidence))));assert.deepEqual(value.packet,request.staticEvidence.initial.proof);
 assert.equal(value.observerCodeSha256,fixedNativeAbandonment.observerSha256);assert.ok(value.observer.processId>0&&value.observer.processId!==request.writer.processId);for(const key of ['creationDate','commandLine','executablePath'])assert.ok(typeof value.observer[key]==='string'&&value.observer[key]);
 assert.deepEqual(value.relatedControllers,[]);assert.equal(value.relatedOpaque,0);assert.equal(value.completeCensus,true);assert.equal(value.taskState,3);assert.equal(value.taskInstances,0);assert.equal(value.taskDefinitionSha256,request.taskDefinitionSha256);assert.equal(value.sourceCommit,fixedNativeAbandonment.target);assert.equal(value.sourceClean,true);assert.equal(value.sourceTree,fixedNativeAbandonment.tree);assertNativeAbandonmentProof(value.packet);
 assert.equal(value.elevated,true);assert.deepEqual(value.actors.map(row=>({pid:row.pid,originalBirth:row.originalBirth})),nativeActors.map(row=>({pid:row.pid,originalBirth:row.createdAt})));assert.deepEqual(value.actors,nativeActorsFromProjection(value.census));
 const start=Date.parse(value.dynamicStartedAt),end=Date.parse(value.dynamicCompletedAt),at=Date.parse(value.at);assert.ok(start>=Date.parse(request.at)&&end>=start&&at>=end&&at-start<60000,'Dynamic observation timestamps are stale or reordered');assert.ok(at<=request.deadlineUnixMs,'Observation exceeded its same-lock epoch');
 return value;
}
function nativeValidateEpoch(epoch,deadline,pid){assert.deepEqual(Object.keys(epoch).sort(),['id','startedAt','writerPid']);assert.match(epoch.id,id);assert.equal(epoch.writerPid,pid);assert.ok(Number.isFinite(Date.parse(epoch.startedAt)));assert.equal(deadline,Date.parse(epoch.startedAt)+20*60*1000,'Finite resolution epoch must be exactly bounded');}
function nativeValidateStatic(value,epoch,deadline,{final=true}={}){
 assert.deepEqual(Object.keys(value).sort(),['initial','final'].sort());assert.ok(value.initial);assert.equal(value.final===null,!final);
 for(const item of [value.initial,value.final].filter(Boolean)){assert.deepEqual(Object.keys(item).sort(),['completedAt','proof','startedAt']);assert.ok(Date.parse(item.startedAt)>=Date.parse(epoch.startedAt)&&Date.parse(item.completedAt)>=Date.parse(item.startedAt)&&Date.parse(item.completedAt)<=deadline);assertNativeAbandonmentProof(item.proof);}
 if(final){assert.deepEqual(value.initial.proof,value.final.proof,'Initial and final complete inventories differ');assert.ok(Date.parse(value.final.startedAt)>=Date.parse(value.initial.completedAt));}
 return true;
}
async function nativeArchiveRead(file){const stat=await fs.lstat(file);assert.ok(stat.size<=32*1024*1024,'Unbounded native archive object');return nativeRead(file);}
async function nativeReadResolution({read=nativeArchiveRead}={}){
 const file=path.join(nativeQueueRoot,'resolutions',fixedNativeAbandonment.dispatchId+'.json'),raw=await read(file),value=JSON.parse(raw);assert.equal(raw.toString(),canonical(value));
 assert.deepEqual(Object.keys(value).sort(),['version','decision','at','dispatchId','dispatchSha256','requestId','targetCommit','originalResultSha256','terminationBasis','partialArtifactsRetained','nativePreparationStarted','prepared','publicationPerformed','retryOriginal','writerPid','sourceIdentity','operatorFiles','originals','adoptionSha256','evidenceDirectory','observations','epoch','deadlineUnixMs','staticEvidence'].sort());assert.equal(value.decision,'abandoned-after-native-start');assert.deepEqual(Object.keys(value.operatorFiles).sort(),nativeOperatorNames.toSorted());nativeValidateEpoch(value.epoch,value.deadlineUnixMs,value.writerPid);nativeValidateStatic(value.staticEvidence,value.epoch,value.deadlineUnixMs);assert.ok(Date.parse(value.at)<=value.deadlineUnixMs);
 assert.equal(value.version,fixedNativeAbandonment.version);assert.equal(value.dispatchId,fixedNativeAbandonment.dispatchId);assert.equal(value.requestId,fixedNativeAbandonment.requestId);assert.equal(value.targetCommit,fixedNativeAbandonment.target);assert.equal(value.dispatchSha256,fixedNativeAbandonment.dispatchSha256);assert.equal(value.originalResultSha256,fixedNativeAbandonment.resultSha256);assert.equal(value.terminationBasis,'quiescent-no-publication');assert.equal(value.partialArtifactsRetained,true);assert.equal(value.nativePreparationStarted,true);
 for(const key of ['prepared','publicationPerformed','retryOriginal'])assert.equal(value[key],false);
 const evidence=path.join(nativeQueueRoot,'resolutions',fixedNativeAbandonment.dispatchId+'-evidence');assert.equal(path.resolve(value.evidenceDirectory),path.resolve(evidence));
 const object=async digest=>{assert.match(digest??'',hex);const bytes=await read(path.join(evidence,'objects',digest+'.bin'));assert.equal(sha(bytes),digest);return bytes;};
 for(const record of [value.staticEvidence.initial,value.staticEvidence.final]){const raw=Buffer.from(canonical(record));assert.deepEqual(await object(sha(raw)),raw);}
 const originals=await nativeAbandonmentOriginals({read:async file=>file.startsWith(nativeQueueRoot+path.sep)?read(file):object(value.originals[file])});assert.deepEqual(value.originals,originals.files);

 const oldInstallation=JSON.parse(await object(fixedNativeAbandonment.oldInstallationSha256));
 const adopted=JSON.parse(await object(value.adoptionSha256));nativeValidateConfig(JSON.parse(await object(fixedNativeAbandonment.configSha256)),JSON.parse(await object(adopted.configSha256)));const manifest=JSON.parse(await object(adopted.bundleManifestSha256));assert.equal(adopted.status,'adopted');assert.equal(adopted.version,'teruisi-main-control-installation-v3');assert.notEqual(adopted.bundleSha256,fixedNativeAbandonment.bundleSha256);assert.equal(adopted.configSha256,fixedNativeAbandonment.configSha256);assert.equal(path.resolve(adopted.bundleRoot),path.resolve(fixedNativeAbandonment.state,'control-bundles',adopted.bundleSha256));assert.deepEqual(adopted.preparationTask,oldInstallation.preparationTask);
 assert.equal(manifest.bundleSha256,adopted.bundleSha256);assert.equal(sha(Buffer.from(canonical(manifest.files))),manifest.bundleSha256);assert.deepEqual(Object.keys(manifest.files).sort(),nativeControlNames);
 for(const [name,digest] of Object.entries(manifest.files))await object(digest);
 const intent=JSON.parse(await object(adopted.intentSha256)),transition=JSON.parse(await object(adopted.transitionProofSha256));assert.equal(intent.version,'teruisi-main-control-upgrade-v2');assert.equal(intent.installId,adopted.installId);for(const key of ['bundleRoot','bundleSha256','bundleManifestSha256','dispatcherSha256','hook','hookSha256','configSha256'])assert.equal(intent[key],adopted[key]);assert.equal(path.resolve(intent.stateDirectory),path.resolve(fixedNativeAbandonment.state));assert.equal(path.resolve(intent.configFile),path.resolve(fixedNativeAbandonment.state,'main-publisher-config.json'));assert.equal(manifest.sourceCommit,intent.sourceCommit);assert.equal(manifest.sourceTree,intent.sourceTree);assert.equal(transition.version,'teruisi-main-control-transition-v2');assert.equal(transition.installId,adopted.installId);assert.equal(transition.intentSha256,adopted.intentSha256);assert.deepEqual(transition.lockOrder,['v1-queue','v2-queue','native-rotation']);assert.equal(transition.rotationPipeSha256,sha('\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1'));assert.equal(transition.productionDeploymentPerformed,false);assert.equal(transition.privateTestTopology,false);assert.equal(transition.legacyWindowConverged,true);assert.ok(transition.frames?.length>=3);for(const frame of transition.frames.slice(-3)){assert.deepEqual(frame.related,[]);assert.ok(Date.parse(frame.at)<=Date.parse(adopted.adoptedAt));}await object(adopted.dispatcherSha256);await object(adopted.hookSha256);
 assert.equal(value.sourceIdentity.commit,manifest.sourceCommit);assert.equal(value.sourceIdentity.tree,manifest.sourceTree);assert.equal(value.sourceIdentity.status,'');
 for(const name of nativeOperatorNames){const digest=value.operatorFiles[name];await object(digest);if(manifest.files['tools/'+name])assert.equal(digest,manifest.files['tools/'+name]);}assert.equal(value.operatorFiles['native-abandonment-observer.mjs'],fixedNativeAbandonment.observerSha256);
 assert.equal(value.observations.length,2);const observations=[],acks=[];
 for(const [index,pair] of value.observations.entries()){
  assert.deepEqual(Object.keys(pair).sort(),['ackSha256','observationSha256','requestSha256']);const request=JSON.parse(await object(pair.requestSha256)),observation=nativeValidateObservation(JSON.parse(await object(pair.observationSha256)),request),ack=JSON.parse(await object(pair.ackSha256));
  assert.equal(request.phase,index===0?'initial-observation':'final-observation');assert.deepEqual(request.epoch,value.epoch);assert.equal(request.deadlineUnixMs,value.deadlineUnixMs);assert.equal(request.adoptionSha256,value.adoptionSha256);assert.deepEqual(request.staticEvidence.initial,value.staticEvidence.initial);assert.deepEqual(request.staticEvidence.final,index===0?null:value.staticEvidence.final);assert.deepEqual(request.sourceIdentity,value.sourceIdentity);assert.deepEqual(request.operatorFiles,value.operatorFiles);assert.equal(request.observerCodeSha256,fixedNativeAbandonment.observerSha256);assert.deepEqual(request.task,adopted.preparationTask);assert.equal(request.writer.processId,value.writerPid);assert.equal(request.taskDefinitionSha256,sha(Buffer.from(canonical(adopted.preparationTask.definition))));assert.ok(Date.parse(observation.at)>=Date.parse(adopted.adoptedAt));await object(observation.observerCodeSha256);await verifyNativeAbandonmentArchive(observation.packet,object);
  nativeValidateAck(ack,request,observation);assert.ok(Date.parse(value.at)>=Date.parse(ack.at));if(index===1)assert.ok(Date.parse(value.at)-Date.parse(observation.dynamicStartedAt)<60000&&Date.parse(value.at)-Date.parse(ack.censusStartedAt)<60000,'Final dynamic sampling expired before resolution append');observations.push(observation);acks.push(ack);
 }
 assert.ok(Date.parse(value.staticEvidence.final.startedAt)>=Date.parse(acks[0].at),'Final complete inventory did not follow the initial observation');
 assert.equal(observations[0].sourceTree,observations[1].sourceTree);assert.deepEqual(observations[0].packet,observations[1].packet);assert.notEqual(observations[0].nonce,observations[1].nonce);assert.ok(Date.parse(observations[1].at)>=Date.parse(observations[0].at));
 return true;
}
function nativeValidateAck(ack,request,observation){assert.deepEqual(Object.keys(ack).sort(),['at','censusCompletedAt','censusStartedAt','requestSha256','writerPid']);assert.equal(ack.requestSha256,sha(Buffer.from(canonical(request))));assert.equal(ack.writerPid,request.writer.processId);const start=Date.parse(ack.censusStartedAt),end=Date.parse(ack.censusCompletedAt),at=Date.parse(ack.at);assert.ok(start>=Date.parse(observation.dynamicCompletedAt)&&end>=start&&at>=end&&at<=request.deadlineUnixMs&&at-Date.parse(observation.dynamicStartedAt)<60000&&at-start<60000,'Ordinary cross-token acknowledgement is stale or reordered');}
export async function readFixedNativeAbandonmentResolution(directory,dispatch,terminal){
 if(path.resolve(directory).toLowerCase()!==path.resolve(nativeQueueRoot).toLowerCase()||dispatch.dispatchId!==fixedNativeAbandonment.dispatchId||terminal?.requestId!==fixedNativeAbandonment.requestId||terminal.status!=='unknown')return false;
 const file=path.join(directory,'resolutions',fixedNativeAbandonment.dispatchId+'.json');try{await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return false;throw error;}
 return nativeReadResolution();
}
function assertFixedNativeNoReplay(directory,selection){if(path.resolve(directory).toLowerCase()===path.resolve(nativeQueueRoot).toLowerCase())assert.notEqual(selection.targetCommit,fixedNativeAbandonment.target,'The abandoned 693e target cannot be prepared again');}
/** Operator only. The CLI has no target/retry/path override for original state. */
export async function writeFixedNativeAbandonmentResolution({sourceRoot,out,observe,identity,ordinary,adopted,assertAdopted,git,oldInstallation,acquireRotation,freshCensus,originalArchive,collectState=collectNativeAbandonmentState}={}){
 const [{promisify},{execFile},{fileURLToPath}]=await Promise.all([import('node:util'),import('node:child_process'),import('node:url')]);const execute=promisify(execFile);
 git??=async(root,args)=>(await execute('git',['-C',root,...args],{encoding:'utf8',windowsHide:true})).stdout.trim();
 const sourceIdentity=async root=>({commit:await git(root,['rev-parse','HEAD']),tree:await git(root,['rev-parse','HEAD^{tree}']),status:await git(root,['status','--porcelain'])});
 const self=fileURLToPath(import.meta.url);assert.equal(path.resolve(sourceRoot,'tools/main-prebuild-queue.mjs'),path.resolve(self),'Writer must use its own frozen source');
 const {readAdoptedControl,assertControlGeneration}=await import('./main-control-dispatch.mjs');
 const task=await import('./main-prebuild-task.mjs');
 ordinary??=async()=>task.assertOrdinaryIdentity(await task.currentPreparationIdentity(),(await readAdoptedControl(path.join(fixedNativeAbandonment.state,'main-publisher-config.json'))).state.preparationTask.sid);
 identity??=async()=>task.taskPowerShell('$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$v.pid);if(-not $p -or -not $p.CommandLine -or -not $p.ExecutablePath){throw "Writer process identity unavailable"};@{processId=[int]$p.ProcessId;creationDate=$p.CreationDate.ToUniversalTime().ToString("o");commandLine=$p.CommandLine;executablePath=$p.ExecutablePath}|ConvertTo-Json -Compress',{pid:process.pid});
 await ordinary();const writer=await identity();assert.equal(writer.processId,process.pid);
 const source=await sourceIdentity(sourceRoot);assert.equal(source.status,'');
 const binding=adopted??await readAdoptedControl(path.join(fixedNativeAbandonment.state,'main-publisher-config.json'));
 assertAdopted??=()=>assertControlGeneration(binding);
 let original;
 const archiveBinding=async()=>{
  await assertAdopted();assert.equal(binding.state.version,'teruisi-main-control-installation-v3');assert.notEqual(binding.state.bundleSha256,fixedNativeAbandonment.bundleSha256);assert.equal(binding.state.configSha256,fixedNativeAbandonment.configSha256);
  const manifestRaw=await adminStableRead(path.join(binding.bundleRoot,'MANIFEST.json')),manifest=JSON.parse(manifestRaw);assert.equal(sha(manifestRaw),binding.state.bundleManifestSha256);assert.equal(manifest.sourceCommit,source.commit);assert.equal(manifest.sourceTree,source.tree);
  const objects=new Map(),put=raw=>{objects.set(sha(raw),raw);return sha(raw);};const operatorFiles={};
  for(const name of nativeOperatorNames){const bytes=await adminStableRead(path.join(sourceRoot,'tools',name));operatorFiles[name]=put(bytes);if(manifest.files['tools/'+name])assert.equal(operatorFiles[name],manifest.files['tools/'+name]);}
  assert.equal(operatorFiles['native-abandonment-observer.mjs'],fixedNativeAbandonment.observerSha256);
  const adoptionRaw=await adminStableRead(path.join(fixedNativeAbandonment.state,'CONTROL-INSTALLATION.json'));assert.equal(sha(adoptionRaw),binding.stateSha256);put(adoptionRaw);put(manifestRaw);const configRaw=await adminStableRead(path.join(fixedNativeAbandonment.state,'main-publisher-config.json'));assert.equal(sha(configRaw),binding.state.configSha256);put(configRaw);nativeValidateConfig(JSON.parse(original.object(fixedNativeAbandonment.configSha256)),JSON.parse(configRaw));
  for(const [file,expected] of [[path.join(fixedNativeAbandonment.state,'control-upgrades',binding.state.installId,'INTENT.json'),binding.state.intentSha256],[binding.state.transitionProofFile,binding.state.transitionProofSha256]]){const bytes=await adminStableRead(file);assert.equal(sha(bytes),expected);put(bytes);}
  for(const [file,expected] of [[path.join(fixedNativeAbandonment.state,'control/tools/publish-latest-main.mjs'),binding.state.dispatcherSha256],[binding.state.hook,binding.state.hookSha256]]){const bytes=await adminStableRead(file);assert.equal(sha(bytes),expected);put(bytes);}
  for(const [name,expected] of Object.entries(manifest.files)){const bytes=await adminStableRead(path.join(binding.bundleRoot,name));assert.equal(sha(bytes),expected);put(bytes);}
  return {objects,operatorFiles,adoptionSha256:sha(adoptionRaw)};
 };
 await assertSchemaArtifactDirectory(out,{allowMissing:true});await fs.mkdir(out,{recursive:false});await assertSchemaArtifactDirectory(out);
 const releaseQueue=await acquireQueueLock(nativeQueueRoot);assert.ok(releaseQueue,'Queue is busy; no resolution write');let releaseRotation;
 try{
  acquireRotation??=()=>new Promise((resolve,reject)=>{const server=createServer(socket=>socket.destroy());server.once('error',reject);server.listen('\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1',()=>resolve(()=>new Promise(done=>server.close(done))));});
  releaseRotation=await acquireRotation();const epoch={id:randomUUID(),startedAt:new Date().toISOString(),writerPid:writer.processId},deadlineUnixMs=Date.parse(epoch.startedAt)+20*60*1000;await assertAdopted();await assertNativeResolutionInventory(nativeQueueRoot);
  originalArchive??=JSON.parse(await fs.readFile(path.join(sourceRoot,'tests/fixtures/fixed-native-693e-evidence.json'),'utf8'));const originalRead=async file=>{const expected=nativeOriginalPins[file];assert.match(expected??'',hex);if(file.startsWith(nativeQueueRoot+path.sep)||file.startsWith(path.resolve(fixedNativeAbandonment.packet)+path.sep)||file.includes(fixedNativeAbandonment.candidate))return adminStableRead(file);return Buffer.from(originalArchive.objects[expected],'base64');};original=await nativeAbandonmentOriginals({read:originalRead});
  if(!oldInstallation)oldInstallation=Buffer.from(originalArchive.objects[fixedNativeAbandonment.oldInstallationSha256],'base64');assert.equal(sha(oldInstallation),fixedNativeAbandonment.oldInstallationSha256);assert.deepEqual(binding.state.preparationTask,JSON.parse(oldInstallation).preparationTask);
  const closed=await archiveBinding();closed.objects.set(fixedNativeAbandonment.oldInstallationSha256,oldInstallation);
  for(const [file,expected] of Object.entries(original.files)){const bytes=await originalRead(file);assert.equal(sha(bytes),expected);closed.objects.set(expected,bytes);}
  const observations=[],staticEvidence={initial:null,final:null},evidence=path.join(nativeQueueRoot,'resolutions',fixedNativeAbandonment.dispatchId+'-evidence');await fs.mkdir(path.dirname(evidence),{recursive:true});await fs.mkdir(evidence);await fs.mkdir(path.join(evidence,'objects'));
  const copied=new Set(),copy=async()=>{for(const [digest,bytes] of closed.objects){if(copied.has(digest))continue;const file=path.join(evidence,'objects',digest+'.bin'),handle=await fs.open(file,'wx');try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}copied.add(digest);}};
  const capture=async key=>{assert.ok(Date.now()<=deadlineUnixMs,'Finite same-lock epoch expired');const startedAt=new Date().toISOString(),proof=await collectState({objects:closed.objects,onStage:item=>console.log(JSON.stringify({status:'native-static-inventory',inventory:key,...item}))}),record={startedAt,completedAt:new Date().toISOString(),proof};staticEvidence[key]=record;if(key==='final')assert.deepEqual(staticEvidence.initial.proof,proof,'Initial and final complete inventories differ');const raw=Buffer.from(canonical(record));closed.objects.set(sha(raw),raw);await durableCreate(path.join(out,'STATIC-'+key+'.json'),record);await copy();assert.ok(Date.now()<=deadlineUnixMs,'Complete inventory exceeded the finite epoch');};
  const beforeObservation=async()=>{await assertAdopted();await assertNativeResolutionInventory(nativeQueueRoot);await nativeAbandonmentOriginals({read:originalRead});await ordinary();assert.deepEqual(await sourceIdentity(sourceRoot),source);};
  const shortCas=async()=>{for(const [file,expected] of [[path.join(fixedNativeAbandonment.state,'CONTROL-INSTALLATION.json'),binding.stateSha256],[path.join(fixedNativeAbandonment.state,'main-publisher-config.json'),fixedNativeAbandonment.configSha256],...['ticket','dispatch','result'].map((kind,index)=>[path.join(nativeQueueRoot,['tickets','dispatches','results'][index],(kind==='dispatch'?fixedNativeAbandonment.dispatchId:fixedNativeAbandonment.requestId)+'.json'),fixedNativeAbandonment[kind+'Sha256']])])assert.equal(sha(await adminStableRead(file)),expected,'Final no-spawn original/generation CAS changed');};
  const getObservation=async phase=>{
   // All token/Git/source and generation work that may spawn helpers finishes
   // before the high witness. Only file CAS and the one low CIM follow it.
   await beforeObservation();
   const request={version:'teruisi-native-abandonment-request-693e-v2',dispatchId:fixedNativeAbandonment.dispatchId,phase,nonce:randomUUID().replaceAll('-',''),at:new Date().toISOString(),writer,taskDefinitionSha256:sha(Buffer.from(canonical(binding.state.preparationTask.definition))),task:binding.state.preparationTask,operatorSource:sourceRoot,observerCodeSha256:fixedNativeAbandonment.observerSha256,sourceIdentity:source,operatorFiles:closed.operatorFiles,epoch,deadlineUnixMs,staticEvidence:structuredClone(staticEvidence),evidenceDirectory:evidence,adoptionSha256:closed.adoptionSha256};
   const requestFile=path.join(out,'REQUEST-'+phase+'.json');await assertSchemaArtifactDirectory(out);await durableCreate(requestFile,request);await assertSchemaArtifactDirectory(out);
   const response=observe?await observe(request,requestFile):await (async()=>{const file=path.join(out,'OBSERVATION-'+phase+'.json');console.log(JSON.stringify({status:'awaiting-independent-read-only-observer',requestFile,requestSha256:sha(Buffer.from(canonical(request))),responseFile:file}));for(;;){try{return (await readQueueObject(file)).value;}catch(error){if(error.code!=='ENOENT')throw error;if(Date.now()>=deadlineUnixMs)throw Error('Independent observation not supplied within the same-lock epoch');await new Promise(done=>setTimeout(done,250));}}})();
   nativeValidateObservation(response,request);assert.deepEqual(response.packet,staticEvidence.initial.proof,'Certified complete inventory changed');
   await shortCas();const censusStartedAt=new Date().toISOString(),fresh=await (freshCensus?freshCensus():task.taskPowerShell(schemaCensusScript)),censusCompletedAt=new Date().toISOString();
   const diagnostic={version:'teruisi-native-cross-token-diagnostic-693e-v1',requestSha256:sha(Buffer.from(canonical(request))),observationSha256:sha(Buffer.from(canonical(response))),epoch,phase,censusStartedAt,censusCompletedAt,...nativeCrossTokenDiagnostic(response.census,fresh.rows)};const crossSha256=await durableCreate(path.join(out,'CROSS-'+phase+'.json'),diagnostic);
   try{assertSchemaWitnessCensus(response.census,fresh.rows,{protectedActors:[writer,response.observer]});assertNativeActorWitness(response.census,fresh.rows);for(const row of fresh.rows){if([writer.processId,response.observer.processId].includes(row.processId)||!row.commandLine)continue;const text=decodeSchemaControlCommand(row.commandLine);assert.equal(nativeControlText(text)||nativeBuildCommand(row,text),false,'Native preparation actor appeared after witness');}}
   catch(error){await durableCreate(path.join(out,'CROSS-REJECTION-'+phase+'.json'),{requestSha256:diagnostic.requestSha256,crossSha256,at:new Date().toISOString(),reason:error.message,firstFailingProcess:error.message==='New opaque process after witness'?(diagnostic.newOpaque[0]??null):null});throw error;}
   const ack={requestSha256:sha(Buffer.from(canonical(request))),writerPid:writer.processId,censusStartedAt,censusCompletedAt,at:new Date().toISOString()};nativeValidateAck(ack,request,response);await durableCreate(path.join(out,'ACK-'+phase+'.json'),ack);
   const put=value=>{const raw=Buffer.from(canonical(value));closed.objects.set(sha(raw),raw);return sha(raw);};observations.push({requestSha256:put(request),observationSha256:put(response),ackSha256:put(ack)});return response;
  };
  await capture('initial');const first=await getObservation('initial-observation');await copy();await capture('final');const second=await getObservation('final-observation');assert.equal(first.sourceTree,second.sourceTree);assert.deepEqual(first.packet,second.packet);await copy();
  const value={version:fixedNativeAbandonment.version,decision:'abandoned-after-native-start',at:new Date().toISOString(),dispatchId:fixedNativeAbandonment.dispatchId,dispatchSha256:fixedNativeAbandonment.dispatchSha256,requestId:fixedNativeAbandonment.requestId,targetCommit:fixedNativeAbandonment.target,originalResultSha256:fixedNativeAbandonment.resultSha256,terminationBasis:'quiescent-no-publication',partialArtifactsRetained:true,nativePreparationStarted:true,prepared:false,publicationPerformed:false,retryOriginal:false,writerPid:writer.processId,sourceIdentity:source,operatorFiles:closed.operatorFiles,originals:original.files,adoptionSha256:closed.adoptionSha256,evidenceDirectory:evidence,observations,epoch,deadlineUnixMs,staticEvidence};
  assert.ok(Date.parse(value.at)-Date.parse(second.dynamicStartedAt)<60000&&Date.parse(value.at)<=deadlineUnixMs,'Final independent dynamic sampling expired before append');const lastAck=JSON.parse(closed.objects.get(observations[1].ackSha256));assert.ok(Date.parse(value.at)-Date.parse(lastAck.censusStartedAt)<60000,'Final ordinary sampling expired before append');
  await durableCreate(path.join(nativeQueueRoot,'resolutions',fixedNativeAbandonment.dispatchId+'.json'),value);await nativeReadResolution();return {status:'abandoned-after-native-start',prepared:false,publicationPerformed:false,replayOriginal:false};
 }finally{try{await releaseRotation?.();}finally{await releaseQueue();}}
}
// FIXED_NATIVE_693E_END

// FIXED_CLEANED_4AAC_BEGIN: one fully cleaned, pre-plan failure; no original replay.
export const fixedCleanedPreparation=Object.freeze({"version":"teruisi-failed-cleaned-preparation-4aac-v1","state":"D:/codex-isolated/main-manual-release-20261016","packet":"D:/codex-isolated/main-release-packages/477a94bf29f2-fee81c63-4ca6db6e","target":"477a94bf29f256561787284f5e095a4a7a11c662","tree":"15d8dbdc57f2d3a1b107f44622967d2538b28000","base":"b2ef81c7c6eecdb59894e55021b835b6a8baf0b4","dispatchId":"4aac89ca-952b-4779-b0fa-3e6764dab39d","requestId":"a9b49c5b-0222-4c72-b903-6030dcfde4b4","bundleSha256":"d93d2b0df4fba59ed3b27b0e93d0f85abe851efd9f4c222fbf3e9d0ddd91c7d3","configSha256":"9879162ff8955bc616f457ad66a3817a53a92e2e8358c6c40dd87846d7188c58","ticketSha256":"7046e5bd75a0cafb9a0dad58d8713dac9920f5eb0aac0e56723f39840e5c4ccf","dispatchSha256":"b0a45571e21f8c8691b696c6b6b8fa6c92777033172f247b9f7964ffaae70746","resultSha256":"caae97addd840024cebdeb3cf72bd611e4158ef469a0d072f2c96161b8175a42","manifestSha256":"47fc7bca42d81b857b29a219ac88b7a6bcaf1cff00df6409098f983a523a8dc1","oldInstallationSha256":"cac3e30749a9f4acecda1ca80c774261d53b3c4100fef00510eb1523a8ae778e","failedSha256":"df2663ba8aac17b297d7493a47947ed42eef8db539ef49f7630f1ad4aa5b0ad6","sourceBindingSha256":"16de29a14fe84825f9c6fe60cdb09d9547c6d006bf7c060194d724d5d46bd404","sourceRootSha256":"48314b27fda20646a8dd1953f40351c4545d41a4709b1d9085c4496148b57e4b","sourceFingerprint":"ae0f4d9e37380c2926f9d076a93b6ab496c2f66f34a00bd7acaad91e8bc15fde","observerSha256":"3f15fb6a1486add96b21563516f4ded969a5a67c784d92ffaa6c82e9bcc39277","requestSha256":"2f71e6c008133acebbdbbfcf69729b66badee0bb73bdbc56b43c7b9a845c944e"});
const cleanedQueueRoot=path.join(fixedCleanedPreparation.state,'prebuild-queue-v2');
const cleanedControlNames=[...schemaControlNames,'tools/frozen-main-source.mjs'].sort();
const cleanedOperatorNames=["main-prebuild-queue.mjs", "main-prebuild-task.mjs", "main-control-dispatch.mjs", "main-schema-release.mjs", "release-scope-plan.mjs", "frozen-main-source.mjs", "worker-local-release.mjs", "worker-local-release-rotation.mjs", "d1-retirement-proof.mjs", "cleaned-preparation-writer.mjs", "cleaned-preparation-observer.mjs"];
function cleanedValidateConfig(old,next){assert.deepEqual(next,old,"The fixed abandonment does not change publisher configuration");}
// All original consumed inputs are fixed, including the old adopted generation.
const cleanedOriginalPins=Object.freeze({"D:\\codex-isolated\\main-manual-release-20261016\\prebuild-queue-v2\\tickets\\a9b49c5b-0222-4c72-b903-6030dcfde4b4.json":"7046e5bd75a0cafb9a0dad58d8713dac9920f5eb0aac0e56723f39840e5c4ccf","D:\\codex-isolated\\main-manual-release-20261016\\prebuild-queue-v2\\dispatches\\4aac89ca-952b-4779-b0fa-3e6764dab39d.json":"b0a45571e21f8c8691b696c6b6b8fa6c92777033172f247b9f7964ffaae70746","D:\\codex-isolated\\main-manual-release-20261016\\prebuild-queue-v2\\results\\a9b49c5b-0222-4c72-b903-6030dcfde4b4.json":"caae97addd840024cebdeb3cf72bd611e4158ef469a0d072f2c96161b8175a42","D:\\codex-isolated\\main-manual-release-20261016\\main-publisher-config.json":"9879162ff8955bc616f457ad66a3817a53a92e2e8358c6c40dd87846d7188c58","D:\\codex-isolated\\main-manual-release-20261016\\CONTROL-INSTALLATION.json":"cac3e30749a9f4acecda1ca80c774261d53b3c4100fef00510eb1523a8ae778e","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\d93d2b0df4fba59ed3b27b0e93d0f85abe851efd9f4c222fbf3e9d0ddd91c7d3\\MANIFEST.json":"47fc7bca42d81b857b29a219ac88b7a6bcaf1cff00df6409098f983a523a8dc1","D:\\codex-isolated\\main-release-packages\\477a94bf29f2-fee81c63-4ca6db6e\\main-release-request.json":"725f5b80c2fa5bacc3dff6f3ff056d271dfc41c443b446048858b619b61f5f27","D:\\codex-isolated\\main-release-packages\\477a94bf29f2-fee81c63-4ca6db6e\\publish-477a94bf29f2\\preparation\\PREPARING.json":"107bb36589dc7cd8edc784165dcc229abefa43f72b3444a6decdb83bd41b93c4","D:\\codex-isolated\\main-release-packages\\477a94bf29f2-fee81c63-4ca6db6e\\publish-477a94bf29f2\\preparation\\source-binding.json":"16de29a14fe84825f9c6fe60cdb09d9547c6d006bf7c060194d724d5d46bd404","D:\\codex-isolated\\main-release-packages\\477a94bf29f2-fee81c63-4ca6db6e\\publish-477a94bf29f2\\preparation\\FAILED-bce207e6-f209-4858-91a5-d4d580e53984.json":"df2663ba8aac17b297d7493a47947ed42eef8db539ef49f7630f1ad4aa5b0ad6","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\d93d2b0df4fba59ed3b27b0e93d0f85abe851efd9f4c222fbf3e9d0ddd91c7d3\\tools\\frozen-main-source.mjs":"b4bb57dff7a659a94520bc592e0f42b026d5b2a4def4dacfb928e8635f21f9c6","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\d93d2b0df4fba59ed3b27b0e93d0f85abe851efd9f4c222fbf3e9d0ddd91c7d3\\tools\\main-control-dispatch.mjs":"68334ca9733c6f3652245534ed41d0bdae2ab5e70588729d17fc8edb81731fbc","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\d93d2b0df4fba59ed3b27b0e93d0f85abe851efd9f4c222fbf3e9d0ddd91c7d3\\tools\\main-prebuild-hook.mjs":"c36f206c97c6fc1ed44604d72c5828bd080951e5fc0176164ce5d1072198ba77","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\d93d2b0df4fba59ed3b27b0e93d0f85abe851efd9f4c222fbf3e9d0ddd91c7d3\\tools\\main-prebuild-queue.mjs":"1a5e3fccb634c0739dcb5231054a6c169ec1a6b00a813d1c38978f0e2d6dff31","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\d93d2b0df4fba59ed3b27b0e93d0f85abe851efd9f4c222fbf3e9d0ddd91c7d3\\tools\\main-prebuild-status.mjs":"9010056cc8b1ead2cfd4ba17ad5e427f0a0849f6b77ab708b8c3443795e12dc3","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\d93d2b0df4fba59ed3b27b0e93d0f85abe851efd9f4c222fbf3e9d0ddd91c7d3\\tools\\main-prebuild-task.mjs":"9f05dedcb953fec984d9c6ee3938a6254f7d5875bbe43018ff88869264c7cb62","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\d93d2b0df4fba59ed3b27b0e93d0f85abe851efd9f4c222fbf3e9d0ddd91c7d3\\tools\\main-schema-release.mjs":"3f2e58b8628a5adbb16cdc5ba36f6de575e3c6a49dca2d8dbd01bff8111bdac0","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\d93d2b0df4fba59ed3b27b0e93d0f85abe851efd9f4c222fbf3e9d0ddd91c7d3\\tools\\publish-latest-main.mjs":"a5b567fb46981c9a8dc2d8ee2a23f41891ee8adb8c78ea13f7c07d27fbd8e345","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\d93d2b0df4fba59ed3b27b0e93d0f85abe851efd9f4c222fbf3e9d0ddd91c7d3\\tools\\publish-main-progress.mjs":"812d82d352fce8ce43a3b42aabcb2fa53cbcfa9c98b7524a33d0de3b521af714","D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\d93d2b0df4fba59ed3b27b0e93d0f85abe851efd9f4c222fbf3e9d0ddd91c7d3\\tools\\release-scope-plan.mjs":"e32e1e37ae99975b21816a021c266c360bb46c02254586796b09e2a6e3a281b2","D:\\codex-isolated\\main-release-packages\\477a94bf29f2-fee81c63-4ca6db6e\\source\\tools\\publish-prepared-main.mjs":"bc746e2e45d495714bc6b2b2808755bb1f9edb448cdb47ff14abfa688343bde3","D:\\codex-isolated\\main-release-packages\\477a94bf29f2-fee81c63-4ca6db6e\\source\\tools\\worker-local-release.mjs":"dad4e7a1625c4d174541c81669b8c65c0e76bef43e723a87d014947cce362103","D:\\codex-isolated\\main-release-packages\\477a94bf29f2-fee81c63-4ca6db6e\\source\\tools\\worker-local-release-rotation.mjs":"8b3ec38f47c247c6b0d69c62ab0efb105f63cada945ec40cf7debe76f5ff35d7","D:\\codex-isolated\\main-release-packages\\477a94bf29f2-fee81c63-4ca6db6e\\source\\tools\\publish-latest-main.mjs":"a5b567fb46981c9a8dc2d8ee2a23f41891ee8adb8c78ea13f7c07d27fbd8e345"});
const cleanedSuccessorPins=Object.freeze({"D:\\codex-artifacts\\disk-weekend-cleanup-20261019\\composition-request.json":"69b9a44ea6567de56a7d1581d9c520f0ffaae3dbfe2e3998f267f09ca66ad8f8","D:\\codex-artifacts\\disk-weekend-cleanup-20261019\\composition-publication\\SUCCESS.json":"d7f5294a0339cbfaee1ef82aec0c1e722c27844c3915726d60243c5c1fb5434d","D:\\codex-isolated\\backup-pi-tools-release-20261019\\publish-3918480da94f\\SUCCESS.json":"d7f5294a0339cbfaee1ef82aec0c1e722c27844c3915726d60243c5c1fb5434d","D:\\teruisi-runtime\\teruisi-worker-sales\\state\\worker-release-successors\\fee81c63b551c652486266cf5ff25266b37e6810d5840aef5e06f85693415c73.json":"afe0225f2be4ae0f5033bbb840a3ae227ba2b11a12fbe9d4a0305fffda52465b","D:\\teruisi-runtime\\teruisi-worker-sales\\state\\worker-release-rotation-plans\\bfa3c7e6317719f942397db0c24434aac78d14971b579382409a3af0d1c15883.json":"bfa3c7e6317719f942397db0c24434aac78d14971b579382409a3af0d1c15883"});
export const fixedCleanedSuccessor=Object.freeze({"head":{"bindingSha256":"fdf509893d76fb416c3daa9ff9c2f2a0b13799fb4a49817a135c78694e7e7743","guardReceiptSha256":"51f236ef3fa65ed61d79b212ec65277e52f12a0d84488684b6dc6ce743b1d907","manifestSha256":"0e37f1740f26d7e257755fc8bed2596990edcd0ad86d20c3655c637bf1878e6a","releaseId":"20261019T104309Z-f28b90a85276e948","version":"teruisi-local-worker-release-binding-v1"},"chainStateSha256":"50bf332117fc76bd2f52d374adabe3d9516cb9a53a0f453213b59329655be1bf","djangoManifestSha256":"54a48ee1e6caac72cd13fd1f1f6fd077b4aad30326cf97e20ae249e405f3bcca","commit":"3918480da94fc1cbdf72aa17d65406057bc7143a","tree":"995dcc232f8ec54f85e06758af363e53ca2a2f3c","requestSha256":"69b9a44ea6567de56a7d1581d9c520f0ffaae3dbfe2e3998f267f09ca66ad8f8","successSha256":"d7f5294a0339cbfaee1ef82aec0c1e722c27844c3915726d60243c5c1fb5434d","successorSha256":"afe0225f2be4ae0f5033bbb840a3ae227ba2b11a12fbe9d4a0305fffda52465b","planSha256":"bfa3c7e6317719f942397db0c24434aac78d14971b579382409a3af0d1c15883"});
const cleanedActors=Object.freeze([{pid:12952,exitedBefore:'2026-10-19T11:47:15.866Z'},{pid:55772,exitedBefore:'2026-10-19T11:47:04.982Z'}]);
export async function cleanedPreparationOriginals({read=adminStableRead}={}){
 const raw=new Map(),files={};for(const [file,expected]of Object.entries({...cleanedOriginalPins,...cleanedSuccessorPins})){const bytes=await read(file);assert.equal(sha(bytes),expected,'Original 4aac evidence changed');raw.set(file,bytes);files[file]=expected;}const object=digest=>{for(const [file,hash]of Object.entries(files))if(hash===digest)return raw.get(file);throw Error('Missing original object');};
 const ticket=JSON.parse(object(fixedCleanedPreparation.ticketSha256)),dispatch=JSON.parse(object(fixedCleanedPreparation.dispatchSha256)),terminal=JSON.parse(object(fixedCleanedPreparation.resultSha256));validateTicket(ticket,fixedCleanedPreparation.requestId+'.json');validateDispatch(dispatch,fixedCleanedPreparation.dispatchId+'.json');assert.equal(dispatch.selectedTarget,fixedCleanedPreparation.target);assert.equal(path.resolve(dispatch.selection.packet),path.resolve(fixedCleanedPreparation.packet));assert.equal(dispatch.bundleSha256,fixedCleanedPreparation.bundleSha256);assert.equal(dispatch.configSha256,fixedCleanedPreparation.configSha256);assert.deepEqual(dispatch.tickets,[{observedTarget:null,requestId:fixedCleanedPreparation.requestId,ticketSha256:fixedCleanedPreparation.ticketSha256}]);assert.equal(terminal.status,'unknown');assert.equal(terminal.dispatchSha256,fixedCleanedPreparation.dispatchSha256);assert.equal(terminal.error,'本次目标发布未完成，退出码：1');
 const manifest=JSON.parse(object(fixedCleanedPreparation.manifestSha256));assert.equal(manifest.bundleSha256,fixedCleanedPreparation.bundleSha256);assert.equal(sha(Buffer.from(canonical(manifest.files))),manifest.bundleSha256);assert.deepEqual(Object.keys(manifest.files).sort(),cleanedControlNames);for(const[name,digest]of Object.entries(manifest.files))assert.equal(files[path.join(fixedCleanedPreparation.state,'control-bundles',manifest.bundleSha256,name)],digest);
 const failed=JSON.parse(object(fixedCleanedPreparation.failedSha256)),e=failed.processEvidence;assert.equal(failed.mainCommit,fixedCleanedPreparation.target);assert.equal(failed.phase,'构建前端');assert.equal(failed.error,'predecessor immutable release 自校验失败：超过 600000ms 时限');assert.equal(failed.maintenanceStarted,false);assert.equal(failed.automaticRetry,false);assert.equal(e.version,1);assert.equal(e.signal,null);assert.equal(e.timeoutType,'direct-exit');assert.equal(e.outputProtocol,'eof');assert.equal(e.nativeCode,null);assert.equal(e.code,'process_timeout');assert.equal(e.stage,'direct-exit');assert.equal(e.processId,55772);assert.equal(e.exitCode,1);assert.equal(e.cleanup,'tree');assert.equal(e.treeCleanupExitCode,0);assert.equal(e.treeCleanupPending,false);assert.equal(e.deadlineUnixMs,dispatch.deadlineUnixMs);assert.equal(e.elapsedMs,212130);assert.equal(e.stdoutBytes,0);assert.equal(e.stderrBytes,0);
 const request=JSON.parse(raw.get(path.join(fixedCleanedPreparation.packet,'main-release-request.json'))),preparing=JSON.parse(raw.get(path.join(fixedCleanedPreparation.packet,'publish-477a94bf29f2/preparation/PREPARING.json'))),binding=JSON.parse(object(fixedCleanedPreparation.sourceBindingSha256));assert.equal(request.mainCommit,fixedCleanedPreparation.target);assert.equal(request.migrate,false);assert.deepEqual(request.predecessorWorker,dispatch.selection.live.head);assert.equal(request.predecessorDjangoSha256,dispatch.selection.live.djangoManifestSha256);assert.equal(preparing.requestSha256,sha(Buffer.from(JSON.stringify(request))));assert.equal(binding.sourceRootPathSha256,fixedCleanedPreparation.sourceRootSha256);assert.equal(binding.identity.sourceTree.sha256,fixedCleanedPreparation.sourceFingerprint);assert.deepEqual(binding.predecessor,dispatch.selection.live.head);assert.equal(binding.predecessorChainStateSha256,dispatch.selection.live.chainStateSha256);
 const worker=raw.get(path.join(fixedCleanedPreparation.packet,'source/tools/worker-local-release.mjs')).toString(),rotation=raw.get(path.join(fixedCleanedPreparation.packet,'source/tools/worker-local-release-rotation.mjs')).toString(),publisher=raw.get(path.join(fixedCleanedPreparation.packet,'source/tools/publish-prepared-main.mjs')).toString();assert.ok(worker.includes('await rm(releaseRoot, { recursive: true, force: true }).catch(() => {});')&&worker.includes('await rm(stageRoot, { recursive: true, force: true }).catch(() => {});'));assert.ok(rotation.indexOf('built = await buildWorkerReleaseCandidate(')<rotation.indexOf('const publication = await publishRotationPlan('));assert.ok(publisher.indexOf('plan=await rotation.planWorkerReleaseRotation(')<publisher.indexOf("pkg=await step('准备后台'"));
 const foreign=JSON.parse(object(fixedCleanedSuccessor.requestSha256)),success=JSON.parse(object(fixedCleanedSuccessor.successSha256)),last=JSON.parse(object(fixedCleanedSuccessor.successorSha256)),plan=JSON.parse(object(fixedCleanedSuccessor.planSha256));assert.deepEqual(foreign.predecessorWorker,request.predecessorWorker);assert.equal(foreign.predecessorDjangoSha256,request.predecessorDjangoSha256);assert.equal(foreign.mainCommit,fixedCleanedSuccessor.commit);assert.equal(foreign.sourceTree,fixedCleanedSuccessor.tree);assert.equal(foreign.migrate,false);assert.equal(success.status,'deployed_and_ready');assert.equal(success.mainCommit,foreign.mainCommit);assert.equal(success.sourceTree,foreign.sourceTree);assert.equal(success.workerRelease,fixedCleanedSuccessor.head.releaseId);assert.equal(success.workerManifestSha256,fixedCleanedSuccessor.head.manifestSha256);assert.equal(success.djangoManifestSha256,fixedCleanedSuccessor.djangoManifestSha256);assert.equal(success.maintenanceId,'9af8b159fe22437586d59653812375c7');assert.equal(success.migration,null);assert.equal(last.version,'teruisi-local-worker-release-successor-v1');assert.equal(last.sequence,253);assert.deepEqual(last.predecessor,request.predecessorWorker);assert.deepEqual(last.successor,fixedCleanedSuccessor.head);assert.equal(last.approvedPlanSha256,fixedCleanedSuccessor.planSha256);assert.equal(plan.predecessorSequence,252);assert.deepEqual(plan.predecessor,last.predecessor);assert.deepEqual(plan.candidate,last.successor);assert.equal(plan.predecessorChainStateSha256,binding.predecessorChainStateSha256);assert.equal(JSON.parse(plan.sourceBinding.raw).sourceRoot,success.source);assert.deepEqual(plan.lineage,last.lineage);return {files,raw,dispatch,terminal,object};
}
const cleanedWorkerRoot='D:/teruisi-runtime/teruisi-worker-sales',cleanedDjangoRoot='D:/teruisi-runtime/django-sales';
const cleanedStateDomains=['worker-prepared-builds','worker-release-publication-staging','worker-release-rotation-consumptions','worker-release-rotation-plans','worker-release-successors'];
const cleanedNormalize=text=>text.replaceAll('\\','/').replace(/\/{2,}/g,'/').toLowerCase();
const cleanedNeedles=()=>[fixedCleanedPreparation.target,fixedCleanedPreparation.dispatchId,fixedCleanedPreparation.requestId,fixedCleanedPreparation.requestSha256,fixedCleanedPreparation.sourceBindingSha256,fixedCleanedPreparation.sourceRootSha256,fixedCleanedPreparation.sourceFingerprint,fixedCleanedPreparation.packet].map(cleanedNormalize);
export function assertCleanedNoPublicationBytes(raw){const text=cleanedNormalize(raw.toString('utf8'));for(const needle of cleanedNeedles())assert.equal(text.includes(needle),false,'Original 4aac preparation artifact remains');}
export function assertCleanedPreparationProof(value){assert.deepEqual(Object.keys(value).sort(),['version','metadataInventorySha256','head','chainStateSha256','djangoManifestSha256','candidateArtifactsAbsent'].sort());assert.equal(value.version,'teruisi-cleaned-metadata-state-4aac-v1');assert.equal(value.candidateArtifactsAbsent,true);assert.match(value.metadataInventorySha256,hex);assert.deepEqual(value.head,fixedCleanedSuccessor.head);assert.equal(value.chainStateSha256,fixedCleanedSuccessor.chainStateSha256);assert.equal(value.djangoManifestSha256,fixedCleanedSuccessor.djangoManifestSha256);return true;}
export async function collectCleanedPreparationState({objects=new Map(),onStage=async()=>{}}={}){
 const entries=[],put=raw=>{objects.set(sha(raw),raw);return sha(raw);};const add=async file=>{const raw=await nativeRead(file);if(file.endsWith('.json'))JSON.parse(raw.toString('utf8'));else{assert.match(raw.toString('ascii'),/^[a-f0-9]{64}\r?\n$/);assert.equal(raw.toString('ascii').trim(),sha(await nativeRead(file.slice(0,-7))));}assertCleanedNoPublicationBytes(raw);entries.push({path:file,size:raw.length,sha256:put(raw)});};
 const releases=path.join(cleanedWorkerRoot,'releases');await nativeDirectory(releases);const names=(await fs.readdir(releases)).sort();for(const name of names){assert.match(name,/^\d{8}T\d{6}Z-[a-f0-9]{16}$/);await nativeDirectory(path.join(releases,name));await add(path.join(releases,name,'deployment-manifest.json'));}assert.deepEqual((await fs.readdir(releases)).sort(),names);
 for(const domain of cleanedStateDomains)await nativeWalk(path.join(cleanedWorkerRoot,'state',domain),async file=>{assert.match(file,/\.json(?:\.sha256)?$/);await add(file);});
 await add(path.join(cleanedWorkerRoot,'current-deployment.json'));await add(path.join(cleanedDjangoRoot,'app/deployment.json'));const djangoNames=(await fs.readdir(cleanedDjangoRoot)).sort();for(const name of djangoNames){if(/^app\.prepare-[a-f0-9]{32}\.json$/.test(name))await add(path.join(cleanedDjangoRoot,name));else if(/^app\.deploy-[a-f0-9]{32}$/.test(name)){await nativeDirectory(path.join(cleanedDjangoRoot,name));await add(path.join(cleanedDjangoRoot,name,'deployment.json'));}else if(name.startsWith('app.prepare-')||name.startsWith('app.deploy-'))throw Error('Unknown Django preparation artifact');}assert.deepEqual((await fs.readdir(cleanedDjangoRoot)).sort(),djangoNames);
 const preparing=path.join(fixedCleanedPreparation.packet,'publish-477a94bf29f2/preparation');assert.deepEqual((await fs.readdir(preparing)).sort(),['FAILED-bce207e6-f209-4858-91a5-d4d580e53984.json','PREPARING.json','source-binding.json'].sort());assert.deepEqual(await fs.readdir(path.join(fixedCleanedPreparation.packet,'invocations')),[]);const publish=path.dirname(preparing);assert.deepEqual(await fs.readdir(publish),['preparation']);
 const staging=path.join(cleanedWorkerRoot,'.staging'),allowed=['deploy-2bad88cd-83fb-4530-a445-fb5e2644bf16','deploy-aaddbf82-2a23-4202-9485-eb4b7682741a'];await nativeDirectory(staging);assert.deepEqual((await fs.readdir(staging)).sort(),allowed.sort(),'Unknown staging could retain original candidate');const stagingMetadata=[];for(const name of allowed){const directory=path.join(staging,name);await nativeDirectory(directory);const stat=await fs.lstat(directory);assert.ok(stat.birthtimeMs>0&&stat.birthtimeMs<Date.parse('2026-10-19T11:16:37.662Z'),'Staging identity was not preexisting');stagingMetadata.push({path:directory,dev:stat.dev,ino:stat.ino,birthtimeMs:stat.birthtimeMs,children:(await fs.readdir(directory)).sort()});}
 const {resolveEffectiveReleaseChain}=await import('./worker-local-release-rotation.mjs'),chain=await resolveEffectiveReleaseChain({verifyInstalledHead:true});const inventory={domains:cleanedStateDomains,entries:entries.sort((a,b)=>a.path.localeCompare(b.path)),stagingMetadata};const raw=Buffer.from(canonical(inventory)),value={version:'teruisi-cleaned-metadata-state-4aac-v1',metadataInventorySha256:put(raw),head:chain.head,chainStateSha256:chain.chainStateSha256,djangoManifestSha256:sha(await nativeRead(path.join(cleanedDjangoRoot,'app/deployment.json'))),candidateArtifactsAbsent:true};assertCleanedPreparationProof(value);await onStage({phase:'complete-metadata-only',fileCount:entries.length,oldStagingPayloadRead:false});return value;
}
async function verifyCleanedPreparationArchive(proof,object){assertCleanedPreparationProof(proof);const inventory=JSON.parse(await object(proof.metadataInventorySha256));assert.deepEqual(Object.keys(inventory).sort(),['domains','entries','stagingMetadata']);assert.deepEqual(inventory.domains,cleanedStateDomains);assert.ok(inventory.entries.length>0);const seen=new Set();for(const item of inventory.entries){assert.ok(path.isAbsolute(item.path)&&!seen.has(item.path));seen.add(item.path);assert.ok(item.path.startsWith(path.resolve(cleanedWorkerRoot)+path.sep)||item.path.startsWith(path.resolve(cleanedDjangoRoot)+path.sep));const raw=await object(item.sha256);assert.equal(raw.length,item.size);assertCleanedNoPublicationBytes(raw);}assert.deepEqual(inventory.stagingMetadata.map(item=>path.basename(item.path)).sort(),['deploy-2bad88cd-83fb-4530-a445-fb5e2644bf16','deploy-aaddbf82-2a23-4202-9485-eb4b7682741a'].sort());}
export async function verifyCleanedObservationInputs(request){cleanedValidateEpoch(request.epoch,request.deadlineUnixMs,request.writer.processId);cleanedValidateStatic(request.staticEvidence,request.epoch,request.deadlineUnixMs,{final:request.phase==='final-observation'});assert.ok(Date.now()<=request.deadlineUnixMs);assert.equal(path.resolve(request.evidenceDirectory),path.resolve(cleanedQueueRoot,'resolutions',fixedCleanedPreparation.dispatchId+'-evidence'));const archive=JSON.parse(await fs.readFile(path.join(request.operatorSource,'tests/fixtures/fixed-cleaned-4aac-evidence.json'),'utf8'));await cleanedPreparationOriginals({read:async file=>file.startsWith(cleanedQueueRoot+path.sep)||file.startsWith(path.resolve(fixedCleanedPreparation.packet)+path.sep)||Object.hasOwn(cleanedSuccessorPins,file)?adminStableRead(file):Buffer.from(archive.objects[cleanedOriginalPins[file]],'base64')});const {readAdoptedControl}=await import('./main-control-dispatch.mjs');const binding=await readAdoptedControl(path.join(fixedCleanedPreparation.state,'main-publisher-config.json'));assert.equal(binding.stateSha256,request.adoptionSha256);assert.deepEqual(binding.state.preparationTask,request.task);const manifest=JSON.parse(await nativeRead(path.join(binding.bundleRoot,'MANIFEST.json')));assert.equal(manifest.sourceCommit,request.sourceIdentity.commit);assert.equal(manifest.sourceTree,request.sourceIdentity.tree);const object=async digest=>{assert.match(digest,hex);const raw=await nativeRead(path.join(request.evidenceDirectory,'objects',digest+'.bin'));assert.equal(sha(raw),digest);return raw;};for(const record of [request.staticEvidence.initial,request.staticEvidence.final].filter(Boolean)){const raw=Buffer.from(canonical(record));assert.deepEqual(await object(sha(raw)),raw);}await verifyCleanedPreparationArchive(request.staticEvidence.initial.proof,object);const {resolveEffectiveReleaseChain}=await import('./worker-local-release-rotation.mjs'),chain=await resolveEffectiveReleaseChain({verifyInstalledHead:true});assert.deepEqual(chain.head,request.staticEvidence.initial.proof.head);assert.equal(chain.chainStateSha256,request.staticEvidence.initial.proof.chainStateSha256);assert.equal(sha(await nativeRead(path.join(cleanedDjangoRoot,'app/deployment.json'))),request.staticEvidence.initial.proof.djangoManifestSha256);return request.staticEvidence.initial.proof;}
function assertCleanedAncestry(rows){const byPid=new Map(rows.map(row=>[row.processId,row]));assert.equal(byPid.size,rows.length);for(const actor of cleanedActors)for(const row of rows){let current=row;const seen=new Set();while(current&&current.processId!==0){assert.ok(!seen.has(current.processId));seen.add(current.processId);assert.ok(Number.isSafeInteger(current.parentProcessId));if(current.parentProcessId===actor.pid){const parent=byPid.get(actor.pid);assert.ok(current.creationDate&&Date.parse(current.creationDate)<Date.parse('2026-10-19T11:16:37.662Z')||parent?.creationDate&&Date.parse(parent.creationDate)>Date.parse(actor.exitedBefore)&&Date.parse(current.creationDate)>=Date.parse(parent.creationDate),'Original 4aac descendant remains or identity is unknown');break;}const parent=byPid.get(current.parentProcessId);if(!parent)break;assert.ok(current.creationDate&&parent.creationDate);if(Date.parse(parent.creationDate)>Date.parse(current.creationDate))break;current=parent;}}return byPid;}
export function assertCleanedActorsAbsent(rows){const byPid=assertCleanedAncestry(rows);return cleanedActors.map(actor=>{const row=byPid.get(actor.pid);if(!row)return {pid:actor.pid,originalExitedBefore:actor.exitedBefore,state:'absent'};assert.ok(row.creationDate&&Date.parse(row.creationDate)>Date.parse(actor.exitedBefore)&&row.commandLine&&row.executablePath,'Original 4aac actor remains or reused PID is opaque');assert.equal(cleanedControlText(decodeSchemaControlCommand(row.commandLine)),false);return {pid:actor.pid,originalExitedBefore:actor.exitedBefore,state:'reused-unrelated-pid',currentBirth:row.creationDate,currentName:row.name};});}
function cleanedControlText(text){return schemaControlPath(text)||cleanedNormalize(text).includes(cleanedNormalize(fixedCleanedPreparation.packet));}
function cleanedBuildCommand(row,text){return schemaControlName(row.name)&&Date.parse(row.creationDate)>=Date.parse('2026-10-19T11:16:37.662Z')&&/(?:npm-cli\.js|npx-cli\.js|[ /"']vinext(?:[ /"'.]|$)|vite\/bin\/vite|(?:^|\s)(?:run\s+)?build(?:\s|$)|process-deadline\.mjs)/.test(text);}
export function classifyCleanedControllers(rows,{writer,observer}){const related=new Set(classifySchemaControllers(rows,{writer,observer}));for(const row of rows){if([writer.processId,observer.processId].includes(row.processId)||!row.commandLine)continue;const text=decodeSchemaControlCommand(row.commandLine);if(cleanedControlText(text)||schemaControlName(row.name)&&Date.parse(row.creationDate)>=Date.parse('2026-10-19T11:16:37.662Z')&&/(?:npm-cli\.js|npx-cli\.js|[ /"']vinext(?:[ /"'.]|$)|vite\/bin\/vite|(?:^|\s)(?:run\s+)?build(?:\s|$)|process-deadline\.mjs)/.test(text))related.add(row.processId);}for(let changed=true;changed;){changed=false;for(const row of rows)if(related.has(row.parentProcessId)&&!related.has(row.processId)){related.add(row.processId);changed=true;}}assertCleanedActorsAbsent(rows);return [...related].sort((a,b)=>a-b);}
export async function assertCleanedResolutionInventory(directory,{allowOriginal=true}={}){
 assert.equal(path.resolve(directory).toLowerCase(),path.resolve(cleanedQueueRoot).toLowerCase());
 const tickets=await allTickets(directory);
 for(const item of tickets){const terminal=await ticketResult(directory,item.value.requestId,item.sha256);assert.ok(terminal,'Pending ticket remains');}
 for(const name of await entries(directory,'dispatches')){
  const read=await readQueueObject(path.join(directory,'dispatches',name));validateDispatch(read.value,name);
  for(const ref of read.value.tickets){const terminal=await ticketResult(directory,ref.requestId,ref.ticketSha256);assert.ok(terminal);
   if(['unknown','failed','blocked'].includes(terminal.status)){
    if(await readFixedAdminRejectionResolution(directory,read.value,terminal))continue;
    if(await readFixedSchemaRejectionResolution(directory,read.value,terminal))continue;
    if(await readFixedNativeAbandonmentResolution(directory,read.value,terminal))continue;
    if(await readFixedCacheRejectionResolution(directory,read.value,terminal))continue;
    if(allowOriginal&&read.value.dispatchId===fixedCleanedPreparation.dispatchId&&read.sha256===fixedCleanedPreparation.dispatchSha256&&terminal.requestId===fixedCleanedPreparation.requestId&&terminal.status==='unknown')continue;
    if(await readFixedCleanedPreparationResolution(directory,read.value,terminal))continue;
    throw Error('Another unresolved dispatch remains');
   }
  }
 }
}
function cleanedActorsFromProjection(rows){assertCleanedAncestry(rows);return cleanedActors.map(actor=>{const row=rows.find(row=>row.processId===actor.pid);if(!row)return {pid:actor.pid,originalExitedBefore:actor.exitedBefore,state:'absent'};assert.ok(row.creationDate&&Date.parse(row.creationDate)>Date.parse(actor.exitedBefore));assert.match(row.commandLineSha256??'',hex);assert.match(row.executablePathSha256??'',hex);return {pid:actor.pid,originalExitedBefore:actor.exitedBefore,state:'reused-unrelated-pid',currentBirth:row.creationDate,currentName:row.name};});}
export function cleanedCrossTokenDiagnostic(witness,current){
 const low=schemaCensusProjection(current),known=new Map(witness.filter(row=>row.controlCandidate).map(row=>[row.processId,row]));
 const newOpaque=current.filter(row=>schemaControlName(row.name)&&(!row.commandLine||!row.executablePath||!row.creationDate)&&!known.has(row.processId)).map(row=>({processId:row.processId,parentProcessId:row.parentProcessId,name:row.name,creationDate:row.creationDate,reason:'New opaque process after witness'}));
 return {high:witness,low,newOpaque};
}
export function assertCleanedActorWitness(witness,rows){
 assertCleanedAncestry(rows);const projected=schemaCensusProjection(rows);for(const actor of cleanedActors){const current=projected.find(row=>row.processId===actor.pid);if(!current)continue;assert.ok(current.creationDate&&Date.parse(current.creationDate)>Date.parse(actor.exitedBefore),'Original cleaned actor remains or birth is unavailable');const known=witness.find(row=>row.processId===actor.pid);assert.ok(known,'Reused original PID appeared after witness');for(const key of ['processId','parentProcessId','name','creationDate'])assert.equal(current[key],known[key],'Original actor PID identity drifted after witness');for(const key of ['commandLineSha256','executablePathSha256']){assert.match(known[key]??'',hex,'Reused actor witness identity incomplete');if(current[key]!==null)assert.equal(current[key],known[key],'Reused actor visible metadata drifted');}}
 return true;
}
function cleanedValidateObservation(value,request){
 assert.deepEqual(Object.keys(request).sort(),['version','dispatchId','phase','nonce','at','writer','taskDefinitionSha256','task','operatorSource','observerCodeSha256','sourceIdentity','operatorFiles','epoch','deadlineUnixMs','staticEvidence','evidenceDirectory','adoptionSha256'].sort());assert.equal(request.version,'teruisi-cleaned-preparation-request-4aac-v1');assert.equal(request.dispatchId,fixedCleanedPreparation.dispatchId);assert.match(request.nonce??'',/^[a-f0-9]{32}$/);assert.deepEqual(Object.keys(request.operatorFiles).sort(),cleanedOperatorNames.toSorted());
 cleanedValidateEpoch(request.epoch,request.deadlineUnixMs,request.writer.processId);cleanedValidateStatic(request.staticEvidence,request.epoch,request.deadlineUnixMs,{final:request.phase==='final-observation'});assert.ok(Date.parse(request.at)>=Date.parse((request.staticEvidence.final??request.staticEvidence.initial).completedAt)&&Date.parse(request.at)<=request.deadlineUnixMs,'Challenge predates its certified complete inventory');assert.equal(path.resolve(request.evidenceDirectory),path.resolve(cleanedQueueRoot,'resolutions',fixedCleanedPreparation.dispatchId+'-evidence'));assert.match(request.adoptionSha256,hex);
 assert.deepEqual(Object.keys(value).sort(),['version','dispatchId','requestSha256','nonce','phase','at','writer','observer','observerCodeSha256','elevated','completeCensus','censusCount','census','relatedControllers','relatedOpaque','taskState','taskInstances','taskDefinitionSha256','sourceCommit','sourceTree','sourceClean','packet','actors','operatorSourceIdentity','operatorFiles','dynamicStartedAt','dynamicCompletedAt','staticEvidenceSha256'].sort());assert.equal(typeof value.elevated,'boolean');assert.ok(Array.isArray(value.census)&&value.census.length===value.censusCount);assertSchemaWitnessCensus(value.census,value.census.map(row=>({...row,commandLine:null,executablePath:null})),{protectedActors:[request.writer,value.observer]});assert.deepEqual(value.operatorSourceIdentity,request.sourceIdentity);assert.deepEqual(value.operatorFiles,request.operatorFiles);
 assert.equal(value.version,'teruisi-cleaned-preparation-observation-4aac-v1');assert.equal(value.dispatchId,fixedCleanedPreparation.dispatchId);assert.equal(value.requestSha256,sha(Buffer.from(canonical(request))));assert.equal(value.nonce,request.nonce);assert.equal(value.phase,request.phase);assert.equal(value.writer.processId,request.writer.processId);assert.deepEqual(value.writer,request.writer);assert.equal(value.staticEvidenceSha256,sha(Buffer.from(canonical(request.staticEvidence))));assert.deepEqual(value.packet,request.staticEvidence.initial.proof);
 assert.equal(value.observerCodeSha256,fixedCleanedPreparation.observerSha256);assert.ok(value.observer.processId>0&&value.observer.processId!==request.writer.processId);for(const key of ['creationDate','commandLine','executablePath'])assert.ok(typeof value.observer[key]==='string'&&value.observer[key]);
 assert.deepEqual(value.relatedControllers,[]);assert.equal(value.relatedOpaque,0);assert.equal(value.completeCensus,true);assert.equal(value.taskState,3);assert.equal(value.taskInstances,0);assert.equal(value.taskDefinitionSha256,request.taskDefinitionSha256);assert.equal(value.sourceCommit,fixedCleanedPreparation.target);assert.equal(value.sourceClean,true);assert.equal(value.sourceTree,fixedCleanedPreparation.tree);assertCleanedPreparationProof(value.packet);
 assert.equal(value.elevated,true);assert.deepEqual(value.actors.map(row=>({pid:row.pid,originalExitedBefore:row.originalExitedBefore})),cleanedActors.map(row=>({pid:row.pid,originalExitedBefore:row.exitedBefore})));assert.deepEqual(value.actors,cleanedActorsFromProjection(value.census));
 const start=Date.parse(value.dynamicStartedAt),end=Date.parse(value.dynamicCompletedAt),at=Date.parse(value.at);assert.ok(start>=Date.parse(request.at)&&end>=start&&at>=end&&at-start<60000,'Dynamic observation timestamps are stale or reordered');assert.ok(at<=request.deadlineUnixMs,'Observation exceeded its same-lock epoch');
 return value;
}
function cleanedValidateEpoch(epoch,deadline,pid){assert.deepEqual(Object.keys(epoch).sort(),['id','startedAt','writerPid']);assert.match(epoch.id,id);assert.equal(epoch.writerPid,pid);assert.ok(Number.isFinite(Date.parse(epoch.startedAt)));assert.equal(deadline,Date.parse(epoch.startedAt)+20*60*1000,'Finite resolution epoch must be exactly bounded');}
function cleanedValidateStatic(value,epoch,deadline,{final=true}={}){
 assert.deepEqual(Object.keys(value).sort(),['initial','final'].sort());assert.ok(value.initial);assert.equal(value.final===null,!final);
 for(const item of [value.initial,value.final].filter(Boolean)){assert.deepEqual(Object.keys(item).sort(),['completedAt','proof','startedAt']);assert.ok(Date.parse(item.startedAt)>=Date.parse(epoch.startedAt)&&Date.parse(item.completedAt)>=Date.parse(item.startedAt)&&Date.parse(item.completedAt)<=deadline);assertCleanedPreparationProof(item.proof);}
 if(final){assert.deepEqual(value.initial.proof,value.final.proof,'Initial and final complete inventories differ');assert.ok(Date.parse(value.final.startedAt)>=Date.parse(value.initial.completedAt));}
 return true;
}
async function cleanedArchiveRead(file){const stat=await fs.lstat(file);assert.ok(stat.size<=32*1024*1024,'Unbounded cleaned archive object');return nativeRead(file);}
async function cleanedReadResolution({read=cleanedArchiveRead}={}){
 const file=path.join(cleanedQueueRoot,'resolutions',fixedCleanedPreparation.dispatchId+'.json'),raw=await read(file),value=JSON.parse(raw);assert.equal(raw.toString(),canonical(value));
 assert.deepEqual(Object.keys(value).sort(),['version','decision','at','dispatchId','dispatchSha256','requestId','targetCommit','originalResultSha256','terminationBasis','candidateArtifactsAbsent','nativePreparationStarted','prepared','publicationPerformed','retryOriginal','writerPid','sourceIdentity','operatorFiles','originals','adoptionSha256','evidenceDirectory','observations','epoch','deadlineUnixMs','staticEvidence'].sort());assert.equal(value.decision,'failed-cleaned-before-plan');assert.deepEqual(Object.keys(value.operatorFiles).sort(),cleanedOperatorNames.toSorted());cleanedValidateEpoch(value.epoch,value.deadlineUnixMs,value.writerPid);cleanedValidateStatic(value.staticEvidence,value.epoch,value.deadlineUnixMs);assert.ok(Date.parse(value.at)<=value.deadlineUnixMs);
 assert.equal(value.version,fixedCleanedPreparation.version);assert.equal(value.dispatchId,fixedCleanedPreparation.dispatchId);assert.equal(value.requestId,fixedCleanedPreparation.requestId);assert.equal(value.targetCommit,fixedCleanedPreparation.target);assert.equal(value.dispatchSha256,fixedCleanedPreparation.dispatchSha256);assert.equal(value.originalResultSha256,fixedCleanedPreparation.resultSha256);assert.equal(value.terminationBasis,'failed-cleaned-before-plan');assert.equal(value.candidateArtifactsAbsent,true);assert.equal(value.nativePreparationStarted,true);
 for(const key of ['prepared','publicationPerformed','retryOriginal'])assert.equal(value[key],false);
 const evidence=path.join(cleanedQueueRoot,'resolutions',fixedCleanedPreparation.dispatchId+'-evidence');assert.equal(path.resolve(value.evidenceDirectory),path.resolve(evidence));
 const object=async digest=>{assert.match(digest??'',hex);const bytes=await read(path.join(evidence,'objects',digest+'.bin'));assert.equal(sha(bytes),digest);return bytes;};
 for(const record of [value.staticEvidence.initial,value.staticEvidence.final]){const raw=Buffer.from(canonical(record));assert.deepEqual(await object(sha(raw)),raw);}
 const originals=await cleanedPreparationOriginals({read:async file=>file.startsWith(cleanedQueueRoot+path.sep)?read(file):object(value.originals[file])});assert.deepEqual(value.originals,originals.files);

 const oldInstallation=JSON.parse(await object(fixedCleanedPreparation.oldInstallationSha256));
 const adopted=JSON.parse(await object(value.adoptionSha256));cleanedValidateConfig(JSON.parse(await object(fixedCleanedPreparation.configSha256)),JSON.parse(await object(adopted.configSha256)));const manifest=JSON.parse(await object(adopted.bundleManifestSha256));assert.equal(adopted.status,'adopted');assert.equal(adopted.version,'teruisi-main-control-installation-v3');assert.notEqual(adopted.bundleSha256,fixedCleanedPreparation.bundleSha256);assert.equal(adopted.configSha256,fixedCleanedPreparation.configSha256);assert.equal(path.resolve(adopted.bundleRoot),path.resolve(fixedCleanedPreparation.state,'control-bundles',adopted.bundleSha256));assert.deepEqual(adopted.preparationTask,oldInstallation.preparationTask);
 assert.equal(manifest.bundleSha256,adopted.bundleSha256);assert.equal(sha(Buffer.from(canonical(manifest.files))),manifest.bundleSha256);assert.deepEqual(Object.keys(manifest.files).sort(),cleanedControlNames);
 for(const [name,digest] of Object.entries(manifest.files))await object(digest);
 const intent=JSON.parse(await object(adopted.intentSha256)),transition=JSON.parse(await object(adopted.transitionProofSha256));assert.equal(intent.version,'teruisi-main-control-upgrade-v2');assert.equal(intent.installId,adopted.installId);for(const key of ['bundleRoot','bundleSha256','bundleManifestSha256','dispatcherSha256','hook','hookSha256','configSha256'])assert.equal(intent[key],adopted[key]);assert.equal(path.resolve(intent.stateDirectory),path.resolve(fixedCleanedPreparation.state));assert.equal(path.resolve(intent.configFile),path.resolve(fixedCleanedPreparation.state,'main-publisher-config.json'));assert.equal(manifest.sourceCommit,intent.sourceCommit);assert.equal(manifest.sourceTree,intent.sourceTree);assert.equal(transition.version,'teruisi-main-control-transition-v2');assert.equal(transition.installId,adopted.installId);assert.equal(transition.intentSha256,adopted.intentSha256);assert.deepEqual(transition.lockOrder,['v1-queue','v2-queue','native-rotation']);assert.equal(transition.rotationPipeSha256,sha('\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1'));assert.equal(transition.productionDeploymentPerformed,false);assert.equal(transition.privateTestTopology,false);assert.equal(transition.legacyWindowConverged,true);assert.ok(transition.frames?.length>=3);for(const frame of transition.frames.slice(-3)){assert.deepEqual(frame.related,[]);assert.ok(Date.parse(frame.at)<=Date.parse(adopted.adoptedAt));}await object(adopted.dispatcherSha256);await object(adopted.hookSha256);
 assert.equal(value.sourceIdentity.commit,manifest.sourceCommit);assert.equal(value.sourceIdentity.tree,manifest.sourceTree);assert.equal(value.sourceIdentity.status,'');
 for(const name of cleanedOperatorNames){const digest=value.operatorFiles[name];await object(digest);if(manifest.files['tools/'+name])assert.equal(digest,manifest.files['tools/'+name]);}assert.equal(value.operatorFiles['cleaned-preparation-observer.mjs'],fixedCleanedPreparation.observerSha256);
 assert.equal(value.observations.length,2);const observations=[],acks=[];
 for(const [index,pair] of value.observations.entries()){
  assert.deepEqual(Object.keys(pair).sort(),['ackSha256','observationSha256','requestSha256']);const request=JSON.parse(await object(pair.requestSha256)),observation=cleanedValidateObservation(JSON.parse(await object(pair.observationSha256)),request),ack=JSON.parse(await object(pair.ackSha256));
  assert.equal(request.phase,index===0?'initial-observation':'final-observation');assert.deepEqual(request.epoch,value.epoch);assert.equal(request.deadlineUnixMs,value.deadlineUnixMs);assert.equal(request.adoptionSha256,value.adoptionSha256);assert.deepEqual(request.staticEvidence.initial,value.staticEvidence.initial);assert.deepEqual(request.staticEvidence.final,index===0?null:value.staticEvidence.final);assert.deepEqual(request.sourceIdentity,value.sourceIdentity);assert.deepEqual(request.operatorFiles,value.operatorFiles);assert.equal(request.observerCodeSha256,fixedCleanedPreparation.observerSha256);assert.deepEqual(request.task,adopted.preparationTask);assert.equal(request.writer.processId,value.writerPid);assert.equal(request.taskDefinitionSha256,sha(Buffer.from(canonical(adopted.preparationTask.definition))));assert.ok(Date.parse(observation.at)>=Date.parse(adopted.adoptedAt));await object(observation.observerCodeSha256);await verifyCleanedPreparationArchive(observation.packet,object);
  cleanedValidateAck(ack,request,observation);assert.ok(Date.parse(value.at)>=Date.parse(ack.at));if(index===1)assert.ok(Date.parse(value.at)-Date.parse(observation.dynamicStartedAt)<60000&&Date.parse(value.at)-Date.parse(ack.censusStartedAt)<60000,'Final dynamic sampling expired before resolution append');observations.push(observation);acks.push(ack);
 }
 assert.ok(Date.parse(value.staticEvidence.final.startedAt)>=Date.parse(acks[0].at),'Final complete inventory did not follow the initial observation');
 assert.equal(observations[0].sourceTree,observations[1].sourceTree);assert.deepEqual(observations[0].packet,observations[1].packet);assert.notEqual(observations[0].nonce,observations[1].nonce);assert.ok(Date.parse(observations[1].at)>=Date.parse(observations[0].at));
 return true;
}
function cleanedValidateAck(ack,request,observation){assert.deepEqual(Object.keys(ack).sort(),['at','censusCompletedAt','censusStartedAt','requestSha256','writerPid']);assert.equal(ack.requestSha256,sha(Buffer.from(canonical(request))));assert.equal(ack.writerPid,request.writer.processId);const start=Date.parse(ack.censusStartedAt),end=Date.parse(ack.censusCompletedAt),at=Date.parse(ack.at);assert.ok(start>=Date.parse(observation.dynamicCompletedAt)&&end>=start&&at>=end&&at<=request.deadlineUnixMs&&at-Date.parse(observation.dynamicStartedAt)<60000&&at-start<60000,'Ordinary cross-token acknowledgement is stale or reordered');}
export async function readFixedCleanedPreparationResolution(directory,dispatch,terminal){
 if(path.resolve(directory).toLowerCase()!==path.resolve(cleanedQueueRoot).toLowerCase()||dispatch.dispatchId!==fixedCleanedPreparation.dispatchId||terminal?.requestId!==fixedCleanedPreparation.requestId||terminal.status!=='unknown')return false;
 const file=path.join(directory,'resolutions',fixedCleanedPreparation.dispatchId+'.json');try{await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return false;throw error;}
 return cleanedReadResolution();
}
function assertFixedCleanedNoReplay(directory,selection){if(path.resolve(directory).toLowerCase()===path.resolve(cleanedQueueRoot).toLowerCase())assert.notEqual(selection.targetCommit,fixedCleanedPreparation.target,'The failed-cleaned 477 target cannot be prepared again');}
/** Operator only. The CLI has no target/retry/path override for original state. */
export async function writeFixedCleanedPreparationResolution({sourceRoot,out,observe,identity,ordinary,adopted,assertAdopted,git,oldInstallation,acquireRotation,freshCensus,originalArchive,collectState=collectCleanedPreparationState}={}){
 const [{promisify},{execFile},{fileURLToPath}]=await Promise.all([import('node:util'),import('node:child_process'),import('node:url')]);const execute=promisify(execFile);
 git??=async(root,args)=>(await execute('git',['-C',root,...args],{encoding:'utf8',windowsHide:true})).stdout.trim();
 const sourceIdentity=async root=>({commit:await git(root,['rev-parse','HEAD']),tree:await git(root,['rev-parse','HEAD^{tree}']),status:await git(root,['status','--porcelain'])});
 const self=fileURLToPath(import.meta.url);assert.equal(path.resolve(sourceRoot,'tools/main-prebuild-queue.mjs'),path.resolve(self),'Writer must use its own frozen source');
 const {readAdoptedControl,assertControlGeneration}=await import('./main-control-dispatch.mjs');
 const task=await import('./main-prebuild-task.mjs');
 ordinary??=async()=>task.assertOrdinaryIdentity(await task.currentPreparationIdentity(),(await readAdoptedControl(path.join(fixedCleanedPreparation.state,'main-publisher-config.json'))).state.preparationTask.sid);
 identity??=async()=>task.taskPowerShell('$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$v.pid);if(-not $p -or -not $p.CommandLine -or -not $p.ExecutablePath){throw "Writer process identity unavailable"};@{processId=[int]$p.ProcessId;creationDate=$p.CreationDate.ToUniversalTime().ToString("o");commandLine=$p.CommandLine;executablePath=$p.ExecutablePath}|ConvertTo-Json -Compress',{pid:process.pid});
 await ordinary();const writer=await identity();assert.equal(writer.processId,process.pid);
 const source=await sourceIdentity(sourceRoot);assert.equal(source.status,'');
 const binding=adopted??await readAdoptedControl(path.join(fixedCleanedPreparation.state,'main-publisher-config.json'));
 assertAdopted??=()=>assertControlGeneration(binding);
 let original;
 const archiveBinding=async()=>{
  await assertAdopted();assert.equal(binding.state.version,'teruisi-main-control-installation-v3');assert.notEqual(binding.state.bundleSha256,fixedCleanedPreparation.bundleSha256);assert.equal(binding.state.configSha256,fixedCleanedPreparation.configSha256);
  const manifestRaw=await adminStableRead(path.join(binding.bundleRoot,'MANIFEST.json')),manifest=JSON.parse(manifestRaw);assert.equal(sha(manifestRaw),binding.state.bundleManifestSha256);assert.equal(manifest.sourceCommit,source.commit);assert.equal(manifest.sourceTree,source.tree);
  const objects=new Map(),put=raw=>{objects.set(sha(raw),raw);return sha(raw);};const operatorFiles={};
  for(const name of cleanedOperatorNames){const bytes=await adminStableRead(path.join(sourceRoot,'tools',name));operatorFiles[name]=put(bytes);if(manifest.files['tools/'+name])assert.equal(operatorFiles[name],manifest.files['tools/'+name]);}
  assert.equal(operatorFiles['cleaned-preparation-observer.mjs'],fixedCleanedPreparation.observerSha256);
  const adoptionRaw=await adminStableRead(path.join(fixedCleanedPreparation.state,'CONTROL-INSTALLATION.json'));assert.equal(sha(adoptionRaw),binding.stateSha256);put(adoptionRaw);put(manifestRaw);const configRaw=await adminStableRead(path.join(fixedCleanedPreparation.state,'main-publisher-config.json'));assert.equal(sha(configRaw),binding.state.configSha256);put(configRaw);cleanedValidateConfig(JSON.parse(original.object(fixedCleanedPreparation.configSha256)),JSON.parse(configRaw));
  for(const [file,expected] of [[path.join(fixedCleanedPreparation.state,'control-upgrades',binding.state.installId,'INTENT.json'),binding.state.intentSha256],[binding.state.transitionProofFile,binding.state.transitionProofSha256]]){const bytes=await adminStableRead(file);assert.equal(sha(bytes),expected);put(bytes);}
  for(const [file,expected] of [[path.join(fixedCleanedPreparation.state,'control/tools/publish-latest-main.mjs'),binding.state.dispatcherSha256],[binding.state.hook,binding.state.hookSha256]]){const bytes=await adminStableRead(file);assert.equal(sha(bytes),expected);put(bytes);}
  for(const [name,expected] of Object.entries(manifest.files)){const bytes=await adminStableRead(path.join(binding.bundleRoot,name));assert.equal(sha(bytes),expected);put(bytes);}
  return {objects,operatorFiles,adoptionSha256:sha(adoptionRaw)};
 };
 await assertSchemaArtifactDirectory(out,{allowMissing:true});await fs.mkdir(out,{recursive:false});await assertSchemaArtifactDirectory(out);
 const releaseQueue=await acquireQueueLock(cleanedQueueRoot);assert.ok(releaseQueue,'Queue is busy; no resolution write');let releaseRotation;
 try{
  acquireRotation??=()=>new Promise((resolve,reject)=>{const server=createServer(socket=>socket.destroy());server.once('error',reject);server.listen('\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1',()=>resolve(()=>new Promise(done=>server.close(done))));});
  releaseRotation=await acquireRotation();const epoch={id:randomUUID(),startedAt:new Date().toISOString(),writerPid:writer.processId},deadlineUnixMs=Date.parse(epoch.startedAt)+20*60*1000;await assertAdopted();await assertCleanedResolutionInventory(cleanedQueueRoot);
  originalArchive??=JSON.parse(await fs.readFile(path.join(sourceRoot,'tests/fixtures/fixed-cleaned-4aac-evidence.json'),'utf8'));const originalRead=async file=>{const expected=cleanedOriginalPins[file]??cleanedSuccessorPins[file];assert.match(expected??'',hex);if(file.startsWith(cleanedQueueRoot+path.sep)||file.startsWith(path.resolve(fixedCleanedPreparation.packet)+path.sep)||Object.hasOwn(cleanedSuccessorPins,file))return adminStableRead(file);return Buffer.from(originalArchive.objects[expected],'base64');};original=await cleanedPreparationOriginals({read:originalRead});
  if(!oldInstallation)oldInstallation=Buffer.from(originalArchive.objects[fixedCleanedPreparation.oldInstallationSha256],'base64');assert.equal(sha(oldInstallation),fixedCleanedPreparation.oldInstallationSha256);assert.deepEqual(binding.state.preparationTask,JSON.parse(oldInstallation).preparationTask);
  const closed=await archiveBinding();closed.objects.set(fixedCleanedPreparation.oldInstallationSha256,oldInstallation);
  for(const [file,expected] of Object.entries(original.files)){const bytes=await originalRead(file);assert.equal(sha(bytes),expected);closed.objects.set(expected,bytes);}
  const observations=[],staticEvidence={initial:null,final:null},evidence=path.join(cleanedQueueRoot,'resolutions',fixedCleanedPreparation.dispatchId+'-evidence');await fs.mkdir(path.dirname(evidence),{recursive:true});await fs.mkdir(evidence);await fs.mkdir(path.join(evidence,'objects'));
  const copied=new Set(),copy=async()=>{for(const [digest,bytes] of closed.objects){if(copied.has(digest))continue;const file=path.join(evidence,'objects',digest+'.bin'),handle=await fs.open(file,'wx');try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}copied.add(digest);}};
  const capture=async key=>{assert.ok(Date.now()<=deadlineUnixMs,'Finite same-lock epoch expired');const startedAt=new Date().toISOString(),proof=await collectState({objects:closed.objects,onStage:item=>console.log(JSON.stringify({status:'cleaned-static-inventory',inventory:key,...item}))}),record={startedAt,completedAt:new Date().toISOString(),proof};staticEvidence[key]=record;if(key==='final')assert.deepEqual(staticEvidence.initial.proof,proof,'Initial and final complete inventories differ');const raw=Buffer.from(canonical(record));closed.objects.set(sha(raw),raw);await durableCreate(path.join(out,'STATIC-'+key+'.json'),record);await copy();assert.ok(Date.now()<=deadlineUnixMs,'Complete inventory exceeded the finite epoch');};
  const beforeObservation=async()=>{await assertAdopted();await assertCleanedResolutionInventory(cleanedQueueRoot);await cleanedPreparationOriginals({read:originalRead});await ordinary();assert.deepEqual(await sourceIdentity(sourceRoot),source);};
  const shortCas=async()=>{for(const [file,expected] of [[path.join(fixedCleanedPreparation.state,'CONTROL-INSTALLATION.json'),binding.stateSha256],[path.join(fixedCleanedPreparation.state,'main-publisher-config.json'),fixedCleanedPreparation.configSha256],...['ticket','dispatch','result'].map((kind,index)=>[path.join(cleanedQueueRoot,['tickets','dispatches','results'][index],(kind==='dispatch'?fixedCleanedPreparation.dispatchId:fixedCleanedPreparation.requestId)+'.json'),fixedCleanedPreparation[kind+'Sha256']])])assert.equal(sha(await adminStableRead(file)),expected,'Final no-spawn original/generation CAS changed');};
  const getObservation=async phase=>{
   // All token/Git/source and generation work that may spawn helpers finishes
   // before the high witness. Only file CAS and the one low CIM follow it.
   await beforeObservation();
   const request={version:'teruisi-cleaned-preparation-request-4aac-v1',dispatchId:fixedCleanedPreparation.dispatchId,phase,nonce:randomUUID().replaceAll('-',''),at:new Date().toISOString(),writer,taskDefinitionSha256:sha(Buffer.from(canonical(binding.state.preparationTask.definition))),task:binding.state.preparationTask,operatorSource:sourceRoot,observerCodeSha256:fixedCleanedPreparation.observerSha256,sourceIdentity:source,operatorFiles:closed.operatorFiles,epoch,deadlineUnixMs,staticEvidence:structuredClone(staticEvidence),evidenceDirectory:evidence,adoptionSha256:closed.adoptionSha256};
   const requestFile=path.join(out,'REQUEST-'+phase+'.json');await assertSchemaArtifactDirectory(out);await durableCreate(requestFile,request);await assertSchemaArtifactDirectory(out);
   const response=observe?await observe(request,requestFile):await (async()=>{const file=path.join(out,'OBSERVATION-'+phase+'.json');console.log(JSON.stringify({status:'awaiting-independent-read-only-observer',requestFile,requestSha256:sha(Buffer.from(canonical(request))),responseFile:file}));for(;;){try{return (await readQueueObject(file)).value;}catch(error){if(error.code!=='ENOENT')throw error;if(Date.now()>=deadlineUnixMs)throw Error('Independent observation not supplied within the same-lock epoch');await new Promise(done=>setTimeout(done,250));}}})();
   cleanedValidateObservation(response,request);assert.deepEqual(response.packet,staticEvidence.initial.proof,'Certified complete inventory changed');
   await shortCas();const censusStartedAt=new Date().toISOString(),fresh=await (freshCensus?freshCensus():task.taskPowerShell(schemaCensusScript)),censusCompletedAt=new Date().toISOString();
   const diagnostic={version:'teruisi-cleaned-cross-token-diagnostic-4aac-v1',requestSha256:sha(Buffer.from(canonical(request))),observationSha256:sha(Buffer.from(canonical(response))),epoch,phase,censusStartedAt,censusCompletedAt,...cleanedCrossTokenDiagnostic(response.census,fresh.rows)};const crossSha256=await durableCreate(path.join(out,'CROSS-'+phase+'.json'),diagnostic);
   try{assertSchemaWitnessCensus(response.census,fresh.rows,{protectedActors:[writer,response.observer]});assertCleanedActorWitness(response.census,fresh.rows);for(const row of fresh.rows){if([writer.processId,response.observer.processId].includes(row.processId)||!row.commandLine)continue;const text=decodeSchemaControlCommand(row.commandLine);assert.equal(cleanedControlText(text)||cleanedBuildCommand(row,text),false,'Cleaned preparation actor appeared after witness');}}
   catch(error){await durableCreate(path.join(out,'CROSS-REJECTION-'+phase+'.json'),{requestSha256:diagnostic.requestSha256,crossSha256,at:new Date().toISOString(),reason:error.message,firstFailingProcess:error.message==='New opaque process after witness'?(diagnostic.newOpaque[0]??null):null});throw error;}
   const ack={requestSha256:sha(Buffer.from(canonical(request))),writerPid:writer.processId,censusStartedAt,censusCompletedAt,at:new Date().toISOString()};cleanedValidateAck(ack,request,response);await durableCreate(path.join(out,'ACK-'+phase+'.json'),ack);
   const put=value=>{const raw=Buffer.from(canonical(value));closed.objects.set(sha(raw),raw);return sha(raw);};observations.push({requestSha256:put(request),observationSha256:put(response),ackSha256:put(ack)});return response;
  };
  await capture('initial');const first=await getObservation('initial-observation');await copy();await capture('final');const second=await getObservation('final-observation');assert.equal(first.sourceTree,second.sourceTree);assert.deepEqual(first.packet,second.packet);await copy();
  const value={version:fixedCleanedPreparation.version,decision:'failed-cleaned-before-plan',at:new Date().toISOString(),dispatchId:fixedCleanedPreparation.dispatchId,dispatchSha256:fixedCleanedPreparation.dispatchSha256,requestId:fixedCleanedPreparation.requestId,targetCommit:fixedCleanedPreparation.target,originalResultSha256:fixedCleanedPreparation.resultSha256,terminationBasis:'failed-cleaned-before-plan',candidateArtifactsAbsent:true,nativePreparationStarted:true,prepared:false,publicationPerformed:false,retryOriginal:false,writerPid:writer.processId,sourceIdentity:source,operatorFiles:closed.operatorFiles,originals:original.files,adoptionSha256:closed.adoptionSha256,evidenceDirectory:evidence,observations,epoch,deadlineUnixMs,staticEvidence};
  assert.ok(Date.parse(value.at)-Date.parse(second.dynamicStartedAt)<60000&&Date.parse(value.at)<=deadlineUnixMs,'Final independent dynamic sampling expired before append');const lastAck=JSON.parse(closed.objects.get(observations[1].ackSha256));assert.ok(Date.parse(value.at)-Date.parse(lastAck.censusStartedAt)<60000,'Final ordinary sampling expired before append');
  await durableCreate(path.join(cleanedQueueRoot,'resolutions',fixedCleanedPreparation.dispatchId+'.json'),value);await cleanedReadResolution();return {status:'failed-cleaned-before-plan',prepared:false,publicationPerformed:false,replayOriginal:false};
 }finally{try{await releaseRotation?.();}finally{await releaseQueue();}}
}
// FIXED_CLEANED_4AAC_END


// FIXED_STOPPED_NPM_F052_BEGIN: one stopped preparation, never a replay permit.
export const fixedStoppedNpmPreparation=Object.freeze({
 version:'teruisi-stopped-npm-preparation-f052-v1',
 decision:'native-worker-preparation-stopped-at-npm-before-contract-tests',
 state:'D:/codex-isolated/main-manual-release-20261016',
 packet:'D:/codex-isolated/main-release-packages/a396a7b10930-bcccc8cd-00058fea',
 target:'a396a7b10930af4e4eaf4db06bf7217748463b48',tree:'b60b42c802791dad880ec2bd3540f232b203ae35',
 requestId:'d2990829-9621-4495-a2fc-0d777dfe94ee',dispatchId:'f05223b2-d089-4c4a-9702-fd6fbfaa024d',
 ticketSha256:'39d58e8661489101829ed83b450a0288eceb14e6103105efbc1f18d3a4587fa7',
 dispatchSha256:'2fac5ac64a5accd3f1f8ddeb3be78998d1feb3641de7df1c78da62bc15113233',
 resultSha256:'bb965f1f291e7981b9c374147d09cd9edb4f7e60aee50375ed30718e85ad5d21',
 oldConfigSha256:'9879162ff8955bc616f457ad66a3817a53a92e2e8358c6c40dd87846d7188c58',
 oldInstallationSha256:'cecec8817bc3f0a3baf3a4bc5cefa6761341829b832dfedc12012ef40395d3c0',
 oldBundle:'129677e53ce6ef916f07de0df7af234b30befc93876631e10177d49013eb1405',
 nativeToolsSource:'D:/codex-isolated/main-manual-release-20261016/native-tools/65dcc585b16e7fd1db5fde4648dec81a114df00e1e5c578976e82bcac854414e'
});
const stoppedNpmPins=Object.freeze({
 "D:\\codex-isolated\\main-manual-release-20261016\\prebuild-queue-v2\\tickets\\d2990829-9621-4495-a2fc-0d777dfe94ee.json": "39d58e8661489101829ed83b450a0288eceb14e6103105efbc1f18d3a4587fa7",
 "D:\\codex-isolated\\main-manual-release-20261016\\prebuild-queue-v2\\dispatches\\f05223b2-d089-4c4a-9702-fd6fbfaa024d.json": "2fac5ac64a5accd3f1f8ddeb3be78998d1feb3641de7df1c78da62bc15113233",
 "D:\\codex-isolated\\main-manual-release-20261016\\prebuild-queue-v2\\results\\d2990829-9621-4495-a2fc-0d777dfe94ee.json": "bb965f1f291e7981b9c374147d09cd9edb4f7e60aee50375ed30718e85ad5d21",
 "D:\\codex-isolated\\main-release-packages\\a396a7b10930-bcccc8cd-00058fea\\main-release-request.json": "2b0cccebf503d4e42b63a63d5bf19bfe0b8af94018cc46aacaee1683306cef9f",
 "D:\\codex-isolated\\main-release-packages\\a396a7b10930-bcccc8cd-00058fea\\release-scope-plan.json": "085d280bf68fd26fe9092236b14281687d19d2d7ff64ae36ccbaa6d3f211372c",
 "D:\\codex-isolated\\main-release-packages\\a396a7b10930-bcccc8cd-00058fea\\schema\\ai-0086-evidence.json": "2157de2dbfc9172371e8bf49394b593d56bb5212e4834d7e210cb2b144f3fcd2",
 "D:\\codex-isolated\\main-release-packages\\a396a7b10930-bcccc8cd-00058fea\\publish-a396a7b10930\\preparation\\PREPARING.json": "6c9c65c8ac10a4f3cc541fd8e0228570016facd9107f542391a1a2a9d38b26ec",
 "D:\\codex-isolated\\main-release-packages\\a396a7b10930-bcccc8cd-00058fea\\publish-a396a7b10930\\preparation\\source-binding.json": "a6e210a4098eab8f74214b4b34e82ac34dc280171c245866783e1c72cb0d0d7d",
 "D:\\codex-isolated\\main-release-packages\\a396a7b10930-bcccc8cd-00058fea\\logs\\release-2026-10-19T15-56-55.571Z-e17425a4-7799-4655-9a8c-a465f8fcba7c.log": "f095778b7fe2da6bd65a41c9318fde9253f188a6c6cff43c57408d4107c2008d",
 "D:\\codex-artifacts\\piagent-phase3-20261019\\OWN-PREPARATION-CANCEL.json": "0155c3aa28d0c2457e5e389e090405fe55a5e6fe8bd6328db7e4aca4f23ba12d",
 "D:\\codex-isolated\\main-release-packages\\a396a7b10930-bcccc8cd-00058fea\\publish-a396a7b10930\\preparation\\FAILED-a5cd3395-9e6a-4f8b-bf39-9b9daeb354c8.json": "9e73bf27f06b21da24a7101b054cc707a150b42fcf50638ea4cf456afc381537",
 "D:\\codex-isolated\\main-manual-release-20261016\\main-publisher-config.json": "9879162ff8955bc616f457ad66a3817a53a92e2e8358c6c40dd87846d7188c58",
 "D:\\codex-isolated\\main-manual-release-20261016\\CONTROL-INSTALLATION.json": "cecec8817bc3f0a3baf3a4bc5cefa6761341829b832dfedc12012ef40395d3c0",
 "D:\\codex-isolated\\main-manual-release-20261016\\control-bundles\\129677e53ce6ef916f07de0df7af234b30befc93876631e10177d49013eb1405\\MANIFEST.json": "8c193342579dd3c406f4b8f222287c9d4cabee5f75961d12c703e6702cfa10fe",
 "D:\\codex-isolated\\main-manual-release-20261016\\source\\tools\\worker-local-release.mjs": "0f2d229f58b988dc9591699e0d73362ad1f1f8df5367e19844d82d931a99c108",
 "D:\\codex-isolated\\main-manual-release-20261016\\source\\tools\\worker-local-release-rotation.mjs": "7dd49103f5b672dae484d3b5e70207d6644657701a5b6be23c85203cad62b72f",
 "D:\\codex-isolated\\main-manual-release-20261016\\source\\tools\\d1-retirement-proof.mjs": "87cf58e5ab5cac1dd9e77a4502e24b2769e4a121b5bb173dd53d45d913f6bc76",
 "D:\\codex-isolated\\main-release-packages\\a396a7b10930-bcccc8cd-00058fea\\source\\tools\\publish-main.mjs": "228e151242e4c5351fb4ec294df44f9e4adadcf6c5a007931517e4c17ef82063",
 "D:\\codex-isolated\\main-release-packages\\a396a7b10930-bcccc8cd-00058fea\\source\\tools\\publish-prepared-main.mjs": "76c60012aa83664220c60c0219d3780df1f33b27d23dad0afc908e6e4704e8d7",
 "D:\\codex-isolated\\main-release-packages\\a396a7b10930-bcccc8cd-00058fea\\source\\tools\\worker-local-release.mjs": "dad4e7a1625c4d174541c81669b8c65c0e76bef43e723a87d014947cce362103",
 "D:\\codex-isolated\\main-release-packages\\a396a7b10930-bcccc8cd-00058fea\\source\\tools\\worker-local-release-rotation.mjs": "8b3ec38f47c247c6b0d69c62ab0efb105f63cada945ec40cf7debe76f5ff35d7"
});
const stoppedNativeFiles=Object.freeze({
 'tools/worker-local-release.mjs':'aa1be03ebde6fc5b5f9a50fc986a12756ba8eda69e0549ef111f23d5b9439bd2',
 'tools/worker-local-release-rotation.mjs':'5c265b55c0d738c9785809fdf56c72b72160d6814141d2b21c5149740c3c54fb',
 'tools/d1-retirement-proof.mjs':'87cf58e5ab5cac1dd9e77a4502e24b2769e4a121b5bb173dd53d45d913f6bc76'
});
const stoppedQueueRoot=path.resolve(fixedStoppedNpmPreparation.state,'prebuild-queue-v2');
const stoppedPacket=path.resolve(fixedStoppedNpmPreparation.packet);
const stoppedPreparation=path.join(stoppedPacket,'publish-a396a7b10930/preparation');
const stoppedNames=['FAILED-a5cd3395-9e6a-4f8b-bf39-9b9daeb354c8.json','PREPARING.json','source-binding.json'];
const stoppedActors=[50824,22800,52988,18644,60280];
function stoppedFacts(value){
 assert.equal(value.version,fixedStoppedNpmPreparation.version);assert.equal(value.decision,fixedStoppedNpmPreparation.decision);
 assert.equal(value.nativePreparationStarted,true);assert.equal(value.prepared,false);assert.equal(value.publicationPerformed,false);assert.equal(value.retryOriginal,false);
 assert.equal(value.functionalTestsExecuted,false);assert.equal(value.npmChildStopped,true);
}
async function stoppedPutObjects(directory,objects){
 await fs.mkdir(directory,{recursive:true});for(const [digest,raw]of objects){assert.equal(sha(raw),digest);const file=path.join(directory,digest+'.bin');try{const h=await fs.open(file,'wx');try{await h.writeFile(raw);await h.sync();}finally{await h.close();}}catch(error){if(error.code!=='EEXIST')throw error;assert.deepEqual(await nativeRead(file),raw);}}
}
export async function captureFixedStoppedNpmOriginals(out){
 await assertSchemaArtifactDirectory(out,{allowMissing:true});await fs.mkdir(out,{recursive:false});const objects=new Map();
 for(const [file,expected]of Object.entries(stoppedNpmPins)){const raw=await nativeRead(file);assert.equal(sha(raw),expected,'Original stopped preparation changed');objects.set(expected,raw);}
 await stoppedPutObjects(path.join(out,'objects'),objects);await durableCreate(path.join(out,'ORIGINALS.json'),{version:fixedStoppedNpmPreparation.version,files:stoppedNpmPins});
 return {status:'originals-preserved',directory:out,originalsSha256:sha(await nativeRead(path.join(out,'ORIGINALS.json')))};
}
async function stoppedOriginals(archive,objects){
 const refs=JSON.parse(await nativeRead(path.join(archive,'ORIGINALS.json')));assert.equal(refs.version,fixedStoppedNpmPreparation.version);assert.deepEqual(refs.files,stoppedNpmPins);
 for(const [file,digest]of Object.entries(stoppedNpmPins)){const raw=await nativeRead(path.join(archive,'objects',digest+'.bin'));assert.equal(sha(raw),digest);objects.set(digest,raw);
  if(file.startsWith(stoppedPacket+path.sep)||file.startsWith(stoppedQueueRoot+path.sep))assert.equal(sha(await nativeRead(file)),digest,'Original queue/packet evidence changed');}
 const dispatch=JSON.parse(objects.get(fixedStoppedNpmPreparation.dispatchSha256)),terminal=JSON.parse(objects.get(fixedStoppedNpmPreparation.resultSha256));
 validateDispatch(dispatch,fixedStoppedNpmPreparation.dispatchId+'.json');assert.equal(terminal.status,'unknown');assert.equal(dispatch.selectedTarget,fixedStoppedNpmPreparation.target);
 const failed=JSON.parse(objects.get(Object.entries(stoppedNpmPins).find(([name])=>name.endsWith(stoppedNames[0]))[1]));
 assert.equal(failed.mainCommit,fixedStoppedNpmPreparation.target);assert.equal(failed.maintenanceStarted,false);assert.equal(failed.automaticRetry,false);
 assert.equal(failed.processEvidence.code,'nonzero_exit');assert.equal(failed.processEvidence.processId,52988);assert.equal(failed.processEvidence.exitCode,4294967295);assert.equal(failed.processEvidence.treeCleanupPending,false);
 const source=JSON.parse(objects.get(Object.entries(stoppedNpmPins).find(([name])=>name.endsWith('source-binding.json'))[1]));
 return {dispatch,terminal,source};
}
async function stoppedConfig(binding,objects){
 const put=raw=>{objects.set(sha(raw),raw);return sha(raw);};const oldConfig=JSON.parse(objects.get(fixedStoppedNpmPreparation.oldConfigSha256));
 const configRaw=await nativeRead(path.join(fixedStoppedNpmPreparation.state,'main-publisher-config.json'));assert.equal(sha(configRaw),binding.state.configSha256);const next=JSON.parse(configRaw);
 const stripped=value=>{const copy={...value};delete copy.nativeToolsSource;return copy;};assert.deepEqual(stripped(next),stripped(oldConfig));assert.equal(path.resolve(next.nativeToolsSource),path.resolve(fixedStoppedNpmPreparation.nativeToolsSource));put(configRaw);
 assert.deepEqual((await fs.readdir(next.nativeToolsSource)).sort(),['tools']);assert.deepEqual((await fs.readdir(path.join(next.nativeToolsSource,'tools'))).sort(),Object.keys(stoppedNativeFiles).map(name=>path.basename(name)).sort());
 for(const [name,digest]of Object.entries(stoppedNativeFiles)){const raw=await nativeRead(path.join(next.nativeToolsSource,name));assert.equal(sha(raw),digest,'Corrected native closure changed');put(raw);}
 const old=JSON.parse(objects.get(fixedStoppedNpmPreparation.oldInstallationSha256));assert.deepEqual(binding.state.preparationTask,old.preparationTask);assert.notEqual(binding.state.bundleSha256,old.bundleSha256);
 const adoptedRaw=await nativeRead(path.join(fixedStoppedNpmPreparation.state,'CONTROL-INSTALLATION.json'));assert.equal(sha(adoptedRaw),binding.stateSha256);put(adoptedRaw);
 const manifestRaw=await nativeRead(path.join(binding.bundleRoot,'MANIFEST.json'));assert.equal(sha(manifestRaw),binding.state.bundleManifestSha256);const manifest=JSON.parse(manifestRaw);assert.deepEqual(Object.keys(manifest.files).sort(),[...schemaControlNames,'tools/frozen-main-source.mjs'].sort());put(manifestRaw);
 for(const [name,digest]of Object.entries(manifest.files)){const raw=await nativeRead(path.join(binding.bundleRoot,name));assert.equal(sha(raw),digest);put(raw);}
 for(const [file,digest]of [[path.join(fixedStoppedNpmPreparation.state,'control-upgrades',binding.state.installId,'INTENT.json'),binding.state.intentSha256],[binding.state.transitionProofFile,binding.state.transitionProofSha256]]){const raw=await nativeRead(file);assert.equal(sha(raw),digest);put(raw);}
 const adoptionIntent=JSON.parse(objects.get(binding.state.intentSha256));assert.equal(adoptionIntent.old.installation,fixedStoppedNpmPreparation.oldInstallationSha256);assert.equal(adoptionIntent.old.config,fixedStoppedNpmPreparation.oldConfigSha256);const updateRaw=await nativeRead(path.join(fixedStoppedNpmPreparation.state,'control-upgrades',binding.state.installId,'NATIVE-TOOLS-UPDATE.json'));assert.equal(sha(updateRaw),adoptionIntent.nativeToolsUpdateSha256);put(updateRaw);const update=JSON.parse(updateRaw);assert.deepEqual(Object.keys(update).sort(),['version','oldConfigSha256','nativeToolsSource'].sort());assert.equal(update.version,'teruisi-code-only-native-tools-update-v1');assert.equal(update.oldConfigSha256,fixedStoppedNpmPreparation.oldConfigSha256);assert.equal(path.resolve(update.nativeToolsSource),path.resolve(fixedStoppedNpmPreparation.nativeToolsSource));
 const transition=JSON.parse(objects.get(binding.state.transitionProofSha256));assert.equal(transition.productionDeploymentPerformed,false);assert.equal(transition.legacyWindowConverged,true);assert.deepEqual(transition.lockOrder,['v1-queue','v2-queue','native-rotation']);
 return {manifest,configSha256:put(configRaw),adoptionSha256:put(adoptedRaw)};
}
async function stoppedPacketAndMetadata(config,{objects=new Map()}={}){
 await nativeDirectory(stoppedPacket);assert.deepEqual((await fs.readdir(path.join(stoppedPacket,'publish-a396a7b10930'))).sort(),['preparation']);
 assert.deepEqual((await fs.readdir(stoppedPreparation)).sort(),stoppedNames);assert.deepEqual(await fs.readdir(path.join(stoppedPacket,'invocations')),[]);
 const markers=[fixedStoppedNpmPreparation.target,stoppedPacket,sha(await nativeRead(path.join(stoppedPreparation,'source-binding.json')))];
 const entries=[],put=raw=>{objects.set(sha(raw),raw);return sha(raw);};let count=0;
 const inspect=async file=>{if(++count>2048)throw Error('Bounded native metadata inventory exceeded');const raw=await nativeRead(file);assert.ok(raw.length<=1024*1024,'Metadata exceeds bound');JSON.parse(raw);const text=nativeNormalize(raw.toString('utf8'));for(const marker of markers)assert.equal(text.includes(nativeNormalize(marker)),false,'Late plan/publication references stopped preparation');entries.push({path:file,sha256:put(raw)});};
 for(const domain of nativeStateDomains){const directory=path.join(nativeWorkerRoot,'state',domain);await nativeDirectory(directory);const names=await fs.readdir(directory,{withFileTypes:true});assert.ok(names.length<=1024);for(const item of names){assert.equal(item.isSymbolicLink(),false);if(item.isFile()&&item.name.endsWith('.json'))await inspect(path.join(directory,item.name));else if(item.isDirectory()){for(const name of ['deployment-manifest.json','plan.json','prepared.json','consumption.json','successor.json']){const file=path.join(directory,item.name,name);try{await fs.lstat(file);await inspect(file);}catch(error){if(error.code!=='ENOENT')throw error;}}}}}
 const releaseRoot=path.join(nativeWorkerRoot,'releases');const releases=await fs.readdir(releaseRoot,{withFileTypes:true});assert.ok(releases.length<=256);for(const item of releases){assert.ok(item.isDirectory()&&!item.isSymbolicLink());await inspect(path.join(releaseRoot,item.name,'deployment-manifest.json'));}
 const {pathToFileURL}=await import('node:url');const rotation=await import(pathToFileURL(path.join(config.nativeToolsSource,'tools/worker-local-release-rotation.mjs')));const chain=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:false});
 const dispatch=JSON.parse(await nativeRead(path.join(stoppedQueueRoot,'dispatches',fixedStoppedNpmPreparation.dispatchId+'.json')));
 assert.deepEqual(chain.head,dispatch.selection.live.head);assert.equal(chain.chainStateSha256,dispatch.selection.live.chainStateSha256);const django=sha(await nativeRead(path.join(nativeDjangoRoot,'app/deployment.json')));assert.equal(django,dispatch.selection.live.djangoManifestSha256);
 return {at:new Date().toISOString(),head:chain.head,chainStateSha256:chain.chainStateSha256,djangoManifestSha256:django,metadata:entries.sort((a,b)=>a.path.localeCompare(b.path)),packetFiles:stoppedNames,invocationsEmpty:true};
}
const stoppedCensusScript='$probe=$PID;$rows=@(Get-CimInstance Win32_Process -ErrorAction Stop|Where-Object{$_.ProcessId -ne $probe}|ForEach-Object{@{processId=[int]$_.ProcessId;parentProcessId=[int]$_.ParentProcessId;name=[string]$_.Name;creationDate=$(if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString("o")}else{$null});executablePath=[string]$_.ExecutablePath;commandLine=[string]$_.CommandLine}});if($rows.Count -gt 2048){throw "bounded controller census exceeded"};@{rows=$rows}|ConvertTo-Json -Depth 4 -Compress';
async function stoppedCensus(){const task=await import('./main-prebuild-task.mjs');return (await task.taskPowerShell(stoppedCensusScript,{})).rows;}
function stoppedActorAbsence(rows){for(const pid of stoppedActors)assert.equal(rows.some(row=>row.processId===pid),false,'Original preparation PID present or reused; preserve unknown');}
function stoppedMetadataDigest(value){return sha(Buffer.from(canonical({...value,at:null})));}
function stoppedValidateObservation(value,request){
 assert.deepEqual(Object.keys(request).sort(),['version','at','epoch','nonce','writer','adoptionSha256','operatorSha256','metadataSha256'].sort());
 assert.deepEqual(Object.keys(value).sort(),['version','requestSha256','epoch','nonce','at','writer','observer','census','relatedControllers','originalPidsAbsent','taskState','taskInstances','adoptionSha256','operatorSha256','metadataSha256'].sort());assert.equal(value.metadataSha256,request.metadataSha256);
 assert.equal(value.version,fixedStoppedNpmPreparation.version);assert.equal(value.requestSha256,sha(Buffer.from(canonical(request))));assert.equal(value.epoch,request.epoch);assert.equal(value.nonce,request.nonce);
 assert.equal(value.writer.processId,request.writer.processId);assert.notEqual(value.observer.processId,value.writer.processId);assert.deepEqual(value.relatedControllers,[]);assert.equal(value.taskState,3);assert.equal(value.taskInstances,0);assert.equal(value.adoptionSha256,request.adoptionSha256);
 assert.ok(Date.parse(value.at)>=Date.parse(request.at)&&Date.parse(value.at)-Date.parse(request.at)<60000);assert.equal(value.operatorSha256,request.operatorSha256);assert.equal(value.originalPidsAbsent,true);
 assertSchemaWitnessCensus(value.census,value.census.map(row=>({...row,commandLine:null,executablePath:null})),{protectedActors:[request.writer,value.observer]});for(const pid of stoppedActors)assert.equal(value.census.some(row=>row.processId===pid),false);
 return value;
}
export async function observeFixedStoppedNpmPreparation(request){
 const {fileURLToPath}=await import('node:url');const self=fileURLToPath(import.meta.url);assert.equal(sha(await nativeRead(self)),request.operatorSha256);
 const task=await import('./main-prebuild-task.mjs');const rows=await stoppedCensus();stoppedActorAbsence(rows);const observer=rows.find(row=>row.processId===process.pid);assert.ok(observer?.commandLine&&observer.executablePath);const identity={processId:observer.processId,creationDate:observer.creationDate,commandLine:observer.commandLine,executablePath:observer.executablePath};assert.notEqual(identity.processId,request.writer.processId);
 const related=classifySchemaControllers(rows,{writer:request.writer,observer:identity});assert.deepEqual(related,[]);
 const binding=await (await import('./main-control-dispatch.mjs')).readAdoptedControl(path.join(fixedStoppedNpmPreparation.state,'main-publisher-config.json'));assert.equal(binding.stateSha256,request.adoptionSha256);
 const metadata=await stoppedPacketAndMetadata(binding.config);assert.equal(stoppedMetadataDigest(metadata),request.metadataSha256);
 const taskState=await task.taskPowerShell('$s=New-Object -ComObject Schedule.Service;$s.Connect();$t=$s.GetFolder("\\").GetTask($v.name);@{state=[int]$t.State;instances=[int]$t.GetInstances(0).Count}|ConvertTo-Json -Compress',{name:binding.state.preparationTask.name});
 return {version:fixedStoppedNpmPreparation.version,requestSha256:sha(Buffer.from(canonical(request))),epoch:request.epoch,nonce:request.nonce,at:new Date().toISOString(),writer:request.writer,observer:identity,census:schemaCensusProjection(rows),relatedControllers:related,originalPidsAbsent:true,taskState:taskState.state,taskInstances:taskState.instances,adoptionSha256:binding.stateSha256,operatorSha256:request.operatorSha256,metadataSha256:stoppedMetadataDigest(metadata)};
}
async function stoppedIndependentObservation(request,out){
 const [{spawn},{fileURLToPath}]=await Promise.all([import('node:child_process'),import('node:url')]);const file=path.join(out,'observation-request.json'),response=path.join(out,'observation.json');await durableCreate(file,request);
 const allowed=new Set(['PATH','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE','SYSTEMDRIVE']);const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>allowed.has(name.toUpperCase())));
 const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--observe-stopped-npm-f052',file,response],{env,windowsHide:true,stdio:'ignore'});const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code)=>resolve(code));});
 const until=Date.now()+60000;let raw;for(;;){try{raw=await nativeRead(response);break;}catch(error){if(error.code!=='ENOENT')throw error;}assert.ok(Date.now()<until,'Independent observer did not respond');await new Promise(resolve=>setTimeout(resolve,100));}
 const observation=stoppedValidateObservation(JSON.parse(raw),request);const rows=await stoppedCensus();stoppedActorAbsence(rows);assertSchemaWitnessCensus(observation.census,rows,{protectedActors:[request.writer,observation.observer]});assert.deepEqual(classifySchemaControllers(rows,{writer:request.writer,observer:observation.observer}),[]);
 const ack={at:new Date().toISOString(),requestSha256:sha(Buffer.from(canonical(request))),observationSha256:sha(raw),writerPid:process.pid};await durableCreate(response+'.ack',ack);assert.equal(await exited,0,'Independent observer acknowledgement failed');return {request,observation,ack};
}
export async function writeFixedStoppedNpmPreparationResolution({sourceRoot,out,originalArchive}={}){
 const [{execFile},{promisify},{fileURLToPath}]=await Promise.all([import('node:child_process'),import('node:util'),import('node:url')]);const execute=promisify(execFile);const git=async args=>(await execute('git',['-C',sourceRoot,...args],{encoding:'utf8',windowsHide:true})).stdout.trim();
 assert.equal(path.resolve(sourceRoot,'tools/main-prebuild-queue.mjs'),fileURLToPath(import.meta.url));const sourceIdentity={commit:await git(['rev-parse','HEAD']),tree:await git(['rev-parse','HEAD^{tree}']),status:await git(['status','--porcelain'])};assert.equal(sourceIdentity.status,'');assert.notEqual(sourceIdentity.commit,fixedStoppedNpmPreparation.target);
 const task=await import('./main-prebuild-task.mjs'),control=await import('./main-control-dispatch.mjs');const binding=await control.readAdoptedControl(path.join(fixedStoppedNpmPreparation.state,'main-publisher-config.json'));task.assertOrdinaryIdentity(await task.currentPreparationIdentity(),binding.state.preparationTask.sid);
 await assertSchemaArtifactDirectory(out,{allowMissing:true});await fs.mkdir(out,{recursive:false});const unlock=await acquireQueueLock(stoppedQueueRoot);assert.ok(unlock,'Preparation queue is busy');let rotation;
 try{rotation=await new Promise((resolve,reject)=>{const server=createServer(socket=>socket.destroy());server.once('error',reject);server.listen('\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1',()=>resolve(()=>new Promise(done=>server.close(done))));});
  const objects=new Map();await stoppedOriginals(originalArchive,objects);const adopted=await stoppedConfig(binding,objects);assert.equal(adopted.manifest.sourceCommit,sourceIdentity.commit);assert.equal(adopted.manifest.sourceTree,sourceIdentity.tree);assert.equal(adopted.manifest.files['tools/main-prebuild-queue.mjs'],sha(await nativeRead(fileURLToPath(import.meta.url))));
  for(const name of await entries(stoppedQueueRoot,'dispatches')){const d=await readQueueObject(path.join(stoppedQueueRoot,'dispatches',name));validateDispatch(d.value,name);for(const ref of d.value.tickets){const terminal=await ticketResult(stoppedQueueRoot,ref.requestId,ref.ticketSha256);assert.ok(terminal,'Pending dispatch remains');if(['unknown','failed','blocked'].includes(terminal.status)&&d.value.dispatchId!==fixedStoppedNpmPreparation.dispatchId){assert.ok(await readFixedAdminRejectionResolution(stoppedQueueRoot,d.value,terminal)||await readFixedSchemaRejectionResolution(stoppedQueueRoot,d.value,terminal)||await readFixedCacheRejectionResolution(stoppedQueueRoot,d.value,terminal)||await readFixedNativeAbandonmentResolution(stoppedQueueRoot,d.value,terminal)||await readFixedCleanedPreparationResolution(stoppedQueueRoot,d.value,terminal),'Another unresolved dispatch remains');}}}
  const rows=await stoppedCensus();stoppedActorAbsence(rows);const own=rows.find(row=>row.processId===process.pid);assert.ok(own?.commandLine&&own.executablePath);const writer={processId:own.processId,creationDate:own.creationDate,commandLine:own.commandLine,executablePath:own.executablePath};
  const initial=await stoppedPacketAndMetadata(binding.config,{objects});const epoch=randomUUID();const request={version:fixedStoppedNpmPreparation.version,at:new Date().toISOString(),epoch,nonce:randomUUID(),writer,adoptionSha256:binding.stateSha256,operatorSha256:adopted.manifest.files['tools/main-prebuild-queue.mjs'],metadataSha256:stoppedMetadataDigest(initial)};const observed=await stoppedIndependentObservation(request,out);
  const final=await stoppedPacketAndMetadata(binding.config,{objects});assert.equal(stoppedMetadataDigest(final),request.metadataSha256,'Native metadata changed during independent observation');await control.assertControlGeneration(binding);assert.ok(Date.now()-Date.parse(observed.observation.at)<60000,'Fresh observation expired before append');
  const value={version:fixedStoppedNpmPreparation.version,decision:fixedStoppedNpmPreparation.decision,at:new Date().toISOString(),epoch,dispatchId:fixedStoppedNpmPreparation.dispatchId,dispatchSha256:fixedStoppedNpmPreparation.dispatchSha256,requestId:fixedStoppedNpmPreparation.requestId,originalResultSha256:fixedStoppedNpmPreparation.resultSha256,nativePreparationStarted:true,npmChildStopped:true,functionalTestsExecuted:false,prepared:false,publicationPerformed:false,retryOriginal:false,sourceIdentity,adoptionSha256:binding.stateSha256,configSha256:binding.state.configSha256,originals:stoppedNpmPins,initial,final,evidenceDirectory:path.join(stoppedQueueRoot,'resolutions',fixedStoppedNpmPreparation.dispatchId+'-evidence'),observation:{requestSha256:sha(Buffer.from(canonical(observed.request))),observationSha256:sha(Buffer.from(canonical(observed.observation))),ackSha256:sha(Buffer.from(canonical(observed.ack)))}};
  for(const item of [observed.request,observed.observation,observed.ack]){const raw=Buffer.from(canonical(item));objects.set(sha(raw),raw);}await fs.mkdir(path.join(stoppedQueueRoot,'resolutions'),{recursive:true});await stoppedPutObjects(path.join(value.evidenceDirectory,'objects'),objects);await durableCreate(path.join(stoppedQueueRoot,'resolutions',fixedStoppedNpmPreparation.dispatchId+'.json'),value);
  await readStoppedNpmResolution();return {status:fixedStoppedNpmPreparation.decision,resolution:path.join(stoppedQueueRoot,'resolutions',fixedStoppedNpmPreparation.dispatchId+'.json'),prepared:false,retryOriginal:false,publicationPerformed:false};
 }finally{if(rotation)await rotation();await unlock();}
}
async function readStoppedNpmResolution(){
 const file=path.join(stoppedQueueRoot,'resolutions',fixedStoppedNpmPreparation.dispatchId+'.json');const read=await readQueueObject(file),v=read.value;assert.deepEqual(Object.keys(v).sort(),['version','decision','at','epoch','dispatchId','dispatchSha256','requestId','originalResultSha256','nativePreparationStarted','npmChildStopped','functionalTestsExecuted','prepared','publicationPerformed','retryOriginal','sourceIdentity','adoptionSha256','configSha256','originals','initial','final','evidenceDirectory','observation'].sort());stoppedFacts(v);assert.equal(v.dispatchId,fixedStoppedNpmPreparation.dispatchId);assert.equal(v.dispatchSha256,fixedStoppedNpmPreparation.dispatchSha256);assert.equal(v.requestId,fixedStoppedNpmPreparation.requestId);assert.equal(v.originalResultSha256,fixedStoppedNpmPreparation.resultSha256);assert.deepEqual(v.originals,stoppedNpmPins);assert.notEqual(v.sourceIdentity.commit,fixedStoppedNpmPreparation.target);assert.equal(v.sourceIdentity.status,'');
 assert.equal(path.resolve(v.evidenceDirectory),path.join(stoppedQueueRoot,'resolutions',fixedStoppedNpmPreparation.dispatchId+'-evidence'));const object=async digest=>{assert.match(digest??'',hex);const raw=await nativeRead(path.join(v.evidenceDirectory,'objects',digest+'.bin'));assert.equal(sha(raw),digest);return raw;};
 for(const [file,digest]of Object.entries(stoppedNpmPins)){await object(digest);if(file.startsWith(stoppedPacket+path.sep)||file.startsWith(stoppedQueueRoot+path.sep))assert.equal(sha(await nativeRead(file)),digest);}
 const adopted=JSON.parse(await object(v.adoptionSha256)),manifest=JSON.parse(await object(adopted.bundleManifestSha256)),next=JSON.parse(await object(v.configSha256)),old=JSON.parse(await object(fixedStoppedNpmPreparation.oldConfigSha256));const strip=x=>{const copy={...x};delete copy.nativeToolsSource;return copy;};assert.deepEqual(strip(next),strip(old));assert.equal(path.resolve(next.nativeToolsSource),path.resolve(fixedStoppedNpmPreparation.nativeToolsSource));assert.equal(adopted.status,'adopted');assert.equal(adopted.configSha256,v.configSha256);assert.equal(manifest.sourceCommit,v.sourceIdentity.commit);assert.equal(manifest.sourceTree,v.sourceIdentity.tree);assert.deepEqual(adopted.preparationTask,JSON.parse(await object(fixedStoppedNpmPreparation.oldInstallationSha256)).preparationTask);
 for(const [name,digest]of Object.entries(manifest.files))await object(digest);for(const digest of Object.values(stoppedNativeFiles))await object(digest);const intent=JSON.parse(await object(adopted.intentSha256)),transition=JSON.parse(await object(adopted.transitionProofSha256));assert.equal(intent.old.installation,fixedStoppedNpmPreparation.oldInstallationSha256);assert.equal(intent.old.config,fixedStoppedNpmPreparation.oldConfigSha256);assert.equal(intent.nativeToolsUpdateSha256,sha(await object(intent.nativeToolsUpdateSha256)));assert.equal(transition.productionDeploymentPerformed,false);assert.equal(transition.legacyWindowConverged,true);
 const request=JSON.parse(await object(v.observation.requestSha256)),observation=stoppedValidateObservation(JSON.parse(await object(v.observation.observationSha256)),request),ack=JSON.parse(await object(v.observation.ackSha256));assert.equal(request.metadataSha256,stoppedMetadataDigest(v.initial));assert.equal(request.metadataSha256,stoppedMetadataDigest(v.final));assert.deepEqual(Object.keys(ack).sort(),['at','requestSha256','observationSha256','writerPid'].sort());assert.equal(request.epoch,v.epoch);assert.equal(request.adoptionSha256,v.adoptionSha256);assert.equal(request.operatorSha256,manifest.files['tools/main-prebuild-queue.mjs']);assert.equal(ack.requestSha256,v.observation.requestSha256);assert.equal(ack.observationSha256,v.observation.observationSha256);assert.equal(ack.writerPid,request.writer.processId);assert.ok(Date.parse(v.at)>=Date.parse(ack.at)&&Date.parse(v.at)-Date.parse(observation.at)<60000);
 const dispatch=JSON.parse(await object(fixedStoppedNpmPreparation.dispatchSha256));for(const phase of [v.initial,v.final]){assert.deepEqual(phase.head,dispatch.selection.live.head);assert.equal(phase.chainStateSha256,dispatch.selection.live.chainStateSha256);assert.equal(phase.djangoManifestSha256,dispatch.selection.live.djangoManifestSha256);assert.deepEqual(phase.packetFiles,stoppedNames);assert.equal(phase.invocationsEmpty,true);for(const item of phase.metadata){const raw=await object(item.sha256);for(const marker of [fixedStoppedNpmPreparation.target,stoppedPacket])assert.equal(nativeNormalize(raw.toString('utf8')).includes(nativeNormalize(marker)),false);}}
 return true;
}
export async function readFixedStoppedNpmPreparationResolution(directory,dispatch,terminal){if(path.resolve(directory)!==stoppedQueueRoot||dispatch.dispatchId!==fixedStoppedNpmPreparation.dispatchId||terminal?.requestId!==fixedStoppedNpmPreparation.requestId||terminal.status!=='unknown')return false;try{await fs.lstat(path.join(stoppedQueueRoot,'resolutions',fixedStoppedNpmPreparation.dispatchId+'.json'));}catch(error){if(error.code==='ENOENT')return false;throw error;}return readStoppedNpmResolution();}
function assertFixedStoppedNpmNoReplay(directory,selection){if(path.resolve(directory)===stoppedQueueRoot){assert.notEqual(selection.targetCommit,fixedStoppedNpmPreparation.target,'The stopped a396 target must not be prepared again');assert.notEqual(path.resolve(selection.packet),stoppedPacket,'Stopped preparation packet cannot be reused');}}
if(process.argv[2]==='--observe-stopped-npm-f052'){
 const [{fileURLToPath}]=await Promise.all([import('node:url')]);assert.equal(path.resolve(process.argv[1]),fileURLToPath(import.meta.url));assert.equal(process.argv.length,5);const requestFile=path.resolve(process.argv[3]),output=path.resolve(process.argv[4]);await assertSchemaArtifactDirectory(path.dirname(requestFile));assert.equal(path.dirname(output),path.dirname(requestFile));const request=JSON.parse(await nativeRead(requestFile));const value=await observeFixedStoppedNpmPreparation(request);await durableCreate(output,value);const until=Date.now()+60000;for(;;){try{const ack=JSON.parse(await nativeRead(output+'.ack'));assert.equal(ack.requestSha256,sha(Buffer.from(canonical(request))));assert.equal(ack.observationSha256,sha(Buffer.from(canonical(value))));break;}catch(error){if(error.code!=='ENOENT')throw error;}assert.ok(Date.now()<until,'Observer acknowledgement timed out');await new Promise(resolve=>setTimeout(resolve,100));}
}
// FIXED_STOPPED_NPM_F052_END
