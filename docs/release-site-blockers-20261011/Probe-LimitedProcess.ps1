param([int[]]$ProcessIds=@(47936),[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputPath){throw 'Create-only evidence already exists'}
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ReleaseSiteLimitedProcess {
 [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr handle,uint flags,StringBuilder name,ref uint size);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetProcessTimes(IntPtr handle,out long creation,out long exit,out long kernel,out long user);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
}
'@
$records=@()
foreach($taskProcessId in $ProcessIds){
 if($taskProcessId -le 4){throw 'Probe only real user-mode process IDs'}
 $before=Get-CimInstance Win32_Process -Filter "ProcessId=$taskProcessId"
 $handle=[ReleaseSiteLimitedProcess]::OpenProcess(0x1000,$false,[uint32]$taskProcessId)
 $openError=if($handle -eq [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::GetLastWin32Error()}else{0}
 $image=$null;$queryError=$null;$createBefore=0L;$createAfter=0L;$timeOk=$false
 try{
  if($handle -ne [IntPtr]::Zero){
   $exit=0L;$kernel=0L;$user=0L
   $timeOk=[ReleaseSiteLimitedProcess]::GetProcessTimes($handle,[ref]$createBefore,[ref]$exit,[ref]$kernel,[ref]$user)
   $buffer=[Text.StringBuilder]::new(32768);$size=[uint32]32768
   if([ReleaseSiteLimitedProcess]::QueryFullProcessImageName($handle,0,$buffer,[ref]$size)){$image=$buffer.ToString()}else{$queryError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
   $timeOk=$timeOk -and [ReleaseSiteLimitedProcess]::GetProcessTimes($handle,[ref]$createAfter,[ref]$exit,[ref]$kernel,[ref]$user)
  }
 }finally{if($handle -ne [IntPtr]::Zero){[void][ReleaseSiteLimitedProcess]::CloseHandle($handle)}}
 $after=Get-CimInstance Win32_Process -Filter "ProcessId=$taskProcessId"
 $stable=$null -ne $before -and $null -ne $after -and $before.CreationDate -eq $after.CreationDate -and $before.Name -eq $after.Name -and $timeOk -and $createBefore -eq $createAfter
 $records+=[ordered]@{processId=$taskProcessId;name=$before.Name;sessionId=$before.SessionId;parentProcessId=$before.ParentProcessId;creationDate=$before.CreationDate;limitedAccessMask='0x1000';openError=$openError;imagePath=$image;queryError=$queryError;identityStable=$stable;originalCimExecutableReadable=($null -ne $before.ExecutablePath);originalCimCommandReadable=($null -ne $before.CommandLine);commandLineValuesPersisted=$false}
}
$record=[ordered]@{version='teruisi-readonly-limited-process-identity-probe-v1';at=[DateTimeOffset]::UtcNow.ToString('o');elevatedAdministrator=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);records=$records;privilegesAdjusted=$false;processTerminations=0;productionMutations=0}
$json=$record|ConvertTo-Json -Depth 7
$file=[IO.File]::Open($OutputPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes($json+[Environment]::NewLine);$file.Write($bytes,0,$bytes.Length)}finally{$file.Dispose()}
$json
