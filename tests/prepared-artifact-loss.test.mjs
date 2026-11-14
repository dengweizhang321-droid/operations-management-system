import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {submitPreparation,drainPreparationQueue,readPreparationQueueInventory,readPreparationQueueStructure,durableCreate,sha,queueVersion,canonical,retiredPreparationPackets,isRetiredPacket,preparationPacketSlot,acquireQueueLock,ticketResult,writePublicationRetirement,publicationRetirementVersion,notEnteredRequiredMembers} from '../tools/main-prebuild-queue.mjs';
import {artifactLossProtocol,artifactLossManifestName,artifactLossPacketId,makeArtifactLossManifest,validateArtifactLossManifest,readArtifactLossControlBinding,retireLostPreparedArtifacts,makeArtifactLossSuccessorManifest,validateArtifactLossSuccessorManifest,validateArtifactLossChain,readArtifactLossRegistry,assertArtifactLossBindings,artifactLossSuccessorFileName,artifactLossSuccessorManifestVersion,artifactLossRecordVersion} from '../tools/prepared-artifact-loss.mjs';
import {collectArtifactLossSuccessor} from '../tools/collect-artifact-loss-successor.mjs';
import {artifactLossUpgradeMaterial,controlFiles,prepareControlUpgrade,readControlUpgradeMaterials} from '../tools/install-main-prebuild.mjs';
import {prepareLatestMainOnce,inspectMainPreparation,deployReadyMain,readRetiredPackets,runLatestMainCli} from '../tools/publish-latest-main.mjs';
import producerQualification from '../tools/preparation-producer-qualification.mjs';
import {salesPreflightSchema,salesPreflightMigration,assertMainSchemaPlanSupported} from '../tools/main-schema-release.mjs';
const generation={configSha256:'1'.repeat(64),bundleSha256:'2'.repeat(64)},target='a'.repeat(40);

