import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const modulePath = fileURLToPath(new URL('../tools/manual-maintenance-lock.psm1', import.meta.url));
const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const ps = (value) => `'${String(value).replaceAll("'", "''")}'`;

// Every process, event, mutex and file in these tests is a private fixture.
const helpers = String.raw`
function Assert-True($Value, [string] $Message) {
    if (-not $Value) { throw $Message }
}
function Start-PrivatePowerShell([string] $Code) {
    $Code = '$ProgressPreference = ''SilentlyContinue''; ' + $Code
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $script:TestPowerShell
    $info.Arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Code))
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    return [Diagnostics.Process]::Start($info)
}
function Complete-PrivateProcess($Process) {
    if (-not $Process.WaitForExit(10000)) { $Process.Kill(); throw 'Private fixture process timed out' }
    $code = $Process.ExitCode
    $errorText = $Process.StandardError.ReadToEnd()
    $Process.Dispose()
    if ($errorText) { throw $errorText }
    return $code
}
function Probe-PrivateMutex([string] $Name, [int] $Wait = 80) {
    $code = '$m = New-Object Threading.Mutex($false, ''' + $Name + '''); try { try { $held = $m.WaitOne(' + $Wait + ') } catch [Threading.AbandonedMutexException] { $m.ReleaseMutex(); exit 8 }; if ($held) { $m.ReleaseMutex(); exit 0 }; exit 9 } finally { $m.Dispose() }'
    return Complete-PrivateProcess (Start-PrivatePowerShell $code)
}
function Start-PrivateHolder([string] $Name, [bool] $Abandon = $false, [string] $ChangeFile = '') {
    $readyName = $Name + '-ready'
    $releaseName = $Name + '-release'
    $ready = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::ManualReset, $readyName)
    $release = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::ManualReset, $releaseName)
    # Keep the kernel object alive so abandonment can be observed after exit.
    $mutex = New-Object Threading.Mutex($false, $Name)
    $code = '$ErrorActionPreference = ''Stop''; $m = New-Object Threading.Mutex($false, ''' + $Name + '''); $r = [Threading.EventWaitHandle]::OpenExisting(''' + $readyName + '''); $go = [Threading.EventWaitHandle]::OpenExisting(''' + $releaseName + '''); $null = $m.WaitOne(); $null = $r.Set(); if (-not $go.WaitOne(10000)) { exit 7 }; '
    if ($ChangeFile) { $code += 'Start-Sleep -Milliseconds 150; [IO.File]::WriteAllText(''' + $ChangeFile.Replace("'", "''") + ''', ''changed''); ' }
    if ($Abandon) { $code += '[Environment]::Exit(0)' }
    else { $code += '$m.ReleaseMutex(); $m.Dispose()' }
    $process = Start-PrivatePowerShell $code
    if (-not $ready.WaitOne(10000)) { $process.Kill(); throw 'Private holder was not ready' }
    return [PSCustomObject]@{ Mutex = $mutex; Ready = $ready; Release = $release; Process = $process }
}
function Stop-PrivateHolder($Holder) {
    if ($null -eq $Holder) { return }
    $null = $Holder.Release.Set()
    if ($null -ne $Holder.Process) { Assert-True ((Complete-PrivateProcess $Holder.Process) -eq 0) 'Private holder failed' }
    $Holder.Mutex.Dispose()
    $Holder.Ready.Dispose()
    $Holder.Release.Dispose()
}
function Assert-GateRejected([scriptblock] $Body, [string] $Pattern) {
    $caught = $false
    try { & $Body } catch {
        $caught = $true
        Assert-True ($_.Exception.Message -match $Pattern) ('Unexpected rejection: ' + $_.Exception.Message)
    }
    Assert-True $caught 'Gate unexpectedly accepted'
    Assert-True ($script:OperationCalls -eq 0) 'Operation ran despite rejection'
}
`;

