/** Exact eab ready-tail accounting recovery. No application action is available. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const targetCommit='eab998f81c984ee3d9e722bcd39f0f46a53a9820';
export const recoveryId='eab998f8-ready-tail-20261103';
export const evidenceVersion='teruisi-eab-ready-tail-evidence-v1';
const here=path.dirname(fileURLToPath(import.meta.url)),repository=path.resolve(here,'../..');
const execute=promisify(execFile),hash=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const json=b=>JSON.parse(b.toString('utf8'));
const encode=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const labels={'部署后台':'DeployApp','应用后台权限':'HardenAcl','退出维护':'ExitMaintenance','启动服务':'Start','确认启动版本':'VerifyStartup'};
async function exists(file){try{await fs.lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function absent(file){assert.equal(await exists(file),false,'Must remain absent: '+file);}
async function physical(target){let current=path.resolve(target);for(;;){const s=await fs.lstat(current);assert.equal(s.isSymbolicLink(),false,'Redirected recovery path: '+current);assert.equal(same(await fs.realpath(current),current),true,'Redirected recovery path');const next=path.dirname(current);if(next===current)return;current=next;}}
async function bytes(file){await physical(file);const before=await fs.lstat(file);assert.ok(before.isFile()&&before.nlink===1&&before.size<=4*1024*1024,'Unsafe or oversized recovery evidence: '+file);const b=await fs.readFile(file),after=await fs.lstat(file);for(const key of ['ino','dev','size','mtimeMs','ctimeMs','nlink'])assert.equal(after[key],before[key],'Evidence changed during read');return b;}
async function durable(file,b){const h=await fs.open(file,'wx');try{await h.writeFile(b);await h.sync();}finally{await h.close();}}
async function onceSame(file,b){if(await exists(file)){assert.deepEqual(await bytes(file),b,'Existing recovery record differs: '+file);return;}await durable(file,b);}
async function fileHash(file){return hash(await bytes(file));}
const receiptPathFor=r=>path.join(r.stateDirectory,'accounting-recoveries',r.recoveryId,'RECOVERED-SUCCESS.json');

export async function inspectOriginal(r){
 assert.equal(r.version,evidenceVersion);assert.equal(r.mainCommit,targetCommit);assert.equal(r.recoveryId,recoveryId);
 const p=r.paths;
 for(const pin of r.pins)assert.equal(await fileHash(pin.path),pin.sha256,'Original evidence changed: '+pin.path);
 for(const file of [path.join(r.attempt,'SUCCESS.json'),path.join(r.attempt,'resume')])await absent(file);
 const request=json(await bytes(p.request)),prepared=json(await bytes(p.prepared)),started=json(await bytes(p.started)),failed=json(await bytes(p.failed));
 assert.equal(request.version,'teruisi-frozen-latest-main-request-v1');assert.equal(request.latestMainRelease,true);
 assert.equal(request.mainCommit,r.mainCommit);assert.equal(started.mainCommit,r.mainCommit);assert.equal(failed.mainCommit,r.mainCommit);
 assert.equal(started.resumeProtocol,'teruisi-pi-main-resume-v1');assert.equal(same(started.source,r.source),true);
 assert.equal(same(r.attempt,path.join(path.dirname(r.source),'publish-'+r.mainCommit.slice(0,12))),true);
 assert.equal(hash(Buffer.from(JSON.stringify(request))),started.requestSha256);assert.equal(prepared.requestSha256,started.requestSha256);
 assert.equal(prepared.version,'teruisi-main-preparation-v1');assert.deepEqual(prepared.sourceIdentity,{commit:r.mainCommit,tree:started.sourceTree});
 assert.deepEqual(request.components,['worker','django']);assert.deepEqual(started.components,request.components);
 assert.equal(request.migrate,false);assert.equal(request.releasePlan.migrate,false);assert.equal(request.releasePlan.headSha,r.mainCommit);assert.equal(request.releasePlan.baseSha,request.deployedCommit);assert.deepEqual(request.releasePlan.components,request.components);
 for(const value of [request.schemaRelease,request.completedTask,request.piRunnerUpgrade,started.schemaRelease,started.operationId,prepared.piRunnerUpgrade])assert.equal(value,undefined,'Special publication path is unsupported');
 assert.equal(failed.phase,'确认服务可用');assert.equal(failed.maintenanceStarted,true);assert.equal(failed.automaticRetry,false);assert.equal(failed.processEvidence,null);assert.match(failed.error,/503 !== 200/);
 assert.equal(prepared.workerPlan.planSha256,r.planSha256);assert.equal(prepared.workerPlan.candidateReleaseId,r.workerRelease);assert.equal(prepared.workerPlan.candidateManifestSha256,r.workerManifestSha256);assert.equal(prepared.djangoManifestSha256,r.djangoManifestSha256);
 assert.equal(await fileHash(p.djangoPrepared),prepared.djangoPackage.receiptSha256);
 const controller=path.join(r.workerRoot,'releases',r.workerRelease,'tools/worker-local-service.ps1'),completed={};
 for(const [label,action] of Object.entries(labels)){
  const stage=r.steps[label],entry=json(await bytes(stage.started)),result=json(await bytes(stage.result)),process=json(await bytes(stage.process)),e=process.processEvidence;
  assert.equal(e?.code,'completed','Missing completed process: '+label);assert.equal(e.exitCode,0);assert.equal(e.timeoutType,null);assert.equal(e.treeCleanupPending,false);
  assert.equal(entry.action,action);assert.equal(same(entry.script,action==='DeployApp'?path.join(r.source,'tools/django-local-service.ps1'):action==='HardenAcl'?path.join(r.djangoRoot,'app/tools/django-local-service.ps1'):controller),true,'Unexpected original controller');
  if(action==='DeployApp')assert.deepEqual(entry.extra,['-PreparedAppId',prepared.djangoPackage.id,'-PreparedAppSha256',prepared.djangoPackage.receiptSha256]);
  else if(action==='ExitMaintenance')assert.deepEqual(entry.extra,['-MaintenanceId',started.maintenanceId]);
  else assert.deepEqual(entry.extra,[]);
  if(action==='ExitMaintenance'){assert.equal(result.value.status,'maintenance_ended');assert.equal(result.value.maintenanceId,started.maintenanceId);}
  if(action==='Start'){assert.ok(['started','already_running'].includes(result.value.status));assert.equal(result.value.releaseId,r.workerRelease);assert.equal(result.value.manifestSha256,r.workerManifestSha256);}
  if(action==='VerifyStartup'){assert.equal(result.value.startupVerified,true);assert.equal(result.value.releaseId,r.workerRelease);assert.equal(result.value.manifestSha256,r.workerManifestSha256);}
  completed[label]={action,processId:e.processId,completedAt:process.at,resultSha256:await fileHash(stage.result),processSha256:await fileHash(stage.process)};
 }
 const applied=json(await bytes(p.workerApply)),applyStarted=json(await bytes(p.workerApplyStarted));
 assert.equal(applyStarted.planSha256,r.planSha256);assert.equal(applied.planSha256,r.planSha256);assert.ok(['activated','already_activated'].includes(applied.status));assert.equal(applied.releaseId,r.workerRelease);assert.equal(applied.manifestSha256,r.workerManifestSha256);assert.equal(applied.consumptionSha256,r.consumptionSha256);assert.equal(await fileHash(p.consumption),r.consumptionSha256);
 return {request,prepared,started,failed,completed,applied};
}

function catalogFor(r,receipt,raw){return {...receipt,receiptPath:receiptPathFor(r),receiptSha256:hash(raw),supersededCatalog:{path:path.join(path.dirname(receiptPathFor(r)),'superseded-PUBLISHED-MAIN.json'),sha256:r.originalCatalogSha256}};}
function assertRecovered(r,s,c){
 assert.equal(s.version,'teruisi-eab-ready-tail-recovered-success-v1');assert.equal(s.status,'deployed_and_ready');assert.equal(s.mainCommit,r.mainCommit);assert.equal(s.recoveryId,r.recoveryId);
 assert.equal(s.manualRecovery,true);assert.equal(s.automatedPublisherSuccess,false);assert.equal(s.publicationPerformed,false);assert.equal(s.preparationPerformed,false);assert.deepEqual(s.applicationActionsPerformed,[]);
 assert.equal(same(s.originalAttempt,r.attempt),true);assert.equal(s.originalStartedSha256,r.pins.find(x=>same(x.path,r.paths.started)).sha256);assert.equal(s.originalFailureSha256,r.pins.find(x=>same(x.path,r.paths.failed)).sha256);assert.equal(s.originalPublicationStatus,'failed');
 assert.equal(s.workerRelease,r.workerRelease);assert.equal(s.workerManifestSha256,r.workerManifestSha256);assert.equal(s.djangoManifestSha256,r.djangoManifestSha256);assert.equal(same(s.source,r.source),true);assert.deepEqual(s.sourceTree,r.sourceContentTree);assert.deepEqual(s.components,['worker','django']);assert.equal(s.startupVerified,true);assert.equal(s.readyVerified,true);assert.equal(s.migration,null);
 assert.equal(s.program.sha256,c.program.sha256);assert.equal(s.program.recipeSha256,c.program.recipeSha256);assert.equal(s.program.commit,c.program.commit);assert.equal(s.program.relative,r.programRelative);
 assert.equal(s.ready.httpStatus,200);assert.equal(s.ready.ok,true);assert.equal(s.ready.status,'ready');assert.ok(Number.isFinite(Date.parse(s.at)));
}

async function recoveryOwners(r,c){
 const root=path.dirname(receiptPathFor(r));if(!await exists(root))return [];
 await physical(root);assert.ok((await fs.lstat(root)).isDirectory());
 const allowed=new Set(['BINDING.json','invocations','superseded-PUBLISHED-MAIN.json','RECOVERED-SUCCESS.json']);for(const name of await fs.readdir(root))assert.ok(allowed.has(name),'Unknown recovery record: '+name);
 const invocations=path.join(root,'invocations');if(!await exists(invocations))return [];await physical(invocations);
 const names=await fs.readdir(invocations);assert.ok(names.length<=64,'Recovery invocation limit');
 const retired=[];for(const name of names){assert.match(name,/^[a-f0-9-]{36}$/);const entry=path.join(invocations,name);await physical(entry);const v=json(await bytes(path.join(entry,'STARTED.json')));assert.equal(v.recoveryId,r.recoveryId);assert.equal(v.programSha256,c.program.sha256);assert.equal(v.recipeSha256,c.program.recipeSha256);assert.equal(v.originalStartedSha256,r.pins.find(x=>same(x.path,r.paths.started)).sha256);if(name!==c.invocationId)retired.push({invocation:name,owner:v.owner,rows:await c.retired(v.owner)??[]});}return retired;
}

async function observe(r,c,original,{full=false}={}){
 await c.generation();await c.activeBatch();const publisherRetirement={owner:original.started.publisherOwner,rows:await c.retired(original.started.publisherOwner)??[]},priorRecoveryRetirement=await recoveryOwners(r,c);
 for(const name of ['system-maintenance.json','automation-drain.json','release-publication-lease.json'])await absent(path.join(r.djangoRoot,'run',name));
 const live=await c.live();assert.equal(live.workerCommit,r.mainCommit);assert.equal(live.djangoCommit,r.mainCommit);assert.equal(same(live.workerSource,r.source),true);assert.equal(same(live.djangoSource,r.source),true);assert.equal(live.workerRelease,r.workerRelease);assert.equal(live.workerManifestSha256,r.workerManifestSha256);assert.equal(live.djangoManifestSha256,r.djangoManifestSha256);assert.deepEqual(live.head,r.targetHead);assert.equal(live.chainStateSha256,r.chainStateSha256);
 if(full){assert.deepEqual(await c.sourceIdentity(original.request),original.prepared.sourceIdentity);assert.deepEqual(await c.contentTree(live),r.sourceContentTree);assert.deepEqual(live.manifest.source.tree,r.sourceContentTree);}
 const ready=await c.ready();assert.equal(ready.httpStatus,200);assert.equal(ready.ok,true);assert.equal(ready.status,'ready');assert.deepEqual(ready.unavailableServices??[],[]);
 for(const name of ['system-maintenance.json','automation-drain.json','release-publication-lease.json'])await absent(path.join(r.djangoRoot,'run',name));
 return {observedAt:new Date().toISOString(),head:live.head,chainStateSha256:live.chainStateSha256,workerManifestSha256:live.workerManifestSha256,djangoManifestSha256:live.djangoManifestSha256,publisherRetirement,priorRecoveryRetirement,markersAbsent:true,ready};
}

/** All required callbacks are read-only observations or lock ownership. No production defaults. */
export async function recoverReadyTail(r,c,{apply=false}={}){
 for(const key of ['generation','activeBatch','retired','live','sourceIdentity','contentTree','ready','captureOwner','readPublished','withLocks','admission','invalidate','checkpoint'])assert.equal(typeof c[key],'function','Missing explicit isolated capability: '+key);
 c.invocationId=null;return c.withLocks(async()=>{
  await c.admission();const original=await inspectOriginal(r);const observation=await observe(r,c,original,{full:true});
  const directory=path.dirname(receiptPathFor(r)),receiptPath=receiptPathFor(r),catalogFile=path.join(r.stateDirectory,'PUBLISHED-MAIN.json'),binding={version:evidenceVersion,mainCommit:r.mainCommit,recoveryId:r.recoveryId,program:c.program,originalStartedSha256:await fileHash(r.paths.started),originalFailureSha256:await fileHash(r.paths.failed)};
  if(await exists(path.join(directory,'BINDING.json')))assert.deepEqual(json(await bytes(path.join(directory,'BINDING.json'))),binding,'Recovery binding changed');
  else if(await exists(directory))assert.deepEqual(await fs.readdir(directory),[],'Nonempty recovery directory lacks its original binding');
  let receiptRaw=await exists(receiptPath)?await bytes(receiptPath):null,receipt=receiptRaw?json(receiptRaw):null;
  if(receipt)assertRecovered(r,receipt,c);
  const catalogBefore=await bytes(catalogFile),expected=receiptRaw?encode(catalogFor(r,receipt,receiptRaw)):null;
  const accounted=expected&&catalogBefore.equals(expected);
  assert.ok(accounted||hash(catalogBefore)===r.originalCatalogSha256,'Catalog CAS conflict; preserve third value');
  if(receipt)assert.equal(await fileHash(path.join(directory,'superseded-PUBLISHED-MAIN.json')),r.originalCatalogSha256,'Recovery backup changed');
  if(!apply)return {status:accounted?'already-accounted':'read-only-verified',receiptPresent:Boolean(receipt),receiptPath:receipt?receiptPath:null,observation,publicationPerformed:false,accountingWritten:false};
  if(accounted){const read=await c.readPublished();assert.equal(same(read.completedReceiptPath,receiptPath),true);assert.equal(read.mainCommit,r.mainCommit);return {status:'already-accounted',receiptPath,receiptSha256:hash(receiptRaw),catalogSha256:hash(catalogBefore),publicationPerformed:false,accountingWritten:false};}
  await c.invalidate();await physical(r.stateDirectory);const parent=path.dirname(directory);if(!await exists(parent))await fs.mkdir(parent);await physical(parent);if(!await exists(directory))await fs.mkdir(directory);await physical(directory);
  await onceSame(path.join(directory,'BINDING.json'),encode(binding));
  const owners=path.join(directory,'invocations');if(!await exists(owners))await fs.mkdir(owners);await physical(owners);c.invocationId=randomUUID();const invocation=path.join(owners,c.invocationId);await fs.mkdir(invocation);
  await durable(path.join(invocation,'STARTED.json'),encode({at:new Date().toISOString(),mainCommit:r.mainCommit,recoveryId:r.recoveryId,owner:await c.captureOwner(),programSha256:c.program.sha256,recipeSha256:c.program.recipeSha256,originalStartedSha256:binding.originalStartedSha256,originalFailureSha256:binding.originalFailureSha256}));
  let catalogWritten=false;
  try{
   await onceSame(path.join(directory,'superseded-PUBLISHED-MAIN.json'),catalogBefore);await c.checkpoint('after-backup');
   await durable(path.join(invocation,'OBSERVATION.json'),encode({original:{startedAt:original.started.at,failedAt:original.failed.at,phase:original.failed.phase,completed:original.completed,workerApply:original.applied},current:observation}));
   if(!receipt){
    receipt={version:'teruisi-eab-ready-tail-recovered-success-v1',status:'deployed_and_ready',at:new Date().toISOString(),mainCommit:r.mainCommit,recoveryId:r.recoveryId,components:['worker','django'],workerRelease:r.workerRelease,workerManifestSha256:r.workerManifestSha256,djangoManifestSha256:r.djangoManifestSha256,source:r.source,sourceTree:r.sourceContentTree,djangoPreparedId:original.prepared.djangoPackage.id,maintenanceId:original.started.maintenanceId,migration:null,startupVerified:true,readyVerified:true,backupPerformed:false,manualRecovery:true,automatedPublisherSuccess:false,publicationPerformed:false,preparationPerformed:false,applicationActionsPerformed:[],originalAttempt:r.attempt,originalStartedSha256:binding.originalStartedSha256,originalFailureSha256:binding.originalFailureSha256,originalPublicationStatus:'failed',reusedCompletedSteps:[...Object.keys(labels),'WorkerApply'],ready:observation.ready,observationPath:path.join(invocation,'OBSERVATION.json'),operator:await c.captureOwner(),program:c.program};
    assertRecovered(r,receipt,c);receiptRaw=encode(receipt);await durable(receiptPath,receiptRaw);
   }
   await c.checkpoint('after-receipt');
   const catalogRaw=encode(catalogFor(r,receipt,receiptRaw)),temporary=catalogFile+'.'+r.recoveryId+'.tmp';await onceSame(temporary,catalogRaw);
   await c.checkpoint('before-cas');await c.admission();await inspectOriginal(r);const fresh=await observe(r,c,original);await durable(path.join(invocation,'FINAL-OBSERVATION.json'),encode(fresh));
   assert.equal(await fileHash(catalogFile),r.originalCatalogSha256,'Catalog CAS changed; preserve third value');
   try{await fs.rename(temporary,catalogFile);catalogWritten=true;}catch(error){if((await bytes(catalogFile)).equals(catalogRaw))catalogWritten=true;else throw error;}
   await c.checkpoint('after-rename');assert.deepEqual(await bytes(catalogFile),catalogRaw,'Catalog readback differs');
   const read=await c.readPublished();assert.equal(read.mainCommit,r.mainCommit);assert.equal(same(read.completedReceiptPath,receiptPath),true);
   const result={status:'accounting-recovered',receiptPath,receiptSha256:hash(receiptRaw),catalogSha256:hash(catalogRaw),originalFailurePreserved:true,publicationPerformed:false,accountingWritten:true};await durable(path.join(invocation,'COMPLETED.json'),encode(result));return result;
  }catch(error){await durable(path.join(invocation,'FAILED.json'),encode({at:new Date().toISOString(),error:String(error.message),catalogWritten,automaticRetry:false,publicationPerformed:false}));throw error;}
 });
}

