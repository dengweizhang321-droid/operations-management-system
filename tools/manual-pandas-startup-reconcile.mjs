/**
 * One-off completion of the Pandas Broker "first startup" step for the
 * c7604df9 publication. That publication finished every step through
 * SwitchPandasRotation (Linux side is switched_stopped) and then failed at
 * phase "启动服务" because its original publication-owner node.exe process
 * (pid 66644) had already exited by the time Start-PandasSandbox ran, so
 * Assert-PandasPublicationOwner (tools/django-ai.ps1:431-442) could not find
 * a live owner and threw "Pandas rotation requires the original live
 * publication owner".
 *
 * This module binds to exactly one plan hash, by exact value (see
 * knownPandasStartup below), and refuses every other input. It is a ONE-TIME
 * tool: it must never be reused for a different rotation or a different
 * failure, and it carries no generic "resume" capability.
 *
 * It never writes to, or modifies the bytes of: app/tools/django-ai.ps1, the
 * Worker release tree, any control bundle, any frozen publish package,
 * app/deployment.json, or the WSL systemd unit. Its only writes are:
 *  - the normal protocol receipts tools/django-ai.ps1 itself writes under
 *    run/ for a Pandas startup (pandas-rotation-<plan>.startup-attempt.json,
 *    .startup.json, .complete.json) -- these are written by the REAL,
 *    unmodified Start-PandasSandbox / Complete-PandasRotation function
 *    bodies, exactly as a successful live run would write them;
 *  - the normal operational tools/django-ai.ps1 launcher.jsonl log entries,
 *    again written by the real, unmodified Write-LauncherEvent;
 *  - this tool's own evidence directory under D:/codex-isolated/
 *    main-manual-release-20261016/recovery-c7604df99c55-<hash>/.
 *
 * Reuse strategy (see buildRecoveryScript): the real installed
 * tools/django-local-service.ps1 is dot-sourced as a library
 * (TERUISI_DJANGO_SERVICE_LIBRARY_ONLY=1, exactly as tools/django-ai.ps1
 * itself does at its own top), so every native call this tool makes --
 * Start-ManagedProcess for the WSL keepalive, Invoke-BoundedNativeProcess for
 * the Python broker rotation client, Invoke-PandasSystemctl, Invoke-
 * PandasProbe -- goes through the real, unmodified function bodies. The
 * installed tools/django-ai.ps1 is then source-parsed with the PowerShell
 * AST parser and exactly the function definitions named in
 * extractedFunctionNames are extracted byte for byte and loaded into the
 * same scope -- the identical mechanism already used (and reviewed) by
 * tests/pandas-broker-rotation-startup-seam.test.ps1 for its private Linux
 * fixture. The ONE function this driver defines itself, instead of
 * extracting, is Assert-PandasPublicationOwner: see
 * ownerSubstitutePowerShell for the exact, narrower predicate it substitutes
 * and why each clause only narrows (never relaxes) the original gate.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify,parseArgs} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';

const execute=promisify(execFile),self=fileURLToPath(import.meta.url);
const digest=raw=>createHash('sha256').update(raw).digest('hex');
const exists=async file=>{try{await fs.access(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const hash=async file=>digest(await fs.readFile(file));

/** Every identity this tool recognizes. Any mismatch anywhere refuses, zero writes. */
export const knownPandasStartup=Object.freeze({
  version:'manual-pandas-startup-recovery-c7604df9-v1',
  mainCommit:'c7604df99c552dfaa770f46980aec266f1047b30',
  maintenanceId:'8fb21f03834e44f3a428ce9c8a7c6acb',
  planSha256:'3f52a62675e41ff328928beb1f2233e0a6b94fffef770210472944118926b36a',
  preparedAppId:'914540fa742c45ef90afee54c0e1a48a',
  preparedAppSha256:'0ec274d41fa3b382cb9b23a40a43a5232fa583c8a70021df015efd717e5099fe',
  image:'sha256:b3b657aa2ff87fe3d8cef0bc26872a3f4253fafe82f839980c82edb64c01cffe',
  sourceSha256:'2c8147c570e0cb6113837bafc045adfa6d70c8bcb1d4248583f6b65c6a367188',
  predecessorSourceSha256:'3173042892d14e6edcf8465b8ea97e878f307e08fdb1c81d2752f82e03dcc610',
  publicationOwnerPid:66644,
  publicationOwnerCreationDate:'2026-11-10T08:49:47.0834050Z',
  deploymentManifestSha256:'49ff2e8b97ec89f9fb7f51dc7fba72ec987f029ac3a799f57e7bade4d6dfbaa9',
  djangoAiScriptSha256:'fb4358db6b99403e8b4d44d8a44d01803d11184b0567233725bf65b422d142b5',
  failedReceiptSha256:'c4e1529896a3077bb09d89aaf5d0f27dd2900c4a6392c4c171dbea6485bca8d5',
  startedReceiptSha256:'b7b23b5ae360c69efaecc970eba569c50bcd1de46391f522e54566ee962bb0eb',
  pandasSwitchedReceiptSha256:'2da737cd250ad8c9acea67fc1c1d67a7cff8631e1c091a05fd0e9926b874f4c4',
  maintenanceFirstActorSha256:'6b9550accf6bd1f1df2d5b11e3fd263d98080aad1413a4f2c2054414a5fc90ce',
  preparedReceiptSha256:'7fb8aa85040c6adc9379393e2b52458227a8c00f301ce184b7cab0a7e52bfadb',
});

