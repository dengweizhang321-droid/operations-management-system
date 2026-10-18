param([ValidateSet('partial','stopped','final','Enter')][string]$Action,
 [Parameter(Mandatory)][string]$InputPath,[Parameter(Mandatory)][string]$InputSha256,
 [Parameter(Mandatory)][int]$OwnerPid,[ValidateSet('recovery','catalog')][string]$OwnerKind='recovery',[switch]$Json)
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
function Hash-File([string]$File){(Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()}
function Read-Object([string]$File){
 $raw=[IO.File]::ReadAllText($File);if(-not $raw.TrimStart().StartsWith('{')){throw 'Expected JSON object'}
 $value=if((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){$raw|ConvertFrom-Json -DateKind String}else{$raw|ConvertFrom-Json};if($value -isnot [pscustomobject]){throw 'Expected typed JSON object'};return $value
}
function Require-Hash([string]$File,[string]$Expected){
 if($Expected -cnotmatch '^[a-f0-9]{64}$'){throw 'Invalid pinned SHA'}
 $entry=Get-Item -LiteralPath $File -Force;if($entry.PSIsContainer){throw 'Pinned file is not a file'}
 for($cursor=$entry;$null -ne $cursor;$cursor=$cursor.Parent){if($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Pinned path redirected'}}
 if((Hash-File $File) -cne $Expected){throw ('Pinned file drift: '+$File)}
}
function Assert-MaintenanceObject([object]$Record,[string]$Version){
 if($Record -isnot [pscustomobject] -or $Record.version -isnot [string] -or $Record.version -cne $Version -or
  $Record.id -isnot [string] -or $Record.id -cne '5fe642a2602243ca83819253d8848e57' -or
  $Record.runtimeRoot -isnot [string] -or [IO.Path]::GetFullPath($Record.runtimeRoot) -ine 'D:\teruisi-runtime\django-sales' -or
  $Record.keepPostgres -isnot [bool] -or -not $Record.keepPostgres){throw 'Maintenance/drain typed identity changed'}
 if($Record.PSObject.Properties.Name -ccontains 'drainedStopped' -and $Record.drainedStopped -isnot [bool]){throw 'Invalid drainedStopped type'}
}
function Decode-Command([string]$Value){
 $result=$Value
 for($round=0;$round -lt 3;$round++){
  $added=@();foreach($match in [regex]::Matches($result,'[A-Za-z0-9+/]{80,}={0,2}')){
   try{$raw=[Convert]::FromBase64String($match.Value);foreach($encoding in @([Text.Encoding]::Unicode,[Text.Encoding]::UTF8)){$text=$encoding.GetString($raw);if($text.Length -lt 1048576 -and $text -match '[\\/:]'){$added+=,$text}}}catch{}
  };if($added.Count){$result+="`n"+($added -join "`n")}
 };return $result.Replace('\','/').ToLowerInvariant()
}
function Assert-MaintenanceRaw([string]$File,[object]$Record){
 $names=@($Record.PSObject.Properties.Name);$allowed=@('version','id','runtimeRoot','createdAt','keepPostgres','drainedStopped','phase')
 foreach($name in $names){if($name -cnotin $allowed){throw 'Unknown maintenance field'}}
 $count=[regex]::Matches([IO.File]::ReadAllText($File),'"(?:version|id|runtimeRoot|createdAt|keepPostgres|drainedStopped|phase)"\s*:').Count
 if($count -ne $names.Count){throw 'Duplicated maintenance field'}
}
function Assert-ActorsAbsent([object[]]$Rows,[object[]]$Actors){
 foreach($actor in $Actors){if(@($Rows|Where-Object {[int]$_.ProcessId -eq [int]$actor.pid -or [int]$_.ParentProcessId -eq [int]$actor.pid}).Count){throw 'Original actor/PID reuse/descendant remains'}}
}
function Assert-OriginalPiStopped([object]$Intent,[object[]]$Rows,[string]$Run){
 if(@($Rows|Where-Object {[int]$_.ProcessId -eq [int]$Intent.piOriginalProcessId -or [int]$_.ParentProcessId -eq [int]$Intent.piOriginalProcessId}).Count){throw 'Original Pi PID, reused PID or descendant remains'}
 $receipt=Join-Path $Run 'django-ai-pi-worker.pid.json';if(Test-Path -LiteralPath $receipt){Require-Hash $receipt $Intent.piReceiptSha256}
 $controlFile=Join-Path $Run 'django-ai-pi-worker.control.json';$ackFile=$controlFile+'.stopped'
 Require-Hash $controlFile $Intent.piControlSha256;Require-Hash $ackFile $Intent.piStoppedSha256
 $control=Read-Object $controlFile;$ack=Read-Object $ackFile
 foreach($item in @(@($controlFile,$control,@('version','token','intent')),@($ackFile,$ack,@('version','token','status')))){
  $names=@($item[1].PSObject.Properties.Name)
  if((($names|Sort-Object) -join ',') -cne (($item[2]|Sort-Object) -join ',') -or [regex]::Matches([IO.File]::ReadAllText($item[0]),'"(?:version|token|intent|status)"\s*:').Count -ne 3){throw 'Original Pi stop record shape changed'}
 }
 if(($control.version -isnot [int] -and $control.version -isnot [long]) -or $control.version -ne 1 -or ($ack.version -isnot [int] -and $ack.version -isnot [long]) -or $ack.version -ne 1 -or $control.token -isnot [string] -or $control.token -cnotmatch '^[a-f0-9]{32}$' -or $control.token -cne $ack.token -or $control.intent -cne 'stop' -or $ack.status -cne 'stopped'){throw 'Original Pi stop token/status changed'}
 $h=[Security.Cryptography.SHA256]::Create();try{$digest=([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($control.token)))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}
 if($digest -cne $Intent.piOriginalTokenSha256){throw 'Stop acknowledgement belongs to another Pi token'}
 Require-Hash $controlFile $Intent.piControlSha256;Require-Hash $ackFile $Intent.piStoppedSha256
}
function Assert-NoControllers([object[]]$Rows,[int]$Owner){
 foreach($row in $Rows){
  if([int]$row.ProcessId -eq $PID -or [int]$row.ProcessId -eq $Owner){continue}
  $name=[string]$row.Name;$command=[string]$row.CommandLine;$exe=[string]$row.ExecutablePath
  if($name -imatch '^(powershell|pwsh|python|pythonw|waitress-serve|node|workerd|wsl)(\.exe)?$' -and (-not $command -or -not $exe)){throw 'Unwitnessed unreadable process'}
  if($name -imatch '^(powershell|pwsh)(\.exe)?$' -and $command -match '(?i)(?:^|\s)"?[-/](?:e|ec|en|enc|enco|encod|encode|encoded|encodedc|encodedco|encodedcom|encodedcomm|encodedcomma|encodedcomman|encodedcommand)"?(?:\s|:|$)'){throw 'Encoded PowerShell remains unknown'}
  if($name -imatch '^(powershell|pwsh)(\.exe)?$' -and ($command -imatch '(django-[a-z-]+|worker-local-service|operations-system-(control|service)|manual-maintenance-(start|continuation))\.ps1' -or $command.Replace('\','/').IndexOf('D:/teruisi-runtime/django-sales',[StringComparison]::OrdinalIgnoreCase) -ge 0 -or $command.Replace('\','/').IndexOf('D:/teruisi-runtime/teruisi-worker-sales',[StringComparison]::OrdinalIgnoreCase) -ge 0)){throw 'Possibly late native PowerShell lifecycle participant'}
  $text=Decode-Command $command
  if($text -match 'manual-maintenance-(start|continuation)|publish-(main|latest-main|prepared-main)\.mjs|pi150-forward-recovery\.mjs' -or
   ($text.Contains('/main-release-packages/') -and $text.Contains('/source/tools/') -and $text -match 'django-local-service\.ps1|worker-local-service\.ps1')){throw 'Another native maintenance/publication controller remains'}
  if($phase -cne 'final' -and $name -imatch '^(python|pythonw|waitress-serve|node|workerd|wsl)(\.exe)?$' -and ($text.Contains('d:/teruisi-runtime/') -or $exe.Replace('\','/').ToLowerInvariant().Contains('d:/teruisi-runtime/') -or $text.Contains('teruisi-pandas'))){
   $allowed=@($script:allowedRemaining|Where-Object {[int]$_.ProcessId -eq [int]$row.ProcessId -and $_.CreationDate -ceq $row.CreationDate.ToUniversalTime().ToString('o') -and $_.ExecutablePath -ieq $exe -and $_.CommandLine -ceq $command})
   if($allowed.Count -ne 1){throw 'Unverified native application or late control participant'}
  }
 }
}
function Get-RecoverySnapshot {
 $phase=if($script:requestedRecoveryAction -ceq 'Enter'){'partial'}else{$script:requestedRecoveryAction}
 if([IO.Path]::GetFullPath($InputPath) -ine (Join-Path $PSScriptRoot 'RECOVERY-INTENT.json')){throw 'Unexpected recovery intent path'}
 Require-Hash $InputPath $InputSha256;$script:intent=Read-Object $InputPath
 if($intent.version -cne '6dc-maintenance-recovery-intent-v1' -or $intent.maintenanceId -cne '5fe642a2602243ca83819253d8848e57'){throw 'Unexpected finite recovery intent'}
 $manifestPath=Join-Path $PSScriptRoot 'MANIFEST.json';Require-Hash $manifestPath $intent.codeManifestSha256;$manifest=Read-Object $manifestPath
 Require-Hash $PSCommandPath $manifest.code.'observe.ps1'
 $root='D:\teruisi-runtime\django-sales';$run=Join-Path $root 'run';$worker='D:\teruisi-runtime\teruisi-worker-sales'
 $maintenancePath=Join-Path $run 'system-maintenance.json';$drainPath=Join-Path $run 'automation-drain.json'
 $maintenance=$null;$drain=$null
 if($phase -ceq 'final'){
  if((Test-Path -LiteralPath $maintenancePath) -or (Test-Path -LiteralPath $drainPath)){throw 'Maintenance/drain remains after startup'}
 }else{
  $maintenance=Read-Object $maintenancePath;$drain=Read-Object $drainPath
  Assert-MaintenanceObject $maintenance 'teruisi-system-maintenance-v1';Assert-MaintenanceObject $drain 'teruisi-automation-drain-v1'
  Assert-MaintenanceRaw $maintenancePath $maintenance;Assert-MaintenanceRaw $drainPath $drain
  if($maintenance.createdAt -cne $intent.maintenanceCreatedAt){throw 'Original maintenance record changed'}
  if($maintenance.drainedStopped -cne $true){Require-Hash $maintenancePath $intent.maintenanceSha256}
  if($drain.phase -isnot [string] -or $drain.phase -cne 'requests'){throw 'Drain phase changed'}
  Require-Hash $drainPath $intent.drainSha256
  if((Test-Path -LiteralPath (Join-Path $worker 'state\worker-process.json'))){throw 'Old Worker process receipt reappeared'}
  Require-Hash (Join-Path $run 'django-ai-pi-worker.control.json') $intent.piControlSha256
  Require-Hash (Join-Path $run 'django-ai-pi-worker.control.json.stopped') $intent.piStoppedSha256
  $pi=Read-Object (Join-Path $run 'django-ai-pi-worker.control.json');$stopped=Read-Object (Join-Path $run 'django-ai-pi-worker.control.json.stopped')
  if($pi.intent -cne 'stop' -or $stopped.status -cne 'stopped' -or $pi.token -isnot [string] -or $stopped.token -isnot [string] -or $pi.token -cne $stopped.token){throw 'Pi stop token changed'}
 }
 $rows=@(Get-CimInstance Win32_Process -ErrorAction Stop);Assert-ActorsAbsent $rows $intent.originalActors
 if($phase -cne 'final'){Assert-OriginalPiStopped $intent $rows $run}
 $ownerName=if($OwnerKind -ceq 'catalog'){'CATALOG-ONLY-OWNER.json'}else{'RECOVERY-OWNER.json'}
 Require-Hash (Join-Path $PSScriptRoot 'witness-admission.ps1') $manifest.code.'witness-admission.ps1';. (Join-Path $PSScriptRoot 'witness-admission.ps1')
 $owner=Read-Object (Join-Path $intent.outputDirectory $ownerName);$current=@($rows|Where-Object {[int]$_.ProcessId -eq $OwnerPid})
 if($owner.pid -ne $OwnerPid -or $current.Count -ne 1 -or -not $current[0].CreationDate -or $current[0].CreationDate.ToUniversalTime().ToString('o') -cne $owner.creationDate){throw 'Current recovery owner creation identity changed'}
 $bound=New-ProcessBinding $current[0];foreach($key in @('pid','creationDate','executableSha256','commandLineSha256')){if($bound.$key -cne $owner.$key){throw 'Current owner exact identity drift'}}
 if(-not ('FiniteRecoveryPipeOwner' -as [type])){Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;using Microsoft.Win32.SafeHandles;public static class FiniteRecoveryPipeOwner{[DllImport("kernel32.dll",SetLastError=true)]public static extern bool GetNamedPipeServerProcessId(SafePipeHandle p,out uint pid);}'}
 $pipe=[IO.Pipes.NamedPipeClientStream]::new('.','TERUISI.Worker.ReleaseRotation.v1',[IO.Pipes.PipeDirection]::InOut);try{$pipe.Connect(1000);$server=[uint32]0;if(-not [FiniteRecoveryPipeOwner]::GetNamedPipeServerProcessId($pipe.SafePipeHandle,[ref]$server) -or $server -ne $OwnerPid){throw 'New recovery owner pipe mismatch'}}finally{$pipe.Dispose()}
 $library=Join-Path $root 'app\tools\django-local-service.ps1'
 $expected=if($phase -ceq 'final'){$intent.targetDjangoScriptSha256}else{$intent.oldDjangoScriptSha256};Require-Hash $library $expected
 $previous=$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
 try{
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1'
  . $library -RuntimeRoot $root -Action MaintenanceStatus
  # Status is intentionally retained: native Resolve-OwnedProcess then cannot
  # remove stale/previous-boot PID receipts during these observations.
  $Action='MaintenanceStatus'
  [void](Assert-PostgresListenerOwnership);if(-not (Test-PostgresReady)){throw 'Owned PostgreSQL is not ready'}
  $script:allowedRemaining=@(& {
   $services=@('django-reader','django-writer');foreach($domain in @('finance','netshop','market','products','inventory','workflow','customer-service','access-control','erp-reference','ai')){foreach($side in @('reader','writer')){$services+=('django-'+$domain+'-'+$side)}};$services+='django-bi-reader'
   foreach($service in $services){$owned=Resolve-OwnedProcess $service (Join-Path $RunDirectory ($service+'.pid.json')) $Waitress -ReadOnly;if($owned){$owned;Get-VerifiedProcessDescendants $owned}}
   foreach($service in @('django-ai-dingtalk','django-ai-dingtalk-schedule','erp-reference-sync')){$owned=Resolve-OwnedProcess $service (Join-Path $RunDirectory ($service+'.pid.json')) $Python -ReadOnly;if($owned){$owned;Get-VerifiedProcessDescendants $owned}}
   $owned=Resolve-OwnedProcess 'ai-pandas-wsl' (Join-Path $RunDirectory 'ai-pandas-wsl.pid.json') (Join-Path $env:SystemRoot 'System32\wsl.exe') @('-d','TERUISI-Pandas','-u','teruisi-pandas','--exec','/usr/bin/sleep','infinity') -ReadOnly;if($owned){$owned;Get-VerifiedProcessDescendants $owned}
  })
  $rows=Complete-ProcessCensus @(Get-CimInstance Win32_Process -ErrorAction Stop) $OwnerPid;Assert-ActorsAbsent $rows $intent.originalActors;Assert-NoControllers $rows $OwnerPid
  if($phase -cne 'final'){Assert-OriginalPiStopped $intent $rows $run}

  $full=$false
  if($phase -cne 'final'){
   # Do not invent a classifier over every historical run/*.pid.json. The
   # unchanged native Stop owns each remaining service's exact receipt/process
   # identity before stopping it; unknown terminates that operation. Legacy
   # django.pid/projection-sync.pid are preserved, not deleted or adopted here.
   foreach($port in @(3000,5791)){if(@(Get-PortListeners $port).Count){throw 'Old Worker/helper listener remains'}}
   if($phase -ceq 'stopped' -or $maintenance.drainedStopped -ceq $true){
    Assert-ApplicationDeploymentStopped '6dcReadOnlyStoppedObservation';Assert-SalesRetirementWorkerStopped '6dcReadOnlyStoppedObservation';$full=$true
   }
  }
  $result=@{version='6dc-maintenance-observation-v1';at=[DateTimeOffset]::UtcNow.ToString('o');maintenanceId='5fe642a2602243ca83819253d8848e57';originalActorsAbsent=$true;controlsAbsent=$true;postgresOwnedReady=$true;nativeStopIdentityGatePreserved=$true;workerReceiptAbsent=($phase -cne 'final');maintenance=$maintenance;drain=$drain;piStopBound=($phase -cne 'final');fullNativeStopVerified=$full;maintenanceAbsent=($phase -ceq 'final');drainAbsent=($phase -ceq 'final');remainingPartialStopScope='original-native-stop-only';legacyReceiptsUnchanged=@('django.pid.json','projection-sync.pid.json')}
  # Slow native observations are followed by another fresh old-controller census.
  $rows=Complete-ProcessCensus @(Get-CimInstance Win32_Process -ErrorAction Stop) $OwnerPid;Assert-ActorsAbsent $rows $intent.originalActors;Assert-NoControllers $rows $OwnerPid
  if($phase -cne 'final'){Assert-OriginalPiStopped $intent $rows $run}
  return $result
 }finally{$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY=$previous}
}
function Save-New([string]$File,[object]$Value){$b=[Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 14 -Compress)+"`n");$s=[IO.File]::Open($File,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read);try{$s.Write($b,0,$b.Length);$s.Flush($true)}finally{$s.Dispose()}}
try{
 $script:requestedRecoveryAction=$Action
 Require-Hash $InputPath $InputSha256;$initial=Read-Object $InputPath
 $m=Read-Object (Join-Path $PSScriptRoot 'MANIFEST.json');Require-Hash (Join-Path $PSScriptRoot 'MANIFEST.json') $initial.codeManifestSha256
 $gate=Join-Path $initial.source 'tools\manual-maintenance-lock.psm1';Require-Hash $gate $m.native.$gate;Import-Module $gate -Force
 $h=[Security.Cryptography.SHA256]::Create();try{$suffix=([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes('D:\teruisi-runtime\django-sales')))).Replace('-','').ToLowerInvariant().Substring(0,24)}finally{$h.Dispose()}
 Invoke-ManualMaintenanceGate -WorkerMutexName 'Local\TERUISI.Worker.LocalService.v1' -DjangoMutexName ('Local\TERUISI-DjangoSales-'+$suffix) -WaitMilliseconds 120000 -Check {
  $script:before=Get-RecoverySnapshot
  if($script:requestedRecoveryAction -ceq 'Enter'){
   if($script:before.maintenance.drainedStopped -eq $true){throw 'Unexpected completed maintenance; no native replay'}
   Save-New (Join-Path $intent.outputDirectory 'ENTER-MAINTENANCE-BOUNDARY.json') @{at=[DateTimeOffset]::UtcNow.ToString('o');intentSha256=$InputSha256;ownerPid=$OwnerPid;before=$script:before}
  };return $true
 } -Operation {
  if($script:requestedRecoveryAction -ceq 'Enter'){
   $raw=& $intent.oldWorker -Action EnterMaintenance -MaintenanceId $intent.maintenanceId -KeepPostgres -Json
   if($LASTEXITCODE -ne 0){throw 'One original same-ID Enter failed; unknown no replay'}
   $value=($raw -join "`n")|ConvertFrom-Json
   if($value.status -cne 'maintenance' -or $value.maintenanceId -cne $intent.maintenanceId -or $value.postgresPreserved -isnot [bool] -or -not $value.postgresPreserved -or $value.backendStopped -isnot [bool] -or -not $value.backendStopped){throw 'Native maintenance output remains unknown'}
   Save-New (Join-Path $intent.outputDirectory 'ENTER-MAINTENANCE-COMPLETE.json') @{at=[DateTimeOffset]::UtcNow.ToString('o');value=$value;intentSha256=$InputSha256;ownerPid=$OwnerPid}
   $value|ConvertTo-Json -Depth 12 -Compress
  }else{$script:before|ConvertTo-Json -Depth 12 -Compress}
 }
}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}
