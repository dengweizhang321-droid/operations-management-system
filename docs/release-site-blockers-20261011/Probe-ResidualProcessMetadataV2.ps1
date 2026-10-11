param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
if([IntPtr]::Size -ne 8){throw 'Only reviewed x64 layout is supported'}
if(Test-Path -LiteralPath $OutputPath){throw 'Evidence is create-only'}
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ReleaseResidualMetadata {
 [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetProcessTimes(IntPtr h,out long c,out long e,out long k,out long u);
 [DllImport("ntdll.dll")] public static extern int NtQueryInformationProcess(IntPtr h,int cl,IntPtr b,uint n,out uint returned);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetProcessInformation(IntPtr h,int cl,out uint info,uint size);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr h,uint flags,StringBuilder image,ref uint size);
 public static string StatusHex(int status){return unchecked((uint)status).ToString("x8");}
}
'@
$baselinePath='E:\codex-artifacts\release-site-blockers-20261011\ADMIN_REFERENCE_DIAGNOSTIC_V1.json'
$baselineRaw=[IO.File]::ReadAllBytes($baselinePath)
$algorithm=[Security.Cryptography.SHA256]::Create()
try{$baselineSha=([BitConverter]::ToString($algorithm.ComputeHash($baselineRaw))).Replace('-','').ToLowerInvariant()}finally{$algorithm.Dispose()}
if($baselineSha -cne '4e964f0ec062f07115728dc5cb09ec05a3a794a09a29f865494927dd8b3dbd69'){throw 'Baseline diagnostic drift'}
$baseline=[Text.Encoding]::UTF8.GetString($baselineRaw)|ConvertFrom-Json
function Assert-RegularPhysicalFile([string]$Path){
 $cursor=[IO.Path]::GetFullPath($Path);$leaf=$true
 while($cursor){
  $item=Get-Item -LiteralPath $cursor -Force
  if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse path rejected'}
  if($leaf -and $item.PSIsContainer){throw 'Image is not a regular file'}
  $leaf=$false;$parent=[IO.Path]::GetDirectoryName($cursor)
  if($parent -eq $cursor){break};$cursor=$parent
 }
}
$records=@()
foreach($taskPid in @(236,280,1700,6548,53880)){
 $prior=@($baseline.unknown|Where-Object {$_.processId -eq $taskPid})
 if($prior.Count -ne 1){throw 'Missing exact baseline PID'}
 $before=Get-CimInstance Win32_Process -Filter "ProcessId=$taskPid"
 $r=[ordered]@{processId=$taskPid;name=$before.Name;sessionId=$before.SessionId;accessMask='0x1000';openError=$null;timeBeforeError=$null;timeAfterError=$null;nativeCreationFileTime=$null;cimCreationUtc=$null;instanceMatchesBaseline=$false;identityStable=$false;ntStatus=$null;ntStatusHex=$null;returnedLength=$null;structureSize=$null;basicProcessId=$null;layoutValid=$false;pebIsNull=$null;flags=$null;flagsHex=$null;isSecureProcess=$null;isProtectedProcess=$null;isSubsystemProcess=$null;unknownFlagBits=$null;protectionSucceeded=$false;protectionError=$null;protectionLevel=$null;protectionLevelHex=$null}
 $h=[ReleaseResidualMetadata]::OpenProcess(0x1000,$false,[uint32]$taskPid)
 $buffer=[IntPtr]::Zero
 try{
  if($h -eq [IntPtr]::Zero){$r.openError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
  else{
   $c1=0L;$c2=0L;$e=0L;$k=0L;$u=0L
   $t1=[ReleaseResidualMetadata]::GetProcessTimes($h,[ref]$c1,[ref]$e,[ref]$k,[ref]$u)
   if(!$t1){$r.timeBeforeError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
   $buffer=[Runtime.InteropServices.Marshal]::AllocHGlobal(64)
   for($offset=0;$offset -lt 64;$offset+=8){[Runtime.InteropServices.Marshal]::WriteInt64($buffer,$offset,0L)}
   [Runtime.InteropServices.Marshal]::WriteInt64($buffer,0,64L)
   $returned=[uint32]0;$status=[ReleaseResidualMetadata]::NtQueryInformationProcess($h,0,$buffer,64,[ref]$returned)
   $r.ntStatus=$status;$r.ntStatusHex=[ReleaseResidualMetadata]::StatusHex($status);$r.returnedLength=$returned
   if($status -eq 0){
    $r.structureSize=[Runtime.InteropServices.Marshal]::ReadInt64($buffer,0)
    $r.basicProcessId=[Runtime.InteropServices.Marshal]::ReadInt64($buffer,40)
    $r.layoutValid=$returned -eq 64 -and $r.structureSize -eq 64 -and $r.basicProcessId -eq $taskPid
    if($r.layoutValid){
     $r.pebIsNull=[Runtime.InteropServices.Marshal]::ReadInt64($buffer,16) -eq 0
     $flags=[BitConverter]::ToUInt32([BitConverter]::GetBytes([Runtime.InteropServices.Marshal]::ReadInt32($buffer,56)),0)
     $r.flags=$flags;$r.flagsHex=$flags.ToString('x8');$r.isSecureProcess=($flags -band 128) -ne 0;$r.isProtectedProcess=($flags -band 1) -ne 0;$r.isSubsystemProcess=($flags -band 256) -ne 0;$r.unknownFlagBits=$flags -band [uint32]4294966784
    }
   }
   $level=[uint32]0;$r.protectionSucceeded=[ReleaseResidualMetadata]::GetProcessInformation($h,7,[ref]$level,4)
   if($r.protectionSucceeded){$r.protectionLevel=$level;$r.protectionLevelHex=$level.ToString('x8')}else{$r.protectionError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
   $t2=[ReleaseResidualMetadata]::GetProcessTimes($h,[ref]$c2,[ref]$e,[ref]$k,[ref]$u)
   if(!$t2){$r.timeAfterError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
   $after=Get-CimInstance Win32_Process -Filter "ProcessId=$taskPid"
   if($t1){$r.nativeCreationFileTime=$c1.ToString([Globalization.CultureInfo]::InvariantCulture)}
   if($null -ne $before.CreationDate){$r.cimCreationUtc=$before.CreationDate.ToUniversalTime().ToString('o')}
   $r.instanceMatchesBaseline=$t1 -and $c1 -eq [long]$prior[0].nativeCreationFileTime
   $r.identityStable=$t1 -and $t2 -and $c1 -eq $c2 -and $null -ne $before -and $null -ne $after -and $null -ne $before.CreationDate -and $null -ne $after.CreationDate -and $before.CreationDate -eq $after.CreationDate -and $before.Name -ceq $after.Name -and $before.SessionId -eq $after.SessionId -and [Math]::Floor([decimal]$c1/10) -eq [Math]::Floor([decimal]$before.CreationDate.ToUniversalTime().ToFileTimeUtc()/10)
   if($taskPid -eq 1700 -or $taskPid -eq 6548){
    $expectedImage=if($taskPid -eq 1700){'C:\Windows\System32\LsaIso.exe'}else{'C:\Windows\System32\NgcIso.exe'}
    $imageRecord=[ordered]@{status='unproven';expectedPath=$expectedImage;actualPath=$null;queryError=$null;sha256=$null;signatureStatus=$null;signerSubject=$null;signerThumbprint=$null;signerIssuer=$null;postIdentityStable=$false;failure=$null}
    $r.imageEvidence=$imageRecord
    $imageFile=$null
    try{
     if(!$r.instanceMatchesBaseline -or !$r.identityStable){throw 'Instance does not match bound baseline'}
     $imageBuffer=[Text.StringBuilder]::new(32768);$imageSize=[uint32]32768
     if(![ReleaseResidualMetadata]::QueryFullProcessImageName($h,0,$imageBuffer,[ref]$imageSize)){$imageRecord.queryError=[Runtime.InteropServices.Marshal]::GetLastWin32Error();throw 'Image query failed'}
     $imageRecord.actualPath=$imageBuffer.ToString()
     if(![string]::Equals($imageRecord.actualPath,$expectedImage,[StringComparison]::OrdinalIgnoreCase)){throw 'Image is not the exact permitted system file'}
     Assert-RegularPhysicalFile $expectedImage
     $imageFile=[IO.File]::Open($expectedImage,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
     Assert-RegularPhysicalFile $expectedImage
     $imageHasher=[Security.Cryptography.SHA256]::Create()
     try{$imageRecord.sha256=([BitConverter]::ToString($imageHasher.ComputeHash($imageFile))).Replace('-','').ToLowerInvariant()}finally{$imageHasher.Dispose()}
     $signature=Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $expectedImage
     $imageRecord.signatureStatus=[string]$signature.Status
     if($null -ne $signature.SignerCertificate){$imageRecord.signerSubject=$signature.SignerCertificate.Subject;$imageRecord.signerThumbprint=$signature.SignerCertificate.Thumbprint;$imageRecord.signerIssuer=$signature.SignerCertificate.Issuer}
     Assert-RegularPhysicalFile $expectedImage
     $imageAfter=[Text.StringBuilder]::new(32768);$afterSize=[uint32]32768;$c3=0L
     $imageStill=[ReleaseResidualMetadata]::QueryFullProcessImageName($h,0,$imageAfter,[ref]$afterSize)
     if(!$imageStill){$imageRecord.queryError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
     $timeStill=[ReleaseResidualMetadata]::GetProcessTimes($h,[ref]$c3,[ref]$e,[ref]$k,[ref]$u)
     $cimStill=Get-CimInstance Win32_Process -Filter "ProcessId=$taskPid"
     $imageRecord.postIdentityStable=$imageStill -and $timeStill -and $c3 -eq $c1 -and [string]::Equals($imageAfter.ToString(),$expectedImage,[StringComparison]::OrdinalIgnoreCase) -and $null -ne $cimStill.CreationDate -and $cimStill.CreationDate -eq $before.CreationDate -and $cimStill.Name -ceq $before.Name -and $cimStill.SessionId -eq $before.SessionId
     if(!$imageRecord.postIdentityStable){throw 'Image instance changed during metadata capture'}
     if($imageRecord.signatureStatus -cne 'Valid'){throw 'Signature not reported Valid'}
     $imageRecord.status='metadata-collected-not-admission'
    }catch{$imageRecord.failure=$_.Exception.Message}
    finally{if($null -ne $imageFile){$imageFile.Dispose()}}
   }
  }
 }finally{if($buffer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)};if($h -ne [IntPtr]::Zero){[void][ReleaseResidualMetadata]::CloseHandle($h)}}
 $records+=$r
}
$result=[ordered]@{version='astra-residual-process-metadata-v2';at=[DateTimeOffset]::UtcNow.ToString('o');baselineSha256=$baselineSha;hostVersion=$PSVersionTable.PSVersion.ToString();isAdministrator=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);records=$records;debugPrivilegeEnabledByProbe=$false;readProcessMemoryCalls=0;productionActions=0;scope='Five fixed PIDs, only 0x1000 query access. Only PID1700/6548 with bound birth and exact System32 image may hash/signature-query that file under a read handle denying write/delete sharing. Extended-basic x64 layout follows Microsoft IUM/WDK example; flags/signature do not grant process-type exemption or admission. No raw pointers persisted; platform certificate validation may follow system trust/revocation configuration.'}
$json=$result|ConvertTo-Json -Depth 7
$stream=[IO.File]::Open($OutputPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes($json+[Environment]::NewLine);$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
$json
