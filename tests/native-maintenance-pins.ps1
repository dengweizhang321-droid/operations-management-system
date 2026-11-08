param([string]$ReadinessPath,[string]$DjangoRoot,[string]$WorkerRoot,[string]$SourceTools)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../tools/manual-maintenance-process.psm1') -Force
$record=Read-MaintenanceObject $ReadinessPath
[void](Assert-MaintenanceReadiness $record $DjangoRoot $WorkerRoot $SourceTools)
Write-Output 'verified_private_maintenance_pins'
