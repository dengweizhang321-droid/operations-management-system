# Fixed operations module. Load only after the approved plan and complete source
# closure are verified/held by the external bootstrap. No dispatch on import.
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '../../tools/startup-exact-instance-stop.ps1')
. (Join-Path $PSScriptRoot '../../tools/startup-recovery-sequence.ps1')
$script:recovery=$null
function Initialize-StartupRecoveryOperations([object]$Plan,[string]$PlanPath,[string]$PlanSha256) {
 if($null -ne $script:recovery){throw 'One recovery per process'}
 $id=[Security.Principal.WindowsIdentity]::GetCurrent()
 if($id.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not ([Security.Principal.WindowsPrincipal]::new($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Exact approved administrator required'}
 if($PSVersionTable.PSVersion.Major -lt 7){throw 'Original watchdog requires PowerShell 7'}
 $candidate='E:\codex-artifacts\startup-recovery-continuation-20261012\native-watchdog-source-v3'
 $django='D:\teruisi-runtime\django-sales\app\tools\django-local-service.ps1'
 $script:recovery=@{plan=$Plan;path=$PlanPath;sha=$PlanSha256;candidate=$candidate;django=$django;thread=[Threading.Thread]::CurrentThread.ManagedThreadId;node='C:\Program Files\nodejs\node.exe';ps='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe';worker='D:\运营管理系统\tools\worker-local-service.ps1';context=Join-Path $PSScriptRoot 'recovery-context.mjs';completed=@{}}
 # Scope isolation is essential: both original scripts define Action/Execute.
 $script:recovery.watch=New-Module -ArgumentList $candidate,$Plan.watchdogPlan.planId,(Join-Path $PSScriptRoot '../startup-recovery-continuation-20261012/Restore-RecoverySupervisorV3.ps1') -ScriptBlock {
  param($dir,$approved,$supplement)
  Set-StrictMode -Off
  . (Join-Path $dir 'operations-system-watchdog.ps1') -FunctionsOnly
  . $supplement
  $script:Execute=$true;$script:ApprovedInstallPlanId=$approved
 }
 $saved=$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
 try{
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1'
  $script:recovery.backend=New-Module -ArgumentList $django -ScriptBlock {
   param($source)
   Set-StrictMode -Off
   . $source -Action Status -RuntimeRoot 'D:\teruisi-runtime\django-sales' -MaintenanceId '12c465652dbc4b5f9f54d0b0f30eeb3a' -KeepPostgres
  }
 }finally{$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY=$saved}
 foreach($name in @('Invoke-StartupRecoverySequence','Get-ProcessRemaining','Invoke-DeadlineProcess','Invoke-ExactInstanceStop')){
  if(-not(Get-Command $name -CommandType Function -ErrorAction SilentlyContinue)){throw 'Required original library unavailable'}
 }
}
function New-StartupRecoveryLease { [pscustomobject]@{mutex=[Threading.Mutex]::new($false,'Local\TERUISI.Operations.Watchdog.v2');thread=[Threading.Thread]::CurrentThread.ManagedThreadId;owned=$false} }
function Enter-StartupRecoveryLease($l){try{$l.owned=$l.mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$l.owned=$true;$l.mutex.ReleaseMutex();$l.owned=$false;throw 'Abandoned watchdog lease requires inspection'};return $l.owned}
function Assert-StartupRecoveryLease($l){if(-not $l.owned -or $l.thread -ne [Threading.Thread]::CurrentThread.ManagedThreadId -or $script:recovery.thread -ne $l.thread){throw 'Recovery thread/lease changed'}}
function Exit-StartupRecoveryLease($l){$l.mutex.ReleaseMutex();$l.owned=$false}
function Close-StartupRecoveryLease($l){$l.mutex.Dispose()}
function Invoke-RecoveryCapture([string]$Executable,[string[]]$Arguments,[long]$Deadline,[string]$Label){
 $r=Invoke-DeadlineProcess -Executable $Executable -Arguments $Arguments -WorkingDirectory $script:recovery.plan.evidenceRoot -Deadline $Deadline -Cleanup Preserve -MaxOutputBytes 2097152
 $safe=@{label=$Label;process=$r.Evidence;stdoutSha256=Get-StopTextHash $r.Stdout;stderrSha256=Get-StopTextHash $r.Stderr}
 $name=Join-Path $script:recovery.plan.evidenceRoot ($Label+'-'+[guid]::NewGuid().ToString('N')+'.json')
 $f=[IO.File]::Open($name,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
 try{$b=[Text.UTF8Encoding]::new($false).GetBytes(($safe|ConvertTo-Json -Depth 10 -Compress));$f.Write($b,0,$b.Length);$f.Flush($true)}finally{$f.Dispose()}
 if($r.ExitCode -ne 0){throw "Original operation rejected: $Label"}
 if(-not $r.Stdout.TrimStart().StartsWith('{')){throw "Non-object original output: $Label"}
 $value=$r.Stdout|ConvertFrom-Json -DateKind String -ErrorAction Stop
 if($value -isnot [pscustomobject]){throw "Invalid original output: $Label"}
 return $value
}
function Assert-StartupRecoveryContext($Plan,[string]$Stage){
 $deadline=[Math]::Min((Get-ProcessDeadline),[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+30000)
 $null=Invoke-RecoveryCapture $script:recovery.node @($script:recovery.context,'inspect',$script:recovery.path,$script:recovery.sha,$Stage) $deadline ('context-'+$Stage)
 & $script:recovery.backend {Assert-RuntimeRootAclHardened}
}
function Invoke-RecoveryWorker([string]$Action,[long]$Deadline){
 $a=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$script:recovery.worker,'-Action',$Action,'-Json')
 if($Action -cin @('EnterMaintenance','ExitMaintenance')){$a+=@('-MaintenanceId','12c465652dbc4b5f9f54d0b0f30eeb3a')}
 if($Action -ceq 'EnterMaintenance'){$a+='-KeepPostgres'}
 $oldModules=$env:PSModulePath
 try{$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules';Invoke-RecoveryCapture $script:recovery.ps $a $Deadline ('worker-'+$Action)}finally{$env:PSModulePath=$oldModules}
}
function Convert-ApprovedStopTargets([object[]]$Targets){
 foreach($t in $Targets){
  if(($t.depth -isnot [int] -and $t.depth -isnot [long]) -or $t.depth -lt 0 -or $t.depth -gt 16){throw 'Non-integer or out-of-range JSON stop depth'}
  # PS7 JSON uses Int64. Normalize only this already validated scalar; never
  # coerce strings, booleans, floating values or arrays into the core contract.
  $t.depth=[int]$t.depth
 }
 return ,$Targets
}
function Assert-RecoveryServiceReadiness($r){
 $controllerHealth=$null
 $controllerHealthPresent=$false
 if($r -is [Collections.IDictionary]){if($r.Contains('controllerHealthValid')){$controllerHealthPresent=$true;$controllerHealth=$r['controllerHealthValid']}}
 elseif($r -is [pscustomobject]){$property=$r.PSObject.Properties['controllerHealthValid'];if($null -ne $property){$controllerHealthPresent=$true;$controllerHealth=$property.Value}}
 else{throw 'Application readiness must be an object'}
 if($controllerHealthPresent -and $controllerHealth -isnot [bool]){throw 'Optional controller health must be a boolean'}
 if($r.probeError -isnot [bool] -or $r.probeError -cne $false -or $r.system -cne 'Running' -or $r.backend -cne 'Ready' -or $r.worker -cne 'exact_release' -or $controllerHealth -ceq $false -or $r.components.Count -ne 12 -or @($r.components.Values|Where-Object {$_ -isnot [bool] -or $_ -cne $true}).Count -ne 0 -or $r.probes.Count -ne 4 -or @($r.probes.Values|Where-Object {$_.ok -isnot [bool] -or $_.ok -cne $true}).Count -ne 0){throw 'Application must be ready before restoring its supervisor'}
}
function Invoke-StartupRecoveryBoundStage([string]$Stage,$Plan,[long]$Deadline){
 switch -CaseSensitive ($Stage){
  'preflight' {
   & $script:recovery.backend {Assert-DeployedApplication;Assert-RuntimeAclHardened}
   $declared=Invoke-RecoveryCapture $script:recovery.node @($script:recovery.context,'targets',$script:recovery.path,$script:recovery.sha,$Stage) $Deadline 'stop-declaration'
   $script:recovery.targets=Convert-ApprovedStopTargets @($declared.targets)
   $actorPath='D:\.codex\worktrees\startup-status-receipt-safety\运营管理系统\docs\startup-status-receipt-safety-20261012\Observe-LegacyStatusActors.ps1'
   $savedModules=$env:PSModulePath
   try{$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules';$actors=Invoke-RecoveryCapture $script:recovery.ps @('-NoProfile','-NonInteractive','-File',$actorPath) $Deadline 'legacy-actors'}finally{$env:PSModulePath=$savedModules}
   if($actors.version -cne 'ordinary-legacy-actor-observation-v1' -or $actors.unknown -ne 0 -or @($actors.rows|Where-Object {$_.identityComplete -cne $true -or $_.controllerReferenced -or $_.supervisorReferenced -or $_.explicitStatusOrPanel}).Count -ne 0){throw 'Observed legacy status actor or unknown metadata blocks recovery'}
   # This bounded observer does not establish absence of encoded or other
   # executable actors; the approval scope must retain that limitation.
   $p=& $script:recovery.watch {Get-WatchInstallPlan}
   if($p.planId -cne $Plan.watchdogPlan.planId -or $p.bundleId -cne $Plan.fixed.bundleId){throw 'Actual install plan changed'}
   return @{stage=$Stage;planId=$p.planId;actors=$actors;continuousActorExclusion=$false}
  }
  'create-intent' {
   return Invoke-RecoveryCapture $script:recovery.node @($script:recovery.context,'create',$script:recovery.path,$script:recovery.sha,$Stage) $Deadline $Stage
  }
  'await-drain' {
   $seconds=[int][Math]::Min(900,[Math]::Floor((Get-ProcessRemaining $Deadline)/1000))
   if($seconds -lt 1){throw 'Insufficient common deadline for original drain'}
   return & $script:recovery.backend {
    param([int]$BudgetSeconds)
    Invoke-WithServiceMutex {
     Assert-DeployedApplication;Assert-RuntimeAclHardened
     $record=Read-SystemMaintenance
     if(-not $record -or $record.id -cne $MaintenanceId -or $record.keepPostgres -cne $true){throw 'Own maintenance intent missing'}
     Wait-AutomationDrain -TimeoutSeconds $BudgetSeconds
     Invoke-AutomationPgDrainFence {Invoke-BackupConsoleMaintenanceFence {}}
     $gate=Read-AutomationDrain
     if(-not $gate -or $gate.id -cne $MaintenanceId -or $gate.phase -cne 'requests'){throw 'Original drain did not close admission'}
     @{stage='await-drain';id=$gate.id;phase=$gate.phase;keepPostgres=$gate.keepPostgres}
    }
   } $seconds
  }
  'stop-declared-instances' {return Invoke-ExactInstanceStop $script:recovery.targets (Join-Path $Plan.evidenceRoot 'EXACT_STOP.jsonl') $Deadline}
  'enter-stopped-maintenance' {return Invoke-RecoveryWorker 'EnterMaintenance' $Deadline}
  'exit-stopped-maintenance' {return Invoke-RecoveryWorker 'ExitMaintenance' $Deadline}
  'start-original-stack' {return Invoke-RecoveryWorker 'Start' $Deadline}
  'restore-supervisor' {
   $services=& $script:recovery.watch {Get-WatchSnapshot}
   Assert-RecoveryServiceReadiness $services
   & $script:recovery.watch {param([long]$d);$RecoverySupervisorDeadline=$d;Restore-RecoverySupervisor} $Deadline
   return @{status='supervisor-restoration-requested';readinessPending=$true;originalRunSemanticsPreserved=$true}
  }
  'verify-ready' {return & $script:recovery.watch {Get-WatchSnapshot}}
  'install-diagnostic' {return & $script:recovery.watch {param($dir);Install-WatchdogSafely $dir} $script:recovery.candidate}
  'verify-installation' {
   return & $script:recovery.watch {
    $i=Read-WatchJson (Join-Path $WatchdogRoot 'installation.json')
    if($i.bundleId -cne '0b8566624e19e44bdc4f556fb9f0baa541d3f35dbf695c00d06b00ba16de9abb'){throw 'Installed diagnostic differs'}
    $dir=Join-Path $WatchdogRoot ('versions\'+$i.bundleId);Assert-WatchBundle $dir $i
    $task=Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $argv='"'+$PowerShellPath+'" "'+(Join-Path $dir 'operations-system-watchdog.ps1')+'"'
    if(-not(Test-WatchTaskAction $task (Join-Path $dir 'Watchdog.NoConsole.exe') $argv $WatchdogRoot)){throw 'Installed task action differs'}
    @{status='diagnostic-installation-verified';bundleId=$i.bundleId;naturalAcceptancePending=$true}
   }
  }
  default {throw 'Unknown fixed recovery stage'}
 }
}
function Assert-StartupRecoveryStageResult([string]$Stage,$Result,$Plan){
 if($null -eq $Result -or ($Result -isnot [pscustomobject] -and $Result -isnot [Collections.IDictionary]) -or $Result -is [array]){throw 'Missing/ambiguous stage result'}
 switch -CaseSensitive($Stage){
  'preflight' {if($Result.planId -cne $Plan.watchdogPlan.planId){throw 'Plan mismatch'}}
  'create-intent' {if($Result.status -cne 'own-maintenance-created' -or $Result.drainedStopped -isnot [bool] -or $Result.drainedStopped -cne $false){throw 'Intent mismatch'}}
  'await-drain' {if($Result.phase -cne 'requests' -or $Result.id -cne $Plan.fixed.repairId -or $Result.keepPostgres -isnot [bool] -or $Result.keepPostgres -cne $true){throw 'Drain mismatch'}}
  'stop-declared-instances' {if($Result.status -cne 'declared-instances-exited' -or ($Result.count -isnot [int] -and $Result.count -isnot [long]) -or $Result.count -ne $script:recovery.targets.Count){throw 'Declared stop incomplete'}}
  'enter-stopped-maintenance' {if($Result.status -cne 'maintenance' -or $Result.maintenanceId -cne $Plan.fixed.repairId -or $Result.backendStopped -isnot [bool] -or $Result.postgresPreserved -isnot [bool] -or $Result.backendStopped -cne $true -or $Result.postgresPreserved -cne $true){throw 'Stopped maintenance incomplete'}}
  'exit-stopped-maintenance' {if($Result.status -cne 'maintenance_ended' -or $Result.maintenanceId -cne $Plan.fixed.repairId){throw 'Exit incomplete'}}
  'start-original-stack' {if($Result.status -cne 'started' -or $Result.manifestSha256 -cne $Plan.fixed.workerSha256){throw 'Original fresh start incomplete'}}
  'restore-supervisor' {if($Result.status -cne 'supervisor-restoration-requested' -or $Result.readinessPending -isnot [bool] -or $Result.readinessPending -cne $true){throw 'Supervisor restoration request incomplete'}}
  'verify-ready' {if($Result.healthy -isnot [bool] -or $Result.healthy -cne $true -or $Result.diagnosticMode -cne 'readonly_driver'){throw 'New diagnostic readiness incomplete'}}
  'install-diagnostic' {if($Result.status -cne 'installed' -or $Result.planId -cne $Plan.watchdogPlan.planId -or $Result.bundleId -cne $Plan.fixed.bundleId){throw 'Install incomplete'}}
  'verify-installation' {if($Result.status -cne 'diagnostic-installation-verified' -or $Result.bundleId -cne $Plan.fixed.bundleId){throw 'Installation readback incomplete'}}
  default {throw 'Unknown stage result'}
 }
}
function Confirm-StartupRecoveryFailureFence($Plan,[bool]$MaintenanceExited){
 # Fresh bounded containment independent of an exhausted normal-operation clock.
 $deadline=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+30000
 $saved=$env:TERUISI_PROCESS_DEADLINE_UNIX_MS
 try{
  $env:TERUISI_PROCESS_DEADLINE_UNIX_MS=[string]$deadline
  & $script:recovery.backend {Assert-RuntimeRootAclHardened}
  Invoke-RecoveryCapture $script:recovery.node @($script:recovery.context,'contain',$script:recovery.path,$script:recovery.sha,'failure-containment') $deadline 'failure-containment'
 }finally{$env:TERUISI_PROCESS_DEADLINE_UNIX_MS=$saved}
}
function Invoke-InitializedStartupRecovery {
 if($null -eq $script:recovery){throw 'Approved recovery has not been initialized'}
 Invoke-StartupRecoverySequence $script:recovery.plan (Join-Path $script:recovery.plan.evidenceRoot 'RECOVERY_STAGES.jsonl') (Get-ProcessDeadline $script:recovery.plan.deadlineMs)
}
Export-ModuleMember -Function Initialize-StartupRecoveryOperations,Invoke-InitializedStartupRecovery
