param([Parameter(Mandatory=$true)][string]$Scratch)
$ErrorActionPreference='Stop'
$Scratch=[IO.Path]::GetFullPath($Scratch)
if (-not (Test-Path -LiteralPath $Scratch -PathType Container) -or @(Get-ChildItem -LiteralPath $Scratch -Force).Count) { throw 'Require empty isolated scratch' }
$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1'
$env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY='1'
. (Join-Path $PSScriptRoot '..\tools\django-local-service.ps1') -Action Status -RuntimeRoot $Scratch
. (Join-Path $PSScriptRoot '..\tools\django-postgres-maintenance.ps1') -Action Retain -RuntimeRoot $Scratch
$PostgresBin=$Scratch
function Assert-MaintenanceEvidence { throw 'legacy-business-evidence' }
function Invoke-BoundedNativeProcess { return [pscustomobject]@{ExitCode=0;Output=@(1..10)} }
$dir=Join-Path $Scratch 'archive'
New-Item -ItemType Directory -Path $dir | Out-Null
$dump=Join-Path $dir 'teruisi-sales.dump'
[IO.File]::WriteAllText($dump,'synthetic-archive')
$software=@{}
foreach($key in @('deploymentManifestSha256','serviceConfigSha256','serviceScriptSha256','operatorScriptSha256','evidenceToolSha256','pgDumpSha256','pgRestoreSha256')){$software[$key]='a'*64}
$manifest=@{version='teruisi-postgres-daily-backup-v1';status='completed';backupId='daily-20260101T010203Z-aaaaaaaaaaaa';
 createdAt='2026-01-01T01:02:03Z';completedAt='2026-01-01T01:02:04Z';
 database=@{name='teruisi_sales';host='127.0.0.1';port=5432;sourceRole='teruisi_sales_owner';consistency='exported-snapshot'};
 dump=@{fileName='teruisi-sales.dump';sizeBytes=(Get-Item -LiteralPath $dump).Length;sha256=(Get-FileSha256 $dump);archiveEntryCount=10;snapshotIdSha256=('b'*64)};
 evidence=@{};software=$software}
$manifestPath=Join-Path $dir 'backup-manifest.json'
Write-AtomicJson $manifestPath $manifest
[IO.File]::WriteAllText((Join-Path $dir 'backup-manifest.json.sha256'),(Get-FileSha256 $manifestPath))
Read-MaintenanceArchive $dir -RetentionInventory | Out-Null
$rejected=$false
try { Read-MaintenanceArchive $dir | Out-Null } catch { if($_.Exception.Message -ne 'legacy-business-evidence'){throw};$rejected=$true }
if(-not $rejected){throw 'Full evidence validation was weakened'}
foreach($action in @('Verify','RestoreRehearsal','Status','Protect')) {
 $MaintenanceRequest.Action=$action;$rejected=$false
 try { Read-MaintenanceArchive $dir -RetentionInventory | Out-Null } catch { if($_.Exception.Message -notlike '*confined to retention inventory*'){throw};$rejected=$true }
 if(-not $rejected){throw 'Non-retention operation admitted container-only evidence'}
}
$MaintenanceRequest.Action='Retain'
[IO.File]::WriteAllText($dump,'changed-container')
$rejected=$false
try { Read-MaintenanceArchive $dir -RetentionInventory | Out-Null } catch {$rejected=$true}
if(-not $rejected){throw 'Corrupt container admitted'}
Write-Output 'PASS: legacy container inventory, full survivor evidence retained, Verify/restore refusal, corrupt container refusal'
