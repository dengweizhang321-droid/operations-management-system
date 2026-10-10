[CmdletBinding()]
param(
  [ValidateSet('plan','apply')][string]$Mode='plan',
  [Parameter(Mandatory=$true)][string]$ProposalPath,
  [string]$ApprovedSha256
)
$ErrorActionPreference='Stop'
$taskMode=$Mode.ToLowerInvariant()
$taskProposalPath=[IO.Path]::GetFullPath($ProposalPath)
$taskApprovedSha=$ApprovedSha256
$taskSourceRoot=Split-Path -Parent $PSScriptRoot
$taskProofScript=Join-Path $PSScriptRoot 'jackyun-7792-upload-proof.py'
$taskOperator=Join-Path $PSScriptRoot 'jackyun-7792-recovery.mjs'
$taskEvidenceRoot='D:\codex-artifacts\jackyun-7792-receipt-recovery-20261010'
if (-not $taskProposalPath.StartsWith($taskEvidenceRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Proposal must remain in the incident evidence directory' }
if ($taskMode -eq 'apply' -and $taskApprovedSha -cnotmatch '^[a-f0-9]{64}$') { throw 'Exact approved proposal digest required' }
$taskProofPath=Join-Path $taskEvidenceRoot ('upload-proof-'+[Guid]::NewGuid().ToString('N')+'.json')
[IO.Directory]::CreateDirectory($taskEvidenceRoot) | Out-Null
$taskPreviousLibrary=$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
$taskPreviousPassword=$env:PGPASSWORD
$taskPreviousUtf8=$env:PYTHONUTF8
try {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1'
  . 'D:\teruisi-runtime\django-sales\app\tools\django-local-service.ps1' -RuntimeRoot 'D:\teruisi-runtime\django-sales'
  $taskVault=Read-JsonFile $CredentialPath '7792 readonly upload proof'
  $taskSecret=Unprotect-Value ([string]$taskVault.databaseWriter) 'databaseWriter'
  $env:PGPASSWORD=$taskSecret
  $env:PYTHONUTF8='1'
  $taskProofOutput=& 'D:\teruisi-runtime\django-sales\venv\Scripts\python.exe' $taskProofScript
  if($LASTEXITCODE -ne 0){throw 'Readonly upload proof rejected; no recovery performed'}
  $taskProof=$taskProofOutput | ConvertFrom-Json
  if($taskProof.readOnly -ne $true -or $taskProof.claimEligible -ne $true){throw 'Original upload is not yet safely claimable'}
  [IO.File]::WriteAllText($taskProofPath,($taskProof|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
} finally {
  $env:PGPASSWORD=$taskPreviousPassword
  $env:PYTHONUTF8=$taskPreviousUtf8
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY=$taskPreviousLibrary
  $taskSecret=$null; $taskVault=$null
}
Push-Location -LiteralPath $taskSourceRoot
try {
  $taskArgs=@('--import','tsx',$taskOperator,$taskMode,'D:\运营管理系统',$taskProofPath,$taskProposalPath)
  if($taskMode -eq 'apply'){$taskArgs+=$taskApprovedSha}
  & node @taskArgs
  if($LASTEXITCODE -ne 0){throw '7792 recovery operator stopped; preserve its evidence and do not replay'}
} finally {Pop-Location}
