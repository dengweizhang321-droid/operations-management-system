param([Parameter(Mandatory=$true)][string]$Scratch)
$ErrorActionPreference = 'Stop'
$Scratch = [IO.Path]::GetFullPath($Scratch)
if (-not (Test-Path -LiteralPath $Scratch -PathType Container) -or @(Get-ChildItem -LiteralPath $Scratch -Force).Count) { throw 'Require an empty explicit scratch directory' }
$env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY = '1'
. (Join-Path $PSScriptRoot '..\tools\django-postgres-maintenance.ps1') -Action Retain -Execute -ConfirmedPrune
$MaintenanceArchiveRoot = Join-Path $Scratch 'archive'
$testDaily = Join-Path $Scratch 'daily'
New-Item -ItemType Directory -Path $MaintenanceArchiveRoot,$testDaily | Out-Null
$MaintenanceRequest.RuntimeRoot = $Scratch
$script:events = [Collections.Generic.List[string]]::new()
$script:badCopy = $false
function Assert-MaintenanceRuntimeContext {}
function Get-MaintenanceBackupRoot { return $testDaily }
function Assert-MaintenanceArchiveRoot { return $MaintenanceArchiveRoot }
function Get-MaintenanceCanonicalPath([string]$Path) { return [IO.Path]::GetFullPath($Path).TrimEnd('\') }
function Get-MaintenanceRetentionPolicy { return $script:policy }
function Write-MaintenanceRetentionAudit($Value) { $script:events.Add($Value.event) }
function Resolve-MaintenanceBackupArchive([string]$RequestedDirectory,[string]$ApprovedSha256='') {
  $parent = Split-Path -Parent $RequestedDirectory
  if ($parent -ine $testDaily -and $parent -ine $MaintenanceArchiveRoot) { throw 'unsafe target' }
  return Read-MaintenanceArchive $RequestedDirectory $ApprovedSha256
}
function Read-MaintenanceArchive([string]$Directory,[string]$ApprovedSha256='') {
  if ($script:badCopy -and $Directory.Contains('.incomplete')) { throw 'injected copy failure' }
  $manifest = Get-Content -LiteralPath (Join-Path $Directory 'backup-manifest.json') -Raw | ConvertFrom-Json
  $sha = (Get-FileHash -LiteralPath (Join-Path $Directory 'backup-manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ApprovedSha256 -and $sha -cne $ApprovedSha256) { throw 'changed manifest' }
  if ((Get-FileHash -LiteralPath (Join-Path $Directory 'teruisi-sales.dump') -Algorithm SHA256).Hash -ine $manifest.dump.sha256) { throw 'changed dump' }
  return [pscustomobject]@{Directory=$Directory;ManifestSha256=$sha;Manifest=$manifest}
}
function New-TestBackup([int]$Day) {
  $id = 'daily-202601{0:00}T010203Z-aaaaaaaaaaaa' -f $Day
  $dir = Join-Path $testDaily $id
  New-Item -ItemType Directory -Path $dir | Out-Null
  [IO.File]::WriteAllText((Join-Path $dir 'teruisi-sales.dump'), 'fixture-'+$Day)
  $dump = (Get-FileHash -LiteralPath (Join-Path $dir 'teruisi-sales.dump') -Algorithm SHA256).Hash.ToLowerInvariant()
  $json = @{backupId=$id;completedAt=('2026-01-{0:00}T01:02:04Z' -f $Day);dump=@{sha256=$dump}} | ConvertTo-Json -Compress
  [IO.File]::WriteAllText((Join-Path $dir 'backup-manifest.json'),$json)
  $sha = (Get-FileHash -LiteralPath (Join-Path $dir 'backup-manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText((Join-Path $dir 'backup-manifest.json.sha256'),$sha)
  return [pscustomobject]@{backupId=$id;manifestSha256=$sha}
}
$first = New-TestBackup 1
2..5 | ForEach-Object { New-TestBackup $_ | Out-Null }
$script:policy = [pscustomobject]@{pins=@($first)}
$script:badCopy = $true
try { Invoke-MaintenanceRetention | Out-Null; throw 'accepted failed copy' } catch { if ($_.Exception.Message -notlike '*injected copy failure*') { throw } }
if (@(Get-ChildItem -LiteralPath $testDaily -Directory).Count -ne 5 -or $script:events.Contains('deleted')) { throw 'old backup deleted before publication' }
$script:badCopy = $false
$result = Invoke-MaintenanceRetention
if (@($result.retained).Count -ne 3 -or $result.retained -cnotcontains $first.backupId) { throw 'pin or count failed' }
if (@(Get-ChildItem -LiteralPath $testDaily -Directory).Count -ne 0) { throw 'D duplicates remain' }
if (@(Get-ChildItem -LiteralPath $MaintenanceArchiveRoot -Directory | Where-Object Name -Like 'daily-*').Count -ne 3) { throw 'E count failed' }
if ($script:events.IndexOf('delete-reserved') -lt $script:events.IndexOf('plan')) { throw 'audit order invalid' }
$second = Invoke-MaintenanceRetention
if (@($second.removed).Count) { throw 'repeat prune is not idempotent' }
$script:policy.pins = @([pscustomobject]@{backupId=$first.backupId;manifestSha256=('b'*64)})
try { Invoke-MaintenanceRetention | Out-Null; throw 'accepted stale pin' } catch { if ($_.Exception.Message -notlike '*missing or changed*') { throw } }
if (@(Get-ChildItem -LiteralPath $MaintenanceArchiveRoot -Directory | Where-Object Name -Like 'daily-*').Count -ne 3) { throw 'stale pin deleted backup' }
Write-Output 'PASS: copy-before-delete, protected slot, count=3, D cleanup, repeat, changed pin refusal'
