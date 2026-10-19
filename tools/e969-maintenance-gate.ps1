param([ValidateSet('Check','EnterMaintenance')][string]$Action='Check',[Parameter(Mandatory)][string]$InputPath,[Parameter(Mandatory)][string]$InputSha256,[switch]$Json)
$ErrorActionPreference='Stop'
$fixed=([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'e969-maintenance-recovery-pins.json'))|ConvertFrom-Json)
function Hash-File([string]$File){(Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()}
function Read-Object([string]$File){$raw=[IO.File]::ReadAllText($File);if(-not $raw.TrimStart().StartsWith('{')){throw 'Expected object'};if((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){$raw|ConvertFrom-Json -DateKind String}else{$raw|ConvertFrom-Json}}
function Save-New([string]$File,[object]$Value){$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 5 -Compress)+"`n");$stream=[IO.File]::Open($File,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read);try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}}
function Check-FixedRecovery {
 if([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Ordinary token required'}
 if((Hash-File $InputPath) -cne $InputSha256){throw 'Gate request changed'};$script:input=Read-Object $InputPath
 if($script:input.version -cne $fixed.version -or $script:input.maintenanceId -cne $fixed.maintenanceId){throw 'Fixed continuation identity changed'}
 if([IO.Path]::GetFullPath($script:input.recoveryDirectory) -cne [IO.Path]::GetFullPath((Join-Path $fixed.attempt 'reconciliation/e969-ad7d'))){throw 'Fixed recovery namespace changed'}
 if([IO.Path]::GetFullPath($script:input.operator.root) -cne [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))){throw 'Operator root changed'}
 $required=@('e969-maintenance-recovery.mjs','e969-maintenance-observer.mjs','e969-maintenance-gate.ps1','e969-maintenance-recovery-pins.json','main-prebuild-queue.mjs','main-prebuild-task.mjs','main-control-dispatch.mjs')
 if((@($script:input.operator.files.PSObject.Properties.Name|Sort-Object)-join '|') -cne (($required|Sort-Object)-join '|')){throw 'Incomplete operator closure'}
 foreach($pin in $fixed.files.PSObject.Properties){if((Hash-File $pin.Name) -cne $pin.Value){throw 'Original/native bytes changed'}}
 foreach($pin in $script:input.operator.files.PSObject.Properties){if((Hash-File (Join-Path (Join-Path $script:input.operator.root 'tools') $pin.Name)) -cne $pin.Value){throw 'Operator changed'}}
 if((Hash-File $script:input.observationFile) -cne $script:input.observationSha256){throw 'Witness changed'};$witness=Read-Object $script:input.observationFile;$ack=Read-Object $script:input.ackFile
 $age=([DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($witness.dynamicStartedAt)).TotalSeconds
 if($age -lt 0 -or $age -ge 60 -or $ack.requestSha256 -cne $script:input.requestSha256 -or $witness.requestSha256 -cne $script:input.requestSha256 -or $witness.elevated -isnot [bool] -or -not $witness.elevated){throw 'Fresh cross-token witness expired or changed'}
 foreach($name in @('system-maintenance.json','automation-drain.json')){$record=Read-Object (Join-Path $fixed.django ('run/'+$name));if($record.id -cne $fixed.maintenanceId -or $record.keepPostgres -isnot [bool] -or -not $record.keepPostgres -or [IO.Path]::GetFullPath($record.runtimeRoot) -ine [IO.Path]::GetFullPath($fixed.django)){throw 'Original maintenance scope changed'};if($name -ceq 'system-maintenance.json' -and $record.drainedStopped -eq $true){throw 'Maintenance already completed'};if($name -ceq 'automation-drain.json' -and $record.phase -cne 'requests'){throw 'Drain phase changed'}}
 if(Test-Path -LiteralPath (Join-Path $fixed.runtime 'state/worker-process.json')){throw 'Worker receipt remains'}
 $originalActor=Read-Object (Join-Path $fixed.attempt 'maintenance-first-actor.json')
 foreach($role in @('actor','rotationOwner')){foreach($field in @('processId','creationDate','executablePath','commandLine')){if($script:input.actor.$role.$field -cne $originalActor.$role.$field){throw 'Original actor identity changed'}};$actor=$originalActor.$role;if(Get-CimInstance Win32_Process -Filter ('ProcessId='+$actor.processId) -ErrorAction Stop){throw 'Original actor or owner remains'}}
 if($Action -ceq 'EnterMaintenance'){if(-not (Test-Path -LiteralPath (Join-Path $script:input.recoveryDirectory 'RECOVERY-STARTED.json'))){throw 'Missing recovery intent'};foreach($name in @('NATIVE-ENTER-STARTED.json','NATIVE-ENTER-RESULT.json','NATIVE-ENTER-FAILED.json','EnterMaintenance-result.json','EnterMaintenance-failed.json')){if(Test-Path -LiteralPath (Join-Path $script:input.recoveryDirectory $name)){throw 'Native Enter has already been attempted; no replay'}}}
 return $true
}
try{
 foreach($pin in $fixed.files.PSObject.Properties){if((Hash-File $pin.Name) -cne $pin.Value){throw 'Original native input changed before import'}}
 Import-Module (Join-Path $fixed.source 'tools/manual-maintenance-lock.psm1') -Force
 $hash=[Security.Cryptography.SHA256]::Create();try{$suffix=([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($fixed.django.Replace('/','\'))))).Replace('-','').ToLowerInvariant().Substring(0,24)}finally{$hash.Dispose()}
 Invoke-ManualMaintenanceGate -WorkerMutexName 'Local\TERUISI.Worker.LocalService.v1' -DjangoMutexName ('Local\TERUISI-DjangoSales-'+$suffix) -WaitMilliseconds 120000 -Check {Check-FixedRecovery} -Operation {
  if($Action -ceq 'Check'){@{ready=$true;maintenanceId=$fixed.maintenanceId}|ConvertTo-Json -Compress;return}
  $worker=Join-Path $fixed.runtime ('releases/'+$fixed.oldHead.releaseId+'/tools/worker-local-service.ps1')
  Save-New (Join-Path $script:input.recoveryDirectory 'NATIVE-ENTER-STARTED.json') @{at=[DateTimeOffset]::UtcNow.ToString('o');maintenanceId=$fixed.maintenanceId;inputSha256=$InputSha256;processId=$PID}
  try {
  $raw=& $worker -Action EnterMaintenance -MaintenanceId $fixed.maintenanceId -KeepPostgres -Json
  if($LASTEXITCODE -ne 0){throw 'Single same-ID native continuation did not complete; no replay'}
  $value=($raw -join "`n")|ConvertFrom-Json
  if($value.status -cne 'maintenance' -or $value.maintenanceId -cne $fixed.maintenanceId -or $value.backendStopped -isnot [bool] -or -not $value.backendStopped -or $value.postgresPreserved -isnot [bool] -or -not $value.postgresPreserved){throw 'Native continuation result remains unknown'}
  Save-New (Join-Path $script:input.recoveryDirectory 'NATIVE-ENTER-RESULT.json') @{at=[DateTimeOffset]::UtcNow.ToString('o');maintenanceId=$fixed.maintenanceId;value=$value}
  $value|ConvertTo-Json -Compress
  }catch{Save-New (Join-Path $script:input.recoveryDirectory 'NATIVE-ENTER-FAILED.json') @{at=[DateTimeOffset]::UtcNow.ToString('o');error=$_.Exception.Message;automaticRetry=$false};throw}
 }
}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}
