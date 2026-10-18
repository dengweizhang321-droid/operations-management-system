/** Root-only sealed operator. Importing does not load native modules or run I/O. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile),sha=raw=>createHash('sha256').update(raw).digest('hex');
const root=path.dirname(fileURLToPath(import.meta.url)),intentFile=path.join(root,'RECOVERY-INTENT.json');
const expectedRoot='D:\\codex-artifacts\\pi-inventory-erp-publish-20261018\\recovery-6dc-v2';
export async function regularBytes(file){
 const before=await fs.lstat(file),componentStoreHost=path.resolve(file).toLowerCase()===path.resolve('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe').toLowerCase();
 // Windows owns two normal component-store hardlinks to its PS5 executable.
 // This exact host is still physical-path and full-byte pinned; code/material
 // files retain the single-link rule.
 assert.ok(before.isFile()&&!before.isSymbolicLink()&&(before.nlink===1||componentStoreHost&&before.nlink===2),'Unsafe pinned file');
 assert.equal(path.resolve(await fs.realpath(file)).toLowerCase(),path.resolve(file).toLowerCase(),'Redirected pinned path');
 const key=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.nlink];const handle=await fs.open(file,'r');let raw;
 try{assert.deepEqual(key(await handle.stat()),key(before));raw=await handle.readFile();assert.deepEqual(key(await handle.stat()),key(before));}finally{await handle.close();}
 assert.deepEqual(key(await fs.lstat(file)),key(before));return raw;
}
async function pinned(file,digest){const raw=await regularBytes(file);assert.equal(sha(raw),digest,'Pinned bytes drifted: '+file);return raw;}
async function exists(file){try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
export function nativeVerifierArguments(chain){return [path.join(path.dirname(chain.headManifestPath),'tools/worker-local-release.mjs'),'verify','--manifest',chain.headManifestPath,'--approved-manifest-sha256',chain.head.manifestSha256,'--expected-source-d1-path-sha256',chain.bootstrap.authority.sourceD1PathSha256,'--expected-persist-root-path-sha256',chain.bootstrap.authority.persistRootPathSha256,'--expected-host','127.0.0.1','--expected-port','3000','--require-sales-retired-code-receipt','--process-policy','stopped','--json'];}
export async function atomicCatalog({catalogFile,previousSha256,receipt,receiptFile,sourceTree,savePrevious}){
 const receiptRaw=await regularBytes(receiptFile);assert.deepEqual(JSON.parse(receiptRaw),receipt);
 const catalog={...receipt,sourceTree,receiptPath:receiptFile,receiptSha256:sha(receiptRaw)},raw=Buffer.from(JSON.stringify(catalog,null,2)+'\n'),current=await regularBytes(catalogFile),currentSha=sha(current);
 if(currentSha===sha(raw))return {status:'already-bound',sha256:currentSha};
 assert.equal(currentSha,previousSha256,'Catalog predecessor changed');await savePrevious(current);
 assert.equal(sha(await regularBytes(catalogFile)),previousSha256,'Catalog changed before commit');
 const temporary=catalogFile+'.6dc-recovery-'+randomUUID()+'.tmp',handle=await fs.open(temporary,'wx');
 try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
 // No awaits or native work occur between the fresh compare and rename.
 assert.equal(sha(await regularBytes(catalogFile)),previousSha256,'Catalog changed at publication');await fs.rename(temporary,catalogFile);
 assert.equal(sha(await regularBytes(catalogFile)),sha(raw),'Catalog readback differs');return {status:'bound',sha256:sha(raw)};
}

export async function assertFrozenSource(source,git,identity){
 const actual={commit:await git(source,['rev-parse','HEAD']),tree:await git(source,['rev-parse','HEAD^{tree}']),status:await git(source,['status','--porcelain'])};
 assert.deepEqual(actual,{commit:identity.commit,tree:identity.tree,status:''},'Frozen authorized source changed');
}
export async function main(args=process.argv.slice(2)){
 assert.equal(path.resolve(root).toLowerCase(),expectedRoot.toLowerCase(),'Operator moved from its sealed directory');
 assert.equal(args.length,2);const [mode,intentSha256]=args;assert.ok(['execute','catalog-only'].includes(mode));assert.match(intentSha256??'',/^[a-f0-9]{64}$/);
 const facts=JSON.parse(await pinned(intentFile,intentSha256));assert.equal(facts.version,'6dc-maintenance-recovery-intent-v1');assert.equal(facts.mainCommit,'6dc028139cc6e561dcad68d76c9d673596d9ec82');assert.equal(facts.maintenanceId,'5fe642a2602243ca83819253d8848e57');
 const source='D:\\codex-isolated\\main-release-packages\\6dc028139cc6-c5d5bb6f-a9e3fdb9\\source';assert.equal(path.resolve(facts.source),source);
 const manifest=JSON.parse(await pinned(path.join(root,'MANIFEST.json'),facts.codeManifestSha256));
 for(const [name,digest]of Object.entries(manifest.code))await pinned(path.join(root,name),digest);
 for(const [file,digest]of Object.entries(manifest.native))await pinned(file,digest);
 for(const [logical,physical]of Object.entries(manifest.aliases))assert.equal((await fs.realpath(logical)).toLowerCase(),physical.toLowerCase(),'Prepared dependency alias changed');
 const {identity,runRecovery,finishCatalogOnly}=await import('./recovery-core.mjs');
 const config=JSON.parse(await pinned(facts.configFile,facts.configSha256));
 const publication=await import(pathToFileURL(path.join(source,'tools/publish-latest-main.mjs')));
 const environment=publication.publisherEnvironment({},config.gitDirectory,config.publisherBaseEnvironment);
 environment.PATH=config.pwshDirectory+';'+environment.PATH;environment.WRANGLER_HIDE_BANNER='true';environment.npm_config_cache=config.npmCacheDirectory;environment.npm_config_offline='true';environment.npm_config_prefer_online='false';environment.npm_config_prefer_offline='true';
 for(const name of Object.keys(process.env))delete process.env[name];Object.assign(process.env,environment);
 const deadlineUnixMs=Date.now()+1800000;process.env.TERUISI_PROCESS_DEADLINE_UNIX_MS=String(deadlineUnixMs);
 const api=await import(pathToFileURL(path.join(source,'tools/worker-local-release.mjs'))),rotation=await import(pathToFileURL(path.join(source,'tools/worker-local-release-rotation.mjs'))),transport=await import(pathToFileURL(path.join(source,'tools/release-batch.mjs'))),commands=await import(pathToFileURL(path.join(source,'tools/publish-main-command.mjs')));
 const token=await execute(facts.systemHost,['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],{encoding:'utf8',windowsHide:true,env:environment});assert.equal(token.stdout.trim(),'False','Recovery lifecycle requires ordinary token');
 assert.equal(path.resolve(facts.outputDirectory),path.join(root,'execution'));await fs.mkdir(facts.outputDirectory,{recursive:true});
 const output=facts.outputDirectory,store={
  exists:name=>exists(path.join(output,name)),
  read:async name=>JSON.parse(await regularBytes(path.join(output,name))),
  create:async(name,value)=>{const handle=await fs.open(path.join(output,name),'wx');try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}}
 };
 let chain;const git=async(root,args)=>(await execute(path.join(config.gitDirectory,'git.exe'),['-C',root,...args],{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:1024*1024})).stdout.trim();
 const staticCheck=async()=>{
  for(const [file,digest]of Object.entries(facts.originalPins))await pinned(file,digest);
  for(const [name,digest]of Object.entries(manifest.code))await pinned(path.join(root,name),digest);
  for(const [file,digest]of Object.entries(manifest.native))await pinned(file,digest);
  for(const [logical,physical]of Object.entries(manifest.aliases))assert.equal((await fs.realpath(logical)).toLowerCase(),physical.toLowerCase(),'Prepared dependency alias changed');
  await assertFrozenSource(source,git,identity);
  const request=JSON.parse(await regularBytes(facts.requestFile));assert.equal(request.mainCommit,identity.commit);assert.equal(request.migrate,false);assert.deepEqual(request.components,['worker','django']);
  const prepared=JSON.parse(await regularBytes(facts.preparedFile));assert.equal(prepared.requestSha256,facts.requestSha256);assert.equal(prepared.workerPlan.planSha256,identity.plan);assert.equal(prepared.djangoPackage.id,identity.preparedId);assert.equal(prepared.djangoPackage.receiptSha256,identity.preparedSha);
  const verified=JSON.parse(await regularBytes(facts.verifyPreparedResultFile)),verifiedProcess=JSON.parse(await regularBytes(facts.verifyPreparedProcessFile));assert.equal(verified.value.status,'prepared_verified');assert.equal(verified.value.id,identity.preparedId);assert.equal(verifiedProcess.processEvidence.exitCode,0);assert.equal(verifiedProcess.processEvidence.code,'completed');
  const candidateFile=mode==='catalog-only'?facts.installedDjangoManifest:facts.preparedDjangoManifest;
  const candidateRaw=await regularBytes(candidateFile);assert.equal(sha(candidateRaw),identity.django);const candidate=JSON.parse(candidateRaw);assert.equal(path.resolve(candidate.sourceRoot),source,'Prepared Django source changed');
 };
 const assertDjango=async expected=>assert.equal(sha(await regularBytes(facts.installedDjangoManifest)),expected,'Django manifest changed');
 const assertNoDownstream=async()=>{
  const names=await fs.readdir(facts.originalAttempt);assert.equal(names.some(name=>/^(停止旧前端|部署后台|应用后台权限|WorkerApply|退出维护|启动服务|确认启动版本|SUCCESS)/.test(name)),false,'Original attempt has downstream effects');
  assert.equal(await exists(facts.consumptionFile),false,'Approved plan has already been consumed');
 };
 const assertPredecessor=async()=>{await rotation.assertActiveBatchOwnership(api.workerRuntimeRoot);chain=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});assert.equal(chain.head.releaseId,identity.oldRelease);assert.equal(chain.head.manifestSha256,identity.oldWorker);assert.equal(chain.chainStateSha256,identity.chain);await assertDjango(identity.oldDjango);await assertNoDownstream();};
 const runNative=async(label,host,args)=>{
  await store.create(label+'-started.json',{at:new Date().toISOString(),host,args,deadlineUnixMs});
  try{const result=await api.runProcess(host,args,{cwd:source,env:transport.productionCommandEnvironment(host),timeoutMs:Math.max(1,Math.min(1800000,deadlineUnixMs-Date.now())),outputProtocol:'direct-exit-files',cleanup:'preserve',label:'6dc-recovery-'+label});
   for(const key of ['stdout','stderr'])await fs.writeFile(path.join(output,label+'.'+key+'.log'),result[key],{flag:'wx'});
   await store.create(label+'-process.json',{at:new Date().toISOString(),processEvidence:result.processEvidence});return result;
  }catch(error){await store.create(label+'-failed.json',{at:new Date().toISOString(),message:String(error.message).slice(0,1600),processEvidence:error.processEvidence??null,automaticRetry:false});throw error;}
 };
 const step=async(label,script,action,extra=[],json=true)=>{
  const command=commands.manualStepCommand({systemHost:facts.systemHost,powerShellDirectory:config.pwshDirectory,script,action,extra,addJson:true}),args=transport.productionCommandArguments(command.host,command.args),result=await runNative(label,command.host,args);
  let value=null;try{if(json)value=JSON.parse(result.stdout.trim());}catch(error){error.processEvidence=result.processEvidence;throw error;}
  await store.create(label+'-result.json',{at:new Date().toISOString(),value});return value;
 };
 let observation=0;
 const observe=async phase=>{
  const label=(mode==='catalog-only'?'Catalog-':'')+'Observe-'+(++observation)+'-'+phase,command=commands.manualStepCommand({systemHost:facts.systemHost,powerShellDirectory:config.pwshDirectory,script:path.join(root,'observe.ps1'),action:phase,extra:['-InputPath',intentFile,'-InputSha256',intentSha256,'-OwnerPid',String(process.pid),'-OwnerKind',mode==='catalog-only'?'catalog':'recovery']});
  const result=await runNative(label,command.host,transport.productionCommandArguments(command.host,command.args)),value=JSON.parse(result.stdout.trim());await store.create(label+'-result.json',value);return value;
 };
 const ready=async()=>{const response=await fetch('http://127.0.0.1:3000/_teruisi/local/health/ready',{headers:{'x-teruisi-local-health':'1'},signal:AbortSignal.timeout(15000)});try{assert.equal(response.status,200);const health=await response.json();assert.equal(health.ok,true);assert.equal(health.status,'ready');}finally{if(!response.bodyUsed&&!response.body?.locked)await response.body?.cancel();}};
 const assertTarget=async()=>{await rotation.assertActiveBatchOwnership(api.workerRuntimeRoot);const current=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});assert.equal(current.head.releaseId,identity.release);assert.equal(current.head.manifestSha256,identity.worker);await assertDjango(identity.django);};
 const d={now:()=>new Date().toISOString(),intentSha256,driverSha256:manifest.code['driver.mjs'],validateStatic:staticCheck,withRotationLock:callback=>rotation.withRotationLock(callback),assertActiveBatch:()=>rotation.assertActiveBatchOwnership(api.workerRuntimeRoot),
  owner:async()=>{
   const code=`$ProgressPreference='SilentlyContinue';$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${process.pid}';if($null -eq $p -or -not $p.CreationDate -or -not $p.ExecutablePath -or -not $p.CommandLine){throw 'Recovery owner metadata unavailable'};$h=[Security.Cryptography.SHA256]::Create();try{$command=([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($p.CommandLine)))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()};@{pid=[int]$p.ProcessId;creationDate=$p.CreationDate.ToUniversalTime().ToString('o');executableSha256=(Get-FileHash -LiteralPath $p.ExecutablePath -Algorithm SHA256).Hash.ToLowerInvariant();commandLineSha256=$command}|ConvertTo-Json -Compress`;
   const result=await runNative(mode==='catalog-only'?'CatalogOwnerIdentity':'OwnerIdentity',facts.systemHost,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')]),value=JSON.parse(result.stdout.trim());
   assert.equal(value.pid,process.pid);assert.match(value.creationDate,/^\d{4}-/);assert.equal(value.executableSha256,manifest.native[process.execPath]);assert.match(value.commandLineSha256,/^[a-f0-9]{64}$/);
   return {...value,version:'6dc-recovery-owner-v1',at:new Date().toISOString(),rotationLease:'current-in-process-native-lease',originalOwnerPid:32928,deadlineUnixMs};
  },
  observe,assertPredecessor,assertNoDownstream,assertDjango,step,enter:async()=>{const c=commands.manualStepCommand({systemHost:facts.systemHost,powerShellDirectory:config.pwshDirectory,script:path.join(root,'observe.ps1'),action:'Enter',extra:['-InputPath',intentFile,'-InputSha256',intentSha256,'-OwnerPid',String(process.pid)]});const r=await runNative('EnterMaintenance',c.host,transport.productionCommandArguments(c.host,c.args));const v=JSON.parse(r.stdout.trim());await store.create('EnterMaintenance-result.json',{at:new Date().toISOString(),value:v});return v;},apply:options=>rotation.applyApprovedRotationPlan(options),assertTarget,ready,
  sourceTree:async()=>api.hashRelativeFiles(source,await api.listGitSourceFiles(source)),
  verifyPrepared:async()=>{
   // The earlier complete source/candidate/prepared verification remains pinned
   // by original STARTED + the actual VerifyPreparedApp record. Current changed
   // Worker process state is admitted again by its own original full verifier.
   const result=await runNative('WorkerStoppedVerify',process.execPath,nativeVerifierArguments(chain));
   const value=JSON.parse(result.stdout.trim());assert.equal(value.status,'verified');assert.equal(value.manifestSha256,identity.oldWorker);await store.create('WorkerStoppedVerify-result.json',value);
  },
  catalogCas:async receipt=>{
   const result=await atomicCatalog({catalogFile:facts.catalogFile,previousSha256:facts.previousCatalogSha256,receipt,receiptFile:path.join(output,'RECOVERY-SUCCESS.json'),sourceTree:receipt.sourceTree,
    savePrevious:async raw=>{const file=path.join(output,'previous-PUBLISHED-MAIN.json');if(await exists(file))assert.deepEqual(await regularBytes(file),raw);else{const handle=await fs.open(file,'wx');try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}}}});
   await store.create(mode==='catalog-only'?'CATALOG-ONLY-RESULT.json':'CATALOG-RESULT.json',result);
  },
  readLive:()=>publication.readLivePublication({...config,nativeToolsSource:source})
 };
 const result=mode==='execute'?await runRecovery(facts,d,store):await finishCatalogOnly(facts,d,store);console.log(JSON.stringify({status:result.status,receiptPath:path.join(output,'RECOVERY-SUCCESS.json'),originalAttemptUntouched:true}));
 return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(String(error.message));process.exitCode=1;});
