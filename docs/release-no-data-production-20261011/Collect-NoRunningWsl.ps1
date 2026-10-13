param()
$ErrorActionPreference='Stop'
if([IntPtr]::Size -ne 8){throw 'Reviewed x64 host required'}
$actor=[Security.Principal.WindowsIdentity]::GetCurrent()
if($actor.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not ([Security.Principal.WindowsPrincipal]::new($actor)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Approved administrator required'}
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class NoWslBoundaryNative {
 [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetProcessTimes(IntPtr h,out long c,out long e,out long k,out long u);
 [DllImport("computecore.dll",ExactSpelling=true)] public static extern IntPtr HcsCreateOperation(IntPtr context,IntPtr callback);
 [DllImport("computecore.dll",ExactSpelling=true,CharSet=CharSet.Unicode)] public static extern int HcsEnumerateComputeSystems(string query,IntPtr operation);
 [DllImport("computecore.dll",ExactSpelling=true)] public static extern int HcsWaitForOperationResult(IntPtr operation,uint timeout,out IntPtr result);
 [DllImport("computecore.dll",ExactSpelling=true)] public static extern void HcsCloseOperation(IntPtr operation);
 [DllImport("kernel32.dll",ExactSpelling=true)] public static extern IntPtr LocalFree(IntPtr data);
}
'@
function Get-NoWslHash([string]$Text){$s=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($s.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}}
function Assert-NoWslEmptyJson([string]$Text){
 if($Text.Length -gt 4194304 -or $Text -cnotmatch '^[ \t\r\n]*\[[ \t\r\n]*\][ \t\r\n]*$'){throw 'Only an exact JSON empty array proves no compute systems'}
 [void]($Text|ConvertFrom-Json -ErrorAction Stop)
}
function Read-NoWslHcs {
 $op=[NoWslBoundaryNative]::HcsCreateOperation([IntPtr]::Zero,[IntPtr]::Zero);if($op -eq [IntPtr]::Zero){throw 'HCS operation allocation failed'}
 $doc=[IntPtr]::Zero
 try{
  $start=[NoWslBoundaryNative]::HcsEnumerateComputeSystems($null,$op);if($start -ne 0){throw "HCS start failed: $start"}
  $done=[NoWslBoundaryNative]::HcsWaitForOperationResult($op,10000,[ref]$doc);if($done -ne 0 -or $doc -eq [IntPtr]::Zero){throw "HCS completion unavailable: $done"}
  $text=[Runtime.InteropServices.Marshal]::PtrToStringUni($doc)
  # Do not count ConvertFrom-Json output: PS5 can flatten nested empty arrays.
  # No Owner filter: any compute system remains unreviewed in this finite branch.
  Assert-NoWslEmptyJson $text
  return [pscustomobject]@{startStatus=$start;completionStatus=$done;completedAt=[DateTime]::UtcNow.ToString('o');documentPresent=$true;arrayVerified=$true;systemCount=0;systems=@();rawSha256=(Get-NoWslHash $text)}
 }finally{if($doc -ne [IntPtr]::Zero){[void][NoWslBoundaryNative]::LocalFree($doc)};[NoWslBoundaryNative]::HcsCloseOperation($op)}
}
function Read-NoWslPid([int]$Target,[switch]$MustBeAbsent){
 $cim=@(Get-CimInstance Win32_Process -Filter "ProcessId=$Target" -ErrorAction Stop)
 if($cim.Count -gt 1){throw 'Duplicate PID'};$handle=[NoWslBoundaryNative]::OpenProcess(0x1000,$false,[uint32]$Target);$errorCode=[Runtime.InteropServices.Marshal]::GetLastWin32Error()
 if($handle -eq [IntPtr]::Zero){if($errorCode -ne 87 -or $cim.Count -ne 0){throw 'Kernel/CIM absence is unproven'};if($MustBeAbsent){return [pscustomobject]@{processId=$Target;cimAbsent=$true;openSucceeded=$false;openError=87}};return [pscustomobject]@{processId=$Target;cimAbsent=$true;openSucceeded=$false;openError=87;cimCreationUtc=$null;nativeCreationFileTime=$null}}
 try{
  if($MustBeAbsent){throw 'Old VM PID exists or is reused'}
  if($cim.Count -ne 1 -or $null -eq $cim[0].CreationDate -or $cim[0].Name -cne 'powershell.exe'){throw 'Selected process identity unknown'}
  $c1=0L;$c2=0L;$e=0L;$k=0L;$u=0L
  if(![NoWslBoundaryNative]::GetProcessTimes($handle,[ref]$c1,[ref]$e,[ref]$k,[ref]$u)){throw 'Selected native birth unavailable'}
  $after=@(Get-CimInstance Win32_Process -Filter "ProcessId=$Target" -ErrorAction Stop)
  if(![NoWslBoundaryNative]::GetProcessTimes($handle,[ref]$c2,[ref]$e,[ref]$k,[ref]$u) -or $c1 -ne $c2 -or $after.Count -ne 1 -or $after[0].CreationDate -ne $cim[0].CreationDate -or $after[0].Name -cne $cim[0].Name){throw 'Selected process changed'}
  $utc=$cim[0].CreationDate.ToUniversalTime().ToString('o')
  if($c1 -ne 134357214785673015L -or $utc -cne '2026-10-06T00:51:18.5673010Z'){throw 'Selected PID reused or bound instance changed'}
  return [pscustomobject]@{processId=$Target;cimAbsent=$false;openSucceeded=$true;openError=$null;cimCreationUtc=$utc;nativeCreationFileTime=$c1.ToString();identityStable=$true}
 }finally{[void][NoWslBoundaryNative]::CloseHandle($handle)}
}
$startedAt=[DateTime]::UtcNow.ToString('o')
$vmRows=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {$_.Name -match '^(vmmem|vmwp(\.exe)?$)'} | Select-Object ProcessId,Name)
if($vmRows.Count -ne 0){throw 'A VM process is still present'}
$old=Read-NoWslPid 53880 -MustBeAbsent
$selected=Read-NoWslPid 47936
$nativeCompletedAt=[DateTime]::UtcNow.ToString('o')
$hcs=Read-NoWslHcs
[pscustomobject]@{version='fixed-no-running-wsl-boundary-v1';sid=$actor.User.Value;administrator=$true;startedAt=$startedAt;nativeCompletedAt=$nativeCompletedAt;at=[DateTime]::UtcNow.ToString('o');hcs=$hcs;vmNameRows=$vmRows;oldVm=$old;selected=$selected;productionActions=0;debugPrivilegeEnabled=$false;guestInvocations=0}|ConvertTo-Json -Depth 8 -Compress