/** Synthetic control anchor only: never registers a Task or calls the installer/adopter. */
async function fixture(t,{groups=1,dispatches=1,tickets=1,pending=false}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'prepared-artifact-loss-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:50}));
 const queue=path.join(root,'prebuild-queue-v2'),releases=path.join(root,'packets');await fs.mkdir(releases);const packets=[],originals=new Map();
 for(let p=0;p<groups;p++){
  const packet=path.join(releases,p===0?'aaaaaaaaaaaa-55555555-66666666':'aaaaaaaaaaaa-55555555-66666666-r'+(p+1));packets.push(packet);
  const live={mainCommit:'b'.repeat(40),head:{bindingSha256:'5'.repeat(64)},djangoManifestSha256:'6'.repeat(64),chainStateSha256:'7'.repeat(64)};
  const request={mainCommit:target,predecessorWorker:live.head,predecessorDjangoSha256:live.djangoManifestSha256,components:['worker','django']};
  const native={version:'teruisi-main-preparation-v1',requestSha256:sha(JSON.stringify(request)),sourceIdentity:{commit:target},workerPlan:{private:true},djangoPackage:{private:true}};
  const preparationFile=path.join(packet,'publish-'+target.slice(0,12),'preparation/PREPARED.json'),nativeRaw=Buffer.from(JSON.stringify(native)+'\n');
  await fs.mkdir(path.dirname(preparationFile),{recursive:true});await fs.writeFile(preparationFile,nativeRaw);await fs.writeFile(path.join(packet,'main-release-request.json'),JSON.stringify(request));
  for(let d=0;d<dispatches;d++){
   const submitted=[];for(let n=0;n<tickets;n++)submitted.push(await submitPreparation(queue,{...generation,origin:'manual'}));const winner=submitted.at(-1),dispatchId=randomUUID();
   const dispatch={version:queueVersion,dispatchId,requestId:winner.requestId,mode:'prepare-only',...generation,selectedTarget:target,selection:{targetCommit:target,packet,live},deadlineUnixMs:Date.now()-3600000,dispatchedAt:new Date().toISOString(),tickets:submitted.map(ticket=>({requestId:ticket.requestId,ticketSha256:ticket.ticketSha256,observedTarget:null}))};
   const dispatchSha256=await durableCreate(path.join(queue,'dispatches',dispatchId+'.json'),dispatch);
   for(const ticket of submitted)await durableCreate(path.join(queue,'results',ticket.requestId+'.json'),{version:queueVersion,requestId:ticket.requestId,ticketSha256:ticket.ticketSha256,status:'prepared',at:new Date().toISOString(),...generation,dispatchId,dispatchSha256,selectedTarget:target,winnerRequestId:winner.requestId,nativeResult:{status:'prepared-only',mainCommit:target,publicationPerformed:false,preparationFile,preparationSha256:sha(nativeRaw)}});
  }
  originals.set(packet,{request,native,nativeRaw,preparationFile});
 }
 if(pending)await submitPreparation(queue,{...generation,origin:'manual'});
 const structure=await readPreparationQueueStructure(queue),manifest=makeArtifactLossManifest(queue,structure,packets);
 const binding=await bind(root,manifest);const remove=async()=>{for(const packet of packets)await fs.rm(packet,{recursive:true});};
 const write=options=>retireLostPreparedArtifacts(queue,{assertGeneration:async()=>{assert.equal((await readArtifactLossControlBinding(queue)).manifestSha256,binding.manifestSha256);},admit:async()=>{},withRotationLock:async operation=>{const release=await acquireQueueLock(path.join(root,'isolated-rotation'));assert.ok(release);try{return await operation();}finally{await release();}}, ...options});
 const restore=async(packet=packets[0])=>{const original=originals.get(packet);await fs.mkdir(path.dirname(original.preparationFile),{recursive:true});await fs.writeFile(original.preparationFile,original.nativeRaw);await fs.writeFile(path.join(packet,'main-release-request.json'),JSON.stringify(original.request));};
 return {root,queue,releases,packets,originals,manifest,binding,remove,write,restore,structure};
}
async function bind(root,manifest,successors=[]){
 const manifestSha256=sha(canonical(manifest)),successorDigests=successors.map(value=>sha(canonical(value))),bundleSha256=sha('private-control-'+[manifestSha256,...successorDigests].join('-')),bundleRoot=path.join(root,'control-bundles',bundleSha256),installId=randomUUID();await fs.mkdir(bundleRoot,{recursive:true});
 await durableCreate(path.join(bundleRoot,artifactLossManifestName),manifest);for(const value of successors)await durableCreate(path.join(bundleRoot,artifactLossSuccessorFileName(sha(canonical(value)))),value);
 const chainFields=successors.length?{artifactLossSuccessorManifestSha256s:successorDigests}:{};
 const bundle={version:'teruisi-main-control-bundle-v2',bundleSha256,files:{'tools/prepared-artifact-loss.mjs':sha(await fs.readFile(new URL('../tools/prepared-artifact-loss.mjs',import.meta.url)))},preparedArtifactLossProtocol:artifactLossProtocol,artifactLossManifestSha256:manifestSha256,...chainFields};
 const bundleManifestSha256=await durableCreate(path.join(bundleRoot,'MANIFEST.json'),bundle),intent={bundleSha256,bundleManifestSha256,artifactLossManifestSha256:manifestSha256,...chainFields};await fs.mkdir(path.join(root,'control-upgrades',installId),{recursive:true});
 const intentSha256=await durableCreate(path.join(root,'control-upgrades',installId,'INTENT.json'),intent),state={status:'adopted',bundleRoot,bundleSha256,bundleManifestSha256,installId,intentSha256};
 await fs.writeFile(path.join(root,'CONTROL-INSTALLATION.json'),JSON.stringify(state)+'\n');return {manifestSha256,bundleRoot,state,intent,bundle};
}
test('no loss record: structure validates every byte but absent native receipt still blocks normal inventory',async t=>{
 const f=await fixture(t);await f.remove();assert.equal((await readPreparationQueueStructure(f.queue)).dispatches.length,1);
 await assert.rejects(readPreparationQueueInventory(f.queue),/incomplete/);await assert.rejects(f.write({admit:()=>{throw Error('ordinary admission rejected');}}),/ordinary/);
 const legacy=await fixture(t);await fs.unlink(path.join(legacy.root,'CONTROL-INSTALLATION.json'));await legacy.remove();await assert.rejects(readPreparationQueueInventory(legacy.queue),{code:'ENOENT'});
});
test('structural reader rejects a duplicate dispatch operation for an already-dispatched ticket without opening packet files',async t=>{
 const f=await fixture(t),read=f.structure.dispatches[0],dispatchId=randomUUID();await durableCreate(path.join(f.queue,'dispatches',dispatchId+'.json'),{...read.value,dispatchId});await f.remove();await assert.rejects(readPreparationQueueStructure(f.queue),/several dispatches|another operation/);
});
test('whole packet ENOENT: full multi-dispatch/ticket group retires, originals and pending stay untouched, then exits',async t=>{
 const f=await fixture(t,{dispatches:3,tickets:2,pending:true});const before=await readPreparationQueueStructure(f.queue),original=await Promise.all([...before.tickets.map(read=>['tickets',read.value.requestId]),...before.dispatches.map(read=>['dispatches',read.value.dispatchId]),...[...before.terminals.keys()].map(id=>['results',id])].map(async([leaf,id])=>[path.join(f.queue,leaf,id+'.json'),await fs.readFile(path.join(f.queue,leaf,id+'.json'))]));
 await f.remove();const result=await f.write();assert.equal(result.status,'retired');assert.equal(result.preparationPerformed,false);assert.equal(result.publicationPerformed,false);
 const inventory=await readPreparationQueueInventory(f.queue);assert.equal(inventory.artifactLosses.size,1);assert.equal(inventory.tickets.filter(read=>!inventory.terminals.has(read.value.requestId)).length,1);
 for(const [file,raw] of original)assert.deepEqual(await fs.readFile(file),raw);
 assert.equal(isRetiredPacket(retiredPreparationPackets(inventory),f.packets[0]),true);assert.equal((await f.write()).status,'already-retired');
 const first=before.tickets[0];assert.equal((await ticketResult(f.queue,first.value.requestId,first.sha256)).status,'prepared');
 assert.equal(preparationPacketSlot(f.releases,path.basename(f.packets[0]),retiredPreparationPackets(inventory)),f.packets[0]+'-r2');
});
test('present packet, partial tree, EACCES, missing parent, symlink and hardlinked evidence all refuse without new records',async t=>{
 const present=await fixture(t);await assert.rejects(present.write(),/whole-packet ENOENT/);
 const partial=await fixture(t);await fs.unlink(partial.originals.get(partial.packets[0]).preparationFile);await assert.rejects(partial.write(),/whole-packet ENOENT/);
 const denied=await fixture(t);await denied.remove();const lstat=fs.lstat;t.mock.method(fs,'lstat',async(file,...args)=>{if(path.resolve(file)===denied.packets[0]){const error=Error('private permission denied');error.code='EACCES';throw error;}return lstat(file,...args);});await assert.rejects(denied.write(),{code:'EACCES'});t.mock.restoreAll();
 const parent=await fixture(t);await parent.remove();await fs.rmdir(parent.releases);await assert.rejects(parent.write(),{code:'ENOENT'});
 const redirected=await fixture(t);await redirected.remove();const destination=path.join(redirected.root,'redirect-target');await fs.mkdir(destination);await fs.symlink(destination,redirected.packets[0],'junction');await assert.rejects(redirected.write(),/Redirected/);
 const hard=await fixture(t);await fs.unlink(path.join(hard.root,'CONTROL-INSTALLATION.json'));const original=hard.originals.get(hard.packets[0]);await fs.link(original.preparationFile,path.join(hard.root,'hardlinked-receipt'));await assert.rejects(readPreparationQueueInventory(hard.queue),/Unsafe artifact file/);
 for(const f of [present,partial,denied,parent,redirected,hard])assert.equal(await fs.access(path.join(f.queue,'artifact-losses')).then(()=>true,()=>false),false);
});
test('present receipt with a changed hash blocks before any retirement and preserves the original terminal bytes',async t=>{
 const f=await fixture(t);await fs.unlink(path.join(f.root,'CONTROL-INSTALLATION.json'));const read=f.structure.tickets[0],file=path.join(f.queue,'results',read.value.requestId+'.json'),before=await fs.readFile(file);
 await fs.writeFile(f.originals.get(f.packets[0]).preparationFile,'changed native receipt');await assert.rejects(readPreparationQueueInventory(f.queue),/receipt changed/);await assert.rejects(ticketResult(f.queue,read.value.requestId,read.sha256),/receipt changed/);assert.deepEqual(await fs.readFile(file),before);
});
test('reappeared packet: changed receipt/request blocks; fully valid restoration stays retired and cannot publish or reuse',async t=>{
 const f=await fixture(t);await f.remove();await f.write();await f.restore();let inventory=await readPreparationQueueInventory(f.queue);assert.equal(isRetiredPacket(retiredPreparationPackets(inventory),f.packets[0]),true);
 await assert.rejects(inspectMainPreparation({packet:f.packets[0]},{retiredPackets:await readRetiredPackets({stateDirectory:f.root})}),/退役/);
 const original=f.originals.get(f.packets[0]);await fs.writeFile(original.preparationFile,JSON.stringify({...original.native,sourceIdentity:{commit:'c'.repeat(40)}}));await assert.rejects(readPreparationQueueInventory(f.queue),/receipt changed/);
 await f.restore();await fs.writeFile(path.join(f.packets[0],'main-release-request.json'),JSON.stringify({...original.request,mainCommit:'c'.repeat(40)}));await assert.rejects(readPreparationQueueInventory(f.queue));
 await f.restore();await fs.unlink(original.preparationFile);await assert.rejects(readPreparationQueueInventory(f.queue),{code:'ENOENT'});await f.restore();inventory=await readPreparationQueueInventory(f.queue);assert.equal(inventory.artifactLosses.size,1);
 await submitPreparation(f.queue,{...generation,origin:'manual'});let prepared=0;
 await drainPreparationQueue(f.queue,{...generation,observe:async({retiredPackets})=>({targetCommit:target,packet:preparationPacketSlot(f.releases,path.basename(f.packets[0]),retiredPackets),live:f.structure.dispatches[0].value.selection.live}),prepare:async(_selection,_dispatch,reusable)=>{assert.equal(reusable,null);prepared++;return {status:'already-current',targetCommit:target,currentCommit:target,publicationPerformed:false};}});assert.equal(prepared,1);
});
test('bindings are exhaustive: omitted dispatch/ticket, changed queue/result/dispatch/native hash and swapped manifest fail closed',async t=>{
 for(const variant of ['dispatch','ticket','queue','result','dispatch-hash','receipt-hash']){
  const f=await fixture(t,{dispatches:2,tickets:2}),changed=structuredClone(f.manifest);
  if(variant==='dispatch')changed.packets[0].dispatches.pop();if(variant==='ticket')changed.packets[0].dispatches[0].tickets.pop();if(variant==='queue')changed.queueDirectory=f.root;
  if(variant==='result')changed.packets[0].dispatches[0].tickets[0].resultSha256='0'.repeat(64);if(variant==='dispatch-hash')changed.packets[0].dispatches[0].dispatchSha256='0'.repeat(64);if(variant==='receipt-hash')changed.packets[0].dispatches[0].tickets[0].preparationSha256='0'.repeat(64);
  await bind(f.root,changed);await f.remove();await assert.rejects(f.write({assertGeneration:async()=>{}}),undefined,variant);
 }
 const swapped=await fixture(t);await swapped.remove();await swapped.write();await fs.writeFile(path.join(swapped.binding.bundleRoot,artifactLossManifestName),canonical({...swapped.manifest,version:'different'}));await assert.rejects(readPreparationQueueInventory(swapped.queue),/manifest changed/);
});
test('deleted record or completed result is detected; crash after append resumes the same records without draining pending',async t=>{
 const removed=await fixture(t);await removed.remove();await removed.write();await fs.unlink(path.join(removed.queue,'artifact-losses',artifactLossPacketId(removed.packets[0])+'.json'));await assert.rejects(readPreparationQueueInventory(removed.queue),/deleted or changed/);await assert.rejects(removed.write(),/deleted or changed/);
 const crash=await fixture(t,{groups:2,pending:true});await crash.remove();await assert.rejects(crash.write({onStage:stage=>{if(stage==='after-record')throw Error('private crash');}}),/private crash/);
 const recordFile=path.join(crash.queue,'artifact-losses',artifactLossPacketId(crash.packets[0])+'.json'),before=await fs.readFile(recordFile);await assert.rejects(readPreparationQueueInventory(crash.queue),/incomplete/);
 assert.equal((await crash.write()).status,'retired');assert.deepEqual(await fs.readFile(recordFile),before);assert.equal((await readPreparationQueueStructure(crash.queue)).terminals.size,2);
 await fs.unlink(path.join(crash.queue,'artifact-loss-results',crash.binding.manifestSha256+'.json'));await assert.rejects(readPreparationQueueInventory(crash.queue),/incomplete/);
});
test('deleting the entire dispatch namespace cannot use the legacy empty-queue shortcut to reopen a loss packet',async t=>{
 const f=await fixture(t);await f.remove();await f.write();await f.restore();await fs.rename(path.join(f.queue,'dispatches'),path.join(f.root,'preserved-dispatches'));await assert.rejects(readRetiredPackets({stateDirectory:f.root}),/dispatches are missing/);
});
test('queue and rotation locks cover the complete append; original generation drift refuses and no pending ticket is consumed',async t=>{
 const f=await fixture(t,{pending:true});await f.remove();let held=false,stages=0;
 await f.write({withRotationLock:async operation=>{held=true;try{return await operation();}finally{held=false;}},onStage:async()=>{stages++;assert.equal(held,true);assert.equal(await acquireQueueLock(f.queue),null);await assert.rejects(submitPreparation(f.queue,{...generation,origin:'manual'}),/submission is busy/);}});assert.equal(held,false);assert.ok(stages>=3);
 const drift=await fixture(t);await drift.remove();await assert.rejects(drift.write({assertGeneration:()=>{throw Error('generation changed');}}),/generation/);
});
for(const mode of ['prepare','check','publish'])test('fixed '+mode+' function refuses a restored retired packet before source/native effects',async t=>{
 const f=await fixture(t);await f.remove();await f.write();await f.restore();const retiredPackets=await readRetiredPackets({stateDirectory:f.root}),selection=f.structure.dispatches[0].value.selection,config={stateDirectory:f.root,releaseDirectory:f.releases};
 const noEffect=()=>assert.fail(mode+' must stop before any source or native effect');
 if(mode==='prepare')await assert.rejects(prepareLatestMainOnce(config,selection,{retiredPackets,git:noEffect,makePlan:noEffect,prepareSchema:noEffect}),/退役/);
 if(mode==='check')await assert.rejects(inspectMainPreparation({packet:f.packets[0]},{retiredPackets,git:noEffect}),/退役/);
 if(mode==='publish')await assert.rejects(deployReadyMain({packet:f.packets[0]},{retiredPackets,git:noEffect,run:noEffect,preflight:noEffect,progress:{log:noEffect,begin:noEffect,complete:noEffect}}),/退役/);
});
test('new bundle leaves original pending tickets to incompatible-generation rejection and never migrates or prepares them',async t=>{
 const f=await fixture(t,{pending:true});await f.remove();await f.write();const pending=(await readPreparationQueueStructure(f.queue)).tickets.find(read=>!f.structure.terminals.has(read.value.requestId)),before=await fs.readFile(path.join(f.queue,'tickets',pending.value.requestId+'.json'));
 const next={configSha256:generation.configSha256,bundleSha256:'9'.repeat(64)};
 await drainPreparationQueue(f.queue,{...next,observe:()=>assert.fail('old pending must not observe'),prepare:()=>assert.fail('old pending must not prepare')});
 const terminal=await ticketResult(f.queue,pending.value.requestId,pending.sha256);assert.equal(terminal.status,'blocked');assert.equal(terminal.admission,'incompatible-generation-before-dispatch-v1');assert.deepEqual(terminal.rejectedBy,next);assert.deepEqual(await fs.readFile(path.join(f.queue,'tickets',pending.value.requestId+'.json')),before);
});
test('adopted and main producer closures remain the exact five-member union; SalesPreflightIndex154 remains supported',async()=>{
 assert.equal(producerQualification.closures.length,5);assert.equal(new Set(producerQualification.closures.map(c=>canonical(c))).size,5);
 const current={};for(const name of ['publish-prepared-main.mjs','worker-local-release-rotation.mjs','worker-local-release.mjs'])current[name]=sha(await fs.readFile(new URL('../tools/'+name,import.meta.url)));
 assert.ok(producerQualification.closures.some(c=>canonical(c)===canonical(current)),'Exact main producer closure is retained');
 assert.ok(producerQualification.closures.some(c=>c['publish-prepared-main.mjs']==='86103124799accb2730d444eb8cf27b33e0da0baa216dd83bc4d84b338402369'&&c['worker-local-release-rotation.mjs']==='c90f6c9b5ce126089527d668e3fee884193554e4a4ded91e392a1a2df98b2072'));
 assert.ok(producerQualification.closures.some(c=>c['worker-local-release-rotation.mjs']==='5171f54839b42a64d986db919770aa3f72d76dce77babb8abea250a02b8b6037'));
 assert.deepEqual(assertMainSchemaPlanSupported({migrate:true,changes:[{status:'A',path:salesPreflightMigration}]}),salesPreflightSchema);
});
test('successor material inherits the external manifest; replacement, missing intent binding, capability drop and orphan records refuse',async t=>{
 const f=await fixture(t);await f.remove();await f.write();assert.equal((await artifactLossUpgradeMaterial(f.root)).sha256,f.binding.manifestSha256);
 const other=path.join(f.root,'replaced.json');await fs.writeFile(other,canonical({...f.manifest,packets:[...f.manifest.packets,...f.manifest.packets]}));await assert.rejects(artifactLossUpgradeMaterial(f.root,other));
 const intentFile=path.join(f.root,'control-upgrades',f.binding.state.installId,'INTENT.json');await fs.writeFile(intentFile,canonical({...f.binding.intent,artifactLossManifestSha256:'0'.repeat(64)}));await assert.rejects(readPreparationQueueInventory(f.queue),/intent changed/);
 const dropped=await fixture(t);await dropped.remove();await dropped.write();const state=structuredClone(dropped.binding.state),bundle={...dropped.binding.bundle};delete bundle.artifactLossManifestSha256;state.bundleManifestSha256=sha(canonical(bundle));await fs.writeFile(path.join(dropped.binding.bundleRoot,'MANIFEST.json'),canonical(bundle));await fs.writeFile(path.join(dropped.root,'CONTROL-INSTALLATION.json'),JSON.stringify(state)+'\n');await assert.rejects(readPreparationQueueInventory(dropped.queue),/drop artifact loss/);
 const orphan=await fixture(t);await orphan.remove();await orphan.write();await fs.unlink(path.join(orphan.root,'CONTROL-INSTALLATION.json'));await assert.rejects(readPreparationQueueInventory(orphan.queue),/lack an adopted/);
 const unbound=await fixture(t),intent={...unbound.binding.intent},unboundState={...unbound.binding.state};delete intent.artifactLossManifestSha256;const intentRaw=canonical(intent);unboundState.intentSha256=sha(intentRaw);await fs.writeFile(path.join(unbound.root,'control-upgrades',unboundState.installId,'INTENT.json'),intentRaw);await fs.writeFile(path.join(unbound.root,'CONTROL-INSTALLATION.json'),JSON.stringify(unboundState)+'\n');await assert.rejects(readPreparationQueueInventory(unbound.queue),/not bound by the control intent/);
});
test('actual build-only upgrade material inherits the manifest and readMaterials refuses deleted or legally rehashed downgraded capability',async t=>{
 const f=await fixture(t);await f.remove();const source=path.join(f.root,'frozen-control-source'),repository=path.join(f.root,'private-repository'),out=path.join(f.root,'material');await fs.mkdir(path.join(source,'tools'),{recursive:true});await fs.mkdir(repository);
 const git=(root,args)=>execFileSync('git',['-c','core.hooksPath='+path.join(root,'.git/hooks'),'-C',root,...args],{encoding:'utf8',windowsHide:true});
 for(const root of [source,repository]){git(root,['init','-q']);git(root,['config','core.autocrlf','false']);git(root,['config','--local','core.hooksPath',path.join(root,'.git/hooks')]);}
 for(const name of controlFiles)await fs.copyFile(new URL('../tools/'+name,import.meta.url),path.join(source,'tools',name));git(source,['add','.']);git(source,['-c','user.name=private-fixture','-c','user.email=private@example.invalid','-c','commit.gpgsign=false','commit','-qm','frozen private control']);
 const configFile=path.join(f.root,'main-publisher-config.json');await fs.writeFile(configFile,JSON.stringify({repository,stateDirectory:f.root,releaseDirectory:f.releases}));
 const result=await prepareControlUpgrade({configFile,out,sourceRoot:source});assert.equal(result.adoptionPerformed,false);const material=await readControlUpgradeMaterials(out);assert.equal(material.intent.artifactLossManifestSha256,f.binding.manifestSha256);assert.equal(material.manifest.preparedArtifactLossProtocol,artifactLossProtocol);
 const lossFile=path.join(out,artifactLossManifestName),lossRaw=await fs.readFile(lossFile);await fs.unlink(lossFile);await assert.rejects(readControlUpgradeMaterials(out),{code:'ENOENT'});await fs.writeFile(lossFile,lossRaw);
 const manifest={...material.manifest},intent={...material.intent};delete manifest.preparedArtifactLossProtocol;delete manifest.artifactLossManifestSha256;delete intent.artifactLossManifestSha256;const manifestRaw=canonical(manifest);intent.bundleManifestSha256=sha(manifestRaw);const intentRaw=canonical(intent),prepared=JSON.parse(await fs.readFile(path.join(out,'PREPARED.json')));prepared.intentSha256=sha(intentRaw);prepared.bundleManifestSha256=intent.bundleManifestSha256;
 await fs.writeFile(path.join(out,'bundle/MANIFEST.json'),manifestRaw);await fs.writeFile(path.join(out,'INTENT.json'),intentRaw);await fs.writeFile(path.join(out,'PREPARED.json'),canonical(prepared));await assert.rejects(readControlUpgradeMaterials(out),/Successor cannot drop artifact loss capability/);
});
test('existing publication-retired writer and layered inventory preserve packet retirement and reject changed bindings',async t=>{
 const f=await fixture(t);await fs.unlink(path.join(f.root,'CONTROL-INSTALLATION.json'));const {value:dispatch,sha256:dispatchSha256}=f.structure.dispatches[0],packet=f.packets[0],attempt=path.join(packet,'publish-'+target.slice(0,12)),evidence={};
 for(const name of notEnteredRequiredMembers){const raw=Buffer.from('private publication evidence '+name);await fs.writeFile(path.join(attempt,name),raw);evidence[name]=sha(raw);}
 const record={version:publicationRetirementVersion,at:new Date().toISOString(),dispatchId:dispatch.dispatchId,dispatchSha256,selectedTarget:target,packet,attempt,consumePermitted:false,evidence,reason:null,basis:{phase:'进入维护',maintenanceId:'1'.repeat(32),liveMainCommit:dispatch.selection.live.mainCommit,workerBindingSha256:dispatch.selection.live.head.bindingSha256,djangoManifestSha256:dispatch.selection.live.djangoManifestSha256,chainStateSha256:dispatch.selection.live.chainStateSha256,maintenanceMarkersAbsent:true,healthReady:true,rotationLockFree:true,actorsExited:true,attemptMembers:[...notEnteredRequiredMembers,'preparation'].sort(),maintenanceEntered:false,maintenanceEndedAt:null}};
 const written=await writePublicationRetirement(f.queue,record),inventory=await readPreparationQueueInventory(f.queue);assert.equal(inventory.publicationRetirements.size,1);assert.equal(isRetiredPacket(retiredPreparationPackets(inventory),packet),true);
 await fs.writeFile(written.file,canonical({...record,dispatchSha256:'0'.repeat(64)}));await assert.rejects(readPreparationQueueInventory(f.queue),/dispatch changed/);
});
test('fixed prepare/check/publish and loss CLI modes are exclusive; native direct scripts retain their documented boundary',async()=>{
 for(const flag of ['--prepare-only','--check','--consume-preparation','--abandon-dispatch'])await assert.rejects(runLatestMainCli(['--config','Z:/absent/config.json','--retire-lost-artifacts',flag,...(flag==='--abandon-dispatch'?[randomUUID()]:[])]),/Artifact loss retirement cannot/);
 const source=await fs.readFile(new URL('../tools/publish-latest-main.mjs',import.meta.url),'utf8');assert.ok(source.indexOf("if(values['retire-lost-artifacts'])")<source.indexOf("if(values['abandon-dispatch']!==undefined)"));assert.ok(source.includes('await readRetiredPackets(config);'));assert.ok(controlFiles.includes('prepared-artifact-loss.mjs'));
 for(const file of ['worker-local-release-rotation.mjs','publish-prepared-main.mjs','worker-local-release.mjs'])assert.equal((await fs.readFile(new URL('../tools/'+file,import.meta.url),'utf8')).includes('prepared-artifact-loss'),false);
 const hook=spawnSync(process.execPath,['tools/main-prebuild-hook.mjs','event','Z:/absent/config.json','committed'],{input:'0'.repeat(40)+' '+target+' refs/remotes/origin/main\n',encoding:'utf8',windowsHide:true});assert.equal(hook.status,0,hook.stderr);
});
test('pure manifest validation accepts the independent 26-packet/35-dispatch inventory without opening production',async()=>{
 const raw=await fs.readFile(new URL('../docs/prepared-artifact-loss-20261029/artifact-loss-manifest.json',import.meta.url));const manifest=validateArtifactLossManifest(JSON.parse(raw));assert.equal(raw.toString(),canonical(manifest));assert.equal(manifest.packets.length,26);assert.equal(manifest.packets.flatMap(packet=>packet.dispatches).length,35);
});

