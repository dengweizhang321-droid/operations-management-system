param([ValidateSet('supervisor','controller')][string]$TaskProbeStage)
$ErrorActionPreference='Stop'
$TaskProbeEvidence=Join-Path $PSScriptRoot '../../docs/runtime-risk-readonly-audit-20261009/evidence'
New-Item -ItemType Directory -Path $TaskProbeEvidence -Force | Out-Null
$TaskProbeReceipt=@{stage=$TaskProbeStage;startedAt=[DateTimeOffset]::UtcNow.ToString('o');readOnly=$true;defaultDeadlineSeconds=60;watchdogCheckInvoked=$false;scope='Only installed FunctionsOnly and existing Status; no cycle, notifications, recovery or HTTP fault injection'}
. 'D:\teruisi-runtime\operations-watchdog\operations-system-watchdog.ps1' -Action Status -FunctionsOnly
$TaskProbeReceipt.installedScriptSha256=Get-WatchHash 'D:\teruisi-runtime\operations-watchdog\operations-system-watchdog.ps1'
$TaskProbeReceipt.nativePowerShell=$PowerShellPath
$env:PATH=(Split-Path $PowerShellPath)+[IO.Path]::PathSeparator+$env:PATH
$TaskProbeReceipt.nativePathPrefixMatchesInstalledCycle=$true
$TaskProbeTarget=if($TaskProbeStage -eq 'supervisor'){$SupervisorPath}else{$ControlPath}
$TaskProbeArguments=if($TaskProbeStage -eq 'supervisor'){@('-Action','Status')}else{@('-Action','Status','-Json')}
$TaskProbeTimer=[Diagnostics.Stopwatch]::StartNew()
try{$TaskProbeReceipt.data=Invoke-WatchScript $TaskProbeTarget $TaskProbeArguments;$TaskProbeReceipt.status='returned'}
catch{$TaskProbeReceipt.status='failed';$TaskProbeReceipt.errorCode=[string]$_.Exception.Message}
$TaskProbeTimer.Stop();$TaskProbeReceipt.elapsedMs=$TaskProbeTimer.Elapsed.TotalMilliseconds
$TaskProbeReceipt.completedAt=[DateTimeOffset]::UtcNow.ToString('o')
$TaskProbeFile=Join-Path $TaskProbeEvidence ($TaskProbeStage+'-watchdog-stage-01.json')
if(Test-Path -LiteralPath $TaskProbeFile){throw 'Observation already exists'}
[IO.File]::WriteAllText($TaskProbeFile,($TaskProbeReceipt|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
$TaskProbeReceipt|ConvertTo-Json -Depth 12 -Compress
