# Library only: fixed recovery order. Production bindings are supplied by the
# separately reviewed startup-recovery-operations module, never callback input.
function Invoke-StartupRecoverySequence([object]$Plan,[string]$EvidencePath,[long]$Deadline) {
  if ($Plan.version -cne 'startup-recovery-integration-v1') { throw 'Unsupported recovery plan' }
  $stages=@('preflight','create-intent','await-drain','stop-declared-instances','enter-stopped-maintenance','exit-stopped-maintenance','start-original-stack','restore-supervisor','verify-ready','install-diagnostic','verify-installation')
  $stream=[IO.File]::Open($EvidencePath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  $lease=$null;$held=$false;$mutationAttempted=$false;$maintenanceExited=$false;$completed=$false;$stage='acquire-watchdog-mutex'
  function Record-RecoveryStage([string]$Kind,[string]$Name,[object]$Details) {
    $b=[Text.UTF8Encoding]::new($false).GetBytes((@{version=1;kind=$Kind;stage=$Name;at=[DateTimeOffset]::UtcNow.ToString('o');details=$Details}|ConvertTo-Json -Depth 12 -Compress)+[Environment]::NewLine)
    $stream.Write($b,0,$b.Length);$stream.Flush($true)
  }
  try {
    $lease=New-StartupRecoveryLease
    $held=Enter-StartupRecoveryLease $lease
    if ($held -cne $true) { throw 'Recovery watchdog lease unavailable' }
    Record-RecoveryStage 'passed' $stage $null
    foreach($stage in $stages) {
      [void](Get-ProcessRemaining $Deadline)
      Assert-StartupRecoveryLease $lease
      Assert-StartupRecoveryContext $Plan $stage
      Record-RecoveryStage 'started' $stage $null
      [void](Get-ProcessRemaining $Deadline)
      if($stage -cne 'preflight'){$mutationAttempted=$true}
      # Mark exit BEFORE dispatch: a child can clear the gate and then fail.
      if($stage -ceq 'exit-stopped-maintenance'){$maintenanceExited=$true}
      $result=Invoke-StartupRecoveryBoundStage $stage $Plan $Deadline
      Assert-StartupRecoveryStageResult $stage $result $Plan
      Assert-StartupRecoveryLease $lease
      Record-RecoveryStage 'passed' $stage $result
    }
    $completed=$true
    return [pscustomobject]@{status='recovery-installation-completed';naturalAcceptancePending=$true;batchReconciled=$false;productionBatchClosed=$false}
  } catch {
    $original=$_;$containment=$null
    if($mutationAttempted){
      try {
        # This is a fixed create-or-verify own marker operation. It never
        # clears admission or stops another process, even after partial stop.
        $containment=Confirm-StartupRecoveryFailureFence $Plan $maintenanceExited
      } catch { $original.Exception.Data['ContainmentFailure']=$_.Exception.Message }
    }
    try { Record-RecoveryStage 'failed' $stage @{error=$original.Exception.Message;mutationAttempted=$mutationAttempted;maintenanceExitAttempted=$maintenanceExited;containment=$containment;noAutomaticRestart=$true;noAutomaticGateRemoval=$true} }
    catch {$original.Exception.Data['EvidenceSaveFailure']=$_.Exception.Message}
    throw $original
  } finally {
    if($held){Exit-StartupRecoveryLease $lease}
    if($null -ne $lease){Close-StartupRecoveryLease $lease}
    $stream.Dispose()
  }
}
