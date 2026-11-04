/** Exact prepared-packet loss. Queue results are immutable; these records only retire packets. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {canonical,sha,readQueueObject,durableCreate,readPreparationQueueStructure,validatePreparedTerminalNative,acquireQueueLock,acquireQueueSubmissionLock} from './main-prebuild-queue.mjs';

export const artifactLossProtocol='teruisi-prepared-artifact-loss-v1';
export const artifactLossManifestVersion='teruisi-prepared-artifact-loss-manifest-v1';
export const artifactLossRecordVersion='teruisi-prepared-artifact-loss-record-v1';
export const artifactLossResultVersion='teruisi-prepared-artifact-loss-result-v1';
export const artifactLossManifestName='PREPARED-ARTIFACT-LOSS.json';
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
export function assertArtifactLossBindings(manifest,directory,inventory){
 validateArtifactLossManifest(manifest);assert.equal(key(manifest.queueDirectory),key(directory),'Artifact loss queue changed');
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
    const terminal=inventory.terminals.get(ref.requestId);assert.equal(terminal?.status,'prepared','Artifact loss only retires complete prepared groups');
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
async function registryNames(directory,leaf){
 const root=path.join(directory,leaf);if(!await exists(root))return [];
 await assertArtifactDirectory(root);const names=await fs.readdir(root);
 assert.ok(names.length<=256&&names.every(name=>/^[a-f0-9]{64}\.json$/.test(name)),'Unknown or partial artifact loss record');return names.sort();
}
/** The bound copy lives outside the queue, in the adopted immutable control bundle. */
export async function readArtifactLossControlBinding(directory){
 const stateDirectory=path.dirname(path.resolve(directory)),stateFile=path.join(stateDirectory,'CONTROL-INSTALLATION.json');
 const records=[...await registryNames(directory,'artifact-losses'),...await registryNames(directory,'artifact-loss-results')];
 if(!await exists(stateFile)){assert.equal(records.length,0,'Artifact loss records lack an adopted control binding');return null;}
 const stateRaw=await readArtifactFile(stateFile),state=JSON.parse(stateRaw);
 if(!state.bundleRoot){assert.equal(records.length,0,'Artifact loss records lack an adopted control bundle');return null;}
 const root=state.bundleRoot;
 const raw=await readArtifactFile(path.join(root,'MANIFEST.json'));assert.equal(sha(raw),state.bundleManifestSha256,'Artifact loss control manifest changed');const manifest=JSON.parse(raw);
 if(!manifest.artifactLossManifestSha256){assert.equal(records.length,0,'Control generation would drop artifact loss retirement');return null;}
 assert.equal(state.status,'adopted','Artifact loss control is not adopted');assert.equal(key(root),key(path.join(stateDirectory,'control-bundles',state.bundleSha256)),'Artifact loss control bundle changed');
 assert.equal(manifest.preparedArtifactLossProtocol,artifactLossProtocol,'Control generation lacks artifact loss protocol');assert.equal(manifest.bundleSha256,state.bundleSha256);
 assert.match(manifest.files?.['tools/prepared-artifact-loss.mjs']??'',hex,'Artifact loss control closure absent');
 const intentRaw=await readArtifactFile(path.join(stateDirectory,'control-upgrades',state.installId,'INTENT.json'));assert.equal(sha(intentRaw),state.intentSha256,'Artifact loss control intent changed');const intent=JSON.parse(intentRaw);
 assert.equal(intent.bundleManifestSha256,state.bundleManifestSha256);assert.equal(intent.bundleSha256,state.bundleSha256);assert.equal(intent.artifactLossManifestSha256,manifest.artifactLossManifestSha256,'Artifact loss manifest is not bound by the control intent');
 const manifestFile=path.join(root,artifactLossManifestName),lossRaw=await readArtifactFile(manifestFile);assert.equal(sha(lossRaw),manifest.artifactLossManifestSha256,'Bound artifact loss manifest changed');
 const value=JSON.parse(lossRaw);assert.equal(lossRaw.toString(),canonical(value),'Artifact loss manifest is not canonical');validateArtifactLossManifest(value);assert.equal(key(value.queueDirectory),key(directory),'Bound artifact loss queue changed');
 return {manifestFile,manifestSha256:sha(lossRaw),manifest:value};
}
export async function readArtifactLossRegistry(directory,inventory,{allowIncomplete=false}={}){
 const binding=await readArtifactLossControlBinding(directory),records=new Map();if(!binding)return records;
 const manifest=assertArtifactLossBindings(binding.manifest,directory,inventory),expected=new Map(manifest.packets.map(packet=>[artifactLossPacketId(packet.packet)+'.json',packet]));
 const names=await registryNames(directory,'artifact-losses'),recordDigests={};
 for(const name of names){
  const packet=expected.get(name);assert.ok(packet,'Artifact loss record is outside the bound manifest');
  const read=await readQueueObject(path.join(directory,'artifact-losses',name)),value=read.value;
  fields(value,['version','manifestSha256','entrySha256','packet','selectedTarget','at','basis','consumePermitted'],'Artifact loss record');
  assert.equal(value.version,artifactLossRecordVersion);assert.equal(value.manifestSha256,binding.manifestSha256);assert.equal(value.entrySha256,sha(canonical(packet)),'Artifact loss packet binding changed');
  assert.equal(value.packet,packet.packet);assert.equal(value.selectedTarget,packet.selectedTarget);assert.equal(value.basis,'exact-packet-enoent-v1');assert.equal(value.consumePermitted,false);assert.ok(Number.isFinite(Date.parse(value.at)));
  const missing=await artifactPacketMissing(packet.packet);
  // Reappearance never restores consumption. It does restore every original native check.
  if(!missing)for(const dispatch of packet.dispatches)for(const ref of dispatch.tickets)await validatePreparedTerminalNative(inventory.terminals.get(ref.requestId),inventory.dispatches.find(read=>read.value.dispatchId===dispatch.dispatchId).value);
  records.set(key(packet.packet),{...read,missing});recordDigests[name]=read.sha256;
 }
 const resultNames=await registryNames(directory,'artifact-loss-results'),resultName=binding.manifestSha256+'.json';
 assert.ok(resultNames.every(name=>name===resultName),'Artifact loss result names another manifest');
 if(resultNames.length){
  const result=(await readQueueObject(path.join(directory,'artifact-loss-results',resultName))).value;
  fields(result,['version','manifestSha256','records','at','preparationPerformed','publicationPerformed'],'Artifact loss result');
  assert.equal(result.version,artifactLossResultVersion);assert.equal(result.manifestSha256,binding.manifestSha256);assert.equal(result.preparationPerformed,false);assert.equal(result.publicationPerformed,false);assert.ok(Number.isFinite(Date.parse(result.at)));
  assert.deepEqual(result.records,recordDigests,'Artifact loss record deleted or changed');assert.equal(names.length,expected.size,'Completed artifact loss group is incomplete');
 }else if(!allowIncomplete)assert.fail('Artifact loss retirement is incomplete; use only the exact loss retirement entry');
 if(!allowIncomplete)assert.equal(names.length,expected.size,'Bound artifact loss record is missing');
 return records;
}
/** No queue drain, fetch, source checkout, native preparation, task registration or wake. */
export async function retireLostPreparedArtifacts(directory,{assertGeneration,admit,withRotationLock,onStage=async()=>{}}={}){
 assert.equal(typeof assertGeneration,'function');assert.equal(typeof admit,'function');assert.equal(typeof withRotationLock,'function','Artifact loss requires the native rotation callback lock for the entire write window');
 const unlock=await acquireQueueLock(directory);assert.ok(unlock,'Queue busy; no artifact loss retirement');let unlockSubmission;
 try{
  await assertGeneration();await admit();unlockSubmission=await acquireQueueSubmissionLock(directory);assert.ok(unlockSubmission,'Queue submission busy; no artifact loss retirement');
  return await withRotationLock(async()=>{
  const binding=await readArtifactLossControlBinding(directory);assert.ok(binding,'No adopted artifact loss manifest');
  const fresh=async()=>{await assertGeneration();const inventory=await readPreparationQueueStructure(directory);const current=await readArtifactLossControlBinding(directory);assert.equal(current?.manifestSha256,binding.manifestSha256,'Artifact loss manifest changed during retirement');assertArtifactLossBindings(binding.manifest,directory,inventory);return {inventory,records:await readArtifactLossRegistry(directory,inventory,{allowIncomplete:true})};};
  let {records}=await fresh();const resultFile=path.join(directory,'artifact-loss-results',binding.manifestSha256+'.json');
  if(await exists(resultFile))return {status:'already-retired',manifestSha256:binding.manifestSha256,packets:records.size,preparationPerformed:false,publicationPerformed:false};
  // Verify every remaining packet before the first append. No partial tree is waived.
  for(const packet of binding.manifest.packets)if(!records.has(key(packet.packet)))assert.equal(await artifactPacketMissing(packet.packet),true,'Only exact whole-packet ENOENT can be retired');
  await onStage('before-records');await fs.mkdir(path.join(directory,'artifact-losses'),{recursive:true});
  for(const packet of binding.manifest.packets){
   ({records}=await fresh());if(records.has(key(packet.packet)))continue;
   assert.equal(await artifactPacketMissing(packet.packet),true,'Only exact whole-packet ENOENT can be retired');
   await durableCreate(path.join(directory,'artifact-losses',artifactLossPacketId(packet.packet)+'.json'),{version:artifactLossRecordVersion,manifestSha256:binding.manifestSha256,entrySha256:sha(canonical(packet)),packet:packet.packet,selectedTarget:packet.selectedTarget,at:new Date().toISOString(),basis:'exact-packet-enoent-v1',consumePermitted:false});await onStage('after-record');
  }
  ({records}=await fresh());assert.equal(records.size,binding.manifest.packets.length);await fs.mkdir(path.dirname(resultFile),{recursive:true});
  await onStage('before-result');await assertGeneration();
  await durableCreate(resultFile,{version:artifactLossResultVersion,manifestSha256:binding.manifestSha256,records:Object.fromEntries([...records.values()].map(read=>[artifactLossPacketId(read.value.packet)+'.json',read.sha256])),at:new Date().toISOString(),preparationPerformed:false,publicationPerformed:false});
  await readArtifactLossRegistry(directory,await readPreparationQueueStructure(directory));
  return {status:'retired',manifestSha256:binding.manifestSha256,packets:records.size,preparationPerformed:false,publicationPerformed:false};
  });
 }finally{try{await unlockSubmission?.();}finally{await unlock();}}
}
