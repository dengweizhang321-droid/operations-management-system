import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { runProcess, preparationEnvironmentSha256 } from '../tools/worker-local-release.mjs';
import { runApprovedOperation } from '../tools/release-batch.mjs';
import { safeFileDigest } from '../tools/release-impact.mjs';

const child = path.resolve('tests/fixtures/release-process-child.mjs');
const host = path.join(process.env.SystemRoot ?? 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
const quote = s => s.replaceAll("'","''");
const alive = pid => {try {process.kill(pid,0);return true;} catch {return false;}};
test('transport deadline changes do not invalidate exact build environment identity',()=>{
  const env={NODE_OPTIONS:'synthetic-build-flag',PSModulePath:'synthetic-modules'};
  assert.equal(preparationEnvironmentSha256(env),preparationEnvironmentSha256({...env,TERUISI_PROCESS_DEADLINE_UNIX_MS:'100'}));
  assert.equal(preparationEnvironmentSha256(env),preparationEnvironmentSha256({...env,teruisi_process_deadline_unix_ms:'200'}));
  assert.notEqual(preparationEnvironmentSha256(env),preparationEnvironmentSha256({...env,NODE_OPTIONS:'different-build-flag'}));
});
async function fixture(fn) {
  const root=await mkdtemp(path.join(tmpdir(),'teruisi-deadline-test-'));
  try {await fn(root);} finally {
    // This test owns all IDs recorded by its exact fixture (including services).
    for(const name of ['pids.json','service.json']) {
      try {const pids=JSON.parse(await readFile(path.join(root,name),'utf8'));for(const pid of Object.values(pids)) if(Number.isSafeInteger(pid)&&alive(pid))process.kill(pid);}catch{}
    }
    await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
}
for(const mode of ['hold','hold-stdout','hold-stderr','nonzero-hold']) test(`Node direct exit files: ${mode} does not wait for inherited stdout/stderr`, async()=>fixture(async root=>{
  const at=performance.now(); let evidence;
  try {
    const result=await runProcess(process.execPath,[child,mode,path.join(root,'pids.json')],{timeoutMs:3000,outputProtocol:'direct-exit-files',cleanup:'preserve'});
    assert.ok(mode.startsWith('hold')); assert.equal(JSON.parse(result.stdout).label,'运营管理系统');evidence=result.processEvidence;
  } catch(error) {assert.equal(mode,'nonzero-hold');assert.equal(error.processEvidence.exitCode,9);evidence=error.processEvidence;}
  assert.ok(performance.now()-at<1500);
  const pids=JSON.parse(await readFile(path.join(root,'pids.json'),'utf8'));
  assert.ok(alive(pids.service));assert.equal(evidence.exitCode,mode==='nonzero-hold'?9:0);
}));
test('EOF transport retains exit0 but fails within the same deadline while both streams are held', async()=>fixture(async root=>{
  const at=performance.now();
  await assert.rejects(runProcess(process.execPath,[child,'hold',path.join(root,'pids.json')],{timeoutMs:800,cleanup:'preserve'}),error=>{
    assert.equal(error.processEvidence.exitCode,0);assert.equal(error.processEvidence.timeoutType,'output');return true;
  });
  assert.ok(performance.now()-at<1400);assert.ok(alive(JSON.parse(await readFile(path.join(root,'pids.json'))).service));
}));
test('probe direct cleanup leaves its simulated service alive and no direct probe', async()=>fixture(async root=>{
  const at=performance.now();
  await assert.rejects(runProcess(process.execPath,[child,'hang-service',path.join(root,'pids.json')],{timeoutMs:1000,outputProtocol:'direct-exit-files',cleanup:'direct'}),/时限/);
  const pids=JSON.parse(await readFile(path.join(root,'pids.json')));
  assert.ok(performance.now()-at<1600);assert.equal(alive(pids.direct),false);assert.ok(alive(pids.service));
}));
test('an exhausted inherited deadline starts no child', async()=>fixture(async root=>{
  const record=path.join(root,'pids.json');
  await assert.rejects(runProcess(process.execPath,[child,'hold',record],{deadlineUnixMs:Date.now()-1,cleanup:'preserve'}),e=>e.processEvidence.stage==='spawn');
  await assert.rejects(readFile(record),{code:'ENOENT'});
}));
test('ordinary isolated tree cleanup retains no child or detached grandchild', {skip:process.platform!=='win32'}, async()=>fixture(async root=>{
  const at=performance.now();
  await assert.rejects(runProcess(process.execPath,[child,'hang-service',path.join(root,'pids.json')],{timeoutMs:3000,outputProtocol:'direct-exit-files',cleanup:'tree'}),e=>{
    assert.equal(e.processEvidence.timeoutType,'direct-exit');return true;
  });
  const pids=JSON.parse(await readFile(path.join(root,'pids.json')));
  assert.ok(performance.now()-at<3600);assert.equal(alive(pids.direct),false);assert.equal(alive(pids.service),false);
}));
for(const mode of ['invalid','nonzero','flood']) test(`approved runner rejects ${mode} and retains bounded diagnostics`,async()=>fixture(async root=>{
  const op={id:'isolated-negative',kind:'command',phase:'acceptance',mutating:false,
    command:{executable:process.execPath,args:[child,mode],cwd:root,timeoutMs:3000,files:[{path:process.execPath,sha256:await safeFileDigest(process.execPath)},{path:child,sha256:await safeFileDigest(child)}]},
    assertions:[{path:'status',equals:'completed'}]};
  await assert.rejects(runApprovedOperation(op,{batch:{id:'isolated-negative'},state:{latest:new Map()}}),e=>{
    assert.ok(e.processEvidence);if(mode!=='flood')assert.equal(e.processEvidence.exitCode,mode==='nonzero'?9:0);assert.ok(JSON.stringify(e.processEvidence).length<1800);return true;
  });
}));
for(const shell of ['powershell.exe','pwsh.exe']) test(`${shell}: shared transport and watchdog hold both streams without a late EOF wait`,{skip:process.platform!=='win32'},async()=>fixture(async root=>{
  const script=path.join(root,'harness.ps1');
  let library=`. '${quote(path.resolve('tools/operations-system-watchdog.ps1'))}' -FunctionsOnly`;
  if(shell==='powershell.exe') {
    const watch=await readFile(path.resolve('tools/operations-system-watchdog.ps1'),'utf8');
    library=`. '${quote(path.resolve('tools/process-deadline.ps1'))}'\n`+watch.slice(watch.indexOf('function Invoke-WatchProcess'),watch.indexOf('function Invoke-WatchScript'));
  }
  await writeFile(script,'\uFEFF'+`
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
${library}
$WatchdogRoot='${quote(root)}'
$timer=[Diagnostics.Stopwatch]::StartNew()
$result=Invoke-WatchProcess '${quote(process.execPath)}' @('${quote(child)}','hold','${quote(path.join(root,'pids.json'))}') 3
$first=$timer.ElapsedMilliseconds
$capture=Invoke-DeadlineProcess -Executable '${quote(process.execPath)}' -Arguments @('${quote(child)}','nonzero') -WorkingDirectory $WatchdogRoot -Deadline (Get-ProcessDeadline 3000)
if($capture.ExitCode -ne 9){throw 'real exit was lost'}
$caught=$null
try{[void](Invoke-WatchProcess '${quote(process.execPath)}' @('${quote(child)}','hang-service','${quote(path.join(root,'service.json'))}') 1)}catch{$caught=$_.Exception.Data['ProcessEvidence']}
if($caught.code -ne 'process_deadline_exhausted'){throw 'deadline classification lost'}
[ordered]@{status=$result.status;label=$result.label;firstMs=$first;failure=$caught}|ConvertTo-Json -Depth 12 -Compress
`,'utf8');
  const result=spawnSync(shell,['-NoProfile','-NonInteractive','-File',script],{encoding:'utf8',windowsHide:true,timeout:12000});
  assert.equal(result.status,0,result.stderr);const data=JSON.parse(result.stdout.trim());
  assert.equal(data.status,'completed');assert.equal(data.label,'运营管理系统');assert.ok(data.firstMs<1800);
  const pids=JSON.parse(await readFile(path.join(root,'service.json')));assert.equal(alive(pids.direct),false);assert.ok(alive(pids.service));
}));

for(const shell of ['powershell.exe','pwsh.exe']) test(`${shell}: concurrent lifecycle mutex obeys the original deadline`,{skip:process.platform!=='win32'},async()=>fixture(async root=>{
  const script=path.join(root,'mutex.ps1');
  const holder=`using System;using System.Threading;public static class DeadlineMutexFixture {public static ManualResetEvent Ready=new ManualResetEvent(false),Release=new ManualResetEvent(false);public static Thread Start(string name){var t=new Thread(()=>{using(var m=new Mutex(false,name)){m.WaitOne();Ready.Set();Release.WaitOne();m.ReleaseMutex();}});t.IsBackground=true;t.Start();return t;}}`;
  await writeFile(script,'\uFEFF'+`
$ErrorActionPreference='Stop'
. '${quote(path.resolve('tools/worker-local-service.ps1'))}' -FunctionsOnly -Action Start -Json -AllowTestRuntimeRoot -RuntimeRoot '${quote(root)}'
Add-Type -TypeDefinition '${quote(holder)}'
$script:testMutexName='TERUISI.Test.ProcessDeadline.'+[guid]::NewGuid().ToString('N')
function Get-WorkerServiceMutexName {return $script:testMutexName}
$thread=[DeadlineMutexFixture]::Start($script:testMutexName)
try {
  if(-not [DeadlineMutexFixture]::Ready.WaitOne(1000)){throw 'isolated mutex was not acquired'}
  $WorkerOperationDeadline=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+180
  $timer=[Diagnostics.Stopwatch]::StartNew();$caught=$false
  try{Enter-WorkerServiceMutex 900|Out-Null}catch{if($_.Exception.Message -ceq 'process_deadline_exhausted'){$caught=$true}else{throw}}
  if(-not $caught -or $timer.ElapsedMilliseconds -gt 600){throw 'mutex began another waiting budget'}
  [ordered]@{deadlineRejected=$caught;elapsedMs=$timer.ElapsedMilliseconds;productionTouched=$false}|ConvertTo-Json -Compress
} finally {[void][DeadlineMutexFixture]::Release.Set();[void]$thread.Join(1000)}
`,'utf8');
  const result=spawnSync(shell,['-NoProfile','-NonInteractive','-File',script],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout.trim()).deadlineRejected,true);
}));

test('watchdog deadline, safe diagnostics and unknown notification delivery remain bounded', {skip:process.platform!=='win32'},async()=>fixture(async root=>{
  const script=path.join(root,'watch-contracts.ps1');
  await writeFile(script,'\uFEFF'+`
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
. '${quote(path.resolve('tools/operations-system-watchdog.ps1'))}' -FunctionsOnly
$WatchdogRoot='${quote(root)}';$StatePath=Join-Path $WatchdogRoot 'state.json'
foreach($mode in @('invalid','nonzero','flood')) {
  $diagnostic=$null
  try{Invoke-WatchProcess '${quote(process.execPath)}' @('${quote(child)}',$mode) 5|Out-Null}catch{$diagnostic=$_.Exception.Data['ProcessEvidence']}
  if(-not $diagnostic -or $diagnostic.code -eq 'completed'){throw 'invalid output/exit accepted'}
  if(($diagnostic|ConvertTo-Json -Compress).Length -gt 1800){throw 'unbounded diagnostic'}
}
function Get-WatchRecipient {@{profile='synthetic';user='synthetic';bot='synthetic'}}
$script:sendCalls=0
function Invoke-WatchDws {
  $script:sendCalls++
  $failure=[Exception]::new('sensitive synthetic-secret https://example.invalid/?token=synthetic')
  $failure.Data['ProcessEvidence']=@{code='process_deadline_exhausted';stage='direct-exit';exitCode=$null;timeoutType='direct-exit'}
  throw $failure
}
$state=New-WatchState;$state.incident='synthetic-incident';$state.firstFailure='synthetic-time'
$snapshot=@{system='unknown';backend='unknown';ports=@()}
Send-WatchAlert $state $snapshot 'alert_only'
Send-WatchAlert $state $snapshot 'alert_only'
$alert=Read-WatchJson (Join-Path $WatchdogRoot 'alerts/synthetic-incident.json')
if($script:sendCalls -ne 1 -or $state.notification -cne 'unknown' -or $alert.processDiagnostic.timeoutType -cne 'direct-exit'){throw 'unknown delivery replayed or evidence lost'}
if(($alert|ConvertTo-Json -Depth 8) -match 'synthetic-secret|example.invalid|token='){throw 'sensitive exception was persisted'}
# The second process and HTTP/ports may not get a fresh budget after expiry.
$script:httpCalls=0
function Get-Admission {@{mode='running';fence='synthetic'}}
function Invoke-WatchScript {
  Invoke-DeadlineProcess -Executable '${quote(process.execPath)}' -Arguments @('${quote(child)}','hang') -WorkingDirectory $WatchdogRoot -Deadline (Get-ProcessDeadline) -Cleanup Direct|Out-Null
}
function Test-WatchHttp {$script:httpCalls++;@{ok=$true;status=200}}
$env:TERUISI_PROCESS_DEADLINE_UNIX_MS=[string]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+300)
$clock=[Diagnostics.Stopwatch]::StartNew();$observed=Get-WatchSnapshot
if(-not $observed.probeError -or $script:httpCalls -ne 0 -or $clock.ElapsedMilliseconds -gt 700){throw 'snapshot exceeded deadline or began a late probe'}
# A synchronous port query may return late, but may never turn into late healthy.
function Invoke-WatchScript($Path,$Arguments) {
  if($Path -eq $SupervisorPath){return @{supervisorProcess='running';health='healthy'}}
  $components=@{};@('core','finance','netshop','market','products','workflow','inventory','customerService','accessControl','erpReference','bi','ai')|ForEach-Object{$components[$_]=$true}
  return [pscustomobject]@{state='Running';backendState='Ready';workerState='exact_release';components=[pscustomobject]$components;releaseId='synthetic';portProcessId=1;supervisorProcessId=2}
}
function Read-WatchJson {return @{updatedAt=[DateTimeOffset]::UtcNow.ToString('o')}}
function Get-NetTCPConnection {Start-Sleep -Milliseconds 800}
$env:TERUISI_PROCESS_DEADLINE_UNIX_MS=[string]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+300)
$late=Get-WatchSnapshot
if($late.healthy -or -not $late.probeError -or $late.processDiagnostic.code -cne 'process_deadline_exhausted'){throw 'late ports declared healthy'}
[ordered]@{notification=$state.notification;mockSendCalls=$script:sendCalls;lateHttpCalls=$script:httpCalls;snapshotMs=$clock.ElapsedMilliseconds;productionTouched=$false}|ConvertTo-Json -Compress
`,'utf8');
  const result=spawnSync('pwsh.exe',['-NoProfile','-NonInteractive','-File',script],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout.trim()).mockSendCalls,1);
}));

