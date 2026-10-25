/** Read-only diagnosis, never a recovery proof or a preparation queue writer. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {canonical,sha,readQueueObject,queueVersion} from './main-prebuild-queue.mjs';
import {safeDirectory,stableBytes} from './preparation-resolution.mjs';

export const missingFailureAuditVersion='teruisi-missing-failure-audit-v1';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const commit=/^[a-f0-9]{40}$/,hex=/^[a-f0-9]{64}$/;
const maxFiles=256,maxBytes=16*1024*1024,maxFileBytes=2*1024*1024,maxDepth=12;
const timestamp=value=>{assert.equal(typeof value,'string');assert.ok(Number.isFinite(Date.parse(value)));};

async function optionalBytes(file){
 try{
  const stat=await fs.lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.size<=maxFileBytes,'Unsafe or oversized audit file');
  const raw=await stableBytes(file);assert.ok(raw.length<=maxFileBytes,'Unsafe or oversized audit file');return raw;
 }catch(error){if(error.code==='ENOENT')return null;throw error;}
}
const object=raw=>{const value=JSON.parse(raw);assert.ok(value&&typeof value==='object'&&!Array.isArray(value),'Expected a JSON object');return value;};
const pin=(file,raw)=>raw===null?{path:path.resolve(file),present:false}:{path:path.resolve(file),present:true,size:raw.length,sha256:sha(raw)};

/** Bounded packet metadata only. The source tree and all external runtimes stay uninspected. */
async function packetSnapshot(packet){
 await safeDirectory(packet);const files=[],directories=[],raws=new Map();let bytes=0;
 async function walk(directory,depth){
  assert.ok(depth<=maxDepth,'Audit directory depth exceeded');assert.ok(directories.length<maxFiles,'Audit directory count exceeded');await safeDirectory(directory);
  const names=(await fs.readdir(directory)).sort();assert.ok(names.length<=maxFiles,'Audit directory entry bound exceeded');
  directories.push(path.relative(packet,directory).replaceAll('\\','/'));
  for(const name of names){
   const file=path.join(directory,name);
   if(directory===packet&&name==='source'){await safeDirectory(file);continue;}
   const stat=await fs.lstat(file);
   if(stat.isDirectory())await walk(file,depth+1);
   else{
    assert.ok(files.length<maxFiles,'Audit file bound exceeded');const raw=await optionalBytes(file);assert.ok(raw,'Audit file disappeared');
    bytes+=raw.length;assert.ok(bytes<=maxBytes,'Audit byte bound exceeded');const relative=path.relative(packet,file).replaceAll('\\','/');
    files.push({path:relative,size:raw.length,sha256:sha(raw)});raws.set(relative,raw);
   }
  }
  assert.deepEqual((await fs.readdir(directory)).sort(),names,'Audit directory changed');
 }
 await walk(packet,0);
 const source=path.join(packet,'source');let sourceEntryNames=null;
 try{await safeDirectory(source);sourceEntryNames=(await fs.readdir(source)).sort();assert.ok(sourceEntryNames.length<=maxFiles,'Source entry bound exceeded');}
 catch(error){if(error.code!=='ENOENT')throw error;}
 return {files,directories,sourceEntryNames,raws};
}

