param([Parameter(Mandatory=$true)][string]$Scratch)
$ErrorActionPreference = 'Stop'
$Scratch = [IO.Path]::GetFullPath($Scratch)
if (-not (Test-Path -LiteralPath $Scratch -PathType Container) -or @(Get-ChildItem -LiteralPath $Scratch -Force).Count) { throw 'Require empty isolated scratch' }
$env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY = '1'
. (Join-Path $PSScriptRoot '..\tools\django-postgres-maintenance.ps1') -Action Backup -Execute
$MaintenanceRequest.RuntimeRoot = $Scratch
function Assert-RuntimeChildPath($Path) {
  if (-not ([IO.Path]::GetFullPath($Path)).StartsWith($Scratch+'\')) { throw 'escaped scratch' }
  return $Path
}
function Read-JsonFile($Path,$Label) { Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
function Get-MaintenanceVolumeFree { return $script:free }
$script:free = 100
Assert-MaintenanceCapacity $Scratch 100 'boundary' | Out-Null
try { Assert-MaintenanceCapacity $Scratch 101 'boundary'; throw 'low space accepted' }
catch {
  $errorReceipt = Get-MaintenanceFailure $_ 'capacity_preflight'
  if ($errorReceipt.errorCode -ne 'capacity_insufficient' -or $errorReceipt.requiredBytes -ne 101 -or $errorReceipt.availableBytes -ne 100) { throw }
}
function Get-MaintenanceVolumeFree { throw 'Backup volume unavailable' }
try { Assert-MaintenanceCapacity $Scratch 1 'unavailable'; throw 'unavailable volume accepted' }
catch { if ($_.Exception.Message -ne 'Backup volume unavailable') { throw } }
try { throw 'password=do-not-record https://private.example/token' }
catch { if ((Get-MaintenanceFailure $_ 'fixture' | ConvertTo-Json) -match 'do-not-record|private.example') { throw 'secret leaked' } }

try { & (Join-Path $PSScriptRoot '..\tools\release-payload-retention.ps1') -Execute; throw 'uninstalled cleanup accepted' }
catch {
  $detail = Get-MaintenanceFailure $_ 'fallback'
  if ($detail.stage -ne 'deployment_preflight' -or $detail.reason -ne 'Release cleanup requires the installed operator') { throw 'cleanup lost original failure stage' }
}
$script:MaintenancePhase = 'admission'
Start-MaintenanceRun
$MaintenanceArchiveRoot = Join-Path $Scratch 'archive'
New-Item -ItemType Directory -Path $MaintenanceArchiveRoot | Out-Null
$script:verifyCalls = @()
function Invoke-MaintenanceBackup { return [pscustomobject]@{status='completed';backupId='fixture';backupDirectory=(Join-Path $Scratch 'dump');manifestSha256=('a'*64);completedAt='2026-01-01T00:00:00Z'} }
function Get-MaintenanceRetentionPolicy { return [pscustomobject]@{pins=@()} }
function Invoke-MaintenanceRetention { throw 'Protected recovery point is missing or changed' }
function Resolve-MaintenanceBackupArchive($Path,$Sha) { $script:verifyCalls += $Path }
$result = Invoke-MaintenanceBackupCycle
if ($result.status -ne 'completed' -or $result.retention.status -ne 'blocked' -or $result.backupDirectory -ne (Join-Path $Scratch 'dump') -or $script:verifyCalls.Count -ne 1) { throw 'archive failure lost verified D backup' }
$script:MaintenanceRun.result = $result
Save-MaintenanceRun 'completed'
$state = Get-MaintenanceRunStatus
if ($state.lastSuccessfulBackup -or $state.latest.result.retention.status -ne 'blocked') { throw 'blocked archive reported as successful E recovery point' }
New-Item -ItemType Directory -Path (Join-Path $MaintenanceArchiveRoot 'fixture') | Out-Null
$result = Invoke-MaintenanceBackupCycle
if ($result.backupDirectory -ne (Join-Path $MaintenanceArchiveRoot 'fixture')) { throw 'published E copy not used after prune failure' }
function Invoke-MaintenanceRetention { return [pscustomobject]@{status='completed';retained=@('fixture');removed=@()} }
$result = Invoke-MaintenanceBackupCycle
$script:MaintenanceRun.result = $result
Save-MaintenanceRun 'completed'
if ((Get-MaintenanceRunStatus).lastSuccessfulBackup.result.backupDirectory -ne (Join-Path $MaintenanceArchiveRoot 'fixture')) { throw 'successful backup missing from journal' }
Start-MaintenanceRun
Set-MaintenancePhase 'consistent_dump'
try { Start-MaintenanceRun; throw 'unresolved replay admitted' } catch { if ($_.Exception.Message -notlike '*operation is unresolved*') { throw } }
if ((Get-MaintenanceRunStatus).latest.phase -ne 'consistent_dump') { throw 'inflight phase not durable' }
try { throw 'injected dump failure' } catch { $script:MaintenanceRun.failure = Get-MaintenanceFailure $_ $script:MaintenancePhase }
Save-MaintenanceRun 'failed'
$state = Get-MaintenanceRunStatus
if ($state.latest.status -ne 'failed' -or -not $state.lastSuccessfulBackup) { throw 'failure erased prior successful backup' }
function Resolve-MaintenanceBackupArchive { throw 'copy changed' }
function Invoke-MaintenanceRetention { throw 'retention failed' }
try { Invoke-MaintenanceBackupCycle; throw 'corrupt surviving copy accepted' }
catch { if ($_.Exception.Message -ne 'copy changed') { throw } }
# Restore capacity refusal must precede creating the isolated cluster.
function Assert-NoSystemMaintenance {}
function Assert-MaintenanceRuntimeContext { return 'fixture-tool' }
function Assert-MaintenanceProtectedArchiveUnsupported {}
function Resolve-MaintenanceBackupArchive { return [pscustomobject]@{Manifest=[pscustomobject]@{version='legacy';dump=[pscustomobject]@{sizeBytes=100}}} }
function Get-PortListeners { return @() }
function Get-MaintenanceRehearsalParent { return $Scratch }
function Get-MaintenanceVolumeFree { return 0 }
$MaintenanceRequest.Execute=$true
$MaintenanceRequest.ConfirmedIsolatedRestore=$true
$MaintenanceRequest.RehearsalId='a'*12
$MaintenanceRequest.ApprovedManifestSha256='b'*64
$MaintenanceRequest.BackupDirectory=$Scratch
try { Invoke-MaintenanceRestoreRehearsal; throw 'restore accepted low capacity' }
catch { if ($_.Exception.Message -notlike '*capacity_insufficient*') { throw } }
if (Test-Path -LiteralPath (Join-Path $Scratch ('restore-'+('a'*12)))) { throw 'restore created data before preflight' }
Write-Output 'PASS: capacity boundary/unavailable/redaction, D/E survival, fail-closed reverify, persistent phases and last successful archive'