function runFixture(t, body, files = {}) {
    const directory = mkdtempSync(path.join(tmpdir(), 'manual-maintenance-lock-'));
    t.after(() => {
        assert.equal(path.dirname(directory), path.resolve(tmpdir()));
        assert.match(path.basename(directory), /^manual-maintenance-lock-/);
        rmSync(directory, { recursive: true, force: true });
    });
    for (const [name, contents] of Object.entries(files)) writeFileSync(path.join(directory, name), `\uFEFF${contents}`, 'utf8');
    const prefix = `Local\\ManualMaintenanceTest-${randomUUID()}`;
    const script = `\uFEFF$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module ${ps(modulePath)} -Force
${helpers}
$script:TestPowerShell = ${ps(powershell)}
$script:FixtureDirectory = ${ps(directory)}
$worker = ${ps(`${prefix}-worker`)}
$django = ${ps(`${prefix}-django`)}
$script:OperationCalls = 0
Assert-True ($PSVersionTable.PSVersion.Major -eq 5) 'Must run real Windows PowerShell 5'
${body}
Write-Output 'fixture-ok'
`;
    const scriptPath = path.join(directory, 'fixture.ps1');
    writeFileSync(scriptPath, script, 'utf8');
    const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { encoding: 'utf8', timeout: 35000, windowsHide: true });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /fixture-ok/);
}

const windows = { skip: process.platform !== 'win32' };

test('PS5 gate checks under both locks, then keeps only Worker during Operation', windows, (t) => runFixture(t, String.raw`
$result = Invoke-ManualMaintenanceGate -WorkerMutexName $worker -DjangoMutexName $django -Check {
    Assert-True ((Probe-PrivateMutex $worker) -eq 9) 'Check lacks Worker lock'
    Assert-True ((Probe-PrivateMutex $django) -eq 9) 'Check lacks Django lock'
    $true
} -Operation {
    Assert-True ((Probe-PrivateMutex $worker) -eq 9) 'Operation lost Worker lock'
    Assert-True ((Probe-PrivateMutex $django) -eq 0) 'Django child could not acquire lock'
    'original-output'
}
Assert-True ($result -ceq 'original-output') 'Operation output changed'
Assert-True ((Probe-PrivateMutex $worker) -eq 0) 'Worker leaked'
Assert-True ((Probe-PrivateMutex $django) -eq 0) 'Django leaked'
`));