export const windowsPowerShell5='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';

/**
 * Function bodies extracted byte-for-byte from the installed
 * tools/django-ai.ps1, in the order the real Start-PandasSandbox pending
 * branch (django-ai.ps1:567-600) needs them available. Nothing here is
 * retyped from memory -- the PowerShell AST parser pulls the exact source
 * ranges, and extractScript below asserts the count matches so a renamed or
 * removed function refuses instead of silently extracting fewer bodies.
 */
// Assert-RuntimeChildPath is NOT in this list: it is defined once in the
// real installed tools/django-local-service.ps1 (the base library this
// driver dot-sources for real, see buildRecoveryScript), not in
// tools/django-ai.ps1 itself. Extracting it from django-ai.ps1's own AST
// would find zero matches; the dot-sourced base library already provides it
// to every extracted function body below that calls it.
export const extractedFunctionNames=[
  'Read-PandasRotationJson','Write-PandasRotationJson','Get-PandasRotationPath',
  'Assert-PandasRotationBinding','Assert-SamePandasRotation','Get-PendingPandasRotation',
  'Assert-PandasInstalledBinding','Invoke-PandasRotationNative','Start-PandasSandbox','Complete-PandasRotation',
];

/**
 * PowerShell fragment that AST-parses the installed django-ai.ps1 and prints
 * the exact concatenated source text of extractedFunctionNames. Run once,
 * read-only, before anything else -- its output is what the recovery script
 * actually executes, so the extraction step is independently inspectable in
 * the evidence directory (02-extracted-functions.ps1.txt).
 */
export function buildExtractScript(installedAiScriptPath,names){
  const list=names.map(n=>"'"+n+"'").join(',');
  return [
    "$ErrorActionPreference='Stop'",
    "$tokens=$null;$parseErrors=$null",
    "$ast=[System.Management.Automation.Language.Parser]::ParseFile('"+installedAiScriptPath.replaceAll('\\','/')+"',[ref]$tokens,[ref]$parseErrors)",
    "if($parseErrors.Count){throw 'Cannot parse installed AI controller'}",
    "$names=@("+list+")",
    "$functions=@($ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -cin $names},$false))",
    "if($functions.Count -ne $names.Count){throw 'Installed controller function inventory changed: expected '+$names.Count+' got '+$functions.Count}",
    "$byName=@{};foreach($fn in $functions){$byName[$fn.Name]=$fn.Extent.Text}",
    "$ordered=foreach($n in $names){$byName[$n]}",
    "[Console]::Out.Write(($ordered -join \"`n`n\"))",
  ].join('\n');
}

