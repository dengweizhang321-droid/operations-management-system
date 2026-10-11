param([ValidateSet('protect','consume')][string]$Mode)
$ErrorActionPreference='Stop'
$hold=$null;$plain=$null
try{
 [Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 if($sid -cne 'S-1-5-21-815909789-107973518-1379257801-1001'){throw 'identity'}
 $inputText=[Console]::In.ReadToEnd();if($inputText.Length -gt 2097152){throw 'size'};$p=$inputText|ConvertFrom-Json
 if($p.nonce -cnotmatch '^[a-f0-9]{32}$'){throw 'nonce'}
 $temp=[IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'Temp'))
 $file=[IO.Path]::GetFullPath((Join-Path $temp ('teruisi-f15d06a-env-'+$p.nonce+'.dpapi')))
 $cursor=$temp;while($cursor){$item=Get-Item -LiteralPath $cursor -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'redirect'};$next=[IO.Path]::GetDirectoryName($cursor);if($next -eq $cursor){break};$cursor=$next}
 Add-Type -AssemblyName System.Security
 Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ExactEnvCipherFile {
 [StructLayout(LayoutKind.Sequential)] public struct Info { public uint Attributes; public uint CreationLow,CreationHigh,AccessLow,AccessHigh,WriteLow,WriteHigh,Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow; }
 [StructLayout(LayoutKind.Sequential)] public struct Basic { public long Creation,Access,Write,Change; public uint Attributes; }
 [StructLayout(LayoutKind.Sequential)] public struct Disposition { [MarshalAs(UnmanagedType.U1)] public bool Delete; }
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetFileInformationByHandle(IntPtr h,out Info info);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetFileInformationByHandleEx(IntPtr h,int cl,out Basic info,uint n);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool SetFileInformationByHandle(IntPtr h,int cl,ref Disposition info,uint n);
 public static string Identity(IntPtr h) { Info i;Basic b;if(!GetFileInformationByHandle(h,out i)||!GetFileInformationByHandleEx(h,0,out b,40)||i.Links!=1)throw new Exception("identity");return String.Join(":",i.Volume,((ulong)i.IndexHigh<<32)|i.IndexLow,i.Links,((ulong)i.SizeHigh<<32)|i.SizeLow,b.Creation,b.Write,b.Change,b.Attributes); }
 public static void DeleteOwned(IntPtr h) { var d=new Disposition{Delete=true};if(!SetFileInformationByHandle(h,4,ref d,1))throw new Exception("delete"); }
}
'@
 function Get-EnvCipherHash([byte[]]$bytes){$s=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($s.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}}
 function Assert-EnvCipherAcl([IO.FileStream]$stream){$acl=$stream.GetAccessControl();if(!$acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $sid){throw 'acl'};$rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]));if($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -cne $sid -or $rules[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or $rules[0].IsInherited -or $rules[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl){throw 'acl'} }
 $entropy=[Text.UTF8Encoding]::new($false).GetBytes('TERUISI-f15d06a-exact-environment-v1:'+$p.nonce)
 if($Mode -ceq 'protect'){
  if($p.environmentJson -isnot [string]){throw 'payload'};$plain=[Text.UTF8Encoding]::new($false).GetBytes($p.environmentJson)
  $cipher=[Security.Cryptography.ProtectedData]::Protect($plain,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  $acl=New-Object Security.AccessControl.FileSecurity;$id=New-Object Security.Principal.SecurityIdentifier($sid);$acl.SetOwner($id);$acl.SetAccessRuleProtection($true,$false);$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($id,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow)))
  $hold=[IO.FileStream]::new($file,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::FullControl,[IO.FileShare]::None,4096,[IO.FileOptions]::None,$acl)
  $hold.Write($cipher,0,$cipher.Length);$hold.Flush($true);$hold.Dispose();$hold=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);Assert-EnvCipherAcl $hold
  $result=[ordered]@{version='teruisi-dpapi-env-cipher-v1';nonce=$p.nonce;path=$file;cipherSha256=(Get-EnvCipherHash $cipher);fileIdentity=[ExactEnvCipherFile]::Identity($hold.SafeFileHandle.DangerousGetHandle());windowsSid=$sid;acl='protected-current-user-only'}
  [Console]::Out.Write(($result|ConvertTo-Json -Compress))
 }else{
  if($p.path -cne $file -or $p.windowsSid -cne $sid -or $p.cipherSha256 -cnotmatch '^[a-f0-9]{64}$' -or $p.fileIdentity -isnot [string]){throw 'binding'}
  $item=Get-Item -LiteralPath $file -Force;if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'file'}
  $rights=[Security.AccessControl.FileSystemRights]([Security.AccessControl.FileSystemRights]::Read -bor [Security.AccessControl.FileSystemRights]::Delete)
  $hold=[IO.FileStream]::new($file,[IO.FileMode]::Open,$rights,[IO.FileShare]::Read,4096,[IO.FileOptions]::None)
  Assert-EnvCipherAcl $hold;$handle=$hold.SafeFileHandle.DangerousGetHandle();if([ExactEnvCipherFile]::Identity($handle) -cne $p.fileIdentity -or $hold.Length -gt 2097152){throw 'identity'}
  $memory=New-Object IO.MemoryStream;try{$hold.CopyTo($memory);$cipher=$memory.ToArray()}finally{$memory.Dispose()}
  if((Get-EnvCipherHash $cipher) -cne $p.cipherSha256){throw 'cipher'}
  try{$plain=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)}finally{
   Assert-EnvCipherAcl $hold;if([ExactEnvCipherFile]::Identity($handle) -cne $p.fileIdentity){throw 'identity'}
   # Delete disposition is set only after exact owned object/hash/ACL checks.
   # Closing removes this held object, never a replacement pathname target.
   [ExactEnvCipherFile]::DeleteOwned($handle)
  }
  $hold.Dispose();$hold=$null
  $stdout=[Console]::OpenStandardOutput();$stdout.Write($plain,0,$plain.Length);$stdout.Flush()
 }
}catch{[Console]::Error.WriteLine('ENV_TRANSPORT_FAILED');exit 1}
finally{if($null -ne $hold){$hold.Dispose()};if($null -ne $plain){[Array]::Clear($plain,0,$plain.Length)}}
