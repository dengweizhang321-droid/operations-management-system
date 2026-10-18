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
       if(!terminal||(!await readFixedAdminRejectionResolution(directory,dispatch,terminal)&&!await readFixedSchemaRejectionResolution(directory,dispatch,terminal)))unresolved={dispatch,sha256:read.sha256};
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
    try{await onStage('before-observe');selection=await observe();await onStage('after-observe');await admitSelectedPreparation(selection);}
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