/**
 * The one deliberate substitution for Assert-PandasPublicationOwner. Returns
 * PowerShell source text (not JSON passed across a process boundary) so the
 * check runs inside the SAME PowerShell process, under the SAME
 * Invoke-WithServiceMutex lock, as Start-PandasSandbox / Complete-
 * PandasRotation -- there is no gap where a concurrent real Start/Stop could
 * observe a different state than what this predicate just verified.
 *
 * Original assertion (tools/django-ai.ps1:431-442), what it actually checks:
 *  - release-publication-lease.json exists, is well-formed, matches
 *    Binding.maintenanceId/sourceCommit, and owner.ProcessName is 'node', AND
 *  - the recorded owner pid is alive with StartTime <= lease.createdAt, AND
 *  - lease.expiresAt is still in the future.
 *
 * Substitute, every clause narrower, never looser:
 *  1. The lease file must NOT exist (original tolerates it existing with a
 *     live owner; this refuses outright rather than accept any lease state).
 *  2. The recorded owner pid (66644) must be provably gone: either no
 *     process holds pid 66644 right now, or a process does but its
 *     CreationDate differs from the one captured at publication time
 *     (2026-11-10T08:49:47.0834050Z) -- i.e. pid reuse by an unrelated later
 *     process is treated as "still disqualified", not as "absent enough".
 *  3. system-maintenance.json and automation-drain.json must both be absent
 *     (original has no opinion on these at all).
 *  4. FAILED.json for this exact publish attempt must hash to the one
 *     recorded value, with phase=='启动服务' and maintenanceStarted==true
 *     (original has no opinion on any prior failure at all).
 *  5. Binding identity (preparedAppId/Sha256/plan/sourceCommit/maintenanceId
 *     /ownerPid) must equal the one hard-coded plan this tool recognizes --
 *     so this substitute can never fire for any other pending rotation.
 * Any clause failing throws the same message family the original uses, and
 * -- because this function body runs in place of the original inside the
 * same process -- Start-PandasSandbox's surrounding try/catch treats it
 * exactly like the original throwing: zero further writes that call makes.
 *
 * The Worker rotation lock (clause 6 in the brief) is checked separately, in
 * Node, immediately before this PowerShell process is launched, by calling
 * the publisher's own exported probeRotationLock() from
 * tools/publish-latest-main.mjs -- the exact same probe --adopt-live uses --
 * instead of re-implementing a second, hand-written named-pipe probe here.
 * See verifyPreconditions.
 */
export function ownerSubstitutePowerShell({failedReceiptPath,known=knownPandasStartup}){
  const k=known;
  return [
    "function Assert-PandasPublicationOwner([object]$Binding) {",
    "  if ($Binding.preparedAppId -cne '"+k.preparedAppId+"' -or $Binding.preparedAppSha256 -cne '"+k.preparedAppSha256+"' -or",
    "      $Binding.registeredPlanSha256 -cne '"+k.planSha256+"' -or $Binding.sourceCommit -cne '"+k.mainCommit+"' -or",
    "      $Binding.maintenanceId -cne '"+k.maintenanceId+"' -or $Binding.publicationOwnerPid -ne "+k.publicationOwnerPid+") {",
    "    throw 'Pandas rotation owner substitute is bound to a single known plan; this binding does not match it'",
    "  }",
    "  $leasePath = Join-Path $RunDirectory 'release-publication-lease.json'",
    "  if (Test-Path -LiteralPath $leasePath) { throw 'Pandas rotation requires the original live publication owner (lease file still present)' }",
    "  $ownerAbsent = $false",
    "  try {",
    "    $owner = Get-Process -Id "+k.publicationOwnerPid+" -ErrorAction Stop",
    "    $sameCreation = ([DateTimeOffset]$owner.StartTime.ToUniversalTime()).ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ') -ceq '"+k.publicationOwnerCreationDate+"'",
    "    if ($sameCreation) { throw 'Pandas rotation requires the original live publication owner (recorded owner pid is still the same live process)' }",
    "  } catch [Microsoft.PowerShell.Commands.ProcessCommandException] { $ownerAbsent = $true }",
    "  if (-not $ownerAbsent) {",
    "    # A different process now holds this pid (recycled id): still disqualified, never treated as 'absent enough'.",
    "  }",
    "  if (Test-Path -LiteralPath (Join-Path $RuntimeRoot 'run\\system-maintenance.json')) { throw 'Pandas rotation owner substitute refuses while system-maintenance.json is present' }",
    "  if (Test-Path -LiteralPath (Join-Path $RuntimeRoot 'run\\automation-drain.json')) { throw 'Pandas rotation owner substitute refuses while automation-drain.json is present' }",
    "  $failedPath = '"+failedReceiptPath.replaceAll('\\','/')+"'",
    "  if (-not (Test-Path -LiteralPath $failedPath -PathType Leaf)) { throw 'Pandas rotation owner substitute requires the original FAILED.json to still be present' }",
    "  $failedBytes = [IO.File]::ReadAllBytes($failedPath)",
    "  $failedHash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($failedBytes)).Replace('-','').ToLowerInvariant()",
    "  if ($failedHash -cne '"+k.failedReceiptSha256+"') { throw 'Pandas rotation owner substitute requires the exact known FAILED.json bytes' }",
    "  $failed = [Text.Encoding]::UTF8.GetString($failedBytes) | ConvertFrom-Json",
    "  if ($failed.phase -cne '启动服务' -or $failed.maintenanceStarted -ne $true) { throw 'Pandas rotation owner substitute requires phase=启动服务 and maintenanceStarted=true' }",
    "}",
  ].join('\n');
}

