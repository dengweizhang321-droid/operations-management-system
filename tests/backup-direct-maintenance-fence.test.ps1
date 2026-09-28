param([Parameter(Mandatory=$true)][string]$Scratch)
$ErrorActionPreference='Stop'
$Scratch=[IO.Path]::GetFullPath($Scratch)
if (-not (Test-Path -LiteralPath $Scratch -PathType Container) -or @(Get-ChildItem -LiteralPath $Scratch -Force).Count) { throw 'Require empty scratch' }
$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1'
. (Join-Path $PSScriptRoot '..\tools\django-local-service.ps1') -Action Status -RuntimeRoot $Scratch
$env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY='1'
. (Join-Path $PSScriptRoot '..\tools\django-postgres-maintenance.ps1') -Action Backup -RuntimeRoot $Scratch -Execute
$mutexName='Local\TERUISI-DjangoPostgresMaintenance-'+(Get-Sha256Text (Get-CanonicalPath $Scratch)).Substring(0,20)
$nonce=[Guid]::NewGuid().ToString('N')
$ready=[Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::ManualReset,'Local\backup-ready-'+$nonce)
$done=[Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::ManualReset,'Local\backup-done-'+$nonce)
$code=@"
`$m=[Threading.Mutex]::new(`$false,'$mutexName')
`$r=[Threading.EventWaitHandle]::OpenExisting('Local\backup-ready-$nonce')
`$d=[Threading.EventWaitHandle]::OpenExisting('Local\backup-done-$nonce')
try { if(-not `$m.WaitOne(0)){exit 2}; `$r.Set() | Out-Null; if(-not `$d.WaitOne(15000)){exit 3} }
finally { `$m.ReleaseMutex(); `$m.Dispose(); `$r.Dispose(); `$d.Dispose() }
"@
$start=[Diagnostics.ProcessStartInfo]::new()
$start.FileName=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$start.Arguments='-NoProfile -NonInteractive -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
$start.UseShellExecute=$false; $start.CreateNoWindow=$true
$start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
$child=[Diagnostics.Process]::Start($start)
$script:called=$false
try {
  if(-not $ready.WaitOne(10000)){throw 'fixture did not acquire mutex'}
  try { Invoke-BackupConsoleMaintenanceFence {$script:called=$true}; throw 'maintenance admitted during direct backup' }
  catch { if ($_.Exception.Message -notlike '*backup or verification is active*') {throw} }
  if($script:called){throw 'maintenance callback ran'}
} finally {
  $done.Set() | Out-Null
  if(-not $child.WaitForExit(10000)){throw 'fixture did not exit'}
  $ready.Dispose();$done.Dispose()
}
if($child.ExitCode -ne 0){throw 'fixture failed'}
$child.Dispose()
Invoke-BackupConsoleMaintenanceFence {$script:called=$true}
if(-not $script:called){throw 'completed backup still blocks maintenance'}
New-Item -ItemType Directory -Path (Join-Path $Scratch 'run') -Force | Out-Null
Write-AtomicJson $MaintenancePath @{version='teruisi-system-maintenance-v1';id=('a'*32);runtimeRoot=$Scratch;keepPostgres=$true}
function Assert-MaintenanceRuntimeContext {throw 'source touched before maintenance rejection'}
foreach($action in @('Backup','RestoreRehearsal')) {
  try {
    if($action -eq 'Backup'){Invoke-MaintenanceBackup}else{Invoke-MaintenanceRestoreRehearsal}
    throw 'active maintenance accepted'
  } catch {if($_.Exception.Message -notlike 'System maintenance is active:*'){throw}}
}
Write-Output 'PASS: cross-process PG mutex rejects maintenance, completed operation releases gate, maintenance rejects backup/restore before source access'
