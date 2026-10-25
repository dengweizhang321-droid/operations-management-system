import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {canonical,sha,queueVersion,durableCreate,submitPreparation,readQueueObject,drainPreparationQueue} from '../tools/main-prebuild-queue.mjs';
import {auditMissingFailurePreparation} from '../tools/preparation-missing-failure-audit.mjs';
import {resolutionVersion,resolutionDecisions,readPreparationResolution,validateStaticProof,writePreparationResolution} from '../tools/preparation-resolution.mjs';

const target='b'.repeat(40),tree='c'.repeat(40),hash='a'.repeat(64),root=path.resolve(import.meta.dirname,'..');
async function fixture(t){
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'missing-failure-audit-'));t.after(()=>fs.rm(tmp,{recursive:true,force:true}));
 const state=path.join(tmp,'state'),directory=path.join(state,'prebuild-queue-v2'),packet=path.join(tmp,'packet'),source=path.join(packet,'source'),prefix='publish-'+target.slice(0,12)+'/preparation/';
 await fs.mkdir(source,{recursive:true});await fs.mkdir(path.join(packet,prefix),{recursive:true});await fs.mkdir(path.join(packet,'invocations'));await fs.mkdir(path.join(packet,'logs'));
 const configFile=path.join(state,'main-publisher-config.json');await fs.mkdir(state,{recursive:true});const configSha256=await durableCreate(configFile,{stateDirectory:state});
 const ticket=await submitPreparation(directory,{origin:'manual',configSha256,bundleSha256:hash}),dispatchId=randomUUID(),live={mainCommit:'d'.repeat(40),head:{bindingSha256:hash},djangoManifestSha256:hash,chainStateSha256:hash};
 const dispatch={version:queueVersion,dispatchId,requestId:ticket.requestId,tickets:[{requestId:ticket.requestId,ticketSha256:ticket.ticketSha256,observedTarget:null}],mode:'prepare-only',configSha256,bundleSha256:hash,selectedTarget:target,selection:{packet,targetCommit:target,live},dispatchedAt:new Date(Date.now()-60000).toISOString(),deadlineUnixMs:Date.now()-30000};
 const dispatchFile=path.join(directory,'dispatches',dispatchId+'.json'),dispatchSha256=await durableCreate(dispatchFile,dispatch),terminal={version:queueVersion,requestId:ticket.requestId,ticketSha256:ticket.ticketSha256,configSha256,bundleSha256:hash,dispatchId,dispatchSha256,selectedTarget:target,winnerRequestId:ticket.requestId,status:'unknown',at:new Date().toISOString(),error:'Original exit retained'};
 const terminalFile=path.join(directory,'results',ticket.requestId+'.json');await durableCreate(terminalFile,terminal);
 const request={version:'teruisi-frozen-latest-main-request-v1',latestMainRelease:true,mainCommit:target,predecessorWorker:live.head,predecessorDjangoSha256:hash},write=async(name,value)=>fs.writeFile(path.join(packet,name),JSON.stringify(value)+'\n');
 await write('main-release-request.json',request);await write(prefix+'PREPARING.json',{requestSha256:sha(Buffer.from(JSON.stringify(request))),sourceIdentity:{commit:target,tree}});
 await write(prefix+'source-binding.json',{version:'teruisi-worker-source-binding-v1',sourceRoot:source,predecessor:live.head,predecessorChainStateSha256:hash,identity:{sourceTree:{algorithm:'sha256-ordinal-path-length-content-v1',fileCount:3,sha256:hash}}});
 const audit=()=>auditMissingFailurePreparation({configFile,dispatchId});
 return {tmp,state,directory,packet,source,prefix,configFile,dispatchId,dispatch,dispatchFile,terminal,terminalFile,ticket,write,audit};
}
async function inventory(root){
 const result=[];async function walk(dir){for(const name of (await fs.readdir(dir)).sort()){const file=path.join(dir,name),stat=await fs.lstat(file);if(stat.isDirectory())await walk(file);else result.push({path:path.relative(root,file),sha256:sha(await fs.readFile(file))});}}
 await walk(root);return result;
}
test('missing FAILED remains blocked with byte pins and a bounded, explicit evidence gap; audit is read-only',async t=>{
 const f=await fixture(t),before=await inventory(f.tmp),result=await f.audit();
 assert.equal(result.status,'blocked');assert.equal(result.recoveryEligible,false);assert.equal(result.resolutionWritten,false);assert.equal(result.originalActorRetired,null);assert.equal(result.candidateArtifactsAbsent,null);assert.equal(result.lateEffectsFenced,null);
 for(const key of ['config','dispatch','ticket','terminal','request','preparing','sourceBinding']){assert.equal(result.objects[key].present,true);assert.match(result.objects[key].sha256,/^[a-f0-9]{64}$/);}
 assert.deepEqual(result.observed.failedFiles,[]);assert.deepEqual(result.observed.completionMarkers,[]);assert.match(result.scanScope.externalRuntime,/Not inspected/);assert.ok(result.notEstablished.some(value=>value.includes('full-boot')));
 assert.equal(result.oldDecisionEvidence.cleanedBeforePlan.validatorExecuted,false);assert.equal(result.oldDecisionEvidence.cleanedBeforePlan.failedReceiptObserved,false);assert.equal(result.oldDecisionEvidence.supersededByLaterPublication.preparedReceiptObserved,false);
 assert.deepEqual(await inventory(f.tmp),before);assert.equal(await readPreparationResolution(f.directory,f.dispatch,f.terminal),false);
});
test('Git tree comes from PREPARING when the real request schema omits it; optional cross-checks remain strict',async t=>{
 const f=await fixture(t);let result=await f.audit();assert.deepEqual(result.sourceIdentityEvidence,{preparingCommit:target,preparingGitTree:tree,gitTreeSource:'PREPARING.json original bytes',preparingGitTreeIndependentlyVerified:false,requestGitTreePresent:false,requestGitTreeCrossChecked:null,sourceBindingCommit:null,sourceBindingCommitCrossChecked:null,sourceContentVerified:false});assert.equal(result.status,'blocked');
 const requestFile=path.join(f.packet,'main-release-request.json'),preparingFile=path.join(f.packet,f.prefix+'PREPARING.json'),request=JSON.parse(await fs.readFile(requestFile)),preparing=JSON.parse(await fs.readFile(preparingFile));
 const writePair=async(nextRequest,nextPreparing)=>{await f.write('main-release-request.json',nextRequest);await f.write(f.prefix+'PREPARING.json',{...nextPreparing,requestSha256:sha(Buffer.from(JSON.stringify(nextRequest)))});};
 await writePair({...request,sourceTree:tree},preparing);result=await f.audit();assert.equal(result.sourceIdentityEvidence.requestGitTreeCrossChecked,true);assert.equal(result.recoveryEligible,false);
 await writePair({...request,sourceTree:'0'.repeat(40)},preparing);await assert.rejects(f.audit());
 for(const sourceIdentity of [{commit:target,tree:'invalid'},{commit:target},{commit:'0'.repeat(40),tree}]){await writePair(request,{...preparing,sourceIdentity});await assert.rejects(f.audit());}
 await writePair(request,preparing);const sourceBindingFile=path.join(f.packet,f.prefix+'source-binding.json'),sourceBinding=JSON.parse(await fs.readFile(sourceBindingFile));await f.write(f.prefix+'source-binding.json',{...sourceBinding,identity:{...sourceBinding.identity,commit:target}});result=await f.audit();assert.equal(result.sourceIdentityEvidence.sourceBindingCommitCrossChecked,true);
 await f.write(f.prefix+'source-binding.json',{...sourceBinding,identity:{...sourceBinding.identity,commit:'0'.repeat(40)}});await assert.rejects(f.audit());
});
test('publication markers, source build remnants and user-created claims cannot establish zero effects or retirement',async t=>{
 const f=await fixture(t);await f.write(f.prefix+'PREPARED.json',{status:'prepared'});await f.write('claimed-proof.json',{actorRetired:true,noArtifacts:true,fullBoot:true});await fs.mkdir(path.join(f.source,'node_modules'));await fs.mkdir(path.join(f.source,'dist'));
 const result=await f.audit();assert.equal(result.status,'blocked');assert.equal(result.recoveryEligible,false);assert.deepEqual(result.observed.completionMarkers,[f.prefix+'PREPARED.json']);assert.deepEqual(result.observed.sourceDirectEntryNames,['dist','node_modules']);assert.equal(result.candidateArtifactsAbsent,null);assert.equal(result.originalActorRetired,null);
});
test('missing required packet input or a real FAILED record is not this diagnostic shape',async t=>{
 const f=await fixture(t);await fs.rm(path.join(f.packet,f.prefix+'source-binding.json'));let result=await f.audit();assert.equal(result.status,'not-applicable');assert.equal(result.objects.sourceBinding.present,false);assert.equal(result.recoveryEligible,false);
 await f.write(f.prefix+'source-binding.json',{sourceRoot:f.source,predecessor:f.dispatch.selection.live.head,predecessorChainStateSha256:hash});await f.write(f.prefix+'FAILED-'+randomUUID()+'.json',{original:true});result=await f.audit();assert.equal(result.status,'not-applicable');assert.equal(result.observed.failedFiles.length,1);assert.equal(result.resolutionWritten,false);
});
test('wrong request target and terminal/dispatch/winning-ticket/config bindings refuse diagnosis',async t=>{
 const f=await fixture(t),original=await fs.readFile(f.terminalFile);
 for(const fields of [{selectedTarget:'0'.repeat(40)},{dispatchSha256:'0'.repeat(64)},{winnerRequestId:randomUUID()},{ticketSha256:'0'.repeat(64)},{bundleSha256:'0'.repeat(64)}]){await fs.writeFile(f.terminalFile,canonical({...f.terminal,...fields}));await assert.rejects(f.audit());}
 await fs.writeFile(f.terminalFile,original);const requestFile=path.join(f.packet,'main-release-request.json'),requestRaw=await fs.readFile(requestFile);await f.write('main-release-request.json',{mainCommit:'0'.repeat(40)});await assert.rejects(f.audit());await fs.writeFile(requestFile,requestRaw);
 await fs.writeFile(f.configFile,canonical({stateDirectory:f.state,changed:true}));await assert.rejects(f.audit(),/config binding changed/);
});
test('hard-linked or oversized packet evidence fails closed before returning a diagnostic',async t=>{
 const f=await fixture(t),file=path.join(f.packet,'logs','linked.log'),other=path.join(f.tmp,'other.log');await fs.writeFile(other,'log');await fs.link(other,file);await assert.rejects(f.audit(),/Unsafe or oversized/);await fs.rm(file);await fs.writeFile(file,Buffer.alloc(2*1024*1024+1));await assert.rejects(f.audit(),/Unsafe or oversized/);
});
test('many empty directories hit the global directory bound',async t=>{
 const f=await fixture(t);for(let group=0;group<16;group++){const directory=path.join(f.packet,'empty-'+group);await fs.mkdir(directory);for(let child=0;child<16;child++)await fs.mkdir(path.join(directory,'child-'+child));}
 await assert.rejects(f.audit(),/Audit directory count exceeded/);
});
test('the original cleaned validator requires FAILED, and unknown decisions never become recoveries',async t=>{
 const f=await fixture(t),proof={version:resolutionVersion,dispatchSha256:f.terminal.dispatchSha256,originalResultSha256:sha(Buffer.from(canonical(f.terminal))),nativePreparationStarted:true,candidateArtifactsAbsent:true,packetFiles:[{path:'main-release-request.json'},{path:f.prefix+'PREPARING.json'},{path:f.prefix+'source-binding.json'}],metadata:{},staging:{},sourceIdentity:{},producerFiles:{}};
 await assert.rejects(validateStaticProof(proof,{dispatch:f.dispatch,terminal:f.terminal,object:()=>{throw Error('Must not get this far');}}));
 assert.equal(Object.values(resolutionDecisions).length,2);
 await assert.rejects(writePreparationResolution({directory:f.directory,dispatchId:f.dispatchId,bundleRoot:f.tmp,out:path.join(f.tmp,'forbidden'),decision:'missing-failure-audit',adapter:{}}),/Unknown resolution decision/);
 assert.equal(await fs.stat(path.join(f.tmp,'forbidden')).then(()=>true,()=>false),false);
});
test('diagnosing unknown does not unblock a later ticket or call observe/preparation',async t=>{
 const f=await fixture(t);await f.audit();const next=await submitPreparation(f.directory,{origin:'manual',configSha256:f.dispatch.configSha256,bundleSha256:hash});let calls=0;
 await drainPreparationQueue(f.directory,{configSha256:f.dispatch.configSha256,bundleSha256:hash,observe:async()=>{calls++;throw Error('Must remain blocked');},prepare:async()=>{calls++;throw Error('Must remain blocked');}});
 const result=(await readQueueObject(path.join(f.directory,'results',next.requestId+'.json'))).value;assert.equal(calls,0);assert.equal(result.status,'blocked');assert.equal(result.blockedDispatchId,f.dispatchId);assert.equal((await readQueueObject(f.terminalFile)).value.status,'unknown');
});
test('CLI emits diagnostic stdout only and refuses proof or write options',async t=>{
 const f=await fixture(t),cli=path.join(root,'tools/preparation-missing-failure-audit.mjs'),before=await inventory(f.tmp),run=args=>execFileSync(process.execPath,[cli,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
 assert.match(run(['--help']),/Always blocked or not-applicable/);assert.equal(JSON.parse(run(['--config',f.configFile,'--dispatch',f.dispatchId])).status,'blocked');
 for(const option of ['--proof','--out','--resolve'])assert.throws(()=>run(['--config',f.configFile,'--dispatch',f.dispatchId,option,'anything']));
 assert.deepEqual(await inventory(f.tmp),before);
});
