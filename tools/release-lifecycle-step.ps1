[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('StopWorker','StartWorker','EnterMaintenance','ExitMaintenance','DeployApp','HardenAcl','VerifyStartup','AggregateStatus','BeginWorkerDrain','EndWorkerDrain')]
  [string]$Step,
  [string]$MaintenanceId,
  [string]$PreparedAppId,
  [string]$PreparedAppSha256,
  [switch]$KeepPostgres
)
$ErrorActionPreference='Stop'
$nativeShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$worker='D:\运营管理系统\tools\worker-local-service.ps1'
$candidateDjango='D:\运营管理系统-sales-django-release\tools\django-local-service.ps1'
$installedDjango='D:\teruisi-runtime\django-sales\app\tools\django-local-service.ps1'
$deployment='D:\teruisi-runtime\django-sales\app\deployment.json'
function Invoke-OriginalEngine([string]$Script,[string[]]$Arguments) {
  $raw=@(& $nativeShell -NoProfile -NonInteractive -File $Script @Arguments)
  if($LASTEXITCODE -ne 0) { throw 'Original lifecycle operator failed; result requires exact reconciliation' }
  return $raw
}
switch($Step) {
  'StopWorker' { Invoke-OriginalEngine $worker @('-Action','StopForRelease','-MaintenanceId',$MaintenanceId,'-Json') | Out-Null }
  'StartWorker' { Invoke-OriginalEngine $worker @('-Action','Start','-Json') | Out-Null }
  'BeginWorkerDrain' { Invoke-OriginalEngine $worker @('-Action','BeginWorkerDrain','-MaintenanceId',$MaintenanceId,'-Json') | Out-Null }
  'EndWorkerDrain' { Invoke-OriginalEngine $worker @('-Action','EndWorkerDrain','-MaintenanceId',$MaintenanceId,'-Json') | Out-Null }
  'EnterMaintenance' {
    if($MaintenanceId -cnotmatch '^[a-f0-9]{32}$') { throw 'Exact approved maintenance ID required' }
    $arguments=@('-Action','EnterMaintenance','-MaintenanceId',$MaintenanceId,'-Json')
    if($KeepPostgres) { $arguments+='-KeepPostgres' }
    Invoke-OriginalEngine $worker $arguments | Out-Null
  }
  'ExitMaintenance' {
    if($MaintenanceId -cnotmatch '^[a-f0-9]{32}$') { throw 'Exact approved maintenance ID required' }
    Invoke-OriginalEngine $worker @('-Action','ExitMaintenance','-MaintenanceId',$MaintenanceId,'-Json') | Out-Null
  }
  'DeployApp' {
    if($PreparedAppId -cnotmatch '^[a-f0-9]{32}$' -or $PreparedAppSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Exact approved prepared app required' }
    Invoke-OriginalEngine $candidateDjango @('-Action','DeployApp','-PreparedAppId',$PreparedAppId,'-PreparedAppSha256',$PreparedAppSha256) | Out-Null
  }
  'HardenAcl' { Invoke-OriginalEngine $installedDjango @('-Action','HardenAcl') | Out-Null }
  'VerifyStartup' { Invoke-OriginalEngine $worker @('-Action','VerifyStartup','-Json') | Out-Null }
  'AggregateStatus' {
    $raw=Invoke-OriginalEngine $installedDjango @('-Action','AggregateStatus','-Json')
    $result=($raw -join "`n") | ConvertFrom-Json
  }
}
$receipt=[ordered]@{status='completed';step=$Step;djangoManifestSha256=(Get-FileHash -LiteralPath $deployment -Algorithm SHA256).Hash.ToLowerInvariant()}
if($Step -eq 'AggregateStatus') { $receipt.aggregate=$result }
if($Step -in @('BeginWorkerDrain','EnterMaintenance')) { $receipt.drainConfirmed=$true }
if($MaintenanceId) { $receipt.maintenanceId=$MaintenanceId }
$receipt | ConvertTo-Json -Depth 12 -Compress
