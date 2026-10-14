param([ValidateSet('initial','native-time-retry')][string]$Attempt='initial')
$ErrorActionPreference='Stop'
$out='D:\codex-artifacts\jackyun-live-test-20261014'
$candidate=Join-Path $out 'watchdog-bounded-candidate\operations-system-watchdog.ps1'
$taskName='TERUISI Operations Watchdog'
$oldBundle='ceee38dabd66ea9cc77622679d35bf601367f0582ac00fcfe5074dc10940c940'
$oldAction='D:\teruisi-runtime\operations-watchdog\versions\'+$oldBundle+'\Watchdog.NoConsole.exe'
$targetProcessId=41708
$suffix=if($Attempt -eq 'native-time-retry'){'-native-time-retry'}else{''}
if($Attempt -eq 'native-time-retry'){
 $prior=Get-Content (Join-Path $out 'watchdog-bounded-install-failure.json') -Raw|ConvertFrom-Json
 if($prior.error -cne 'Held process birth changed'){throw 'Prior failure is not the pre-stop timestamp comparison'}
}
if((Get-FileHash -LiteralPath $candidate).Hash.ToLowerInvariant() -cne '344daf4c8c21b18bc7b993b33bba0e62c03aaed97859826439f001f1e09de115'){throw 'Candidate changed'}
$health=Get-Content (Join-Path $out 'watchdog-bounded-current-health.json') -Raw|ConvertFrom-Json
if($health.healthy -cne $true -or $health.probeError -cne $false){throw 'Candidate health not established'}
$failure=Get-Content (Join-Path $out 'watchdog-stuck-callsite-1040.json') -Raw|ConvertFrom-Json
if($failure.Function -cne 'Get-WatchEvidence' -or $failure.Line -ne 392 -or $failure.Snapshot.healthy -cne $false){throw 'Original failed snapshot missing'}
$task=Get-ScheduledTask -TaskName $taskName
if($task.Actions.Execute -cne $oldAction -or $task.Principal.RunLevel -ne 'Limited' -or $task.Triggers.Count -ne 2 -or $task.Triggers[1].Repetition.Interval -cne 'PT1M'){throw 'Task predecessor changed'}
if((Test-Path (Join-Path $out ('watchdog-bounded-install-started'+$suffix+'.json'))) -or (Test-Path (Join-Path $out 'watchdog-bounded-install-result.json'))){throw 'Prior attempt exists; reconcile instead of replay'}
[IO.File]::WriteAllText((Join-Path $out ('watchdog-bounded-install-started'+$suffix+'.json')),(@{at=[DateTimeOffset]::UtcNow.ToString('o');oldBundle=$oldBundle;failedSnapshotSha256=(Get-FileHash (Join-Path $out 'watchdog-stuck-callsite-1040.json')).Hash.ToLowerInvariant();targetProcessId=$targetProcessId;businessServicesStopped=$false}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
Disable-ScheduledTask -TaskName $taskName|Out-Null
try{
 $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$targetProcessId)
 if($p){
  if($p.Name -cne 'pwsh.exe' -or $p.ParentProcessId -ne 69124 -or $p.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss') -cne '2026-10-14T02:40:24' -or $p.CommandLine -notmatch [regex]::Escape($oldBundle)){throw 'Stalled process identity changed'}
  $owner=Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid
  if($owner.ReturnValue -ne 0 -or $owner.Sid -cne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value){throw 'Stalled process owner is not current operator'}
  $children=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$targetProcessId))
  if(@($children|Where-Object {$_.Name -cne 'conhost.exe'}).Count){throw 'Business/unknown child exists; do not stop collector'}
  $owned=[Diagnostics.Process]::GetProcessById($targetProcessId)
  try{
   $heldHandle=$owned.Handle
   # Same normalization as ReadonlyProcessMetadata.SameCreation: CIM retains
   # microseconds; native FILETIME also carries the last 100ns digit.
   $nativeBirth=$owned.StartTime.ToUniversalTime().ToFileTimeUtc();$cimBirth=$p.CreationDate.ToUniversalTime().ToFileTimeUtc()
   if([decimal]::Floor([decimal]$nativeBirth/10) -ne [decimal]::Floor([decimal]$cimBirth/10) -or $owned.HasExited){throw 'Held process birth changed'}
   $owned.Kill() # Single held process only; never Kill(entireProcessTree).
   if(-not $owned.WaitForExit(5000)){throw 'Collector exit not confirmed'}
  }finally{$owned.Dispose()}
 }
 $deadline=[DateTimeOffset]::UtcNow.AddSeconds(15)
 while((Get-ScheduledTask -TaskName $taskName).State -eq 'Running'){
  if([DateTimeOffset]::UtcNow -ge $deadline){throw 'Original launcher has not exited'}
  Start-Sleep -Milliseconds 500
 }
 $planText=& $candidate -Action PlanInstall;if(-not $?){throw 'PlanInstall failed'}
 $plan=$planText|ConvertFrom-Json
 $planText|Set-Content (Join-Path $out ('watchdog-bounded-install-plan'+$suffix+'.json')) -Encoding utf8
 $result=& $candidate -Action Install -Execute -ApprovedInstallPlanId $plan.planId;if(-not $?){throw 'Install failed'}
 $result|Set-Content (Join-Path $out 'watchdog-bounded-install-result.json') -Encoding utf8
 $result
}catch{
 # The original task is restored to its previous enabled intent even if the
 # installer refuses; its own transaction owns any Action/config rollback.
 Enable-ScheduledTask -TaskName $taskName|Out-Null
 @{status='failed_preserved';error=$_.Exception.Message;at=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content (Join-Path $out ('watchdog-bounded-install-failure'+$suffix+'.json')) -Encoding utf8
 throw
}
