$ErrorActionPreference='Stop'
# Isolated negatives for two defects found on 2026-10-30:
#   1. An invalid diagnostic binding was indistinguishable from a probe failure,
#      so a blind monitor never said it needed requalification.
#   2. The delivery gate expected a top-level success/failedCount envelope the
#      CLI does not emit on the bot path, so no alert was ever confirmed.
# No real message is sent and no production path is touched.
$root=Join-Path ([IO.Path]::GetTempPath()) ('watchdog-binding-'+[guid]::NewGuid().ToString('N'))
$source=Join-Path $PSScriptRoot '..\tools\operations-system-watchdog.ps1'
. $source -FunctionsOnly
$WatchdogRoot=$root;$StatePath=Join-Path $root 'state.json'
$script:checks=0
$script:sends=0
function Assert-Binding($Condition,[string]$Message){if(-not $Condition){throw $Message};$script:checks++}
function Fixture-Snapshot {
  @{at=[DateTimeOffset]::UtcNow.ToString('o');completedAt=[DateTimeOffset]::UtcNow.ToString('o')
    admission=@{mode='running';fence='a'*64};healthy=$false;system='unprobed';backend='unprobed'
    worker='unprobed';supervisor='unprobed';supervisorHealth='unprobed';probeError=$true
    components=@{};ports=@();portsObservation=@{status='unknown'};probes=@{}
    stages=@{control=@{status='failed';elapsedMs=28}}
    processDiagnostic=@{stage='control';code='diagnostic_predecessor_changed';process=$null}}
}
try {
  New-Item -ItemType Directory -Path $root -Force|Out-Null
  New-Item -ItemType Directory -Path (Join-Path $root 'alerts') -Force|Out-Null
  New-Item -ItemType Directory -Path (Join-Path $root 'evidence') -Force|Out-Null

  # --- 1. Binding diagnostic is typed, bounded and leaks nothing ---
  $drift=Get-WatchBindingDiagnostic 'diagnostic_predecessor_changed' @{assets=@('worker','backend')}
  Assert-Binding ($drift.valid -eq $false -and $drift.requiresRequalification -eq $true) 'binding drift was not reported as requiring requalification'
  Assert-Binding (($drift.assets -join ',') -eq 'backend,worker') 'drifted asset names were not recorded in sorted order'
  $unknown=Get-WatchBindingDiagnostic 'probe_stage_failed' @{assets=@('worker')}
  Assert-Binding ($null -eq $unknown) 'an ordinary probe failure was mislabelled as a binding failure'
  $dirty=Get-WatchBindingDiagnostic 'diagnostic_predecessor_changed' @{assets=@('worker','D:\PRIVATE_SECRET\path.ps1','control','worker')}
  Assert-Binding (($dirty.assets -join ',') -eq 'control,worker') 'unknown asset names were not rejected'
  Assert-Binding ((($dirty|ConvertTo-Json -Depth 8) -notmatch 'PRIVATE_SECRET')) 'binding diagnostic leaked a file path'
  foreach($code in @('invalid_diagnostic_binding','diagnostic_driver_incomplete','invalid_diagnostic_bundle')){
    $typed=Get-WatchBindingDiagnostic $code @{}
    Assert-Binding ($typed.valid -eq $false -and $typed.code -ceq $code -and $typed.assets.Count -eq 0) "binding code $code was not reported"
  }

  # --- 2. The alert says the monitor is blind, not that the service is broken ---
  $snapshot=Fixture-Snapshot
  $snapshot.diagnosticBinding=Get-WatchBindingDiagnostic 'diagnostic_predecessor_changed' @{assets=@('worker','backend')}
  $text=Get-WatchFailureText $snapshot
  Assert-Binding ($text -match '监控自身需要重新资格化') 'alert text did not state that the monitor needs requalification'
  Assert-Binding ($text -match 'Worker 服务脚本' -and $text -match 'Django 服务脚本') 'alert text did not name the drifted assets'
  Assert-Binding ($text -match '这不代表服务异常') 'alert text did not separate monitor blindness from service health'
  $plain=Fixture-Snapshot
  $plain.processDiagnostic=@{stage='control';code='probe_stage_failed';process=$null}
  Assert-Binding ((Get-WatchFailureText $plain) -notmatch '重新资格化') 'an ordinary probe failure claimed requalification'

  # --- 3. Delivery is confirmed only on a fully positive real envelope ---
  function Get-WatchRecipient {@{profile='fixture';user='fixture';bot='fixture'}}
  $script:envelope=$null
  function Invoke-WatchDws($Arguments){
    $script:sends++
    Assert-Binding ($Arguments -contains '--users' -and $Arguments -notcontains '--group') 'notification left the original private route'
    return $script:envelope
  }
  # Real observed shape: ok + nested result.success/errorCode + acknowledgement key.
  $script:envelope=@{ok=$true;result=@{success=$true;errorCode=0;result=@{processQueryKey='k';invalidStaffIdList=@();flowControlledStaffIdList=@()}}}
  $ok=New-WatchState;$ok.incident='fixture-ok';$ok.firstFailure=[DateTimeOffset]::UtcNow.AddMinutes(-10).ToString('o')
  Send-WatchAlert $ok $snapshot 'alert_only'
  Assert-Binding ($ok.notification -eq 'sent' -and $null -eq $ok.notificationReason) 'a genuinely delivered alert was not confirmed'
  $receipt=Read-WatchJson (Join-Path $root 'alerts\fixture-ok.json')
  Assert-Binding ($receipt.status -eq 'sent' -and $receipt.deliveryEvidence.acknowledged -eq $true) 'delivery receipt lost its acknowledgement evidence'
  Assert-Binding ((Get-Content -LiteralPath (Join-Path $root 'alerts\fixture-ok.json') -Raw) -notmatch 'robotCode|userId|credential') 'delivery receipt leaked private values'

  # Every incomplete or negative envelope must stay unconfirmed, never guessed sent.
  $negatives=@(
    @{name='top-level-only';value=@{success=$true;failedCount=0}}
    @{name='string-success';value=@{ok=$true;result=@{success='true';errorCode=0;result=@{processQueryKey='k';invalidStaffIdList=@();flowControlledStaffIdList=@()}}}}
    @{name='cli-not-ok';value=@{ok=$false;result=@{success=$true;errorCode=0;result=@{processQueryKey='k';invalidStaffIdList=@();flowControlledStaffIdList=@()}}}}
    @{name='api-error-code';value=@{ok=$true;result=@{success=$true;errorCode=88;result=@{processQueryKey='k';invalidStaffIdList=@();flowControlledStaffIdList=@()}}}}
    @{name='no-ack-key';value=@{ok=$true;result=@{success=$true;errorCode=0;result=@{invalidStaffIdList=@();flowControlledStaffIdList=@()}}}}
    @{name='invalid-recipient';value=@{ok=$true;result=@{success=$true;errorCode=0;result=@{processQueryKey='k';invalidStaffIdList=@('17067581360097279');flowControlledStaffIdList=@()}}}}
    @{name='flow-controlled';value=@{ok=$true;result=@{success=$true;errorCode=0;result=@{processQueryKey='k';invalidStaffIdList=@();flowControlledStaffIdList=@('17067581360097279')}}}}
    @{name='absent-result';value=@{ok=$true}}
  )
  foreach($case in $negatives){
    $script:envelope=$case.value
    $state=New-WatchState;$state.incident=('neg-'+$case.name);$state.firstFailure=[DateTimeOffset]::UtcNow.AddMinutes(-10).ToString('o')
    Send-WatchAlert $state $snapshot 'alert_only'
    Assert-Binding ($state.notification -eq 'unknown' -and $state.notificationReason -eq 'delivery:delivery_unconfirmed') "envelope $($case.name) was admitted as delivered"
  }

  # --- 4. An open incident escalates a NEW record, bounded, and never replays ---
  $script:envelope=@{ok=$true;result=@{success=$true;errorCode=0;result=@{processQueryKey='k';invalidStaffIdList=@();flowControlledStaffIdList=@()}}}
  $open=New-WatchState;$open.incident='fixture-escalate';$open.firstFailure=[DateTimeOffset]::UtcNow.AddDays(-5).ToString('o')
  $open.notification='unknown';$open.notificationReason='delivery:delivery_unconfirmed'
  $open.lastIdentityAttempt=[DateTimeOffset]::UtcNow.AddDays(-4).ToString('o')
  $before=$script:sends
  Send-WatchAlert $open $snapshot 'alert_only'
  Assert-Binding ($script:sends -eq $before+1) 'a stale unknown delivery never escalated, leaving the incident silent'
  Assert-Binding ($open.notificationEscalations -eq 1) 'escalation round was not recorded'
  Assert-Binding ((Test-Path -LiteralPath (Join-Path $root 'alerts\fixture-escalate-escalation1.json'))) 'escalation did not write its own record'
  Assert-Binding ((Read-WatchJson (Join-Path $root 'alerts\fixture-escalate.json')) -eq $null) 'escalation overwrote the original unknown receipt'
  # Immediately afterwards the same round must not fire again.
  $before=$script:sends
  Send-WatchAlert $open $snapshot 'alert_only'
  Assert-Binding ($script:sends -eq $before) 'escalation replayed within its own time gate'
  # The bound holds: a fourth escalation never happens.
  $open.notificationEscalations=3;$open.notification='unknown'
  $open.lastNotificationEscalation=[DateTimeOffset]::UtcNow.AddDays(-9).ToString('o')
  $before=$script:sends
  Send-WatchAlert $open $snapshot 'alert_only'
  Assert-Binding ($script:sends -eq $before) 'escalation exceeded its bound'
  # A confirmed send is still terminal and is never escalated.
  $done=New-WatchState;$done.incident='fixture-done';$done.notification='sent'
  $before=$script:sends
  Send-WatchAlert $done $snapshot 'alert_only'
  Assert-Binding ($script:sends -eq $before -and $done.notification -eq 'sent') 'a confirmed delivery was resent'
  # Recovery notices are never escalated.
  $rec=New-WatchState;$rec.incident='fixture-rec';$rec.recoveryNotification='unknown'
  $rec.lastRecoveryIdentityAttempt=[DateTimeOffset]::UtcNow.AddDays(-4).ToString('o')
  $before=$script:sends
  Send-WatchAlert $rec $snapshot 'recovered' -Recovery
  Assert-Binding ($script:sends -eq $before) 'a recovery notice was escalated'

  @{passed=$script:checks;actualMessagesSent=$false;productionTouched=$false}|ConvertTo-Json -Compress
}finally{
  if(Test-Path -LiteralPath $root){
    if([IO.Path]::GetDirectoryName($root) -ne [IO.Path]::GetTempPath().TrimEnd('\')){throw 'refusing to remove an unexpected directory'}
    Remove-Item -LiteralPath $root -Recurse -Force
  }
}
