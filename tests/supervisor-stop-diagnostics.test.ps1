$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('supervisor-stop-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory((Join-Path $testRoot 'state')) | Out-Null
try {
  . (Join-Path $PSScriptRoot '..\tools\worker-local-service.ps1') -FunctionsOnly -RuntimeRoot $testRoot -AllowTestRuntimeRoot
  $snapshot = @{Supervisor=@{ProcessId=12345;CreationDate=[datetime]'2026-09-29T01:02:03Z'};Identity=@{Sha256=('a'*64)}}
  foreach ($mode in @('Stop','EnterMaintenance','Start')) {
    $Action=$mode
    Write-WorkerStopDiagnostic $snapshot 'requested'
    Write-WorkerStopDiagnostic $snapshot 'supervisor_absent'
    $record=Get-Content (Join-Path $testRoot 'state\worker-last-controlled-stop.json') -Raw | ConvertFrom-Json
    if ($record.action -cne $mode -or $record.phase -cne 'supervisor_absent' -or $record.supervisorPid -ne 12345 -or $record.manifestSha256 -cne ('a'*64)) {throw 'Stop identity/action missing'}
    if (@(Get-ChildItem (Join-Path $testRoot 'state')).Count -ne 1) {throw 'Diagnostic leaked temporary files'}
  }
  & {
    # Execute the real stop function with synthetic process reads/termination;
    # never stop an OS process. The sweep sentinel ends after the absent fence.
    $snapshot.State='exact_release'; $snapshot.Tree=@()
    $script:fixtureAlive=$true; $script:fixtureIdentity=$false; $script:fixtureStops=0
    function Get-ExactCurrentProcess { if ($script:fixtureAlive) { return $snapshot.Supervisor } }
    function Test-SameProcessIdentity { return $script:fixtureIdentity }
    function Test-AllowedTreeProcess { return $true }
    function Stop-ExactProcessIdentity { $script:fixtureStops++; $script:fixtureAlive=$false }
    function Get-ControlledStopSweep { throw 'fixture-sweep-end' }
    $target=Join-Path $testRoot 'state\worker-last-controlled-stop.json'
    $before=[IO.File]::ReadAllText($target)
    try { Stop-ExactWorkerSnapshot $snapshot; throw 'identity mismatch accepted' }
    catch { if ($_.Exception.Message -notmatch 'identity changed before Stop') {throw} }
    if ($script:fixtureStops -ne 0 -or [IO.File]::ReadAllText($target) -cne $before) {throw 'unverified identity was recorded or stopped'}
    $script:fixtureIdentity=$true; $Action='EnterMaintenance'
    try { Stop-ExactWorkerSnapshot $snapshot; throw 'sweep sentinel missing' }
    catch { if ($_.Exception.Message -cne 'fixture-sweep-end') {throw} }
    $record=Get-Content $target -Raw | ConvertFrom-Json
    if ($script:fixtureStops -ne 1 -or $record.action -cne 'EnterMaintenance' -or $record.phase -cne 'supervisor_absent') {throw 'real stop fence diagnostic missing'}
  }
  # Observational failure must not prevent the original controlled stop.
  $RuntimeRoot=Join-Path $testRoot 'missing'
  $diagnosticWarnings = @(Write-WorkerStopDiagnostic $snapshot 'requested' 3>&1)
  if (-not ($diagnosticWarnings -match 'worker_stop_diagnostic_unavailable')) {throw 'Diagnostic failure was not visible'}
  Write-Output 'controlled stop, maintenance, startup cleanup, bounded replacement and unavailable sink passed'
} finally {
  if ([IO.Path]::GetDirectoryName($testRoot) -ne [IO.Path]::GetTempPath().TrimEnd('\')) {throw 'Unsafe fixture cleanup'}
  Remove-Item -LiteralPath $testRoot -Recurse -Force
}
