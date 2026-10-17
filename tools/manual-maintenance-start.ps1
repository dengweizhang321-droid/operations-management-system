param([ValidateSet('EnterMaintenance')][string]$Action='EnterMaintenance',
 [Parameter(Mandatory)][string]$InputPath,[Parameter(Mandatory)][string]$InputSha256,[switch]$Json)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'manual-maintenance-lock.psm1') -Force
$djangoRoot='D:\teruisi-runtime\django-sales'
$workerRoot='D:\teruisi-runtime\teruisi-worker-sales'
function Sha([string]$File){(Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()}
function Save-OriginalRecord([string]$Name,[object]$Value){
 $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 10 -Compress)+"`n")
 $stream=[IO.File]::Open((Join-Path (Split-Path -Parent $InputPath) $Name),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
 try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
}
function Get-OriginalActor([int]$ProcessId){
 $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ProcessId) -ErrorAction Stop
 if(-not $p -or -not $p.ExecutablePath -or -not $p.CommandLine -or -not $p.CreationDate){throw 'Original actor identity is unavailable'}
 return @{processId=[int]$p.ProcessId;creationDate=$p.CreationDate.ToUniversalTime().ToString('o');executablePath=[string]$p.ExecutablePath;commandLine=[string]$p.CommandLine}
}
function Check-FirstAttempt {
 if($InputSha256 -cnotmatch '^[a-f0-9]{64}$' -or (Sha $InputPath) -cne $InputSha256){throw 'Maintenance admission bytes changed'}
 $raw=[IO.File]::ReadAllText($InputPath)
 if(-not $raw.TrimStart().StartsWith('{')){throw 'Maintenance admission must be an object'}
 $admission=$raw|ConvertFrom-Json
 if($admission -isnot [pscustomobject] -or $admission.version -cne 'manual-maintenance-first-attempt-v2'){throw 'Invalid maintenance admission'}
 foreach($field in @('workerScript','workerScriptSha256','workerReceiptSha256','djangoManifestSha256','maintenanceId','preparedAt')){
  if($admission.$field -isnot [string]){throw ('Invalid admission field: '+$field)}
 }
 foreach($field in @('workerScriptSha256','workerReceiptSha256','djangoManifestSha256')){if($admission.$field -cnotmatch '^[a-f0-9]{64}$'){throw 'Invalid admission hash'}}
 if($admission.maintenanceId -cnotmatch '^[a-f0-9]{32}$'){throw 'Invalid maintenance ID'}
 $prepared=[DateTimeOffset]::Parse($admission.preparedAt)
 if($prepared -gt [DateTimeOffset]::UtcNow -or ([DateTimeOffset]::UtcNow-$prepared).TotalMinutes -ge 10){throw 'Maintenance admission expired'}
 $script=[IO.Path]::GetFullPath($admission.workerScript)
 $prefix=[IO.Path]::GetFullPath((Join-Path $workerRoot 'releases'))+'\'
 if(-not $script.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or $script.Substring($prefix.Length) -cnotmatch '^[a-zA-Z0-9-]+\\tools\\worker-local-service\.ps1$'){throw 'Unexpected original Worker entry'}
 foreach($relative in @('run\system-maintenance.json','run\automation-drain.json')){if(Test-Path -LiteralPath (Join-Path $djangoRoot $relative)){throw 'Existing maintenance or drain; reconcile before another attempt'}}
 if((Sha $script) -cne $admission.workerScriptSha256){throw 'Original Worker entry changed'}
 if((Sha (Join-Path $workerRoot 'state\worker-process.json')) -cne $admission.workerReceiptSha256){throw 'Original Worker receipt changed'}
 if((Sha (Join-Path $djangoRoot 'app\deployment.json')) -cne $admission.djangoManifestSha256){throw 'Django predecessor changed'}
 if($admission.rotationOwnerPid -isnot [int] -or $admission.rotationOwnerPid -le 0 -or $admission.sourcePins -isnot [pscustomobject]){throw 'Original invocation binding is missing'}
 if((Sha $PSCommandPath) -cne $admission.sourcePins.'manual-maintenance-start.ps1'){throw 'Original adapter source changed'}
 if((Sha (Join-Path $PSScriptRoot 'manual-maintenance-lock.psm1')) -cne $admission.sourcePins.'manual-maintenance-lock.psm1'){throw 'Original mutex adapter changed'}
 Save-OriginalRecord 'maintenance-first-actor.json' @{version='manual-maintenance-original-actor-v1';at=[DateTimeOffset]::UtcNow.ToString('o');admissionSha256=$InputSha256;maintenanceId=$admission.maintenanceId;helperSha256=(Sha $PSCommandPath);actor=(Get-OriginalActor $PID);rotationOwner=(Get-OriginalActor $admission.rotationOwnerPid)}
 $script:originalWorker=$script
 $script:admissionId=$admission.maintenanceId
 return $true
}
$digest=[Security.Cryptography.SHA256]::Create()
try{$suffix=([BitConverter]::ToString($digest.ComputeHash([Text.Encoding]::UTF8.GetBytes($djangoRoot)))).Replace('-','').ToLowerInvariant().Substring(0,24)}finally{$digest.Dispose()}
try{
 $wait=120000
 if($env:TERUISI_PROCESS_DEADLINE_UNIX_MS){$deadline=[long]0;if(-not [long]::TryParse($env:TERUISI_PROCESS_DEADLINE_UNIX_MS,[ref]$deadline)){throw 'Invalid inherited process deadline'};$wait=[int][Math]::Min($wait,[Math]::Max(0,$deadline-[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()));if($wait -le 0){throw 'Inherited process deadline exhausted'}}
 Invoke-ManualMaintenanceGate -WorkerMutexName 'Local\TERUISI.Worker.LocalService.v1' -DjangoMutexName ('Local\TERUISI-DjangoSales-'+$suffix) -WaitMilliseconds $wait -Check {Check-FirstAttempt} -Operation {
  $nativeRaw=& $script:originalWorker -Action EnterMaintenance -MaintenanceId $script:admissionId -KeepPostgres -Json
  if($LASTEXITCODE -ne 0){throw 'Original maintenance entry did not complete; reconcile this attempt'}
  $native=($nativeRaw -join "`n")|ConvertFrom-Json
  if($native -isnot [pscustomobject] -or $native.status -cne 'maintenance' -or $native.maintenanceId -cne $script:admissionId -or $native.postgresPreserved -isnot [bool] -or -not $native.postgresPreserved -or $native.backendStopped -isnot [bool] -or -not $native.backendStopped){throw 'Original maintenance result is unknown'}
  Save-OriginalRecord 'maintenance-first-native-complete.json' @{at=[DateTimeOffset]::UtcNow.ToString('o');admissionSha256=$InputSha256;maintenanceId=$script:admissionId;actorProcessId=[int]$PID;exitCode=0;value=$native}
  $native|ConvertTo-Json -Depth 10 -Compress
 }
}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}
