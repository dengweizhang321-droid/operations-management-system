param([Parameter(Mandatory=$true)][string]$Scratch)
$ErrorActionPreference='Stop'
$Scratch=[IO.Path]::GetFullPath($Scratch)
if (-not (Test-Path -LiteralPath $Scratch -PathType Container) -or @(Get-ChildItem -LiteralPath $Scratch -Force).Count) { throw 'Require empty isolated scratch' }
$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1'
$env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY='1'
. (Join-Path $PSScriptRoot '..\tools\django-local-service.ps1') -Action Status -RuntimeRoot (Join-Path $Scratch 'runtime')
. (Join-Path $PSScriptRoot '..\tools\django-postgres-maintenance.ps1') -Action Status -RuntimeRoot (Join-Path $Scratch 'runtime')
$rawPolicy=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\tools\postgres-backup-retention.ps1'),[Text.Encoding]::UTF8)
$expectedArchive=[regex]::Match($rawPolicy, "(?m)^\`$MaintenanceArchiveRoot = '([^']+)'").Groups[1].Value
if (-not $expectedArchive -or $MaintenanceArchiveRoot -cne $expectedArchive) { throw 'Archive root Unicode did not round-trip through this PowerShell host' }
$originalRuntime=$RuntimeRoot
$MaintenanceArchiveRoot=Join-Path $Scratch 'archive'
$parentBefore=(Get-Acl -LiteralPath $Scratch).Sddl
$created=Assert-MaintenanceArchiveRoot $true
if ($created -ine $MaintenanceArchiveRoot -or $RuntimeRoot -ine $originalRuntime) { throw 'Archive ACL changed runtime identity' }
Assert-MaintenanceArchiveRoot | Out-Null
$child=Join-Path $MaintenanceArchiveRoot 'fixture.dump'
[IO.File]::WriteAllText($child,'fixture')
$allowed=@((Get-AllowedAclSids) | ForEach-Object {$_.Value})
$item=Get-Item -LiteralPath $child
Assert-ExactRuntimeAclEntry $item (Get-RuntimeItemAccessControl $item) $allowed $MaintenanceArchiveRoot
if ((Get-Acl -LiteralPath $Scratch).Sddl -cne $parentBefore) { throw 'Parent ACL changed' }
$rejected=$false
try { Set-DirectoryDaclOnly $MaintenanceArchiveRoot (New-RuntimeRootDacl) }
catch { $rejected=$true }
if (-not $rejected) { throw 'Runtime boundary bypassed' }
Write-Output 'PASS: archive root and inherited child ACL, unchanged parent/runtime, original runtime-only guard preserved'