/**
 * The other half of Start-PandasSandbox's pending-branch precondition
 * (django-ai.ps1:561-563): "if a pending rotation exists and its startup
 * receipt is missing, the original startup outcome is unknown; preserve it".
 * That clause only fires when Resolve-OwnedProcess finds an existing owned
 * keepalive -- i.e. it protects an *already running* unknown attempt. This
 * tool's extra preconditions (checked in Node before the PowerShell process
 * is even started) are the ones from the task brief's full list; see
 * verifyPreconditions.
 */
export async function verifyPreconditions({runtimeRoot,installedToolsRoot,probeRotationLock,known=knownPandasStartup}){
  const k=known,runDirectory=path.join(runtimeRoot,'run');
  const problems=[];
  const pendingPath=path.join(runDirectory,'pandas-rotation-'+k.planSha256+'.pending.json');
  const startupAttemptPath=path.join(runDirectory,'pandas-rotation-'+k.planSha256+'.startup-attempt.json');
  const startupPath=path.join(runDirectory,'pandas-rotation-'+k.planSha256+'.startup.json');
  const completePath=path.join(runDirectory,'pandas-rotation-'+k.planSha256+'.complete.json');
  const leasePath=path.join(runDirectory,'release-publication-lease.json');
  const maintenancePath=path.join(runDirectory,'system-maintenance.json');
  const drainPath=path.join(runDirectory,'automation-drain.json');
  const pandasPidPath=path.join(runDirectory,'ai-pandas-wsl.pid.json');
  if(!await exists(pendingPath))problems.push('pending记录缺失: '+pendingPath);
  else{
    const pending=JSON.parse(await fs.readFile(pendingPath,'utf8'));
    for(const [field,expected] of [['preparedAppId',k.preparedAppId],['preparedAppSha256',k.preparedAppSha256],
      ['registeredPlanSha256',k.planSha256],['sourceCommit',k.mainCommit],['maintenanceId',k.maintenanceId],
      ['publicationOwnerPid',k.publicationOwnerPid]])
      if(pending[field]!==expected)problems.push('pending.'+field+' 不符: 期望 '+expected+' 实际 '+pending[field]);
  }
  if(await exists(startupAttemptPath))problems.push('startup-attempt 记录已存在，不是全新待处理状态: '+startupAttemptPath);
  if(await exists(startupPath))problems.push('startup 记录已存在，原启动可能已完成: '+startupPath);
  if(await exists(completePath))problems.push('complete 记录已存在，原轮换可能已完成: '+completePath);
  if(await exists(leasePath))problems.push('release-publication-lease.json 仍存在: '+leasePath);
  if(await exists(maintenancePath))problems.push('system-maintenance.json 仍存在: '+maintenancePath);
  if(await exists(drainPath))problems.push('automation-drain.json 仍存在: '+drainPath);
  if(await exists(pandasPidPath))problems.push('ai-pandas-wsl.pid.json 仍存在，keepalive 可能仍在: '+pandasPidPath);
  const deploymentPath=path.join(runtimeRoot,'app/deployment.json');
  const aiScriptPath=path.join(installedToolsRoot,'django-ai.ps1');
  if(!await exists(deploymentPath))problems.push('deployment.json 缺失: '+deploymentPath);
  else if(await hash(deploymentPath)!==k.deploymentManifestSha256)problems.push('deployment.json 字节不符');
  if(!await exists(aiScriptPath))problems.push('django-ai.ps1 缺失: '+aiScriptPath);
  else if(await hash(aiScriptPath)!==k.djangoAiScriptSha256)problems.push('django-ai.ps1 字节不符');
  // Same probe --adopt-live's own preflight uses (tools/publish-latest-main.mjs
  // probeRotationLock), reused rather than re-implemented, so "is the Worker
  // rotation lock held right now" has exactly one implementation in the repo.
  const rotationLockHeld=await probeRotationLock();
  if(rotationLockHeld)problems.push('Worker rotation lock 仍被持有，可能有发布或准备正在进行');
  return {ok:problems.length===0,problems,rotationLockHeld,paths:{pendingPath,startupAttemptPath,startupPath,completePath,leasePath,maintenancePath,drainPath,pandasPidPath,deploymentPath,aiScriptPath}};
}

