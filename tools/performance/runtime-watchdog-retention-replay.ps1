# Isolated logic replay of the exact installed function; zero network or recovery calls.
$ErrorActionPreference='Stop'
$TaskReplayEvidence=Join-Path $PSScriptRoot '../../docs/runtime-risk-readonly-audit-20261009/evidence'
$TaskReplayControl=(Get-Content -LiteralPath (Join-Path $TaskReplayEvidence 'controller-watchdog-stage-01.json') -Raw | ConvertFrom-Json -DateKind String).data
$TaskReplaySupervisor=(Get-Content -LiteralPath (Join-Path $TaskReplayEvidence 'supervisor-status-01.json') -Raw | ConvertFrom-Json -DateKind String).data
. 'D:\teruisi-runtime\operations-watchdog\operations-system-watchdog.ps1' -Action Status -FunctionsOnly
function Get-Admission {return @{mode='running';fence='isolated-fixture'}}
function Invoke-WatchScript([string]$Path,[string[]]$Arguments){
 if($Path -eq $ControlPath){$script:TaskReplayControlCalled=$true;if($script:TaskReplayCase -eq 'controller-failure'){throw 'operator_failed'};$script:TaskReplayControlSucceeded=$true;return $TaskReplayControl}
 if($Path -eq $SupervisorPath){$script:TaskReplaySupervisorCalled=$true;if($script:TaskReplayCase -eq 'supervisor-failure'){throw 'probe_timeout'};return $TaskReplaySupervisor}
 throw 'Unexpected fixture script'
}
function Read-WatchJson([string]$Path){if($script:TaskReplayCase -eq 'monitor-failure'){throw 'invalid_state_file'};return [pscustomobject]@{updatedAt=[DateTimeOffset]::UtcNow.ToString('o')}}
function Test-WatchHttp([string]$Url,[string]$Kind){$script:TaskReplayHttpFixtureCalls++;return @{ok=$true;status=200}}
function Get-NetTCPConnection {return @()}
$TaskReplayCases=@()
foreach($TaskReplayName in @('healthy','controller-failure','supervisor-failure','monitor-failure')){
 $script:TaskReplayCase=$TaskReplayName;$script:TaskReplayControlCalled=$false;$script:TaskReplayControlSucceeded=$false;$script:TaskReplaySupervisorCalled=$false;$script:TaskReplayHttpFixtureCalls=0
 $TaskReplayResult=Get-WatchSnapshot
 if($TaskReplayName -eq 'healthy') {if(-not $TaskReplayResult.healthy -or $TaskReplayResult.components.Count -ne 12){throw 'Healthy fixture unexpectedly failed'}}
 else {if(-not $TaskReplayResult.probeError -or $TaskReplayResult.healthy){throw 'Failed fixture unexpectedly healthy'};if((Get-WatchDecision $TaskReplayResult @{failures=2;attempts=@()} ([DateTimeOffset]::UtcNow)) -ne 'alert_only'){throw 'Failed fixture allows recovery'}}
 if($TaskReplayName -eq 'supervisor-failure' -and (-not $script:TaskReplayControlSucceeded -or $TaskReplayResult.system -ne 'unprobed' -or $TaskReplayResult.components.Count -ne 0)){throw 'Expected confirmed pre-assignment status discard not reproduced'}
 $TaskReplayCases+=@{case=$TaskReplayName;controllerCalled=$script:TaskReplayControlCalled;controllerSucceeded=$script:TaskReplayControlSucceeded;supervisorCalled=$script:TaskReplaySupervisorCalled;system=$TaskReplayResult.system;backend=$TaskReplayResult.backend;worker=$TaskReplayResult.worker;componentCount=$TaskReplayResult.components.Count;probeError=$TaskReplayResult.probeError;healthy=$TaskReplayResult.healthy;errorDetailsStored=$TaskReplayResult.ContainsKey('error');httpFixtureCalls=$script:TaskReplayHttpFixtureCalls;status='passed'}
}
$TaskReplayReceipt=@{at=[DateTimeOffset]::UtcNow.ToString('o');status='passed';mode='isolated real-function replay with captured successful Status DTOs';installedFunctionSha256=Get-WatchHash 'D:\teruisi-runtime\operations-watchdog\operations-system-watchdog.ps1';cases=$TaskReplayCases;productionRequests=0;productionWrites=0;recoveryActions=0;externalMessages=0;historicalActualFailureCauseProved=$false}
$TaskReplayOutput=Join-Path $TaskReplayEvidence 'watchdog-state-retention-replay.json'
if(Test-Path -LiteralPath $TaskReplayOutput){throw 'Observation already exists'}
[IO.File]::WriteAllText($TaskReplayOutput,($TaskReplayReceipt|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
$TaskReplayReceipt|ConvertTo-Json -Depth 12 -Compress