for (const exitCode of [0, 1]) {
    test(`PS5 original script exit ${exitCode} propagates and recursive Worker acquisitions release exactly once`, windows, (t) => runFixture(t, String.raw`
$outer = New-Object Threading.Mutex($false, $worker)
$null = $outer.WaitOne(0)
try {
    $original = Join-Path $script:FixtureDirectory 'original.ps1'
    Invoke-ManualMaintenanceGate -WorkerMutexName $worker -DjangoMutexName $django -Check { $true } -Operation { & $original -MutexName $worker }
    Assert-True ($LASTEXITCODE -eq EXIT_CODE) 'Original exit code was lost'
    Assert-True ((Probe-PrivateMutex $worker) -eq 9) 'Adapter released caller acquisition'
    $outer.ReleaseMutex()
    Assert-True ((Probe-PrivateMutex $worker) -eq 0) 'Adapter leaked recursive acquisition'
    $extraReleaseRejected = $false
    try { $outer.ReleaseMutex() } catch [ApplicationException] { $extraReleaseRejected = $true }
    Assert-True $extraReleaseRejected 'Unexpected remaining ownership'
} finally { $outer.Dispose() }
Assert-True ((Probe-PrivateMutex $django) -eq 0) 'Django leaked after script exit'
`.replace('EXIT_CODE', String(exitCode)), {
        'original.ps1': `param([string] $MutexName)\n$m = New-Object Threading.Mutex($false, $MutexName)\n$held = $false\ntry { $held = $m.WaitOne(0); if (-not $held) { throw 'Worker reentry failed' }; exit ${exitCode} } finally { if ($held) { $m.ReleaseMutex() }; $m.Dispose() }\n`,
    }));

    test(`PS5 callback exit ${exitCode} runs finally before the wrapper process exits`, windows, (t) => runFixture(t, String.raw`
# Keep these objects alive across child exit; a leaked acquisition would then
# produce AbandonedMutexException rather than silently creating a fresh mutex.
$workerObject = New-Object Threading.Mutex($false, $worker)
$djangoObject = New-Object Threading.Mutex($false, $django)
try {
    $driver = Join-Path $script:FixtureDirectory 'exit-wrapper.ps1'
    $original = Join-Path $script:FixtureDirectory 'original.ps1'
    $code = '& ''' + $driver.Replace("'", "''") + ''' -ModulePath ''' + MODULE_PATH + ''' -OriginalPath ''' + $original.Replace("'", "''") + ''' -Worker ''' + $worker + ''' -Django ''' + $django + ''''
    Assert-True ((Complete-PrivateProcess (Start-PrivatePowerShell $code)) -eq EXIT_CODE) 'Wrapper exit code changed'
    Assert-True ((Probe-PrivateMutex $worker) -eq 0) 'Wrapper left Worker held or abandoned'
    Assert-True ((Probe-PrivateMutex $django) -eq 0) 'Wrapper left Django held or abandoned'
} finally { $workerObject.Dispose(); $djangoObject.Dispose() }
`.replace('MODULE_PATH', ps(modulePath)).replace('EXIT_CODE', String(exitCode)), {
        'original.ps1': `param([string] $MutexName)\n$m = New-Object Threading.Mutex($false, $MutexName)\n$held = $false\ntry { $held = $m.WaitOne(0); if (-not $held) { throw 'Worker reentry failed' }; exit ${exitCode} } finally { if ($held) { $m.ReleaseMutex() }; $m.Dispose() }\n`,
        'exit-wrapper.ps1': `param([string] $ModulePath, [string] $OriginalPath, [string] $Worker, [string] $Django)\n$ErrorActionPreference = 'Stop'\nImport-Module $ModulePath -Force\nInvoke-ManualMaintenanceGate -WorkerMutexName $Worker -DjangoMutexName $Django -Check { $true } -Operation { & $OriginalPath -MutexName $Worker; exit $LASTEXITCODE }\nthrow 'Exit did not leave wrapper'\n`,
    }));
}

for (const lock of ['Worker', 'Django']) {
    test(`PS5 ${lock} timeout refuses Operation and releases earlier acquisitions`, windows, (t) => runFixture(t, String.raw`
$name = LOCK_NAME
$holder = Start-PrivateHolder $name
try {
    Assert-GateRejected {
        Invoke-ManualMaintenanceGate -WorkerMutexName $worker -DjangoMutexName $django -WaitMilliseconds 80 -Check { throw 'Check must not run' } -Operation { $script:OperationCalls++ }
    } 'Timed out waiting for LOCK_LABEL mutex'
    if ($name -eq $django) { Assert-True ((Probe-PrivateMutex $worker) -eq 0) 'Earlier Worker acquisition leaked' }
} finally { Stop-PrivateHolder $holder }
Assert-True ((Probe-PrivateMutex $worker) -eq 0) 'Worker remained held'
Assert-True ((Probe-PrivateMutex $django) -eq 0) 'Django remained held'
`.replace('LOCK_NAME', lock === 'Worker' ? '$worker' : '$django').replace('LOCK_LABEL', lock)));

    test(`PS5 abandoned ${lock} refuses Operation and releases abandoned ownership`, windows, (t) => runFixture(t, String.raw`
$holder = Start-PrivateHolder LOCK_NAME $true
try {
    $null = $holder.Release.Set()
    Assert-True ((Complete-PrivateProcess $holder.Process) -eq 0) 'Abandon fixture failed'
    $holder.Process = $null
    Assert-GateRejected {
        Invoke-ManualMaintenanceGate -WorkerMutexName $worker -DjangoMutexName $django -Check { throw 'Check must not run' } -Operation { $script:OperationCalls++ }
    } 'LOCK_LABEL mutex was abandoned'
    Assert-True ((Probe-PrivateMutex $worker) -eq 0) 'Worker ownership leaked or abandoned'
    Assert-True ((Probe-PrivateMutex $django) -eq 0) 'Django ownership leaked or abandoned'
} finally { Stop-PrivateHolder $holder }
`.replace('LOCK_NAME', lock === 'Worker' ? '$worker' : '$django').replace('LOCK_LABEL', lock)));
}

