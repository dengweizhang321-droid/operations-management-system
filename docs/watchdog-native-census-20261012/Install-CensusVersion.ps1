param([string]$OutputRoot)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$expectedRoot='E:\codex-artifacts\watchdog-native-census-20261012\approved-install-v1'
if([IO.Path]::GetFullPath($OutputRoot) -cne $expectedRoot){throw 'Fixed output required'}
$actor=[Security.Principal.WindowsIdentity]::GetCurrent()
if($actor.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not ([Security.Principal.WindowsPrincipal]::new($actor)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Approved administrator required'}
$source='E:\codex-artifacts\watchdog-native-census-20261012\candidate-v1'
$bundle='e0330d7aea1e17395cf56214c8c62e8d54c2e46359d30cce9296800c8802760c'
$planId='7458df1fe403453129cfd982c2c88b492a0842d48f2c98b34fcbff49a4fd67aa'
function Save-Once($Name,$Value){$raw=[Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 20 -Compress));$f=[IO.File]::Open((Join-Path $OutputRoot $Name),'CreateNew','Write','Read');try{$f.Write($raw,0,$raw.Length);$f.Flush($true)}finally{$f.Dispose()}}
$watch=New-Module -ArgumentList $source,$planId -ScriptBlock {
 param($dir,$approved)
 . (Join-Path $dir 'operations-system-watchdog.ps1') -FunctionsOnly
 $script:Execute=$true;$script:ApprovedInstallPlanId=$approved
 $script:PreparedLauncherPath=Join-Path $dir 'Watchdog.NoConsole.exe'
 $script:PreparedLauncherSha256='0bcb6079d8d47689141d6165fd3c2b0dbb009ed18fc1959d2e5800b73b554834'
}
$mutex=[Threading.Mutex]::new($false,'Local\TERUISI.Operations.Watchdog.v2');$held=$false;$phase='pre-install'
try{
 try{$held=$mutex.WaitOne(60000)}catch [Threading.AbandonedMutexException]{$held=$true;throw 'Abandoned watchdog ownership'}
 if(-not $held){throw 'Watchdog busy'}
 $current=& $watch {Get-WatchInstallPlan}
 if($current.planId -cne $planId -or $current.bundleId -cne $bundle -or $current.predecessorInstallationSha256 -cne 'd1d3e7d1814509eec5091f4416a3b6694dc3af890451cc831a774a2afd09a73a'){throw 'Original actual plan changed'}
 $before=Export-ScheduledTask -TaskName 'TERUISI Operations Watchdog'
 Save-Once 'TASK_BEFORE.json' @{xml=$before;observedAt=[DateTimeOffset]::UtcNow.ToString('o')}
 Save-Once 'INSTALL_STARTED.json' @{at=[DateTimeOffset]::UtcNow.ToString('o');bundleId=$bundle;planId=$planId;processId=$PID}
 $phase='original-install'
 $result=& $watch {param($dir);Install-WatchdogSafely $dir} $source
 if($result.status -cne 'installed' -or $result.bundleId -cne $bundle -or $result.planId -cne $planId){throw 'Original install did not complete'}
 $phase='post-install-readback'
 $after=Export-ScheduledTask -TaskName 'TERUISI Operations Watchdog'
 Save-Once 'TASK_AFTER.json' @{xml=$after;observedAt=[DateTimeOffset]::UtcNow.ToString('o')}
 $b=[xml]$before;$a=[xml]$after
 foreach($name in @('Triggers','Principals','Settings')){if($b.Task.$name.OuterXml -cne $a.Task.$name.OuterXml){throw ('Task '+$name+' changed')}}
 $installation=& $watch {Read-WatchJson (Join-Path $WatchdogRoot 'installation.json')}
 if($installation.bundleId -cne $bundle){throw 'Installation readback changed'}
 & $watch {param($dir,$record);Assert-WatchBundle $dir $record} (Join-Path 'D:\teruisi-runtime\operations-watchdog\versions' $bundle) $installation
 $value=@{status='exact-census-version-installed';at=[DateTimeOffset]::UtcNow.ToString('o');result=$result;bundleId=$bundle;planId=$planId;triggersPrincipalSettingsUnchanged=$true;businessServicesRestarted=$false;naturalAcceptancePending=$true}
 Save-Once 'INSTALL_RESULT.json' $value
 $value|ConvertTo-Json -Depth 12 -Compress
}catch{Save-Once 'INSTALL_FAILURE.json' @{at=[DateTimeOffset]::UtcNow.ToString('o');error=$_.Exception.Message;phase=$phase;installedWriteMayHaveOccurred=($phase -ne 'pre-install');rollbackNotAssumed=$true};throw}
finally{if($held){$mutex.ReleaseMutex()};$mutex.Dispose()}
