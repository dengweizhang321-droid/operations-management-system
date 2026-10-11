param([int[]]$ProcessIds=@(47936),[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputPath){throw 'Create-only evidence already exists'}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ReleaseSiteCommandQuery {
 [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetProcessTimes(IntPtr handle,out long creation,out long exit,out long kernel,out long user);
 [DllImport("ntdll.dll")] public static extern int NtQueryInformationProcess(IntPtr handle,int infoClass,IntPtr output,uint size,out uint required);
}
'@
$records=@()
foreach($taskProcessId in $ProcessIds){
 $before=Get-CimInstance Win32_Process -Filter "ProcessId=$taskProcessId"
 $h=[ReleaseSiteCommandQuery]::OpenProcess(0x1000,$false,[uint32]$taskProcessId)
 $openError=if($h -eq [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::GetLastWin32Error()}else{0}
 $status=$null;$length=0;$command=$null;$valid=$false;$allocation=[IntPtr]::Zero;$create1=0L;$create2=0L;$times=$false
 try{
  if($h -ne [IntPtr]::Zero){
   $exit=0L;$kernel=0L;$user=0L;$times=[ReleaseSiteCommandQuery]::GetProcessTimes($h,[ref]$create1,[ref]$exit,[ref]$kernel,[ref]$user)
   $required=0u;$status=[ReleaseSiteCommandQuery]::NtQueryInformationProcess($h,60,[IntPtr]::Zero,0,[ref]$required)
   if($required -ge 16 -and $required -le 1048576){
    $allocation=[Runtime.InteropServices.Marshal]::AllocHGlobal([int]$required);$allocated=$required
    $status=[ReleaseSiteCommandQuery]::NtQueryInformationProcess($h,60,$allocation,$allocated,[ref]$required)
    if($status -eq 0){
     $length=[int][uint16][Runtime.InteropServices.Marshal]::ReadInt16($allocation,0);$maximum=[int][uint16][Runtime.InteropServices.Marshal]::ReadInt16($allocation,2)
     $pointer=[Runtime.InteropServices.Marshal]::ReadIntPtr($allocation,[IntPtr]::Size)
     $base=$allocation.ToInt64();$position=$pointer.ToInt64()
     $valid=$length % 2 -eq 0 -and $length -le $maximum -and $position -ge $base -and $position+$length -le $base+[long]$allocated
     if($valid){$command=[Runtime.InteropServices.Marshal]::PtrToStringUni($pointer,$length/2)}
    }
   }
   $times=$times -and [ReleaseSiteCommandQuery]::GetProcessTimes($h,[ref]$create2,[ref]$exit,[ref]$kernel,[ref]$user)
  }
 }finally{if($allocation -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::FreeHGlobal($allocation)};if($h -ne [IntPtr]::Zero){[void][ReleaseSiteCommandQuery]::CloseHandle($h)}}
 $after=Get-CimInstance Win32_Process -Filter "ProcessId=$taskProcessId"
 $stable=$null -ne $before -and $null -ne $after -and $before.CreationDate -eq $after.CreationDate -and $times -and $create1 -eq $create2
 $sha=$null;if($null -ne $command){$sha=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($command))).ToLowerInvariant()}
 $records+=[ordered]@{processId=$taskProcessId;name=$before.Name;creationDate=$before.CreationDate;openError=$openError;ntStatus=$status;commandReadable=($null -ne $command);unicodeBufferValid=$valid;commandSha256=$sha;commandCharacters=if($null -ne $command){$command.Length}else{0};containsTargetLiteral=if($null -ne $command){$command.Replace('/','\').ToLowerInvariant().Contains('d:\teruisi-runtime\django-sales\app.previous')}else{$null};identityStable=$stable;rawCommandNotPersisted=$true}
}
$record=[ordered]@{version='teruisi-readonly-command-query-diagnostic-v1';at=[DateTimeOffset]::UtcNow.ToString('o');records=$records;privilegesAdjusted=$false;processMutations=0;productionMutations=0;scope='Diagnostic only. Does not replace physical path/token reference guard, inspect cwd/handles, or grant production admission.'}
$stream=[IO.File]::Open($OutputPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($record|ConvertTo-Json -Depth 6)+[Environment]::NewLine);$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
$record|ConvertTo-Json -Depth 6