test('PS5 Check exception and non-Boolean/false results refuse Operation and release locks', windows, (t) => runFixture(t, String.raw`
foreach ($check in @({ throw 'dynamic-facts-rejected' }, { $false }, { 'true' }, { }, { $true; $true })) {
    Assert-GateRejected {
        Invoke-ManualMaintenanceGate -WorkerMutexName $worker -DjangoMutexName $django -Check $check -Operation { $script:OperationCalls++ }
    } 'dynamic-facts-rejected|exactly one Boolean true'
    Assert-True ((Probe-PrivateMutex $worker) -eq 0) 'Worker leaked after Check refusal'
    Assert-True ((Probe-PrivateMutex $django) -eq 0) 'Django leaked after Check refusal'
}
`));

test('PS5 checks changed facts after waiting rather than accepting a pre-wait snapshot', windows, (t) => runFixture(t, String.raw`
$factPath = Join-Path $script:FixtureDirectory 'fact.txt'
[IO.File]::WriteAllText($factPath, 'initial')
$holder = Start-PrivateHolder $worker $false $factPath
try {
    Assert-True (([IO.File]::ReadAllText($factPath)) -ceq 'initial') 'Initial fact invalid'
    $null = $holder.Release.Set()
    $timer = [Diagnostics.Stopwatch]::StartNew()
    Assert-GateRejected {
        Invoke-ManualMaintenanceGate -WorkerMutexName $worker -DjangoMutexName $django -WaitMilliseconds 5000 -Check {
            ([IO.File]::ReadAllText($factPath)) -ceq 'initial'
        } -Operation { $script:OperationCalls++ }
    } 'exactly one Boolean true'
    Assert-True ($timer.ElapsedMilliseconds -ge 50) 'Fixture did not wait on Worker'
} finally { Stop-PrivateHolder $holder }
Assert-True ((Probe-PrivateMutex $worker) -eq 0) 'Worker leaked after changed facts'
`));

test('PS5 Operation exception releases Worker and preserves the original error', windows, (t) => runFixture(t, String.raw`
$caught = $false
try {
    Invoke-ManualMaintenanceGate -WorkerMutexName $worker -DjangoMutexName $django -Check { $true } -Operation { throw 'original-operation-error' }
} catch { $caught = $_.Exception.Message -ceq 'original-operation-error' }
Assert-True $caught 'Operation error changed'
Assert-True ((Probe-PrivateMutex $worker) -eq 0) 'Worker leaked after Operation error'
Assert-True ((Probe-PrivateMutex $django) -eq 0) 'Django leaked after Operation error'
`));

test('negative control: holding Django for the full Operation blocks its child process', windows, (t) => runFixture(t, String.raw`
$held = New-Object Threading.Mutex($false, $django)
$null = $held.WaitOne(0)
try { Assert-True ((Probe-PrivateMutex $django 100) -eq 9) 'Negative control failed to reproduce Django child contention' }
finally { $held.ReleaseMutex(); $held.Dispose() }
Assert-True ((Probe-PrivateMutex $django) -eq 0) 'Negative fixture leaked Django'
`));
