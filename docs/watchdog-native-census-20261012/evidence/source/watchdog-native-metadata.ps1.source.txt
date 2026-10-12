$script:ReadonlyCensus=$null
# Diagnostic-only metadata supplementation. No receipt writes, process control,
# privilege adjustment or VM_READ. Invoked only by the generated status wrappers.
if (-not ('Teruisi.ReadonlyProcessMetadata' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
namespace Teruisi { public static class ReadonlyProcessMetadata {
 public static bool SameCreation(long native,long cim){return native/10==cim/10;}
 [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr h,out uint code);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetProcessTimes(IntPtr h,out long c,out long e,out long k,out long u);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr h,uint flags,StringBuilder b,ref uint n);
 [DllImport("ntdll.dll")] public static extern int NtQueryInformationProcess(IntPtr h,int cl,IntPtr b,uint n,out uint required);
 public static string Command(IntPtr h,out int status){
  uint n;status=NtQueryInformationProcess(h,60,IntPtr.Zero,0,out n);
  if(n<16||n>65536+64)return null;
  IntPtr b=Marshal.AllocHGlobal((int)n);
  try{
   uint allocated=n;status=NtQueryInformationProcess(h,60,b,allocated,out n);
   if(status!=0||n<16||n>allocated)return null;
   int length=(ushort)Marshal.ReadInt16(b),maximum=(ushort)Marshal.ReadInt16(b,2);
   long p=Marshal.ReadIntPtr(b,8).ToInt64(),start=b.ToInt64();
   if(length%2!=0||maximum%2!=0||length>maximum||p<start+16||p-start>allocated||maximum>allocated-(p-start)){status=unchecked((int)0xC000000D);return null;}
   string value=Marshal.PtrToStringUni(new IntPtr(p),length/2);
   return String.IsNullOrWhiteSpace(value)?null:value;
  }finally{Marshal.FreeHGlobal(b);}
 }
}}
'@
}
function Read-ReadonlyNativeHandle([IntPtr]$Handle) {
    $exitCode=[uint32]0
    if(-not [Teruisi.ReadonlyProcessMetadata]::GetExitCodeProcess($Handle,[ref]$exitCode) -or $exitCode -ne 259){throw 'diagnostic_native_not_running'}
    $c1=0L;$c2=0L;$e=0L;$k=0L;$u=0L
    if(-not [Teruisi.ReadonlyProcessMetadata]::GetProcessTimes($Handle,[ref]$c1,[ref]$e,[ref]$k,[ref]$u)){throw 'diagnostic_native_times_unavailable'}
    if($e -gt 0){throw 'diagnostic_native_exit_time_or_unknown'}
    $image1=[Text.StringBuilder]::new(32768);$n1=[uint32]32768
    if(-not [Teruisi.ReadonlyProcessMetadata]::QueryFullProcessImageName($Handle,0,$image1,[ref]$n1)){throw 'diagnostic_native_image_unavailable'}
    $s1=0;$s2=0;$cmd1=[Teruisi.ReadonlyProcessMetadata]::Command($Handle,[ref]$s1);$cmd2=[Teruisi.ReadonlyProcessMetadata]::Command($Handle,[ref]$s2)
    $image2=[Text.StringBuilder]::new(32768);$n2=[uint32]32768
    if(-not [Teruisi.ReadonlyProcessMetadata]::QueryFullProcessImageName($Handle,0,$image2,[ref]$n2)){throw 'diagnostic_native_image_unavailable'}
    if(-not [Teruisi.ReadonlyProcessMetadata]::GetProcessTimes($Handle,[ref]$c2,[ref]$e,[ref]$k,[ref]$u)){throw 'diagnostic_native_times_unavailable'}
    if($e -gt 0){throw 'diagnostic_native_exit_time_or_unknown'}
    if($c1 -ne $c2 -or $s1 -ne 0 -or $s2 -ne 0 -or [string]::IsNullOrWhiteSpace($cmd1) -or
       -not [string]::Equals($cmd1,$cmd2,[StringComparison]::Ordinal) -or
       -not [string]::Equals($image1.ToString(),$image2.ToString(),[StringComparison]::OrdinalIgnoreCase)){throw 'diagnostic_native_identity_changed'}
    if(-not [Teruisi.ReadonlyProcessMetadata]::GetExitCodeProcess($Handle,[ref]$exitCode) -or $exitCode -ne 259){throw 'diagnostic_native_not_running'}
    [void](Get-ProcessRemaining (Get-ProcessDeadline))
    return [pscustomobject]@{CreationFileTime=$c1;ExecutablePath=$image2.ToString();CommandLine=$cmd2}
}
function Get-ReadonlyNativeProcessFields([int]$ProcessId) {
 if([IntPtr]::Size -ne 8 -or $ProcessId -le 4){throw 'diagnostic_native_target_invalid'}
 [void](Get-ProcessRemaining (Get-ProcessDeadline))
 $h=[Teruisi.ReadonlyProcessMetadata]::OpenProcess(0x1000,$false,[uint32]$ProcessId)
 if($h -eq [IntPtr]::Zero){throw ('diagnostic_native_open_'+[Runtime.InteropServices.Marshal]::GetLastWin32Error())}
 $deferred=$false
 try {
  $value=Read-ReadonlyNativeHandle $h
  if($null -ne $script:ReadonlyCensus){$script:ReadonlyCensus.NativeHolds.Add(@{ProcessId=$ProcessId;Handle=$h;Value=$value});$deferred=$true}
  return $value
 }finally{if(-not $deferred){[void][Teruisi.ReadonlyProcessMetadata]::CloseHandle($h)}}
}
function Read-ReadonlyCimProcess([int]$ProcessId) {
  if($null -ne $script:ReadonlyCensus){Register-ReadonlyCensusTarget $ProcessId;return @($script:ReadonlyCensus.Before[$ProcessId])|Where-Object {$null -ne $_}}
  return @(CimCmdlets\Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop)
}
function Complete-ReadonlyProcessMetadata([object]$Process) {
  if($null -ne $script:ReadonlyCensus){Register-ReadonlyCensusTarget ([int]$Process.ProcessId)}
  if(-not [string]::IsNullOrWhiteSpace([string]$Process.ExecutablePath) -and
     -not [string]::IsNullOrWhiteSpace([string]$Process.CommandLine)){return $Process}
  if($Process.ProcessId -le 4 -or $Process.CreationDate -isnot [datetime]){throw 'diagnostic_cim_identity_missing'}
  $native=Get-ReadonlyNativeProcessFields ([int]$Process.ProcessId)
  $after=@(Read-ReadonlyCimProcess ([int]$Process.ProcessId))
  if($after.Count -ne 1 -or $after[0].CreationDate -isnot [datetime] -or
     $Process.CreationDate -ne $after[0].CreationDate -or
     -not [Teruisi.ReadonlyProcessMetadata]::SameCreation([long]$native.CreationFileTime,$Process.CreationDate.ToUniversalTime().ToFileTimeUtc()) -or
     $Process.Name -cne $after[0].Name -or $Process.SessionId -ne $after[0].SessionId -or $Process.ParentProcessId -ne $after[0].ParentProcessId){throw 'diagnostic_cim_native_identity_changed'}
  foreach($row in @($Process,$after[0])){
    if(-not [string]::IsNullOrWhiteSpace([string]$row.ExecutablePath) -and
       -not [string]::Equals([string]$row.ExecutablePath,[string]$native.ExecutablePath,[StringComparison]::OrdinalIgnoreCase)){throw 'diagnostic_image_disagrees'}
    if(-not [string]::IsNullOrWhiteSpace([string]$row.CommandLine) -and
       -not [string]::Equals([string]$row.CommandLine,[string]$native.CommandLine,[StringComparison]::Ordinal)){throw 'diagnostic_command_disagrees'}
  }
  $copy=$Process|Select-Object *
  $copy.ExecutablePath=$native.ExecutablePath;$copy.CommandLine=$native.CommandLine
  return $copy
}
function Get-ReadonlyDiagnosticSnapshot([int]$ProcessId,[int]$Attempts=20) {
  for($attempt=1;$attempt -le $Attempts;$attempt++){
    $rows=@(Read-ReadonlyCimProcess $ProcessId)
    if($rows.Count -gt 1){throw 'diagnostic_cim_ambiguous'}
    if($rows.Count -eq 1){
      $p=Complete-ReadonlyProcessMetadata $rows[0]
      if($null -eq $p.CreationDate){throw 'diagnostic_cim_identity_missing'}
      return [pscustomobject]@{Process=$p;ProcessId=[int]$p.ProcessId;CreationDate=Get-ProcessCreation $p;ExecutablePath=Get-CanonicalPath ([string]$p.ExecutablePath);CommandLine=[string]$p.CommandLine}
    }
    Start-Sleep -Milliseconds 100
  }
  return $null
}
function Get-ReadonlyWorkerCensus([object]$Identity) {
  $receipt=Read-ProcessReceipt $Identity
  $rows=@(Read-ReadonlyWorkerCimCensus)
  if($null -eq $receipt){return $rows}
  $tree=@(Get-ProcessTree ([int]$receipt.supervisorPid) $rows)
  if($null -ne $script:ReadonlyCensus){$script:ReadonlyCensus.WorkerRoot=[int]$receipt.supervisorPid;$script:ReadonlyCensus.WorkerTree=@($tree|ForEach-Object {[int]$_.Process.ProcessId})}
  if($tree.Count -gt 512){throw 'diagnostic_worker_tree_limit'}
  $targets=[Collections.Generic.HashSet[int]]::new();[void]$targets.Add([int]$receipt.supervisorPid)
  foreach($item in $tree){[void]$targets.Add([int]$item.Process.ProcessId)}
  return @($rows|ForEach-Object {if($targets.Contains([int]$_.ProcessId)){Complete-ReadonlyProcessMetadata $_}else{$_}})
}
function Read-ReadonlyWorkerCimCensus {
  if($null -ne $script:ReadonlyCensus){return $script:ReadonlyCensus.Rows}
  return @(CimCmdlets\Get-CimInstance Win32_Process -ErrorAction Stop)
}
function Read-ReadonlyWholeCensus {
 [void](Get-ProcessRemaining (Get-ProcessDeadline))
 return @(CimCmdlets\Get-CimInstance Win32_Process -ErrorAction Stop)
}
function New-ReadonlyCensusMap([object[]]$Rows) {
 if($Rows.Count -gt 8192){throw 'diagnostic_census_limit'}
 $map=@{}
 foreach($row in $Rows){
  if($null -eq $row -or $row -is [array] -or ($row.ProcessId -isnot [int] -and $row.ProcessId -isnot [uint32] -and $row.ProcessId -isnot [long])){throw 'diagnostic_census_row'}
  if([long]$row.ProcessId -gt [int]::MaxValue){throw 'diagnostic_census_pid_range'}
  $id=[int]$row.ProcessId;if($id -lt 0 -or $map.ContainsKey($id)){throw 'diagnostic_census_duplicate'};$map[$id]=$row
 }
 return $map
}
function Register-ReadonlyCensusTarget([int]$ProcessId) {
 if($ProcessId -le 4){throw 'diagnostic_census_target'}
 [void]$script:ReadonlyCensus.Targets.Add($ProcessId)
 if($script:ReadonlyCensus.Targets.Count -gt 512){throw 'diagnostic_census_target_limit'}
}
function Assert-ReadonlyCimPair($Before,$After) {
 if($null -eq $Before -and $null -eq $After){return}
 if($null -eq $Before -or $null -eq $After){throw 'diagnostic_census_presence_changed'}
 foreach($r in @($Before,$After)){
  if($r.CreationDate -isnot [datetime] -or $r.Name -isnot [string] -or [string]::IsNullOrWhiteSpace($r.Name)){throw 'diagnostic_census_identity_missing'}
  foreach($k in @('ProcessId','ParentProcessId','SessionId')){if($r.$k -isnot [int] -and $r.$k -isnot [uint32] -and $r.$k -isnot [long]){throw 'diagnostic_census_integer'}}
  foreach($k in @('ExecutablePath','CommandLine')){if($null -ne $r.$k -and $r.$k -isnot [string]){throw 'diagnostic_census_metadata_type'}}
 }
 foreach($k in @('ProcessId','ParentProcessId','SessionId','Name','CreationDate')){if($Before.$k -cne $After.$k){throw 'diagnostic_census_identity_changed'}}
 foreach($k in @('ExecutablePath','CommandLine')){
  if(-not [string]::IsNullOrWhiteSpace($Before.$k)){
   if([string]::IsNullOrWhiteSpace($After.$k)){throw 'diagnostic_census_metadata_lost'}
   $comparison=if($k -eq 'ExecutablePath'){[StringComparison]::OrdinalIgnoreCase}else{[StringComparison]::Ordinal}
   if(-not [string]::Equals($Before.$k,$After.$k,$comparison)){throw 'diagnostic_census_metadata_changed'}
  }
 }
}
function Invoke-ReadonlyMetadataObservation([scriptblock]$ReadStatus) {
 if($null -ne $script:ReadonlyCensus){throw 'diagnostic_census_nested'}
 $rows=@(Read-ReadonlyWholeCensus);$before=New-ReadonlyCensusMap $rows
 $script:ReadonlyCensus=@{Rows=$rows;Before=$before;Targets=[Collections.Generic.HashSet[int]]::new();NativeHolds=[Collections.Generic.List[object]]::new();WorkerRoot=$null;WorkerTree=$null}
 try{
  # No result is emitted before the second census and all held identities pass.
  $captured=& $ReadStatus
  $afterRows=@(Read-ReadonlyWholeCensus);$after=New-ReadonlyCensusMap $afterRows
  foreach($id in $script:ReadonlyCensus.Targets){Assert-ReadonlyCimPair $before[$id] $after[$id]}
  foreach($held in $script:ReadonlyCensus.NativeHolds){
   $last=Read-ReadonlyNativeHandle $held.Handle;$first=$held.Value;$row=$after[[int]$held.ProcessId]
   if($null -eq $row -or $first.CreationFileTime -ne $last.CreationFileTime -or
      -not [string]::Equals($first.ExecutablePath,$last.ExecutablePath,[StringComparison]::OrdinalIgnoreCase) -or
      -not [string]::Equals($first.CommandLine,$last.CommandLine,[StringComparison]::Ordinal) -or
      -not [Teruisi.ReadonlyProcessMetadata]::SameCreation([long]$last.CreationFileTime,$row.CreationDate.ToUniversalTime().ToFileTimeUtc())){throw 'diagnostic_held_identity_changed'}
   foreach($k in @('ExecutablePath','CommandLine')){if(-not [string]::IsNullOrWhiteSpace($row.$k)){$cmp=if($k -eq 'ExecutablePath'){[StringComparison]::OrdinalIgnoreCase}else{[StringComparison]::Ordinal};if(-not [string]::Equals($row.$k,$last.$k,$cmp)){throw 'diagnostic_census_native_disagrees'}}}
  }
  if($null -ne $script:ReadonlyCensus.WorkerRoot){
   $tree=@(Get-ProcessTree $script:ReadonlyCensus.WorkerRoot $afterRows|ForEach-Object {[int]$_.Process.ProcessId})
   if((@($tree|Sort-Object) -join ',') -cne (@($script:ReadonlyCensus.WorkerTree|Sort-Object) -join ',')){throw 'diagnostic_worker_tree_changed'}
  }
  [void](Get-ProcessRemaining (Get-ProcessDeadline))
  return $captured
 }finally{
  foreach($held in $script:ReadonlyCensus.NativeHolds){[void][Teruisi.ReadonlyProcessMetadata]::CloseHandle($held.Handle)}
  $script:ReadonlyCensus=$null
 }
}
