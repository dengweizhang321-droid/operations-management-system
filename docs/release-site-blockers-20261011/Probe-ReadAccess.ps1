param([int[]]$ProcessIds=@(47936),[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class ReleaseSiteReadAccess {
 [DllImport("kernel32.dll",SetLastError=true)]public static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll",SetLastError=true)]public static extern bool CloseHandle(IntPtr handle);
}
'@
$rows=@()
foreach($id in $ProcessIds){foreach($mask in @(0x1000,0x1010,0x0410)){$h=[ReleaseSiteReadAccess]::OpenProcess([uint32]$mask,$false,[uint32]$id);$errorCode=if($h -eq [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::GetLastWin32Error()}else{0};$rows+=[ordered]@{processId=$id;accessMask=('0x{0:x4}' -f $mask);opened=($h -ne [IntPtr]::Zero);errorCode=$errorCode};if($h -ne [IntPtr]::Zero){[void][ReleaseSiteReadAccess]::CloseHandle($h)}}}
$record=[ordered]@{version='teruisi-readonly-process-access-capability-probe-v1';at=[DateTimeOffset]::UtcNow.ToString('o');rows=$rows;processMemoryRead=$false;privilegesAdjusted=$false;productionMutations=0}
$stream=[IO.File]::Open($OutputPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read);try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($record|ConvertTo-Json -Depth 4)+[Environment]::NewLine);$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
$record|ConvertTo-Json -Depth 4
