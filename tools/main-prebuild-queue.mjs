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
export async function drainPreparationQueue(directory,{configSha256,bundleSha256,observe,prepare,assertGeneration=async()=>{},afterUnlock=async()=>{},onStage=async()=>{},admitPreparation=async()=>{}}){
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
       if(!terminal||!await readFixedAdminRejectionResolution(directory,dispatch,terminal))unresolved={dispatch,sha256:read.sha256};
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
    try{await onStage('before-observe');selection=await observe();await onStage('after-observe');}
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
     deadlineUnixMs:Date.now()+30*60*1000,dispatchedAt:new Date().toISOString()};
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
