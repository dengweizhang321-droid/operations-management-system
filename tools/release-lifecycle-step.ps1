[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('StopWorker','StartWorker','EnterMaintenance','ExitMaintenance','DeployApp','HardenAcl','VerifyStartup','AggregateStatus','BeginWorkerDrain','EndWorkerDrain')]
  [string]$Step,
  [string]$MaintenanceId,
  [string]$PreparedAppId,
  [string]$PreparedAppSha256,
  [string]$ExpectedWorkerManifestSha256,
  [string]$ExpectedDjangoManifestSha256,
  [string]$ExpectedDrainId,
  [switch]$KeepPostgres
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'process-deadline.ps1')
$operationDeadline=Get-ProcessDeadline
$engineEvidence=[Collections.Generic.List[object]]::new()
$aiEnabledPath='D:\teruisi-runtime\django-sales\ai-enabled.json'
$control='D:\运营管理系统\tools\operations-system-control.ps1'
$nativeShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$worker='D:\运营管理系统\tools\worker-local-service.ps1'
$candidateDjango='D:\运营管理系统-sales-django-release\tools\django-local-service.ps1'
$installedDjango='D:\teruisi-runtime\django-sales\app\tools\django-local-service.ps1'
$deployment='D:\teruisi-runtime\django-sales\app\deployment.json'
function Test-CompletionPid($Value) {
  return (($Value -is [int] -or $Value -is [long]) -and $Value -gt 0 -and $Value -le 2147483647)
}
function Invoke-OriginalEngine([string]$Script,[string[]]$Arguments) {
  $actionIndex=[Array]::IndexOf($Arguments,'-Action')
  $cleanup=if($actionIndex -ge 0 -and $Arguments[$actionIndex+1] -cin @('Status','MaintenanceStatus','AggregateStatus')){'Direct'}else{'Preserve'}
  $capture=Invoke-DeadlineProcess -Executable $nativeShell -Arguments (@('-NoProfile','-NonInteractive','-File',$Script)+$Arguments) -WorkingDirectory (Split-Path -Parent $Script) -Deadline $operationDeadline -Cleanup $cleanup
  $engineEvidence.Add($capture.Evidence)
  if($capture.ExitCode -ne 0) {
    try {$nested=$capture.Stdout.Trim() | ConvertFrom-Json; if($nested.status -ceq 'unknown' -and $nested.processEvidence){$engineEvidence.Add($nested.processEvidence)}} catch {}
    throw "Original lifecycle operator failed: exit=$($capture.ExitCode); $($capture.Evidence | ConvertTo-Json -Compress); result requires exact reconciliation" }
  return $capture.Stdout.Trim()
}
$adapterClock=[Diagnostics.Stopwatch]::StartNew()
$completionStage='engine'
try {
switch($Step) {
  'StopWorker' { Invoke-OriginalEngine $worker @('-Action','StopForRelease','-MaintenanceId',$MaintenanceId,'-Json') | Out-Null }
  'StartWorker' {
    if($ExpectedWorkerManifestSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Exact approved Worker manifest required before Start' }
    if($ExpectedDjangoManifestSha256 -cnotmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath $deployment -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedDjangoManifestSha256) { throw 'Exact approved Django manifest required before Start' }
    [void](Get-ProcessRemaining $operationDeadline)
    $startArguments=@('-Action','Start','-Json')
    if($ExpectedDrainId) { $startArguments+=@('-BackendStartPolicy','RequireReady') }
    $engine=Invoke-OriginalEngine $worker $startArguments | ConvertFrom-Json
    if($engine.status -cnotin @('started','already_running') -or $engine.manifestSha256 -cne $ExpectedWorkerManifestSha256) { throw 'Original Start completion does not match the approved candidate' }
    $completionStage='candidate-identity'
    if([string]::IsNullOrWhiteSpace([string]$engine.releaseId) -or -not (Test-CompletionPid $engine.supervisorProcessId)) { throw 'Original Start identity is incomplete' }
    $status=Invoke-OriginalEngine $worker @('-Action','Status','-Json') | ConvertFrom-Json
    if($status.version -cne 'teruisi-local-worker-status-v1' -or -not (Test-CompletionPid $status.portProcessId) -or -not (Test-CompletionPid $status.supervisorProcessId) -or $status.state -cne 'exact_release' -or $status.manifestSha256 -cne $ExpectedWorkerManifestSha256 -or $status.releaseId -cne $engine.releaseId -or $status.supervisorProcessId -ne $engine.supervisorProcessId) { throw 'Exact candidate process identity is not confirmed' }
    $completionStage='full-readiness'
    $ready=Invoke-OriginalEngine $control @('-Action','Status','-Json') | ConvertFrom-Json
    $requiredComponents=@('core','finance','netshop','market','products','workflow','inventory','customerService','accessControl','erpReference','bi')
    if(Test-Path -LiteralPath $aiEnabledPath -PathType Leaf){$requiredComponents+='ai'}
    foreach($component in $requiredComponents){if($ready.components.PSObject.Properties[$component].Value -cne $true){throw 'Enabled component readiness is incomplete'}}
    if(-not (Test-CompletionPid $ready.supervisorProcessId) -or -not (Test-CompletionPid $ready.portProcessId) -or $ready.version -cne 'teruisi-operations-system-control-v2' -or $ready.state -cne 'Running' -or $ready.backendState -cne 'Ready' -or $ready.workerState -cne 'exact_release' -or $ready.releaseId -cne $status.releaseId -or $ready.supervisorProcessId -ne $status.supervisorProcessId -or $ready.portProcessId -ne $status.portProcessId -or @($ready.components.PSObject.Properties).Count -lt $requiredComponents.Count -or @($ready.components.PSObject.Properties | Where-Object {$_.Value -cne $true}).Count -ne 0) { throw 'Complete candidate readiness is not confirmed' }
    $completionStage='maintenance'
    $maintenance=Invoke-OriginalEngine $worker @('-Action','MaintenanceStatus','-Json') | ConvertFrom-Json
    if(-not $maintenance.PSObject.Properties['maintenance'] -or -not $maintenance.PSObject.Properties['automationDrain'] -or $null -ne $maintenance.maintenance) { throw 'Maintenance state is not confirmed inactive' }
    if($ExpectedDrainId) {
      if($ExpectedDrainId -cnotmatch '^[a-f0-9]{32}$' -or $ExpectedDrainId -cne $MaintenanceId -or $maintenance.automationDrain.id -cne $ExpectedDrainId -or $maintenance.automationDrain.phase -cne 'requests' -or $maintenance.automationDrain.keepPostgres -cne $true) { throw 'Exact retained release drain is not confirmed' }
    } elseif($null -ne $maintenance.automationDrain) { throw 'Unexpected release drain remains active' }
  }
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
$completionStage='receipt'
[void](Get-ProcessRemaining $operationDeadline)
$receipt=[ordered]@{status='completed';step=$Step;engineEvidence=@($engineEvidence.ToArray());djangoManifestSha256=(Get-FileHash -LiteralPath $deployment -Algorithm SHA256).Hash.ToLowerInvariant()}
if($Step -eq 'StartWorker' -and $receipt.djangoManifestSha256 -cne $ExpectedDjangoManifestSha256){throw 'Django candidate changed during completion'}
if($Step -eq 'StartWorker') { $receipt.timing=@{engineMs=$engineEvidence[0].elapsedMs;validationMs=@($engineEvidence.ToArray() | ForEach-Object {[pscustomobject]$_} | Select-Object -Skip 1 | Measure-Object -Property elapsedMs -Sum)[0].Sum;adapterMs=$adapterClock.ElapsedMilliseconds}; $receipt.manifestSha256=$ExpectedWorkerManifestSha256; $receipt.readiness='complete'; $receipt.maintenanceConfirmed=$true }
if($Step -eq 'AggregateStatus') { $receipt.aggregate=$result }
if($Step -in @('BeginWorkerDrain','EnterMaintenance')) { $receipt.drainConfirmed=$true }
if($MaintenanceId) { $receipt.maintenanceId=$MaintenanceId }
[void](Get-ProcessRemaining $operationDeadline)
$receipt | ConvertTo-Json -Depth 12 -Compress
} catch {
  # A machine failure receipt preserves original exit codes, never an exit0 claim.
  $failureCode=if($_.Exception.Data['ProcessEvidence']){$_.Exception.Data['ProcessEvidence'].code}elseif(@($engineEvidence.ToArray() | Where-Object {$_.exitCode -ne 0}).Count -gt 0){'engine_nonzero_exit'}else{'completion_gate_failed'}
  $failure=[ordered]@{status='unknown';failureCode=$failureCode;step=$Step;stage=$completionStage;engineEvidence=@($engineEvidence.ToArray());processEvidence=$_.Exception.Data['ProcessEvidence']}
  $failure | ConvertTo-Json -Depth 12 -Compress
  exit 1
}