// ---- append-only successor manifests (v2): prepared and failed groups -------------------------------
/** Adds one packet with one dispatch per entry of kinds. Synthetic temp queue only. */
async function addGroup(f,{name,kinds=['prepared'],tickets=1}){
 const packet=path.join(f.releases,name),live={mainCommit:'b'.repeat(40),head:{bindingSha256:'5'.repeat(64)},djangoManifestSha256:'6'.repeat(64),chainStateSha256:'7'.repeat(64)};
 const request={mainCommit:target,predecessorWorker:live.head,predecessorDjangoSha256:live.djangoManifestSha256,components:['worker','django']};
 const native={version:'teruisi-main-preparation-v1',requestSha256:sha(JSON.stringify(request)),sourceIdentity:{commit:target},workerPlan:{private:true},djangoPackage:{private:true}};
 const preparationFile=path.join(packet,'publish-'+target.slice(0,12),'preparation/PREPARED.json'),nativeRaw=Buffer.from(JSON.stringify(native)+'\n'),invocations=[],requestIds=[];
 await fs.mkdir(packet,{recursive:true});
 if(kinds.includes('prepared')){await fs.mkdir(path.dirname(preparationFile),{recursive:true});await fs.writeFile(preparationFile,nativeRaw);await fs.writeFile(path.join(packet,'main-release-request.json'),JSON.stringify(request));}
 for(const kind of kinds){
  const submitted=[];for(let n=0;n<tickets;n++)submitted.push(await submitPreparation(f.queue,{...generation,origin:'manual'}));const winner=submitted.at(-1),dispatchId=randomUUID();
  const dispatch={version:queueVersion,dispatchId,requestId:winner.requestId,mode:'prepare-only',...generation,selectedTarget:target,selection:{targetCommit:target,packet,live},deadlineUnixMs:Date.now()-3600000,dispatchedAt:new Date().toISOString(),tickets:submitted.map(ticket=>({requestId:ticket.requestId,ticketSha256:ticket.ticketSha256,observedTarget:null}))};
  const dispatchSha256=await durableCreate(path.join(f.queue,'dispatches',dispatchId+'.json'),dispatch),refs={dispatchId,dispatchSha256,selectedTarget:target,winnerRequestId:winner.requestId};
  let failure;
  if(kind==='failed-native'){const resultFile=path.join(packet,'invocations',randomUUID()+'.json'),raw=Buffer.from(JSON.stringify({phase:'prepare'})+'\n');await fs.mkdir(path.dirname(resultFile),{recursive:true});await fs.writeFile(resultFile,raw);invocations.push({resultFile,raw});failure={kind:'native-preparation-failed',phase:'prepare',resultFile,resultSha256:sha(raw)};}
  if(kind==='failed-rejected')failure={kind:'rejected-before-native',stage:'fetch'};
  for(const ticket of submitted){
   requestIds.push({requestId:ticket.requestId,ticketSha256:ticket.ticketSha256,kind});
   if(kind==='pending')continue;
   const base={version:queueVersion,requestId:ticket.requestId,ticketSha256:ticket.ticketSha256,at:new Date().toISOString(),...generation};
   const terminal=kind==='prepared'?{...base,status:'prepared',...refs,nativeResult:{status:'prepared-only',mainCommit:target,publicationPerformed:false,preparationFile,preparationSha256:sha(nativeRaw)}}:kind==='unknown'?{...base,status:'unknown',...refs,error:'unknown outcome'}:{...base,status:'failed',...refs,error:'preparation failed',preparationTerminal:failure};
   await durableCreate(path.join(f.queue,'results',ticket.requestId+'.json'),terminal);
  }
 }
 return {packet,request,nativeRaw,preparationFile,invocations,kinds,requestIds};
}
const restoreGroup=async info=>{
 if(info.kinds.includes('prepared')){await fs.mkdir(path.dirname(info.preparationFile),{recursive:true});await fs.writeFile(info.preparationFile,info.nativeRaw);await fs.writeFile(path.join(info.packet,'main-release-request.json'),JSON.stringify(info.request));}
 for(const invocation of info.invocations){await fs.mkdir(path.dirname(invocation.resultFile),{recursive:true});await fs.writeFile(invocation.resultFile,invocation.raw);}
};
const removeGroups=async(...infos)=>{for(const info of infos)await fs.rm(info.packet,{recursive:true});};
const successorFor=async(f,infos,predecessor=f.binding.manifestSha256)=>makeArtifactLossSuccessorManifest(f.queue,await readPreparationQueueStructure(f.queue),infos.map(info=>info.packet),predecessor);
const shaOf=value=>sha(canonical(value)),withFields=(value,change)=>({...value,...change});
async function snapshot(directory){
 const result={};
 async function visit(current){for(const entry of await fs.readdir(current,{withFileTypes:true})){const file=path.join(current,entry.name);if(entry.isDirectory())await visit(file);else result[path.relative(directory,file)]=sha(await fs.readFile(file));}}
 await visit(directory);return result;
}
const group=(prefix,kinds,tickets)=>({name:prefix+'-55555555-66666666',kinds,tickets});

