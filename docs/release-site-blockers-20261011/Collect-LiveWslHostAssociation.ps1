param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
if([IntPtr]::Size -ne 8){throw 'Reviewed x64 host required'}
if(Test-Path -LiteralPath $OutputPath){throw 'Create-only metadata'}
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ReleaseWslHostQuery {
 [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr OpenProcess(uint a,bool inherit,uint pid);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetProcessTimes(IntPtr h,out long c,out long e,out long k,out long u);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr h,uint flags,StringBuilder b,ref uint n);
 [DllImport("ntdll.dll")] public static extern int NtQueryInformationProcess(IntPtr h,int cl,IntPtr b,uint n,out uint required);
 [DllImport("computecore.dll",ExactSpelling=true)] public static extern IntPtr HcsCreateOperation(IntPtr context,IntPtr callback);
 [DllImport("computecore.dll",ExactSpelling=true,CharSet=CharSet.Unicode)] public static extern int HcsEnumerateComputeSystems(string query,IntPtr operation);
 [DllImport("computecore.dll",ExactSpelling=true)] public static extern int HcsWaitForOperationResult(IntPtr operation,uint timeout,out IntPtr result);
 [DllImport("computecore.dll",ExactSpelling=true)] public static extern void HcsCloseOperation(IntPtr operation);
 [DllImport("kernel32.dll",ExactSpelling=true)] public static extern IntPtr LocalFree(IntPtr data);
 public static string Command(IntPtr h,out int status){
  uint n;status=NtQueryInformationProcess(h,60,IntPtr.Zero,0,out n);
  if(n<16||n>65536+64)return null;
  IntPtr b=Marshal.AllocHGlobal((int)n);
  try{uint allocated=n;status=NtQueryInformationProcess(h,60,b,allocated,out n);
   if(status!=0||n<16||n>allocated)return null;
   int length=(ushort)Marshal.ReadInt16(b),maximum=(ushort)Marshal.ReadInt16(b,2);
   long p=Marshal.ReadIntPtr(b,8).ToInt64(),start=b.ToInt64();
   if(length%2!=0||maximum%2!=0||length>maximum||p%2!=0||p<start+16||p-start>allocated||maximum>allocated-(p-start)){status=unchecked((int)0xC000000D);return null;}
   string v=Marshal.PtrToStringUni(new IntPtr(p),length/2);return String.IsNullOrWhiteSpace(v)?null:v;
  }finally{Marshal.FreeHGlobal(b);}
 }
}
'@
function Get-HostAssociationHash([byte[]]$Bytes){$s=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($s.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}}
function Read-HcsAssociationMetadata {
 $op=[ReleaseWslHostQuery]::HcsCreateOperation([IntPtr]::Zero,[IntPtr]::Zero)
 if($op -eq [IntPtr]::Zero){throw 'HCS query handle allocation failed'}
 $doc=[IntPtr]::Zero;$done=$null;$systems=@()
 try{
  $start=[ReleaseWslHostQuery]::HcsEnumerateComputeSystems($null,$op)
  if($start -eq 0){$done=[ReleaseWslHostQuery]::HcsWaitForOperationResult($op,10000,[ref]$doc)}
  if($done -eq 0 -and $doc -ne [IntPtr]::Zero){
   $text=[Runtime.InteropServices.Marshal]::PtrToStringUni($doc)
   if($text.Length -gt 4194304 -or !$text.TrimStart().StartsWith('[')){throw 'HCS query shape/size rejected'}
   foreach($system in @($text|ConvertFrom-Json)){
    if($system.Owner -ceq 'WSL'){$systems+=[ordered]@{id=$system.Id;runtimeId=$system.RuntimeId;owner=$system.Owner;state=$system.State;systemType=$system.SystemType;runtimeOsType=$system.RuntimeOsType}}
   }
  }
  return [pscustomobject]@{startStatus=$start;completionStatus=$done;wslSystems=$systems}
 }finally{if($doc -ne [IntPtr]::Zero){[void][ReleaseWslHostQuery]::LocalFree($doc)};[ReleaseWslHostQuery]::HcsCloseOperation($op)}
}
function Assert-HostAssociationImagePath([string]$Path){$c=[IO.Path]::GetFullPath($Path);while($c){$item=Get-Item -LiteralPath $c -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Redirected system image'};$parent=[IO.Path]::GetDirectoryName($c);if($parent -eq $c){break};$c=$parent}}
$firstHcs=Read-HcsAssociationMetadata
$before=Get-CimInstance Win32_Process -Filter 'ProcessId=53880'
$parentBefore=Get-CimInstance Win32_Process -Filter 'ProcessId=7788'
$record=[ordered]@{status='unproven';vmmemProcessId=53880;vmmemCreationFileTime=$null;parentProcessId=7788;parentCreationFileTime=$null;parentCimCreationUtc=$null;accessMask='0x1000';vmmemOpenError=$null;parentOpenError=$null;imagePath=$null;imageSha256=$null;signatureStatus=$null;signerSubject=$null;commandStatusFirst=$null;commandStatusSecond=$null;commandSha256=$null;commandArgumentShape=@();runtimeGuidCandidates=@();identityStable=$false;hcsBefore=$firstHcs;hcsAfter=$null;matchingRuntimeIds=@();failure=$null}
$vm=[IntPtr]::Zero;$parent=[IntPtr]::Zero;$imageFile=$null
try{
 if($null -eq $before -or $null -eq $before.CreationDate -or $before.Name -cne 'vmmemWSL' -or $before.SessionId -ne 0 -or $before.ParentProcessId -ne 7788){throw 'Bound host relationship changed'}
 if($null -eq $parentBefore -or $null -eq $parentBefore.CreationDate -or $parentBefore.Name -cne 'vmwp.exe' -or $parentBefore.SessionId -ne 0 -or $parentBefore.CreationDate.ToUniversalTime().ToString('o') -cne '2026-10-10T06:24:56.4681900Z'){throw 'Bound parent instance changed'}
 $vm=[ReleaseWslHostQuery]::OpenProcess(0x1000,$false,53880);if($vm -eq [IntPtr]::Zero){$record.vmmemOpenError=[Runtime.InteropServices.Marshal]::GetLastWin32Error();throw 'vmmem handle unavailable'}
 $parent=[ReleaseWslHostQuery]::OpenProcess(0x1000,$false,7788);if($parent -eq [IntPtr]::Zero){$record.parentOpenError=[Runtime.InteropServices.Marshal]::GetLastWin32Error();throw 'parent handle unavailable'}
 $v1=0L;$v2=0L;$p1=0L;$p2=0L;$e=0L;$k=0L;$u=0L
 if(![ReleaseWslHostQuery]::GetProcessTimes($vm,[ref]$v1,[ref]$e,[ref]$k,[ref]$u) -or $v1 -ne 134360870965622198L){throw 'vmmem birth not exact bound instance'}
 if([Math]::Floor([decimal]$v1/10) -ne [Math]::Floor([decimal]$before.CreationDate.ToUniversalTime().ToFileTimeUtc()/10)){throw 'vmmem native/CIM birth inconsistent'}
 if(![ReleaseWslHostQuery]::GetProcessTimes($parent,[ref]$p1,[ref]$e,[ref]$k,[ref]$u) -or [Math]::Floor([decimal]$p1/10) -ne [Math]::Floor([decimal]$parentBefore.CreationDate.ToUniversalTime().ToFileTimeUtc()/10)){throw 'parent birth inconsistent'}
 if($p1 -ne 134360870964681909L){throw 'Parent native birth differs from exact reviewed instance'}
 $record.vmmemCreationFileTime=$v1.ToString();$record.parentCreationFileTime=$p1.ToString();$record.parentCimCreationUtc=$parentBefore.CreationDate.ToUniversalTime().ToString('o')
 $b=[Text.StringBuilder]::new(32768);$n=[uint32]32768
 if(![ReleaseWslHostQuery]::QueryFullProcessImageName($parent,0,$b,[ref]$n) -or ![string]::Equals($b.ToString(),'C:\Windows\System32\vmwp.exe',[StringComparison]::OrdinalIgnoreCase)){throw 'Actual parent image is not permitted System32 binary'}
 $record.imagePath=$b.ToString();Assert-HostAssociationImagePath $record.imagePath
 $imageFile=[IO.File]::Open($record.imagePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
 $s=[Security.Cryptography.SHA256]::Create();try{$record.imageSha256=([BitConverter]::ToString($s.ComputeHash($imageFile))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}
 if($record.imageSha256 -cne '62814079cc5a896142fc28d1084b7c22e97b4e35d3816b4e45f51c5bb0a88b7c'){throw 'Parent system file bytes changed'}
 $signature=Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $record.imagePath
 $record.signatureStatus=[string]$signature.Status;$record.signerSubject=$signature.SignerCertificate.Subject
 if($record.signatureStatus -cne 'Valid' -or $record.signerSubject -cne 'CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US'){throw 'Parent signature not exact reviewed Windows signer'}
 $s1=0;$s2=0;$cmd1=[ReleaseWslHostQuery]::Command($parent,[ref]$s1);$cmd2=[ReleaseWslHostQuery]::Command($parent,[ref]$s2)
 $record.commandStatusFirst=$s1;$record.commandStatusSecond=$s2
 if($s1 -ne 0 -or $s2 -ne 0 -or $null -eq $cmd1 -or $cmd1 -cne $cmd2){throw 'Parent command metadata not stable/readable'}
 $record.commandSha256=Get-HostAssociationHash ([Text.Encoding]::UTF8.GetBytes($cmd1))
 $record.runtimeGuidCandidates=@([regex]::Matches($cmd1,'(?i)(?<![a-f0-9])[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?![a-f0-9])')|ForEach-Object{$_.Value.ToLowerInvariant()}|Select-Object -Unique)
 foreach($token in @([regex]::Matches($cmd1,'"[^"\r\n]*"|[^\s"\r\n]+'))){
  $value=$token.Value.Trim('"');$kind=if($value -match '^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$'){'guid'}elseif($value -match '^[A-Za-z]:[\\/]'){'absolute-drive-path'}elseif($value -match '^S-1-[0-9-]+$'){'windows-sid'}elseif($value -match '^\d+$'){'integer'}else{'opaque'}
  $record.commandArgumentShape+=[pscustomobject]@{kind=$kind;sha256=(Get-HostAssociationHash ([Text.Encoding]::UTF8.GetBytes($value)))}
 }
 if($record.commandSha256 -cne '37bc785ae86d5554ea64eeaa5afff05538d6ec48d3008d70c3aea62242b8d396'){throw 'Parent command bytes differ from reviewed shape'}
 if($record.runtimeGuidCandidates.Count -ne 1 -or $record.runtimeGuidCandidates[0] -cne '3aaab424-3094-4bb0-a07a-652f47171ad7'){throw 'Parent runtime GUID is not the exact reviewed one'}
 $expectedKinds=@('absolute-drive-path','guid','opaque')
 $expectedHashes=@('12a1cbda27acdc5c1d6950e8dfd62f904c7f0567085ea28f78a14cfad77f4414','3a1a7e7084e0217a11bda844855c183f8830920a56f9547bfe4f95f7555b8250','333516b481e0554d0c7cc6f85bf22c2a1fedbc578718df354546e335913f1f1f')
 if($record.commandArgumentShape.Count -ne 3){throw 'Unexpected parent argument count'}
 for($argumentIndex=0;$argumentIndex -lt 3;$argumentIndex++){if($record.commandArgumentShape[$argumentIndex].kind -cne $expectedKinds[$argumentIndex] -or $record.commandArgumentShape[$argumentIndex].sha256 -cne $expectedHashes[$argumentIndex]){throw 'Unexpected parent argument shape'}}
 $record.hcsAfter=Read-HcsAssociationMetadata
 # Capture final instance evidence before interpreting optional HCS fields.
 # Unexpected/unsupported HCS shapes remain unproven with complete diagnostics.
 $after=Get-CimInstance Win32_Process -Filter 'ProcessId=53880';$parentAfter=Get-CimInstance Win32_Process -Filter 'ProcessId=7788'
 $record.identityStable=[ReleaseWslHostQuery]::GetProcessTimes($vm,[ref]$v2,[ref]$e,[ref]$k,[ref]$u) -and [ReleaseWslHostQuery]::GetProcessTimes($parent,[ref]$p2,[ref]$e,[ref]$k,[ref]$u) -and $v1 -eq $v2 -and $p1 -eq $p2 -and $null -ne $after.CreationDate -and $after.CreationDate -eq $before.CreationDate -and $after.Name -ceq $before.Name -and $after.SessionId -eq $before.SessionId -and $after.ParentProcessId -eq 7788 -and $null -ne $parentAfter.CreationDate -and $parentAfter.CreationDate -eq $parentBefore.CreationDate -and $parentAfter.Name -ceq $parentBefore.Name -and $parentAfter.SessionId -eq $parentBefore.SessionId
 if(!$record.identityStable){throw 'Host instance changed during HCS capture'}
 Assert-HostAssociationImagePath $record.imagePath
 if($firstHcs.startStatus -ne 0 -or $firstHcs.completionStatus -ne 0 -or $record.hcsAfter.startStatus -ne 0 -or $record.hcsAfter.completionStatus -ne 0){throw 'HCS enumeration did not complete successfully'}
 $beforeIds=@($firstHcs.wslSystems|ForEach-Object{([string]$_.runtimeId).ToLowerInvariant()}|Sort-Object)
 $afterIds=@($record.hcsAfter.wslSystems|ForEach-Object{([string]$_.runtimeId).ToLowerInvariant()}|Sort-Object)
 if($beforeIds.Count -ne 1 -or $afterIds.Count -ne 1 -or $beforeIds[0] -cne $afterIds[0]){throw 'WSL HCS identity inventory changed or is not uniquely supported'}
 foreach($system in @($firstHcs.wslSystems)+@($record.hcsAfter.wslSystems)){
  if($system.id -cne '3AAAB424-3094-4BB0-A07A-652F47171AD7' -or $system.runtimeId -cne '3aaab424-3094-4bb0-a07a-652f47171ad7' -or $system.owner -cne 'WSL' -or $system.state -cne 'Running' -or $system.systemType -cne 'VirtualMachine' -or $null -ne $system.runtimeOsType){throw 'HCS WSL record is outside the exact observed nullable-field shape'}
 }
 if(($firstHcs.wslSystems[0]|ConvertTo-Json -Compress) -cne ($record.hcsAfter.wslSystems[0]|ConvertTo-Json -Compress)){throw 'HCS ownership/state record changed'}
 if($record.runtimeGuidCandidates -cnotcontains $beforeIds[0]){throw 'HCS RuntimeId not in exact parent command metadata'}
 $record.matchingRuntimeIds=$beforeIds
 $record.status='association-metadata-collected-not-admission'
}catch{$record.failure=$_.Exception.Message}
finally{if($null -ne $imageFile){$imageFile.Dispose()};if($parent -ne [IntPtr]::Zero){[void][ReleaseWslHostQuery]::CloseHandle($parent)};if($vm -ne [IntPtr]::Zero){[void][ReleaseWslHostQuery]::CloseHandle($vm)}}
$result=[ordered]@{version='teruisi-live-wsl-host-association-v1';at=[DateTimeOffset]::UtcNow.ToString('o');record=$record;rawCommandPersisted=$false;debugPrivilegesEnabled=$false;remoteMemoryReads=0;productionActionsRequested=0;scope='Live exact-instance HCS association: two existing-system enumerations and two fixed 0x1000 process metadata handles; one exact System32 file hash/signature. No VM lifecycle, business filesystem or batch actions. Audit output only. Null HCS runtimeOsType is accepted only in the exact reviewed record; Linux/guest epoch must be separately verified.'}
$json=$result|ConvertTo-Json -Depth 8
$stream=[IO.File]::Open($OutputPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes($json+[Environment]::NewLine);$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
$json
