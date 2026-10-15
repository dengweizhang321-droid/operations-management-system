import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {waitForExecution} from './delivery-review-gate.mjs';
const source='D:/codex-isolated/ai-schedule-repeat-fix-20261015-v2/source',out='D:/codex-artifacts/ai-schedule-repeat-fix-20261015-v2';
const sha=async f=>createHash('sha256').update(await fs.readFile(f)).digest('hex');
assert.match(process.argv[2]??'',/^[a-f0-9]{64}$/);assert.equal(await sha(new URL(import.meta.url)),process.argv[3]);
for(const name of ['PREPARATION_STARTED.json','publication-request.json','execution-review.json','EXECUTE.json','PUBLICATION_STARTED.json']){
 try{await fs.lstat(out+'/'+name);throw new Error('Existing attempt cannot be replayed: '+name);}catch(e){if(e.code!=='ENOENT')throw e;}
}
const executionScripts={};for(const n of ['deliver.mjs','prepare.mjs','publish.mjs','seal-publication.mjs','delivery-review-gate.mjs'])executionScripts[n]=await sha(out+'/'+n);
const rotation=await import(pathToFileURL(source+'/tools/worker-local-release-rotation.mjs'));
await rotation.withRotationLock(async lease=>{
async function prepare(lease,compositionSha){
const source='D:/codex-isolated/ai-schedule-repeat-fix-20261015-v2/source',out='D:/codex-artifacts/ai-schedule-repeat-fix-20261015-v2',runtime='D:/teruisi-runtime/django-sales';
const hash=b=>createHash('sha256').update(b).digest('hex'),sha=async f=>hash(await fs.readFile(f));
assert.match(compositionSha??'',/^[a-f0-9]{64}$/);const compositionRaw=await fs.readFile(out+'/composition-final.json');assert.equal(hash(compositionRaw),compositionSha);const c=JSON.parse(compositionRaw);
const git=args=>execFileSync('git',args,{cwd:source,encoding:'utf8',windowsHide:true}).trim();assert.equal(git(['rev-parse','HEAD']),c.sourceCommit);assert.equal(git(['status','--porcelain']),'');
const api=await import(pathToFileURL(source+'/tools/worker-local-release.mjs')),rotation=await import(pathToFileURL(source+'/tools/worker-local-release-rotation.mjs'));
const transportSource='D:/codex-isolated/market-ai-round2-release-20261015/source';
assert.equal(await sha(source+'/tools/release-batch.mjs'),await sha(transportSource+'/tools/release-batch.mjs'));
const{productionCommandEnvironment,productionCommandArguments,writeOnce}=await import(pathToFileURL(transportSource+'/tools/release-batch.mjs'));
const host=JSON.parse(await fs.readFile('D:/codex-artifacts/ordinary-user-controls-20261014/HOST_PLAN.json','utf8'));assert.equal(await sha(path.join(host.target,'pwsh.exe')),host.pwshSha256);process.env.PATH=host.target+';'+(process.env.PATH??process.env.Path??'');process.env.WRANGLER_HIDE_BANNER='true';
const shell='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const role=await api.runProcess(shell,['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],{timeoutMs:30000,label:'ai-schedule-ordinary-token'});assert.equal(role.stdout.trim(),'False');
for(const[f,h]of Object.entries(c.files))assert.equal(await sha(source+'/'+f),h,f);

const predecessor=JSON.parse(await fs.readFile(out+'/predecessor-observation.json','utf8'));
const action=async rotationLease=>{
 await rotation.assertActiveBatchOwnership(api.workerRuntimeRoot);
 const chain=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});assert.deepEqual(chain.head,predecessor.workerHead);assert.equal(chain.chainStateSha256,predecessor.chainStateSha256);assert.equal(await sha(runtime+'/app/deployment.json'),predecessor.djangoManifestSha256);
 const allowed=new Set(Object.keys(c.files));const actual=[];
 for(const f of await api.listGitSourceFiles(source)){const raw=await fs.readFile(source+'/'+f);let before;try{before=await fs.readFile(path.join(path.dirname(chain.headManifestPath),'source-snapshot',f));}catch(e){if(e.code!=='ENOENT')throw e;}if(!before||!raw.equals(before)){assert(allowed.has(f),'Unrelated source changed: '+f);actual.push(f);}}
 assert.deepEqual(actual.sort(),[...allowed].sort());
 await writeOnce(out+'/PREPARATION_STARTED.json',{at:new Date().toISOString(),sourceCommit:c.sourceCommit,mainCommit:c.mainCommit,predecessor:chain.head,djangoPredecessor:predecessor.djangoManifestSha256,compositionSha256:compositionSha,administrator:false});
 const identity=await api.workerPreparationIdentity(source),binding={version:api.workerSourceBindingVersion,sourceRoot:path.resolve(source),sourceRootPathSha256:api.windowsPathSha256(source),predecessor:chain.head,predecessorChainStateSha256:chain.chainStateSha256,identity};
 const raw=api.canonicalJson(binding)+'\n',file=out+'/source-binding.json',bindingSha=hash(Buffer.from(raw));await fs.writeFile(file,raw,{flag:'wx'});
 const plan=await rotation.planWorkerReleaseRotation({prepareOnline:true,sourceBindingFile:file,sourceBindingSha256:bindingSha,rotationLease});await writeOnce(out+'/worker-plan.json',plan);assert.equal(plan.status,'planned');
 // The standard Worker producer installs its isolated dependency tree once.
 // PrepareApp then copies that same pinned runtime closure; no second build.
 const args=['-NoProfile','-NonInteractive','-File',source+'/tools/django-local-service.ps1','-Action','PrepareApp'];
 await writeOnce(out+'/DJANGO_PREPARE_STARTED.json',{at:new Date().toISOString(),sourceCommit:c.sourceCommit,scriptSha256:await sha(source+'/tools/django-local-service.ps1'),args,predecessor:predecessor.djangoManifestSha256});
 try{
  const r=await api.runProcess(shell,productionCommandArguments(shell,args),{cwd:source,env:productionCommandEnvironment(shell),timeoutMs:1200000,outputProtocol:'direct-exit-files',cleanup:'preserve',label:'ai-schedule-django-prepare'});
  await fs.writeFile(out+'/django-prepare.stdout.log',r.stdout,{flag:'wx'});await fs.writeFile(out+'/django-prepare.stderr.log',r.stderr,{flag:'wx'});
  const pkg=JSON.parse(r.stdout.trim());assert.deepEqual(Object.keys(pkg).sort(),['appFingerprint','id','receiptSha256']);assert.equal(await sha(runtime+'/app.prepare-'+pkg.id+'.json'),pkg.receiptSha256);assert.equal(await sha(runtime+'/app/deployment.json'),predecessor.djangoManifestSha256);
  const manifestSha=await sha(runtime+'/app.deploy-'+pkg.id+'/deployment.json');await writeOnce(out+'/django-prepared.json',{...pkg,manifestSha256:manifestSha,processEvidence:r.processEvidence});
  const after=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});assert.equal(after.chainStateSha256,chain.chainStateSha256);
  await writeOnce(out+'/PREPARATION_READY.json',{at:new Date().toISOString(),sourceCommit:c.sourceCommit,mainCommit:c.mainCommit,compositionSha256:compositionSha,workerPlanSha256:plan.planSha256,workerRelease:plan.candidateReleaseId,djangoPreparedId:pkg.id,djangoReceiptSha256:pkg.receiptSha256,djangoManifestSha256:manifestSha,predecessorUnchanged:true,productionSwitchExecuted:false});
  console.log(JSON.stringify({status:'prepared',worker:plan.candidateReleaseId,django:pkg.id,source:c.sourceCommit,main:c.mainCommit}));
 }catch(error){await writeOnce(out+'/DJANGO_PREPARE_UNKNOWN.json',{at:new Date().toISOString(),name:error.name,code:error.code??null,message:String(error.message).slice(0,500),processEvidence:error.processEvidence??null});throw error;}
};
await action(lease);
}
async function publish(lease,requestSha){
const source='D:/codex-isolated/ai-schedule-repeat-fix-20261015-v2/source',out='D:/codex-artifacts/ai-schedule-repeat-fix-20261015-v2',runtime='D:/teruisi-runtime/django-sales';
const shell='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const hash=b=>createHash('sha256').update(b).digest('hex'),sha=async f=>hash(await fs.readFile(f)),read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const qraw=await fs.readFile(out+'/publication-request.json');
assert.equal(hash(qraw),requestSha);
const q=JSON.parse(qraw);
assert.equal(await sha(out+'/publish.mjs'),q.publishScriptSha256);
for(const [name,h]of Object.entries(q.executionScripts))assert.equal(await sha(out+'/'+name),h,name+' execution script drift');
assert.equal(await sha(process.execPath),q.nodeExecutableSha256);
assert.equal(await sha(shell),q.shellExecutableSha256);
for(const [name,h] of Object.entries(q.inputFiles))assert.equal(await sha(out+'/'+name),h,name);
const composition=await read(out+'/composition-final.json'),plan=await read(out+'/worker-plan.json'),pkg=await read(out+'/django-prepared.json'),pre=await read(out+'/predecessor-observation.json');
assert.equal(q.sourceCommit,composition.sourceCommit);assert.equal(q.mainCommit,composition.mainCommit);
assert.equal(q.noNewBackupOrRestore,true);assert.equal(q.noMigrationChanges,true);
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8',windowsHide:true}).trim(),q.sourceCommit);
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:source,encoding:'utf8',windowsHide:true}).trim(),'');
for(const [f,h]of Object.entries(composition.files))assert.equal(await sha(source+'/'+f),h,f);
const api=await import(pathToFileURL(source+'/tools/worker-local-release.mjs')),rotation=await import(pathToFileURL(source+'/tools/worker-local-release-rotation.mjs'));
const helper='D:/codex-isolated/market-ai-round2-release-20261015/source';
assert.equal(await sha(source+'/tools/release-batch.mjs'),await sha(helper+'/tools/release-batch.mjs'));
const {productionCommandEnvironment,productionCommandArguments,writeOnce}=await import(pathToFileURL(helper+'/tools/release-batch.mjs'));
const host=await read('D:/codex-artifacts/ordinary-user-controls-20261014/HOST_PLAN.json');
assert.equal(await sha(path.join(host.target,'pwsh.exe')),host.pwshSha256);process.env.PATH=host.target+';'+(process.env.PATH??process.env.Path??'');
const role=await api.runProcess(shell,['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],{timeoutMs:30000,label:'repeat-fix-ordinary-token'});assert.equal(role.stdout.trim(),'False');
async function run(label,script,args,check,json=true){
 assert.equal(await sha(script),q.stageScripts[label],label+' script drift');
 const full=['-NoProfile','-NonInteractive','-File',script,...args];
 await writeOnce(out+'/'+label+'-started.json',{at:new Date().toISOString(),scriptSha256:await sha(script),args:full});
 try{
  const result=await api.runProcess(shell,productionCommandArguments(shell,full),{cwd:source,env:productionCommandEnvironment(shell),timeoutMs:1200000,outputProtocol:'direct-exit-files',cleanup:'preserve',label:'repeat-fix-'+label});
  await fs.writeFile(out+'/'+label+'.stdout.log',result.stdout,{flag:'wx'});await fs.writeFile(out+'/'+label+'.stderr.log',result.stderr,{flag:'wx'});
  const value=json?JSON.parse(result.stdout.trim()):{completed:true};
  await check(value);await writeOnce(out+'/'+label+'-returned.json',{at:new Date().toISOString(),value,processEvidence:result.processEvidence});return value;
 }catch(error){await writeOnce(out+'/'+label+'-unknown.json',{at:new Date().toISOString(),name:error.name,code:error.code??null,message:String(error.message).slice(0,500),processEvidence:error.processEvidence??null});throw error;}
}
const worker='D:/运营管理系统/tools/worker-local-service.ps1';
const action=async rotationLease=>{
 await rotation.assertActiveBatchOwnership(api.workerRuntimeRoot);
 const chain=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});
 assert.deepEqual(chain.head,pre.workerHead);assert.equal(chain.chainStateSha256,pre.chainStateSha256);
 assert.equal(await sha(runtime+'/app/deployment.json'),pre.djangoManifestSha256);
 assert.equal(await sha(runtime+'/app.prepare-'+pkg.id+'.json'),pkg.receiptSha256);
 assert.equal(await sha(runtime+'/app.deploy-'+pkg.id+'/deployment.json'),pkg.manifestSha256);
 for(const entry of pre.guardEntries)assert.equal(await sha('D:/运营管理系统/'+entry.path),entry.expected);
 await writeOnce(out+'/PUBLICATION_STARTED.json',{at:new Date().toISOString(),requestSha256:requestSha,sourceCommit:q.sourceCommit,mainCommit:q.mainCommit,maintenanceId:q.maintenanceId,noNewBackupOrRestore:true});
 await run('EnterMaintenance',worker,['-Action','EnterMaintenance','-MaintenanceId',q.maintenanceId,'-KeepPostgres','-Json'],v=>{assert.equal(v.status,'maintenance');assert.equal(v.maintenanceId,q.maintenanceId);assert.equal(v.postgresPreserved,true);});
 await run('Stop',worker,['-Action','Stop','-Json'],v=>assert(['stopped','already_stopped','stale_receipt_cleared'].includes(v.status)));
 await run('DeployApp',source+'/tools/django-local-service.ps1',['-Action','DeployApp','-PreparedAppId',pkg.id,'-PreparedAppSha256',pkg.receiptSha256,'-Json'],async()=>assert.equal(await sha(runtime+'/app/deployment.json'),pkg.manifestSha256),false);
 await run('HardenAcl',runtime+'/app/tools/django-local-service.ps1',['-Action','HardenAcl','-Json'],()=>{},false);
 await writeOnce(out+'/WorkerApply-started.json',{at:new Date().toISOString(),workerPlanSha256:plan.planSha256});
 try{const result=await rotation.applyApprovedRotationPlan({approvedPlanSha256:plan.planSha256,rotationLease});await writeOnce(out+'/WorkerApply-returned.json',result);}catch(error){await writeOnce(out+'/WorkerApply-unknown.json',{at:new Date().toISOString(),name:error.name,message:String(error.message).slice(0,500)});throw error;}
 await run('ExitMaintenance',worker,['-Action','ExitMaintenance','-MaintenanceId',q.maintenanceId,'-Json'],v=>assert.equal(v.status,'maintenance_ended'));
 await run('Start',worker,['-Action','Start','-Json'],v=>{assert(['started','already_running'].includes(v.status));assert.equal(v.manifestSha256,plan.candidateManifestSha256);});
 await run('VerifyStartup',worker,['-Action','VerifyStartup','-Json'],v=>assert.equal(v.startupVerified,true));
 const effective=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});assert.equal(effective.head.releaseId,plan.candidateReleaseId);
 assert.equal(await sha(runtime+'/app/deployment.json'),pkg.manifestSha256);
 const home=await fetch('http://127.0.0.1:3000/',{signal:AbortSignal.timeout(30000)});assert.equal(home.status,200);
 await writeOnce(out+'/PUBLICATION_RESULT.json',{at:new Date().toISOString(),status:'deployed',sourceCommit:q.sourceCommit,mainCommit:q.mainCommit,worker:plan.candidateReleaseId,workerManifestSha256:plan.candidateManifestSha256,djangoManifestSha256:pkg.manifestSha256,maintenanceId:q.maintenanceId,homepageHttpStatus:200,startupVerified:true,noNewBackupOrRestore:true,noMigrationChanges:true,noManualModelProbeOrDelivery:true});
 console.log(JSON.stringify({status:'deployed',worker:plan.candidateReleaseId,django:pkg.id}));
};
await action(lease);
}

 await prepare(lease,process.argv[2]);
 for(const [n,h]of Object.entries(executionScripts))assert.equal(await sha(out+'/'+n),h,'Execution code changed during preparation');
 await import(pathToFileURL(out+'/seal-publication.mjs'));
 const qraw=await fs.readFile(out+'/publication-request.json'),q=JSON.parse(qraw),ready=JSON.parse(await fs.readFile(out+'/PREPARATION_READY.json','utf8'));
 assert.deepEqual(q.executionScripts,executionScripts,'Execution code changed during seal');
 const tuple={requestSha256:createHash('sha256').update(qraw).digest('hex'),readySha256:await sha(out+'/PREPARATION_READY.json'),sourceCommit:q.sourceCommit,workerManifestSha256:ready.workerManifestSha256??JSON.parse(await fs.readFile(out+'/worker-plan.json','utf8')).candidateManifestSha256,djangoManifestSha256:ready.djangoManifestSha256,driverSha256:await sha(new URL(import.meta.url))};
 assert.equal(tuple.driverSha256,q.executionScripts['deliver.mjs']);
 const startedAt=Date.now(),deadline=startedAt+600000;
 await fs.writeFile(out+'/AWAITING_EXECUTION_REVIEW.json',JSON.stringify({...tuple,startedAt,deadline})+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:'awaiting-execution-review',...tuple,deadline}));
 try{
  const signal=await waitForExecution({out,tuple,startedAt,deadline});
  await fs.writeFile(out+'/EXECUTION_SIGNAL_CONSUMED.json',JSON.stringify({at:new Date().toISOString(),...signal,requestSha256:tuple.requestSha256})+'\n',{flag:'wx'});
 }catch(error){
  await fs.writeFile(out+'/REVIEW_WAIT_ENDED.json',JSON.stringify({status:'prepared-not-published',at:new Date().toISOString(),reason:String(error.message).slice(0,500),requestSha256:tuple.requestSha256})+'\n',{flag:'wx'});throw error;
 }
 await publish(lease,tuple.requestSha256);
});
