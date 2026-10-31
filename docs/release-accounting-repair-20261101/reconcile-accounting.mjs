/** One exact accounting repair. Never deploys, starts, migrates or prepares. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
const execute=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex');
const here=path.dirname(fileURLToPath(import.meta.url)),repository=path.resolve(here,'../..');
const artifactRoot='D:/codex-artifacts/release-accounting-repair-20261101';
const djangoRoot='D:/teruisi-runtime/django-sales',workerRoot='D:/teruisi-runtime/teruisi-worker-sales';
const psHost='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const json=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const fileSha=async file=>sha(await fs.readFile(file));
const samePath=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const q=s=>"'"+s.replaceAll("'","''")+"'";
async function absent(file){try{await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return;}throw Error('Must remain absent: '+file);}
async function durable(file,bytes){const h=await fs.open(file,'wx');try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}}
async function tailLines(file,limit=262144){const h=await fs.open(file,'r');try{const s=await h.stat(),start=Math.max(0,s.size-limit),b=Buffer.alloc(s.size-start);await h.read(b,0,b.length,start);const lines=b.toString('utf8').split(/\r?\n/);if(start)lines.shift();return lines.filter(Boolean);}finally{await h.close();}}
async function git(cwd,args,raw=false){return (await execute('git',['-C',cwd,...args],{encoding:raw?null:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024})).stdout;}

export function verifyOverrideRows(e,r){
 assert.equal(e.algorithm,'relative-path-file-sha256-ordinal-v2');assert.equal(e.fileCount,r.fileCount);assert.equal(e.rows.length,r.fileCount);
 assert.equal(sha(e.rows.join('\n')),r.currentFingerprint);assert.equal(e.fingerprint,r.currentFingerprint);
 const current=r.override.path+'\n'+r.override.afterSha256,previous=r.override.path+'\n'+r.override.beforeSha256;
 assert.equal(e.rows.filter(row=>row===current).length,1,'Exact override leaf missing');
 assert.equal(sha(e.rows.map(row=>row===current?previous:row).join('\n')),r.baseFingerprint,'Unexplained application changes');
 return {algorithm:e.algorithm,fileCount:e.fileCount,currentFingerprint:r.currentFingerprint,reconstructedBaseFingerprint:r.baseFingerprint,override:r.override};
}

/** The only production writes: a separate recovery receipt, old catalog backup, atomic index. */
export async function replaceCatalog({catalogFile,directory,expectedSha,receipt,beforeCommit=async()=>{},onCommitted=()=>{}}){
 const previous=await fs.readFile(catalogFile);assert.equal(sha(previous),expectedSha,'Catalog changed before repair');
 await fs.mkdir(directory,{recursive:false});
 const backup=path.join(directory,'superseded-PUBLISHED-MAIN.json');await durable(backup,previous);
 const receiptPath=path.join(directory,'ACKNOWLEDGED.json'),receiptBytes=JSON.stringify(receipt,null,2)+'\n';
 await durable(receiptPath,receiptBytes);
 const catalog={...receipt,receiptPath,receiptSha256:sha(receiptBytes),supersededCatalog:{path:backup,sha256:expectedSha}};
 const temporary=catalogFile+'.'+path.basename(directory)+'.tmp';await durable(temporary,JSON.stringify(catalog,null,2)+'\n');
 await beforeCommit();assert.equal(await fileSha(catalogFile),expectedSha,'Catalog CAS changed; original index preserved');
 await fs.rename(temporary,catalogFile);onCommitted();assert.deepEqual(await json(catalogFile),catalog);
 return {receiptPath,receiptSha256:catalog.receiptSha256,catalogSha256:await fileSha(catalogFile)};
}