for(const scenario of ['ready','engine-failed','wrong-version','incomplete','bad-json','maintenance','deadline','drain','missing-identity','fake-components']) test(`original nested PS5 adapter: ${scenario}`,{skip:process.platform!=='win32'},async()=>fixture(async root=>{
  const fake=path.join(root,'fake 中文.ps1'),wrapper=path.join(root,'release-lifecycle-step.ps1');
  await writeFile(fake,'\uFEFF'+`
param([string]$Action,[switch]$Json)
$ErrorActionPreference='Stop'
$null=Microsoft.PowerShell.Security\\Get-Acl -LiteralPath $PSScriptRoot
$manifest='${'a'.repeat(64)}'
if($Action -eq 'Start') {
  $p=Start-Process -FilePath '${quote(process.execPath)}' -NoNewWindow -PassThru -ArgumentList @('"${child}"','grandchild')
  [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'pids.json'),(@{direct=$PID;service=$p.Id}|ConvertTo-Json -Compress))
  if('${scenario}' -eq 'deadline'){Start-Sleep -Seconds 4}
  if('${scenario}' -eq 'bad-json'){Write-Output '{"status":';exit 0}
  @{status='started';manifestSha256=$manifest;releaseId='approved';supervisorProcessId=$(if('${scenario}' -eq 'missing-identity'){$null}else{42})}|ConvertTo-Json -Compress
  if('${scenario}' -eq 'engine-failed'){exit 9};exit 0
}
if($Action -eq 'MaintenanceStatus') {
  $maintenance=$null;$drain=$null
  if('${scenario}' -eq 'maintenance'){$maintenance=@{id='${'b'.repeat(32)}'}}
  if('${scenario}' -eq 'drain'){$drain=@{id='${'b'.repeat(32)}';phase='requests';keepPostgres=$true}}
  @{maintenance=$maintenance;automationDrain=$drain}|ConvertTo-Json -Compress;exit 0
}
$components=@{};@('core','finance','netshop','market','products','workflow','inventory','customerService','accessControl','erpReference','bi')|ForEach-Object{$components[$_]=$true}
if('${scenario}' -eq 'fake-components'){$components=@{};1..12|ForEach-Object{$components["domain$_"]=$true}}
if('${scenario}' -eq 'incomplete'){$components.bi=$false}
if('${scenario}' -eq 'wrong-version'){$manifest='${'c'.repeat(64)}'}
@{version='teruisi-operations-system-control-v2';state='Running';backendState='Ready';workerState='exact_release';components=$components;releaseId='approved';supervisorProcessId=42;portProcessId=43}|ConvertTo-Json -Compress
`,'utf8');
  // Worker Status and system Status have different real schemas.
  const worker=path.join(root,'worker.ps1');
  await writeFile(worker,'\uFEFF'+`
param([string]$Action,[switch]$Json)
if($Action -eq 'Status') {
 @{version='teruisi-local-worker-status-v1';state='exact_release';manifestSha256='${scenario==='wrong-version'?'c'.repeat(64):'a'.repeat(64)}';releaseId='approved';supervisorProcessId=42;portProcessId=43}|ConvertTo-Json -Compress;exit 0
}
& '${quote(fake)}' -Action $Action -Json
exit $LASTEXITCODE
`,'utf8');
  await writeFile(path.join(root,'deployment.json'),'{}');
  const source=await readFile(path.resolve('tools/release-lifecycle-step.ps1'),'utf8');
  await writeFile(wrapper,source.replace(/\$worker='[^']*'/,`$worker='${quote(worker)}'`).replace(/\$control='[^']*'/,`$control='${quote(fake)}'`).replace(/\$aiEnabledPath='[^']*'/,`$aiEnabledPath='${quote(path.join(root,'ai-enabled.json'))}'`).replace(/\$deployment='[^']*'/,`$deployment='${quote(path.join(root,'deployment.json'))}'`),'utf8');
  await copyFile(path.resolve('tools/process-deadline.ps1'),path.join(root,'process-deadline.ps1'));
  const args=['-NoProfile','-NonInteractive','-File',wrapper,'-Step','StartWorker','-ExpectedWorkerManifestSha256','a'.repeat(64),'-ExpectedDjangoManifestSha256',await safeFileDigest(path.join(root,'deployment.json')),'-MaintenanceId','b'.repeat(32)];
  if(scenario==='drain')args.push('-ExpectedDrainId','b'.repeat(32));
  const op={id:'isolated-start',kind:'lifecycle',step:'StartWorker',phase:'switch',mutating:true,
    command:{executable:host,args,cwd:root,timeoutMs:scenario==='deadline'?2400:30000,files:[{path:host,sha256:await safeFileDigest(host)},{path:wrapper,sha256:await safeFileDigest(wrapper)},{path:path.join(root,'process-deadline.ps1'),sha256:await safeFileDigest(path.join(root,'process-deadline.ps1'))}]},assertions:[{path:'status',equals:'completed'},{path:'readiness',equals:'complete'},{path:'manifestSha256',equals:'a'.repeat(64)}]};
  const batch={id:'isolated-start',binding:{artifactSha256:'a'.repeat(64),djangoCandidateSha256:await safeFileDigest(path.join(root,'deployment.json')),maintenanceId:'b'.repeat(32)},impact:{level:scenario==='drain'?'display':'strict'}};
  const at=performance.now();
  if(['ready','drain'].includes(scenario)) {
    const r=await runApprovedOperation(op,{batch,state:{latest:new Map()}});assert.equal(r.status,'passed');assert.equal(r.processEvidence.exitCode,0);assert.equal(r.processEvidence.engine.length,4);assert.ok(r.timing.engineMs>0);assert.ok(r.timing.validationMs>0);
    console.log('ISOLATED_START_TIMING '+JSON.stringify({scenario,...r.timing,totalMs:r.processEvidence.elapsedMs,descendantHeldMs:60000}));
  } else await assert.rejects(runApprovedOperation(op,{batch,state:{latest:new Map()}}),e=>{
    assert.ok(e.processEvidence);if(scenario==='engine-failed')assert.equal(e.processEvidence.engine.at(-1).exitCode,9);return true;
  });
  assert.ok(performance.now()-at<(scenario==='deadline'?3100:30500));
  const pids=JSON.parse(await readFile(path.join(root,'pids.json')));assert.ok(alive(pids.service));
}));
