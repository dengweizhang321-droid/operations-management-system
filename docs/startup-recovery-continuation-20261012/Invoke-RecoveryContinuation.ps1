param([string]$BindingPath,[string]$BindingSha256)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$bindingRaw=[IO.File]::ReadAllBytes($BindingPath);$h=[Security.Cryptography.SHA256]::Create();try{$digest=([BitConverter]::ToString($h.ComputeHash($bindingRaw))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()};if($digest -cne $BindingSha256){throw 'Continuation binding changed'}
$binding=[Text.UTF8Encoding]::new($false,$true).GetString($bindingRaw)|ConvertFrom-Json -DateKind String
$originalPath='E:\codex-artifacts\startup-recovery-integration-20261012\RECOVERY_PLAN_FINAL_V1.json'
$old=[IO.File]::ReadAllText($originalPath)|ConvertFrom-Json -DateKind String
# The old plan bytes remain unchanged. This operational view selects only the
# separately approved corrected diagnostic candidate, never a new stop prefix.
$old.fixed.bundleId=$binding.diagnosticPlan.bundleId;$old.watchdogPlan=$binding.diagnosticPlan
$module=Import-Module (Join-Path $PSScriptRoot '../startup-recovery-integration-20261012/startup-recovery-operations.psm1') -PassThru -Force
Initialize-StartupRecoveryOperations $old $originalPath 'dc4f2de71423097a53f26b37e4a10bdd6ee541f9aef3c8b9005c068239a7a5c2'
& $module {
 param($binding,$bindingPath,$bindingSha,$contextPath,$removePath)
 . $removePath -FunctionsOnly
 $lease=$null;$owned=$false;$removed=$false;$stage='context';$deadline=Get-ProcessDeadline 1800000
 $log=[IO.File]::Open((Join-Path $binding.outputRoot 'CONTINUATION_STAGES.jsonl'),'CreateNew','Write','Read')
 function Record-Continuation($kind,$stage,$value){$b=[Text.UTF8Encoding]::new($false).GetBytes((@{kind=$kind;stage=$stage;at=[DateTimeOffset]::UtcNow.ToString('o');details=$value}|ConvertTo-Json -Depth 12 -Compress)+[Environment]::NewLine);$log.Write($b,0,$b.Length);$log.Flush($true)}
 function Assert-ContinuationContext($phase){Invoke-RecoveryCapture $script:recovery.node @($contextPath,$bindingPath,$bindingSha,$phase) $deadline ('continuation-context-'+$phase)}
 try{
  $lease=New-StartupRecoveryLease;$owned=Enter-StartupRecoveryLease $lease;if(-not $owned){throw 'Watchdog recovery busy'};Assert-StartupRecoveryLease $lease
  $before=Assert-ContinuationContext 'before-remove';Record-Continuation 'passed' 'before-context' $before
  & $script:recovery.backend {Assert-RuntimeRootAclHardened}
  # The new driver preserves original backend/Worker ownership predicates. An
  # own maintenance gate may suppress HTTP readiness; it does not authorize
  # clearing unknown process ownership or missing component receipts.
  $status=& $script:recovery.watch {$selected=Resolve-WatchStatusControl;Invoke-WatchScript $selected.path @('-Action','Status','-Json')}
  if($status.backendState -cne 'Ready' -or $status.workerState -cne 'exact_release' -or $status.supervisorProcessId -ne 36568 -or $status.releaseId -cne '20261011T090355Z-21c2645a63247749'){throw 'Current original-start ownership not ready'}
  $names=@('core','finance','netshop','market','products','workflow','inventory','customerService','accessControl','erpReference','bi','ai');if(@($status.components.PSObject.Properties).Count -ne 12){throw 'Missing components'};foreach($n in $names){if($status.components.$n -isnot [bool] -or $status.components.$n -cne $true){throw 'Current component not ready'}}
  Record-Continuation 'passed' 'new-owned-stack' $status
  $null=Assert-ContinuationContext 'before-remove';Assert-StartupRecoveryLease $lease;[void](Get-ProcessRemaining $deadline)
  $stage='remove-exact-own-failure-marker';$removed=$true
  $result=Remove-ExactOwnedRepairMarker 'D:\teruisi-runtime\django-sales\run\system-maintenance.json' $binding.markerSha256
  if(Test-Path -LiteralPath 'D:\teruisi-runtime\django-sales\run\system-maintenance.json'){throw 'Own marker did not disappear'}
  $null=Assert-ContinuationContext 'after-remove';Record-Continuation 'passed' $stage $result
  foreach($stage in @('restore-supervisor','verify-ready','install-diagnostic','verify-installation')){
   [void](Get-ProcessRemaining $deadline);Assert-StartupRecoveryLease $lease;$null=Assert-ContinuationContext 'after-remove';Record-Continuation 'started' $stage $null
   $value=Invoke-StartupRecoveryBoundStage $stage $script:recovery.plan $deadline;Assert-StartupRecoveryStageResult $stage $value $script:recovery.plan;Record-Continuation 'passed' $stage $value
  }
  @{status='remaining-recovery-completed';prefixReplayed=$false;naturalAcceptancePending=$true;batchReconciled=$false}|ConvertTo-Json -Compress
 }catch{
  $original=$_;$containment=$null;if($removed){try{$containment=Confirm-StartupRecoveryFailureFence $script:recovery.plan $true}catch{$original.Exception.Data['ContainmentFailure']=$_.Exception.Message}}
  try{Record-Continuation 'failed' $stage @{error=$original.Exception.Message;containment=$containment;noPrefixReplay=$true}}catch{$original.Exception.Data['EvidenceSaveFailure']=$_.Exception.Message};throw $original
 }finally{if($owned){Exit-StartupRecoveryLease $lease};if($lease){Close-StartupRecoveryLease $lease};$log.Dispose()}
} $binding $BindingPath $BindingSha256 (Join-Path $PSScriptRoot 'continuation-context.mjs') (Join-Path $PSScriptRoot '../startup-status-receipt-safety-20261012/Remove-ExactRepairFence.ps1')
