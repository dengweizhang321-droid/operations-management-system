param([switch]$FunctionsOnly)
$ErrorActionPreference='Stop'
if(-not ('RepairFenceFile' -as [type])){Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.IO;
using System.ComponentModel;
using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
public static class RepairFenceFile {
 [StructLayout(LayoutKind.Sequential)] public struct Info { public uint Attributes; public uint CreationLow,CreationHigh,AccessLow,AccessHigh,WriteLow,WriteHigh,Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow; }
 [StructLayout(LayoutKind.Sequential)] public struct Basic { public long Creation,Access,Write,Change; public uint Attributes; }
 [StructLayout(LayoutKind.Sequential)] public struct Disposition { [MarshalAs(UnmanagedType.U1)] public bool Delete; }
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetFileInformationByHandle(IntPtr h,out Info info);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetFileInformationByHandleEx(IntPtr h,int cl,out Basic info,uint n);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool SetFileInformationByHandle(IntPtr h,int cl,ref Disposition info,uint n);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] public static extern uint GetFinalPathNameByHandle(IntPtr h,StringBuilder path,uint length,uint flags);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern SafeFileHandle CreateFile(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
 public static FileStream OpenReadDelete(string path) { var h=CreateFile(path,0x80010000,1,IntPtr.Zero,3,0x00200080,IntPtr.Zero);if(h.IsInvalid){int error=Marshal.GetLastWin32Error();h.Dispose();throw new Win32Exception(error);}try{return new FileStream(h,FileAccess.Read,4096,false);}catch{h.Dispose();throw;} }
 public static string Identity(IntPtr h) { Info i;Basic b;if(!GetFileInformationByHandle(h,out i)||!GetFileInformationByHandleEx(h,0,out b,40)||i.Links!=1||(i.Attributes&0x400)!=0)throw new Exception("identity");return String.Join(":",i.Volume,((ulong)i.IndexHigh<<32)|i.IndexLow,i.Links,((ulong)i.SizeHigh<<32)|i.SizeLow,b.Creation,b.Write,b.Change,b.Attributes); }
 public static void DeleteOwned(IntPtr h) { var d=new Disposition{Delete=true};if(!SetFileInformationByHandle(h,4,ref d,1))throw new Exception("delete"); }
}
'@}
function Get-RepairFileHash([byte[]]$Bytes){$sha=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}
function Remove-ExactOwnedRepairMarker([string]$Path,[string]$ExpectedSha256){
 if($ExpectedSha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'Expected hash required'}
 $absolute=[IO.Path]::GetFullPath($Path);$cursor=$absolute
 while($cursor){$item=Get-Item -LiteralPath $cursor -Force;if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Redirected marker'};$next=[IO.Path]::GetDirectoryName($cursor);if($next -eq $cursor){break};$cursor=$next}
 $hold=[RepairFenceFile]::OpenReadDelete($absolute)
 try{
  $handle=$hold.SafeFileHandle.DangerousGetHandle();$identity=[RepairFenceFile]::Identity($handle)
  if($hold.Length -gt 4096){throw 'Marker too large'}
  $resolved=[Text.StringBuilder]::new(32768);$n=[RepairFenceFile]::GetFinalPathNameByHandle($handle,$resolved,32768,0)
  if($n -eq 0 -or $n -ge 32768){throw 'Handle path unavailable'}
  $actual=$resolved.ToString();if($actual.StartsWith('\\?\')){$actual=$actual.Substring(4)}
  if(-not $actual.Equals($absolute,[StringComparison]::OrdinalIgnoreCase)){throw 'Handle path mismatch'}
  $bytes=[byte[]]::new([int]$hold.Length);$read=0;while($read -lt $bytes.Length){$count=$hold.Read($bytes,$read,$bytes.Length-$read);if($count -eq 0){throw 'Incomplete marker'};$read+=$count}
  if((Get-RepairFileHash $bytes) -cne $ExpectedSha256 -or [RepairFenceFile]::Identity($handle) -cne $identity){throw 'Exact marker changed'}
  [RepairFenceFile]::DeleteOwned($handle)
  return [pscustomobject]@{markerSha256=$ExpectedSha256;fileIdentity=$identity;deleteDispositionSet=$true}
 }finally{$hold.Dispose()}
}
if($FunctionsOnly){return}
$actor=[Security.Principal.WindowsIdentity]::GetCurrent()
if($actor.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not ([Security.Principal.WindowsPrincipal]::new($actor)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Approved administrator required'}
$result=Remove-ExactOwnedRepairMarker 'D:\teruisi-runtime\django-sales\run\system-maintenance.json' '8cd56417937b8f8fbb82f7404dc52d8d7fd38aa4256e0c0b46d6b65344873572'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
[pscustomobject]@{version='exact-repair-fence-removal-v1';sid=$actor.User.Value;administrator=$true;result=$result;observedAt=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 4 -Compress
