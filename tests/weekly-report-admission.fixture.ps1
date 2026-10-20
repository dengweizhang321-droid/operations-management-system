[CmdletBinding()]
param(
  [string]$SourceRoot = "",
  [string]$EvidencePath = ""
)
$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -eq 5) {
  $env:PSModulePath = Join-Path $PSHOME 'Modules'
}
if (-not $SourceRoot) { $SourceRoot = Split-Path -Parent $PSScriptRoot }
$sourceFiles = @{
  base = Join-Path $SourceRoot 'tools\django-local-service.ps1'
  workflow = Join-Path $SourceRoot 'tools\django-workflow-service.ps1'
}
$parsed = @{}
foreach ($name in $sourceFiles.Keys) {
  $tokens = $null; $errors = $null
  $parsed[$name] = [Management.Automation.Language.Parser]::ParseFile($sourceFiles[$name], [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw "Source parse failed: $name" }
}
# Load function definitions only. Never execute either production controller's
# top-level initialization, dispatch, environment setup, or business commands.
foreach ($name in @('Get-CanonicalPath', 'Assert-RuntimeChildPath', 'Get-Sha256Text',
    'Read-JsonFile', 'Read-SystemMaintenance', 'Read-AutomationDrain',
    'Test-ExactObjectPropertyNames', 'Invoke-WithServiceMutex')) {
  $definition = @($parsed.base.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  if ($definition.Count -ne 1) { throw "Expected one base function: $name" }
  Invoke-Expression $definition[0].Extent.Text
}
foreach ($name in @('Get-NewProductWeeklyReportDeferral',
    'Get-NewProductWeeklyReportReleaseLeaseDeferral',
    'Invoke-NewProductWeeklyReportWithReleaseLease',
    'Invoke-NewProductWeeklyReport')) {
  $definition = @($parsed.workflow.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  if ($definition.Count -ne 1) { throw "Expected one workflow function: $name" }
  Invoke-Expression $definition[0].Extent.Text
}

Add-Type -TypeDefinition @'
using System;
using System.Threading;
public static class WeeklyAdmissionMutexProbe {
  public static bool IsHeld(string name) {
    bool held = false;
    var thread = new Thread(() => {
      using (var mutex = new Mutex(false, name)) {
        bool acquired = mutex.WaitOne(0);
        held = !acquired;
        if (acquired) mutex.ReleaseMutex();
      }
    });
    thread.Start();
    if (!thread.Join(5000)) throw new Exception("Private mutex probe timed out");
    return held;
  }
  public static Thread Hold(string name, int milliseconds, ManualResetEventSlim acquired) {
    var thread = new Thread(() => {
      using (var mutex = new Mutex(false, name)) {
        bool got = mutex.WaitOne(5000);
        try {
          acquired.Set();
          if (got) Thread.Sleep(milliseconds);
        } finally {
          if (got) mutex.ReleaseMutex();
        }
      }
    });
    thread.IsBackground = true;
    thread.Start();
    return thread;
  }
}
'@
$RuntimeRoot = Join-Path ([IO.Path]::GetTempPath()) ('teruisi-weekly-admission-' + [Guid]::NewGuid().ToString('N'))
$RunDirectory = Join-Path $RuntimeRoot 'run'
$MaintenancePath = Join-Path $RunDirectory 'system-maintenance.json'
$drainPath = Join-Path $RunDirectory 'automation-drain.json'
$leasePath = Join-Path $RunDirectory 'release-publication-lease.json'
New-Item -ItemType Directory -Path $RunDirectory | Out-Null
$mutexName = 'Local\TERUISI-DjangoSales-' + (Get-Sha256Text (Get-CanonicalPath $RuntimeRoot)).Substring(0, 24)
$script:results = New-Object 'Collections.Generic.List[object]'
function Write-LauncherEvent([string]$Level, [string]$Event, [string]$Message = '') {
  $script:events.Add([pscustomobject]@{ level=$Level; event=$Event; message=$Message })
}
function Assert-WorkflowRuntimeEntry {
  $script:expensiveCalls++
  if (-not [WeeklyAdmissionMutexProbe]::IsHeld($mutexName)) { throw 'Original mutex was not held' }
  throw '__EXPENSIVE_BOUNDARY__'
}
function Write-PrivateGate([string]$Path, [object]$Record) {
  [IO.File]::WriteAllText($Path, ($Record | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
}
function Write-PrivateLease([hashtable]$Overrides = @{}) {
  $now = [DateTimeOffset]::UtcNow
  $record = [ordered]@{
    version = 'teruisi-release-publication-lease-v1'
    ownerPid = $PID
    phase = 'preflight'
    createdAt = $now.AddMinutes(-1).ToString('o')
    updatedAt = $now.ToString('o')
    expiresAt = $now.AddMinutes(10).ToString('o')
    mainCommit = ('c' * 40)
    maintenanceId = ('d' * 32)
    out = (Join-Path $RuntimeRoot 'out')
  }
  foreach ($key in $Overrides.Keys) { $record[$key] = $Overrides[$key] }
  Write-PrivateGate $leasePath $record
}
function Clear-PrivateGates {
  foreach ($path in @($MaintenancePath, $drainPath, $leasePath)) {
    if (Test-Path -LiteralPath $path) {
      $item = Get-Item -LiteralPath $path -Force
      if ($item.PSIsContainer) { Remove-Item -LiteralPath $path -Recurse -Force }
      else { Remove-Item -LiteralPath $path -Force }
    }
  }
}
function Invoke-PrivateCase([string]$CaseName, [string]$RequestedAction, [scriptblock]$Prepare,
    [string]$ExpectedReason = '', [bool]$Invalid = $false, [bool]$RequestedJson = $true) {
  Clear-PrivateGates
  & $Prepare
  $Action = $RequestedAction
  $script:events = New-Object 'Collections.Generic.List[object]'
  $script:expensiveCalls = 0
  $failure = ''
  $output = @()
  try {
    $output = @(Invoke-NewProductWeeklyReportWithReleaseLease ($Action -ceq 'DryRunWeeklyReport') ($Action -ceq 'ForceWeeklyReport'))
  } catch { $failure = $_.Exception.Message }
  if ($Invalid) {
    if (-not $failure -or $failure -cin @('__EXPENSIVE_BOUNDARY__', '__MUTEX_NOT_HELD__') -or $script:expensiveCalls -ne 0 -or $script:events.Count -ne 0) {
      throw "Invalid gate was not rejected before runtime verification: $CaseName"
    }
  } elseif ($ExpectedReason) {
    if ($failure -or $script:expensiveCalls -ne 0) { throw "Deferral entered runtime verification: $CaseName ($failure)" }
    if ($script:events.Count -ne 1 -or $script:events[0].event -cne 'weekly_report_deferred') { throw "Wrong deferral log: $CaseName" }
    if ($RequestedJson) {
      if ($output.Count -ne 1) { throw "Expected single JSON stdout value: $CaseName" }
      $payload = $output[0] | ConvertFrom-Json
      if ($payload.status -cne 'deferred' -or $payload.sent -isnot [bool] -or $payload.sent -cne $false -or $payload.reason -cne $ExpectedReason -or $payload.action -cne $Action) {
        throw "Wrong deferral payload: $CaseName"
      }
    }
  } elseif ($failure -cne '__EXPENSIVE_BOUNDARY__' -or $script:expensiveCalls -ne 1) {
    throw "Open admission did not reach original runtime boundary: $CaseName ($failure)"
  }
  if ([WeeklyAdmissionMutexProbe]::IsHeld($mutexName)) { throw "Original mutex was not released: $CaseName" }
  $script:results.Add([pscustomobject]@{name=$CaseName; action=$Action; passed=$true})
}
function Invoke-HeldMutexLeaseCase {
  Clear-PrivateGates
  Write-PrivateLease
  $Action = 'RunWeeklyReport'
  $RequestedAction = 'RunWeeklyReport'
  $RequestedJson = $true
  $script:events = New-Object 'Collections.Generic.List[object]'
  $script:expensiveCalls = 0
  $acquired = [Threading.ManualResetEventSlim]::new($false)
  $thread = [WeeklyAdmissionMutexProbe]::Hold($mutexName, 4000, $acquired)
  if (-not $acquired.Wait(5000)) { throw 'Private mutex holder did not acquire the mutex' }
  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  $failure = ''
  $output = @()
  try {
    $output = @(Invoke-NewProductWeeklyReportWithReleaseLease $false $false)
  } catch { $failure = $_.Exception.Message }
  $stopwatch.Stop()
  $thread.Join(15000) | Out-Null
  if ($failure) { throw "Active lease failed while the mutex was held: $failure" }
  if ($stopwatch.ElapsedMilliseconds -ge 1500) { throw "Active lease waited for the mutex: $($stopwatch.ElapsedMilliseconds)ms" }
  if ($script:expensiveCalls -ne 0) { throw 'Active lease entered runtime verification' }
  if ($script:events.Count -ne 1 -or $script:events[0].event -cne 'weekly_report_deferred') { throw 'Wrong active lease deferral log' }
  if ($output.Count -ne 1) { throw 'Expected single JSON stdout value for active lease' }
  $payload = $output[0] | ConvertFrom-Json
  if ($payload.reason -cne 'release_in_progress' -or $payload.sent -cne $false) { throw 'Wrong active lease payload' }
  $script:results.Add([pscustomobject]@{name='lease-active-mutex-held'; action=$Action; passed=$true})
}

$maintenance = [ordered]@{version='teruisi-system-maintenance-v1'; id=('a'*32); runtimeRoot=$RuntimeRoot; keepPostgres=$true}
$drain = [ordered]@{version='teruisi-automation-drain-v1'; id=('b'*32); runtimeRoot=$RuntimeRoot; phase='helpers'; keepPostgres=$false}
$workflowSource = [IO.File]::ReadAllText($sourceFiles.workflow)
foreach ($actionName in @('RunWeeklyReport', 'ForceWeeklyReport', 'DryRunWeeklyReport')) {
  if ($workflowSource -notmatch ('"' + $actionName + '"\s*\{ Invoke-NewProductWeeklyReportWithReleaseLease')) {
    throw "Action no longer enters the release-lease wrapper: $actionName"
  }
  Invoke-PrivateCase 'open' $actionName {}
  Invoke-PrivateCase 'maintenance' $actionName { Write-PrivateGate $MaintenancePath $maintenance } 'system_maintenance'
  Invoke-PrivateCase 'drain-helpers' $actionName { Write-PrivateGate $drainPath $drain } 'automation_drain'
  Invoke-PrivateCase 'both-valid-original-readers' $actionName {
    Write-PrivateGate $MaintenancePath $maintenance; Write-PrivateGate $drainPath $drain
  } 'system_maintenance'
  Invoke-PrivateCase 'invalid-maintenance-json' $actionName { [IO.File]::WriteAllText($MaintenancePath, '{') } '' $true
  Invoke-PrivateCase 'valid-maintenance-invalid-drain' $actionName {
    Write-PrivateGate $MaintenancePath $maintenance; [IO.File]::WriteAllText($drainPath, '{')
  } '' $true
}
if (-not $workflowSource.Contains('Invoke-WithServiceMutex { Invoke-NewProductWeeklyReport')) {
  throw 'Release-lease wrapper no longer uses the original service mutex'
}
if ($workflowSource -match '"RunWeeklyReport"\s*\{\s*Invoke-WithServiceMutex') {
  throw 'Weekly action still skips the pre-mutex release lease'
}
Invoke-PrivateCase 'drain-requests' 'RunWeeklyReport' {
  $record = [ordered]@{version='teruisi-automation-drain-v1'; id=('b'*32); runtimeRoot=$RuntimeRoot; phase='requests'}
  Write-PrivateGate $drainPath $record
} 'automation_drain'
Invoke-PrivateCase 'text-output' 'RunWeeklyReport' { Write-PrivateGate $MaintenancePath $maintenance } 'system_maintenance' $false $false
foreach ($gateName in @('maintenance', 'drain')) {
  foreach ($invalidKind in @('wrong-runtime', 'wrong-id', 'oversized', 'directory')) {
    Invoke-PrivateCase ($gateName + '-' + $invalidKind) 'RunWeeklyReport' {
      $path = if ($gateName -ceq 'maintenance') { $MaintenancePath } else { $drainPath }
      if ($invalidKind -ceq 'directory') { New-Item -ItemType Directory -Path $path | Out-Null; return }
      if ($invalidKind -ceq 'oversized') { [IO.File]::WriteAllText($path, ('x'*4097)); return }
      $sourceRecord = if ($gateName -ceq 'maintenance') { $maintenance } else { $drain }
      $record = @{}
      foreach ($key in $sourceRecord.Keys) { $record[$key] = $sourceRecord[$key] }
      if ($invalidKind -ceq 'wrong-runtime') { $record.runtimeRoot = Join-Path $RuntimeRoot 'foreign' }
      else { $record.id = 'invalid' }
      Write-PrivateGate $path $record
    } '' $true
  }
}

# Release lease coverage. A valid bounded lease defers before the original mutex
# and runtime boundary; every invalid or stale form falls back to the original
# path. Maintenance/drain gates keep their original priority and reason.
Invoke-PrivateCase 'lease-active' 'RunWeeklyReport' { Write-PrivateLease } 'release_in_progress'
Invoke-PrivateCase 'lease-active-force' 'ForceWeeklyReport' { Write-PrivateLease } 'release_in_progress'
Invoke-PrivateCase 'lease-active-dry-run' 'DryRunWeeklyReport' { Write-PrivateLease } 'release_in_progress'
Invoke-PrivateCase 'lease-active-text-output' 'RunWeeklyReport' { Write-PrivateLease } 'release_in_progress' $false $false
Invoke-PrivateCase 'lease-expired' 'RunWeeklyReport' {
  $now = [DateTimeOffset]::UtcNow
  Write-PrivateLease @{createdAt=$now.AddMinutes(-3).ToString('o'); updatedAt=$now.AddMinutes(-2).ToString('o'); expiresAt=$now.AddMinutes(-1).ToString('o')}
}
Invoke-PrivateCase 'lease-dead-owner' 'RunWeeklyReport' { Write-PrivateLease @{ownerPid=2147483647} }
Invoke-PrivateCase 'lease-bad-json' 'RunWeeklyReport' { [IO.File]::WriteAllText($leasePath, '{') }
Invoke-PrivateCase 'lease-directory' 'RunWeeklyReport' { New-Item -ItemType Directory -Path $leasePath | Out-Null }
Invoke-PrivateCase 'lease-oversized' 'RunWeeklyReport' { [IO.File]::WriteAllText($leasePath, ('x'*4097)) }
Invoke-PrivateCase 'lease-wrong-version' 'RunWeeklyReport' { Write-PrivateLease @{version='teruisi-release-publication-lease-v0'} }
Invoke-PrivateCase 'lease-empty-phase' 'RunWeeklyReport' { Write-PrivateLease @{phase=''} }
Invoke-PrivateCase 'lease-invalid-commit' 'RunWeeklyReport' { Write-PrivateLease @{mainCommit='short'} }
Invoke-PrivateCase 'lease-invalid-maintenance' 'RunWeeklyReport' { Write-PrivateLease @{maintenanceId='short'} }
Invoke-PrivateCase 'lease-overlong-lifetime' 'RunWeeklyReport' {
  $now = [DateTimeOffset]::UtcNow
  Write-PrivateLease @{updatedAt=$now.ToString('o'); expiresAt=$now.AddHours(2).ToString('o')}
}
Invoke-PrivateCase 'lease-future-updated' 'RunWeeklyReport' {
  $future = [DateTimeOffset]::UtcNow.AddMinutes(5)
  Write-PrivateLease @{updatedAt=$future.ToString('o'); expiresAt=$future.AddMinutes(10).ToString('o')}
}
Invoke-PrivateCase 'lease-active-maintenance' 'RunWeeklyReport' {
  Write-PrivateLease; Write-PrivateGate $MaintenancePath $maintenance
} 'system_maintenance'
Invoke-PrivateCase 'lease-active-drain' 'RunWeeklyReport' {
  Write-PrivateLease; Write-PrivateGate $drainPath $drain
} 'automation_drain'
Invoke-PrivateCase 'lease-active-both-valid' 'RunWeeklyReport' {
  Write-PrivateLease; Write-PrivateGate $MaintenancePath $maintenance; Write-PrivateGate $drainPath $drain
} 'system_maintenance'
Invoke-PrivateCase 'lease-active-invalid-maintenance' 'RunWeeklyReport' {
  Write-PrivateLease; [IO.File]::WriteAllText($MaintenancePath, '{')
} '' $true
Invoke-HeldMutexLeaseCase

$summary = [pscustomobject][ordered]@{
  schema='teruisi-weekly-report-admission-private-v2'
  shellVersion=$PSVersionTable.PSVersion.ToString()
  privateRuntimeRoot=$RuntimeRoot
  workflowSha256=(Get-FileHash -LiteralPath $sourceFiles.workflow -Algorithm SHA256).Hash.ToLowerInvariant()
  baseControllerSha256=(Get-FileHash -LiteralPath $sourceFiles.base -Algorithm SHA256).Hash.ToLowerInvariant()
  leaseFile=$leasePath
  checks=$script:results.ToArray()
  passed=$true
  businessInvoked=$false
}
$encoded = $summary | ConvertTo-Json -Depth 6
if ($EvidencePath) { [IO.File]::WriteAllText($EvidencePath, $encoded, [Text.UTF8Encoding]::new($false)) }
Write-Output $encoded
