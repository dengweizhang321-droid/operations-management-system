import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import{pathToFileURL}from'node:url';import{execFileSync}from'node:child_process';import{createHash}from'node:crypto';
const source='D:/codex-isolated/ai-schedule-repeat-fix-20261015-v2/source',out='D:/codex-artifacts/ai-schedule-repeat-fix-20261015-v2',runtime='D:/teruisi-runtime/django-sales';
const hash=b=>createHash('sha256').update(b).digest('hex'),sha=async f=>hash(await fs.readFile(f));
assert.match(process.argv[2]??'',/^[a-f0-9]{64}$/);const compositionRaw=await fs.readFile(out+'/composition-final.json');assert.equal(hash(compositionRaw),process.argv[2]);const c=JSON.parse(compositionRaw);
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
await rotation.withRotationLock(async rotationLease=>{
 await rotation.assertActiveBatchOwnership(api.workerRuntimeRoot);
 const chain=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});assert.deepEqual(chain.head,predecessor.workerHead);assert.equal(chain.chainStateSha256,predecessor.chainStateSha256);assert.equal(await sha(runtime+'/app/deployment.json'),predecessor.djangoManifestSha256);
 const allowed=new Set(Object.keys(c.files));const actual=[];
 for(const f of await api.listGitSourceFiles(source)){const raw=await fs.readFile(source+'/'+f);let before;try{before=await fs.readFile(path.join(path.dirname(chain.headManifestPath),'source-snapshot',f));}catch(e){if(e.code!=='ENOENT')throw e;}if(!before||!raw.equals(before)){assert(allowed.has(f),'Unrelated source changed: '+f);actual.push(f);}}
 assert.deepEqual(actual.sort(),[...allowed].sort());
 await writeOnce(out+'/PREPARATION_STARTED.json',{at:new Date().toISOString(),sourceCommit:c.sourceCommit,mainCommit:c.mainCommit,predecessor:chain.head,djangoPredecessor:predecessor.djangoManifestSha256,compositionSha256:process.argv[2],administrator:false});
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
  await writeOnce(out+'/PREPARATION_READY.json',{at:new Date().toISOString(),sourceCommit:c.sourceCommit,mainCommit:c.mainCommit,compositionSha256:process.argv[2],workerPlanSha256:plan.planSha256,workerRelease:plan.candidateReleaseId,djangoPreparedId:pkg.id,djangoReceiptSha256:pkg.receiptSha256,djangoManifestSha256:manifestSha,predecessorUnchanged:true,productionSwitchExecuted:false});
  console.log(JSON.stringify({status:'prepared',worker:plan.candidateReleaseId,django:pkg.id,source:c.sourceCommit,main:c.mainCommit}));
 }catch(error){await writeOnce(out+'/DJANGO_PREPARE_UNKNOWN.json',{at:new Date().toISOString(),name:error.name,code:error.code??null,message:String(error.message).slice(0,500),processEvidence:error.processEvidence??null});throw error;}
});
