$ErrorActionPreference='Stop'
$root=Join-Path ([IO.Path]::GetTempPath()) ('watchdog-diagnostics-'+[guid]::NewGuid().ToString('N'))
$source=Join-Path $PSScriptRoot '..\tools\operations-system-watchdog.ps1'
. $source -FunctionsOnly
$WatchdogRoot=$root;$StatePath=Join-Path $root 'state.json'
$script:checks=0
function Assert-Diagnostic($Condition,[string]$Message){if(-not $Condition){throw $Message};$script:checks++}
function Fixture-Control {
  $components=@{};foreach($name in @('core','finance','netshop','market','products','workflow','inventory','customerService','accessControl','erpReference','bi','ai')){$components[$name]=$true}
  [pscustomobject]@{state='Running';backendState='Ready';workerState='exact_release';components=[pscustomobject]$components;portProcessId=10;supervisorProcessId=11;releaseId='fixture'}
}
function Fixture-Healthy {
  @{at=[DateTimeOffset]::UtcNow.ToString('o');completedAt=[DateTimeOffset]::UtcNow.ToString('o');admission=@{mode='running';fence='a'*64};healthy=$true;system='Running';backend='Ready';worker='exact_release';supervisor='running';supervisorHealth='healthy';probeError=$false;components=@{core=$true};ports=@(@{port=3000;pid=10});portsObservation=@{status='complete'};probes=@{}}
}
try {
  # The actual snapshot runs, with every external operation replaced before it is called.
  $script:case='healthy';$script:control=Fixture-Control
  function Get-Admission {@{mode='running';fence='a'*64}}
  function Resolve-WatchStatusControl {@{path=$ControlPath;mode='fixture';reason='isolated'}}
  function Invoke-WatchScript($Path,$Arguments){
    if($Path -eq $ControlPath){
      if($script:case -eq 'control-timeout'){
        $env:TERUISI_PROCESS_DEADLINE_UNIX_MS='1'
        $e=[Exception]::new('private exception');$e.Data['ProcessEvidence']=@{stage='direct-exit';code='process_deadline_exhausted';elapsedMs=60000;stdout='PRIVATE_SECRET'};throw $e
      }
      return $script:control
    }
    if($script:case -eq 'supervisor-timeout'){$env:TERUISI_PROCESS_DEADLINE_UNIX_MS='1';throw 'private exception'}
    return [pscustomobject]@{supervisorProcess='running';health='healthy'}
  }
  $realRead=${function:Read-WatchJson}
  function Read-WatchJson($Path){
    if($Path.EndsWith('monitoring\django-runtime\state.json')){
      if($script:case -eq 'monitor-error'){throw 'PRIVATE_SECRET'}
      return [pscustomobject]@{updatedAt=[DateTimeOffset]::UtcNow.ToString('o')}
    }
    & $realRead $Path
  }
  function Test-WatchHttp {return @{ok=$true;status=200}}
  function Get-WatchHttpProbes {
    $v=@{};foreach($name in @('homepage','live','ready','helper')){$v[$name]=if([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge [long]$env:TERUISI_PROCESS_DEADLINE_UNIX_MS){@{ok=$false;status=0;reason='snapshot_deadline'}}else{@{ok=$true;status=200}}};return $v
  }
  function Get-NetTCPConnection {
    if($script:case -eq 'port-error'){throw 'PRIVATE_SECRET'}
    if($script:case -eq 'port-late'){$env:TERUISI_PROCESS_DEADLINE_UNIX_MS='1'}
    return [pscustomobject]@{LocalPort=3000;OwningProcess=10}
  }
  $savedDeadline=$env:TERUISI_PROCESS_DEADLINE_UNIX_MS;$env:TERUISI_PROCESS_DEADLINE_UNIX_MS=$null
  $s=Get-WatchSnapshot
  Assert-Diagnostic ($s.healthy -and $s.components.Count -eq 12 -and $s.probes.Count -eq 4) 'healthy complete fixture was rejected'
  Assert-Diagnostic ($s.portsObservation.status -eq 'complete' -and $s.elapsedMs -ge 0 -and $s.stages.control.status -eq 'completed') 'snapshot timings or successful port observation missing'
  Assert-Diagnostic ((Get-WatchPortText $s) -match '3000=监听中' -and (Get-WatchPortText $s) -match '5791=未监听') 'a completed negative port observation must say not listening'
  $script:case='supervisor-timeout';$s=Get-WatchSnapshot
  Assert-Diagnostic (-not $s.healthy -and $s.system -eq 'Running' -and $s.backend -eq 'Ready' -and $s.components.Count -eq 12) 'supervisor error erased successful controller evidence'
  Assert-Diagnostic ($s.processDiagnostic.stage -eq 'supervisor' -and $s.deadlineExceeded) 'final deadline replaced the original failing stage'
  Assert-Diagnostic ((Get-WatchPortText $s) -notmatch '未监听' -and (Get-WatchPortText $s) -match '未知') 'a skipped port check fabricated a stopped service'
  Assert-Diagnostic ((Get-WatchFailureText $s) -match '检查超时') 'timeout was not explained'
  $script:case='control-timeout';$s=Get-WatchSnapshot
  Assert-Diagnostic ($s.processDiagnostic.stage -eq 'control' -and $s.processDiagnostic.process.code -eq 'process_deadline_exhausted') 'precise transport timeout was discarded'
  Assert-Diagnostic (($s|ConvertTo-Json -Depth 12) -notmatch 'PRIVATE_SECRET') 'private transport output leaked'
  $script:case='monitor-error';$s=Get-WatchSnapshot
  Assert-Diagnostic ($s.components.Count -eq 12 -and $s.workerPid -eq 10 -and $s.processDiagnostic.stage -eq 'monitor' -and -not $s.healthy) 'monitor failure erased process identity or claimed healthy'
  $script:case='port-error';$s=Get-WatchSnapshot
  Assert-Diagnostic ($s.portsObservation.status -eq 'unknown' -and (Get-WatchPortText $s) -notmatch '未监听') 'port command failure became a negative observation'
  $script:case='port-late';$s=Get-WatchSnapshot
  Assert-Diagnostic (-not $s.healthy -and $s.ports.Count -eq 0 -and $s.portsObservation.status -eq 'unknown') 'late port result was admitted'
  $script:case='healthy';$script:control.components.core='true';$s=Get-WatchSnapshot
  Assert-Diagnostic (-not $s.healthy -and -not $s.components.Contains('core')) 'string boolean fabricated a ready component'
  $script:control=Fixture-Control
  $script:control|Add-Member -NotePropertyName healthEvidence -NotePropertyValue @{version=1;probes=@{ready=@{called=$true;passed=$false;errorKind='timeout';elapsedMs=3001;body='PRIVATE_SECRET'}}}
  $s=Get-WatchSnapshot
  Assert-Diagnostic (-not $s.healthy -and $s.controllerHealthEvidence.probes.ready.errorKind -eq 'timeout' -and $s.controllerHealthEvidence.probes.ready.elapsedMs -eq 3001) 'controller HTTP failure trace was discarded or admitted as healthy'
  Assert-Diagnostic (($s|ConvertTo-Json -Depth 12) -notmatch 'PRIVATE_SECRET') 'controller HTTP body leaked'
  Assert-Diagnostic ((Get-WatchFailureText $s) -match 'ready 探针未通过：timeout') 'controller HTTP failure was omitted from the notification'
  $script:control=Fixture-Control
  $script:control.components|Add-Member -NotePropertyName unexpected -NotePropertyValue $true
  $script:control.components.PSObject.Properties.Remove('core');$s=Get-WatchSnapshot
  Assert-Diagnostic (-not $s.healthy -and $s.components.Count -eq 11) 'an unexpected component replaced a required component'
  Assert-Diagnostic ($null -eq $env:TERUISI_PROCESS_DEADLINE_UNIX_MS) 'snapshot leaked its deadline into the caller'
  $env:TERUISI_PROCESS_DEADLINE_UNIX_MS=$savedDeadline

  function Get-WatchEvidence($Snapshot){@{snapshot=$Snapshot}}
  $state=New-WatchState;$state.incident='fixture-evidence';$state.firstFailure='2026-10-11T05:36:28Z'
  $s=Fixture-Healthy;$s.healthy=$false;$s.components.core=$false;$s.backend='NotReady'
  $s.coreDiagnostics=@{PostgreSQL='running';DjangoReader='running';DjangoWriter='running';ReaderReadiness='not_ready';WriterReadiness='ready';probes=@{reader=@{code='timeout'}}}
  Save-WatchFailureEvidence $state $s
  $firstPath=Join-Path $root 'evidence\fixture-evidence-first-failure.json'
  $hash=Get-WatchHash $firstPath
  $s.backend='Error';Save-WatchFailureEvidence $state $s
  Assert-Diagnostic ((Get-WatchHash $firstPath) -eq $hash) 'later failure overwrote first failure'
  Assert-Diagnostic ((Read-WatchJson (Join-Path $root 'evidence\fixture-evidence-last-failure.json')).snapshot.backend -eq 'Error') 'last failure was not updated'
  Save-WatchFailureEvidence $state (Fixture-Healthy)
  Assert-Diagnostic ((Get-WatchHash $firstPath) -eq $hash) 'recovery overwrote the failure snapshot'
  $message=Get-WatchMessage $state $s 'alert_only'
  Assert-Diagnostic ($message -match '2026-10-11 13:36:28' -and $message -match '核心后端' -and $message -match 'reader 探针：timeout') 'message lost exact reason or Shanghai time'
  $safe=Get-WatchCoreDiagnostic ([pscustomobject]@{PostgreSQL='PRIVATE_SECRET';probes=@{reader=@{code='PRIVATE_SECRET';elapsedMs='PRIVATE_SECRET';body='PRIVATE_SECRET'}}})
  Assert-Diagnostic (($safe|ConvertTo-Json -Depth 8) -notmatch 'PRIVATE_SECRET') 'private core content leaked'

  # Durable failure and recovery reservations are separate and each at-most-once.
  function Get-WatchRecipient {@{profile='fixture';user='fixture';bot='fixture'}}
  $script:sends=0;$script:ambiguous=$true;$script:recoverySend=$false;$script:wireString=$false
  function Invoke-WatchDws($Arguments){
    $script:sends++
    $slot=if($script:recoverySend){'recoveryNotification'}else{'notification'}
    Assert-Diagnostic ((Read-WatchJson $StatePath).$slot -eq 'sending') 'network send preceded the durable reservation'
    Assert-Diagnostic ($Arguments -notcontains '--group' -and $Arguments -contains '--users') 'notification left the original private route'
    if($script:ambiguous){throw 'PRIVATE_SECRET'}
    if($script:wireString){return @{success='true';failedCount=0;result=@{body='PRIVATE_SECRET'}}}
    return @{success=$true;failedCount=0}
  }
  $state=New-WatchState;$state.incident='fixture-send';$state.firstFailure='2026-10-11T05:36:28Z'
  Send-WatchAlert $state $s 'alert_only';Send-WatchAlert $state $s 'alert_only'
  Assert-Diagnostic ($script:sends -eq 1 -and $state.notification -eq 'unknown') 'unknown failure delivery was replayed'
  $state.notification=$null;Send-WatchAlert $state $s 'alert_only'
  Assert-Diagnostic ($script:sends -eq 1 -and $state.notification -eq 'unknown') 'audit reservation did not survive lost state'
  $script:recoverySend=$true;$script:ambiguous=$false
  Send-WatchAlert $state (Fixture-Healthy) 'recovered' -Recovery
  Send-WatchAlert $state (Fixture-Healthy) 'recovered' -Recovery
  Assert-Diagnostic ($script:sends -eq 2 -and $state.notification -eq 'unknown' -and $state.recoveryNotification -eq 'sent') 'recovery did not close the message exactly once'
  Assert-Diagnostic ((Read-WatchJson (Join-Path $root 'alerts\fixture-send.json')).status -eq 'unknown') 'recovery falsified original unknown delivery'
  Assert-Diagnostic ((Read-WatchJson (Join-Path $root 'alerts\fixture-send-recovered.json')).status -eq 'sent') 'recovery receipt missing'
  $raw=Get-Content -LiteralPath (Join-Path $root 'alerts\fixture-send-recovered.json') -Raw
  Assert-Diagnostic ($raw -notmatch 'PRIVATE_SECRET|robotCode|userId|credential') 'notification audit leaked private values'
  $script:recoverySend=$false;$script:wireString=$true
  $badState=New-WatchState;$badState.incident='fixture-string-receipt';$badState.firstFailure='2026-10-11T05:36:28Z'
  Send-WatchAlert $badState $s 'alert_only';Send-WatchAlert $badState $s 'alert_only'
  Assert-Diagnostic ($badState.notification -eq 'unknown' -and $script:sends -eq 3) 'string success was admitted or unknown delivery replayed'
  Assert-Diagnostic ((Get-Content -LiteralPath (Join-Path $root 'alerts\fixture-string-receipt.json') -Raw) -notmatch 'PRIVATE_SECRET') 'delivery envelope content leaked'

  # Exercise two-snapshot closure and recovery suppression with the real cycle.
  $script:outcomes=@();$script:sample=0;$script:secondFails=$false
  function Get-WatchSnapshot {$script:sample++;$v=Fixture-Healthy;if($script:secondFails -and $script:sample -eq 2){$v.healthy=$false};return $v}
  function Get-WatchBusinessHealth {@{status='unknown'}}
  function Start-Sleep {}
  function Invoke-WatchRecovery {throw 'test must never recover healthy fixture'}
  function Send-WatchAlert($State,$Snapshot,$Outcome,[switch]$Recovery,$ReservationPath){$script:outcomes+=@{outcome=$Outcome;recovery=[bool]$Recovery};$State.recoveryNotification='sent';Write-WatchJson $ReservationPath $State}
  $state=New-WatchState;$state.incident=('c'*32);$state.firstFailure='2026-10-11T05:36:28Z';$state.notification='unknown';$state.failures=2
  Write-WatchJson $StatePath $state;$script:secondFails=$true
  $r=Invoke-WatchCycle -Recover
  Assert-Diagnostic ($r.status -eq 'verification_pending' -and $script:outcomes.Count -eq 0 -and (Read-WatchJson $StatePath).incident) 'one healthy observation sent premature recovery'
  $script:sample=0;$script:secondFails=$false;$r=Invoke-WatchCycle -Recover
  Assert-Diagnostic ($r.status -eq 'healthy' -and $script:outcomes.Count -eq 1 -and $script:outcomes[0].recovery -and $script:outcomes[0].outcome -eq 'recovered') 'confirmed health did not emit separate recovery'
  Assert-Diagnostic ((Read-WatchJson $StatePath).failures -eq 0 -and -not (Read-WatchJson $StatePath).incident) 'confirmed recovery did not close the incident'
  $r=Invoke-WatchCycle -Recover
  Assert-Diagnostic ($script:outcomes.Count -eq 1) 'continued health repeated recovery'
  $state=New-WatchState;$state.incident='fixture-no-alert';$state.firstFailure='2026-10-11T05:36:28Z';$state.notification='identity_failed';$state.failures=1
  Write-WatchJson $StatePath $state;$r=Invoke-WatchCycle -Recover
  Assert-Diagnostic ($script:outcomes.Count -eq 1) 'an incident never notified sent a standalone recovery'
  @{passed=$script:checks;messagesSent=$false;productionServicesTouched=$false}|ConvertTo-Json -Compress
} finally {
  if([IO.Path]::GetFullPath($root).StartsWith([IO.Path]::GetTempPath()) -and (Split-Path $root -Leaf) -match '^watchdog-diagnostics-[0-9a-f]{32}$') {Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue}
}