async function run(){
 assert.ok(process.argv.slice(2).every(arg=>arg==='--apply'),'Only --apply is supported');
 const apply=process.argv.includes('--apply'),recipeBytes=await fs.readFile(path.join(here,'EVIDENCE.json')),r=JSON.parse(recipeBytes);
 assert.equal(r.version,'271-accounting-recovery-evidence-v1');
 assert.equal(r.baseCommit,'271ab794fd487e5f943f83d8c83fb81542aa9c27');
 const load=leaf=>import(pathToFileURL(path.join(r.bundleRoot,'tools',leaf)));
 const control=await load('main-control-dispatch.mjs'),publisher=await load('publish-latest-main.mjs');
 const task=await load('main-prebuild-task.mjs'),retirement=await load('preparation-retirement-admission.mjs');
 const binding=await control.readAdoptedControl(r.configFile,r.bundleRoot),config=binding.config;
 assert.ok(samePath(config.nativeToolsSource,r.nativeRoot));
 const identity=await task.currentPreparationIdentity();assert.equal(identity.sid,binding.state.preparationTask.sid);
 if(apply)task.assertOrdinaryIdentity(identity,binding.state.preparationTask.sid);
 const operatorCommit=(await git(repository,['rev-parse','HEAD'])).trim();
 if(apply)assert.equal((await git(repository,['status','--porcelain'])).trim(),'','Repair operator must be committed and clean');
 const runId=randomUUID(),out=path.join(artifactRoot,'run-'+runId);await fs.mkdir(out,{recursive:false});
 const catalogFile=path.join(config.stateDirectory,'PUBLISHED-MAIN.json');let committed=false,writeAttempted=false;
 const save=async(name,value)=>durable(path.join(out,name),JSON.stringify(value,null,2)+'\n');
 const environment=publisher.publisherEnvironment(process.env,config.gitDirectory,config.publisherBaseEnvironment);
 async function ps(script,label){
  const code="$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);"+script;
  const result=await execute(psHost,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:600000,maxBuffer:4*1024*1024,env:environment});
  await durable(path.join(out,label+'.stdout.log'),result.stdout);await durable(path.join(out,label+'.stderr.log'),result.stderr);
  return JSON.parse(result.stdout.trim());
 }
 async function pinned(){for(const p of r.pins)assert.equal(await fileSha(p.path),p.sha256,'Original evidence changed: '+p.path);}
 async function noMarkers(){for(const name of ['system-maintenance.json','automation-drain.json','release-publication-lease.json'])await absent(path.join(djangoRoot,'run',name));}
 async function actors(){
  const ids=[...r.recovery.retiredPids,r.recovery.supervisorPid];
  const rows=await task.taskPowerShell("$items=@(foreach($id in $v.ids){$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$id);if($p){[ordered]@{pid=[int]$p.ProcessId;parent=[int]$p.ParentProcessId;created=$p.CreationDate.ToUniversalTime().ToString('o')}}});ConvertTo-Json -InputObject $items -Compress",{ids});
  for(const id of r.recovery.retiredPids)assert.equal(rows.some(p=>p.pid===id),false,'Recorded controller PID is present; do not replay or assume retired');
  const live=rows.find(p=>p.pid===r.recovery.supervisorPid);assert.ok(live);assert.equal(live.parent,r.recovery.workerPid);assert.equal(live.created,r.recovery.supervisorCreationDate);
  return rows;
 }
 async function ready(){const response=await fetch('http://127.0.0.1:3000/_teruisi/local/health/ready',{headers:{'x-teruisi-local-health':'1'},signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);const value=await response.json();assert.equal(value.ok,true);assert.equal(value.status,'ready');return {observedAt:new Date().toISOString(),httpStatus:200,ok:true,status:'ready'};}
 async function collect(){
  await pinned();await noMarkers();await absent(path.join(r.attempt,'SUCCESS.json'));await absent(path.join(r.attempt,'启动服务-result.json'));
  assert.equal(await fileSha(catalogFile),r.originalCatalogSha256);
  const started=await json(path.join(r.attempt,'STARTED.json')),failure=await json(path.join(r.attempt,'FAILED.json'));
  const request=await json(path.join(r.source,'../main-release-request.json')),prepared=await json(path.join(r.attempt,'preparation/PREPARED.json'));
  assert.equal(started.mainCommit,r.baseCommit);assert.equal(request.mainCommit,r.baseCommit);assert.equal(prepared.sourceIdentity.commit,r.baseCommit);
  assert.equal(sha(JSON.stringify(request)),started.requestSha256);assert.equal(prepared.requestSha256,started.requestSha256);
  assert.equal(prepared.djangoManifestSha256,r.baseDjangoManifest);assert.equal(prepared.djangoPackage.appFingerprint,r.baseFingerprint);
  assert.equal(failure.phase,'启动服务');assert.equal(failure.maintenanceStarted,true);assert.equal(failure.processEvidence.exitCode,1);
  const failedStart=await json(path.join(r.attempt,'启动服务.stdout.log'));assert.equal(failedStart.failedStartPhase.outcome,'failed');assert.equal(failedStart.failedStartPhase.processEvidence.exitCode,1);
  for(const label of ['部署后台','应用后台权限','登记结构迁移','迁移监控字段','完成结构迁移','退出维护']){
   const process=await json(path.join(r.attempt,label+'-process.json'));assert.equal(process.processEvidence.code,'completed');assert.equal(process.processEvidence.exitCode,0);assert.equal(process.processEvidence.timeoutType,null);
  }
  const finalized=(await json(path.join(r.attempt,'完成结构迁移-result.json'))).value;assert.equal(finalized.status,'verified');assert.equal(finalized.result.migrationCount,156);assert.equal(finalized.result.permissionsVerified,true);
  const ended=(await json(path.join(r.attempt,'退出维护-result.json'))).value;assert.equal(ended.status,'maintenance_ended');assert.equal(ended.maintenanceId,started.maintenanceId);
  const applied=await json(path.join(r.attempt,'WorkerApply-result.json'));assert.equal(applied.status,'activated');assert.equal(applied.planSha256,prepared.workerPlan.planSha256);
  assert.equal(applied.releaseId,r.workerRelease);assert.equal(applied.manifestSha256,r.workerManifest);
  assert.equal(await fileSha(path.join(workerRoot,'state/worker-release-rotation-consumptions',applied.planSha256+'.json')),applied.consumptionSha256);
  const live=await publisher.observeLiveIdentity(config);assert.equal(live.workerCommit,r.baseCommit);assert.equal(live.djangoCommit,r.baseCommit);
  assert.ok(samePath(live.workerSource,r.source)&&samePath(live.djangoSource,r.source));assert.equal(live.workerRelease,r.workerRelease);assert.equal(live.workerManifestSha256,r.workerManifest);assert.equal(live.djangoManifestSha256,r.currentDjangoManifest);
  const frozen=await load('frozen-main-source.mjs');const sourceIdentity=await frozen.assertFrozenSource({source:r.source,mainCommit:r.baseCommit,sourceTree:request.sourceTree});assert.deepEqual(sourceIdentity,prepared.sourceIdentity);
  assert.equal((await git(config.repository,['merge-base','--is-ancestor',r.baseCommit,r.targetMain])).trim(),'');
  const workerTree=await live.api.hashRelativeFiles(r.source,await live.api.listGitSourceFiles(r.source));assert.deepEqual(workerTree,live.manifest.source.tree);
  assert.equal(await fileSha(path.join(r.source,r.override.path)),r.override.beforeSha256);assert.equal(await fileSha(path.join(djangoRoot,'app',r.override.path)),r.override.afterSha256);
  const patchBlob=await git(config.repository,['show',r.override.equalToCommit+':'+r.override.path],true);assert.equal(sha(patchBlob),r.override.afterSha256);
  assert.equal(sha(await git(config.repository,['show',r.targetMain+':'+r.override.path],true)),r.override.afterSha256,'Next candidate would lose the observed repair');
  const rows=await ps("$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1';. "+q(djangoRoot+'/app/tools/django-local-service.ps1')+" -RuntimeRoot "+q(djangoRoot)+";$e=Get-ApplicationTreeFingerprintEvidence "+q(djangoRoot+'/app')+";[ordered]@{algorithm=[string]$e.Algorithm;fileCount=[long]$e.FileCount;fingerprint=[string]$e.Fingerprint;rows=@($e.Rows|ForEach-Object{$_.ToString()})}|ConvertTo-Json -Depth 3 -Compress",'app-rows');
  const provenance=verifyOverrideRows(rows,r);await save('app-provenance.json',provenance);
  const probe=await publisher.probePublicationPreconditions(config,{checkDjango:true});assert.deepEqual(publisher.preconditionFailures(probe),[]);await save('native-publication-probe.json',probe);
  const canonicalFile=path.join(workerRoot,'state/worker-process.json');assert.equal(await fileSha(canonicalFile),r.canonicalSha256);const canonical=await json(canonicalFile);
  assert.equal(canonical.releaseId,r.workerRelease);assert.equal(canonical.manifestSha256,r.workerManifest);assert.equal(canonical.supervisorPid,r.recovery.supervisorPid);
  const processEvidence=await actors();
  const controller=path.join(workerRoot,'releases',r.workerRelease,'tools/worker-local-service.ps1');
  const status=await ps('& '+q(controller)+' -Action Status -Json','worker-status');assert.equal(status.state,'exact_release');assert.equal(status.manifestSha256,r.workerManifest);assert.equal(status.supervisorProcessId,r.recovery.supervisorPid);
  const startup=await ps('& '+q(controller)+' -Action VerifyStartup -Json','startup-binding');assert.equal(startup.startupVerified,true);assert.equal(startup.manifestSha256,r.workerManifest);
  const djangoLines=await tailLines(djangoRoot+'/logs/launcher.jsonl'),workerLines=await tailLines(workerRoot+'/logs/startup-timing.jsonl');
  const pick=(lines,predicate)=>{const found=lines.map(line=>({line,value:JSON.parse(line)})).filter(x=>predicate(x.value));assert.equal(found.length,1,'Recovery event absent or ambiguous');return {value:found[0].value,lineSha256:sha(found[0].line)};};
  const djangoCompletion=pick(djangoLines,x=>x.runId===r.recovery.djangoRunId&&x.action==='Start'&&x.event==='action_completed'&&x.timestamp===r.recovery.djangoCompletedAt);
  const workerCompletion=pick(workerLines,x=>x.processId===r.recovery.workerPid&&x.action==='Start'&&x.stage==='Invoke-WorkerSystemStart'&&x.startedAt===r.recovery.workerStartedAt);
  assert.equal(workerCompletion.value.outcome,'completed');assert.equal(workerCompletion.value.elapsedMilliseconds,r.recovery.workerElapsedMilliseconds);
  const health=await ready();await control.assertControlGeneration(binding);await noMarkers();
  assert.equal(await fileSha(path.join(djangoRoot,'app/deployment.json')),r.currentDjangoManifest);assert.equal(await fileSha(canonicalFile),r.canonicalSha256);
  return {live:{mainCommit:r.baseCommit,source:r.source,sourceTree:workerTree,workerRelease:r.workerRelease,workerManifestSha256:r.workerManifest,djangoManifestSha256:r.currentDjangoManifest},original:{attempt:r.attempt,startedAt:started.at,failedAt:failure.at,maintenanceId:started.maintenanceId,operationId:started.operationId,startExitCode:1,djangoEnsureExitCode:1,finalized,applied,ended,evidence:r.pins},recovery:{djangoCompletion,workerCompletion,outerExitCode:null,outerExitNote:'Historical outer exit was not retained; completed effects are independently observed, not claimed as original publication success',canonical,processEvidence},provenance,current:{observedAt:new Date().toISOString(),status,startup,health,probe}};
 }
 try{
  await retirement.withRetirementReadScope(config,async scope=>{
   await retirement.assertRetirementAdmission(config,undefined,{scope});
   const release=apply?await publisher.acquireMainPublicationQueue(binding):null;
   try{
    const perform=async()=>{
     const evidence=await collect();await save('OBSERVATION.json',evidence);
     if(!apply){console.log(JSON.stringify({status:'read-only-verified',out,accountingWritten:false}));return;}
     const at=new Date().toISOString();
     const receipt={status:'deployed_and_ready',at,...evidence.live,components:['worker','django'],djangoPreparedId:null,maintenanceId:null,migration:null,startupVerified:true,readyVerified:true,backupPerformed:false,publicationPerformed:false,preparationPerformed:false,
      accountingRepair:{version:'teruisi-post-failure-recovery-acknowledgement-v1',kind:'post-failure-recovery-acknowledged',repairId:runId,acknowledgedAt:at,originalPublicationStatus:'failed',original:evidence.original,recovery:evidence.recovery,djangoProvenance:{baseCommit:r.baseCommit,baseManifestSha256:r.baseDjangoManifest,currentManifestSha256:r.currentDjangoManifest,...evidence.provenance},currentObservation:evidence.current,
       applicationActionsPerformed:[],operator:{processId:process.pid,sessionId:identity.sessionId,elevated:identity.elevated,sidSha256:sha(identity.sid)},program:{commit:operatorCommit,sha256:await fileSha(fileURLToPath(import.meta.url)),recipeSha256:sha(recipeBytes)},
       suppressedGuard:{guard:'observeLatestMain half-switch rejection for receipt outside original attempt',replacement:'This exact original failure, complete schema/apply/maintenance results, closed one-file override and independently verified recovered current state; original FAILED remains unchanged'}}};
     await retirement.invalidateRetirementReadScope(scope,'exact-accounting-recovery-write');
     const root=path.join(config.stateDirectory,'accounting-recoveries');await fs.mkdir(root,{recursive:true});
     writeAttempted=true;
     const result=await replaceCatalog({catalogFile,directory:path.join(root,runId),expectedSha:r.originalCatalogSha256,receipt,onCommitted:()=>{committed=true;},beforeCommit:async()=>{
      await control.assertControlGeneration(binding);await pinned();await noMarkers();await actors();await ready();
      assert.equal(await fileSha(path.join(djangoRoot,'app/deployment.json')),r.currentDjangoManifest);assert.equal(await fileSha(path.join(workerRoot,'state/worker-process.json')),r.canonicalSha256);
      const current=await evidenceLive();assert.equal(current.workerRelease,r.workerRelease);assert.equal(current.workerManifestSha256,r.workerManifest);
     }});
     const verified=await publisher.readLivePublication(config);assert.equal(verified.mainCommit,r.baseCommit);assert.equal(verified.completedReceiptPath,result.receiptPath);
     const done={status:'accounting-repaired',...result,mainCommit:r.baseCommit,targetToPrepare:r.targetMain,publicationPerformed:false,preparationPerformed:false,out};await save('COMPLETED.json',done);console.log(JSON.stringify(done));
    };
    const evidenceLive=()=>publisher.observeLiveIdentity(config);
    if(apply){const rotation=await import(pathToFileURL(path.join(r.nativeRoot,'tools/worker-local-release-rotation.mjs')));await rotation.withRotationLock(perform);}else await perform();
   }finally{await release?.();}
  });
 }catch(error){const catalogReplaced=committed?true:writeAttempted?null:false;const currentCatalogSha256=await fileSha(catalogFile).catch(()=>null);await save('FAILED.json',{at:new Date().toISOString(),error:String(error.stack??error),catalogReplaced,currentCatalogSha256,publicationPerformed:false,automaticRetry:false});console.error(JSON.stringify({status:'failed',error:error.message,catalogReplaced,out}));process.exitCode=1;}
}
if(process.argv[1]&&samePath(process.argv[1],fileURLToPath(import.meta.url)))await run();
