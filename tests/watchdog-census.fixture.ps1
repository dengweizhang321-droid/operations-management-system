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
function Get-ProcessTree([int]$RootId,[object[]]$Rows){return @($Rows|Where-Object {$_.ProcessId -eq $RootId -or $_.ParentProcessId -eq $RootId}|ForEach-Object {[pscustomobject]@{Process=$_}})}
foreach($case in @('tree-valid','tree-new','tree-missing','tree-parent')){
 $script:Case=$case;$script:Reads=0;$script:DeadlineExpired=$false;[Teruisi.ReadonlyProcessMetadata]::Exited=$false;$before=[Teruisi.ReadonlyProcessMetadata]::Closed;$rejected=$false;$output=@()
 try{$output=@(Invoke-ReadonlyMetadataObservation {Get-ReadonlyWorkerCensus @{}})}catch{$rejected=$true}
 if(($case -eq 'tree-valid') -eq $rejected){throw ('bad tree result '+$case)}
 if($script:Reads -ne 2 -or [Teruisi.ReadonlyProcessMetadata]::Closed -ne $before+2 -or $null -ne $script:ReadonlyCensus){throw 'tree scope not closed'}
 if($case -ne 'tree-valid' -and $output.Count -ne 0){throw 'tree result published early'}
 $checks++
}
[pscustomobject]@{checks=$checks;productionActions=0;nativeMethodsSynthetic=$true}|ConvertTo-Json -Compress
