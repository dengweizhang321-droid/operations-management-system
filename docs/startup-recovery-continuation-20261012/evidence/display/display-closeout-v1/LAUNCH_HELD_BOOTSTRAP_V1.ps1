$ErrorActionPreference='Stop'
$bindingPath=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('RTpcY29kZXgtYXJ0aWZhY3RzXHN0YXJ0dXAtcmVjb3ZlcnktY29udGludWF0aW9uLTIwMjYxMDEyXGRpc3BsYXktY2xvc2VvdXQtdjFcVFJBTlNQT1JUX0JJTkRJTkcuanNvbg=='))
Add-Type -TypeDefinition @'
using System;using System.Text;using System.Runtime.InteropServices;using Microsoft.Win32.SafeHandles;
namespace Teruisi {public static class RecoveryLaunchFile {
 [StructLayout(LayoutKind.Sequential)] public struct Info {public uint attributes,creationLow,creationHigh,accessLow,accessHigh,writeLow,writeHigh,volume,sizeHigh,sizeLow,links,indexHigh,indexLow;}
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info i);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle h,StringBuilder text,uint size,uint flags);
 public static string Identity(SafeFileHandle h){Info i;if(!GetFileInformationByHandle(h,out i))throw new System.ComponentModel.Win32Exception();var s=new StringBuilder(32768);uint n=GetFinalPathNameByHandle(h,s,32768,0);if(n==0||n>=32768)throw new System.ComponentModel.Win32Exception();return i.volume+":"+i.indexHigh+":"+i.indexLow+":"+i.links+":"+i.sizeHigh+":"+i.sizeLow+":"+i.creationHigh+":"+i.creationLow+":"+i.writeHigh+":"+i.writeLow+"|"+s.ToString();}
}}
'@
function Assert-RecoveryTransportPhysical([string]$Path){
 $full=[IO.Path]::GetFullPath($Path)
 for($q=$full;$q;$q=[IO.Path]::GetDirectoryName($q)){
  if((Get-Item -LiteralPath $q -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse path rejected'}
 }
}
function Get-RecoveryTransportHash([IO.Stream]$Stream){$s=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($s.ComputeHash($Stream))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}}
function Assert-RecoveryHeldFile([IO.FileStream]$Stream,[string]$Path,[string]$Hash){
 $identity=[Teruisi.RecoveryLaunchFile]::Identity($Stream.SafeFileHandle);$parts=$identity.Split('|');$canonical=$parts[1]
 if($canonical.StartsWith('\\?\')){$canonical=$canonical.Substring(4)}
 if($canonical -ine [IO.Path]::GetFullPath($Path)){throw 'Physical path alias rejected'}
 $expectedLinks=1
 if([IO.Path]::GetFullPath($Path) -ieq 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'){
  if($Hash -cne '7600ffe12da441fe89d035b13801e8e91d064bc544a27b19a5cf49f6ab8b18f5'){throw 'System PowerShell binding changed'};$expectedLinks=2
 }
 if([uint32]$parts[0].Split(':')[3] -ne $expectedLinks){throw 'Unexpected hardlink count'}
 $Stream.Position=0;if((Get-RecoveryTransportHash $Stream) -cne $Hash){throw 'Held bytes changed'}
 if([Teruisi.RecoveryLaunchFile]::Identity($Stream.SafeFileHandle) -cne $identity){throw 'Held identity changed'}
 return $identity
}
$path='E:\codex-artifacts\startup-recovery-continuation-20261012\display-closeout-v1\BOOTSTRAP.ps1'
$who=[Security.Principal.WindowsIdentity]::GetCurrent()
if($who.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not ([Security.Principal.WindowsPrincipal]::new($who)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Exact administrator required'}
for($q=$path;$q;$q=[IO.Path]::GetDirectoryName($q)){if((Get-Item -LiteralPath $q -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Redirected bootstrap rejected'}}
$hold=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try{
 $identityBefore=Assert-RecoveryHeldFile $hold $path '94af72d8bc6a6f1cfb563d6c48f24aa670c1db464415d3cefbe6631b5b3ae403'
 $hold.Position=0;$reader=[IO.StreamReader]::new($hold,[Text.UTF8Encoding]::new($false,$true),$false,4096,$true)
 try{$text=$reader.ReadToEnd()}finally{$reader.Dispose()}
 if($text -match '[^\x00-\x7f]'){throw 'Expected ASCII bootstrap'}
 if([Teruisi.RecoveryLaunchFile]::Identity($hold.SafeFileHandle) -cne $identityBefore){throw 'Held bootstrap identity changed'}
 & ([scriptblock]::Create($text))
}finally{$hold.Dispose()}
