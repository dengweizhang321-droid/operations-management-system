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
    'Read-JsonFile', 'Read-SystemMaintenance', 'Read-AutomationDrain', 'Invoke-WithServiceMutex')) {
  $definition = @($parsed.base.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  if ($definition.Count -ne 1) { throw "Expected one base function: $name" }
  Invoke-Expression $definition[0].Extent.Text
}
foreach ($name in @('Get-NewProductWeeklyReportDeferral', 'Invoke-NewProductWeeklyReport')) {
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
}
'@
$RuntimeRoot = Join-Path ([IO.Path]::GetTempPath()) ('teruisi-weekly-admission-' + [Guid]::NewGuid().ToString('N'))
$RunDirectory = Join-Path $RuntimeRoot 'run'
$MaintenancePath = Join-Path $RunDirectory 'system-maintenance.json'
$drainPath = Join-Path $RunDirectory 'automation-drain.json'
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
function Invoke-PrivateCase([string]$CaseName, [string]$RequestedAction, [scriptblock]$Prepare,
    [string]$ExpectedReason = '', [bool]$Invalid = $false, [bool]$RequestedJson = $true) {
  foreach ($path in @($MaintenancePath, $drainPath)) {
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
  }
  & $Prepare
  $Action = $RequestedAction
  $script:events = New-Object 'Collections.Generic.List[object]'
  $script:expensiveCalls = 0
  $failure = ''
  $output = @()
  try {
    $output = @(Invoke-WithServiceMutex {
      if (-not [WeeklyAdmissionMutexProbe]::IsHeld($mutexName)) { throw '__MUTEX_NOT_HELD__' }
      Invoke-NewProductWeeklyReport ($Action -ceq 'DryRunWeeklyReport') ($Action -ceq 'ForceWeeklyReport')
    })
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

$maintenance = [ordered]@{version='teruisi-system-maintenance-v1'; id=('a'*32); runtimeRoot=$RuntimeRoot; keepPostgres=$true}
$drain = [ordered]@{version='teruisi-automation-drain-v1'; id=('b'*32); runtimeRoot=$RuntimeRoot; phase='helpers'; keepPostgres=$false}
$workflowSource = [IO.File]::ReadAllText($sourceFiles.workflow)
foreach ($actionName in @('RunWeeklyReport', 'ForceWeeklyReport', 'DryRunWeeklyReport')) {
  if ($workflowSource -notmatch ('"' + $actionName + '"\s*\{ Invoke-WithServiceMutex \{ Invoke-NewProductWeeklyReport')) {
    throw "Action no longer uses original mutex: $actionName"
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
$summary = [pscustomobject][ordered]@{
  schema='teruisi-weekly-report-admission-private-v1'
  shellVersion=$PSVersionTable.PSVersion.ToString()
  privateRuntimeRoot=$RuntimeRoot
  workflowSha256=(Get-FileHash -LiteralPath $sourceFiles.workflow -Algorithm SHA256).Hash.ToLowerInvariant()
  baseControllerSha256=(Get-FileHash -LiteralPath $sourceFiles.base -Algorithm SHA256).Hash.ToLowerInvariant()
  checks=$script:results.ToArray()
  passed=$true
  businessInvoked=$false
}
$encoded = $summary | ConvertTo-Json -Depth 6
if ($EvidencePath) { [IO.File]::WriteAllText($EvidencePath, $encoded, [Text.UTF8Encoding]::new($false)) }
Write-Output $encoded
