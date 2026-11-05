param(
  [ValidateSet('prepare','apply')][string]$Mode='prepare',
  [Parameter(Mandatory=$true)][string]$File,
  [Parameter(Mandatory=$true)][string]$Plan,
  [string]$PlanSha256
)
$ErrorActionPreference='Stop'
$credentialPath='D:\teruisi-runtime\django-sales\secrets\market-credentials.dpapi.json'
$authorityPath='D:\teruisi-runtime\django-sales\market-service-enabled.json'
$marketImageCredentials=[IO.File]::ReadAllText($credentialPath) | ConvertFrom-Json
$marketImageAuthority=[IO.File]::ReadAllText($authorityPath) | ConvertFrom-Json
$credentialField=if($Mode -eq 'prepare'){'databaseMarketReader'}else{'databaseMarketWriter'}
$marketImageSecure=ConvertTo-SecureString ([string]$marketImageCredentials.$credentialField)
$env:MARKET_IMAGE_BACKFILL_PASSWORD=([Management.Automation.PSCredential]::new('market',$marketImageSecure)).GetNetworkCredential().Password
$env:MARKET_IMAGE_AUTHORITY_EPOCH=[string]$marketImageAuthority.authorityEpoch
$env:MARKET_IMAGE_CUTOVER_ID=[string]$marketImageAuthority.cutoverId
$env:PYTHONUTF8='1'
try {
  $scriptArgs=@('-B',(Join-Path $PSScriptRoot 'market-workbook-image-backfill.py'),$Mode,'--file',$File,'--plan',$Plan)
  if($Mode -eq 'apply'){$scriptArgs+=@('--plan-sha256',$PlanSha256)}
  & 'D:\teruisi-runtime\django-sales\venv\Scripts\python.exe' @scriptArgs
  if($LASTEXITCODE -ne 0){throw 'Market workbook image backfill failed; transaction rolled back unless committed receipt exists'}
} finally {
  Remove-Item Env:MARKET_IMAGE_BACKFILL_PASSWORD,Env:MARKET_IMAGE_AUTHORITY_EPOCH,Env:MARKET_IMAGE_CUTOVER_ID -ErrorAction SilentlyContinue
  $marketImageSecure=$null
  $marketImageCredentials=$null
}
