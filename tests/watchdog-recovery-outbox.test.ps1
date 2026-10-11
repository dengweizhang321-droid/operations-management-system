$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\tools\operations-system-watchdog.ps1') -FunctionsOnly
$fixtureRoot=Join-Path ([IO.Path]::GetTempPath()) ('watchdog-outbox-'+[guid]::NewGuid().ToString('N'))
$WatchdogRoot=$fixtureRoot;$StatePath=Join-Path $fixtureRoot 'state.json';$script:checks=0
function Assert-Outbox($Condition,$Message){if(-not $Condition){throw $Message};$script:checks++}
function Snapshot([bool]$Healthy){
 @{at=[DateTimeOffset]::UtcNow.ToString('o');completedAt=[DateTimeOffset]::UtcNow.ToString('o');admission=@{mode='running';fence='a'*64};healthy=$Healthy;system=if($Healthy){'Running'}else{'Stopped'};backend=if($Healthy){'Ready'}else{'NotReady'};worker=if($Healthy){'exact_release'}else{'stale_or_invalid_receipt'};supervisor=if($Healthy){'running'}else{'stopped'};supervisorHealth=if($Healthy){'healthy'}else{'stopped'};probeError=$false;components=@{core=$Healthy};ports=@();portsObservation=@{status='complete'};probes=@{}}
}
function Start-Sleep {}
function Get-WatchEvidence($Snapshot){@{snapshot=$Snapshot}}
function Get-WatchBusinessHealth {@{status='unknown'}}
$script:healthy=$false;$script:sends=0;$script:identityCalls=0;$script:identityFailure=$false;$script:ambiguous=$false
function Get-WatchSnapshot {Snapshot $script:healthy}
function Invoke-WatchRecovery {$script:healthy=$true}
function Get-WatchRecipient {$script:identityCalls++;if($script:identityFailure){throw 'owner_mismatch'};@{profile='fixture';user='fixture';bot='fixture'}}
function Invoke-WatchDws($Arguments){
 $script:sends++
 try {
 $file=Get-ChildItem -LiteralPath (Join-Path $fixtureRoot 'recovery-outbox') -Filter '*.json' -File|Where-Object {(Read-WatchJson $_.FullName).recoveryNotification -eq 'sending'}
 Assert-Outbox (@($file).Count -eq 1) 'recovery send lacked a durable independent reservation'
 Assert-Outbox ((Read-WatchJson $StatePath).notification -ne 'sending') 'outbox send corrupted current monitoring state'
 if($script:ambiguous){throw 'synthetic delivery ambiguity'}
 @{success=$true;failedCount=0}
 }catch{$script:wireError=$_.Exception.Message;throw}
}
try{
 foreach($delivery in @('sent','unknown')){
  $state=New-WatchState;$state.incident=[guid]::NewGuid().ToString('N');$id=$state.incident;$state.firstFailure=[DateTimeOffset]::UtcNow.AddMinutes(-10).ToString('o');$state.failures=2;$state.notification=$delivery
  Write-WatchJson $StatePath $state;$script:healthy=$false;$before=$script:sends
  $r=Invoke-WatchCycle -Recover
  Assert-Outbox ($r.status -eq 'recovered' -and $script:sends -eq $before+1) 'automatic recovery after an existing alert omitted recovery notification'
  Assert-Outbox (-not (Read-WatchJson $StatePath).incident) 'healthy incident did not close'
  $receipt=Read-WatchJson (Join-Path $fixtureRoot "alerts\$id-recovered.json")
  Assert-Outbox ($receipt.status -eq 'sent') ("recovery receipt missing: $($receipt.reason) $script:wireError")
  Invoke-WatchCycle -Recover|Out-Null
  Assert-Outbox ($script:sends -eq $before+1) 'continued health replayed recovery'
 }
 # Pre-send identity failure survives closure and retries only after its cooldown.
 $state=New-WatchState;$state.incident=[guid]::NewGuid().ToString('N');$id=$state.incident;$state.firstFailure=[DateTimeOffset]::UtcNow.ToString('o');$state.failures=2;$state.notification='unknown'
 Write-WatchJson $StatePath $state;$script:healthy=$true;$script:identityFailure=$true;$before=$script:identityCalls
 Invoke-WatchCycle -Recover|Out-Null
 $pending=Join-Path $fixtureRoot "recovery-outbox\$id.json"
 Assert-Outbox ((Test-Path $pending) -and -not (Read-WatchJson $StatePath).incident) 'pre-send failure lost recovery fact or kept a fake service incident'
 Invoke-WatchCycle -Recover|Out-Null
 Assert-Outbox ($script:identityCalls -eq $before+1) 'pre-send failure ignored cooldown'
 $saved=Read-WatchJson $pending|ConvertTo-Json -Depth 10|ConvertFrom-Json -AsHashtable;$saved.lastRecoveryIdentityAttempt=[DateTimeOffset]::UtcNow.AddMinutes(-16).ToString('o');Write-WatchJson $pending $saved
 $script:identityFailure=$false;$script:ambiguous=$true;$before=$script:sends
 Invoke-WatchCycle -Recover|Out-Null;Invoke-WatchCycle -Recover|Out-Null
 Assert-Outbox ($script:sends -eq $before+1 -and (Read-WatchJson (Join-Path $fixtureRoot "alerts\$id-recovered.json")).status -eq 'unknown') 'unknown recovery delivery was replayed'
 Assert-Outbox (Test-Path (Join-Path $fixtureRoot "recovery-completed\$id.json")) 'terminal unknown result did not archive outbox state'
 # A later outage must not be overwritten by an earlier queued recovery.
 $state=New-WatchState;$state.incident=[guid]::NewGuid().ToString('N');$id=$state.incident;$state.firstFailure=[DateTimeOffset]::UtcNow.ToString('o');$state.notification='sent'
 Confirm-WatchRecovery $state (Snapshot $true)
 $current=New-WatchState;$current.incident=[guid]::NewGuid().ToString('N');$newId=$current.incident;$current.failures=1;Write-WatchJson $StatePath $current
 $script:ambiguous=$false;Invoke-WatchRecoveryOutbox (Snapshot $false)
 Assert-Outbox ((Read-WatchJson $StatePath).incident -eq $newId) 'old recovery replaced a new outage'
 $historic=Snapshot $true;$historic.currentlyHealthy=$false
 Assert-Outbox ((Get-WatchMessage $state $historic 'recovered') -match '当前另有异常') 'delayed recovery falsely described the current system as healthy'
 @{passed=$script:checks;productionTouched=$false;actualMessagesSent=$false}|ConvertTo-Json -Compress
}finally{if([IO.Path]::GetFullPath($fixtureRoot).StartsWith([IO.Path]::GetTempPath()) -and (Split-Path $fixtureRoot -Leaf) -match '^watchdog-outbox-[0-9a-f]{32}$'){Remove-Item -LiteralPath $fixtureRoot -Recurse -Force}}
