/** Exact prepared-packet loss. Queue results are immutable; these records only retire packets. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {canonical,sha,readQueueObject,durableCreate,readPreparationQueueStructure,validatePreparedTerminalNative,validatePreparationTerminal,acquireQueueLock,acquireQueueSubmissionLock} from './main-prebuild-queue.mjs';

export const artifactLossProtocol='teruisi-prepared-artifact-loss-v1';
export const artifactLossManifestVersion='teruisi-prepared-artifact-loss-manifest-v1';
export const artifactLossRecordVersion='teruisi-prepared-artifact-loss-record-v1';
export const artifactLossResultVersion='teruisi-prepared-artifact-loss-result-v1';
export const artifactLossManifestName='PREPARED-ARTIFACT-LOSS.json';
// Append-only successors: the v1 root manifest and every v1 record/result stay byte-for-byte valid.
// A successor lists only newly lost packets and names the chain element it extends.
export const artifactLossSuccessorManifestVersion='teruisi-prepared-artifact-loss-manifest-v2';
export const artifactLossSuccessorFileName=digest=>'PREPARED-ARTIFACT-LOSS-'+digest+'.json';
const maxSuccessors=32,maxChainPackets=256,failureKinds=['native-preparation-failed','rejected-before-native'];
const hex=/^[a-f0-9]{64}$/,id=/^[a-f0-9-]{36}$/,commit=/^[a-f0-9]{40}$/;
const key=file=>path.resolve(file).toLowerCase();
export const artifactLossPacketId=packet=>sha(Buffer.from(key(packet)));
const fields=(value,names,label)=>assert.deepEqual(Object.keys(value??{}).sort(),[...names].sort(),label+' schema changed');
const exists=async file=>{try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};

/** Reject redirection at every existing ancestor; absence of an ancestor is not whole-packet ENOENT. */
export async function assertArtifactDirectory(directory){
 const absolute=path.resolve(directory),root=path.parse(absolute).root;let current=root;
 for(const part of absolute.slice(root.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);const stat=await fs.lstat(current);
  assert.ok(stat.isDirectory()&&!stat.isSymbolicLink(),'Redirected or non-directory artifact ancestor');
  assert.equal(key(await fs.realpath(current)),key(current),'Redirected artifact ancestor');
 }
}
export async function readArtifactFile(file){
 await assertArtifactDirectory(path.dirname(file));const before=await fs.lstat(file);
 assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1&&before.size<=4*1024*1024,'Unsafe artifact file');
 assert.equal(key(await fs.realpath(file)),key(file),'Redirected artifact file');const raw=await fs.readFile(file),after=await fs.lstat(file);
 for(const field of ['ino','dev','size','mtimeMs','ctimeMs','nlink'])assert.equal(after[field],before[field],'Artifact file changed while reading');
 return raw;
}
/** The sole absence exception is lstat of this exact packet after its parent was verified. */
export async function artifactPacketMissing(packet){
 await assertArtifactDirectory(path.dirname(packet));let stat;
 try{stat=await fs.lstat(packet);}catch(error){if(error.code==='ENOENT')return true;throw error;}
 assert.ok(stat.isDirectory()&&!stat.isSymbolicLink(),'Redirected or invalid prepared packet');
 assert.equal(key(await fs.realpath(packet)),key(packet),'Redirected prepared packet');return false;
}

