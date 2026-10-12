# Read-only preparation: original plan under the original watchdog lease.
# No Check, Status, Install, task write, maintenance or process termination.
param([string]$OutputPath)
$ErrorActionPreference='Stop'
$source='E:\codex-artifacts\startup-recovery-integration-20261012\native-watchdog-source-v2'
$packet='E:\codex-artifacts\startup-recovery-integration-20261012\NATIVE_WATCHDOG_CANDIDATE_V2.json'
$approvedBundle='3e46d2454ddb0879c36ead3b27305d5f128e6bacc40f245d0404324b21e07280'
$p=[IO.File]::ReadAllText($packet)|ConvertFrom-Json -DateKind String
if($p.bundleId -cne $approvedBundle -or [IO.Path]::GetFullPath($p.outputDirectory) -cne $source){throw 'Candidate binding changed'}
$holds=[Collections.Generic.List[object]]::new();$mutex=$null;$held=$false;$started=[DateTimeOffset]::UtcNow;$attempts=0
try{
 foreach($property in $p.files.PSObject.Properties){
  $file=Join-Path $source $property.Name
  $item=Get-Item -LiteralPath $file -Force
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked candidate'}
  $h=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$holds.Add($h)
  $s=[Security.Cryptography.SHA256]::Create();try{$actual=([BitConverter]::ToString($s.ComputeHash($h))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}
  if($actual -cne $property.Value){throw 'Candidate bytes changed'}
 }
 $watch=New-Module -ArgumentList $source -ScriptBlock {param($dir);. (Join-Path $dir 'operations-system-watchdog.ps1') -FunctionsOnly}
 $mutex=[Threading.Mutex]::new($false,'Local\TERUISI.Operations.Watchdog.v2')
 $deadline=[DateTimeOffset]::UtcNow.AddSeconds(60)
 do {
  try{$held=$mutex.WaitOne(1000)}catch [Threading.AbandonedMutexException]{$held=$true;throw 'Prior watchdog lease was abandoned; preparation refused'}
  if(-not $held -and [DateTimeOffset]::UtcNow -ge $deadline){throw 'Existing watchdog check did not finish within preparation window'}
 }until($held)
 do {
  $attempts++
  try{$plan=& $watch {Get-WatchInstallPlan};if($plan.bundleId -cne $approvedBundle){throw 'Original plan differs from approved candidate'};break}catch{
   if($_.Exception.Message -cne 'wait_for_existing_watchdog_check_to_finish' -or [DateTimeOffset]::UtcNow -ge $deadline){throw}
   Start-Sleep -Milliseconds 1000
  }
 }while($true)
 $result=@{status='original-plan-prepared';startedAt=$started.ToString('o');completedAt=[DateTimeOffset]::UtcNow.ToString('o');attempts=$attempts;plan=$plan;taskWrites=0;maintenanceWrites=0;processTerminations=0;leaseMaySkipConcurrentChecks=$true}
}catch{$result=@{status='rejected';startedAt=$started.ToString('o');completedAt=[DateTimeOffset]::UtcNow.ToString('o');attempts=$attempts;error=$_.Exception.Message;taskWrites=0;maintenanceWrites=0;processTerminations=0}}
finally{if($held){$mutex.ReleaseMutex()};if($mutex){$mutex.Dispose()};foreach($h in $holds){$h.Dispose()}}
$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($result|ConvertTo-Json -Depth 12)+[Environment]::NewLine)
$out=[IO.File]::Open($OutputPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read);try{$out.Write($bytes,0,$bytes.Length);$out.Flush($true)}finally{$out.Dispose()}
$result|ConvertTo-Json -Depth 12
if($result.status -ne 'original-plan-prepared'){exit 1}
