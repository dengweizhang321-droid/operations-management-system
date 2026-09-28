param([Parameter(Mandatory=$true)][string]$Scratch)
$ErrorActionPreference = 'Stop'
$Scratch = [IO.Path]::GetFullPath($Scratch)
if (-not (Test-Path -LiteralPath $Scratch -PathType Container) -or @(Get-ChildItem -LiteralPath $Scratch -Force).Count) { throw 'Require empty isolated scratch' }
$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = '1'
. (Join-Path $PSScriptRoot '..\tools\django-local-service.ps1') -Action Status -RuntimeRoot $Scratch
$console = Join-Path $Scratch 'backups\console'
New-Item -ItemType Directory -Path $console -Force | Out-Null
$job = Join-Path $console ('job-' + ('a'*32) + '.json')
$script:called = $false
foreach ($status in @('queued','running','unknown','invalid')) {
  [IO.File]::WriteAllText($job, ('{"status":"' + $status + '"}'))
  try { Invoke-BackupConsoleMaintenanceFence { $script:called = $true }; throw 'active task admitted' }
  catch { if ($_.Exception.Message -notlike '*active or unresolved*') { throw } }
  if ($script:called) { throw 'maintenance ran before the backup drained' }
}
[IO.File]::WriteAllText($job, '{"status":"completed"}')
Invoke-BackupConsoleMaintenanceFence { $script:called = $true }
if (-not $script:called) { throw 'terminal job incorrectly blocks maintenance' }
$script:called = $false
$lock = [IO.FileStream]::new((Join-Path $console 'state.lock'), [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::ReadWrite)
try {
  $lock.Lock(0,1)
  try { Invoke-BackupConsoleMaintenanceFence { $script:called = $true }; throw 'competing reservation admitted' }
  catch { if ($script:called -or $_.Exception.Message -eq 'competing reservation admitted') { throw } }
} finally { $lock.Unlock(0,1); $lock.Dispose() }
[IO.File]::WriteAllText($job, '{invalid')
try { Invoke-BackupConsoleMaintenanceFence { $script:called = $true }; throw 'corrupt record admitted' }
catch { if ($script:called -or $_.Exception.Message -eq 'corrupt record admitted') { throw } }
Write-Output 'PASS: active/unknown/corrupt jobs and overlapping reservation block maintenance; terminal jobs admit it'
