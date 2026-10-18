/** Run reviewed release compatibility checks on an exact, isolated candidate.
 * This does not publish, grant a startup permit, or claim a native cold start.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {makeReleasePlan} from './release-scope-plan.mjs';
import {publisherEnvironment} from './publish-latest-main.mjs';
import {hashTree} from './worker-local-release.mjs';

const execute=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex');
const git=async(root,args)=>(await execute('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024})).stdout.trim();
const productionRoots=['D:/teruisi-runtime','D:/运营管理系统','D:/运营管理系统-sales-django-release'];
const within=(root,target)=>{const r=path.relative(path.resolve(root),path.resolve(target));return !r||(!r.startsWith('..')&&!path.isAbsolute(r));};

export function candidateTestEnvironment({gitExe,shell5,shell7,pythonExe,directory}){
 const environment=publisherEnvironment(process.env);
 environment.PATH=[path.dirname(process.execPath),path.dirname(gitExe),path.dirname(shell7),path.dirname(pythonExe),path.join(environment.SYSTEMROOT,'System32'),path.dirname(shell5)].join(';');
 environment.PSModuleAnalysisCachePath=path.join(directory,'module-cache');
 environment.PSModulePath=path.join(path.dirname(shell7),'Modules');
 environment.PYTHONDONTWRITEBYTECODE='1';environment.PYTHONIOENCODING='utf-8';
 return environment;
}

export function candidateCompatibilityProfile(changes){
 const files=changes.flatMap(c=>[c.before,c.path].filter(Boolean));
 const paths=files.filter(f=>!f.startsWith('docs/')&&!f.startsWith('tests/')&&!['README.md','AGENTS.md'].includes(f));
 const proofFiles=['bi_app_addition','jackyun_audit_addition','ai_schedule_addition','jd_logistics_addition','jd_monitor_preferences_addition','jd_product_monitoring_addition','tmall_warehouse_addition','pi_agent_addition'].map(name=>'tools/'+name+'.py');
 const preparationFiles=['tools/main-prebuild-task.mjs','tools/main-prebuild-hook.mjs','tools/main-prebuild-queue.mjs','tools/main-control-dispatch.mjs','tools/install-main-prebuild.mjs','tools/manual-maintenance-continuation.mjs','tools/manual-maintenance-continuation.ps1','tools/manual-maintenance-start.ps1'];
 const supported=new Set(['tools/publish-main.mjs','tools/publish-prepared-main.mjs','tools/publish-latest-main.mjs',
  'tools/main-prebuild-status.mjs','tools/worker-local-release.mjs','tools/django-local-service.ps1','tools/django-ai.ps1','tools/verify-release-candidate.mjs']);
 for(const file of [...proofFiles,...preparationFiles,'tools/worker-local-release-rotation.mjs'])supported.add(file);
 const unsupported=paths.filter(p=>!supported.has(p));
 const schemaProof=paths.some(p=>proofFiles.includes(p)),preparationQueue=paths.some(p=>preparationFiles.includes(p)||p==='tools/publish-latest-main.mjs'||p==='tools/worker-local-release-rotation.mjs');
 return {version:schemaProof||preparationQueue?'release-three-optimizations-v1':'release-compatibility-profile-v1',paths,unsupported,schemaProof,preparationQueue,
  publication:paths.some(p=>/publish-|main-prebuild|manual-maintenance|verify-release-candidate|release-scope-plan/.test(p)),
  worker:paths.some(p=>/worker-local-release/.test(p)),
  django:paths.includes('tools/django-local-service.ps1'),
  piExitObservation:paths.includes('tools/django-ai.ps1'),
  nativeColdStartPerformed:false};
}

export async function assertPrivateCandidateLocation(target){
 const absolute=path.resolve(target);
 for(const root of productionRoots)assert.ok(!within(root,absolute),'候选验证不能使用生产根目录：'+absolute);
 // Refuse a path that becomes a different directory through a junction.
 let cursor=absolute;
 for(;;){
  try{assert.equal((await fs.lstat(cursor)).isSymbolicLink(),false,'候选路径不能经过重解析点：'+cursor);}catch(e){if(e.code!=='ENOENT')throw e;}
  const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;
 }
 return absolute;
}

async function functionsOf(script,host,environment){
 const code='$e=$null;$a=[Management.Automation.Language.Parser]::ParseFile($env:TERUISI_CANDIDATE_PARSE_FILE,[ref]$null,[ref]$e);if($e.Count){throw "parse failed"};$functions=@($a.EndBlock.Statements|Where-Object{$_ -is [Management.Automation.Language.FunctionDefinitionAst]}|ForEach-Object{[pscustomobject]@{name=$_.Name;text=$_.Extent.Text}});$other=@([string]$a.ParamBlock.Extent.Text)+@($a.EndBlock.Statements|Where-Object{$_ -isnot [Management.Automation.Language.FunctionDefinitionAst]}|ForEach-Object{$_.Extent.Text});[pscustomobject]@{functions=$functions;other=$other}|ConvertTo-Json -Depth 4 -Compress';
 const result=await execute(host,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{encoding:'utf8',env:{...environment,TERUISI_CANDIDATE_PARSE_FILE:script},windowsHide:true,maxBuffer:8*1024*1024});
 return JSON.parse(result.stdout);
}
export function compareFunctionOnlyChange(before,after){
 const allowed=new Set(['Get-FileSha256','Get-ExistingFileSha256','Get-ApplicationTreeFingerprintEvidence']);
 const normalize=text=>text.replaceAll('\r\n','\n');
 if(JSON.stringify(before.other.map(normalize))!==JSON.stringify(after.other.map(normalize)))return false;
 const old=new Map(before.functions.map(f=>[f.name,normalize(f.text)]));
 const next=new Map(after.functions.map(f=>[f.name,normalize(f.text)]));
 for(const name of new Set([...old.keys(),...next.keys()]))if(old.get(name)!==next.get(name)&&!allowed.has(name)){
  if(name!=='Invoke-DjangoMigrations'||stripGateTiming(next.get(name))!==old.get(name))return false;
 }
 return true;
}
export function usesGateTimingExemption(before,after){
 const find=value=>value.functions.find(item=>item.name==='Invoke-DjangoMigrations')?.text.replaceAll('\r\n','\n');
 const old=find(before),next=find(after);return typeof old==='string'&&typeof next==='string'&&old!==next&&stripGateTiming(next)===old;
}
export function comparePiExitObservationChange(before,after){
 const normalize=text=>text.replaceAll('\r\n','\n');
 if(JSON.stringify(before.other.map(normalize))!==JSON.stringify(after.other.map(normalize)))return false;
 const old=new Map(before.functions.map(f=>[f.name,normalize(f.text)])),next=new Map(after.functions.map(f=>[f.name,normalize(f.text)]));
 if(old.has('Wait-PiWorkerExit')||!next.has('Wait-PiWorkerExit')||sha(Buffer.from(next.get('Wait-PiWorkerExit')))!=='4372d8872c46760d40f7aa346b6476932be8edba7415baba0ae21e9b73293fd3')return false;
 const addition=`  $receiptSha256 = if (Test-Path -LiteralPath $PiWorkerPidPath -PathType Leaf) { Get-FileSha256 $PiWorkerPidPath } else { $null }\n`;
 const pin=`    if ((Get-FileSha256 $PiWorkerPidPath) -cne $receiptSha256) { throw "Pi worker ownership record changed before stop" }\n`;
 const observer='    Wait-PiWorkerExit $owned $receiptSha256 (Get-FileSha256 $PiWorkerControlPath) $deadline';
 const prior=`    while (Resolve-OwnedProcess "django-ai-pi-worker" $PiWorkerPidPath $Python) {
      if ([DateTimeOffset]::UtcNow -ge $deadline) { throw "Pi queue stop remains unknown; writer and runner were preserved" }
      Start-Sleep -Milliseconds 250
    }`;
 const stop=next.get('Stop-PiRuntime');
 if(!stop?.includes(addition)||!stop.includes(pin)||!stop.includes(observer))return false;
 next.set('Stop-PiRuntime',stop.replace(addition,'').replace(pin,'').replace(observer,prior));next.delete('Wait-PiWorkerExit');
 return old.size===next.size&&[...old].every(([name,text])=>next.get(name)===text);
}
export function stripGateTiming(text){
 if(typeof text!=='string')return text;
 const release=`  $protectedGateClock = [Diagnostics.Stopwatch]::StartNew()
  $protectedGateAt = [DateTimeOffset]::UtcNow.ToString('o')
  $protectedGateOutcome = 'completed'
  try {
    Assert-NoUnapprovedProtectedAiMigration "Django migrate"
  } catch {
    $protectedGateOutcome = 'failed'
    throw
  } finally {
    try { Write-DjangoStartupTiming 'protected-release-gate' $protectedGateAt $protectedGateClock.ElapsedMilliseconds $protectedGateOutcome } catch { }
  }`;
 const database=`      $databaseGateClock = [Diagnostics.Stopwatch]::StartNew()
      $databaseGateAt = [DateTimeOffset]::UtcNow.ToString('o')
      $databaseGateOutcome = 'completed'
      try {
        $check = Invoke-BoundedNativeProcess $Python @($integrationGate, 'database', '--root', $ExecutionRoot, '--runtime', $RuntimeRoot) $BackendRoot
        $verified = ConvertFrom-UniqueNativeJson $check 'Verify completed integration migrations'
        if ([string]$verified.status -cne 'verified') { throw 'Protected migration plan is incomplete' }
      } catch {
        $databaseGateOutcome = 'failed'
        throw
      } finally {
        try { Write-DjangoStartupTiming 'database-complete-gate' $databaseGateAt $databaseGateClock.ElapsedMilliseconds $databaseGateOutcome } catch { }
      }`;
 if(!text.includes(release)||!text.includes(database))return null;
 return text.replace(release,'  Assert-NoUnapprovedProtectedAiMigration "Django migrate"').replace(database,`      $check = Invoke-BoundedNativeProcess $Python @($integrationGate, 'database', '--root', $ExecutionRoot, '--runtime', $RuntimeRoot) $BackendRoot
      $verified = ConvertFrom-UniqueNativeJson $check 'Verify completed integration migrations'
      if ([string]$verified.status -cne 'verified') { throw 'Protected migration plan is incomplete' }`);
}

export function compareFixedAdminQueueChange(before,after){
 before=before.replaceAll('\r\n','\n');after=after.replaceAll('\r\n','\n');
 const begin='\n// FIXED_ADMIN_E2_BEGIN\n',end='// FIXED_ADMIN_E2_END\n';
 const start=after.indexOf(begin),stop=after.indexOf(end,start);
 if(start<0||stop<0||before.includes(begin)||after.indexOf(begin,start+1)!==-1)return false;
 const block=after.slice(start,stop+end.length);
 if(sha(Buffer.from(block))!=='942bfda5342275eb27b57c77512720cf11c3ab07e7aaac53a8c5e3559486d563')return false;
 const changed="      if(!terminal||['unknown','failed','blocked'].includes(terminal.status)){\n       if(!terminal||!await readFixedAdminRejectionResolution(directory,dispatch,terminal))unresolved={dispatch,sha256:read.sha256};\n      }";
 const original="      if(!terminal||['unknown','failed','blocked'].includes(terminal.status))unresolved={dispatch,sha256:read.sha256};";
 let remainder=after.slice(0,start)+after.slice(stop+end.length);
 const replacements=[
  [changed,original],
  ["  const admissionBlocked=value.status==='blocked'&&value.admission==='ordinary-user-before-dispatch-v1';\n",''],
  ["const extra=admissionBlocked?['admission','error']:value.status",'const extra=value.status'],
  ["  if(admissionBlocked){\n   assert.equal(typeof value.error,'string');\n   for(const name of await entries(directory,'dispatches')){const read=await readQueueObject(path.join(directory,'dispatches',name));validateDispatch(read.value,name);assert.ok(!read.value.tickets.some(ref=>ref.requestId===requestId),'A dispatched ticket cannot become a pre-dispatch admission rejection');}\n   return value;\n  }\n",''],
  ["   assert.equal(prior.sha256,value.blockedDispatchSha256);\n   return value;","   assert.equal(prior.sha256,value.blockedDispatchSha256);assert.equal(prior.value.configSha256,value.configSha256);assert.equal(prior.value.bundleSha256,value.bundleSha256);return value;"],
  ['onStage=async()=>{},admitPreparation=async()=>{}})','onStage=async()=>{}})'],
  ["    try{await admitPreparation();}\n    catch(error){for(const item of pending)await finish(item,'blocked',{admission:'ordinary-user-before-dispatch-v1',error:String(error.message)});break;}\n",''],
 ];
 for(const [next,prior] of replacements){if(!remainder.includes(next))return false;remainder=remainder.replace(next,prior);}
 return remainder===before;
}
export function compareFixedPreparationAdmissionChange(before,after){
 before=before.replaceAll('\r\n','\n');after=after.replaceAll('\r\n','\n');
 const begin='// PREPARATION_ELIGIBILITY_BEGIN\n',end='// PREPARATION_ELIGIBILITY_END\n',start=after.indexOf(begin),stop=after.indexOf(end,start);
 if(start<0||stop<0||before.includes(begin)||after.indexOf(begin,start+1)!==-1)return false;
 if(sha(Buffer.from(after.slice(start,stop+end.length)))!=='8d095e2413bfac310803273f4e1b44bc6b8899a68897b12c7f52bf9118dac2cd')return false;
 const core=after.slice(0,start)+after.slice(stop+end.length),signature='assertGeneration=assertControlGeneration,admit=assertOrdinaryPreparationContext}={})',callback='admitPreparation:()=>admit(config),';
 if(!core.includes(signature)||!core.includes(callback))return false;
 return core.replace(signature,'assertGeneration=assertControlGeneration}={})').replace(callback,'')===before;
}

export async function verifyReleaseCandidate({sourceRoot,base,head='HEAD',out,dependencies,python='python.exe',reuseReport}={}){
 const source=await assertPrivateCandidateLocation(sourceRoot??process.cwd());
 const verifierRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 assert.equal((await fs.realpath(source)).toLowerCase(),(await fs.realpath(verifierRoot)).toLowerCase(),'验证器必须来自被验证候选，不能使用其他工作树的旧工具');
 assert.ok(base,'必须指定 --base，不能省略前驱差异');
 assert.equal(await git(source,['status','--porcelain']),'','候选存在未提交修改；先冻结候选提交再验证');
 const commit=await git(source,['rev-parse',head+'^{commit}']);
 assert.equal(await git(source,['rev-parse','HEAD']),commit,'候选必须是当前干净HEAD');
 const baseCommit=await git(source,['rev-parse',base+'^{commit}']);
 await git(source,['merge-base','--is-ancestor',baseCommit,commit]);
 const tree=await git(source,['rev-parse','HEAD^{tree}']);
 const directory=await assertPrivateCandidateLocation(out??path.join(os.tmpdir(),'release-candidate-'+randomUUID()));
 assert.ok(!within(source,directory),'验证输出必须在候选工作树之外');
 await fs.mkdir(directory,{recursive:false});
 const plan=makeReleasePlan({base:baseCommit,head:commit,cwd:source});
 const profile=candidateCompatibilityProfile(plan.changes);
 let fixedAdminOnly=false,reusedBaseline;
 if(reuseReport){
  assert.equal(baseCommit,'aaca18485021b6f98107fe168b69c8f57d55ee46','限定增量只复用已核aaca基线');
  assert.ok(profile.paths.includes('tools/main-prebuild-queue.mjs')&&profile.paths.includes('tools/publish-latest-main.mjs')&&profile.paths.every(name=>['tools/main-prebuild-queue.mjs','tools/publish-latest-main.mjs','tools/verify-release-candidate.mjs'].includes(name)),'增量超出固定queue协调/普通用户准入范围');
  const old=(await execute('git',['-C',source,'show',baseCommit+':tools/main-prebuild-queue.mjs'],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024})).stdout;
  assert.equal(compareFixedAdminQueueChange(old,await fs.readFile(path.join(source,'tools/main-prebuild-queue.mjs'),'utf8')),true,'固定helper或unresolved接缝以外发生变化');
  const oldPublisher=(await execute('git',['-C',source,'show',baseCommit+':tools/publish-latest-main.mjs'],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024})).stdout;
  assert.equal(compareFixedPreparationAdmissionChange(oldPublisher,await fs.readFile(path.join(source,'tools/publish-latest-main.mjs'),'utf8')),true,'普通用户只读准入/回调接缝以外发生变化');
  const raw=await fs.readFile(reuseReport);assert.equal(sha(raw),'f4d7678e3c34d91c30aa44b05628521efbdfa55fb16d0ac0a2e3f5dc743ee33c','原完整证明变化');
  const baseline=JSON.parse(raw);assert.equal(baseline.status,'passed');assert.equal(baseline.commit,baseCommit);assert.equal(baseline.evidence.packageIntegrity,true);assert.equal(baseline.evidence.piWorkerExitObservation,true);
  fixedAdminOnly=true;reusedBaseline={path:path.resolve(reuseReport),sha256:sha(raw),commit:baseline.commit,tree:baseline.tree,evidence:baseline.evidence,inputs:{tools:baseline.tools,dependencies:baseline.dependencies,powerShellModules:baseline.powerShellModules}};
 }
 const report={version:'release-candidate-verification-v1',source,baseCommit,commit,tree,plan,profile,startedAt:new Date().toISOString(),
  status:'running',checks:[],evidence:{packageIntegrity:false,nativeEntryBoundary:false,nativeColdStart:false},publicationPerformed:false};
 if(fixedAdminOnly){report.profile={...profile,version:'fixed-admin-e2-preparation-admission-v1',fixedAdminOnly:true};report.reusedBaseline=reusedBaseline;}
 const reportFile=path.join(directory,'REPORT.json');
 const write=()=>fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
 await write();
 const candidate=path.join(directory,'candidate');let attached=false;
 try{
  assert.equal(profile.unsupported.length,0,'本验证器没有覆盖这些变更，需补受影响兼容适配器：'+profile.unsupported.join(', '));
  const where=async name=>(await execute('C:/Windows/System32/where.exe',[name],{encoding:'utf8',windowsHide:true})).stdout.trim().split(/\r?\n/)[0];
  const shell5='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',shell7=await where('pwsh.exe'),gitExe=await where('git.exe'),pythonExe=path.isAbsolute(python)?python:await where(python);
  const environment=candidateTestEnvironment({gitExe,shell5,shell7,pythonExe,directory});
  environment.TERUISI_COMPATIBILITY_BASE=baseCommit;
  environment.PYTHONPATH=[path.join(candidate,'tools'),path.join(candidate,'tests'),path.join(candidate,'backend')].join(path.delimiter);
  report.environmentSha256=sha(Buffer.from(JSON.stringify(environment)));
  report.tools=await Promise.all([process.execPath,shell5,shell7,pythonExe,gitExe].map(async file=>({path:file,sha256:sha(await fs.readFile(file))})));
  report.powerShellModules={root:environment.PSModulePath,tree:await hashTree(environment.PSModulePath)};
  await git(source,['worktree','add','--detach',candidate,commit]);attached=true;
  assert.ok(dependencies||(!profile.worker&&!profile.django&&!profile.publication),'该profile需要显式的只读依赖目录');
  if(dependencies){
   assert.ok((await fs.stat(path.join(dependencies,'typescript','package.json'))).isFile(),'依赖不完整');
   await fs.symlink(path.resolve(dependencies),path.join(candidate,'node_modules'),'junction');
   const physicalRoot=await fs.realpath(dependencies);
   report.dependencies={physicalRoot,tree:await hashTree(physicalRoot)};
  }
  if(fixedAdminOnly){
   assert.deepEqual(report.tools,reusedBaseline.inputs.tools,'执行工具漂移，不能复用原应用/Pi证明');
   assert.deepEqual(report.dependencies,reusedBaseline.inputs.dependencies,'依赖漂移，不能复用原应用/Pi证明');
   assert.deepEqual(report.powerShellModules,reusedBaseline.inputs.powerShellModules,'PowerShell模块漂移，不能复用原应用/Pi证明');
  }
  const members=(await git(candidate,['ls-files','-z'])).split('\0').filter(Boolean);
  report.payload=[];
  for(const name of members){const file=path.join(candidate,name);assert.ok(!(await fs.lstat(file)).isSymbolicLink(),'候选包含链接：'+name);report.payload.push({path:name,sha256:sha(await fs.readFile(file))});}
  report.payloadSha256=sha(Buffer.from(JSON.stringify(report.payload)));
  if(profile.django){
   const old=path.join(directory,'before-django.ps1');
   const bytes=(await execute('git',['-C',source,'show',baseCommit+':tools/django-local-service.ps1'],{encoding:'buffer',maxBuffer:8*1024*1024,windowsHide:true})).stdout;
   await fs.writeFile(old,bytes);
   const current=path.join(candidate,'tools/django-local-service.ps1');
   const [a,b]=await Promise.all([functionsOf(old,shell7,environment),functionsOf(current,shell7,environment)]);
   report.gateTimingChanged=usesGateTimingExemption(a,b);
   report.requiresNativeColdStart=!compareFunctionOnlyChange(a,b);
   assert.equal(report.requiresNativeColdStart,false,'生命周期语义发生变化，需专用隔离冷启动适配器；不能以边界测试代替');
  }
  if(profile.piExitObservation){
   const old=path.join(directory,'before-django-ai.ps1');
   const bytes=(await execute('git',['-C',source,'show',baseCommit+':tools/django-ai.ps1'],{encoding:'buffer',maxBuffer:4*1024*1024,windowsHide:true})).stdout;
   await fs.writeFile(old,bytes);
   const [a,b]=await Promise.all([functionsOf(old,shell7,environment),functionsOf(path.join(candidate,'tools/django-ai.ps1'),shell7,environment)]);
   assert.equal(comparePiExitObservationChange(a,b),true,'Pi adapter only permits the reviewed Windows exit observer; routing or other lifecycle changes require native cold start');
   report.piExitObservationOnly=true;
  }
  async function run(name,executable,args,kind){
   const started=Date.now(),item={name,executable,args,kind,startedAt:new Date().toISOString(),status:'running'};report.checks.push(item);await write();
   const output=path.join(directory,name+'.stdout.log'),errors=path.join(directory,name+'.stderr.log');
   try{
    const result=await execute(executable,args,{cwd:candidate,env:environment,encoding:'buffer',windowsHide:true,timeout:900000,maxBuffer:16*1024*1024});
    await fs.writeFile(output,result.stdout);await fs.writeFile(errors,result.stderr);item.exitCode=0;item.status='passed';
   }catch(error){await fs.writeFile(output,error.stdout??Buffer.alloc(0));await fs.writeFile(errors,error.stderr??Buffer.alloc(0));item.error=String(error.message);item.exitCode=error.code??null;item.status='failed';throw error;}
   finally{item.elapsedMs=Date.now()-started;item.stdoutSha256=sha(await fs.readFile(output));item.stderrSha256=sha(await fs.readFile(errors));await write();}
  }
  if(fixedAdminOnly){
   await run('fixed-admin-queue',process.execPath,['--test','--test-concurrency=1','tests/fixed-admin-resolution.test.mjs','tests/fixed-admin-compatibility.test.mjs','tests/main-prebuild-eligibility.test.mjs','tests/main-prebuild-queue-v2.test.mjs'],'native-entry-boundary');
   await run('fixed-admin-private-bundle',process.execPath,['--test','--test-name-pattern=materials preserve frozen environment','tests/main-control-upgrade.test.mjs','tests/main-prebuild-task.test.mjs','tests/fixed-admin-resolution.test.mjs','tests/main-prebuild-eligibility.test.mjs'],'package-integrity');
  }
  if(!fixedAdminOnly&&profile.publication)await run('publication',process.execPath,['--test','tests/main-publication-readiness.test.mjs','tests/publish-prepared-main.test.mjs','tests/publish-latest-main.test.mjs','tests/publish-main-command.test.mjs','tests/main-prebuild-status.test.mjs','tests/verify-release-candidate.test.mjs','tests/release-batch-powershell-environment.test.mjs','tests/manual-maintenance-pi-readiness.test.mjs'],'native-entry-boundary');
  if(!fixedAdminOnly&&profile.preparationQueue)await run('preparation-queue-control',process.execPath,['--test','--test-concurrency=1','tests/main-prebuild-hook.test.mjs','tests/main-prebuild-queue-v2.test.mjs','tests/main-control-upgrade.test.mjs','tests/main-prebuild-task.test.mjs','tests/fixed-admin-resolution.test.mjs','tests/main-prebuild-eligibility.test.mjs'],'native-entry-boundary');
  if(profile.worker)await run('worker-integrity',process.execPath,['--test','tests/worker-source-read-once.test.mjs','tests/release-source-binding.test.mjs','tests/release-preparation-runtime-config.test.mjs'],'package-integrity');
  if(!fixedAdminOnly&&(profile.schemaProof||profile.preparationQueue))await run('optimization-boundaries',process.execPath,['--test','tests/release-optimization-boundaries.test.mjs'],'package-integrity');
  if(profile.schemaProof){
   await run('schema-proof-unit',pythonExe,['-m','unittest','discover','-s','tests','-p','test_*addition.py'],'isolated-functions');
   await run('schema-proof-full-history',pythonExe,['-m','unittest','discover','-s','tests','-p','test_schema_proof_flow.py'],'package-integrity');
   await run('schema-proof-boundary',pythonExe,['tests/schema-proof-change-boundary.py','--base',baseCommit],'isolated-functions');
   const baselineTools=path.join(directory,'baseline-python-tools');await fs.mkdir(baselineTools);
   for(const name of ['bi_app_addition','jackyun_audit_addition','ai_schedule_addition','jd_logistics_addition','jd_monitor_preferences_addition','jd_product_monitoring_addition','tmall_warehouse_addition','pi_agent_addition']){
    const raw=(await execute('git',['-C',source,'show',baseCommit+':tools/'+name+'.py'],{encoding:'buffer',windowsHide:true,maxBuffer:8*1024*1024})).stdout;await fs.writeFile(path.join(baselineTools,name+'.py'),raw);
   }
   await run('schema-private-postgres',pythonExe,['tests/schema-gate-postgres.py','--out',path.join(directory,'private-postgres'),'--baseline',baselineTools,'--skip-measurements'],'real-private-postgres');
  }
  if(profile.django)for(const [name,host] of [['ps5',shell5],['ps7',shell7]]){
   for(const file of ['django-lifecycle-tree-reuse','django-local-service-fingerprint','django-orchestrated-start-acl'])await run(name+'-'+file,host,['-NoProfile','-NonInteractive','-File','tests/'+file+'.test.ps1'],'isolated-functions');
   if(report.gateTimingChanged)await run(name+'-migration-gate-timing',host,['-NoProfile','-NonInteractive','-File','tests/django-migration-gate-timing.test.ps1'],'native-entry-boundary');
  }
  if(profile.piExitObservation){
   await run('pi-exit-change-boundary',process.execPath,['--test','tests/pi-exit-change-boundary.test.mjs'],'isolated-functions');
   for(const [name,host] of [['ps5',shell5],['ps7',shell7]])await run(name+'-pi-exit-negative',host,['-NoProfile','-NonInteractive','-File','tests/pi-worker-exit.test.ps1'],'isolated-functions');
   await run('pi-worker-native-exit',shell7,['-NoProfile','-NonInteractive','-File','tests/pi-worker-exit.test.ps1','-Native','-Python',pythonExe],'native-pi-worker-exit');
   report.evidence.piWorkerExitObservation=true;
  }
  if(!fixedAdminOnly&&(profile.publication||profile.django)){
   await run('powershell-entry',pythonExe,['-m','unittest','discover','-s','tests','-p','test_pi150_recovery_entry.py'],'native-entry-boundary');
   await run('actual-django-package',shell7,['-NoProfile','-NonInteractive','-File','tests/release-candidate-package.test.ps1'],'package-integrity');
  }
  assert.equal(await git(candidate,['status','--porcelain']),'','测试修改了候选工作树');
  for(const member of report.payload)assert.equal(sha(await fs.readFile(path.join(candidate,member.path))),member.sha256,'验证期间候选字节变化：'+member.path);
  if(report.dependencies)assert.deepEqual(await hashTree(report.dependencies.physicalRoot),report.dependencies.tree,'验证期间依赖字节发生变化');
  for(const tool of report.tools)assert.equal(sha(await fs.readFile(tool.path)),tool.sha256,'验证期间执行工具发生变化：'+tool.path);
  assert.deepEqual(await hashTree(report.powerShellModules.root),report.powerShellModules.tree,'验证期间PowerShell模块发生变化');
  report.evidence.packageIntegrity=report.checks.some(c=>c.kind==='package-integrity');
  report.evidence.nativeEntryBoundary=report.checks.some(c=>c.kind==='native-entry-boundary');
  if(fixedAdminOnly){report.evidence.unmodifiedApplicationAndPi=reusedBaseline.evidence;report.evidence.fixedAdminQueueResolution=true;}
  report.nativeColdStartReason=profile.piExitObservation?'Not executed: exact AST-qualified Windows Pi exit observer only; real private empty pi_worker.main and same-token Stop tested, fixed WSL runner lifecycle not executed.':'Not executed: profiles cover package digests, admission and native command boundaries; no Start/Stop routing semantics changed.';
  report.status='passed';
 }catch(error){report.status='failed';report.error=String(error.message);}
 finally{
  report.completedAt=new Date().toISOString();
  if(attached){
   try{
    const modules=path.join(candidate,'node_modules');try{if((await fs.lstat(modules)).isSymbolicLink())await fs.unlink(modules);}catch(e){if(e.code!=='ENOENT')throw e;}
    await git(source,['worktree','remove',candidate]);report.candidateWorktreeRemoved=true;
   }catch(error){report.candidateWorktreeRemoved=false;report.cleanupError=String(error.message);report.status='failed';}
  }
  await write();
 }
 return {status:report.status,reportFile,tree,commit,evidence:report.evidence};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {values}=parseArgs({options:{source:{type:'string'},base:{type:'string'},head:{type:'string',default:'HEAD'},out:{type:'string'},dependencies:{type:'string'},python:{type:'string'},'reuse-report':{type:'string'}}});
 verifyReleaseCandidate({sourceRoot:values.source,base:values.base,head:values.head,out:values.out,dependencies:values.dependencies,python:values.python,reuseReport:values['reuse-report']}).then(result=>{console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