test('v2 successor: v1 root and records stay byte-identical; new prepared and failed groups retire and skip both native checks',async t=>{
 const f=await fixture(t);await f.remove();await f.write();
 const rootBytes=await fs.readFile(path.join(f.binding.bundleRoot,artifactLossManifestName)),v1Records=await snapshot(path.join(f.queue,'artifact-losses')),v1Results=await snapshot(path.join(f.queue,'artifact-loss-results'));
 const prepared=await addGroup(f,group('bbbbbbbbbbbb',['prepared','prepared'],2)),failedNative=await addGroup(f,group('cccccccccccc',['failed-native'])),mixed=await addGroup(f,group('dddddddddddd',['failed-rejected','prepared'])),present=await addGroup(f,group('eeeeeeeeeeee',['prepared']));
 await removeGroups(prepared,failedNative,mixed);
 // Without a successor the missing prepared and failed packets still block every native reader.
 await assert.rejects(readPreparationQueueInventory(f.queue),{code:'ENOENT'});
 const failedTicket=failedNative.requestIds[0];await assert.rejects(ticketResult(f.queue,failedTicket.requestId,failedTicket.ticketSha256),{code:'ENOENT'});
 const successor=await successorFor(f,[prepared,failedNative,mixed]);assert.equal(successor.version,artifactLossSuccessorManifestVersion);assert.equal(successor.predecessorManifestSha256,f.binding.manifestSha256);
 assert.equal(successor.packets.length,3);assert.deepEqual(successor.packets.find(packet=>packet.packet===failedNative.packet).dispatches[0].tickets.map(ticket=>[ticket.status,ticket.failureKind]),[['failed','native-preparation-failed']]);
 assert.deepEqual(successor.packets.find(packet=>packet.packet===mixed.packet).dispatches.flatMap(dispatch=>dispatch.tickets.map(ticket=>ticket.status)).sort(),['failed','prepared']);
 const adopted=await bind(f.root,f.manifest,[successor]);
 // The dispatch gate compares this value with the bundle MANIFEST root digest; it must stay the v1 root.
 const binding=await readArtifactLossControlBinding(f.queue);assert.equal(binding.manifestSha256,f.binding.manifestSha256);assert.equal(binding.chain.length,2);assert.equal(binding.chain[1].sha256,shaOf(successor));assert.equal(adopted.bundle.artifactLossManifestSha256,f.binding.manifestSha256);
 await assert.rejects(readPreparationQueueInventory(f.queue),/incomplete/);
 const result=await f.write();assert.equal(result.status,'retired');assert.deepEqual(result.successorManifestSha256s,[shaOf(successor)]);assert.equal(result.packets,4);assert.equal(result.preparationPerformed,false);assert.equal(result.publicationPerformed,false);
 const inventory=await readPreparationQueueInventory(f.queue);assert.equal(inventory.artifactLosses.size,4);
 for(const info of [prepared,failedNative,mixed])assert.equal(isRetiredPacket(retiredPreparationPackets(inventory),info.packet),true);assert.equal(isRetiredPacket(retiredPreparationPackets(inventory),present.packet),false);
 assert.equal((await ticketResult(f.queue,failedTicket.requestId,failedTicket.ticketSha256)).status,'failed');
 assert.deepEqual(await fs.readFile(path.join(f.binding.bundleRoot,artifactLossManifestName)),rootBytes);
 const afterRecords=await snapshot(path.join(f.queue,'artifact-losses')),afterResults=await snapshot(path.join(f.queue,'artifact-loss-results'));
 for(const [name,digest] of Object.entries(v1Records))assert.equal(afterRecords[name],digest,'v1 record bytes changed: '+name);
 assert.equal(afterResults[f.binding.manifestSha256+'.json'],v1Results[f.binding.manifestSha256+'.json']);assert.equal(Object.keys(afterRecords).length,4);assert.deepEqual(Object.keys(afterResults).sort(),[f.binding.manifestSha256+'.json',shaOf(successor)+'.json'].sort());
 const record=JSON.parse(await fs.readFile(path.join(f.queue,'artifact-losses',artifactLossPacketId(failedNative.packet)+'.json')));assert.equal(record.manifestSha256,shaOf(successor));assert.equal(record.version,artifactLossRecordVersion);
 const v1Record=JSON.parse(await fs.readFile(path.join(f.queue,'artifact-losses',artifactLossPacketId(f.packets[0])+'.json')));assert.equal(v1Record.manifestSha256,f.binding.manifestSha256);
 assert.equal((await f.write()).status,'already-retired');
 // The present, unretired packet keeps its native check.
 await fs.writeFile(present.preparationFile,'changed native receipt');await assert.rejects(readPreparationQueueInventory(f.queue),/receipt changed/);
});
test('chain validation refuses wrong predecessor, overlap, reorder, drop, replacement and unbound or missing successor material',async t=>{
 const f=await fixture(t);await f.remove();await f.write();
 const a=await addGroup(f,group('bbbbbbbbbbbb',['prepared'])),b=await addGroup(f,group('cccccccccccc',['failed-native'])),c=await addGroup(f,group('dddddddddddd',['prepared']));await removeGroups(a,b,c);
 const rootElement={sha256:f.binding.manifestSha256,manifest:f.manifest},s1=await successorFor(f,[a]),s2=await successorFor(f,[b],shaOf(s1)),element=value=>({sha256:shaOf(value),manifest:value});
 assert.equal(validateArtifactLossChain([rootElement,element(s1),element(s2)]).length,3);validateArtifactLossSuccessorManifest(s1);
 assert.throws(()=>validateArtifactLossChain([rootElement,element(withFields(s1,{predecessorManifestSha256:'0'.repeat(64)}))]),/wrong predecessor/);
 assert.throws(()=>validateArtifactLossChain([rootElement,element(s2),element(s1)]),/wrong predecessor/);
 assert.throws(()=>validateArtifactLossChain([rootElement,element(s2)]),/wrong predecessor/);
 const replacement=await successorFor(f,[c]);assert.throws(()=>validateArtifactLossChain([rootElement,element(replacement),element(s2)]),/wrong predecessor/);
 assert.throws(()=>validateArtifactLossChain([rootElement,element(s1),element(withFields(s2,{packets:s1.packets}))]),/overlaps/);
 // Overlap with an already retired v1 packet.
 const overlap=makeArtifactLossSuccessorManifest(f.queue,await readPreparationQueueStructure(f.queue),[f.packets[0]],f.binding.manifestSha256);assert.throws(()=>validateArtifactLossChain([rootElement,element(overlap)]),/overlaps/);
 assert.throws(()=>validateArtifactLossChain([rootElement,rootElement]),/Duplicate|overlaps/);assert.throws(()=>validateArtifactLossChain([{sha256:'0'.repeat(64),manifest:f.manifest}]),/digest changed/);
 // On disk: reordered or hole-punched lists are refused by the same binding reader every consumer uses.
 await bind(f.root,f.manifest,[s2,s1]);await assert.rejects(readPreparationQueueInventory(f.queue),/wrong predecessor/);
 await bind(f.root,f.manifest,[s2]);await assert.rejects(readPreparationQueueInventory(f.queue),/wrong predecessor/);
 const good=await bind(f.root,f.manifest,[s1,s2]);assert.equal((await readArtifactLossControlBinding(f.queue)).chain.length,3);
 // Missing, tampered and unbound successor material.
 const stateFile=path.join(f.root,'CONTROL-INSTALLATION.json'),file=path.join(good.bundleRoot,artifactLossSuccessorFileName(shaOf(s2)));
 await fs.unlink(file);await assert.rejects(readArtifactLossControlBinding(f.queue),{code:'ENOENT'});await durableCreate(file,withFields(s2,{packets:s1.packets}));await assert.rejects(readArtifactLossControlBinding(f.queue),/successor changed/);
 await fs.unlink(file);await durableCreate(file,s2);assert.equal((await readArtifactLossControlBinding(f.queue)).chain.length,3);
 const state=JSON.parse(await fs.readFile(stateFile)),intentFile=path.join(f.root,'control-upgrades',state.installId,'INTENT.json'),intent=JSON.parse(await fs.readFile(intentFile));delete intent.artifactLossSuccessorManifestSha256s;const intentRaw=canonical(intent);state.intentSha256=sha(intentRaw);
 await fs.writeFile(intentFile,intentRaw);await fs.writeFile(stateFile,JSON.stringify(state)+'\n');await assert.rejects(readArtifactLossControlBinding(f.queue),/successor manifests are not bound by the control intent/);
 // A v2 file cannot serve as a root.
 assert.throws(()=>validateArtifactLossManifest(s1));
});
test('successor retirement writes strictly in chain order and refuses a successor record before the predecessor result',async t=>{
 const f=await fixture(t,{groups:2});await f.remove();
 const n=await addGroup(f,group('bbbbbbbbbbbb',['failed-native'])),p=await addGroup(f,group('cccccccccccc',['prepared']));await removeGroups(n,p);
 const successor=await successorFor(f,[n,p]);await bind(f.root,f.manifest,[successor]);
 // A stray successor record while the root has no result is refused by every reader and by the writer.
 const stray=path.join(f.queue,'artifact-losses',artifactLossPacketId(n.packet)+'.json');await fs.mkdir(path.dirname(stray),{recursive:true});
 const entry=successor.packets.find(packet=>packet.packet===n.packet);
 await durableCreate(stray,{version:artifactLossRecordVersion,manifestSha256:shaOf(successor),entrySha256:shaOf(entry),packet:entry.packet,selectedTarget:target,at:new Date().toISOString(),basis:'exact-packet-enoent-v1',consumePermitted:false});
 const structure=await readPreparationQueueStructure(f.queue);await assert.rejects(readArtifactLossRegistry(f.queue,structure,{allowIncomplete:true}),/precede their predecessor result/);await assert.rejects(f.write(),/precede their predecessor result/);
 await fs.unlink(stray);
 const rootResult=path.join(f.queue,'artifact-loss-results',f.binding.manifestSha256+'.json'),ids=[artifactLossPacketId(n.packet)+'.json',artifactLossPacketId(p.packet)+'.json'];
 const order=[];
 const result=await f.write({onStage:async stage=>{if(stage==='before-result')order.push([await fs.access(rootResult).then(()=>true,()=>false),(await fs.readdir(path.join(f.queue,'artifact-losses'))).filter(name=>ids.includes(name)).length]);}});
 assert.equal(result.status,'retired');
 // The root result is written before the successor's: its own result sees no root result and no successor record, the successor's sees both.
 assert.deepEqual(order,[[false,0],[true,2]]);assert.equal((await readPreparationQueueInventory(f.queue)).artifactLosses.size,4);
});
test('result file for a foreign manifest, a result without its predecessor, or a result with a changed body is refused',async t=>{
 const f=await fixture(t);await f.remove();await f.write();const a=await addGroup(f,group('bbbbbbbbbbbb',['failed-native']));await removeGroups(a);
 const successor=await successorFor(f,[a]);await bind(f.root,f.manifest,[successor]);await f.write();await readPreparationQueueInventory(f.queue);
 const results=path.join(f.queue,'artifact-loss-results'),rootFile=path.join(results,f.binding.manifestSha256+'.json'),tipFile=path.join(results,shaOf(successor)+'.json'),rootRaw=await fs.readFile(rootFile),tipRaw=await fs.readFile(tipFile);
 const foreign=path.join(results,'9'.repeat(64)+'.json');await fs.writeFile(foreign,tipRaw);await assert.rejects(readPreparationQueueInventory(f.queue),/names another manifest/);await fs.unlink(foreign);
 await fs.unlink(rootFile);await assert.rejects(readPreparationQueueInventory(f.queue),/without its predecessor result/);await fs.writeFile(rootFile,rootRaw);
 await fs.writeFile(tipFile,canonical({...JSON.parse(tipRaw),manifestSha256:f.binding.manifestSha256}));await assert.rejects(readPreparationQueueInventory(f.queue));await fs.writeFile(tipFile,tipRaw);
 await fs.writeFile(tipFile,canonical({...JSON.parse(tipRaw),records:{}}));await assert.rejects(readPreparationQueueInventory(f.queue),/record deleted or changed/);await fs.writeFile(tipFile,tipRaw);
 await fs.unlink(tipFile);await assert.rejects(readPreparationQueueInventory(f.queue),/incomplete/);await fs.writeFile(tipFile,tipRaw);assert.equal((await readPreparationQueueInventory(f.queue)).artifactLosses.size,2);
});
test('crash during a successor write resumes idempotently without touching earlier records or results',async t=>{
 const f=await fixture(t);await f.remove();await f.write();const rootResult=await fs.readFile(path.join(f.queue,'artifact-loss-results',f.binding.manifestSha256+'.json'));
 const a=await addGroup(f,group('bbbbbbbbbbb1',['failed-native'])),b=await addGroup(f,group('bbbbbbbbbbb2',['prepared'])),d=await addGroup(f,group('bbbbbbbbbbb3',['failed-rejected','prepared']));await removeGroups(a,b,d);
 const successor=await successorFor(f,[a,b,d]);await bind(f.root,f.manifest,[successor]);
 let records=0;await assert.rejects(f.write({onStage:stage=>{if(stage==='after-record'&&++records===2)throw Error('private crash');}}),/private crash/);
 const recordsDir=path.join(f.queue,'artifact-losses'),before=await snapshot(recordsDir);assert.equal(Object.keys(before).length,1+2);
 await assert.rejects(readPreparationQueueInventory(f.queue),/incomplete/);await assert.rejects(fs.access(path.join(f.queue,'artifact-loss-results',shaOf(successor)+'.json')));
 assert.equal((await f.write()).status,'retired');const after=await snapshot(recordsDir);for(const [name,digest] of Object.entries(before))assert.equal(after[name],digest);assert.equal(Object.keys(after).length,1+3);
 assert.deepEqual(await fs.readFile(path.join(f.queue,'artifact-loss-results',f.binding.manifestSha256+'.json')),rootResult);assert.equal((await f.write()).status,'already-retired');assert.equal((await readPreparationQueueInventory(f.queue)).artifactLosses.size,4);
 // A crash between the last record and the result also resumes.
 const g=await fixture(t);await g.remove();await g.write();const e=await addGroup(g,group('bbbbbbbbbbbb',['failed-native']));await removeGroups(e);const second=await successorFor(g,[e]);await bind(g.root,g.manifest,[second]);
 await assert.rejects(g.write({onStage:stage=>{if(stage==='before-result')throw Error('private result crash');}}),/private result crash/);assert.equal((await g.write()).status,'retired');
});
test('a reappeared retired failed packet restores its native check; an exact restoration stays retired',async t=>{
 const f=await fixture(t);await f.remove();await f.write();const failedNative=await addGroup(f,group('bbbbbbbbbbbb',['failed-native'])),rejected=await addGroup(f,group('cccccccccccc',['failed-rejected','prepared']));await removeGroups(failedNative,rejected);
 const successor=await successorFor(f,[failedNative,rejected]);await bind(f.root,f.manifest,[successor]);await f.write();await readPreparationQueueInventory(f.queue);
 // The packet returns with a changed native failure result: the native check is back for the failed kind.
 const [invocation]=failedNative.invocations;await fs.mkdir(path.dirname(invocation.resultFile),{recursive:true});await fs.writeFile(invocation.resultFile,'{"phase":"tampered"}\n');
 await assert.rejects(readPreparationQueueInventory(f.queue),/Native failure result changed/);
 await fs.unlink(invocation.resultFile);await assert.rejects(readPreparationQueueInventory(f.queue),{code:'ENOENT'});
 await restoreGroup(failedNative);const inventory=await readPreparationQueueInventory(f.queue);assert.equal(isRetiredPacket(retiredPreparationPackets(inventory),failedNative.packet),true);assert.equal(inventory.artifactLosses.get(failedNative.packet.toLowerCase()).missing,false);
 // The prepared half of a mixed group is checked again too; its rejected-before-native half has no native bytes.
 await restoreGroup(rejected);await fs.writeFile(rejected.preparationFile,'changed native receipt');await assert.rejects(readPreparationQueueInventory(f.queue),/receipt changed/);await restoreGroup(rejected);assert.equal((await readPreparationQueueInventory(f.queue)).artifactLosses.size,3);
});
test('a group with an unknown or pending ticket cannot be retired; a v1 manifest still refuses failed groups; wrong bindings fail closed',async t=>{
 const f=await fixture(t);await f.remove();await f.write();
 const unknown=await addGroup(f,group('bbbbbbbbbbbb',['prepared','unknown'])),pending=await addGroup(f,group('cccccccccccc',['failed-native','pending'])),failed=await addGroup(f,group('dddddddddddd',['failed-native']));await removeGroups(unknown,pending,failed);
 for(const info of [unknown,pending])await assert.rejects(successorFor(f,[info]),/prepared or failed/);
 const structure=await readPreparationQueueStructure(f.queue);assert.throws(()=>makeArtifactLossManifest(f.queue,structure,[failed.packet]));
 const good=await successorFor(f,[failed]);assertArtifactLossBindings(good,f.queue,structure);
 const variants=[ticket=>({requestId:ticket.requestId,ticketSha256:ticket.ticketSha256,resultSha256:ticket.resultSha256,status:'prepared',preparationSha256:'1'.repeat(64)}),ticket=>({...ticket,failureSha256:'0'.repeat(64)}),ticket=>({...ticket,failureKind:'rejected-before-native'}),ticket=>({...ticket,resultSha256:'0'.repeat(64)})];
 for(const change of variants){const clone=structuredClone(good);clone.packets[0].dispatches[0].tickets[0]=change(clone.packets[0].dispatches[0].tickets[0]);assert.throws(()=>assertArtifactLossBindings(clone,f.queue,structure));}
 const unknownStatus=structuredClone(good);unknownStatus.packets[0].dispatches[0].tickets[0].status='unknown';assert.throws(()=>validateArtifactLossSuccessorManifest(unknownStatus),/prepared or failed/);
 // The collector reports the stuck packets instead of silently skipping them.
 await assert.rejects(collectArtifactLossSuccessor(f.root),/cannot be retired/);
});
test('collector selects exactly the blocking missing groups, writes nothing in the state directory, and its output retires to zero blockers',async t=>{
 const f=await fixture(t);await f.remove();await f.write();
 const prepared=await addGroup(f,group('bbbbbbbbbbbb',['prepared'])),failedNative=await addGroup(f,group('cccccccccccc',['failed-native'])),rejectedOnly=await addGroup(f,group('dddddddddddd',['failed-rejected'])),present=await addGroup(f,group('eeeeeeeeeeee',['prepared'])),mixed=await addGroup(f,group('ffffffffffff',['failed-rejected','prepared']));
 await removeGroups(prepared,failedNative,rejectedOnly,mixed);
 const before=await snapshot(f.root);const result=await collectArtifactLossSuccessor(f.root);assert.deepEqual(await snapshot(f.root),before,'the collector must not write in the state directory');
 assert.deepEqual(result.manifest.packets.map(packet=>packet.packet).sort(),[prepared.packet,failedNative.packet,mixed.packet].sort());assert.equal(result.manifest.predecessorManifestSha256,f.binding.manifestSha256);assert.equal(result.sha256,shaOf(result.manifest));
 assert.equal(result.rows.length,4);assert.ok(result.table.includes(failedNative.requestIds[0].requestId)&&result.table.includes('| failed |')&&result.table.includes('| prepared |'));assert.equal(result.presentBlockers.length,0);
 // CLI: refuses an --out inside the state directory, otherwise writes the manifest and table outside it.
 const script=new URL('../tools/collect-artifact-loss-successor.mjs',import.meta.url),inside=spawnSync(process.execPath,[script.pathname.replace(/^\/(\w:)/,'$1'),'--state',f.root,'--out',path.join(f.root,'collected')],{encoding:'utf8',windowsHide:true});assert.notEqual(inside.status,0);assert.match(inside.stderr,/outside the state directory/);
 const out=path.join(os.tmpdir(),'collector-out-'+randomUUID());t.after(()=>fs.rm(out,{recursive:true,force:true}));
 const run=spawnSync(process.execPath,[script.pathname.replace(/^\/(\w:)/,'$1'),'--state',f.root,'--out',out],{encoding:'utf8',windowsHide:true});assert.equal(run.status,0,run.stderr);const summary=JSON.parse(run.stdout);
 assert.equal(summary.manifestSha256,result.sha256);assert.equal(summary.packets,3);assert.equal(summary.stateDirectoryWritten,false);assert.deepEqual(await snapshot(f.root),before);
 const file=path.join(out,artifactLossSuccessorFileName(result.sha256));assert.deepEqual(await fs.readFile(file),Buffer.from(canonical(result.manifest)));assert.ok((await fs.readFile(path.join(out,'SUCCESSOR-TABLE.md'),'utf8')).includes('dispatchId'));
 // Adopting that exact file retires every blocker; the present packet and the rejected-only packet never needed it.
 await bind(f.root,f.manifest,[JSON.parse(await fs.readFile(file))]);await f.write();const inventory=await readPreparationQueueInventory(f.queue);assert.equal(inventory.artifactLosses.size,4);
 assert.equal(isRetiredPacket(retiredPreparationPackets(inventory),present.packet),false);
 await assert.rejects(collectArtifactLossSuccessor(f.root),/No packet needs a successor manifest/);
});
async function upgradeEnvironment(f){
 const source=path.join(f.root,'frozen-control-source'),repository=path.join(f.root,'private-repository');await fs.mkdir(path.join(source,'tools'),{recursive:true});await fs.mkdir(repository);
 const git=(root,args)=>execFileSync('git',['-c','core.hooksPath='+path.join(root,'.git/hooks'),'-C',root,...args],{encoding:'utf8',windowsHide:true});
 for(const root of [source,repository]){git(root,['init','-q']);git(root,['config','core.autocrlf','false']);git(root,['config','--local','core.hooksPath',path.join(root,'.git/hooks')]);}
 for(const name of controlFiles)await fs.copyFile(new URL('../tools/'+name,import.meta.url),path.join(source,'tools',name));git(source,['add','.']);git(source,['-c','user.name=private-fixture','-c','user.email=private@example.invalid','-c','commit.gpgsign=false','commit','-qm','frozen private control']);
 const configFile=path.join(f.root,'main-publisher-config.json');await fs.writeFile(configFile,JSON.stringify({repository,stateDirectory:f.root,releaseDirectory:f.releases}));
 return {source,configFile};
}
test('installer appends exactly one successor of the chain tip, inherits the chain when none is given, and refuses drop, reorder, replacement and unbound material',async t=>{
 const f=await fixture(t);await f.remove();await f.write();const a=await addGroup(f,group('bbbbbbbbbbbb',['failed-native'])),b=await addGroup(f,group('cccccccccccc',['prepared']));await removeGroups(a,b);
 const s1=await successorFor(f,[a]),s2=await successorFor(f,[b],shaOf(s1)),env=await upgradeEnvironment(f),candidate=name=>path.join(f.root,name);
 await fs.writeFile(candidate('s1.json'),canonical(s1));await fs.writeFile(candidate('s2-early.json'),canonical(s2));
 // Candidate must be a successor of the current tip; a v2 whose predecessor is not the tip is refused.
 await assert.rejects(artifactLossUpgradeMaterial(f.root,candidate('s2-early.json')),/wrong predecessor/);
 const out1=path.join(f.root,'material-1'),first=await prepareControlUpgrade({configFile:env.configFile,out:out1,sourceRoot:env.source,artifactLossManifestFile:candidate('s1.json')});assert.equal(first.adoptionPerformed,false);
 const material=await readControlUpgradeMaterials(out1);assert.equal(material.intent.artifactLossManifestSha256,f.binding.manifestSha256);assert.deepEqual(material.intent.artifactLossSuccessorManifestSha256s,[shaOf(s1)]);assert.deepEqual(material.manifest.artifactLossSuccessorManifestSha256s,[shaOf(s1)]);
 assert.deepEqual(await fs.readFile(path.join(out1,artifactLossSuccessorFileName(shaOf(s1)))),Buffer.from(canonical(s1)));assert.deepEqual(await fs.readFile(path.join(out1,artifactLossManifestName)),Buffer.from(canonical(f.manifest)));
 // Adopted state with the chain: no candidate inherits the whole chain; the root candidate is the same file; others are refused.
 await bind(f.root,f.manifest,[s1]);
 const inherited=await artifactLossUpgradeMaterial(f.root);assert.equal(inherited.sha256,f.binding.manifestSha256);assert.deepEqual(inherited.successors.map(element=>element.sha256),[shaOf(s1)]);
 const out2=path.join(f.root,'material-2'),second=await prepareControlUpgrade({configFile:env.configFile,out:out2,sourceRoot:env.source});assert.equal(second.adoptionPerformed,false);
 assert.deepEqual((await readControlUpgradeMaterials(out2)).intent.artifactLossSuccessorManifestSha256s,[shaOf(s1)]);
 await fs.writeFile(candidate('root.json'),canonical(f.manifest));assert.deepEqual((await artifactLossUpgradeMaterial(f.root,candidate('root.json'))).successors.map(element=>element.sha256),[shaOf(s1)]);
 await fs.writeFile(candidate('other-root.json'),canonical({...f.manifest,packets:f.manifest.packets.map(packet=>({...packet,selectedTarget:'c'.repeat(40)}))}));await assert.rejects(artifactLossUpgradeMaterial(f.root,candidate('other-root.json')),/cannot replace/);
 await assert.rejects(artifactLossUpgradeMaterial(f.root,candidate('s1.json')),/already bound/);
 const appended=await artifactLossUpgradeMaterial(f.root,candidate('s2-early.json'));assert.deepEqual(appended.successors.map(element=>element.sha256),[shaOf(s1),shaOf(s2)]);
 // Material tampering after preparation: dropping, reordering or replacing a bound successor is refused by readMaterials against the adopted predecessor.
 const out3=path.join(f.root,'material-3');await prepareControlUpgrade({configFile:env.configFile,out:out3,sourceRoot:env.source,artifactLossManifestFile:candidate('s2-early.json')});
 const m3=await readControlUpgradeMaterials(out3);assert.deepEqual(m3.intent.artifactLossSuccessorManifestSha256s,[shaOf(s1),shaOf(s2)]);
 const rewrite=async(directory,digests)=>{const manifest=JSON.parse(await fs.readFile(path.join(directory,'bundle/MANIFEST.json'))),intent=JSON.parse(await fs.readFile(path.join(directory,'INTENT.json')));if(digests.length){manifest.artifactLossSuccessorManifestSha256s=digests;intent.artifactLossSuccessorManifestSha256s=digests;}else{delete manifest.artifactLossSuccessorManifestSha256s;delete intent.artifactLossSuccessorManifestSha256s;}
  const manifestRaw=canonical(manifest);intent.bundleManifestSha256=sha(manifestRaw);const intentRaw=canonical(intent),prepared=JSON.parse(await fs.readFile(path.join(directory,'PREPARED.json')));prepared.intentSha256=sha(intentRaw);prepared.bundleManifestSha256=intent.bundleManifestSha256;
  await fs.writeFile(path.join(directory,'bundle/MANIFEST.json'),manifestRaw);await fs.writeFile(path.join(directory,'INTENT.json'),intentRaw);await fs.writeFile(path.join(directory,'PREPARED.json'),canonical(prepared));};
 const out4=path.join(f.root,'material-4');await prepareControlUpgrade({configFile:env.configFile,out:out4,sourceRoot:env.source});
 await rewrite(out4,[]);await assert.rejects(readControlUpgradeMaterials(out4),/cannot drop, reorder or replace a bound artifact loss successor/);
 await fs.writeFile(path.join(out4,artifactLossSuccessorFileName(shaOf(s2))),canonical(s2));
 await rewrite(out4,[shaOf(s2),shaOf(s1)]);await assert.rejects(readControlUpgradeMaterials(out4),/wrong predecessor|cannot drop, reorder or replace/);
 await rewrite(out4,[shaOf(s1),shaOf(s2),shaOf(s2)]);await assert.rejects(readControlUpgradeMaterials(out4));
 await rewrite(out4,['0'.repeat(64)]);await assert.rejects(readControlUpgradeMaterials(out4));
});
