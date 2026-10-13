param([string]$Source,[string]$OutputRoot)
$ErrorActionPreference='Stop'
. $Source
$stages=@('preflight','create-intent','await-drain','stop-declared-instances','enter-stopped-maintenance','exit-stopped-maintenance','start-original-stack','restore-supervisor','verify-ready','install-diagnostic','verify-installation')
function Get-ProcessRemaining($d){if($script:expired){throw 'deadline'};10000}
function New-StartupRecoveryLease {[pscustomobject]@{thread=[Threading.Thread]::CurrentThread.ManagedThreadId}}
function Enter-StartupRecoveryLease($l){$script:owned=$true;return $true}
function Assert-StartupRecoveryLease($l){if(-not $script:owned -or $l.thread -ne [Threading.Thread]::CurrentThread.ManagedThreadId){throw 'wrong-thread'}}
function Exit-StartupRecoveryLease($l){$script:owned=$false;$script:released++}
function Close-StartupRecoveryLease($l){}
function Assert-StartupRecoveryContext($p,$s){if($s -ceq $script:contextFailure){throw 'context-changed'}}
function Invoke-StartupRecoveryBoundStage($s,$p,$d){Assert-StartupRecoveryLease $script:dummy;$script:called.Add($s);if($s -ceq $script:failAt){throw 'synthetic-stage-failure'};return @{stage=$s}}
function Assert-StartupRecoveryStageResult($s,$r,$p){if($r.stage -cne $s){throw 'bad-result'}}
function Confirm-StartupRecoveryFailureFence($p,$exited){if(-not $script:owned){throw 'containment-outside-lease'};$script:contained++;$script:exitFlag=$exited;if($script:failContainment){throw 'synthetic-containment-failure'};@{ownMarkerVerified=$true}}
$script:dummy=[pscustomobject]@{thread=[Threading.Thread]::CurrentThread.ManagedThreadId}
$cases=@('success','before-mutation-context','deadline')+@($stages|Where-Object {$_ -cne 'preflight'})+@('containment-failure')
foreach($case in $cases){
 $script:called=[Collections.Generic.List[string]]::new();$script:owned=$false;$script:released=0;$script:contained=0;$script:exitFlag=$false;$script:expired=($case -ceq 'deadline');$script:failContainment=($case -ceq 'containment-failure');$script:failAt=$case;$script:contextFailure=''
 if($case -ceq 'before-mutation-context'){$script:contextFailure='preflight'}
 if($case -ceq 'containment-failure'){$script:failAt='start-original-stack'}
 $caught=$null
 try{$result=Invoke-StartupRecoverySequence ([pscustomobject]@{version='startup-recovery-integration-v1'}) (Join-Path $OutputRoot ($case+'.jsonl')) 999999}catch{$caught=$_}
 if($script:owned -or $script:released -ne 1){throw "Lease leaked: $case"}
 if($case -ceq 'success'){if($null -ne $caught -or ($script:called -join ',') -cne ($stages -join ',') -or $script:contained -ne 0 -or $result.batchReconciled -cne $false){throw 'success contract'}}
 elseif($case -cin @('before-mutation-context','deadline')){if($null -eq $caught -or $script:called.Count -ne 0 -or $script:contained -ne 0){throw 'preflight mutation'}}
 else{
  if($null -eq $caught -or $script:contained -ne 1){throw "failure containment: $case"}
  $expectedExit=([array]::IndexOf($stages,$script:failAt) -ge [array]::IndexOf($stages,'exit-stopped-maintenance'))
  if($script:exitFlag -ne $expectedExit){throw 'clear-then-fail not contained'}
  if($script:called.Count -ne ([array]::IndexOf($stages,$script:failAt)+1)){throw 'continued after failure'}
  if($case -ceq 'containment-failure' -and -not $caught.Exception.Data.Contains('ContainmentFailure')){throw 'lost containment failure'}
 }
}
@{status='passed';cases=$cases.Count;allOperationsSynthetic=$true;productionMutations=0}|ConvertTo-Json -Compress
