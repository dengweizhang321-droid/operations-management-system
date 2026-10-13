param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
if([IntPtr]::Size -ne 8){throw 'Diagnostic requires a 64-bit host'}
if(Test-Path -LiteralPath $OutputPath){throw 'Evidence is create-only'}
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ReleaseSiteIdentityV1 {
 [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetProcessTimes(IntPtr h,out long c,out long e,out long k,out long u);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr h,out uint exitCode);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr h,uint flags,StringBuilder b,ref uint n);
 [DllImport("ntdll.dll")] public static extern int NtQueryInformationProcess(IntPtr h,int cl,IntPtr b,uint n,out uint required);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool IsWow64Process(IntPtr h,out bool wow);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool ReadProcessMemory(IntPtr h,IntPtr address,byte[] buffer,IntPtr size,out IntPtr read);
 public static bool SameCreation(long native,long cim){return native/10==cim/10;}
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
 static byte[] Read(IntPtr h,long address,int length){
  if(address<65536||length<0||length>65536||address>0x7fffffffffffL-length)throw new InvalidOperationException("Invalid metadata address");
  byte[] bytes=new byte[length];IntPtr read;
  if(!ReadProcessMemory(h,new IntPtr(address),bytes,new IntPtr(length),out read)||read.ToInt64()!=length)throw new InvalidOperationException("Metadata unreadable");
  return bytes;
 }
 static string Text(IntPtr h,byte[] header,int offset){
  int length=BitConverter.ToUInt16(header,offset),maximum=BitConverter.ToUInt16(header,offset+2);long address=BitConverter.ToInt64(header,offset+8);
  if(length%2!=0||maximum%2!=0||length>maximum||maximum>65534)throw new InvalidOperationException("Unsupported string layout");
  return Encoding.Unicode.GetString(Read(h,address,length));
 }
 public static string CurrentDirectoryMetadata(IntPtr h,uint pid,out string failure){
  failure=null;IntPtr basic=IntPtr.Zero;
  try{
   bool wow;if(!IsWow64Process(h,out wow)||wow||IntPtr.Size!=8)throw new InvalidOperationException("Unsupported target architecture");
   basic=Marshal.AllocHGlobal(48);uint returned;
   if(NtQueryInformationProcess(h,0,basic,48,out returned)!=0||returned!=48||Marshal.ReadIntPtr(basic,32).ToInt64()!=pid)throw new InvalidOperationException("Basic process metadata mismatch");
   long peb=Marshal.ReadIntPtr(basic,8).ToInt64(),parameters=BitConverter.ToInt64(Read(h,peb+32,8),0);
   byte[] a=Read(h,parameters,128),b=Read(h,parameters,128);
   string cwdA=Text(h,a,56),cwdB=Text(h,b,56),image=Text(h,b,96),cmd=Text(h,b,112);int status;
   string kernelCmd=Command(h,out status);StringBuilder actualImage=new StringBuilder(32768);uint size=32768;
   if(status!=0||kernelCmd==null||!String.Equals(cmd,kernelCmd,StringComparison.Ordinal)||!QueryFullProcessImageName(h,0,actualImage,ref size)||!String.Equals(image,actualImage.ToString(),StringComparison.OrdinalIgnoreCase)||!String.Equals(cwdA,cwdB,StringComparison.Ordinal)||String.IsNullOrWhiteSpace(cwdB))throw new InvalidOperationException("Process parameter layout or contents changed");
   return cwdB;
  }catch(InvalidOperationException error){failure=error.Message;return null;}
  finally{if(basic!=IntPtr.Zero)Marshal.FreeHGlobal(basic);}
 }
}
'@
function Confirm-LiveProcessDeparture([object]$Original,[string]$OriginalNativeBirth){
 $taskPid=[long]$Original.ProcessId
 $proof=[ordered]@{version='teruisi-kernel-process-departure-v1';processId=$taskPid;kind='unproven';accessMask='0x1000';originalCimCreationUtc=$null;originalNativeCreationFileTime=$OriginalNativeBirth;openError=$null;nativeCreationBefore=$null;nativeCreationAfter=$null;exitQuerySucceeded=$false;exitCode=$null;finalCimState='not-queried';reason=$null}
 $current=$null;$handle=[IntPtr]::Zero
 try{
  if($taskPid -le 4 -or $taskPid -gt 2147483647 -or $null -eq $Original.CreationDate){$proof.reason='original-identity-unavailable';return [pscustomobject]@{proof=$proof;current=$null}}
  $proof.originalCimCreationUtc=$Original.CreationDate.ToUniversalTime().ToString('o')
  $handle=[ReleaseSiteIdentityV1]::OpenProcess(0x1000,$false,[uint32]$taskPid)
  if($handle -eq [IntPtr]::Zero){
   $proof.openError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()
   if($proof.openError -ne 87){$proof.reason='kernel-query-unavailable';return [pscustomobject]@{proof=$proof;current=$null}}
   $current=Get-CimInstance Win32_Process -Filter "ProcessId=$taskPid"
   if($null -eq $current){$proof.finalCimState='absent';$proof.kind='pid-absent';$proof.reason='kernel-invalid-pid-and-cim-absent'}else{$proof.finalCimState='present';$proof.reason='pid-present-after-absence-probe'}
   return [pscustomobject]@{proof=$proof;current=$current}
  }
  $c1=0L;$c2=0L;$e=0L;$k=0L;$u=0L
  if(![ReleaseSiteIdentityV1]::GetProcessTimes($handle,[ref]$c1,[ref]$e,[ref]$k,[ref]$u)){$proof.reason='native-birth-unreadable';return [pscustomobject]@{proof=$proof;current=$null}}
  $proof.nativeCreationBefore=$c1.ToString([Globalization.CultureInfo]::InvariantCulture)
  # An exited handle may be accepted only against an exact previously observed
  # native birth. A CIM-only birth is not silently upgraded to native evidence.
  if($OriginalNativeBirth -notmatch '^[1-9][0-9]+$' -or $proof.nativeCreationBefore -cne $OriginalNativeBirth -or ![ReleaseSiteIdentityV1]::SameCreation($c1,$Original.CreationDate.ToUniversalTime().ToFileTimeUtc())){$proof.reason='original-native-birth-missing-or-changed';return [pscustomobject]@{proof=$proof;current=$null}}
  $code=[uint32]0;$proof.exitQuerySucceeded=[ReleaseSiteIdentityV1]::GetExitCodeProcess($handle,[ref]$code)
  if(!$proof.exitQuerySucceeded){$proof.reason='exit-query-failed';return [pscustomobject]@{proof=$proof;current=$null}}
  $proof.exitCode=$code
  if(![ReleaseSiteIdentityV1]::GetProcessTimes($handle,[ref]$c2,[ref]$e,[ref]$k,[ref]$u)){$proof.reason='final-native-birth-unreadable';return [pscustomobject]@{proof=$proof;current=$null}}
  $proof.nativeCreationAfter=$c2.ToString([Globalization.CultureInfo]::InvariantCulture)
  if($c1 -ne $c2){$proof.reason='native-birth-changed';return [pscustomobject]@{proof=$proof;current=$null}}
  if($code -eq 259){$proof.reason='active-or-ambiguous-exit-259';return [pscustomobject]@{proof=$proof;current=$null}}
  $current=Get-CimInstance Win32_Process -Filter "ProcessId=$taskPid"
  if($null -eq $current){$proof.finalCimState='absent'}elseif($null -ne $current.CreationDate -and $current.CreationDate -eq $Original.CreationDate -and $current.Name -ceq $Original.Name -and $current.SessionId -eq $Original.SessionId){$proof.finalCimState='same-instance'}else{$proof.finalCimState='different-instance';$proof.reason='pid-reused-or-current-instance-changed';return [pscustomobject]@{proof=$proof;current=$current}}
  $proof.kind='same-instance-exited';$proof.reason='successful-kernel-exit-query-non259'
  return [pscustomobject]@{proof=$proof;current=$current}
 }catch{$proof.kind='unproven';$proof.reason='departure-query-error';return [pscustomobject]@{proof=$proof;current=$current}}
 finally{if($handle -ne [IntPtr]::Zero){[void][ReleaseSiteIdentityV1]::CloseHandle($handle)}}
}
function New-LateProcessObservation([object]$Original){
 $latest=Get-CimInstance Win32_Process -Filter "ProcessId=$($Original.ProcessId)"
 $stable=$null -ne $latest -and $null -ne $Original.CreationDate -and $null -ne $latest.CreationDate -and $Original.CreationDate -eq $latest.CreationDate -and $Original.Name -ceq $latest.Name -and $Original.SessionId -eq $latest.SessionId
 $row=[pscustomobject]@{ProcessId=[int]$Original.ProcessId;SessionId=[int]$Original.SessionId;Name=$Original.Name;ExecutablePath=$Original.ExecutablePath;CommandLine=$Original.CommandLine;cimCreationUtc=if($null -ne $Original.CreationDate){$Original.CreationDate.ToUniversalTime().ToString('o')}else{$null};identityStable=$stable;lateObservation=$true;departureProof=$null}
 if(!$stable){$departure=Confirm-LiveProcessDeparture $Original ''; $row.departureProof=$departure.proof;if($null -ne $latest){$row.Name=$latest.Name;$row.SessionId=[int]$latest.SessionId;$row.ExecutablePath=$latest.ExecutablePath;$row.CommandLine=$latest.CommandLine;$row.cimCreationUtc=if($null -ne $latest.CreationDate){$latest.CreationDate.ToUniversalTime().ToString('o')}else{$null}}}
 return $row
}
$before=@(Get-CimInstance Win32_Process | Select-Object ProcessId,SessionId,Name,ParentProcessId,CreationDate,ExecutablePath,CommandLine)
$observations=@()
foreach($item in $before){
 $h=[IntPtr]::Zero;$openError=$null;$imageError=$null;$nativePath=$null;$nativeCommand=$null;$commandStatus=$null;$commandStatusFirst=$null;$nativeCreation=$null;$crossCreation=$false;$handleStable=$false;$contentsStable=$false
 try{
  if($item.ProcessId -gt 4 -and ($null -eq $item.ExecutablePath -or $null -eq $item.CommandLine)){
   $h=[ReleaseSiteIdentityV1]::OpenProcess(0x1000,$false,[uint32]$item.ProcessId)
   if($h -eq [IntPtr]::Zero){$openError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
   else{
    $c1=0L;$c2=0L;$exit=0L;$kernel=0L;$user=0L
    $t1=[ReleaseSiteIdentityV1]::GetProcessTimes($h,[ref]$c1,[ref]$exit,[ref]$kernel,[ref]$user)
    $b=[Text.StringBuilder]::new(32768);$n=[uint32]32768
    if([ReleaseSiteIdentityV1]::QueryFullProcessImageName($h,0,$b,[ref]$n)){$nativePath=$b.ToString()}else{$imageError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
    $s1=0;$s2=0;$cmd1=[ReleaseSiteIdentityV1]::Command($h,[ref]$s1);$cmd2=[ReleaseSiteIdentityV1]::Command($h,[ref]$s2)
    $commandStatusFirst=$s1;$commandStatus=$s2;$contentsStable=$s1 -eq 0 -and $s2 -eq 0 -and $null -ne $cmd1 -and [string]::Equals($cmd1,$cmd2,[StringComparison]::Ordinal)
    if($contentsStable){$nativeCommand=$cmd2}
    $t2=[ReleaseSiteIdentityV1]::GetProcessTimes($h,[ref]$c2,[ref]$exit,[ref]$kernel,[ref]$user)
    $handleStable=$t1 -and $t2 -and $c1 -eq $c2
    if($handleStable){$nativeCreation=$c1.ToString([Globalization.CultureInfo]::InvariantCulture)}
    if($handleStable -and $null -ne $item.CreationDate){$crossCreation=[ReleaseSiteIdentityV1]::SameCreation($c1,$item.CreationDate.ToUniversalTime().ToFileTimeUtc())}
   }
  }
 }finally{if($h -ne [IntPtr]::Zero){[void][ReleaseSiteIdentityV1]::CloseHandle($h)}}
 $observations+=[pscustomobject]@{original=$item;nativePath=$nativePath;nativeCommand=$nativeCommand;openError=$openError;imageError=$imageError;commandStatusFirst=$commandStatusFirst;commandStatus=$commandStatus;nativeCreation=$nativeCreation;crossCreation=$crossCreation;handleStable=$handleStable;contentsStable=$contentsStable}
}
$after=@{};Get-CimInstance Win32_Process | ForEach-Object{$after[[int]$_.ProcessId]=$_}
$records=@()
foreach($observation in $observations){
 $p=$observation.original;$a=$after[[int]$p.ProcessId]
 $kernel=($p.ProcessId -eq 0 -and $p.Name -eq 'System Idle Process' -and $p.SessionId -eq 0 -and $null -eq $p.ExecutablePath -and $null -eq $p.CommandLine)
 $same=$null -ne $a -and ($kernel -or ($null -ne $p.CreationDate -and $null -ne $a.CreationDate -and $p.CreationDate -eq $a.CreationDate)) -and $p.Name -eq $a.Name -and $p.SessionId -eq $a.SessionId
 $canFill=$same -and $observation.crossCreation -and $observation.handleStable
 $exe=$p.ExecutablePath;$command=$p.CommandLine
 if($canFill){if($null -eq $exe){$exe=$observation.nativePath};if($null -eq $command -and $observation.contentsStable){$command=$observation.nativeCommand}}
 # Raw commands are returned only through the pipe to a pinned in-memory guard evaluator.
 $row=[pscustomobject]@{ProcessId=[int]$p.ProcessId;SessionId=[int]$p.SessionId;Name=$p.Name;ExecutablePath=$exe;CommandLine=$command;CreationDate=$p.CreationDate;cimCreationUtc=if($null -ne $p.CreationDate){$p.CreationDate.ToUniversalTime().ToString('o')}else{$null};nativeCreationFileTime=$observation.nativeCreation;identityStable=$same;crossCreation=$observation.crossCreation;nativeHandleStable=$observation.handleStable;nativeCommandStable=$observation.contentsStable;openError=$observation.openError;imageError=$observation.imageError;commandStatusFirst=$observation.commandStatusFirst;commandStatus=$observation.commandStatus;fallbackUsed=$canFill;departureProof=$null}
 if(!$same){
  $departure=Confirm-LiveProcessDeparture $p ([string]$observation.nativeCreation);$row.departureProof=$departure.proof
  $current=if($null -ne $departure.current){$departure.current}else{$a}
  if($null -ne $current -and ($null -eq $current.CreationDate -or $current.CreationDate -ne $p.CreationDate -or $current.Name -cne $p.Name -or $current.SessionId -ne $p.SessionId)){
   $row.departureProof.kind='unproven';$row.departureProof.reason='current-pid-reused-or-changed'
   $row.Name=$current.Name;$row.SessionId=[int]$current.SessionId;$row.ExecutablePath=$current.ExecutablePath;$row.CommandLine=$current.CommandLine;$row.cimCreationUtc=if($null -ne $current.CreationDate){$current.CreationDate.ToUniversalTime().ToString('o')}else{$null}
  }
 }
 $records+=$row
}
$seen=@{};foreach($row in $records){$seen[[int]$row.ProcessId]=$true}
# Include current rows which appeared after the initial census; never silently
# omit a new writer. A second per-PID observation either proves its live identity
# or leaves it unknown / proves departure with the same bounded kernel rules.
foreach($key in @($after.Keys)){if(!$seen.ContainsKey([int]$key)){$records+=New-LateProcessObservation $after[$key]}}
$tasks=@(Get-ScheduledTask | ForEach-Object{[pscustomobject]@{identity=$_.TaskPath+$_.TaskName;actions=@($_.Actions|Select-Object Execute,Arguments,WorkingDirectory)}})
$selectedCwd=[ordered]@{processId=47936;readable=$false;openError=$null;failure=$null;CurrentDirectory=$null;identityStable=$false;nativeCreationFileTime=$null;cimCreationUtc=$null;accessMask='0x0410';scope='Bounded x64 process-parameter metadata for one known interpreter, cross-checked native image/command; no memory dump'}
$cwdBefore=Get-CimInstance Win32_Process -Filter 'ProcessId=47936';$cwdHandle=[ReleaseSiteIdentityV1]::OpenProcess(0x0410,$false,47936)
try{
 if($cwdHandle -eq [IntPtr]::Zero){$selectedCwd.openError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
 else{
  $cc1=0L;$cc2=0L;$ce=0L;$ck=0L;$cu=0L;$ct1=[ReleaseSiteIdentityV1]::GetProcessTimes($cwdHandle,[ref]$cc1,[ref]$ce,[ref]$ck,[ref]$cu)
  $cf=$null;$cwdValue=[ReleaseSiteIdentityV1]::CurrentDirectoryMetadata($cwdHandle,47936,[ref]$cf)
  $ct2=[ReleaseSiteIdentityV1]::GetProcessTimes($cwdHandle,[ref]$cc2,[ref]$ce,[ref]$ck,[ref]$cu);$cwdAfter=Get-CimInstance Win32_Process -Filter 'ProcessId=47936'
  $selectedCwd.identityStable=$ct1 -and $ct2 -and $cc1 -eq $cc2 -and $null -ne $cwdBefore.CreationDate -and $null -ne $cwdAfter.CreationDate -and $cwdBefore.CreationDate -eq $cwdAfter.CreationDate -and [ReleaseSiteIdentityV1]::SameCreation($cc1,$cwdBefore.CreationDate.ToUniversalTime().ToFileTimeUtc())
  $selectedCwd.failure=$cf
  if($ct1){$selectedCwd.nativeCreationFileTime=$cc1.ToString([Globalization.CultureInfo]::InvariantCulture)}
  if($null -ne $cwdBefore.CreationDate){$selectedCwd.cimCreationUtc=$cwdBefore.CreationDate.ToUniversalTime().ToString('o')}
  if($selectedCwd.identityStable -and $null -ne $cwdValue){$selectedCwd.readable=$true;$selectedCwd.CurrentDirectory=$cwdValue}
 }
}finally{if($cwdHandle -ne [IntPtr]::Zero){[void][ReleaseSiteIdentityV1]::CloseHandle($cwdHandle)}}
$summary=[ordered]@{version='teruisi-live-process-identity-v1';at=[DateTimeOffset]::UtcNow.ToString('o');processes=$records.Count;fallbackUsed=@($records|Where-Object fallbackUsed).Count;missingImage=@($records|Where-Object {$null -eq $_.ExecutablePath}).Count;missingCommand=@($records|Where-Object {$null -eq $_.CommandLine}).Count;changedDuringCapture=@($records|Where-Object {-not $_.identityStable}).Count;kernelConfirmedDepartures=@($records|Where-Object {$null -ne $_.departureProof -and $_.departureProof.kind -cin @('pid-absent','same-instance-exited')}).Count;lateRows=@($records|Where-Object lateObservation).Count;rawCommandLinesPersisted=$false;privilegesAdjusted=$false;productionMutations=0}
$stream=[IO.File]::Open($OutputPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($summary|ConvertTo-Json)+[Environment]::NewLine);$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
[pscustomobject]@{processes=$records;tasks=$tasks;selectedCwd=$selectedCwd;summary=$summary}|ConvertTo-Json -Depth 8 -Compress