// Fixed, read-only census. Legitimate runtime services are not publication controllers.
export const censusScript=String.raw`
function Hash-Text([string]$s){$h=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($s)))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function Expanded([string]$s){for($round=0;$round -lt 3;$round++){$extra='';foreach($m in [regex]::Matches($s,'[A-Za-z0-9+/]{80,}={0,2}')){try{$b=[Convert]::FromBase64String($m.Value);$extra+=[Text.Encoding]::Unicode.GetString($b)+[Text.Encoding]::UTF8.GetString($b)}catch{}};$s+=$extra};$s.Replace('\','/').ToLowerInvariant()}
$rows=@(foreach($p in @(Get-CimInstance Win32_Process -ErrorAction Stop)){
 if($p.ProcessId -eq $PID){continue};$interesting=([string]$p.Name -imatch '^(powershell|pwsh|python|pythonw|node|wsl)(\.exe)?$');$missing=$interesting -and (-not $p.CreationDate -or -not $p.ExecutablePath -or -not $p.CommandLine);$related=$false
 if($interesting -and -not $missing -and $p.ProcessId -ne $v.selfPid){$text=Expanded ([string]$p.CommandLine);foreach($needle in @($v.needles)){if($needle -and $text.Contains(([string]$needle).Replace('\','/').ToLowerInvariant())){$related=$true}}}
 if($p.ProcessId -eq $v.subjectPid -or $related -or $missing){[pscustomobject]@{processId=[int]$p.ProcessId;creationDate=$(if($p.CreationDate){$p.CreationDate.ToUniversalTime().ToString('o')}else{$null});sessionId=[int]$p.SessionId;commandLineSha256=$(if($p.CommandLine){Hash-Text ([string]$p.CommandLine)}else{$null});executablePathSha256=$(if($p.ExecutablePath){Hash-Text ([string]$p.ExecutablePath)}else{$null});related=$related;identityUnreadable=$missing}}
});ConvertTo-Json -InputObject @($rows) -Depth 3 -Compress`;

