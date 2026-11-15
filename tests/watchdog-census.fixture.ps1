param([string]$Source)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
Add-Type @'
using System;using System.Text;namespace Teruisi {public static class ReadonlyProcessMetadata {
public static int Closed=0; public static bool Exited=false; public static long Birth=134362368000000000;public static bool SameCreation(long a,long b){return a/10==b/10;}
public static IntPtr OpenProcess(uint a,bool i,uint p){return new IntPtr((int)p);}public static bool CloseHandle(IntPtr h){Closed++;return true;}
public static bool GetExitCodeProcess(IntPtr h,out uint c){c=Exited?0u:259u;return true;}
public static bool GetProcessTimes(IntPtr h,out long c,out long e,out long k,out long u){c=Birth;e=Exited?Birth+1:0;k=0;u=0;return true;}
public static bool QueryFullProcessImageName(IntPtr h,uint f,StringBuilder b,ref uint n){b.Append("C:\\fixture\\node.exe");return true;}
public static string Command(IntPtr h,out int s){s=0;return "fixed argv";}
}}
'@
. $Source
$script:DeadlineExpired=$false
function Get-ProcessDeadline {return 999}
function Get-ProcessRemaining($d){if($script:DeadlineExpired){throw 'expired'};return 999}
function Get-ProcessCreation($p){return $p.CreationDate.ToUniversalTime().ToString('o')}
function Get-CanonicalPath($p){return $p}
function Start-Sleep{}
function Row([int]$Id=100){[pscustomobject]@{ProcessId=$Id;ParentProcessId=50;SessionId=1;Name='node.exe';CreationDate=[datetime]::FromFileTimeUtc([Teruisi.ReadonlyProcessMetadata]::Birth);ExecutablePath=$null;CommandLine=$null}}
$script:Reads=0;$script:Case='valid'
function Read-ReadonlyWholeCensus {
 $script:Reads++;$r=Row
 if($script:Case.StartsWith('helper-')){
  # 100 supervisor; 101 helper (child of 100); 106 non-helper child of 100 (wrangler stand-in);
  # 102 and 103 helper children; 104 helper grandchild (child of 102).
  $helper=Row 101;$helper.ParentProcessId=100;$wr=Row 106;$wr.ParentProcessId=100
  $h102=Row 102;$h102.ParentProcessId=101;$h103=Row 103;$h103.ParentProcessId=101;$h104=Row 104;$h104.ParentProcessId=102
  $rows=@($r,$helper,$wr,$h102,$h103,$h104)
  if($script:Reads -gt 1){
   switch($script:Case){
   'helper-child-new'{$n=Row 105;$n.ParentProcessId=101;$rows+=$n}
   'helper-child-gone'{$rows=@($rows|Where-Object {$_.ProcessId -ne 103})}
   'helper-nested-new'{$n=Row 105;$n.ParentProcessId=102;$rows+=$n}
   'helper-nested-gone'{$rows=@($rows|Where-Object {$_.ProcessId -ne 104})}
   'helper-churn'{$rows=@($rows|Where-Object {$_.ProcessId -notin 103,104});$n=Row 105;$n.ParentProcessId=102;$m=Row 107;$m.ParentProcessId=105;$rows+=@($n,$m)}
   'helper-gone'{$rows=@($rows|Where-Object {$_.ProcessId -ne 101})}
   'helper-restarted'{$rows=@($rows|ForEach-Object {if($_.ProcessId -eq 101){$_.CreationDate=$_.CreationDate.AddTicks(10)};$_})}
   'helper-nonhelper-new'{$n=Row 107;$n.ParentProcessId=100;$rows+=$n}
   'helper-nonhelper-gone'{$rows=@($rows|Where-Object {$_.ProcessId -ne 106})}
   'helper-wr-child-new'{$n=Row 107;$n.ParentProcessId=106;$rows+=$n}
   'helper-unrecognised-child-new'{$n=Row 107;$n.ParentProcessId=101;$rows+=$n}
   }
  }
  return $rows
 }
 if($script:Case.StartsWith('tree-')){
  $child=Row 101;$child.ParentProcessId=100
  if($script:Reads -gt 1){
   if($script:Case -eq 'tree-missing'){return ,$r}
   if($script:Case -eq 'tree-parent'){$child.ParentProcessId=200}
   if($script:Case -eq 'tree-new'){$extra=Row 102;$extra.ParentProcessId=100;return @($r,$child,$extra)}
  }
  return @($r,$child)
 }
 if($script:Reads -eq 1){if($script:Case -eq 'appeared'){return @()};return ,$r}
 switch($script:Case){
 'disappeared'{return @()}
 'duplicate'{return @($r,$r)}
 'reused'{$r.CreationDate=$r.CreationDate.AddTicks(10)}
 'parent'{$r.ParentProcessId=99}
 'session'{$r.SessionId=2}
 'name'{$r.Name='other.exe'}
 'image'{$r.ExecutablePath='C:\wrong.exe'}
 'command'{$r.CommandLine='wrong argv'}
 'badtype'{$r.SessionId=@(1)}
 'held-exited'{[Teruisi.ReadonlyProcessMetadata]::Exited=$true}
 'deadline'{$script:DeadlineExpired=$true}
 }
 return ,$r
}
$checks=0
foreach($case in @('valid','disappeared','appeared','duplicate','reused','parent','session','name','image','command','badtype','held-exited','deadline')){
 $script:Case=$case;$script:Reads=0;$script:DeadlineExpired=$false;[Teruisi.ReadonlyProcessMetadata]::Exited=$false;$before=[Teruisi.ReadonlyProcessMetadata]::Closed;$rejected=$false;$output=@()
 try{$output=@(Invoke-ReadonlyMetadataObservation {Get-ReadonlyDiagnosticSnapshot 100 1})}catch{$rejected=$true}
 if(($case -eq 'valid') -eq $rejected){throw ('bad result '+$case)}
 if($null -ne $script:ReadonlyCensus){throw 'scope retained'}
 if($case -ne 'appeared' -and [Teruisi.ReadonlyProcessMetadata]::Closed -ne $before+1){throw ('handle not closed '+$case)}
 if($case -ne 'valid' -and $output.Count -ne 0){throw 'premature published result'}
 $checks++
}
foreach($rows in @(@((Row),(Row)),@([pscustomobject]@{ProcessId=[uint32]::MaxValue}),@([pscustomobject]@{ProcessId='100'}))){$caught=$false;try{New-ReadonlyCensusMap $rows|Out-Null}catch{$caught=$true};if(-not $caught){throw 'bad census accepted'};$checks++}
function Read-ProcessReceipt($Identity){return [pscustomobject]@{supervisorPid=100}}
function Get-ProcessTree([int]$RootId,[object[]]$Rows){
 $out=@();$queue=[Collections.Generic.Queue[object]]::new();$queue.Enqueue([pscustomobject]@{Id=$RootId;Depth=0});$seen=[Collections.Generic.HashSet[int]]::new()
 while($queue.Count -gt 0){
  $c=$queue.Dequeue();if(-not $seen.Add([int]$c.Id)){continue}
  $p=@($Rows|Where-Object {$_.ProcessId -eq $c.Id});if($p.Count -ne 1){continue}
  $out+=[pscustomobject]@{Process=$p[0];Depth=[int]$c.Depth}
  foreach($k in @($Rows|Where-Object {$_.ParentProcessId -eq $c.Id})){$queue.Enqueue([pscustomobject]@{Id=[int]$k.ProcessId;Depth=([int]$c.Depth+1)})}
 }
 return $out
}
# Mirrors worker-local-service.ps1 Get-HelperOwnershipContext. The designated helper is only recognised on a row whose
# metadata was already completed (CommandLine filled in), like the real Test-ExactHelperProcess which compares argv.
$script:HelperPid=0;$script:HelperThrows=$false
function Get-HelperOwnershipContext([object[]]$Tree,[object]$Identity,[int]$SupervisorId){
 if($script:HelperThrows){throw 'Multiple immutable helper processes claim the same supervisor'}
 $c=@($Tree|Where-Object {$script:HelperPid -ne 0 -and [int]$_.Process.ProcessId -eq $script:HelperPid -and [int]$_.Process.ParentProcessId -eq $SupervisorId -and $_.Process.CommandLine -ceq 'fixed argv'})
 $helper=if($c.Count -eq 1){$c[0].Process}else{$null}
 $d=[Collections.Generic.HashSet[int]]::new();$ids=[Collections.Generic.HashSet[int]]::new()
 if($helper){
  [void]$ids.Add([int]$helper.ProcessId);[void]$d.Add([int]$helper.ProcessId)
  foreach($e in @($Tree|Sort-Object Depth)){if($d.Contains([int]$e.Process.ParentProcessId)){[void]$d.Add([int]$e.Process.ProcessId)}}
 }
 return [pscustomobject]@{Helper=$helper;HelperIds=$ids;DescendantIds=$d}
}
foreach($case in @('tree-valid','tree-new','tree-missing','tree-parent')){
 $script:Case=$case;$script:Reads=0;$script:DeadlineExpired=$false;[Teruisi.ReadonlyProcessMetadata]::Exited=$false;$before=[Teruisi.ReadonlyProcessMetadata]::Closed;$rejected=$false;$output=@()
 try{$output=@(Invoke-ReadonlyMetadataObservation {Get-ReadonlyWorkerCensus @{}})}catch{$rejected=$true}
 if(($case -eq 'tree-valid') -eq $rejected){throw ('bad tree result '+$case)}
 if($script:Reads -ne 2 -or [Teruisi.ReadonlyProcessMetadata]::Closed -ne $before+2 -or $null -ne $script:ReadonlyCensus){throw 'tree scope not closed'}
 if($case -ne 'tree-valid' -and $output.Count -ne 0){throw 'tree result published early'}
 $checks++
}
# Helper descendants: the helper (101) is a target and stays in the tree; its descendants (102-105, 107) are neither.
# Handle counts prove which rows had metadata completed: 100 supervisor, 101 helper, 106 wrangler stand-in = 3.
# With no recognised helper every tree member is completed: 100,101,106,102,103,104 = 6.
$helperCases=[ordered]@{
 'helper-valid'=@{Expect='';Handles=3;Helper=101}
 'helper-child-new'=@{Expect='';Handles=3;Helper=101}
 'helper-child-gone'=@{Expect='';Handles=3;Helper=101}
 'helper-nested-new'=@{Expect='';Handles=3;Helper=101}
 'helper-nested-gone'=@{Expect='';Handles=3;Helper=101}
 'helper-churn'=@{Expect='';Handles=3;Helper=101}
 'helper-gone'=@{Expect='diagnostic_census_presence_changed';Handles=3;Helper=101}
 'helper-restarted'=@{Expect='diagnostic_census_identity_changed';Handles=3;Helper=101}
 'helper-nonhelper-new'=@{Expect='diagnostic_worker_tree_changed';Handles=3;Helper=101}
 'helper-nonhelper-gone'=@{Expect='diagnostic_census_presence_changed';Handles=3;Helper=101}
 'helper-wr-child-new'=@{Expect='diagnostic_worker_tree_changed';Handles=3;Helper=101}
 'helper-unrecognised-child-new'=@{Expect='diagnostic_worker_tree_changed';Handles=6;Helper=0}
 'helper-multiple'=@{Expect='Multiple immutable helper processes claim the same supervisor';Handles=3;Helper=101;Throws=$true}
}
foreach($case in $helperCases.Keys){
 $spec=$helperCases[$case]
 $script:Case=$case;$script:Reads=0;$script:DeadlineExpired=$false;[Teruisi.ReadonlyProcessMetadata]::Exited=$false
 $script:HelperPid=$spec.Helper;$script:HelperThrows=$spec.ContainsKey('Throws')
 $before=[Teruisi.ReadonlyProcessMetadata]::Closed;$reason='';$output=@()
 try{$output=@(Invoke-ReadonlyMetadataObservation {Get-ReadonlyWorkerCensus @{}})}catch{$reason=[string]$_.Exception.Message}
 if($reason -cne $spec.Expect){throw ('bad helper result '+$case+' got ['+$reason+'] want ['+$spec.Expect+']')}
 if($case -ne 'helper-multiple' -and $script:Reads -ne 2){throw ('helper census not read twice '+$case)}
 if([Teruisi.ReadonlyProcessMetadata]::Closed -ne $before+$spec.Handles -or $null -ne $script:ReadonlyCensus){throw ('helper scope not closed or wrong completion set '+$case)}
 if($spec.Expect -ne '' -and $output.Count -ne 0){throw ('helper result published early '+$case)}
 $checks++
}
$script:HelperPid=0;$script:HelperThrows=$false
[pscustomobject]@{checks=$checks;productionActions=0;nativeMethodsSynthetic=$true}|ConvertTo-Json -Compress
