param([ValidateSet('EnterMaintenance')][string]$Action='EnterMaintenance',
 [Parameter(Mandatory)][string]$InputPath,[Parameter(Mandatory)][string]$InputSha256,[switch]$Json)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'manual-maintenance-lock.psm1') -Force
$djangoRoot='D:\teruisi-runtime\django-sales'
$workerRoot='D:\teruisi-runtime\teruisi-worker-sales'
function Sha([string]$File){(Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()}
function Check-FirstAttempt {
 if($InputSha256 -cnotmatch '^[a-f0-9]{64}$' -or (Sha $InputPath) -cne $InputSha256){throw 'Maintenance admission bytes changed'}
 $raw=[IO.File]::ReadAllText($InputPath)
 if(-not $raw.TrimStart().StartsWith('{')){throw 'Maintenance admission must be an object'}
 $admission=$raw|ConvertFrom-Json
 if($admission -isnot [pscustomobject] -or $admission.version -cne 'manual-maintenance-first-attempt-v1'){throw 'Invalid maintenance admission'}
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
 $script:originalWorker=$script
 $script:admissionId=$admission.maintenanceId
 return $true
}
$digest=[Security.Cryptography.SHA256]::Create()
try{$suffix=([BitConverter]::ToString($digest.ComputeHash([Text.Encoding]::UTF8.GetBytes($djangoRoot)))).Replace('-','').ToLowerInvariant().Substring(0,24)}finally{$digest.Dispose()}
try{
 Invoke-ManualMaintenanceGate -WorkerMutexName 'Local\TERUISI.Worker.LocalService.v1' -DjangoMutexName ('Local\TERUISI-DjangoSales-'+$suffix) -WaitMilliseconds 120000 -Check {Check-FirstAttempt} -Operation {
  & $script:originalWorker -Action EnterMaintenance -MaintenanceId $script:admissionId -KeepPostgres -Json
  if($LASTEXITCODE -ne 0){throw 'Original maintenance entry did not complete; reconcile this attempt'}
 }
}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}
