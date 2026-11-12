$ErrorActionPreference='Stop'
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('watchdog-tests-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot|Out-Null
. (Join-Path $PSScriptRoot '..\tools\operations-system-watchdog.ps1') -FunctionsOnly
$WatchdogRoot=$testRoot;$StatePath=Join-Path $testRoot 'state.json'
$script:checks=0
function Assert-Watch($Condition,$Message){if(-not $Condition){throw $Message};$script:checks++}
function Fixture-Snapshot {
  @{at='2026-09-19T15:00:00Z';admission=@{mode='running';fence=('a'*64)};healthy=$false;system='StaleReceipt';backend='NotReady';worker='stale_or_invalid_receipt';supervisor='stopped';supervisorHealth='stopped';probeError=$false;ports=@()}
}
try {
  $s=Fixture-Snapshot;$state=New-WatchState;$now=[DateTimeOffset]::UtcNow
  Assert-Watch ((Get-WatchDecision $s $state $now) -eq 'confirm_failure') 'first failure must not recover'
  $state.failures=2
  Assert-Watch ((Get-WatchDecision $s $state $now) -eq 'recover') 'missing services should recover after confirmation'
  foreach($mode in @('maintenance','stopped')){$s.admission.mode=$mode;Assert-Watch ((Get-WatchDecision $s $state $now) -eq 'suspended') 'explicit stop/maintenance must remain quiet'}
  $s.admission.mode='invalid';Assert-Watch ((Get-WatchDecision $s $state $now) -eq 'alert_only') 'malformed gate must not authorize recovery'
  $s.admission.mode='running';$s.worker='foreign_or_ambiguous';Assert-Watch ((Get-WatchDecision $s $state $now) -eq 'alert_only') 'unknown port owner must not be taken over'
  $s.worker='starting_exact_release';Assert-Watch ((Get-WatchDecision $s $state $now) -eq 'alert_only') 'in-flight startup must not be repeated'
  # Recovery cap: 3 failed attempts for one incident, then alert-only until the incident closes.
  $s=Fixture-Snapshot;$cap=New-WatchState;$cap.failures=5
  foreach($n in 0,1,2){$cap.incidentRecoveryFailures=$n;Assert-Watch ((Get-WatchDecision $s $cap $now) -eq 'recover') "attempt $($n+1) must still be allowed"}
  $cap.incidentRecoveryFailures=3;Assert-Watch ((Get-WatchDecision $s $cap $now) -eq 'recovery_exhausted') 'the 4th recovery of one incident must not start'
  $cap.attempts=@();$cap.incidentRecoveryFailures=7;Assert-Watch ((Get-WatchDecision $s $cap $now.AddDays(3)) -eq 'recovery_exhausted') 'an empty 15-minute window must not reopen an exhausted incident'
  Assert-Watch ((Get-WatchDecision (Fixture-Snapshot) (New-WatchState) $now) -eq 'confirm_failure') 'a fresh state keeps the confirmation round'
  $legacy=@{version=$WatchdogVersion;failures=5;attempts=@()}
  Assert-Watch ((Get-WatchDecision $s $legacy $now) -eq 'recover') 'a state saved before the cap existed must count from zero'
  # Blindness wording and the new binding codes.
  $blind=Fixture-Snapshot;$blind.probeError=$true;$blind.diagnosticBinding=Get-WatchBindingDiagnostic 'diagnostic_regeneration_rejected' @{assets=@('worker');reason='closure_forbidden_primitive'}
  Assert-Watch ($blind.diagnosticBinding.reason -ceq 'closure_forbidden_primitive' -and $blind.diagnosticBinding.requiresRequalification) 'a rejection must carry its enum reason'
  Assert-Watch ((Get-WatchFailureText $blind) -match '人工复核' -and (Get-WatchFailureText $blind) -match '这不代表服务异常') 'a rejected regeneration must say the monitor is blind'
  $bad=Get-WatchBindingDiagnostic 'diagnostic_regeneration_rejected' @{reason='D:\PRIVATE_SECRET\x'}
  Assert-Watch ($null -eq $bad.reason -and ($bad|ConvertTo-Json) -notmatch 'PRIVATE_SECRET') 'a free-text reason must be dropped'
  $transient=Get-WatchBindingDiagnostic 'diagnostic_sources_changing' @{}
  Assert-Watch ($transient.requiresRequalification -eq $false) 'a transient source change is not a requalification'
  $s=Fixture-Snapshot;$s.supervisor='ownership_error';Assert-Watch ((Get-WatchDecision $s $state $now) -eq 'alert_only') 'supervisor PID reuse must fail closed'
  $s=Fixture-Snapshot;$s.supervisor='ownership_check_failed';Assert-Watch ((Get-WatchDecision $s $state $now) -eq 'alert_only') 'a diagnostic that could not run must fail closed, same as a confirmed mismatch'
  Assert-Watch ((Get-WatchFailureText $s) -match '监控自身未能完成.*核验') 'an unexecuted ownership check must say the monitor is blind, not that the supervisor is broken'
  Assert-Watch ((Get-WatchFailureText $s) -notmatch '归属或状态无法核验') 'ownership_check_failed must not reuse the confirmed-mismatch wording'
  $s.supervisor='ownership_error';Assert-Watch ((Get-WatchFailureText $s) -match '归属或状态无法核验') 'a confirmed identity mismatch keeps its original wording'
  $s=Fixture-Snapshot;$s.probeError=$true;Assert-Watch ((Get-WatchDecision $s $state $now) -eq 'alert_only') 'status errors must not authorize recovery'
  $s=Fixture-Snapshot;$s.worker='stopped';$s.backend='Ready';Assert-Watch ((Get-WatchDecision $s $state $now) -eq 'alert_only') 'clean Worker-only Stop must not be undone'
  $s=Fixture-Snapshot;$s.worker='exact_release';$s.backend='Ready';$s.supervisor='running';Assert-Watch ((Get-WatchDecision $s $state $now) -eq 'alert_only') 'HTTP degradation must not restart a live process'
  $s=Fixture-Snapshot;$state.attempts=@($now.AddMinutes(-1).ToString('o'));Assert-Watch ((Get-WatchDecision $s $state $now) -eq 'cooldown') 'bounded backoff required'
  $state.attempts=@(-12,-7,-2|ForEach-Object {$now.AddMinutes($_).ToString('o')});Assert-Watch ((Get-WatchDecision $s $state $now) -eq 'budget_exhausted') 'three attempts per 15 minutes maximum'
  $state.attempts=@($now.AddMinutes(-16).ToString('o'));Assert-Watch ((Get-WatchDecision $s $state $now) -eq 'recover') 'expired budget can recover'

  # Exercise the real state persistence and cycle with only external effects replaced.
  function Start-Sleep {}
  function Get-WatchEvidence($Snapshot){@{snapshot=$Snapshot}}
  function Get-WatchBusinessHealth {@{status='unknown';reason='synthetic_no_observation'}}
  function Send-WatchAlert {$script:alerts++}
  function Invoke-WatchRecovery {$script:recoveries++}
  $script:alerts=0;$script:recoveries=0
  $script:fixture=Fixture-Snapshot
  function Get-WatchSnapshot {return $script:fixture}
  Write-WatchJson $StatePath (New-WatchState)
  $r=Invoke-WatchCycle -Recover
  Assert-Watch ($r.status -eq 'confirm_failure' -and $script:recoveries -eq 0 -and $script:alerts -eq 0) 'first sample must have no recovery or notification side effects'
  $r=Invoke-WatchCycle -Recover
  Assert-Watch ($r.status -eq 'recovery_failed' -and $script:recoveries -eq 1 -and $script:alerts -eq 1) 'confirmed failure should attempt once then alert'
  $r=Invoke-WatchCycle -Recover
  Assert-Watch ($script:recoveries -eq 1) 'next tick must respect persisted cooldown'
  $script:fixture.admission.mode='maintenance';$r=Invoke-WatchCycle -Recover
  Assert-Watch ($r.status -eq 'suspended' -and $script:recoveries -eq 1) 'maintenance suspends mutations'
  $script:fixture=Fixture-Snapshot;$script:fixture.healthy=$true;$script:sample=0
  function Get-WatchSnapshot {$script:sample++;$v=Fixture-Snapshot;$v.healthy=($script:sample -eq 1);return $v}
  $r=Invoke-WatchCycle -Recover
  Assert-Watch ($r.status -eq 'verification_pending') 'one healthy sample followed by failure must not close incident'
  function Get-WatchSnapshot {$v=Fixture-Snapshot;$v.healthy=$true;return $v}
  $r=Invoke-WatchCycle -Recover
  Assert-Watch ($r.status -eq 'healthy' -and (Read-WatchJson $StatePath).failures -eq 0) 'two healthy samples close incident'

  function Get-WatchSnapshot {$v=Fixture-Snapshot;$v.healthy=$true;$v.worker='exact_release';$v.backend='Ready';$v.supervisor='running';return $v}
  function Get-WatchBusinessHealth {@{status='degraded';reason='market_queries_failing'}}
  Write-WatchJson $StatePath (New-WatchState)
  $r=Invoke-WatchCycle -Recover;$r=Invoke-WatchCycle -Recover
  Assert-Watch ($r.status -eq 'alert_only') 'confirmed query failures must alert without a restart'
  function Get-WatchBusinessHealth {@{status='unknown';reason='no_recent_observation'}}
  $r=Invoke-WatchCycle -Recover
  Assert-Watch ($r.status -eq 'alert_only' -and (Read-WatchJson $StatePath).marketFailureOpen) 'aging out observations must not close a known business incident'
  function Get-WatchBusinessHealth {@{status='healthy';reason='recent_reads_succeeded'}}
  $r=Invoke-WatchCycle -Recover
  Assert-Watch ($r.status -eq 'healthy' -and -not (Read-WatchJson $StatePath).marketFailureOpen) 'fresh successes are required to close the query incident'

  # Per-incident recovery cap through the real cycle (items 5b/8): only failures that really ran recovery count.
  function Reset-RecoveryWindow {$st=Read-WatchJson $StatePath;$st.attempts=@();Write-WatchJson $StatePath $st}
  function Get-WatchSnapshot {return (Fixture-Snapshot)}
  function Get-WatchBusinessHealth {@{status='unknown';reason='synthetic_no_observation'}}
  $script:recoveries=0
  Write-WatchJson $StatePath (New-WatchState)
  $r=Invoke-WatchCycle -Recover
  Assert-Watch ($r.status -eq 'confirm_failure') 'cap test: confirmation round expected'
  foreach($n in 1,2,3){
    $r=Invoke-WatchCycle -Recover
    Assert-Watch ($r.status -eq 'recovery_failed' -and $script:recoveries -eq $n -and (Read-WatchJson $StatePath).incidentRecoveryFailures -eq $n) "cap test: attempt $n must run and be counted"
    Reset-RecoveryWindow
  }
  $r=Invoke-WatchCycle -Recover
  Assert-Watch ($r.status -eq 'recovery_exhausted' -and $script:recoveries -eq 3) 'cap test: the 4th attempt of one incident started or was not recovery_exhausted'
  Reset-RecoveryWindow
  $r=Invoke-WatchCycle -Recover
  Assert-Watch ($r.status -eq 'recovery_exhausted' -and $script:recoveries -eq 3) 'cap test: an empty 15-minute window reopened an exhausted incident'
  $notRun=@('lifecycle_busy','django_lifecycle_busy','desired_state_changed','desired_state_stopped','supervisor_start_fenced','maintenance_active')
  $script:throwCode=$null
  function Invoke-WatchRecovery {$script:recoveries++;throw $script:throwCode}
  foreach($code in $notRun){
    $script:throwCode=$code;Write-WatchJson $StatePath (New-WatchState)
    $null=Invoke-WatchCycle -Recover
    foreach($i in 1..4){$null=Invoke-WatchCycle -Recover;Reset-RecoveryWindow}
    $st=Read-WatchJson $StatePath
    Assert-Watch ($st.incidentRecoveryFailures -eq 0 -and $st.recoveryAttempt.code -ceq $code) "cap test: $code counted towards the cap although it never ran recovery"
  }
  foreach($code in @('stale_pid_reused','supervisor_ownership_error','some_unexpected_failure')){
    $script:throwCode=$code;Write-WatchJson $StatePath (New-WatchState)
    $null=Invoke-WatchCycle -Recover
    $null=Invoke-WatchCycle -Recover
    Assert-Watch ((Read-WatchJson $StatePath).incidentRecoveryFailures -eq 1) "cap test: $code ran recovery and must count"
  }
  function Invoke-WatchRecovery {$script:recoveries++}

  # An open incident from a state without blindnessSeen is treated as possibly blind (item 9).
  $legacy=New-WatchState;$legacy.Remove('blindnessSeen');$legacy.incident='legacy-open-incident';$legacy.firstFailure=[DateTimeOffset]::UtcNow.AddDays(-20).ToString('o');$legacy.failures=3
  Write-WatchJson $StatePath $legacy
  $null=Invoke-WatchCycle -Recover
  Assert-Watch ((Read-WatchJson $StatePath).blindnessSeen -eq $true) 'an open incident without blindnessSeen was not treated as possibly blind'
  $known=New-WatchState;$known.incident='known-not-blind';$known.firstFailure=[DateTimeOffset]::UtcNow.AddDays(-2).ToString('o');$known.failures=3
  Write-WatchJson $StatePath $known
  $null=Invoke-WatchCycle -Recover
  Assert-Watch ((Read-WatchJson $StatePath).blindnessSeen -eq $false) 'an explicit blindnessSeen=false was overridden'
  Write-WatchJson $StatePath (New-WatchState)
  Assert-Watch ($null -eq (Read-WatchJson $StatePath).incident -and (Read-WatchJson $StatePath).blindnessSeen -eq $false) 'a fresh state must not claim blindness'

  # Round 3, item 4: closing an incident clears the per-incident fields in the state file written on that
  # very round (the opening of the next incident resets them too, so the file is what proves the close).
  function Send-WatchAlert($State,$Snapshot,$Decision){
    # The recovery notice of the closed incident is delivered by the outbox on a later cycle; it is not a run alert.
    if($Decision -ceq 'recovered'){$script:recoveryNotices++;return}
    $script:alerts++;$script:alertSeen=@{suffix=$State.notificationSuffix;blind=$State.blindnessSeen;failures=$State.incidentRecoveryFailures;text=(Get-WatchMessage $State $Snapshot $Decision)}}
  $oldIncident=New-WatchState;$oldIncident.incident=('a'*32);$oldIncident.firstFailure=[DateTimeOffset]::UtcNow.AddDays(-5).ToString('o');$oldIncident.failures=40
  $oldIncident.incidentRecoveryFailures=3;$oldIncident.notificationSuffix='-reminder2';$oldIncident.notificationEscalations=2;$oldIncident.blindnessSeen=$true;$oldIncident.notification='sent'
  Write-WatchJson $StatePath $oldIncident
  function Get-WatchSnapshot {$v=Fixture-Snapshot;$v.healthy=$true;return $v}
  $r=Invoke-WatchCycle -Recover
  $closed=Read-WatchJson $StatePath
  Assert-Watch ($r.status -eq 'healthy' -and $null -eq $closed.incident) 'close test: the old incident did not close'
  Assert-Watch ($null -eq $closed.notificationSuffix) 'close test: notificationSuffix survived the close'
  Assert-Watch ($closed.blindnessSeen -eq $false) 'close test: blindnessSeen survived the close'
  Assert-Watch ([int]$closed.incidentRecoveryFailures -eq 0) 'close test: incidentRecoveryFailures survived the close'
  Assert-Watch ([int]$closed.notificationEscalations -eq 0) 'close test: notificationEscalations survived the close'
  function Get-WatchSnapshot {return (Fixture-Snapshot)}
  $script:alerts=0;$script:alertSeen=$null;$before=$script:recoveries
  $null=Invoke-WatchCycle -Recover
  $r=Invoke-WatchCycle -Recover
  Assert-Watch ($r.status -eq 'recovery_failed' -and $script:recoveries -eq $before+1) 'close test: the next incident must be able to recover again'
  Assert-Watch ($script:alerts -eq 1 -and $null -eq $script:alertSeen.suffix -and $script:alertSeen.blind -eq $false -and [int]$script:alertSeen.failures -eq 1) 'close test: the next incident must start with a base record, no blindness and a fresh recovery count'
  Assert-Watch ($script:alertSeen.text -notmatch '失明' -and $script:alertSeen.text -notmatch '持续提醒') 'close test: the next incident message carries the previous incident wording'
  function Send-WatchAlert {$script:alerts++}

  # Re-load the real delivery function to verify at-most-once admission even when remote result is unknown.
  $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\tools\operations-system-watchdog.ps1'),[ref]$null,[ref]$null)
  $function=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Send-WatchAlert'},$true)
  Invoke-Expression $function.Extent.Text
  function Get-WatchRecipient {@{profile='fixture';user='fixture';bot='fixture'}}
  $script:sends=0
  function Invoke-WatchDws {
    $script:sends++
    Assert-Watch ((Read-WatchJson $StatePath).notification -eq 'sending') 'delivery reservation must be durable before network send'
    throw 'synthetic ambiguous remote result'
  }
  $state=New-WatchState;$state.incident='fixture';$state.firstFailure=$now.ToString('o')
  Send-WatchAlert $state (Fixture-Snapshot) 'recovery_failed'
  Assert-Watch ($state.notification -eq 'unknown') 'remote ambiguity must remain unknown'
  Send-WatchAlert $state (Fixture-Snapshot) 'recovery_failed'
  Assert-Watch ($script:sends -eq 1) 'unknown result must never resend'
  $saved=Get-Content -LiteralPath (Join-Path $testRoot 'alerts\fixture.json') -Raw
  Assert-Watch ($saved -notmatch 'robotCode|userId|profile|credential') 'alert audit must omit recipient IDs and credentials'

  $script:identityCalls=0
  function Get-WatchRecipient {$script:identityCalls++;throw 'owner_mismatch'}
  $state=New-WatchState;$state.incident='identity-fixture';$state.firstFailure=$now.ToString('o')
  Send-WatchAlert $state (Fixture-Snapshot) 'alert_only'
  Assert-Watch ($state.notification -eq 'identity_failed' -and $state.notificationReason -eq 'identity:owner_mismatch') 'pre-send failure needs a safe diagnosable reason'
  Send-WatchAlert $state (Fixture-Snapshot) 'alert_only'
  Assert-Watch ($script:identityCalls -eq 1) 'pre-send retry must obey cooldown'
  $state.lastIdentityAttempt=$now.AddMinutes(-16).ToString('o')
  Send-WatchAlert $state (Fixture-Snapshot) 'alert_only'
  Assert-Watch ($script:identityCalls -eq 2 -and $script:sends -eq 1) 'identity recheck is allowed without replaying a send'
  $state.identityAttempts=3;$state.lastIdentityAttempt=$now.AddMinutes(-16).ToString('o')
  Send-WatchAlert $state (Fixture-Snapshot) 'alert_only'
  Assert-Watch ($script:identityCalls -eq 2) 'identity retries are bounded per incident'

  $s=Fixture-Snapshot;$s.system='Running';$s.backend='Ready';$s.worker='exact_release';$s.supervisor='running'
  $s.business=@{status='degraded'};$state=New-WatchState;$state.failures=2
  Assert-Watch ((Get-WatchDecision $s $state $now) -eq 'alert_only') 'business failure must not restart healthy processes'

  # Exercise recovery admission under a real OS mutex. Only the underlying service actions are fixtures.
  $restore=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-WatchRecovery'},$true)
  Invoke-Expression $restore.Extent.Text
  $WorkerPath=Join-Path $testRoot 'worker-fixture.ps1';$DesiredPath=Join-Path $testRoot 'desired.json'
  Write-WatchJson $DesiredPath @{desiredState='running'};$fence=Get-WatchHash $DesiredPath
  $script:recoveryStages=@();$script:reused=$false;$script:maintenance=$false
  $script:testMutex='Local\TERUISI.Watchdog.Test.'+[guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText($WorkerPath,@'
param([switch]$FunctionsOnly,[string]$Action)
function Get-WorkerServiceMutexName { $script:testMutex }
function Assert-WorkerMaintenanceInactive {if($script:maintenance){throw 'maintenance_active'}}
function Get-CurrentManifestPath {'fixture'}
function Get-ManifestIdentity { @{ReleaseId='fixture'} }
function Get-WorkerStatusInternal { @{State='stale_or_invalid_receipt';Receipt=@{supervisorPid=123}} }
function Get-CimInstance {if($script:reused){return @{ProcessId=123}}}
function Invoke-WorkerSystemStart {
  $code='$m=[Threading.Mutex]::new($false,"'+$script:testMutex+'");$v=$m.WaitOne(0);if($v){$m.ReleaseMutex()};$m.Dispose();Write-Output $v'
  $answer=& $PowerShellPath -NoProfile -Command $code
  if([string]$answer -ne 'False'){throw 'worker_mutex_not_held'}
  $script:recoveryStages+='unique_start'
}
'@)
  function Restore-WatchSupervisor {$script:recoveryStages+='supervisor'}
  Invoke-WatchRecovery $fence
  Assert-Watch (($script:recoveryStages -join ',') -eq 'unique_start,supervisor') 'unique engine and supervisor must share Worker mutex in order'
  foreach($case in @('fence','maintenance','reused')){
    $script:recoveryStages=@();$script:maintenance=($case -eq 'maintenance');$script:reused=($case -eq 'reused')
    $passedFence=if($case -eq 'fence'){'b'*64}else{$fence}
    $blocked=$false;try{Invoke-WatchRecovery $passedFence}catch{$blocked=$true}
    Assert-Watch ($blocked -and $script:recoveryStages.Count -eq 0) "unsafe $case recovery reached Start"
  }
  @{passed=$script:checks;productionServicesTouched=$false;messagesSent=$false}|ConvertTo-Json -Compress
} finally {
  # Exact task-owned temp root only; no production paths are used by fixtures.
  if($testRoot.StartsWith([IO.Path]::GetTempPath()) -and (Split-Path $testRoot -Leaf) -match '^watchdog-tests-[0-9a-f]{32}$'){Remove-Item -LiteralPath $testRoot -Recurse -Force}
}
