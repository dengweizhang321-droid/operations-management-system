param([Parameter(Mandatory)][string]$PlanPath,[Parameter(Mandatory)][string]$PlanSha256)
$ErrorActionPreference='Stop'
$id=[Security.Principal.WindowsIdentity]::GetCurrent()
if($id.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not ([Security.Principal.WindowsPrincipal]::new($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Exact administrator required'}
if($PlanSha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'Exact plan hash required'}
if((Get-FileHash -LiteralPath $PlanPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $PlanSha256){throw 'Plan bytes changed'}
$raw=[IO.File]::ReadAllText($PlanPath,[Text.UTF8Encoding]::new($false,$true))
if(-not $raw.TrimStart().StartsWith('{')){throw 'Plan must be one JSON object'}
$plan=$raw|ConvertFrom-Json -DateKind String
$module=Import-Module (Join-Path $PSScriptRoot 'startup-recovery-operations.psm1') -PassThru -Force
Initialize-StartupRecoveryOperations -Plan $plan -PlanPath $PlanPath -PlanSha256 $PlanSha256
$result=Invoke-InitializedStartupRecovery
$result|ConvertTo-Json -Depth 10 -Compress
