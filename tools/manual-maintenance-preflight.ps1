param([ValidateSet('Check')][string]$Action='Check',[Parameter(Mandatory)][string]$InputPath,[Parameter(Mandatory)][string]$InputSha256,[switch]$Json)
$ErrorActionPreference='Stop'
try{
 if($InputSha256 -cnotmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath $InputPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $InputSha256){throw 'Maintenance readiness bytes changed'}
 Import-Module (Join-Path $PSScriptRoot 'manual-maintenance-process.psm1') -Force
 $readiness=Read-MaintenanceObject $InputPath
 [void](Assert-MaintenanceReadiness $readiness 'D:\teruisi-runtime\django-sales' 'D:\teruisi-runtime\teruisi-worker-sales' $PSScriptRoot)
 @{version='manual-maintenance-preflight-v1';route=$readiness.route;readinessSha256=$InputSha256;checkedAt=[DateTimeOffset]::UtcNow.ToString('o');ready=$true;provesStopped=$false}|ConvertTo-Json -Compress
}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}
