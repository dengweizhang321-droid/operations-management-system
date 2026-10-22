/** Cleaned-preparation protocol. No preparation, deployment or process termination. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {canonical,sha,readQueueObject,durableCreate,acquireQueueLock,readPreparationQueueInventory} from './main-prebuild-queue.mjs';
import {decodedControlCommand} from './main-prebuild-task.mjs';
import historyCatalog from './preparation-resolution-history.mjs';
import {assertFrozenSource} from './frozen-main-source.mjs';
import producerQualification from './preparation-producer-qualification.mjs';

const hex=/^[a-f0-9]{64}$/,uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const resolutionVersion='teruisi-cleaned-preparation-resolution-v1';
/** Every resolution decision is a closed set: unknown values fail closed on read. */
export const resolutionDecisions=Object.freeze({cleanedBeforePlan:'failed-cleaned-before-plan',supersededByLaterPublication:'superseded-by-later-publication'});
export const supersededTerminationBasis='preparation-consumed-by-later-publication';
const knownDecisions=new Set(Object.values(resolutionDecisions));
const preparationKeys='at djangoManifestSha256 djangoPreparedId path requestSha256 sha256 sourceTree workerManifestSha256 workerRelease';
const terminationKeys='at automaticRetry maintenanceStarted path phase sha256';
const attemptTerminationKeys='actorProcessId at automaticRetry maintenanceStarted path phase sha256';
const successorKeys='at djangoManifestSha256 djangoPreparedId mainCommit mainFile mainFileSha256 originalActorProcessId originalAttempt originalAttemptStarted originalFailureSha256 originalStartExitedSuccessfully originalStartReconciled originalStartedSha256 readyVerified receiptPath receiptSha256 source sourceTree startupVerified status workerManifestSha256 workerRelease';
export const operatorNames=['main-prebuild-queue.mjs','main-prebuild-task.mjs','main-control-dispatch.mjs','preparation-resolution.mjs','preparation-resolution-history.mjs','preparation-producer-qualification.mjs','frozen-main-source.mjs','cleaned-preparation-writer.mjs','cleaned-preparation-observer.mjs'];
const keys=(v,n)=>assert.deepEqual(Object.keys(v??{}).sort(),n.split(' ').sort());
const timestamp=v=>{assert.equal(typeof v,'string');const n=Date.parse(v);assert.ok(Number.isFinite(n));return n;};
const exists=async p=>{try{await fs.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
export async function safeDirectory(p){
 p=path.resolve(p);const s=await fs.lstat(p);assert.ok(s.isDirectory()&&!s.isSymbolicLink(),'Unsafe evidence directory');
 assert.equal((await fs.realpath(p)).toLowerCase(),p.toLowerCase(),'Redirected evidence directory');
}
export async function stableBytes(p){
 await safeDirectory(path.dirname(p));const h=await fs.open(p,'r');
 try{const a=await h.stat(),leaf=await fs.lstat(p);assert.ok(a.isFile()&&leaf.isFile()&&!leaf.isSymbolicLink()&&a.nlink===1&&a.size<=32*1024*1024,'Unsafe evidence object');assert.equal(a.ino,leaf.ino);const raw=await h.readFile(),b=await h.stat();assert.equal(a.size,b.size);assert.equal(a.mtimeMs,b.mtimeMs);assert.equal(a.ctimeMs,b.ctimeMs);return raw;}finally{await h.close();}
}
export async function evidenceInventory(root){
 await safeDirectory(root);const files=[],directories=[];
 async function walk(dir){await safeDirectory(dir);const names=(await fs.readdir(dir)).sort();directories.push(path.relative(root,dir).replaceAll('\\','/'));for(const name of names){assert.ok(files.length<20000);const file=path.join(dir,name),s=await fs.lstat(file);if(s.isDirectory())await walk(file);else{const raw=await stableBytes(file);if(path.basename(dir)==='objects'){assert.match(name,/^[a-f0-9]{64}\.bin$/);assert.equal(sha(raw),name.slice(0,-4),'Evidence object digest mismatch');}files.push({path:path.relative(root,file).replaceAll('\\','/'),size:raw.length,sha256:sha(raw)});}}assert.deepEqual((await fs.readdir(dir)).sort(),names,'Evidence directory changed');}
 await walk(root);return {directories,files};
}
async function history(){return historyCatalog;}
export function resolutionForbidsTargetReplay(dispatchId){return historyCatalog.records.find(r=>r.dispatchId===dispatchId)?.forbidTargetReplay??true;}
/** A superseded pin must carry the successor publication it was converged against. */
function assertHistoricalSuccessorPin(value,pin){
 const publication=pin.successorPublication;assert.ok(publication&&typeof publication==='object'&&!Array.isArray(publication),'Superseded historical pin lacks its successor publication');
 keys(publication,'mainFileSha256 preparationSha256 receiptSha256');for(const k of ['mainFileSha256','preparationSha256','receiptSha256'])assert.match(publication[k],hex);
 assert.equal(value.maintenanceStarted,false);assert.equal(value.prepared,true);assert.equal(value.publicationPerformed,false);
 keys(value.preparation,preparationKeys);keys(value.successorPublication,successorKeys);
 assert.equal(value.preparation.sha256,publication.preparationSha256,'Historical preparation receipt changed');
 assert.equal(value.successorPublication.mainFileSha256,publication.mainFileSha256,'Historical successor publication changed');
 assert.equal(value.successorPublication.receiptSha256,publication.receiptSha256,'Historical successor receipt changed');
 assert.equal(value.successorPublication.mainCommit,value.selectedTarget);assert.equal(value.successorPublication.status,'deployed_and_ready');
 return true;
}
export async function readHistoricalResolution(directory,dispatch,terminal,value,raw,catalog){
 catalog=catalog??await history();const pin=catalog.records.find(r=>r.dispatchId===dispatch.dispatchId);if(!pin)return false;
 assert.equal(sha(raw),pin.resolutionSha256,'Historical resolution changed');
 const decision=pin.decision??resolutionDecisions.cleanedBeforePlan;assert.ok(typeof decision==='string'&&decision.length>0,'Historical resolution decision is missing');
 assert.equal(value.decision,decision,'Historical resolution decision changed');
 assert.equal(sha(Buffer.from(canonical(dispatch))),pin.dispatchSha256);assert.equal(sha(Buffer.from(canonical(terminal))),pin.terminalSha256);
 assert.equal(value.requestId,pin.requestId);assert.equal(dispatch.selectedTarget,pin.selectedTarget);
 if(decision===resolutionDecisions.supersededByLaterPublication)assertHistoricalSuccessorPin(value,pin);
 assert.equal(sha(Buffer.from(canonical(await evidenceInventory(path.join(directory,'resolutions',dispatch.dispatchId+'-evidence'))))),pin.evidenceTreeSha256,'Historical evidence closure changed');
 return true;
}
export async function readPreparationResolution(directory,dispatch,terminal){
 if(!terminal)return false;
 const file=path.join(directory,'resolutions',dispatch.dispatchId+'.json');if(!await exists(file))return false;
 const {value}=await readQueueObject(file),raw=Buffer.from(canonical(value));
 if(value.version==='teruisi-retired-preparation-resolution-v1'){
  assert.equal(sha(await stableBytes(path.join(directory,'dispatches',dispatch.dispatchId+'.json'))),sha(Buffer.from(canonical(dispatch))));assert.equal(sha(await stableBytes(path.join(directory,'results',terminal.requestId+'.json'))),sha(Buffer.from(canonical(terminal))));
  // Loaded only for the separate retirement schema. This preserves the two
  // original decision validators/history and avoids queue/bootstrap import TDZ.
  const {readRetiredPreparationResolution}=await import('./preparation-retirement.mjs');return readRetiredPreparationResolution(directory,dispatch,terminal,value);
 }
 if(value.version!==resolutionVersion)return readHistoricalResolution(directory,dispatch,terminal,value,raw);
 assert.ok(knownDecisions.has(value.decision),'Unknown resolution decision');
 assert.equal(sha(await stableBytes(path.join(directory,'dispatches',dispatch.dispatchId+'.json'))),sha(Buffer.from(canonical(dispatch))));
 assert.equal(sha(await stableBytes(path.join(directory,'results',terminal.requestId+'.json'))),sha(Buffer.from(canonical(terminal))));
 const evidence=path.join(directory,'resolutions',dispatch.dispatchId+'-evidence');assert.equal(value.evidenceDirectory,path.resolve(evidence));
 const inventory=await evidenceInventory(evidence);assert.deepEqual(inventory.directories,['','objects']);
 const objects=new Map();for(const item of inventory.files){assert.match(item.path,/^objects\/[a-f0-9]{64}\.bin$/);objects.set(item.sha256,await stableBytes(path.join(evidence,item.path)));}
 if(value.decision===resolutionDecisions.supersededByLaterPublication)await validateSupersededResolution(value,{dispatch,terminal,objects});
 else await validateResolution(value,{dispatch,terminal,objects});
 return true;
}
function identity(v){keys(v,'processId creationDate commandLine executablePath');assert.ok(Number.isSafeInteger(v.processId)&&v.processId>0);timestamp(v.creationDate);for(const k of ['commandLine','executablePath'])assert.ok(typeof v[k]==='string'&&v[k]);}
function epoch(v,deadline,writer){keys(v,'id startedAt writerPid');assert.match(v.id,uuid);assert.equal(v.writerPid,writer.processId);assert.equal(deadline,timestamp(v.startedAt)+20*60*1000);identity(writer);assert.ok(timestamp(writer.creationDate)<=timestamp(v.startedAt));}
const possible=name=>/^(?:node|node_repl|powershell|pwsh|cmd|npm|npx|esbuild|rollup)(?:\.exe)?$/i.test(name);
export const censusScript='$probe=$PID;$rows=@(Get-CimInstance Win32_Process -ErrorAction Stop|Where-Object{$_.ProcessId -ne $probe}|ForEach-Object{@{processId=[int]$_.ProcessId;parentProcessId=[int]$_.ParentProcessId;name=[string]$_.Name;creationDate=$(if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString("o")}else{$null});executablePath=$_.ExecutablePath;commandLine=$_.CommandLine}});if($rows.Count -gt 4096){throw "Census bound exceeded"};@{rows=$rows;elevated=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))}|ConvertTo-Json -Depth 5 -Compress';
export function censusProjection(rows){return rows.map(r=>({processId:r.processId,parentProcessId:r.parentProcessId,name:r.name,creationDate:r.creationDate,commandLineSha256:r.commandLine?sha(Buffer.from(r.commandLine)):null,executablePathSha256:r.executablePath?sha(Buffer.from(r.executablePath)):null,controlCandidate:possible(r.name)})).sort((a,b)=>a.processId-b.processId);}
function controlCommand(text,roots){return roots.some(root=>text.includes(decodedControlCommand(root)))||/(?:worker-local-service|django-local-service|operations-system-(?:control|service)|publish-(?:latest-|prepared-)?main|process-deadline|npm-cli|npx-cli|vite\/bin|vinext|cleaned-preparation-(?:writer|observer))\.(?:mjs|js|ps1)/i.test(text);}
export function assertCensus(rows,{writer,observer,roots}){
 assert.ok(Array.isArray(rows)&&rows.length>0&&rows.length<=4096);const seen=new Set();
 for(const r of rows){assert.ok(Number.isSafeInteger(r.processId)&&r.processId>=0&&!seen.has(r.processId));seen.add(r.processId);assert.ok(Number.isSafeInteger(r.parentProcessId)&&r.parentProcessId>=0);assert.ok(typeof r.name==='string'&&r.name);if(possible(r.name)){assert.ok(r.creationDate&&r.commandLine&&r.executablePath,'Possible controller is opaque');timestamp(r.creationDate);}}
 const protectedIds=new Set([writer.processId,observer.processId]);
 for(const actor of [writer,observer]){identity(actor);const r=rows.find(r=>r.processId===actor.processId);assert.ok(r,'Protected actor absent');for(const k of Object.keys(actor))assert.equal(r[k],actor[k],'Actor identity drift');}
 for(const r of rows){if(protectedIds.has(r.processId))continue;if(r.commandLine)assert.equal(controlCommand(decodedControlCommand(r.commandLine),roots),false,'Another preparation/lifecycle controller remains');assert.equal(protectedIds.has(r.parentProcessId),false,'Protected actor descendant remains');}
 return true;
}
export function assertCrossCensus(witness,current,context){
 const known=new Map(witness.map(r=>[r.processId,r])),projection=censusProjection(current);
 for(const r of projection.filter(r=>r.controlCandidate||context.protectedPids.includes(r.processId))){const old=known.get(r.processId);assert.ok(old,'New possible controller after independent witness');for(const k of ['processId','parentProcessId','name','creationDate'])assert.equal(r[k],old[k]);for(const k of ['commandLineSha256','executablePathSha256']){assert.match(old[k]??'',hex);if(r[k]!==null)assert.equal(r[k],old[k]);}}
 for(const actor of context.protectedPids)assert.ok(projection.some(r=>r.processId===actor),'Protected actor exited');
 // Complete high-token census may supply opaque low-token metadata, never PID alone.
 const filled=current.map(r=>{const w=known.get(r.processId);return {...r,commandLine:r.commandLine??(w?'witnessed':null),executablePath:r.executablePath??(w?'witnessed':null)};});
 for(const r of filled)if(r.commandLine&&r.commandLine!=='witnessed'&&!context.protectedPids.includes(r.processId))assert.equal(controlCommand(decodedControlCommand(r.commandLine),context.roots),false);
 for(const r of current)assert.equal(context.protectedPids.includes(r.parentProcessId),false,'Protected descendant after witness');return true;
}
function bindingOf(dispatch,terminal){assert.equal(terminal.status,'unknown');assert.equal(terminal.dispatchId,dispatch.dispatchId);assert.equal(terminal.dispatchSha256,sha(Buffer.from(canonical(dispatch))));assert.equal(terminal.selectedTarget,dispatch.selectedTarget);assert.equal(terminal.winnerRequestId,dispatch.requestId);assert.equal(terminal.requestId,dispatch.requestId,'Resolve only the winning result');return {dispatchId:dispatch.dispatchId,dispatchSha256:terminal.dispatchSha256,requestId:dispatch.requestId,selectedTarget:dispatch.selectedTarget,originalResultSha256:sha(Buffer.from(canonical(terminal)))};}
export async function validateResolution(v,{dispatch,terminal,objects}){
 keys(v,'version decision terminationBasis at dispatchId dispatchSha256 requestId selectedTarget originalResultSha256 evidenceDirectory nativePreparationStarted candidateArtifactsAbsent prepared publicationPerformed retryOriginal writer writerToken epoch deadlineUnixMs adoptionSha256 operatorFiles staticEvidence observations');
 assert.equal(v.version,resolutionVersion);assert.equal(v.decision,'failed-cleaned-before-plan');assert.equal(v.terminationBasis,'confirmed-tree-cleanup-before-plan');
 for(const [k,x]of Object.entries(bindingOf(dispatch,terminal)))assert.equal(v[k],x,'Resolution binding mismatch: '+k);
 assert.equal(v.nativePreparationStarted,true);assert.equal(v.candidateArtifactsAbsent,true);for(const k of ['prepared','publicationPerformed','retryOriginal'])assert.equal(v[k],false);
 epoch(v.epoch,v.deadlineUnixMs,v.writer);assert.ok(timestamp(v.at)<=v.deadlineUnixMs&&timestamp(v.at)>=timestamp(v.epoch.startedAt));
 const object=d=>{assert.match(d??'',hex);const raw=objects.get(d);assert.ok(raw,'Missing archive object');assert.equal(sha(raw),d);return raw;},json=d=>{const raw=object(d),value=JSON.parse(raw);assert.equal(raw.toString('utf8'),canonical(value),'Noncanonical protocol object');return value;};
 for(const [d,raw]of objects){assert.match(d,hex);assert.equal(sha(raw),d);}
 const adoption=JSON.parse(object(v.adoptionSha256));assert.equal(adoption.version,'teruisi-main-control-installation-v3');assert.equal(adoption.status,'adopted');assert.equal(adoption.preparationTask.sid,v.writerToken.sid);keys(v.writerToken,'sid sessionId elevated integrityRid');assert.match(v.writerToken.sid,/^S-1-\d+(?:-\d+)+$/);assert.equal(v.writerToken.elevated,false);assert.equal(v.writerToken.integrityRid,8192);assert.ok(Number.isSafeInteger(v.writerToken.sessionId)&&v.writerToken.sessionId>0);
 const manifest=json(adoption.bundleManifestSha256);assert.equal(manifest.version,'teruisi-main-control-bundle-v2');assert.equal(sha(Buffer.from(canonical(manifest.files))),adoption.bundleSha256);assert.equal(manifest.bundleSha256,adoption.bundleSha256);
 assert.match(manifest.sourceCommit,/^[a-f0-9]{40}$/);assert.match(manifest.sourceTree,/^[a-f0-9]{40}$/);assert.match(adoption.installId,uuid);assert.ok(timestamp(adoption.adoptedAt)<=timestamp(v.epoch.startedAt));
 assert.equal(adoption.configSha256,dispatch.configSha256,'Configuration changed since original dispatch');object(adoption.configSha256);
 const intent=json(adoption.intentSha256),transition=json(adoption.transitionProofSha256);assert.equal(intent.version,'teruisi-main-control-upgrade-v2');assert.equal(intent.installId,adoption.installId);for(const key of ['bundleRoot','bundleSha256','bundleManifestSha256','dispatcherSha256','hook','hookSha256','configSha256'])assert.equal(intent[key],adoption[key]);assert.deepEqual(intent.preparationTask,adoption.preparationTask);assert.equal(intent.sourceCommit,manifest.sourceCommit);assert.equal(intent.sourceTree,manifest.sourceTree);
 assert.equal(transition.version,'teruisi-main-control-transition-v2');assert.equal(transition.installId,adoption.installId);assert.equal(transition.intentSha256,adoption.intentSha256);assert.deepEqual(transition.lockOrder,['v1-queue','v2-queue','native-rotation']);assert.equal(transition.rotationPipeSha256,sha('\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1'));for(const key of ['productionDeploymentPerformed','privateTestTopology'])assert.equal(transition[key],false);assert.equal(transition.legacyWindowConverged,true);assert.ok(transition.frames?.length>=3);for(const frame of transition.frames.slice(-3)){assert.deepEqual(frame.related,[]);assert.ok(timestamp(frame.at)<=timestamp(adoption.adoptedAt));}object(adoption.dispatcherSha256);object(adoption.hookSha256);for(const digest of Object.values(manifest.files))object(digest);
 assert.deepEqual(Object.keys(v.operatorFiles).sort(),operatorNames.toSorted());for(const name of operatorNames){assert.equal(v.operatorFiles[name],manifest.files['tools/'+name]);object(v.operatorFiles[name]);}
 keys(v.staticEvidence,'initial final');const initial=json(v.staticEvidence.initial),final=json(v.staticEvidence.final);for(const s of [initial,final]){keys(s,'startedAt completedAt proof');assert.ok(timestamp(s.startedAt)>=timestamp(v.epoch.startedAt)&&timestamp(s.completedAt)>=timestamp(s.startedAt)&&timestamp(s.completedAt)<=v.deadlineUnixMs);await validateStaticProof(s.proof,{dispatch,terminal,object});}assert.deepEqual(initial.proof,final.proof,'Complete inventories changed');const failedItem=initial.proof.packetFiles.find(x=>/FAILED-/.test(x.path)),failedActor=JSON.parse(object(failedItem.sha256)).processEvidence.processId;
 assert.ok(Array.isArray(v.observations)&&v.observations.length===2);let previousAck=null,previousNonce=null;
 for(const [i,pair]of v.observations.entries()){
  keys(pair,'requestSha256 observationSha256 ackSha256');const r=json(pair.requestSha256),o=json(pair.observationSha256),a=json(pair.ackSha256),s=i===0?initial:final;
  keys(r,'version phase nonce at binding writer epoch deadlineUnixMs adoptionSha256 operatorFiles staticEvidence task evidenceDirectory');assert.equal(r.version,resolutionVersion);assert.equal(r.phase,i===0?'initial':'final');assert.deepEqual(r.binding,bindingOf(dispatch,terminal));assert.deepEqual(r.writer,v.writer);assert.deepEqual(r.epoch,v.epoch);assert.equal(r.deadlineUnixMs,v.deadlineUnixMs);assert.equal(r.adoptionSha256,v.adoptionSha256);assert.deepEqual(r.operatorFiles,v.operatorFiles);assert.deepEqual(r.task,adoption.preparationTask);assert.equal(r.evidenceDirectory,v.evidenceDirectory);assert.equal(r.staticEvidence,i===0?v.staticEvidence.initial:v.staticEvidence.final);assert.match(r.nonce,/^[a-f0-9]{32}$/);assert.notEqual(r.nonce,previousNonce);previousNonce=r.nonce;
  assert.ok(timestamp(r.at)>=timestamp(s.completedAt));if(previousAck)assert.ok(timestamp(s.startedAt)>=timestamp(previousAck.at));
  validateObservation(o,r);assert.ok(!o.census.some(row=>row.processId===failedActor),'Original failed actor remains');assert.ok(!a.census.some(row=>row.processId===failedActor),'Original failed actor appeared after witness');const ackStart=timestamp(a.censusStartedAt),ackEnd=timestamp(a.censusCompletedAt),ackAt=timestamp(a.at);keys(a,'requestSha256 observationSha256 writerPid censusStartedAt censusCompletedAt at census');assert.equal(a.requestSha256,pair.requestSha256);assert.equal(a.observationSha256,pair.observationSha256);assert.equal(a.writerPid,v.writer.processId);validateProjection(a.census,{allowOpaque:true});validateProjection(o.census);assert.ok(ackStart>=timestamp(o.dynamicCompletedAt)&&ackEnd>=ackStart&&ackAt>=ackEnd&&ackAt<=v.deadlineUnixMs&&ackAt-timestamp(o.dynamicStartedAt)<60000);
  compareProjections(o.census,a.census,[v.writer,o.observer]);assert.ok(timestamp(v.at)>=ackAt);if(i===1)assert.ok(timestamp(v.at)-timestamp(o.dynamicStartedAt)<60000&&timestamp(v.at)-ackStart<60000);previousAck=a;
 }
 return true;
}
function validateProjection(rows,{allowOpaque=false}={}){assert.ok(Array.isArray(rows)&&rows.length>0&&rows.length<=4096);const ids=new Set();for(const r of rows){keys(r,'processId parentProcessId name creationDate commandLineSha256 executablePathSha256 controlCandidate');assert.ok(Number.isSafeInteger(r.processId)&&r.processId>=0&&!ids.has(r.processId));ids.add(r.processId);assert.equal(r.controlCandidate,possible(r.name));assert.ok(Number.isSafeInteger(r.parentProcessId)&&r.parentProcessId>=0);if(r.controlCandidate){timestamp(r.creationDate);for(const k of ['commandLineSha256','executablePathSha256'])if(!allowOpaque||r[k]!==null)assert.match(r[k]??'',hex);}}}
function compareProjections(before,after,actors){const known=new Map(before.map(r=>[r.processId,r]));for(const r of after.filter(r=>r.controlCandidate)){const b=known.get(r.processId);assert.ok(b);for(const k of ['processId','parentProcessId','name','creationDate'])assert.equal(r[k],b[k]);for(const k of ['commandLineSha256','executablePathSha256'])if(r[k]!==null)assert.equal(r[k],b[k]);}for(const actor of actors){const a=before.find(r=>r.processId===actor.processId),b=after.find(r=>r.processId===actor.processId);assert.ok(a&&b);for(const r of [a,b]){assert.equal(r.creationDate,actor.creationDate);if(r.commandLineSha256!==null)assert.equal(r.commandLineSha256,sha(Buffer.from(actor.commandLine)));if(r.executablePathSha256!==null)assert.equal(r.executablePathSha256,sha(Buffer.from(actor.executablePath)));}}}
export function validateObservation(o,r){
 keys(o,'version requestSha256 phase nonce at writer observer observerCodeSha256 elevated completeCensus census relatedControllers taskState taskInstances taskDefinitionSha256 staticEvidence dynamicStartedAt dynamicCompletedAt');assert.equal(o.version,resolutionVersion);assert.equal(o.requestSha256,sha(Buffer.from(canonical(r))));for(const k of ['phase','nonce','staticEvidence'])assert.equal(o[k],r[k]);assert.deepEqual(o.writer,r.writer);identity(o.observer);assert.notEqual(o.observer.processId,r.writer.processId);assert.equal(o.observerCodeSha256,r.operatorFiles['cleaned-preparation-observer.mjs']);assert.equal(o.elevated,true);assert.equal(o.completeCensus,true);assert.deepEqual(o.relatedControllers,[]);assert.equal(o.taskState,3);assert.equal(o.taskInstances,0);assert.equal(o.taskDefinitionSha256,sha(Buffer.from(canonical(r.task.definition))));validateProjection(o.census);
 const start=timestamp(o.dynamicStartedAt),end=timestamp(o.dynamicCompletedAt),at=timestamp(o.at);assert.ok(start>=timestamp(r.at)&&end>=start&&at>=end&&at-start<60000&&at<=r.deadlineUnixMs);compareProjections(o.census,o.census,[r.writer,o.observer]);return true;
}
const domains=['worker-prepared-builds','worker-release-publication-staging','worker-release-rotation-consumptions','worker-release-rotation-plans','worker-release-successors'];
const workerRoot='D:/teruisi-runtime/teruisi-worker-sales',djangoRoot='D:/teruisi-runtime/django-sales';
function needles(dispatch){return [dispatch.dispatchId,dispatch.requestId,dispatch.selectedTarget,dispatch.selection.packet].map(decodedControlCommand);}
function assertNoCandidate(raw,dispatch,extra=[]){const text=decodedControlCommand(raw.toString('utf8'));for(const needle of [...needles(dispatch),...extra]){assert.ok(needle);assert.equal(text.includes(decodedControlCommand(needle)),false,'Candidate artifact remains');}}
export async function validateStaticProof(p,{dispatch,terminal,object}){
 keys(p,'version dispatchSha256 originalResultSha256 nativePreparationStarted candidateArtifactsAbsent packetFiles metadata staging sourceIdentity producerFiles');assert.equal(p.version,resolutionVersion);assert.equal(p.dispatchSha256,sha(Buffer.from(canonical(dispatch))));assert.equal(p.originalResultSha256,sha(Buffer.from(canonical(terminal))));assert.equal(p.nativePreparationStarted,true);assert.equal(p.candidateArtifactsAbsent,true);
 const prefix='publish-'+dispatch.selectedTarget.slice(0,12)+'/preparation/',names=p.packetFiles.map(x=>x.path).sort();assert.ok(names.includes('main-release-request.json')&&names.includes(prefix+'PREPARING.json')&&names.includes(prefix+'source-binding.json'));assert.equal(names.filter(n=>/^publish-[^/]+\/preparation\/FAILED-[a-f0-9-]+\.json$/.test(n)).length,1);assert.ok(names.every(n=>n==='main-release-request.json'||n===prefix+'PREPARING.json'||n===prefix+'source-binding.json'||/^FAILED-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/.test(n.slice(prefix.length))&&n.startsWith(prefix)),'Packet contains effects beyond failed preparation');assert.equal(new Set(names).size,names.length);assert.equal(names.length,4);
 const get=name=>{const item=p.packetFiles.find(x=>x.path===name);keys(item,'path size sha256');const raw=object(item.sha256);assert.equal(raw.length,item.size);return JSON.parse(raw);};
 const request=get('main-release-request.json'),preparing=get(prefix+'PREPARING.json'),failed=get(names.find(n=>/^FAILED-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/.test(n.slice(prefix.length))&&n.startsWith(prefix))),source=get(prefix+'source-binding.json');assert.equal(request.mainCommit,dispatch.selectedTarget);assert.deepEqual(request.predecessorWorker,dispatch.selection.live.head);assert.equal(request.predecessorDjangoSha256,dispatch.selection.live.djangoManifestSha256);assert.equal(preparing.requestSha256,sha(Buffer.from(JSON.stringify(request))));assert.equal(failed.mainCommit,dispatch.selectedTarget);assert.equal(failed.maintenanceStarted,false);assert.equal(failed.automaticRetry,false);assert.equal(failed.phase,'构建前端');const e=failed.processEvidence;assert.equal(e.version,1);assert.equal(e.code,'process_timeout');assert.equal(e.stage,'direct-exit');assert.equal(e.signal,null);assert.equal(e.nativeCode,null);assert.ok(e&&Number.isSafeInteger(e.processId)&&e.processId>0);assert.equal(e.cleanup,'tree');assert.equal(e.treeCleanupExitCode,0);assert.equal(e.treeCleanupPending,false);assert.equal(e.timeoutType,'direct-exit');assert.equal(e.outputProtocol,'eof');assert.equal(e.exitCode,1);assert.equal(e.deadlineUnixMs,dispatch.deadlineUnixMs);assert.equal(source.predecessorChainStateSha256,dispatch.selection.live.chainStateSha256);assert.deepEqual(source.predecessor,dispatch.selection.live.head);keys(p.sourceIdentity,'commit tree status');assert.equal(p.sourceIdentity.commit,dispatch.selectedTarget);assert.equal(p.sourceIdentity.tree,request.sourceTree);assert.equal(p.sourceIdentity.status,'');for(const d of [source.sourceRootPathSha256,source.identity?.sourceTree?.sha256])assert.match(d??'',hex);assert.ok(producerQualification.closures.some(c=>canonical(c)===canonical(p.producerFiles)),'Unqualified preparation producer code');for(const digest of Object.values(p.producerFiles))object(digest);const extra=[p.packetFiles.find(x=>x.path==='main-release-request.json').sha256,p.packetFiles.find(x=>x.path===prefix+'source-binding.json').sha256,source.sourceRootPathSha256,source.identity.sourceTree.sha256];
 assert.ok(p.metadata.files.length>0);const dirs=p.metadata.directories;for(const d of domains)assert.ok(dirs.includes(path.resolve(workerRoot,'state',d)));assert.ok(dirs.includes(path.resolve(workerRoot,'releases')));assert.ok(p.metadata.files.some(x=>x.path===path.resolve(workerRoot,'current-deployment.json')));assert.ok(p.metadata.files.some(x=>x.path===path.resolve(djangoRoot,'app/deployment.json')));
 const seen=new Set();for(const item of p.metadata.files){keys(item,'path size sha256');assert.ok(!seen.has(item.path));seen.add(item.path);const raw=object(item.sha256);assert.equal(raw.length,item.size);assertNoCandidate(raw,dispatch,extra);}
 keys(p.staging,'path entries');assert.equal(p.staging.path,path.resolve(workerRoot,'.staging'));for(const item of p.staging.entries){keys(item,'name birthtimeMs dev ino children');assert.deepEqual(item.children,[],'Nonempty staging requires separate reconciliation');assert.match(item.name,/^deploy-[a-f0-9-]{36}$/);assert.ok(item.birthtimeMs>0&&item.birthtimeMs<Date.parse(dispatch.dispatchedAt),'New staging may retain candidate');}return true;
}

/** Full static scans precede the fresh task/CIM window, as in cleaned-preparation. */
export async function collectPreparationState(dispatch,terminal,objects){
 const put=raw=>{const d=sha(raw);objects.set(d,raw);return d;};
 const packet=dispatch.selection.packet,packetFiles=[];await safeDirectory(packet);const request=JSON.parse(await stableBytes(path.join(packet,'main-release-request.json'))),sourceIdentity={...await assertFrozenSource({source:path.join(packet,'source'),mainCommit:dispatch.selectedTarget,sourceTree:request.sourceTree}),status:''};
 async function scanPacket(dir){const names=(await fs.readdir(dir)).sort();for(const n of names){if(dir===packet&&n==='source'){await safeDirectory(path.join(dir,n));continue;}const f=path.join(dir,n),s=await fs.lstat(f);if(s.isDirectory()){await safeDirectory(f);await scanPacket(f);}else{const raw=await stableBytes(f);packetFiles.push({path:path.relative(packet,f).replaceAll('\\','/'),size:raw.length,sha256:put(raw)});}}assert.deepEqual((await fs.readdir(dir)).sort(),names);}
 await scanPacket(packet);
 const metadata={directories:[],files:[]},add=async f=>{const raw=await stableBytes(f);assertNoCandidate(raw,dispatch);metadata.files.push({path:path.resolve(f),size:raw.length,sha256:put(raw)});};
 async function walk(dir,release=false){await safeDirectory(dir);metadata.directories.push(path.resolve(dir));const names=(await fs.readdir(dir)).sort();for(const n of names){const f=path.join(dir,n),s=await fs.lstat(f);if(release){await safeDirectory(f);await add(path.join(f,'deployment-manifest.json'));}else if(s.isDirectory())await walk(f);else{assert.match(n,/\.json(?:\.sha256)?$/);await add(f);}}assert.deepEqual((await fs.readdir(dir)).sort(),names);}
 for(const domain of domains)await walk(path.join(workerRoot,'state',domain));await walk(path.join(workerRoot,'releases'),true);await add(path.join(workerRoot,'current-deployment.json'));await add(path.join(djangoRoot,'app/deployment.json'));
 const djangoNames=(await fs.readdir(djangoRoot)).sort();for(const n of djangoNames){if(/^app\.prepare-[a-f0-9]{32}\.json$/.test(n))await add(path.join(djangoRoot,n));else if(/^app\.deploy-[a-f0-9]{32}$/.test(n))await add(path.join(djangoRoot,n,'deployment.json'));else assert.equal(/^app\.(?:prepare-|deploy-)/.test(n),false,'Unknown preparation artifact');}assert.deepEqual((await fs.readdir(djangoRoot)).sort(),djangoNames);
 const staging={path:path.resolve(workerRoot,'.staging'),entries:[]};await safeDirectory(staging.path);const names=(await fs.readdir(staging.path)).sort();for(const n of names){const f=path.join(staging.path,n);await safeDirectory(f);const s=await fs.lstat(f);staging.entries.push({name:n,birthtimeMs:s.birthtimeMs,dev:s.dev,ino:s.ino,children:(await fs.readdir(f)).sort()});}assert.deepEqual((await fs.readdir(staging.path)).sort(),names);
 const producerFiles={};for(const name of Object.keys(producerQualification.closures[0]))producerFiles[name]=put(await stableBytes(path.join(packet,'source/tools',name)));const proof={version:resolutionVersion,dispatchSha256:sha(Buffer.from(canonical(dispatch))),originalResultSha256:sha(Buffer.from(canonical(terminal))),nativePreparationStarted:true,candidateArtifactsAbsent:true,packetFiles,metadata,staging,sourceIdentity,producerFiles};await validateStaticProof(proof,{dispatch,terminal,object:d=>objects.get(d)});return proof;
}

/**
 * Decision `superseded-by-later-publication`.
 *
 * A dispatch may only be converged when ALL of the following hold and every
 * link is re-derived from archived bytes:
 *   a. its own preparation termination started no maintenance
 *      (maintenanceStarted=false, processEvidence=null), and any maintenance
 *      an attempt on the same packet did start was reconciled by the very
 *      publication that superseded it;
 *   b. the currently published main commit is exactly the dispatch target and
 *      the publication reached its ready terminal status;
 *   c. that publication carries a receipt whose bytes match the recorded
 *      sha256 and which names that exact attempt (path + start/failure bytes);
 *   d. the publication consumed the artifacts THIS dispatch prepared:
 *      candidate worker release/manifest and Django package ids in the receipt
 *      equal the ones recorded in this dispatch's PREPARED receipt.
 * Target equality alone never satisfies (d).
 */
function supersededFacts(o){
 const {dispatch,leaf,lock,sourceIdentity,source,request,preparing,prepared,plan,failed,failedName,started,attempt,main,mainRaw,receipt,receiptRaw,mainFile,receiptPath}=o;
 const target=dispatch.selectedTarget,packet=path.resolve(dispatch.selection.packet),requestDigest=sha(Buffer.from(JSON.stringify(request))),tree=sourceIdentity.tree;
 assert.equal(request.mainCommit,target,'Frozen request targets another commit');
 assert.deepEqual(request.predecessorWorker,dispatch.selection.live.head,'Frozen request predecessor worker changed');
 assert.equal(request.predecessorDjangoSha256,dispatch.selection.live.djangoManifestSha256,'Frozen request predecessor Django changed');
 assert.ok(Array.isArray(request.components)&&request.components.length>0);
 if(request.sourceTree!==undefined)assert.equal(request.sourceTree,tree,'Frozen request source tree changed');
 for(const s of [preparing,prepared]){assert.equal(s.sourceIdentity?.commit,target,'Preparation receipt source commit changed');assert.equal(s.sourceIdentity?.tree,tree,'Preparation receipt source tree changed');}
 assert.equal(preparing.requestSha256,requestDigest);assert.equal(prepared.requestSha256,requestDigest);
 assert.equal(prepared.version,'teruisi-main-preparation-v1');
 assert.ok(timestamp(preparing.at)>=timestamp(dispatch.dispatchedAt),'Preparation predates its dispatch');
 assert.ok(timestamp(preparing.at)<=timestamp(prepared.at)&&timestamp(prepared.at)<=timestamp(failed.at),'Preparation receipts are out of order');
 assert.equal(Boolean(prepared.workerPlan),request.components.includes('worker'));assert.equal(Boolean(prepared.djangoPackage),request.components.includes('django'));
 keys(prepared.workerPlan,'candidateGuardReceiptSha256 candidateManifestSha256 candidateReleaseId cutoverId planPath planSha256 predecessorReleaseId status version');
 assert.equal(plan.version,prepared.workerPlan.version);assert.equal(plan.planSha256,prepared.workerPlan.planSha256);assert.equal(plan.planPath,prepared.workerPlan.planPath);
 assert.equal(plan.status,'planned');assert.equal(plan.candidateReleaseId,prepared.workerPlan.candidateReleaseId);assert.equal(plan.candidateManifestSha256,prepared.workerPlan.candidateManifestSha256);assert.equal(plan.predecessorReleaseId,prepared.workerPlan.predecessorReleaseId);
 keys(prepared.djangoPackage,'appFingerprint id receiptSha256');
 assert.equal(source.version,'teruisi-worker-source-binding-v1');
 assert.equal(path.resolve(source.sourceRoot),path.join(packet,'source'),'Frozen source escaped the packet');
 assert.deepEqual(source.predecessor,dispatch.selection.live.head);assert.equal(source.predecessorChainStateSha256,dispatch.selection.live.chainStateSha256);
 assert.equal(sourceIdentity.commit,target,'Frozen source commit changed');assert.equal(sourceIdentity.tree,tree,'Frozen source tree changed');assert.equal(sourceIdentity.status,'');
 assert.equal(started.mainCommit,target);assert.equal(started.requestSha256,requestDigest);assert.equal(started.sourceTree,tree);
 assert.equal(path.resolve(started.source),path.join(packet,'source'));assert.equal(started.predecessorChainStateSha256,dispatch.selection.live.chainStateSha256);
 // (a) this dispatch never started maintenance.
 assert.equal(failed.mainCommit,target,'Preparation termination targeted another commit');
 assert.equal(typeof failed.phase,'string');assert.ok(failed.phase,'Preparation termination phase missing');assert.notEqual(failed.phase,'构建前端','A frontend build timeout cannot be superseded');
 assert.equal(typeof failed.error,'string');assert.ok(failed.error);assert.equal(failed.maintenanceStarted,false,'Maintenance already started');assert.equal(failed.processEvidence,null,'Preparation termination retained a live process');assert.equal(failed.automaticRetry,false);
 assert.equal(attempt.mainCommit,target,'Original attempt targeted another commit');
 assert.equal(typeof attempt.phase,'string');assert.ok(attempt.phase);assert.equal(typeof attempt.maintenanceStarted,'boolean');assert.equal(attempt.automaticRetry,false);
 let actor=null;
 if(attempt.maintenanceStarted){assert.ok(attempt.processEvidence&&Number.isSafeInteger(attempt.processEvidence.processId)&&attempt.processEvidence.processId>0,'Original attempt started without an identifiable actor');actor=attempt.processEvidence.processId;}
 else assert.equal(attempt.processEvidence,null,'Original attempt claims no maintenance but retained a process');
 // (b) the dispatch target is the published commit, in its ready terminal status.
 assert.equal(main.mainCommit,target,'Later publication deployed another commit');assert.equal(main.status,'deployed_and_ready');assert.equal(main.startupVerified,true);assert.equal(main.readyVerified,true);
 assert.equal(receipt.mainCommit,target);assert.equal(receipt.status,'deployed_and_ready');assert.equal(receipt.startupVerified,true);assert.equal(receipt.readyVerified,true);
 assert.equal(main.at,receipt.at);assert.ok(timestamp(receipt.at)>=timestamp(failed.at),'Later publication predates the dispatch termination');
 // (c) the receipt is byte-verified and names this exact attempt.
 assert.equal(receipt.originalAttempt,path.resolve(main.originalAttempt));
 assert.equal(path.resolve(main.originalAttempt),path.join(packet,leaf),'Later publication resumed another packet');
 assert.equal(receipt.originalStartedSha256,lock(leaf+'/STARTED.json').sha256,'Successor receipt did not consume this start receipt');
 assert.equal(receipt.originalFailureSha256,lock(leaf+'/FAILED.json').sha256,'Successor receipt did not consume this failure receipt');
 assert.equal(main.originalStartedSha256,receipt.originalStartedSha256);assert.equal(main.originalFailureSha256,receipt.originalFailureSha256);
 assert.equal(main.originalStartReconciled,receipt.originalStartReconciled);assert.equal(main.originalStartExitedSuccessfully,receipt.originalStartExitedSuccessfully);
 if(actor===null)assert.equal(main.originalStartReconciled,false,'Reconciliation claimed without a started attempt');
 else{assert.equal(main.originalStartReconciled,true,'Interrupted maintenance was not reconciled');assert.equal(main.originalStartExitedSuccessfully,false);}
 // (d) the publication consumed THIS dispatch's prepared candidate.
 assert.equal(receipt.workerRelease,prepared.workerPlan.candidateReleaseId,'Successor published another worker release');
 assert.equal(receipt.workerManifestSha256,prepared.workerPlan.candidateManifestSha256,'Successor published another worker manifest');
 assert.equal(receipt.djangoPreparedId,prepared.djangoPackage.id,'Successor published another Django package');
 assert.equal(receipt.djangoManifestSha256,prepared.djangoManifestSha256,'Successor published another Django manifest');
 assert.equal(main.workerRelease,receipt.workerRelease);assert.equal(main.workerManifestSha256,receipt.workerManifestSha256);assert.equal(main.djangoPreparedId,receipt.djangoPreparedId);assert.equal(main.djangoManifestSha256,receipt.djangoManifestSha256);
 assert.equal(receipt.sourceTree,tree,'Successor published another source tree');
 assert.equal(main.sourceTree?.sha256,source.identity?.sourceTree?.sha256,'Successor published state names another source inventory');assert.match(source.identity?.sourceTree?.sha256??'',hex);
 assert.equal(path.resolve(receipt.source),path.join(packet,'source'));
 return {
  preparation:{...lock(leaf+'/preparation/PREPARED.json'),requestSha256:requestDigest,sourceTree:tree,at:prepared.at,workerRelease:prepared.workerPlan.candidateReleaseId,workerManifestSha256:prepared.workerPlan.candidateManifestSha256,djangoPreparedId:prepared.djangoPackage.id,djangoManifestSha256:prepared.djangoManifestSha256},
  preparationTermination:{...lock(leaf+'/preparation/'+failedName),phase:failed.phase,at:failed.at,maintenanceStarted:false,automaticRetry:false},
  originalAttemptTermination:{...lock(leaf+'/FAILED.json'),phase:attempt.phase,at:attempt.at,maintenanceStarted:attempt.maintenanceStarted,automaticRetry:attempt.automaticRetry,actorProcessId:actor},
  successorPublication:{mainFile:path.resolve(mainFile),mainFileSha256:sha(mainRaw),receiptPath:path.resolve(receiptPath),receiptSha256:sha(receiptRaw),status:main.status,mainCommit:target,at:main.at,
   originalAttempt:path.resolve(receipt.originalAttempt),originalStartedSha256:receipt.originalStartedSha256,originalFailureSha256:receipt.originalFailureSha256,
   originalAttemptStarted:attempt.maintenanceStarted,originalStartReconciled:receipt.originalStartReconciled,originalStartExitedSuccessfully:receipt.originalStartExitedSuccessfully,originalActorProcessId:actor,
   startupVerified:main.startupVerified,readyVerified:main.readyVerified,
   workerRelease:receipt.workerRelease,workerManifestSha256:receipt.workerManifestSha256,djangoPreparedId:receipt.djangoPreparedId,djangoManifestSha256:receipt.djangoManifestSha256,
   source:path.resolve(receipt.source),sourceTree:receipt.sourceTree}
 };
}
export async function validateSupersededStaticProof(p,{dispatch,terminal,object,directory}){
 keys(p,'decision dispatchSha256 maintenanceStarted originalAttemptTermination originalResultSha256 packetFiles preparation preparationTermination prepared producerFiles sourceIdentity successorPublication version');
 assert.equal(p.version,resolutionVersion);assert.equal(p.decision,resolutionDecisions.supersededByLaterPublication);
 assert.equal(p.dispatchSha256,sha(Buffer.from(canonical(dispatch))));assert.equal(p.originalResultSha256,sha(Buffer.from(canonical(terminal))));
 assert.equal(p.maintenanceStarted,false);assert.equal(p.prepared,true);
 const leaf='publish-'+dispatch.selectedTarget.slice(0,12),isFailed=new RegExp('^'+leaf+'/preparation/FAILED-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\\.json$');
 keys(p.preparation,preparationKeys);keys(p.preparationTermination,terminationKeys);keys(p.originalAttemptTermination,attemptTerminationKeys);keys(p.successorPublication,successorKeys);
 assert.ok(Array.isArray(p.packetFiles));for(const item of p.packetFiles)keys(item,'path sha256 size');
 const names=p.packetFiles.map(x=>x.path).sort();assert.equal(new Set(names).size,names.length,'Duplicate packet file');assert.equal(names.filter(n=>isFailed.test(n)).length,1,'Preparation packet must retain exactly one failure receipt');
 for(const n of ['main-release-request.json',leaf+'/FAILED.json',leaf+'/STARTED.json',leaf+'/preparation/PREPARED.json',leaf+'/preparation/PREPARING.json',leaf+'/preparation/source-binding.json',leaf+'/preparation/worker-plan.json'])assert.ok(names.includes(n),'Packet artifact missing: '+n);
 assert.equal(names.length,8,'Packet contains artifacts beyond the superseded preparation closure');
 const failedPath=names.find(n=>isFailed.test(n));
 const archive=d=>{assert.match(d??'',hex);const raw=object(d);assert.ok(raw,'Missing archive object');assert.equal(sha(raw),d);return raw;};
 const json=d=>{const raw=archive(d),value=JSON.parse(raw);assert.equal(raw.toString('utf8'),canonical(value),'Noncanonical protocol object');return value;};
 const get=name=>{const item=p.packetFiles.find(x=>x.path===name);assert.ok(item,'Packet artifact missing: '+name);const raw=archive(item.sha256);assert.equal(raw.length,item.size);return JSON.parse(raw);};
 const lock=name=>{const item=p.packetFiles.find(x=>x.path===name);assert.ok(item,'Packet artifact missing: '+name);archive(item.sha256);return {path:item.path,sha256:item.sha256};};
 const successor=p.successorPublication;
 assert.equal(path.resolve(successor.mainFile),path.join(path.dirname(path.resolve(directory)),'PUBLISHED-MAIN.json'),'Published state escaped the queue generation');
 assert.ok(path.isAbsolute(successor.receiptPath)&&path.isAbsolute(successor.originalAttempt));
 const mainRaw=archive(successor.mainFileSha256),receiptRaw=archive(successor.receiptSha256),main=JSON.parse(mainRaw),receipt=JSON.parse(receiptRaw);
 assert.equal(main.receiptPath,successor.receiptPath,'Recorded receipt path differs from the published state');assert.equal(main.receiptSha256,successor.receiptSha256,'Recorded receipt digest differs from the published state');
 const facts=supersededFacts({dispatch,leaf,lock,sourceIdentity:p.sourceIdentity,source:get(leaf+'/preparation/source-binding.json'),request:get('main-release-request.json'),preparing:get(leaf+'/preparation/PREPARING.json'),prepared:get(leaf+'/preparation/PREPARED.json'),plan:get(leaf+'/preparation/worker-plan.json'),failedName:failedPath.split('/').pop(),failed:get(failedPath),started:get(leaf+'/STARTED.json'),attempt:get(leaf+'/FAILED.json'),main,mainRaw,receipt,receiptRaw,mainFile:successor.mainFile,receiptPath:successor.receiptPath});
 for(const k of ['preparation','preparationTermination','originalAttemptTermination','successorPublication'])assert.deepEqual(p[k],facts[k],'Recorded superseded fact differs from the archived receipts: '+k);
 for(const digest of Object.values(p.producerFiles))archive(digest);
 assert.ok(producerQualification.closures.some(c=>canonical(c)===canonical(p.producerFiles)),'Unqualified preparation producer code');return true;
}
export async function collectSupersededPreparationState(dispatch,terminal,objects,{directory}={}){
 assert.ok(directory&&path.isAbsolute(String(directory)),'Queue directory required for the superseded decision');
 const put=raw=>{const d=sha(raw);objects.set(d,raw);return d;};
 const packet=path.resolve(dispatch.selection.packet);await safeDirectory(packet);
 const leaf='publish-'+dispatch.selectedTarget.slice(0,12),publicationDir=path.join(packet,leaf),preparationDir=path.join(publicationDir,'preparation');
 await safeDirectory(publicationDir);await safeDirectory(preparationDir);
 const requestRaw=await stableBytes(path.join(packet,'main-release-request.json')),request=JSON.parse(requestRaw);
 const sourceIdentity={...await assertFrozenSource({source:path.join(packet,'source'),mainCommit:dispatch.selectedTarget,sourceTree:request.sourceTree}),status:''};
 const names=(await fs.readdir(preparationDir)).sort(),failedNames=names.filter(n=>/^FAILED-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/.test(n));
 assert.equal(failedNames.length,1,'Preparation packet must retain exactly one failure receipt');
 for(const name of names){const target=path.join(preparationDir,name),stat=await fs.lstat(target);if(stat.isDirectory()){assert.match(name,/^verify-[A-Za-z0-9]+$/,'Unknown preparation artifact: '+name);continue;}assert.ok(['PREPARED.json','PREPARING.json','source-binding.json','worker-plan.json'].includes(name)||failedNames.includes(name),'Unknown preparation artifact: '+name);}
 const packetFiles=[],take=async(abs,rel)=>{const raw=await stableBytes(abs);packetFiles.push({path:rel,size:raw.length,sha256:put(raw)});return raw;};
 await take(path.join(packet,'main-release-request.json'),'main-release-request.json');
 await take(path.join(preparationDir,'PREPARING.json'),leaf+'/preparation/PREPARING.json');
 await take(path.join(preparationDir,'source-binding.json'),leaf+'/preparation/source-binding.json');
 await take(path.join(preparationDir,'PREPARED.json'),leaf+'/preparation/PREPARED.json');
 await take(path.join(preparationDir,'worker-plan.json'),leaf+'/preparation/worker-plan.json');
 await take(path.join(preparationDir,failedNames[0]),leaf+'/preparation/'+failedNames[0]);
 await take(path.join(publicationDir,'STARTED.json'),leaf+'/STARTED.json');
 await take(path.join(publicationDir,'FAILED.json'),leaf+'/FAILED.json');
 const stateRoot=path.dirname(path.resolve(directory)),mainFile=path.join(stateRoot,'PUBLISHED-MAIN.json');
 const mainRaw=await stableBytes(mainFile),main=JSON.parse(mainRaw);put(mainRaw);
 assert.ok(typeof main.receiptPath==='string'&&path.isAbsolute(main.receiptPath),'Published state retains no absolute receipt');
 const receiptRaw=await stableBytes(main.receiptPath),receipt=JSON.parse(receiptRaw);put(receiptRaw);
 assert.equal(sha(receiptRaw),main.receiptSha256,'Published receipt digest changed');
 const producerFiles={};for(const name of Object.keys(producerQualification.closures[0]))producerFiles[name]=put(await stableBytes(path.join(packet,'source/tools',name)));
 const lock=name=>{const item=packetFiles.find(x=>x.path===name);assert.ok(item,'Packet artifact missing: '+name);return {path:item.path,sha256:item.sha256};};
 const get=name=>{const item=packetFiles.find(x=>x.path===name);assert.ok(item,'Packet artifact missing: '+name);return JSON.parse(objects.get(item.sha256));};
 const facts=supersededFacts({dispatch,leaf,lock,sourceIdentity,source:get(leaf+'/preparation/source-binding.json'),request:get('main-release-request.json'),preparing:get(leaf+'/preparation/PREPARING.json'),prepared:get(leaf+'/preparation/PREPARED.json'),plan:get(leaf+'/preparation/worker-plan.json'),failedName:failedNames[0],failed:get(leaf+'/preparation/'+failedNames[0]),started:get(leaf+'/STARTED.json'),attempt:get(leaf+'/FAILED.json'),main,mainRaw,receipt,receiptRaw,mainFile,receiptPath:main.receiptPath});
 const proof={version:resolutionVersion,decision:resolutionDecisions.supersededByLaterPublication,dispatchSha256:sha(Buffer.from(canonical(dispatch))),originalResultSha256:sha(Buffer.from(canonical(terminal))),maintenanceStarted:false,prepared:true,packetFiles,...facts,sourceIdentity,producerFiles};
 await validateSupersededStaticProof(proof,{dispatch,terminal,object:d=>objects.get(d),directory});
 return proof;
}
export async function validateSupersededResolution(v,{dispatch,terminal,objects}){
 keys(v,'adoptionSha256 at deadlineUnixMs decision dispatchId dispatchSha256 epoch evidenceDirectory maintenanceStarted nativePreparationStarted observations operatorFiles originalAttemptTermination originalResultSha256 preparation preparationTermination prepared publicationPerformed requestId retryOriginal selectedTarget staticEvidence successorPublication terminationBasis version writer writerToken');
 assert.equal(v.version,resolutionVersion);assert.equal(v.decision,resolutionDecisions.supersededByLaterPublication);assert.equal(v.terminationBasis,supersededTerminationBasis);
 for(const [k,x]of Object.entries(bindingOf(dispatch,terminal)))assert.equal(v[k],x,'Resolution binding mismatch: '+k);
 assert.equal(v.nativePreparationStarted,true);assert.equal(v.maintenanceStarted,false);assert.equal(v.prepared,true);for(const k of ['publicationPerformed','retryOriginal'])assert.equal(v[k],false);
 epoch(v.epoch,v.deadlineUnixMs,v.writer);assert.ok(timestamp(v.at)<=v.deadlineUnixMs&&timestamp(v.at)>=timestamp(v.epoch.startedAt));
 const directory=path.dirname(path.dirname(path.resolve(v.evidenceDirectory)));
 const object=d=>{assert.match(d??'',hex);const raw=objects.get(d);assert.ok(raw,'Missing archive object');assert.equal(sha(raw),d);return raw;},json=d=>{const raw=object(d),value=JSON.parse(raw);assert.equal(raw.toString('utf8'),canonical(value),'Noncanonical protocol object');return value;};
 for(const [d,raw]of objects){assert.match(d,hex);assert.equal(sha(raw),d);}
 const adoption=JSON.parse(object(v.adoptionSha256));assert.equal(adoption.version,'teruisi-main-control-installation-v3');assert.equal(adoption.status,'adopted');assert.equal(adoption.preparationTask.sid,v.writerToken.sid);keys(v.writerToken,'sid sessionId elevated integrityRid');assert.match(v.writerToken.sid,/^S-1-\d+(?:-\d+)+$/);assert.equal(v.writerToken.elevated,false);assert.equal(v.writerToken.integrityRid,8192);assert.ok(Number.isSafeInteger(v.writerToken.sessionId)&&v.writerToken.sessionId>0);
 const manifest=json(adoption.bundleManifestSha256);assert.equal(manifest.version,'teruisi-main-control-bundle-v2');assert.equal(sha(Buffer.from(canonical(manifest.files))),adoption.bundleSha256);assert.equal(manifest.bundleSha256,adoption.bundleSha256);
 assert.match(manifest.sourceCommit,/^[a-f0-9]{40}$/);assert.match(manifest.sourceTree,/^[a-f0-9]{40}$/);assert.match(adoption.installId,uuid);assert.ok(timestamp(adoption.adoptedAt)<=timestamp(v.epoch.startedAt));
 assert.equal(adoption.configSha256,dispatch.configSha256,'Configuration changed since original dispatch');object(adoption.configSha256);
 const intent=json(adoption.intentSha256),transition=json(adoption.transitionProofSha256);assert.equal(intent.version,'teruisi-main-control-upgrade-v2');assert.equal(intent.installId,adoption.installId);for(const key of ['bundleRoot','bundleSha256','bundleManifestSha256','dispatcherSha256','hook','hookSha256','configSha256'])assert.equal(intent[key],adoption[key]);assert.deepEqual(intent.preparationTask,adoption.preparationTask);assert.equal(intent.sourceCommit,manifest.sourceCommit);assert.equal(intent.sourceTree,manifest.sourceTree);
 assert.equal(transition.version,'teruisi-main-control-transition-v2');assert.equal(transition.installId,adoption.installId);assert.equal(transition.intentSha256,adoption.intentSha256);assert.deepEqual(transition.lockOrder,['v1-queue','v2-queue','native-rotation']);assert.equal(transition.rotationPipeSha256,sha('\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1'));for(const key of ['productionDeploymentPerformed','privateTestTopology'])assert.equal(transition[key],false);assert.equal(transition.legacyWindowConverged,true);assert.ok(transition.frames?.length>=3);for(const frame of transition.frames.slice(-3)){assert.deepEqual(frame.related,[]);assert.ok(timestamp(frame.at)<=timestamp(adoption.adoptedAt));}object(adoption.dispatcherSha256);object(adoption.hookSha256);for(const digest of Object.values(manifest.files))object(digest);
 assert.deepEqual(Object.keys(v.operatorFiles).sort(),operatorNames.toSorted());for(const name of operatorNames){assert.equal(v.operatorFiles[name],manifest.files['tools/'+name]);object(v.operatorFiles[name]);}
 keys(v.staticEvidence,'initial final');const initial=json(v.staticEvidence.initial),final=json(v.staticEvidence.final);
 for(const s of [initial,final]){keys(s,'startedAt completedAt proof');assert.ok(timestamp(s.startedAt)>=timestamp(v.epoch.startedAt)&&timestamp(s.completedAt)>=timestamp(s.startedAt)&&timestamp(s.completedAt)<=v.deadlineUnixMs);await validateSupersededStaticProof(s.proof,{dispatch,terminal,object,directory});}
 assert.deepEqual(initial.proof,final.proof,'Complete inventories changed');
 for(const k of ['preparation','preparationTermination','originalAttemptTermination','successorPublication'])assert.deepEqual(initial.proof[k],v[k],'Resolution fact differs from the archived scan: '+k);
 const failedActor=v.originalAttemptTermination.actorProcessId;
 assert.ok(Array.isArray(v.observations)&&v.observations.length===2);let previousAck=null,previousNonce=null;
 for(const [i,pair]of v.observations.entries()){
  keys(pair,'requestSha256 observationSha256 ackSha256');const r=json(pair.requestSha256),o=json(pair.observationSha256),a=json(pair.ackSha256),s=i===0?initial:final;
  keys(r,'version decision phase nonce at binding writer epoch deadlineUnixMs adoptionSha256 operatorFiles staticEvidence task evidenceDirectory');assert.equal(r.version,resolutionVersion);assert.equal(r.decision,resolutionDecisions.supersededByLaterPublication);assert.equal(r.phase,i===0?'initial':'final');assert.deepEqual(r.binding,bindingOf(dispatch,terminal));assert.deepEqual(r.writer,v.writer);assert.deepEqual(r.epoch,v.epoch);assert.equal(r.deadlineUnixMs,v.deadlineUnixMs);assert.equal(r.adoptionSha256,v.adoptionSha256);assert.deepEqual(r.operatorFiles,v.operatorFiles);assert.deepEqual(r.task,adoption.preparationTask);assert.equal(r.evidenceDirectory,v.evidenceDirectory);assert.equal(r.staticEvidence,i===0?v.staticEvidence.initial:v.staticEvidence.final);assert.match(r.nonce,/^[a-f0-9]{32}$/);assert.notEqual(r.nonce,previousNonce);previousNonce=r.nonce;
  assert.ok(timestamp(r.at)>=timestamp(s.completedAt));if(previousAck)assert.ok(timestamp(s.startedAt)>=timestamp(previousAck.at));
  validateObservation(o,r);if(failedActor!==null)assert.ok(!o.census.some(row=>row.processId===failedActor),'Original failed actor remains');if(failedActor!==null)assert.ok(!a.census.some(row=>row.processId===failedActor),'Original failed actor appeared after witness');const ackStart=timestamp(a.censusStartedAt),ackEnd=timestamp(a.censusCompletedAt),ackAt=timestamp(a.at);keys(a,'requestSha256 observationSha256 writerPid censusStartedAt censusCompletedAt at census');assert.equal(a.requestSha256,pair.requestSha256);assert.equal(a.observationSha256,pair.observationSha256);assert.equal(a.writerPid,v.writer.processId);validateProjection(a.census,{allowOpaque:true});validateProjection(o.census);assert.ok(ackStart>=timestamp(o.dynamicCompletedAt)&&ackEnd>=ackStart&&ackAt>=ackEnd&&ackAt<=v.deadlineUnixMs&&ackAt-timestamp(o.dynamicStartedAt)<60000);
  compareProjections(o.census,a.census,[v.writer,o.observer]);assert.ok(timestamp(v.at)>=ackAt);if(i===1)assert.ok(timestamp(v.at)-timestamp(o.dynamicStartedAt)<60000&&timestamp(v.at)-ackStart<60000);previousAck=a;
 }
 return true;
}

export async function loadOperator(bundleRoot){
 const manifest=(await readQueueObject(path.join(bundleRoot,'MANIFEST.json'))).value;assert.equal(manifest.version,'teruisi-main-control-bundle-v2');assert.equal(manifest.bundleSha256,sha(Buffer.from(canonical(manifest.files))));const files={};for(const name of operatorNames){const raw=await stableBytes(path.join(bundleRoot,'tools',name));assert.equal(sha(raw),manifest.files['tools/'+name],'Frozen operator changed');files[name]=sha(raw);}return {manifest,files};
}
/** Dependency injection is confined to tests; CLI always uses the native adapter. */
export async function writePreparationResolution({directory,dispatchId,bundleRoot,out,adapter,decision=resolutionDecisions.cleanedBeforePlan,onStage=()=>{}}){
 assert.match(dispatchId,uuid);assert.ok(knownDecisions.has(decision),'Unknown resolution decision');
 directory=path.resolve(directory);bundleRoot=path.resolve(bundleRoot);out=path.resolve(out);
 const superseded=decision===resolutionDecisions.supersededByLaterPublication;
 const unlock=await acquireQueueLock(directory);assert.ok(unlock,'Queue busy');let rotation;
 try{
  const inventory=await readPreparationQueueInventory(directory),record=inventory.dispatches.find(x=>x.value.dispatchId===dispatchId);assert.ok(record,'Dispatch absent');const dispatch=record.value,terminal=inventory.terminals.get(dispatch.requestId);assert.ok(terminal);const binding=bindingOf(dispatch,terminal);
  if(await readPreparationResolution(directory,dispatch,terminal)){
   assert.equal(superseded,false,'Dispatch already carries a resolution; a second convergence is refused');
   return {status:'already-resolved',dispatchId,publicationPerformed:false};
  }
  // Fail closed before any evidence object is created for the superseded decision.
  if(superseded)await adapter.collect(dispatch,terminal,new Map(),{decision,directory});
  rotation=await adapter.acquireRotation();const frozen=await loadOperator(bundleRoot),adopted=await adapter.adopted();assert.equal(adopted.state.bundleSha256,frozen.manifest.bundleSha256,'Use the adopted frozen operator bundle');const token=await adapter.ordinary(adopted.state.preparationTask.sid),writer=await adapter.identity();identity(writer);assert.equal(writer.processId,process.pid);
  const ep={id:randomUUID(),startedAt:new Date().toISOString(),writerPid:writer.processId},deadlineUnixMs=Date.parse(ep.startedAt)+20*60*1000,objects=new Map(),put=raw=>{const d=sha(raw);objects.set(d,raw);return d;},putJson=v=>put(Buffer.from(canonical(v)));
  const adoptionRaw=await stableBytes(path.join(path.dirname(directory),'CONTROL-INSTALLATION.json'));assert.equal(sha(adoptionRaw),adopted.stateSha256);put(adoptionRaw);const manifestRaw=await stableBytes(path.join(bundleRoot,'MANIFEST.json'));assert.equal(sha(manifestRaw),adopted.state.bundleManifestSha256);put(manifestRaw);for(const name of Object.keys(frozen.manifest.files))put(await stableBytes(path.join(bundleRoot,name)));for(const [file,digest]of [[adopted.configFile,adopted.state.configSha256],[path.join(path.dirname(directory),'control-upgrades',adopted.state.installId,'INTENT.json'),adopted.state.intentSha256],[adopted.state.transitionProofFile,adopted.state.transitionProofSha256],[path.join(path.dirname(directory),'control/tools/publish-latest-main.mjs'),adopted.state.dispatcherSha256],[adopted.state.hook,adopted.state.hookSha256]]){const raw=await stableBytes(file);assert.equal(sha(raw),digest);put(raw);}
  await safeDirectory(path.dirname(out));assert.equal(await exists(out),false,'Use a new private output directory');await fs.mkdir(out);const evidenceDirectory=path.join(directory,'resolutions',dispatchId+'-evidence');await fs.mkdir(path.dirname(evidenceDirectory),{recursive:true});await fs.mkdir(evidenceDirectory);await fs.mkdir(path.join(evidenceDirectory,'objects'));
  const copied=new Set(),copy=async()=>{for(const[d,raw]of objects){if(copied.has(d))continue;const h=await fs.open(path.join(evidenceDirectory,'objects',d+'.bin'),'wx');try{await h.writeFile(raw);await h.sync();}finally{await h.close();}copied.add(d);}};
  const cas=async()=>{assert.equal(sha(await stableBytes(path.join(directory,'dispatches',dispatchId+'.json'))),binding.dispatchSha256);assert.equal(sha(await stableBytes(path.join(directory,'results',binding.requestId+'.json'))),binding.originalResultSha256);assert.equal(sha(await stableBytes(path.join(path.dirname(directory),'CONTROL-INSTALLATION.json'))),adopted.stateSha256);};
  const staticEvidence={},observations=[];
  for(const phase of ['initial','final']){
   assert.ok(Date.now()<deadlineUnixMs);await adapter.assertAdopted(adopted);await adapter.ordinary(adopted.state.preparationTask.sid);await cas();
   const startedAt=new Date().toISOString(),proof=await adapter.collect(dispatch,terminal,objects,{decision,directory}),s={startedAt,completedAt:new Date().toISOString(),proof};staticEvidence[phase]=putJson(s);if(phase==='final')assert.deepEqual(proof,JSON.parse(objects.get(staticEvidence.initial)).proof);await copy();
   const r={version:resolutionVersion,...(superseded?{decision}:{}),phase,nonce:randomUUID().replaceAll('-',''),at:new Date().toISOString(),binding,writer,epoch:ep,deadlineUnixMs,adoptionSha256:adopted.stateSha256,operatorFiles:frozen.files,staticEvidence:staticEvidence[phase],task:adopted.state.preparationTask,evidenceDirectory};const requestFile=path.join(out,'REQUEST-'+phase+'.json'),requestSha256=await durableCreate(requestFile,r);onStage({status:'awaiting-independent-read-only-observer',requestFile,requestSha256,observerCommand:{file:process.execPath,args:[path.join(bundleRoot,'tools/cleaned-preparation-observer.mjs'),'--request',requestFile,'--sha',requestSha256,'--out',path.join(out,'OBSERVATION-'+phase+'.json')]}});
   const o=await adapter.observe(r,requestFile,out);validateObservation(o,r);await cas();const censusStartedAt=new Date().toISOString(),fresh=await adapter.census(),censusCompletedAt=new Date().toISOString();assertCrossCensus(o.census,fresh.rows,{protectedPids:[writer.processId,o.observer.processId],roots:[path.dirname(directory),dispatch.selection.packet]});const a={requestSha256,observationSha256:putJson(o),writerPid:writer.processId,censusStartedAt,censusCompletedAt,at:new Date().toISOString(),census:censusProjection(fresh.rows)};await durableCreate(path.join(out,'ACK-'+phase+'.json'),a);observations.push({requestSha256:putJson(r),observationSha256:putJson(o),ackSha256:putJson(a)});await copy();
  }
  await cas();const finalProof=JSON.parse(objects.get(staticEvidence.final)).proof;
  const decisionFacts=superseded
   ?{terminationBasis:supersededTerminationBasis,nativePreparationStarted:true,maintenanceStarted:false,prepared:true,publicationPerformed:false,retryOriginal:false,preparation:finalProof.preparation,preparationTermination:finalProof.preparationTermination,originalAttemptTermination:finalProof.originalAttemptTermination,successorPublication:finalProof.successorPublication}
   :{terminationBasis:'confirmed-tree-cleanup-before-plan',nativePreparationStarted:true,candidateArtifactsAbsent:true,prepared:false,publicationPerformed:false,retryOriginal:false};
  const value={version:resolutionVersion,decision,at:new Date().toISOString(),...binding,evidenceDirectory,...decisionFacts,writer,writerToken:token,epoch:ep,deadlineUnixMs,adoptionSha256:adopted.stateSha256,operatorFiles:frozen.files,staticEvidence,observations};
  if(superseded)await validateSupersededResolution(value,{dispatch,terminal,objects});else await validateResolution(value,{dispatch,terminal,objects});
  await copy();await cas();const resolution=path.join(directory,'resolutions',dispatchId+'.json'),resolutionSha256=await durableCreate(resolution,value);await readPreparationResolution(directory,dispatch,terminal);return {status:'resolved',dispatchId,resolution,resolutionSha256,evidenceTreeSha256:sha(Buffer.from(canonical(await evidenceInventory(evidenceDirectory)))),originalResultSha256:binding.originalResultSha256,publicationPerformed:false,prepared:superseded,retryOriginal:false};
 }finally{try{await rotation?.();}finally{await unlock();}}
}
