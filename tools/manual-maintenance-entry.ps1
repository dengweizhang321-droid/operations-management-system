param([Parameter(Mandatory)][string]$WorkerScript,[Parameter(Mandatory)][string]$MaintenanceId,
 [Parameter(Mandatory)][string]$ReviewPath,[Parameter(Mandatory)][string]$ReviewSha256,[switch]$CheckOnly)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'manual-maintenance-lock.psm1') -Force
$root='D:\teruisi-runtime\django-sales'
$expectedWorker='D:\teruisi-runtime\teruisi-worker-sales\releases\20261016T052138Z-501da6b1afc58fef\tools\worker-local-service.ps1'
function Sha([string]$File){(Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()}
function Check-KnownMaintenanceResume {
 if($WorkerScript -ine $expectedWorker -or $MaintenanceId -cne '8240a8e49492480db463a072094f1952'){throw 'Unexpected maintenance resume scope'}
 if((Sha $WorkerScript) -cne 'ca155b4cae5f1952a1da6addb6ad5e2d3ba8290b31ab9bee24b70aef1cb6040e'){throw 'Original Worker entry changed'}
 if((Sha $ReviewPath) -cne $ReviewSha256){throw 'Independent observation changed'}
 $review=[IO.File]::ReadAllText($ReviewPath)|ConvertFrom-Json
 $observed=[DateTimeOffset]::Parse($review.observedAt)
 if($review.version -cne 'manual-premaintenance-zero-effect-v1' -or $review.maintenanceId -cne $MaintenanceId -or
    $review.mainCommit -cne '7dcd013f7985e35b8f80cda6698311e2be9c3472' -or $review.operationId -cne 'd6fa5afb54c4407789f88ad07392379a' -or
    $review.independentReview -cne $true -or $review.maintenanceEffectsExcluded -cne $true -or
    $observed -gt [DateTimeOffset]::UtcNow -or ([DateTimeOffset]::UtcNow-$observed).TotalMinutes -ge 30){throw 'Independent observation is not fresh and exact'}
 if(Get-Process -Id 2900 -ErrorAction SilentlyContinue){throw 'Original actor PID is present; reconciliation required'}
 foreach($relative in @('run\system-maintenance.json','run\automation-drain.json','jd-monitor-preferences-additions\d6fa5afb54c4407789f88ad07392379a')){
  if(Test-Path -LiteralPath (Join-Path $root $relative)){throw ('Prior operation effect exists: '+$relative)}
 }
 if((Sha (Join-Path $root 'app\deployment.json')) -cne '61da6a63c5e9fb4f83e1970a6354378aba5018a925924b85ca869d6902ea7b05'){throw 'Django predecessor changed'}
 if((Sha (Join-Path $root 'run\django-supervisor-desired-state.json')) -cne '67f0f8c45db972ef4b03b6d1d2ae91e3c2f0497e1e46cfc36c788196cc90b696'){throw 'Supervisor intent changed'}
 $receipt='D:\teruisi-runtime\teruisi-worker-sales\state\worker-process.json'
 if((Sha $receipt) -cne '58a8d78dc3a2ea4e0bf7d74d503d8f2d922d2e2aebce81e9b3fb02401e6adfd4'){throw 'Original Worker process receipt changed'}
 $process=Get-CimInstance Win32_Process -Filter 'ProcessId = 33800'
 if(-not $process -or $process.CreationDate.ToUniversalTime().Ticks -ne ([DateTimeOffset]::Parse('2026-10-16T10:49:56.8552550Z')).UtcDateTime.Ticks){throw 'Original Worker process changed'}
 return $true
}
$digest=[Security.Cryptography.SHA256]::Create()
try{$suffix=([BitConverter]::ToString($digest.ComputeHash([Text.Encoding]::UTF8.GetBytes($root)))).Replace('-','').ToLowerInvariant().Substring(0,24)}finally{$digest.Dispose()}
try{
 Invoke-ManualMaintenanceGate -WorkerMutexName 'Local\TERUISI.Worker.LocalService.v1' -DjangoMutexName ('Local\TERUISI-DjangoSales-'+$suffix) -Check {Check-KnownMaintenanceResume} -Operation {
  if($CheckOnly){[Console]::Out.WriteLine('{"status":"premaintenance_admission_verified","productionExecuted":false}');return}
  # Django was released. The complete original entry can use its child Stop.
  & $WorkerScript -Action EnterMaintenance -MaintenanceId $MaintenanceId -KeepPostgres -Json
  if($LASTEXITCODE -ne 0){throw 'Original maintenance entry did not complete; reconcile this attempt'}
 }
}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}