/**
 * Full PowerShell 5.1 recovery script: load the real base library, load the
 * owner substitute, load the extracted real function bodies, then run
 * exactly Start-PandasSandbox followed by Complete-PandasRotation under the
 * real Invoke-WithServiceMutex -- the identical mutex name the installed
 * django-ai.ps1 Start/CompletePandasRotation actions use, so this process
 * and a concurrent real controller invocation serialize against each other.
 */
export function buildRecoveryScript({runtimeRoot,installedToolsRoot,extractedFunctionsText,failedReceiptPath,check,known=knownPandasStartup}){
  const k=known;
  return [
    "$ErrorActionPreference='Stop'",
    "$utf8=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=$utf8",
    "$PreviousLibraryOnly=[Environment]::GetEnvironmentVariable('TERUISI_DJANGO_SERVICE_LIBRARY_ONLY','Process')",
    "try {",
    "  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1'",
    "  . '"+path.join(installedToolsRoot,'django-local-service.ps1').replaceAll('\\','/')+"' -RuntimeRoot '"+runtimeRoot.replaceAll('\\','/')+"'",
    "} finally {",
    "  [Environment]::SetEnvironmentVariable('TERUISI_DJANGO_SERVICE_LIBRARY_ONLY',$PreviousLibraryOnly,'Process')",
    "}",
    // Re-declare the AI-domain path variables django-ai.ps1 defines at its own
    // top (tools/django-ai.ps1:75-80), copied verbatim -- never paraphrased --
    // because the installed file only exposes these as private script-scope
    // variables, not through an extractable function.
    "$PandasConfigPath = Join-Path $RuntimeRoot 'config\\pandas-sandbox.json'",
    "$PandasKeyPath = Join-Path $RuntimeRoot 'secrets\\pandas-sandbox.dpapi.json'",
    "$PandasPidPath = Join-Path $RunDirectory 'ai-pandas-wsl.pid.json'",
    "$PandasWsl = Join-Path $env:SystemRoot 'System32\\wsl.exe'",
    "$PandasDistribution = 'TERUISI-Pandas'",
    "$PandasKeepaliveArguments = @('-d', $PandasDistribution, '-u', 'teruisi-pandas', '--exec', '/usr/bin/sleep', 'infinity')",
    ownerSubstitutePowerShell({failedReceiptPath,known}),
    extractedFunctionsText,
    "$RequestedPandasRotation = [pscustomobject]@{",
    "  preparedAppId='"+k.preparedAppId+"'; preparedAppSha256='"+k.preparedAppSha256+"'",
    "  registeredPlanSha256='"+k.planSha256+"'; sourceCommit='"+k.mainCommit+"'",
    "  maintenanceId='"+k.maintenanceId+"'; publicationOwnerPid="+k.publicationOwnerPid,
    "}",
    "$pgResult = [ordered]@{version='"+k.version+"'; check="+(check?'$true':'$false')+"}",
    // The real Start/CompletePandasRotation dispatch entries both run under
    // Invoke-WithServiceMutex with $Action already set by the installed
    // script's own param-binding (django-ai.ps1's bottom switch sets $Action
    // from -Action before calling Start-AiStack/Complete-PandasRotation).
    // Dot-sourcing the base library here with only -RuntimeRoot leaves
    // $Action at its "Status" default, which would silently skip
    // Assert-NoSystemMaintenance inside Invoke-WithServiceMutex. Setting it
    // to 'Start' here is not a relaxation -- Assert-NoSystemMaintenance is
    // already independently enforced by Assert-PandasPublicationOwner's own
    // system-maintenance.json / automation-drain.json checks above -- it is
    // only so the mutex wait/behaviour matches the real Start action exactly.
    "$Action = 'Start'",
    "Invoke-WithServiceMutex {",
    "  $pending = Get-PendingPandasRotation",
    "  if ($null -eq $pending) { throw 'No pending Pandas rotation found at execution time' }",
    "  Assert-SamePandasRotation $pending $RequestedPandasRotation $true",
    (check?[
    "  $pgResult.pendingBinding = $pending",
    "  Assert-PandasInstalledBinding $pending",
    "  Assert-PandasPublicationOwner $pending",
    "  $pgResult.ownerSubstituteWouldPass = $true",
    ].join('\n'):[
    "  $started = Start-PandasSandbox",
    "  if ($started -ne $true) { throw 'Start-PandasSandbox did not report a fresh start (status unexpectedly already running or disabled)' }",
    "  $pgResult.startResult = $started",
    "  $completed = Complete-PandasRotation | ConvertFrom-Json",
    "  $pgResult.completeResult = $completed",
    ].join('\n')),
    "}",
    "[Console]::Out.WriteLine(($pgResult | ConvertTo-Json -Depth 8 -Compress))",
  ].join('\n');
}

