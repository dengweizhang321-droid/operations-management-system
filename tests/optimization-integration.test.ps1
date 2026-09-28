param([Parameter(Mandatory=$true)][string]$Scratch)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Scratch -PathType Container) -or @(Get-ChildItem -LiteralPath $Scratch -Force).Count) { throw 'Require empty isolated scratch' }
$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = '1'
. (Join-Path $PSScriptRoot '..\tools\django-local-service.ps1') -RuntimeRoot $Scratch
$env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY = '1'
. (Join-Path $PSScriptRoot '..\tools\django-postgres-maintenance.ps1') -Action Backup -RuntimeRoot $Scratch -Execute
New-Item -ItemType Directory -Path (Join-Path $Scratch 'run') -Force | Out-Null
$drainPath = Join-Path $Scratch 'run\automation-drain.json'
$script:applicationsStopped = $true
$script:workerStopped = $true
$script:applicationChecks = 0
$script:workerChecks = 0
function Assert-ApplicationDeploymentStopped {
  $script:applicationChecks++
  if (-not $script:applicationsStopped) { throw 'fixture applications still active' }
}
function Assert-SalesRetirementWorkerStopped {
  $script:workerChecks++
  if (-not $script:workerStopped) { throw 'fixture worker still active' }
}
function Assert-MaintenanceRuntimeContext { throw 'fixture source preflight reached' }
$MaintenanceRequest.ConfirmedIsolatedRestore = $true
$MaintenanceRequest.RehearsalId = 'c' * 12
$MaintenanceRequest.ApprovedManifestSha256 = 'd' * 64
$MaintenanceRequest.BackupDirectory = Join-Path $Scratch 'fixture-backup'
function Check-Operators([string]$Expected) {
  foreach ($verb in @('Backup','RestoreRehearsal')) {
    $MaintenanceRequest.Action = $verb
    $caught = $null
    try {
      Invoke-MaintenanceMutex {
        if ($MaintenanceRequest.Action -ceq 'Backup') { Invoke-MaintenanceBackup }
        else { Invoke-MaintenanceRestoreRehearsal }
      }
    } catch { $caught = $_.Exception.Message }
    if (-not $caught -or $caught -notlike $Expected) { throw "Unexpected $verb admission: $caught" }
  }
}
# No production connection is possible: source preflight always throws.
Check-Operators 'fixture source preflight reached'
$maintenance = @{version='teruisi-system-maintenance-v1';id=('a'*32);runtimeRoot=$Scratch;keepPostgres=$true}
$drain = @{version='teruisi-automation-drain-v1';id=('a'*32);runtimeRoot=$Scratch;keepPostgres=$true;phase='requests'}
Write-AtomicJson $MaintenancePath $maintenance
Check-Operators 'System maintenance is active:*'
Write-AtomicJson $drainPath $drain
Check-Operators 'Automation drain is waiting*'
$maintenance.drainedStopped = $true
Write-AtomicJson $MaintenancePath $maintenance
Check-Operators 'fixture source preflight reached'
if ($script:applicationChecks -ne 2 -or $script:workerChecks -ne 2) { throw 'Missing stopped-process checks' }
$script:applicationsStopped = $false
Check-Operators 'fixture applications still active'
$script:applicationsStopped = $true
$script:workerStopped = $false
Check-Operators 'fixture worker still active'
$script:workerStopped = $true
foreach ($variant in @('owner','phase','scope','nonBooleanProof')) {
  $drain.id='a'*32; $drain.phase='requests'; $drain.keepPostgres=$true; $maintenance.drainedStopped=$true
  if ($variant -ceq 'owner') { $drain.id='b'*32 }
  if ($variant -ceq 'phase') { $drain.phase='helpers' }
  if ($variant -ceq 'scope') { $drain.keepPostgres=$false }
  if ($variant -ceq 'nonBooleanProof') { $maintenance.drainedStopped='true' }
  Write-AtomicJson $MaintenancePath $maintenance
  Write-AtomicJson $drainPath $drain
  $caught=$null
  try { Assert-MaintenanceOperationAdmission } catch { $caught=$_.Exception.Message }
  if ($caught -notlike 'System maintenance is active:*') { throw "Accepted invalid proof: $variant" }
}
# The two candidates acquire the same PG mutex on the same thread. The nested
# fence must retain the console check and execute exactly once without deadlock.
$script:callbacks=0
Invoke-AutomationPgDrainFence { Invoke-BackupConsoleMaintenanceFence { $script:callbacks++ } }
if ($script:callbacks -ne 1) { throw 'Nested fence did not execute exactly once' }
Write-AtomicJson (Join-Path $Scratch 'backups\console\job-fixture.json') @{status='unknown'}
$caught=$null
try { Invoke-AutomationPgDrainFence { Invoke-BackupConsoleMaintenanceFence { $script:callbacks++ } } }
catch { $caught=$_.Exception.Message }
if ($caught -notlike '*manual reconciliation required*' -or $script:callbacks -ne 1) { throw 'Unresolved console job bypassed nested gate' }
Write-Output 'PASS: combined backup/drain admission, stopped proof, identity/scope rejection and nested mutex'