/** No injection of purported retirement/boot proofs: this function cannot grant recovery. */
export async function auditMissingFailurePreparation({configFile,dispatchId}){
 assert.ok(path.isAbsolute(configFile),'Absolute config required');assert.match(dispatchId,uuid);
 configFile=path.resolve(configFile);const configRaw=await optionalBytes(configFile);assert.ok(configRaw,'Config absent');const config=object(configRaw);
 assert.ok(typeof config.stateDirectory==='string'&&path.isAbsolute(config.stateDirectory),'Absolute stateDirectory required');
 const directory=path.join(config.stateDirectory,'prebuild-queue-v2');await safeDirectory(directory);
 const dispatchFile=path.join(directory,'dispatches',dispatchId+'.json'),dispatchRead=await readQueueObject(dispatchFile),dispatch=dispatchRead.value;
 assert.equal(dispatch.version,queueVersion);assert.equal(dispatch.dispatchId,dispatchId);assert.match(dispatch.requestId,uuid);assert.match(dispatch.selectedTarget,commit);
 assert.equal(dispatch.mode,'prepare-only');assert.equal(dispatch.configSha256,sha(configRaw),'Original config binding changed');assert.match(dispatch.bundleSha256,hex);
 assert.equal(dispatch.selection.targetCommit,dispatch.selectedTarget);assert.ok(path.isAbsolute(dispatch.selection.packet));
 timestamp(dispatch.dispatchedAt);
 const ticketFile=path.join(directory,'tickets',dispatch.requestId+'.json'),ticketRead=await readQueueObject(ticketFile),ticket=ticketRead.value;
 assert.equal(ticket.version,queueVersion);assert.equal(ticket.requestId,dispatch.requestId);assert.equal(ticket.mode,'prepare-latest-main');
 assert.equal(dispatch.tickets.filter(value=>value.requestId===dispatch.requestId).length,1,'Winning ticket reference is not unique');
 const ref=dispatch.tickets.find(value=>value.requestId===dispatch.requestId);assert.ok(ref,'Winning ticket reference absent');
 assert.equal(ref.ticketSha256,ticketRead.sha256);assert.equal(ref.observedTarget,ticket.observedTarget);
 for(const key of ['configSha256','bundleSha256'])assert.equal(ticket[key],dispatch[key],'Ticket binding changed: '+key);
 const terminalFile=path.join(directory,'results',dispatch.requestId+'.json'),terminalRead=await readQueueObject(terminalFile),terminal=terminalRead.value;
 assert.equal(terminal.version,queueVersion);assert.equal(terminal.dispatchId,dispatchId);assert.equal(terminal.dispatchSha256,dispatchRead.sha256);
 assert.equal(terminal.requestId,dispatch.requestId);assert.equal(terminal.winnerRequestId,dispatch.requestId);assert.equal(terminal.ticketSha256,ticketRead.sha256);
 for(const key of ['configSha256','bundleSha256','selectedTarget'])assert.equal(terminal[key],dispatch[key],'Terminal binding changed: '+key);

 const packet=path.resolve(dispatch.selection.packet),snapshot=await packetSnapshot(packet),prefix='publish-'+dispatch.selectedTarget.slice(0,12)+'/preparation/';
 const requestRaw=snapshot.raws.get('main-release-request.json')??null,preparingRaw=snapshot.raws.get(prefix+'PREPARING.json')??null,sourceRaw=snapshot.raws.get(prefix+'source-binding.json')??null;
 const request=requestRaw?object(requestRaw):null,preparing=preparingRaw?object(preparingRaw):null;
 if(request){assert.equal(request.mainCommit,dispatch.selectedTarget);assert.deepEqual(request.predecessorWorker,dispatch.selection.live.head);assert.equal(request.predecessorDjangoSha256,dispatch.selection.live.djangoManifestSha256);}
 if(preparing){assert.equal(preparing.sourceIdentity.commit,dispatch.selectedTarget);assert.match(preparing.sourceIdentity.tree,commit,'PREPARING Git tree must be a 40-character object id');
  if(request){assert.equal(preparing.requestSha256,sha(Buffer.from(JSON.stringify(request))));if(Object.hasOwn(request,'sourceTree')){assert.match(request.sourceTree,commit);assert.equal(preparing.sourceIdentity.tree,request.sourceTree);}}
 }
 const source=sourceRaw?object(sourceRaw):null;
 if(source){assert.equal(source.sourceRoot,path.join(packet,'source'));assert.deepEqual(source.predecessor,dispatch.selection.live.head);assert.equal(source.predecessorChainStateSha256,dispatch.selection.live.chainStateSha256);if(source.identity&&Object.hasOwn(source.identity,'commit'))assert.equal(source.identity.commit,dispatch.selectedTarget);}
 const installationFile=path.join(config.stateDirectory,'CONTROL-INSTALLATION.json'),installationRaw=await optionalBytes(installationFile),installation=installationRaw?object(installationRaw):null;
 const failedFiles=snapshot.files.filter(file=>file.path.startsWith(prefix)&&/^FAILED-[a-f0-9-]+\.json$/.test(file.path.slice(prefix.length))).map(file=>file.path);
 const markers=snapshot.files.filter(file=>/(?:^|\/)(?:PREPARED|STARTED|SUCCESS|worker-plan)\.json$/.test(file.path)).map(file=>file.path);
 const applicable=terminal.status==='unknown'&&requestRaw!==null&&preparingRaw!==null&&sourceRaw!==null&&failedFiles.length===0;
 // This is a consistency re-read of the diagnostic snapshot, never a live recovery admission.
 const finalSnapshot=await packetSnapshot(packet);
 assert.deepEqual({files:finalSnapshot.files,directories:finalSnapshot.directories,sourceEntryNames:finalSnapshot.sourceEntryNames},{files:snapshot.files,directories:snapshot.directories,sourceEntryNames:snapshot.sourceEntryNames},'Packet changed during audit');
 for(const[file,digest]of [[configFile,sha(configRaw)],[dispatchFile,dispatchRead.sha256],[ticketFile,ticketRead.sha256],[terminalFile,terminalRead.sha256]])assert.equal(sha(await stableBytes(file)),digest,'Original object changed during audit');
 assert.deepEqual(await optionalBytes(installationFile),installationRaw,'Control installation changed during audit');
 return {
  version:missingFailureAuditVersion,status:applicable?'blocked':'not-applicable',code:applicable?'MISSING_FAILURE_BLOCKED':'MISSING_FAILURE_NOT_APPLICABLE',diagnosticOnly:true,recoveryEligible:false,
  binding:{dispatchId,requestId:dispatch.requestId,selectedTarget:dispatch.selectedTarget,packet,configSha256:dispatch.configSha256,dispatchBundleSha256:dispatch.bundleSha256},
  objects:{config:pin(configFile,configRaw),dispatch:pin(dispatchFile,Buffer.from(canonical(dispatch))),ticket:pin(ticketFile,Buffer.from(canonical(ticket))),terminal:pin(terminalFile,Buffer.from(canonical(terminal))),request:pin(path.join(packet,'main-release-request.json'),requestRaw),preparing:pin(path.join(packet,prefix,'PREPARING.json'),preparingRaw),sourceBinding:pin(path.join(packet,prefix,'source-binding.json'),sourceRaw),controlInstallation:pin(installationFile,installationRaw)},
  observed:{terminalStatus:terminal.status,failedFiles,completionMarkers:markers,packetFiles:snapshot.files,packetDirectories:snapshot.directories,sourceDirectEntryNames:snapshot.sourceEntryNames,currentControlBundleSha256:installation?.bundleSha256??null,currentControlInstallId:installation?.installId??null},
  sourceIdentityEvidence:{preparingCommit:preparing?.sourceIdentity.commit??null,preparingGitTree:preparing?.sourceIdentity.tree??null,gitTreeSource:preparing?'PREPARING.json original bytes':null,preparingGitTreeIndependentlyVerified:false,requestGitTreePresent:request!==null&&Object.hasOwn(request,'sourceTree'),requestGitTreeCrossChecked:request&&preparing&&Object.hasOwn(request,'sourceTree')?true:null,sourceBindingCommit:source?.identity?.commit??null,sourceBindingCommitCrossChecked:source?.identity&&Object.hasOwn(source.identity,'commit')?true:null,sourceContentVerified:false},
  oldDecisionEvidence:{
   cleanedBeforePlan:{validatorExecuted:false,failedReceiptObserved:failedFiles.length>0,processTimeoutAndTreeCleanup:'Not validated; absent FAILED cannot satisfy the original validator.'},
   supersededByLaterPublication:{validatorExecuted:false,preparedReceiptObserved:markers.includes(prefix+'PREPARED.json'),successorConsumptionChain:'Not inspected; packet file presence cannot prove the original consumption chain.'}
  },
  established:['Original winning ticket, dispatch, terminal and available packet objects are byte-bound within this bounded diagnostic snapshot.','No recovery eligibility is granted by this diagnostic.'],
  notEstablished:['PREPARING Git-tree value is archived and format-checked only; Git object/source content identity is not independently verified.','Original actor identity and binding to its exact task instance and dispatch.','Late effects are fenced by authoritative actor/descendant retirement, or a qualified full-boot barrier with task/event and no-relaunch bindings.','Complete producer side-effect closure and original-to-current adopted control generation chain.','Complete source/build remnants, Worker/Django/Pi artifacts and consumption records.','Two independent fresh observations, ordinary ACKs and final dynamic admission within the queue/rotation lock epoch.'],
  scanScope:{packet:'All non-source packet files, bounded to 256 files, 2 MiB each, 16 MiB total and depth 12; repeated for diagnostic consistency.',source:'Direct entry names only; source contents and build output trees are not inspected.',externalRuntime:'Not inspected.',taskAndBootEvents:'Not inspected.',processesAndLocks:'Not inspected.'},
  candidateArtifactsAbsent:null,originalActorRetired:null,lateEffectsFenced:null,resolutionWritten:false,publicationPerformed:false,retryOriginal:false
 };
}

export async function runMissingFailureAuditCli(args=process.argv.slice(2)){
 const {values}=parseArgs({args,options:{help:{type:'boolean'},config:{type:'string'},dispatch:{type:'string'}}});
 if(values.help){console.log('Usage: node preparation-missing-failure-audit.mjs --config <absolute config> --dispatch <uuid>\nRead-only bounded diagnosis; stdout only. Always blocked or not-applicable. Does not accept --proof, authorize recovery, write queue records, inspect live processes or run preparation.');return;}
 assert.ok(values.config&&values.dispatch,'--config and --dispatch required');console.log(JSON.stringify(await auditMissingFailurePreparation({configFile:values.config,dispatchId:values.dispatch})));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await runMissingFailureAuditCli();}
 catch(error){console.error(JSON.stringify({version:missingFailureAuditVersion,code:'MISSING_FAILURE_AUDIT_REJECTED',diagnosticOnly:true,recoveryEligible:false,error:String(error.message).slice(0,400)}));process.exitCode=1;}
}
