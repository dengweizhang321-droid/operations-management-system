param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputPath){throw 'Create-only diagnostic'}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ReleaseHcsMetadata {
 [DllImport("computecore.dll",ExactSpelling=true)] public static extern IntPtr HcsCreateOperation(IntPtr context,IntPtr callback);
 [DllImport("computecore.dll",ExactSpelling=true,CharSet=CharSet.Unicode)] public static extern int HcsEnumerateComputeSystems(string query,IntPtr operation);
 [DllImport("computecore.dll",ExactSpelling=true)] public static extern int HcsWaitForOperationResult(IntPtr operation,uint timeout,out IntPtr result);
 [DllImport("computecore.dll",ExactSpelling=true)] public static extern void HcsCloseOperation(IntPtr operation);
 [DllImport("kernel32.dll",ExactSpelling=true)] public static extern IntPtr LocalFree(IntPtr data);
}
'@
$operation=[ReleaseHcsMetadata]::HcsCreateOperation([IntPtr]::Zero,[IntPtr]::Zero)
if($operation -eq [IntPtr]::Zero){throw 'HCS operation allocation failed'}
$document=[IntPtr]::Zero;$completed=$null;$systems=@();$documentHash=$null
try{
 $started=[ReleaseHcsMetadata]::HcsEnumerateComputeSystems($null,$operation)
 if($started -eq 0){$completed=[ReleaseHcsMetadata]::HcsWaitForOperationResult($operation,10000,[ref]$document)}
 if($document -ne [IntPtr]::Zero){
  $text=[Runtime.InteropServices.Marshal]::PtrToStringUni($document)
  if($text.Length -gt 4194304){throw 'HCS metadata exceeds diagnostic bound'}
  $hasher=[Security.Cryptography.SHA256]::Create()
  try{$documentHash=([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)))).Replace('-','').ToLowerInvariant()}finally{$hasher.Dispose()}
  if($completed -eq 0){
   if(!$text.TrimStart().StartsWith('[')){throw 'Expected HCS property array'}
   foreach($system in @($text|ConvertFrom-Json)){
    $safe=[ordered]@{availableFields=@($system.PSObject.Properties.Name)}
    foreach($field in @('Id','Name','Owner','RuntimeId','SystemType','RuntimeOsType','State','VirtualMachineWorkerProcessId')){
     if($system.PSObject.Properties.Name -contains $field){$safe[$field]=$system.$field}
    }
    $systems+=$safe
   }
  }
 }
}finally{if($document -ne [IntPtr]::Zero){[void][ReleaseHcsMetadata]::LocalFree($document)};[ReleaseHcsMetadata]::HcsCloseOperation($operation)}
$result=[ordered]@{version='teruisi-hcs-readonly-enumeration-v1';at=[DateTimeOffset]::UtcNow.ToString('o');startStatus=$started;completionStatus=$completed;documentSha256=$documentHash;systems=$systems;rawDocumentPersisted=$false;productionActionsRequested=0;scope='Existing HCS compute-system enumeration only; no create/open/start/stop/modify of a VM or distribution. Selected host identity metadata, not VM configuration or business data.'}
$json=$result|ConvertTo-Json -Depth 8
$stream=[IO.File]::Open($OutputPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes($json+[Environment]::NewLine);$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
$json