/** Pure schema validation also supports auditing an independently generated, frozen manifest. */
export function validateArtifactLossManifest(value){
 fields(value,['version','queueDirectory','packets'],'Artifact loss manifest');assert.equal(value.version,artifactLossManifestVersion);
 assert.ok(typeof value.queueDirectory==='string'&&path.isAbsolute(value.queueDirectory));
 assert.ok(Array.isArray(value.packets)&&value.packets.length>0&&value.packets.length<=256,'Artifact loss manifest packet count invalid');
 const packets=new Set(),dispatches=new Set(),tickets=new Set();
 for(const packet of value.packets){
  fields(packet,['packet','selectedTarget','dispatches'],'Artifact loss packet');
  assert.ok(typeof packet.packet==='string'&&path.isAbsolute(packet.packet)&&commit.test(packet.selectedTarget));assert.ok(!packets.has(key(packet.packet)),'Duplicate loss packet');packets.add(key(packet.packet));
  assert.ok(Array.isArray(packet.dispatches)&&packet.dispatches.length>0&&packet.dispatches.length<=4096);
  for(const dispatch of packet.dispatches){
   fields(dispatch,['dispatchId','dispatchSha256','tickets'],'Artifact loss dispatch');assert.ok(id.test(dispatch.dispatchId)&&hex.test(dispatch.dispatchSha256)&&!dispatches.has(dispatch.dispatchId),'Invalid or duplicate loss dispatch');dispatches.add(dispatch.dispatchId);
   assert.ok(Array.isArray(dispatch.tickets)&&dispatch.tickets.length>0&&dispatch.tickets.length<4096);
   for(const ticket of dispatch.tickets){
    fields(ticket,['requestId','ticketSha256','resultSha256','preparationSha256'],'Artifact loss ticket');assert.ok(id.test(ticket.requestId)&&!tickets.has(ticket.requestId),'Invalid or duplicate loss ticket');tickets.add(ticket.requestId);
    for(const name of ['ticketSha256','resultSha256','preparationSha256'])assert.match(ticket[name]??'',hex);
   }
  }
 }
 return value;
}
/** Digest bound by a v2 failed ticket: the native result digest, or the digest of the pre-native rejection marker. */
export const artifactLossFailureDigest=failure=>failure.kind==='native-preparation-failed'?failure.resultSha256:sha(Buffer.from(canonical(failure)));
function validateSuccessorTicket(ticket){
 assert.ok(ticket&&typeof ticket==='object'&&!Array.isArray(ticket),'Artifact loss ticket must be an object');
 if(ticket.status==='prepared')fields(ticket,['requestId','ticketSha256','resultSha256','status','preparationSha256'],'Artifact loss prepared ticket');
 else if(ticket.status==='failed'){fields(ticket,['requestId','ticketSha256','resultSha256','status','failureKind','failureSha256'],'Artifact loss failed ticket');assert.ok(failureKinds.includes(ticket.failureKind),'Artifact loss failure kind invalid');assert.match(ticket.failureSha256??'',hex);}
 else assert.fail('Artifact loss ticket status must be prepared or failed');
 assert.ok(id.test(ticket.requestId),'Artifact loss ticket id invalid');
 for(const name of ['ticketSha256','resultSha256',...(ticket.status==='prepared'?['preparationSha256']:[])])assert.match(ticket[name]??'',hex);
}
/** v2 shape: only newly lost packets, bound to the chain element they extend; tickets are prepared or failed. */
export function validateArtifactLossSuccessorManifest(value){
 fields(value,['version','queueDirectory','predecessorManifestSha256','packets'],'Artifact loss successor manifest');assert.equal(value.version,artifactLossSuccessorManifestVersion);
 assert.ok(typeof value.queueDirectory==='string'&&path.isAbsolute(value.queueDirectory));assert.match(value.predecessorManifestSha256??'',hex);
 assert.ok(Array.isArray(value.packets)&&value.packets.length>0&&value.packets.length<=256,'Artifact loss manifest packet count invalid');
 const packets=new Set(),dispatches=new Set(),tickets=new Set();
 for(const packet of value.packets){
  fields(packet,['packet','selectedTarget','dispatches'],'Artifact loss packet');
  assert.ok(typeof packet.packet==='string'&&path.isAbsolute(packet.packet)&&commit.test(packet.selectedTarget));assert.ok(!packets.has(key(packet.packet)),'Duplicate loss packet');packets.add(key(packet.packet));
  assert.ok(Array.isArray(packet.dispatches)&&packet.dispatches.length>0&&packet.dispatches.length<=4096);
  for(const dispatch of packet.dispatches){
   fields(dispatch,['dispatchId','dispatchSha256','tickets'],'Artifact loss dispatch');assert.ok(id.test(dispatch.dispatchId)&&hex.test(dispatch.dispatchSha256)&&!dispatches.has(dispatch.dispatchId),'Invalid or duplicate loss dispatch');dispatches.add(dispatch.dispatchId);
   assert.ok(Array.isArray(dispatch.tickets)&&dispatch.tickets.length>0&&dispatch.tickets.length<4096);
   for(const ticket of dispatch.tickets){validateSuccessorTicket(ticket);assert.ok(!tickets.has(ticket.requestId),'Invalid or duplicate loss ticket');tickets.add(ticket.requestId);}
  }
 }
 return value;
}
export const validateAnyArtifactLossManifest=value=>value?.version===artifactLossSuccessorManifestVersion?validateArtifactLossSuccessorManifest(value):validateArtifactLossManifest(value);
/** Pure. elements: [{sha256, manifest}] with the v1 root first; every successor names the previous element and only adds new packets. */
export function validateArtifactLossChain(elements){
 assert.ok(Array.isArray(elements)&&elements.length>0&&elements.length<=maxSuccessors+1,'Artifact loss chain length invalid');
 const seen=new Set(),packets=new Set(),dispatches=new Set(),tickets=new Set();
 elements.forEach((element,index)=>{
  assert.match(element?.sha256??'',hex);assert.ok(!seen.has(element.sha256),'Duplicate artifact loss chain element');seen.add(element.sha256);
  assert.equal(sha(Buffer.from(canonical(element.manifest))),element.sha256,'Artifact loss chain element digest changed');
  if(index===0)validateArtifactLossManifest(element.manifest);
  else{
   validateArtifactLossSuccessorManifest(element.manifest);assert.equal(element.manifest.predecessorManifestSha256,elements[index-1].sha256,'Artifact loss successor names the wrong predecessor');
   assert.equal(key(element.manifest.queueDirectory),key(elements[0].manifest.queueDirectory),'Artifact loss successor queue changed');
  }
  for(const packet of element.manifest.packets){
   assert.ok(!packets.has(key(packet.packet)),'Artifact loss successor overlaps an earlier manifest');packets.add(key(packet.packet));
   for(const dispatch of packet.dispatches){
    assert.ok(!dispatches.has(dispatch.dispatchId),'Artifact loss successor overlaps an earlier manifest');dispatches.add(dispatch.dispatchId);
    for(const ticket of dispatch.tickets){assert.ok(!tickets.has(ticket.requestId),'Artifact loss successor overlaps an earlier manifest');tickets.add(ticket.requestId);}
   }
  }
 });
 assert.ok(packets.size<=maxChainPackets,'Artifact loss chain packet count exceeds the record bound');
 return elements;
}
export function assertArtifactLossBindings(manifest,directory,inventory){
 validateAnyArtifactLossManifest(manifest);const successor=manifest.version===artifactLossSuccessorManifestVersion;assert.equal(key(manifest.queueDirectory),key(directory),'Artifact loss queue changed');
 const tickets=new Map(inventory.tickets.map(read=>[read.value.requestId,read]));
 for(const packet of manifest.packets){
  const actual=inventory.dispatches.filter(read=>key(read.value.selection.packet)===key(packet.packet));
  assert.deepEqual(actual.map(read=>read.value.dispatchId).sort(),packet.dispatches.map(read=>read.dispatchId).sort(),'Artifact loss requires the complete packet dispatch group');
  const selection=actual[0]?.value.selection;
  for(const reference of packet.dispatches){
   const read=actual.find(read=>read.value.dispatchId===reference.dispatchId),dispatch=read.value;
   assert.equal(read.sha256,reference.dispatchSha256,'Artifact loss dispatch changed');assert.equal(dispatch.selection.packet,packet.packet);assert.equal(dispatch.selectedTarget,packet.selectedTarget);
   assert.equal(canonical(dispatch.selection),canonical(selection),'Shared loss packet selections differ');
   assert.deepEqual(dispatch.tickets.map(ref=>ref.requestId).sort(),reference.tickets.map(ref=>ref.requestId).sort(),'Artifact loss requires all dispatch tickets');
   for(const ref of reference.tickets){
    assert.equal(tickets.get(ref.requestId)?.sha256,ref.ticketSha256,'Artifact loss ticket changed');
    assert.equal(inventory.resultReads.get(ref.requestId)?.sha256,ref.resultSha256,'Artifact loss original result changed');
    const terminal=inventory.terminals.get(ref.requestId);
    if(successor){
     assert.ok(['prepared','failed'].includes(terminal?.status),'Artifact loss only retires complete prepared or failed groups');assert.equal(terminal.status,ref.status,'Artifact loss ticket status changed');
     assert.equal(terminal.dispatchId,dispatch.dispatchId);assert.equal(terminal.dispatchSha256,read.sha256);
     if(ref.status==='prepared')assert.equal(terminal.nativeResult.preparationSha256,ref.preparationSha256,'Artifact loss original native receipt binding changed');
     else{assert.ok(terminal.preparationTerminal!==undefined,'Artifact loss failed ticket lacks its structured failure');assert.equal(terminal.preparationTerminal.kind,ref.failureKind,'Artifact loss failure kind changed');assert.equal(artifactLossFailureDigest(terminal.preparationTerminal),ref.failureSha256,'Artifact loss native failure binding changed');}
     continue;
    }
    assert.equal(terminal?.status,'prepared','Artifact loss only retires complete prepared groups');
    assert.equal(terminal.dispatchId,dispatch.dispatchId);assert.equal(terminal.dispatchSha256,read.sha256);assert.equal(terminal.nativeResult.preparationSha256,ref.preparationSha256,'Artifact loss original native receipt binding changed');
   }
  }
 }
 return manifest;
}
export function makeArtifactLossManifest(directory,inventory,packets){
 const value={version:artifactLossManifestVersion,queueDirectory:path.resolve(directory),packets:packets.map(packet=>{
  const group=inventory.dispatches.filter(read=>key(read.value.selection.packet)===key(packet));assert.ok(group.length,'Loss packet has no dispatch');
  return {packet:group[0].value.selection.packet,selectedTarget:group[0].value.selectedTarget,dispatches:group.map(read=>({dispatchId:read.value.dispatchId,dispatchSha256:read.sha256,tickets:read.value.tickets.map(ref=>({requestId:ref.requestId,ticketSha256:ref.ticketSha256,resultSha256:inventory.resultReads.get(ref.requestId)?.sha256,preparationSha256:inventory.terminals.get(ref.requestId)?.nativeResult?.preparationSha256}))}))};
 })};return assertArtifactLossBindings(value,directory,inventory);
}
/** Successor manifest for newly lost packets; predecessorManifestSha256 is the current chain tip. */
export function makeArtifactLossSuccessorManifest(directory,inventory,packets,predecessorManifestSha256){
 const value={version:artifactLossSuccessorManifestVersion,queueDirectory:path.resolve(directory),predecessorManifestSha256,packets:packets.map(packet=>{
  const group=inventory.dispatches.filter(read=>key(read.value.selection.packet)===key(packet));assert.ok(group.length,'Loss packet has no dispatch');
  return {packet:group[0].value.selection.packet,selectedTarget:group[0].value.selectedTarget,dispatches:group.map(read=>({dispatchId:read.value.dispatchId,dispatchSha256:read.sha256,tickets:read.value.tickets.map(ref=>{
   const terminal=inventory.terminals.get(ref.requestId),base={requestId:ref.requestId,ticketSha256:ref.ticketSha256,resultSha256:inventory.resultReads.get(ref.requestId)?.sha256};
   if(terminal?.status==='prepared')return {...base,status:'prepared',preparationSha256:terminal.nativeResult.preparationSha256};
   if(terminal?.status==='failed'&&terminal.preparationTerminal!==undefined)return {...base,status:'failed',failureKind:terminal.preparationTerminal.kind,failureSha256:artifactLossFailureDigest(terminal.preparationTerminal)};
   return assert.fail('Artifact loss only retires complete prepared or failed groups');
  })}))};
 })};return assertArtifactLossBindings(value,directory,inventory);
}
async function registryNames(directory,leaf){
 const root=path.join(directory,leaf);if(!await exists(root))return [];
 await assertArtifactDirectory(root);const names=await fs.readdir(root);
 assert.ok(names.length<=256&&names.every(name=>/^[a-f0-9]{64}\.json$/.test(name)),'Unknown or partial artifact loss record');return names.sort();
}
/** The bound copies live outside the queue, in the adopted immutable control bundle. chain[0] is the v1 root; manifestSha256/manifest/manifestFile stay the root. */
export async function readArtifactLossControlBinding(directory){
 const stateDirectory=path.dirname(path.resolve(directory)),stateFile=path.join(stateDirectory,'CONTROL-INSTALLATION.json');
 const records=[...await registryNames(directory,'artifact-losses'),...await registryNames(directory,'artifact-loss-results')];
 if(!await exists(stateFile)){assert.equal(records.length,0,'Artifact loss records lack an adopted control binding');return null;}
 const stateRaw=await readArtifactFile(stateFile),state=JSON.parse(stateRaw);
 if(!state.bundleRoot){assert.equal(records.length,0,'Artifact loss records lack an adopted control bundle');return null;}
 const root=state.bundleRoot;
 const raw=await readArtifactFile(path.join(root,'MANIFEST.json'));assert.equal(sha(raw),state.bundleManifestSha256,'Artifact loss control manifest changed');const manifest=JSON.parse(raw);
 if(!manifest.artifactLossManifestSha256){assert.equal(records.length,0,'Control generation would drop artifact loss retirement');assert.equal(manifest.artifactLossSuccessorManifestSha256s,undefined,'Artifact loss successors require their root manifest');return null;}
 assert.equal(state.status,'adopted','Artifact loss control is not adopted');assert.equal(key(root),key(path.join(stateDirectory,'control-bundles',state.bundleSha256)),'Artifact loss control bundle changed');
 assert.equal(manifest.preparedArtifactLossProtocol,artifactLossProtocol,'Control generation lacks artifact loss protocol');assert.equal(manifest.bundleSha256,state.bundleSha256);
 assert.match(manifest.files?.['tools/prepared-artifact-loss.mjs']??'',hex,'Artifact loss control closure absent');
 const intentRaw=await readArtifactFile(path.join(stateDirectory,'control-upgrades',state.installId,'INTENT.json'));assert.equal(sha(intentRaw),state.intentSha256,'Artifact loss control intent changed');const intent=JSON.parse(intentRaw);
 assert.equal(intent.bundleManifestSha256,state.bundleManifestSha256);assert.equal(intent.bundleSha256,state.bundleSha256);assert.equal(intent.artifactLossManifestSha256,manifest.artifactLossManifestSha256,'Artifact loss manifest is not bound by the control intent');
 const successors=manifest.artifactLossSuccessorManifestSha256s;
 if(successors!==undefined)assert.ok(Array.isArray(successors)&&successors.length>0&&successors.length<=maxSuccessors&&successors.every(digest=>hex.test(digest)),'Artifact loss successor list invalid');
 assert.deepEqual(intent.artifactLossSuccessorManifestSha256s??[],successors??[],'Artifact loss successor manifests are not bound by the control intent');
 const manifestFile=path.join(root,artifactLossManifestName),lossRaw=await readArtifactFile(manifestFile);assert.equal(sha(lossRaw),manifest.artifactLossManifestSha256,'Bound artifact loss manifest changed');
 const value=JSON.parse(lossRaw);assert.equal(lossRaw.toString(),canonical(value),'Artifact loss manifest is not canonical');validateArtifactLossManifest(value);assert.equal(key(value.queueDirectory),key(directory),'Bound artifact loss queue changed');
 const chain=[{sha256:sha(lossRaw),manifest:value,file:manifestFile}];
 for(const digest of successors??[]){
  const file=path.join(root,artifactLossSuccessorFileName(digest)),successorRaw=await readArtifactFile(file);assert.equal(sha(successorRaw),digest,'Bound artifact loss successor changed');
  const successor=JSON.parse(successorRaw);assert.equal(successorRaw.toString(),canonical(successor),'Artifact loss successor is not canonical');assert.equal(key(successor.queueDirectory),key(directory),'Bound artifact loss queue changed');
  chain.push({sha256:digest,manifest:successor,file});
 }
 validateArtifactLossChain(chain);
 return {manifestFile,manifestSha256:sha(lossRaw),manifest:value,chain};
}
/** Reappearance never restores consumption, but it restores every original native check for both ticket kinds. */
async function assertReappearedPacketNative(packet,inventory){
 for(const dispatch of packet.dispatches)for(const ref of dispatch.tickets){
  const terminal=inventory.terminals.get(ref.requestId),original=inventory.dispatches.find(read=>read.value.dispatchId===dispatch.dispatchId).value;
  if(terminal.status==='failed')await validatePreparationTerminal(terminal.preparationTerminal,original);else await validatePreparedTerminalNative(terminal,original);
 }
}
export async function readArtifactLossRegistry(directory,inventory,{allowIncomplete=false}={}){
 const binding=await readArtifactLossControlBinding(directory),records=new Map();if(!binding)return records;
 const chain=binding.chain,expected=new Map();
 chain.forEach((element,index)=>{assertArtifactLossBindings(element.manifest,directory,inventory);for(const packet of element.manifest.packets)expected.set(artifactLossPacketId(packet.packet)+'.json',{packet,element,index});});
 const names=await registryNames(directory,'artifact-losses'),recordDigests=chain.map(()=>({})),counts=chain.map(()=>0);
 for(const name of names){
  const entry=expected.get(name);assert.ok(entry,'Artifact loss record is outside the bound manifest');const {packet,element,index}=entry;
  const read=await readQueueObject(path.join(directory,'artifact-losses',name)),value=read.value;
  fields(value,['version','manifestSha256','entrySha256','packet','selectedTarget','at','basis','consumePermitted'],'Artifact loss record');
  assert.equal(value.version,artifactLossRecordVersion);assert.equal(value.manifestSha256,element.sha256);assert.equal(value.entrySha256,sha(canonical(packet)),'Artifact loss packet binding changed');
  assert.equal(value.packet,packet.packet);assert.equal(value.selectedTarget,packet.selectedTarget);assert.equal(value.basis,'exact-packet-enoent-v1');assert.equal(value.consumePermitted,false);assert.ok(Number.isFinite(Date.parse(value.at)));
  const missing=await artifactPacketMissing(packet.packet);
  if(!missing)await assertReappearedPacketNative(packet,inventory);
  records.set(key(packet.packet),{...read,missing});recordDigests[index][name]=read.sha256;counts[index]++;
 }
 const resultNames=await registryNames(directory,'artifact-loss-results'),resultNameSet=new Set(resultNames);
 assert.ok(resultNames.every(name=>chain.some(element=>element.sha256+'.json'===name)),'Artifact loss result names another manifest');
 const done=chain.map(element=>resultNameSet.has(element.sha256+'.json'));let complete=0;while(complete<chain.length&&done[complete])complete++;
 assert.ok(!done.slice(complete).some(Boolean),'Artifact loss result exists without its predecessor result');
 for(let index=complete+1;index<chain.length;index++)assert.equal(counts[index],0,'Artifact loss successor records precede their predecessor result');
 for(let index=0;index<complete;index++){
  const element=chain[index],result=(await readQueueObject(path.join(directory,'artifact-loss-results',element.sha256+'.json'))).value;
  fields(result,['version','manifestSha256','records','at','preparationPerformed','publicationPerformed'],'Artifact loss result');
  assert.equal(result.version,artifactLossResultVersion);assert.equal(result.manifestSha256,element.sha256);assert.equal(result.preparationPerformed,false);assert.equal(result.publicationPerformed,false);assert.ok(Number.isFinite(Date.parse(result.at)));
  assert.deepEqual(result.records,recordDigests[index],'Artifact loss record deleted or changed');assert.equal(counts[index],element.manifest.packets.length,'Completed artifact loss group is incomplete');
 }
 if(complete<chain.length&&!allowIncomplete)assert.fail('Artifact loss retirement is incomplete; use only the exact loss retirement entry');
 if(!allowIncomplete)chain.forEach((element,index)=>assert.equal(counts[index],element.manifest.packets.length,'Bound artifact loss record is missing'));
 return records;
}
/** No queue drain, fetch, source checkout, native preparation, task registration or wake. Chain elements are retired strictly in order. */
export async function retireLostPreparedArtifacts(directory,{assertGeneration,admit,withRotationLock,onStage=async()=>{}}={}){
 assert.equal(typeof assertGeneration,'function');assert.equal(typeof admit,'function');assert.equal(typeof withRotationLock,'function','Artifact loss requires the native rotation callback lock for the entire write window');
 const unlock=await acquireQueueLock(directory);assert.ok(unlock,'Queue busy; no artifact loss retirement');let unlockSubmission;
 try{
  await assertGeneration();await admit();unlockSubmission=await acquireQueueSubmissionLock(directory);assert.ok(unlockSubmission,'Queue submission busy; no artifact loss retirement');
  return await withRotationLock(async()=>{
  const binding=await readArtifactLossControlBinding(directory);assert.ok(binding,'No adopted artifact loss manifest');
  const chain=binding.chain,chainDigests=chain.map(element=>element.sha256),resultFile=element=>path.join(directory,'artifact-loss-results',element.sha256+'.json');
  const fresh=async()=>{await assertGeneration();const inventory=await readPreparationQueueStructure(directory);const current=await readArtifactLossControlBinding(directory);assert.equal(current?.manifestSha256,binding.manifestSha256,'Artifact loss manifest changed during retirement');assert.deepEqual(current.chain.map(element=>element.sha256),chainDigests,'Artifact loss manifest chain changed during retirement');for(const element of chain)assertArtifactLossBindings(element.manifest,directory,inventory);return {inventory,records:await readArtifactLossRegistry(directory,inventory,{allowIncomplete:true})};};
  let {records}=await fresh();const incomplete=[];for(const element of chain)if(!await exists(resultFile(element)))incomplete.push(element);
  const summary=status=>({status,manifestSha256:binding.manifestSha256,successorManifestSha256s:chainDigests.slice(1),packets:records.size,preparationPerformed:false,publicationPerformed:false});
  if(!incomplete.length)return summary('already-retired');
  // Verify every remaining packet of every incomplete element before the first append. No partial tree is waived.
  for(const element of incomplete)for(const packet of element.manifest.packets)if(!records.has(key(packet.packet)))assert.equal(await artifactPacketMissing(packet.packet),true,'Only exact whole-packet ENOENT can be retired');
  for(const element of incomplete){
   const index=chain.indexOf(element);for(const earlier of chain.slice(0,index))assert.equal(await exists(resultFile(earlier)),true,'A successor is never recorded before its predecessor result');
   await onStage('before-records');await fs.mkdir(path.join(directory,'artifact-losses'),{recursive:true});
   for(const packet of element.manifest.packets){
    ({records}=await fresh());if(records.has(key(packet.packet)))continue;
    assert.equal(await artifactPacketMissing(packet.packet),true,'Only exact whole-packet ENOENT can be retired');
    await durableCreate(path.join(directory,'artifact-losses',artifactLossPacketId(packet.packet)+'.json'),{version:artifactLossRecordVersion,manifestSha256:element.sha256,entrySha256:sha(canonical(packet)),packet:packet.packet,selectedTarget:packet.selectedTarget,at:new Date().toISOString(),basis:'exact-packet-enoent-v1',consumePermitted:false});await onStage('after-record');
   }
   ({records}=await fresh());assert.ok(element.manifest.packets.every(packet=>records.has(key(packet.packet))),'Artifact loss records are incomplete');await fs.mkdir(path.dirname(resultFile(element)),{recursive:true});
   await onStage('before-result');await assertGeneration();
   await durableCreate(resultFile(element),{version:artifactLossResultVersion,manifestSha256:element.sha256,records:Object.fromEntries(element.manifest.packets.map(packet=>[artifactLossPacketId(packet.packet)+'.json',records.get(key(packet.packet)).sha256])),at:new Date().toISOString(),preparationPerformed:false,publicationPerformed:false});
   await readArtifactLossRegistry(directory,await readPreparationQueueStructure(directory),{allowIncomplete:element!==chain.at(-1)});
  }
  return summary('retired');
  });
 }finally{try{await unlockSubmission?.();}finally{await unlock();}}
}