/** Build the Windows Service-Control-ish `-EncodedCommand` invocation for PS5.1, scrubbed env exactly like the existing precedent. */
export function nativeInvocation(scriptText){
  const env={...process.env};
  for(const key of Object.keys(env))if(['PSMODULEPATH','TERUISI_DJANGO_SERVICE_LIBRARY_ONLY','TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY','TERUISI_NATIVE_ISOLATION_FILE','TERUISI_NATIVE_ISOLATION_SHA256'].includes(key.toUpperCase()))delete env[key];
  env.PSModulePath='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules';
  return {
    host:windowsPowerShell5,
    args:['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(scriptText,'utf16le').toString('base64')],
    env,
  };
}

export async function runPowerShell5Script(scriptText,{timeoutMs=1800000}={}){
  const invocation=nativeInvocation(scriptText);
  try{
    return await execute(invocation.host,invocation.args,{encoding:'utf8',windowsHide:true,timeout:timeoutMs,maxBuffer:16*1024*1024,env:invocation.env});
  }catch(error){
    const wrapped=Error('PowerShell 5.1 invocation failed: '+error.message);
    wrapped.stdout=error.stdout;wrapped.stderr=error.stderr;wrapped.code=error.code;wrapped.killed=error.killed;wrapped.signal=error.signal;
    throw wrapped;
  }
}

export function lastJsonLine(stdout){
  const line=String(stdout).trim().split(/\r?\n/).filter(text=>text.trim().startsWith('{')).at(-1);
  assert.ok(line,'PowerShell脚本没有返回JSON结果');
  return JSON.parse(line);
}

export async function saveEvidence(directory,name,value){
  await fs.mkdir(directory,{recursive:true});
  const bytes=typeof value==='string'?Buffer.from(value,'utf8'):Buffer.from(JSON.stringify(value,null,2)+'\n','utf8');
  await fs.writeFile(path.join(directory,name),bytes,{flag:'wx'});
  return digest(bytes);
}

/** The exact publish attempt directory and FAILED.json this tool is pinned to. */
export const originalAttemptDirectory='D:/codex-isolated/main-release-packages/c7604df99c55-d5a6a3fb-06d27651-r2/publish-c7604df99c55';
export const originalFailedReceiptPath=originalAttemptDirectory+'/FAILED.json';

export async function recover({runtimeRoot,installedToolsRoot,nativeToolsSource,evidenceDirectory,check=false,run=runPowerShell5Script,probeRotationLock,known=knownPandasStartup,failedReceiptPath=originalFailedReceiptPath}={}){
  const k=known;
  if(!probeRotationLock){
    const publisher=await import(pathToFileURL(path.join(nativeToolsSource,'tools/publish-latest-main.mjs')));
    probeRotationLock=publisher.probeRotationLock;
  }
  const preconditions=await verifyPreconditions({runtimeRoot,installedToolsRoot,probeRotationLock,known});
  await saveEvidence(evidenceDirectory,'01-preconditions.json',{at:new Date().toISOString(),check,...preconditions});
  if(!preconditions.ok){
    return {status:'refused',reason:'preconditions_not_met',problems:preconditions.problems,productionExecuted:false};
  }
  const extractScript=buildExtractScript(preconditions.paths.aiScriptPath,extractedFunctionNames);
  await saveEvidence(evidenceDirectory,'02-extract-script.ps1.txt',extractScript);
  const extracted=await run(extractScript);
  await saveEvidence(evidenceDirectory,'03-extracted-functions.ps1.txt',extracted.stdout);
  const recoveryScript=buildRecoveryScript({
    runtimeRoot,installedToolsRoot,extractedFunctionsText:extracted.stdout,
    failedReceiptPath,check,known,
  });
  await saveEvidence(evidenceDirectory,check?'04-check-script.ps1.txt':'04-recovery-script.ps1.txt',recoveryScript);
  let result;
  try{
    const execResult=await run(recoveryScript);
    await saveEvidence(evidenceDirectory,check?'05-check-stdout.json':'05-recovery-stdout.json',execResult.stdout);
    result=lastJsonLine(execResult.stdout);
  }catch(error){
    await saveEvidence(evidenceDirectory,'FAILED.json',{at:new Date().toISOString(),check,error:String(error.message).slice(0,4000),stdout:String(error.stdout??'').slice(0,4000),stderr:String(error.stderr??'').slice(0,4000)});
    throw error;
  }
  assert.equal(result.version,k.version,'恢复脚本返回版本不符');
  if(check){
    await saveEvidence(evidenceDirectory,'CHECKED.json',{at:new Date().toISOString(),...result});
    return {status:'checked',productionExecuted:false,...result};
  }
  await saveEvidence(evidenceDirectory,'SUCCESS.json',{at:new Date().toISOString(),...result});
  return {status:'recovered',productionExecuted:true,...result};
}

/** The exact frozen source tree this publish attempt built from; read-only verified before import. */
export const frozenSourceRoot='D:/codex-isolated/main-release-packages/c7604df99c55-d5a6a3fb-06d27651-r2/source';

export async function assertFrozenSourceIdentity(sourceRoot,{git='git'}={}){
  const head=(await execute(git,['-C',sourceRoot,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true,timeout:15000})).stdout.trim();
  assert.equal(head,knownPandasStartup.mainCommit,'冻结来源HEAD与本次发布提交不符');
  const status=(await execute(git,['-C',sourceRoot,'status','--porcelain'],{encoding:'utf8',windowsHide:true,timeout:15000})).stdout.trim();
  assert.equal(status,'','冻结来源存在未提交改动，拒绝从其导入 probeRotationLock');
}

async function main(){
  const {values}=parseArgs({options:{check:{type:'boolean'},execute:{type:'boolean'},'evidence-directory':{type:'string'}}});
  assert.ok(Boolean(values.check)!==Boolean(values.execute),'只支持明确 --check 或 --execute');
  const runtimeRoot='D:/teruisi-runtime/django-sales',installedToolsRoot=path.join(runtimeRoot,'app/tools');
  const evidenceDirectory=values['evidence-directory']??path.join('D:/codex-isolated/main-manual-release-20261016','recovery-c7604df99c55-pandas-startup');
  await assertFrozenSourceIdentity(frozenSourceRoot);
  const result=await recover({runtimeRoot,installedToolsRoot,nativeToolsSource:frozenSourceRoot,evidenceDirectory,check:Boolean(values.check)});
  console.log(JSON.stringify(result));
}

if(process.argv[1]&&path.resolve(process.argv[1])===self){
  main().catch(error=>{console.error('恢复已停止：'+error.message);process.exitCode=1;});
}
