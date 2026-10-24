/** V2 preparation queue. A durable dispatch precedes every preparation effect. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {readPreparationResolution,resolutionForbidsTargetReplay} from './preparation-resolution.mjs';

const hex=/^[a-f0-9]{64}$/,id=/^[a-f0-9-]{36}$/,commit=/^[a-f0-9]{40}$/;
export const queueVersion='teruisi-main-prebuild-queue-v2';
// S05d: a preparation-stage outcome never blocks the queue forever. A known
// rejection is a dispatched 'failed' terminal bound to its evidence; an old
// preparation-stage unknown keeps its bytes and gets a separate abandonment
// record retiring its packet. Publication-stage evidence always keeps blocking.
export const abandonmentVersion='teruisi-preparation-abandonment-v1';
export const nativePreparationFailureVersion='teruisi-native-preparation-failure-v1';
export const publicationMarkers=['STARTED.json','SUCCESS.json','FAILED.json','WorkerApply-started.json','maintenance-first-FAILED.json'];
export const defaultAbandonmentGraceMs=15*60*1000;
// Publication-stage failure that provably changed nothing: the native publisher
// wrote STARTED/FAILED while entering maintenance, yet the live system is still
// exactly the packet's predecessor. The packet is retired (never resumed or
// re-run) and keeps every byte; the same target prepares in the next '-rN'.
export const publicationRetirementVersion='teruisi-publication-not-entered-v1';
export const notEnteredPhases=['进入维护'];
export const notEnteredRequiredMembers=['FAILED.json','STARTED.json','maintenance-admission.json','maintenance-first-FAILED.json'];
export const notEnteredEvidenceMembers=[...notEnteredRequiredMembers,'maintenance-first-actor.json','maintenance-first-request.json','进入维护-process.json','进入维护.stdout.log','进入维护.stderr.log'];
const notEnteredFixedMembers=new Set(['preparation','LEASE-WARNING.json',...notEnteredEvidenceMembers,'maintenance-lock-diagnostic.json','进入维护-started.json','进入维护.stdout.log','进入维护.stderr.log','进入维护-process.json']);
/** Only names a pre-mutation maintenance-entry failure can leave; anything else keeps blocking. */
export function isNotEnteredAttemptMember(name){return notEnteredFixedMembers.has(name)||/^(?:maintenance-preflight|publication-materials)-[A-Za-z0-9]{6}$/.test(name);}
const preparationTerminalKinds=['native-preparation-failed','rejected-before-native'],preparationAttemptMembers=['preparation','LEASE-WARNING.json'],maxPacketSlots=64;
const packetKey=packet=>path.resolve(packet).toLowerCase();
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
const optionalEntries=async(directory,leaf)=>{try{return await entries(directory,leaf);}catch(error){if(error.code==='ENOENT')return [];throw error;}};
/** Closed set of structured preparation terminals; extra keys or kinds fail closed. */
export async function validatePreparationTerminal(value,dispatch){
 assert.ok(value&&typeof value==='object'&&!Array.isArray(value),'Preparation terminal must be an object');
 assert.ok(preparationTerminalKinds.includes(value.kind),'Unknown preparation terminal kind');
 if(value.kind==='rejected-before-native'){assert.deepEqual(Object.keys(value).sort(),['kind','stage'],'Preparation terminal schema changed');assert.ok(typeof value.stage==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(value.stage),'Preparation rejection stage invalid');return value;}
 assert.deepEqual(Object.keys(value).sort(),['kind','phase','resultFile','resultSha256'],'Preparation terminal schema changed');
 assert.ok(typeof value.phase==='string'&&value.phase.length>0&&value.phase.length<=200,'Native failure phase invalid');
 assert.ok(typeof value.resultFile==='string'&&path.isAbsolute(value.resultFile)&&/^[a-f0-9-]{36}\.json$/.test(path.basename(value.resultFile)),'Native failure result path invalid');
 assert.equal(path.dirname(packetKey(value.resultFile)),packetKey(path.join(dispatch.selection.packet,'invocations')),'Native failure result is outside the dispatched packet');
 assert.ok(hex.test(value.resultSha256),'Native failure result digest invalid');
 const stat=await fs.lstat(value.resultFile);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=64*1024,'Unsafe native failure result');
 assert.equal(sha(await fs.readFile(value.resultFile)),value.resultSha256,'Native failure result changed');
 return value;
}
/** Read-only: names in the attempt directory besides preparation evidence are publication-stage markers. */
export async function inspectPreparationAttempt(dispatch){
 const attempt=path.join(dispatch.selection.packet,'publish-'+dispatch.selectedTarget.slice(0,12));let names;
 try{const stat=await fs.lstat(attempt);if(!stat.isDirectory()||stat.isSymbolicLink())return {markers:['<attempt-not-directory>'],preparedReceiptPresent:false};names=await fs.readdir(attempt);}
 catch(error){if(error.code==='ENOENT')return {markers:[],preparedReceiptPresent:false};throw error;}
 let preparedReceiptPresent=false;
 if(names.includes('preparation'))try{await fs.lstat(path.join(attempt,'preparation','PREPARED.json'));preparedReceiptPresent=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 return {markers:names.filter(name=>!preparationAttemptMembers.includes(name)).sort(),preparedReceiptPresent};
}
function validateAbandonment(value,name,dispatchRead,terminals){
 const dispatch=dispatchRead.value;
 assert.deepEqual(Object.keys(value).sort(),['at','basis','consumePermitted','dispatchId','dispatchSha256','originalResultSha256','packet','selectedTarget','version','winnerRequestId'],'Preparation abandonment schema changed');
 assert.equal(value.version,abandonmentVersion);assert.equal(value.dispatchId+'.json',name);assert.equal(value.dispatchId,dispatch.dispatchId);
 assert.equal(value.dispatchSha256,dispatchRead.sha256,'Abandoned dispatch changed');assert.equal(value.winnerRequestId,dispatch.requestId);
 assert.equal(value.selectedTarget,dispatch.selectedTarget);assert.equal(value.packet,dispatch.selection.packet);assert.equal(value.consumePermitted,false,'An abandoned packet is never consumed');
 const basis=value.basis;assert.ok(basis&&typeof basis==='object'&&!Array.isArray(basis));
 assert.deepEqual(Object.keys(basis).sort(),['deadlineUnixMs','graceMs','preparedReceiptPresent','publicationMarkersChecked','rotationLockFree'],'Preparation abandonment basis changed');
 assert.equal(basis.deadlineUnixMs,dispatch.deadlineUnixMs);assert.ok(Number.isSafeInteger(basis.graceMs)&&basis.graceMs>=0);
 assert.deepEqual(basis.publicationMarkersChecked,publicationMarkers);assert.equal(typeof basis.preparedReceiptPresent,'boolean');assert.equal(basis.rotationLockFree,true);
 const at=Date.parse(value.at);assert.ok(Number.isFinite(at)&&at>=dispatch.deadlineUnixMs+basis.graceMs,'Abandonment precedes its eligibility');
 for(const ref of dispatch.tickets){const terminal=terminals.get(ref.requestId);assert.ok(terminal&&terminal.status==='unknown'&&terminal.dispatchId===dispatch.dispatchId,'Only an all-unknown dispatch can be abandoned');}
 assert.equal(sha(Buffer.from(canonical(terminals.get(dispatch.requestId)))),value.originalResultSha256,'Abandoned unknown result changed');
}
/** Packets of failed-dispatched and abandoned dispatches are never prepared or consumed again. */
export function retiredPreparationPackets(inventory){
 const retired=new Set();
 for(const {value:dispatch} of inventory.dispatches){
  const failed=dispatch.tickets.some(ref=>{const terminal=inventory.terminals.get(ref.requestId);return terminal?.status==='failed'&&terminal.preparationTerminal!==undefined;});
  if(failed||inventory.abandonments?.has(dispatch.dispatchId)||inventory.publicationRetirements?.has(dispatch.dispatchId))retired.add(packetKey(dispatch.selection.packet));
 }
 return retired;
}
function validatePublicationRetirementShape(value){
 assert.deepEqual(Object.keys(value).sort(),['at','attempt','basis','consumePermitted','dispatchId','dispatchSha256','evidence','packet','reason','selectedTarget','version'],'Publication retirement schema changed');
 assert.equal(value.version,publicationRetirementVersion);assert.ok(id.test(value.dispatchId)&&hex.test(value.dispatchSha256)&&commit.test(value.selectedTarget));
 assert.equal(value.consumePermitted,false,'A retired publication packet is never consumed');assert.ok(Number.isFinite(Date.parse(value.at)));
 assert.ok(value.reason===null||(typeof value.reason==='string'&&value.reason.length<=1600),'Publication retirement reason invalid');
 assert.ok(typeof value.packet==='string'&&path.isAbsolute(value.packet)&&typeof value.attempt==='string'&&path.isAbsolute(value.attempt));
 assert.equal(packetKey(value.attempt),packetKey(path.join(value.packet,'publish-'+value.selectedTarget.slice(0,12))),'Publication retirement attempt is outside its packet');
 const evidence=value.evidence;assert.ok(evidence&&typeof evidence==='object'&&!Array.isArray(evidence));
 for(const name of notEnteredRequiredMembers)assert.ok(hex.test(evidence[name]??''),'Publication retirement lacks required evidence: '+name);
 for(const [name,digest] of Object.entries(evidence))assert.ok(notEnteredEvidenceMembers.includes(name)&&hex.test(digest),'Unknown publication retirement evidence');
 const basis=value.basis;assert.ok(basis&&typeof basis==='object'&&!Array.isArray(basis));
 assert.deepEqual(Object.keys(basis).sort(),['actorsExited','attemptMembers','chainStateSha256','djangoManifestSha256','healthReady','liveMainCommit','maintenanceId','maintenanceMarkersAbsent','phase','rotationLockFree','workerBindingSha256'],'Publication retirement basis changed');
 assert.ok(notEnteredPhases.includes(basis.phase)&&/^[a-f0-9]{32}$/.test(basis.maintenanceId)&&commit.test(basis.liveMainCommit));
 assert.ok(hex.test(basis.chainStateSha256)&&hex.test(basis.djangoManifestSha256)&&hex.test(basis.workerBindingSha256));
 for(const flag of ['actorsExited','healthReady','maintenanceMarkersAbsent','rotationLockFree'])assert.equal(basis[flag],true,'Publication retirement basis is not proven: '+flag);
 assert.ok(Array.isArray(basis.attemptMembers)&&basis.attemptMembers.every(isNotEnteredAttemptMember)&&JSON.stringify(basis.attemptMembers)===JSON.stringify([...basis.attemptMembers].sort()));
 assert.ok(!basis.attemptMembers.includes('SUCCESS.json'));for(const name of notEnteredRequiredMembers)assert.ok(basis.attemptMembers.includes(name));
}
async function validatePublicationRetirement(value,name,dispatchRead,terminals){
 validatePublicationRetirementShape(value);
 const dispatch=dispatchRead.value;
 assert.equal(value.dispatchId+'.json',name);assert.equal(value.dispatchId,dispatch.dispatchId);assert.equal(value.dispatchSha256,dispatchRead.sha256,'Retired publication dispatch changed');
 assert.equal(value.selectedTarget,dispatch.selectedTarget);assert.equal(packetKey(value.packet),packetKey(dispatch.selection.packet));
 assert.equal(terminals.get(dispatch.requestId)?.status,'prepared','Only a prepared packet can be retired after publication');
 assert.equal(value.basis.liveMainCommit,dispatch.selection.live.mainCommit,'Retired publication predecessor differs from its preparation');
 assert.equal(value.basis.workerBindingSha256,dispatch.selection.live.head.bindingSha256);assert.equal(value.basis.djangoManifestSha256,dispatch.selection.live.djangoManifestSha256);
 assert.equal(value.basis.chainStateSha256,dispatch.selection.live.chainStateSha256);
 // Queue-internal bindings only: reading the inventory never touches packet files.
}
/** Write-time only: the packet's original publication evidence is intact and has no success record. */
async function assertPublicationEvidenceIntact(value){
 for(const [member,digest] of Object.entries(value.evidence))assert.equal(sha(await fs.readFile(path.join(value.attempt,member))),digest,'Retired publication evidence changed: '+member);
 assert.equal(await fs.access(path.join(value.attempt,'SUCCESS.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}),false,'A retired publication gained a success record');
}
/** Under the queue lock: append one not-entered retirement; the caller proved the live system unchanged. */
export async function writePublicationRetirement(directory,record){
 validatePublicationRetirementShape(record);
 const inventory=await readPreparationQueueInventory(directory);
 const dispatchRead=inventory.dispatches.find(read=>read.value.dispatchId===record.dispatchId);assert.ok(dispatchRead,'Publication retirement names no dispatch');
 assert.ok(!inventory.publicationRetirements.has(record.dispatchId),'Publication already retired');
 await validatePublicationRetirement(record,record.dispatchId+'.json',dispatchRead,inventory.terminals);
 await assertPublicationEvidenceIntact(record);
 await fs.mkdir(path.join(directory,'publication-retired'),{recursive:true});
 const digest=await durableCreate(path.join(directory,'publication-retired',record.dispatchId+'.json'),record);
 const after=await readPreparationQueueInventory(directory);assert.ok(after.publicationRetirements.has(record.dispatchId));
 return {file:path.join(directory,'publication-retired',record.dispatchId+'.json'),sha256:digest};
}
/** The earliest dispatch whose prepared terminal produced this packet; several are accepted only when their selections are identical, else null. */
export function preparedDispatchForPacket(inventory,packet){
 const found=inventory.dispatches.filter(read=>packetKey(read.value.selection.packet)===packetKey(packet)&&inventory.terminals.get(read.value.requestId)?.status==='prepared');
 if(!found.length)return null;
 const selection=canonical(found[0].value.selection);if(found.some(read=>canonical(read.value.selection)!==selection))return null;
 return [...found].sort((x,y)=>(Date.parse(x.value.dispatchedAt)-Date.parse(y.value.dispatchedAt))||(x.value.dispatchId<y.value.dispatchId?-1:x.value.dispatchId>y.value.dispatchId?1:0))[0];
}
export function isRetiredPacket(retired,packet){return Boolean(retired?.has(packetKey(packet)));}
/** '<target12>-<binding8>-<django8>' unless retired, then '-r2'...'-r64'. */
export function preparationPacketSlot(releaseDirectory,base,retired=new Set()){
 assert.match(base,/^[a-f0-9]{12}-[a-f0-9]{8}-[a-f0-9]{8}$/,'Packet base invalid');assert.ok(path.isAbsolute(releaseDirectory),'Absolute release directory required');
 for(let slot=1;slot<=maxPacketSlots;slot++){const packet=path.join(releaseDirectory,slot===1?base:base+'-r'+slot);if(!isRetiredPacket(retired,packet))return packet;}
 throw Error('同一目标与前驱的准备包已退役 '+maxPacketSlots+' 次，请人工核查；本次未准备');
}
/** The packet must be the base slot or a later '-rN' slot of the same base, directly under releaseDirectory. */
export function assertPreparationPacket(releaseDirectory,base,packet){
 assert.equal(packetKey(path.dirname(path.resolve(packet))),packetKey(releaseDirectory),'Frozen packet changed');
 const match=/^([a-f0-9]{12}-[a-f0-9]{8}-[a-f0-9]{8})(?:-r([1-9][0-9]?))?$/.exec(path.basename(path.resolve(packet)));
 assert.ok(match&&match[1]===base&&(match[2]===undefined||(Number(match[2])>=2&&Number(match[2])<=maxPacketSlots)),'Frozen packet changed');
 return path.basename(path.resolve(packet));
}
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
  const incompatibleBlocked=value.status==='blocked'&&value.admission==='incompatible-generation-before-dispatch-v1';
  const dispatchedFailed=value.status==='failed'&&Object.hasOwn(value,'dispatchId');
  const extra=incompatibleBlocked?['admission','rejectedBy','error']:admissionBlocked?['admission','error']:value.status==='blocked'?['blockedDispatchId','blockedDispatchSha256','error']:dispatchedFailed?[...refs,'error','preparationTerminal']:value.status==='failed'?['error']:value.status==='unknown'?[...refs,'error']:value.status==='superseded'?refs:[...refs,'nativeResult'];
  assert.deepEqual(Object.keys(value).sort(),[...base,...extra].sort(),'Queue terminal schema is incomplete or changed');
  assert.ok(hex.test(value.configSha256)&&hex.test(value.bundleSha256)&&Number.isFinite(Date.parse(value.at)));
  const ticket=await readQueueObject(path.join(directory,'tickets',requestId+'.json'));validateTicket(ticket.value,requestId+'.json');
  assert.equal(ticket.sha256,ticketSha256);assert.equal(ticket.value.configSha256,value.configSha256);assert.equal(ticket.value.bundleSha256,value.bundleSha256);
  if(value.status==='failed'&&!dispatchedFailed){assert.equal(typeof value.error,'string');return value;}
  if(admissionBlocked||incompatibleBlocked){
   assert.equal(typeof value.error,'string');
   if(incompatibleBlocked){assert.deepEqual(Object.keys(value.rejectedBy).sort(),['bundleSha256','configSha256']);assert.ok(hex.test(value.rejectedBy.configSha256)&&hex.test(value.rejectedBy.bundleSha256));assert.ok(value.rejectedBy.configSha256!==value.configSha256||value.rejectedBy.bundleSha256!==value.bundleSha256,'Generation rejection must identify a different consumer generation');}
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
  if(dispatchedFailed){assert.equal(typeof value.error,'string');await validatePreparationTerminal(value.preparationTerminal,dispatch);return value;}
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
/** Validate the entire queue before a consumer appends any terminal result. */
export async function readPreparationQueueInventory(directory){
 const tickets=await allTickets(directory),byId=new Map(tickets.map(item=>[item.value.requestId,item])),dispatches=[],referenced=new Set(),terminals=new Map();
 for(const name of await entries(directory,'dispatches')){const read=await readQueueObject(path.join(directory,'dispatches',name));validateDispatch(read.value,name);for(const ref of read.value.tickets){const item=byId.get(ref.requestId);assert.ok(item&&item.sha256===ref.ticketSha256,'Dispatch ticket binding changed');assert.equal(ref.observedTarget,item.value.observedTarget,'Dispatch observed target changed');assert.equal(read.value.configSha256,item.value.configSha256,'Dispatch ticket configuration differs');assert.equal(read.value.bundleSha256,item.value.bundleSha256,'Dispatch ticket code generation differs');referenced.add(ref.requestId);}dispatches.push(read);}
 for(const name of await entries(directory,'results')){const requestId=name.slice(0,-5),item=byId.get(requestId);assert.ok(item,'Orphan queue terminal');const terminal=await ticketResult(directory,requestId,item.sha256);assert.ok(terminal);terminals.set(requestId,terminal);}
 const abandonments=new Map();
 for(const name of await optionalEntries(directory,'abandoned')){const dispatch=dispatches.find(read=>read.value.dispatchId+'.json'===name);assert.ok(dispatch,'Orphan preparation abandonment');const read=await readQueueObject(path.join(directory,'abandoned',name));validateAbandonment(read.value,name,dispatch,terminals);abandonments.set(read.value.dispatchId,{...read,name});}
 const publicationRetirements=new Map();
 for(const name of await optionalEntries(directory,'publication-retired')){const dispatch=dispatches.find(read=>read.value.dispatchId+'.json'===name);assert.ok(dispatch,'Orphan publication retirement');const read=await readQueueObject(path.join(directory,'publication-retired',name));await validatePublicationRetirement(read.value,name,dispatch,terminals);publicationRetirements.set(read.value.dispatchId,{...read,name});}
 return {tickets,dispatches,referenced,terminals,abandonments,publicationRetirements};
}
/** observe may fetch/read only. prepare receives its exact frozen selection. */
export async function drainPreparationQueue(directory,{configSha256,bundleSha256,observe,prepare,assertGeneration=async()=>{},afterUnlock=async()=>{},onStage=async()=>{},admitPreparation=async()=>{},admitSelectedPreparation=async()=>{},retirementScope,invalidateRetirementScope,abandonment}){
 assert.ok(hex.test(configSha256)&&hex.test(bundleSha256));if(retirementScope!==undefined)assert.equal(typeof invalidateRetirementScope,'function','A retirement scope requires an explicit invalidation callback');invalidateRetirementScope??=async()=>{};
 // Abandonment is evaluated only when the consumer passes it explicitly.
 if(abandonment!==undefined)assert.ok(abandonment&&typeof abandonment.probeRotationLock==='function','Abandonment requires an explicit rotation lock probe');
 const graceMs=abandonment?.graceMs??defaultAbandonmentGraceMs,inspectAttempt=abandonment?.inspectAttempt??inspectPreparationAttempt,now=abandonment?.now??Date.now;assert.ok(Number.isSafeInteger(graceMs)&&graceMs>=0,'Abandonment grace invalid');
 await invalidateRetirementScope('queue-initialize');await initializeQueue(directory);let handled=0,firstIteration=true;
 for(;;){
  const unlock=await acquireQueueLock(directory);if(!unlock)return {status:'queued',handled};
  try{
   for(;;){
    if(!firstIteration)await invalidateRetirementScope('queue-next-target');firstIteration=false;
    const inventory=await readPreparationQueueInventory(directory),tickets=inventory.tickets,pending=[],completed=[];
    for(const item of tickets){
     const terminal=inventory.terminals.get(item.value.requestId);
     if(!terminal)pending.push(item);else if(terminal.status==='prepared')completed.push(terminal);
    }
    if(!pending.length)break;
    await assertGeneration();
    const incompatible=pending.filter(item=>item.value.configSha256!==configSha256||item.value.bundleSha256!==bundleSha256);
    for(const item of incompatible)assert.equal(inventory.referenced.has(item.value.requestId),false,'A dispatched incompatible ticket must retain its original operation');
    if(incompatible.length){await assertGeneration();await invalidateRetirementScope('incompatible-result-write');for(const item of incompatible){await durableCreate(path.join(directory,'results',item.value.requestId+'.json'),{version:queueVersion,requestId:item.value.requestId,ticketSha256:item.sha256,status:'blocked',admission:'incompatible-generation-before-dispatch-v1',at:new Date().toISOString(),configSha256:item.value.configSha256,bundleSha256:item.value.bundleSha256,rejectedBy:{configSha256,bundleSha256},error:'Incompatible control generation before dispatch; original ticket retained'});handled++;}continue;}
    // Any dispatched operation lacking all terminal receipts blocks new work.
    // Partial/invalid dispatch files block too; they are never treated as absent.
    let unresolved=null;
    const resolvedDispatches=new Map(),unresolvedDispatches=new Map();
    for(const name of await entries(directory,'dispatches')){
     const read=await readQueueObject(path.join(directory,'dispatches',name)),dispatch=read.value;
     validateDispatch(dispatch,name);
     for(const ref of dispatch.tickets){
      assert.ok(id.test(ref.requestId)&&hex.test(ref.ticketSha256));
      const original=tickets.find(t=>t.value.requestId===ref.requestId);assert.ok(original&&original.sha256===ref.ticketSha256,'Dispatch ticket binding changed');
      const terminal=await ticketResult(directory,ref.requestId,ref.ticketSha256);
      // Structured preparation failures and abandoned preparation unknowns
      // retire their packet instead of blocking every later preparation.
      if(terminal?.status==='failed'&&terminal.preparationTerminal!==undefined)continue;
      if(terminal?.status==='unknown'&&inventory.abandonments.has(dispatch.dispatchId))continue;
      if(!terminal||['unknown','failed','blocked'].includes(terminal.status)){
       if(!resolvedDispatches.has(dispatch.dispatchId))resolvedDispatches.set(dispatch.dispatchId,!!terminal&&await readPreparationResolution(directory,dispatch,inventory.terminals.get(dispatch.requestId),{retirementScope}));
       if(!terminal||!resolvedDispatches.get(dispatch.dispatchId)){unresolved={dispatch,sha256:read.sha256};unresolvedDispatches.set(dispatch.dispatchId,unresolved);}
      }
     }
    }
    const finish=async(item,status,fields={})=>{
     await invalidateRetirementScope('queue-terminal-write');
     await durableCreate(path.join(directory,'results',item.value.requestId+'.json'),{version:queueVersion,requestId:item.value.requestId,ticketSha256:item.sha256,status,at:new Date().toISOString(),configSha256,bundleSha256,...fields});handled++;
    };
    // The irreversible abandonment write needs the same ordinary-user consumer
    // admission as a preparation; a rejected host leaves the dispatch blocking.
    let abandonmentAdmitted=false;
    if(unresolved&&abandonment){try{await admitPreparation();abandonmentAdmitted=true;}catch{abandonmentAdmitted=false;}}
    if(unresolved&&abandonmentAdmitted){
     // Fail closed: all tickets unknown and unresolved, past deadline+grace, no
     // publication-stage marker, and the native rotation lock is free.
     let abandoned=0;
     for(const {dispatch,sha256} of unresolvedDispatches.values()){
      if(!dispatch.tickets.every(ref=>{const terminal=inventory.terminals.get(ref.requestId);return terminal?.status==='unknown'&&terminal.dispatchId===dispatch.dispatchId;}))continue;
      if(resolvedDispatches.get(dispatch.dispatchId)||now()<dispatch.deadlineUnixMs+graceMs)continue;
      let attempt;try{attempt=await inspectAttempt(dispatch);}catch{continue;}
      if(!attempt||!Array.isArray(attempt.markers)||attempt.markers.length||typeof attempt.preparedReceiptPresent!=='boolean')continue;
      let free=false;try{free=await abandonment.probeRotationLock()===true;}catch{free=false;}if(!free)continue;
      await invalidateRetirementScope('queue-abandonment-write');await fs.mkdir(path.join(directory,'abandoned'),{recursive:true});
      await durableCreate(path.join(directory,'abandoned',dispatch.dispatchId+'.json'),{version:abandonmentVersion,dispatchId:dispatch.dispatchId,dispatchSha256:sha256,winnerRequestId:dispatch.requestId,selectedTarget:dispatch.selectedTarget,packet:dispatch.selection.packet,
       originalResultSha256:sha(Buffer.from(canonical(inventory.terminals.get(dispatch.requestId)))),at:new Date(now()).toISOString(),
       basis:{deadlineUnixMs:dispatch.deadlineUnixMs,graceMs,publicationMarkersChecked:publicationMarkers,preparedReceiptPresent:attempt.preparedReceiptPresent,rotationLockFree:true},consumePermitted:false});
      abandoned++;
     }
     if(abandoned)continue;
    }
    if(unresolved){
     for(const item of pending)await finish(item,'blocked',{blockedDispatchId:unresolved.dispatch.dispatchId,blockedDispatchSha256:unresolved.sha256,error:'Prior dispatch lacks a complete terminal result; no preparation replay'});
     break;
    }
    try{await admitPreparation();}
    catch(error){for(const item of pending)await finish(item,'blocked',{admission:'ordinary-user-before-dispatch-v1',error:String(error.message)});break;}
    let selection;
    const retiredPackets=retiredPreparationPackets(inventory);
    try{await onStage('before-observe');selection=await observe({retiredPackets});await onStage('after-observe');assert.ok(!(typeof selection?.packet==='string'&&isRetiredPacket(retiredPackets,selection.packet)),'Frozen packet is retired; it is never prepared or consumed again');await admitSelectedPreparation(selection);for(const prior of inventory.dispatches){if(resolvedDispatches.get(prior.value.dispatchId)&&resolutionForbidsTargetReplay(prior.value.dispatchId))assert.notEqual(selection.targetCommit,prior.value.selectedTarget,'Resolved original target cannot be replayed');}}
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
    await onStage('before-dispatch');await invalidateRetirementScope('queue-dispatch-write');
    const dispatchSha256=await durableCreate(path.join(directory,'dispatches',dispatchId+'.json'),dispatch);
    await onStage('after-dispatch');
    let result,error=null;
    try{await onStage('before-prepare');await invalidateRetirementScope('queue-native-prepare');result=await prepare(selection,dispatch,reusablePreparation);await onStage('after-prepare');
     assert.equal(result.mainCommit??result.targetCommit,selection.targetCommit,'Preparation result target changed');
     assert.equal(result.publicationPerformed,false,'Queue cannot deploy');
     assert.ok(['prepared-only','already-current','non-production'].includes(result.status),'Native preparation did not complete');
    }catch(failure){error=failure;}
    // A structured preparation terminal becomes a dispatched 'failed' only when
    // its shape and evidence validate and no publication-stage marker exists.
    let preparationTerminal=null;
    if(error&&error.preparationTerminal!==undefined){
     try{await validatePreparationTerminal(error.preparationTerminal,dispatch);const attempt=await inspectAttempt(dispatch);if(Array.isArray(attempt?.markers)&&attempt.markers.length===0)preparationTerminal=JSON.parse(JSON.stringify(error.preparationTerminal));}catch{preparationTerminal=null;}
    }
    // Never claim the target read before fetch is prepared when fetch selected
    // another commit. Manual latest requests with null target bind selection.
    for(const item of pending){
     const reference={dispatchId,dispatchSha256,selectedTarget:selection.targetCommit,winnerRequestId:winner.value.requestId};
     if(error&&preparationTerminal)await finish(item,'failed',{...reference,error:String(error.message),preparationTerminal});
     else if(error)await finish(item,'unknown',{...reference,error:String(error.message)});
     else if(item.value.observedTarget&&item.value.observedTarget!==selection.targetCommit)await finish(item,'superseded',reference);
     else await finish(item,result.status==='prepared-only'?'prepared':result.status==='already-current'?'current':'non-production',{...reference,nativeResult:result});
    }
   }
  }finally{try{await invalidateRetirementScope('queue-unlock');}finally{await unlock();}}
  await afterUnlock();
  const remaining=await allTickets(directory);let more=false;
  for(const item of remaining)if(!await ticketResult(directory,item.value.requestId,item.sha256)){more=true;break;}
  if(!more)return {status:'drained',handled};
 }
}
