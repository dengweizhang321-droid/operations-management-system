[CmdletBinding()]
param([Parameter(Mandatory)][string]$ApprovedRequestSha256,[Parameter(Mandatory)][string]$ApprovedRotationWitnessSha256,[switch]$Execute)
$ErrorActionPreference='Stop'
$fixedOut='D:\codex-artifacts\ai-schedules-production-20261015'
try{
  if(-not $Execute -or $ApprovedRequestSha256 -cnotmatch '^[a-f0-9]{64}$' -or $ApprovedRotationWitnessSha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'exact_approval_required'}
  $requestPath=Join-Path $fixedOut 'afterbackup-settlement-request.json'
  if((Get-FileHash -LiteralPath $requestPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ApprovedRequestSha256){throw 'request_sha_drift'}
  $raw=[IO.File]::ReadAllText($requestPath,[Text.UTF8Encoding]::new($false,$true)).TrimStart([char]0xfeff).Trim()
  if(-not $raw.StartsWith('{')){throw 'request_object_required'}
  $request=$raw | ConvertFrom-Json
  $modulePath=Join-Path $fixedOut 'recovery\exact-afterbackup-settlement.psm1'
  if((Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $request.adapterSha256 -or
     (Get-FileHash -LiteralPath $modulePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $request.moduleSha256){throw 'recovery_code_drift'}
  Import-Module $modulePath -Force
  $result=Invoke-ExactAfterBackupSettlement -ApprovedRequestSha256 $ApprovedRequestSha256 -ApprovedRotationWitnessSha256 $ApprovedRotationWitnessSha256 -Execute
  $result | ConvertTo-Json -Depth 8 -Compress
}catch{
  # No generic recovery, no retry and no replacement of the external unknown.
  [pscustomobject]@{status='blocked';originalOperationId='d4ae1a82639343b8a5e2347694ebe0f4';databaseBackupReplayed=$false;
    reasonCode=([string]$_.Exception.Message -replace '[^a-z_0-9]','_')} | ConvertTo-Json -Compress
  exit 1
}