export async function withQueueRotation(binding,publisher,rotation,operation,queueOptions){
 const release=await publisher.acquireMainPublicationQueue(binding,queueOptions);
 try{return await rotation.withRotationLock(operation);}finally{await release();}
}

export async function productionContext(r,recipeRaw,{apply}){
 assert.equal(same(r.source,'D:/codex-isolated/main-release-packages/eab998f81c98-ea046c0d-b29a775d/source'),true);assert.equal(same(r.configFile,'D:/codex-isolated/main-manual-release-20261016/main-publisher-config.json'),true);
 const load=leaf=>import(pathToFileURL(path.join(r.bundleRoot,'tools',leaf)));
 const control=await load('main-control-dispatch.mjs'),publisher=await load('publish-latest-main.mjs'),task=await load('main-prebuild-task.mjs'),retirement=await load('preparation-retirement-admission.mjs');
 const binding=await control.readAdoptedControl(r.configFile,r.bundleRoot),config=binding.config;
 assert.equal(binding.stateSha256,r.installationSha256);assert.equal(binding.state.bundleSha256,r.bundleSha256);assert.equal(same(config.nativeToolsSource,r.nativeRoot),true);assert.equal(same(config.stateDirectory,r.stateDirectory),true);
 const identity=await task.currentPreparationIdentity();task.assertOrdinaryIdentity(identity,binding.state.preparationTask.sid);assert.equal(hash(await fs.readFile(process.execPath)),binding.state.preparationTask.nodeSha256);assert.equal(binding.state.preparationTask.nodeSha256,r.nodeSha256);
 const git=async args=>(await execute('git',['-C',repository,...args],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024})).stdout.trim();
 const commit=await git(['rev-parse','HEAD']);if(apply)assert.equal(await git(['status','--porcelain']),'','Recovery operator must be committed and clean');
 const fixed=publisher.publisherEnvironment(process.env,config.gitDirectory,config.publisherBaseEnvironment);for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,fixed);
 const rotation=await import(pathToFileURL(path.join(r.nativeRoot,'tools/worker-local-release-rotation.mjs'))),owner=await import(pathToFileURL(path.join(r.source,'tools/publish-main-owner.mjs'))),frozen=await import(pathToFileURL(path.join(r.source,'tools/frozen-main-source.mjs')));
 assert.equal(rotation.withRotationLock.length,1);for(const [module,key] of [[rotation,'assertActiveBatchOwnership'],[rotation,'resolveEffectiveReleaseChain'],[publisher,'observeLiveIdentity'],[publisher,'readLivePublication'],[publisher,'acquireMainPublicationQueue'],[owner,'verifyPublisherRetired'],[owner,'capturePublicationOwner'],[frozen,'assertFrozenSource']])assert.equal(typeof module[key],'function','Fixed API missing: '+key);
 let scope;
 const c={program:{relative:r.programRelative,commit,sha256:await fileHash(fileURLToPath(import.meta.url)),recipeSha256:hash(recipeRaw)},generation:()=>control.assertControlGeneration(binding),activeBatch:()=>rotation.assertActiveBatchOwnership(r.workerRoot),
  retired:async previous=>{const rows=await task.taskPowerShell(censusScript,{subjectPid:previous.processId,selfPid:process.pid,needles:[r.source,r.attempt,r.djangoPreparedId,'tools/publish-main.mjs','tools/publish-prepared-main.mjs','tools/publish-main-status.mjs','tools/publish-latest-main.mjs','--consume-preparation']});owner.verifyPublisherRetired(previous,rows,[]);return rows;},
  live:()=>publisher.observeLiveIdentity(config),sourceIdentity:request=>frozen.assertFrozenSource({source:r.source,mainCommit:r.mainCommit,sourceTree:request.sourceTree}),contentTree:async live=>live.api.hashRelativeFiles(r.source,await live.api.listGitSourceFiles(r.source)),
  ready:async()=>{const response=await fetch('http://127.0.0.1:3000/_teruisi/local/health/ready',{headers:{'x-teruisi-local-health':'1'},redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(response.status,200,'Original ready gate failed');const h=await response.json();return {observedAt:new Date().toISOString(),httpStatus:response.status,ok:h.ok,status:h.status,unavailableServices:h.unavailableServices??[]};},
  captureOwner:()=>owner.capturePublicationOwner(),readPublished:()=>publisher.readLivePublication(config),admission:()=>retirement.assertRetirementAdmission(config,r.mainCommit,{scope}),invalidate:()=>retirement.invalidateRetirementReadScope(scope,'eab-ready-tail-accounting-write'),checkpoint:async()=>{},
  withLocks:operation=>retirement.withRetirementReadScope(config,async current=>{scope=current;await retirement.assertRetirementAdmission(config,r.mainCommit,{scope});return withQueueRotation(binding,publisher,rotation,operation);})};
 return c;
}

async function run(){
 const args=process.argv.slice(2);assert.ok(args.length<=1&&args.every(a=>a==='--apply'),'Only --apply is supported; default is read-only');const apply=args.includes('--apply'),recipeRaw=await bytes(path.join(here,'EVIDENCE.json')),r=json(recipeRaw);
 for(const pin of r.codePins)assert.equal(await fileHash(pin.path),pin.sha256,'Fixed helper changed: '+pin.path);
 const c=await productionContext(r,recipeRaw,{apply});const result=await recoverReadyTail(r,c,{apply});console.log(JSON.stringify(result));
}
if(process.argv[1]&&same(process.argv[1],fileURLToPath(import.meta.url)))run().catch(e=>{console.error(JSON.stringify({status:'blocked',error:String(e.stack??e),automaticRetry:false,publicationPerformed:false}));process.exitCode=1;});
