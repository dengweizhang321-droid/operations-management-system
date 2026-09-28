param([Parameter(Mandatory=$true)][string]$Scratch)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Scratch -PathType Container) -or @(Get-ChildItem -LiteralPath $Scratch -Force).Count) { throw 'Require empty isolated scratch' }
$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = '1'
. (Join-Path $PSScriptRoot '..\tools\django-local-service.ps1') -RuntimeRoot $Scratch
New-Item -ItemType Directory -Path $RunDirectory -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $Scratch 'app\backend\teruisi_backend') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $Scratch 'app\backend\teruisi_backend\automation_drain.py'), '# fixture')
$MaintenanceId = 'a' * 32
$script:healthMode = 'idle'
function Invoke-RestMethod {
  if ($script:healthMode -eq 'unavailable') { throw 'fixture unavailable' }
  $gate = Read-AutomationDrain
  return @{ok=$true;drainProtocol='teruisi-automation-drain-v1';drain=$gate;busy=($script:healthMode -ne 'idle');storeExecutions=@(
    if ($script:healthMode -ne 'idle') { @{status=$script:healthMode} }
  )}
}
function Write-LauncherEvent {}
function Must-Fail([scriptblock]$Code) {
  $failed=$false
  try { & $Code } catch { $failed=$true }
  if (-not $failed) { throw 'Expected rejection' }
}
$script:healthMode='running'
Must-Fail { Wait-AutomationDrain 0 }
if ((Read-AutomationDrain).phase -cne 'helpers' -or (Read-SystemMaintenance)) { throw 'Failure must retain drain without stopping services' }
$script:healthMode='quarantined'
Must-Fail { Wait-AutomationDrain 0 }
$script:healthMode='unavailable'
Must-Fail { Wait-AutomationDrain 0 }
$MaintenanceId='b'*32
Must-Fail { Cancel-AutomationDrain }
Must-Fail { Set-AutomationDrainPhase 'helpers' }
$MaintenanceId='a'*32
$script:healthMode='idle'
Wait-AutomationDrain 0
if ((Read-AutomationDrain).phase -cne 'requests') { throw 'Missing final admission closure' }
Set-AutomationDrainPhase 'helpers'
if ((Read-AutomationDrain).phase -cne 'requests') { throw 'Retry regressed drain phase' }
$stream=[IO.FileStream]::new((Join-Path $RunDirectory 'automation-activity.lock'),[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite)
try {
  $stream.Lock(0,1)
  Must-Fail { Wait-AutomationActivityLock 'automation-activity.lock' ([DateTimeOffset]::UtcNow) }
} finally { $stream.Unlock(0,1); $stream.Dispose() }
Cancel-AutomationDrain
if (Read-AutomationDrain) { throw 'Exact cancel did not reopen admission' }
$mutexName='Local\TERUISI-DjangoPostgresMaintenance-' + (Get-Sha256Text (Get-CanonicalPath $RuntimeRoot)).Substring(0,20)
$childScript=Join-Path $Scratch 'mutex-holder.ps1'
$readyPath=Join-Path $Scratch 'mutex-ready'
$releasePath=Join-Path $Scratch 'mutex-release'
@'
param([string]$MutexName,[string]$ReadyPath,[string]$ReleasePath)
$mutex=[Threading.Mutex]::new($false,$MutexName)
try {
  if (-not $mutex.WaitOne(0)) { exit 13 }
  [IO.File]::WriteAllText($ReadyPath,'ready')
  $deadline=[DateTimeOffset]::UtcNow.AddSeconds(20)
  while (-not (Test-Path -LiteralPath $ReleasePath) -and [DateTimeOffset]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 50 }
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
'@ | Set-Content -LiteralPath $childScript -Encoding UTF8
$child=Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList @('-NoProfile','-File',('"'+$childScript+'"'),'-MutexName',('"'+$mutexName+'"'),'-ReadyPath',('"'+$readyPath+'"'),'-ReleasePath',('"'+$releasePath+'"')) -PassThru -WindowStyle Hidden
try {
  $deadline=[DateTimeOffset]::UtcNow.AddSeconds(10)
  while (-not (Test-Path -LiteralPath $readyPath)) {
    if ($child.HasExited -or [DateTimeOffset]::UtcNow -ge $deadline) { throw 'Isolated mutex holder did not start' }
    Start-Sleep -Milliseconds 50
  }
  $script:entered=$false
  Must-Fail { Invoke-AutomationPgDrainFence { $script:entered=$true } }
  if ($script:entered) { throw 'Maintenance overlapped an admitted restore operator' }
} finally {
  [IO.File]::WriteAllText($releasePath,'release')
  if (-not $child.WaitForExit(10000)) { throw 'Isolated mutex holder did not finish' }
  $child.Dispose()
}
Invoke-AutomationPgDrainFence { $script:entered=$true }
if (-not $script:entered) { throw 'Completed restore still blocked maintenance' }
Write-Output 'PASS: timeout/quarantine/offline refuse stop; exact owner; monotonic drain; activity lock; cancel; cross-process backup/restore mutex'
