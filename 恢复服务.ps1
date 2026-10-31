#Requires -Version 5.1
# Roll the Django code back to app.previous, leave maintenance, start services.
# The database was never touched by the failed release (verified: 153 migrations,
# target index absent, no invalid index), so this restores the exact state that
# was serving before 2026-10-30 00:28. ASCII-only on purpose (PS 5.1 GBK trap).
#
# Each step stops on failure and the transcript is saved for review.
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot 'recovery-output.txt'
"=== start $(Get-Date -Format o) ===" | Set-Content -LiteralPath $out -Encoding UTF8

function Log([string]$text) {
  Write-Host $text
  Add-Content -LiteralPath $out -Value $text -Encoding UTF8
}

# Values verified from the release state, not guessed.
$maintenanceId = 'f04a6b8c614941fab261b5211ba9162f'
$workerManifest = '66fcde0c3b95b4daa877d62d6513e7563ea489d4b03990cd1ff1f873cba66f89'
$previousManifest = '7948e85c0bea844cdc02e38fa50dc81f57c439034645fb0de952386f224b865f'
$runtime = 'D:\teruisi-runtime\django-sales'
$installed = Join-Path $runtime 'app\tools\django-local-service.ps1'
$step = Join-Path $PSScriptRoot 'tools\release-lifecycle-step.ps1'
$shell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Invoke-Step([string]$label, [string]$script, [string[]]$arguments) {
  Log ''
  Log "--- $label ---"
  $output = & $shell @('-NoProfile', '-NonInteractive', '-File', $script) @arguments 2>&1
  $code = $LASTEXITCODE
  foreach ($line in $output) { Log ([string]$line) }
  Log "exitCode=$code"
  if ($code -ne 0) { throw "$label failed with exit $code" }
}

try {
  Log 'preconditions (all verified read-only before this script was written):'
  Log "  maintenance active : $(Test-Path -LiteralPath (Join-Path $runtime 'run\system-maintenance.json'))"
  Log "  worker receipt gone: $(-not (Test-Path -LiteralPath 'D:\teruisi-runtime\teruisi-worker-sales\state\worker-process.json'))"
  Log "  app.previous ready : $(Test-Path -LiteralPath (Join-Path $runtime 'app.previous\deployment.json'))"

  # 1. Code-only rollback. Never touches migrations or business data.
  Invoke-Step 'RollbackApp' $installed @('-Action', 'RollbackApp')

  $actual = (Get-FileHash -LiteralPath (Join-Path $runtime 'app\deployment.json') -Algorithm SHA256).Hash.ToLowerInvariant()
  Log ''
  Log "installed manifest now: $actual"
  Log "expected (previous)   : $previousManifest"
  if ($actual -cne $previousManifest) { throw 'Rollback did not restore the expected manifest' }

  # 2. ACLs belong to the tree that is now installed.
  Invoke-Step 'HardenAcl' $installed @('-Action', 'HardenAcl')

  # 3. Leave the release maintenance window, then start the stack.
  Invoke-Step 'ExitMaintenance' $step @('-Step', 'ExitMaintenance', '-MaintenanceId', $maintenanceId)
  Invoke-Step 'StartWorker' $step @('-Step', 'StartWorker',
    '-ExpectedWorkerManifestSha256', $workerManifest,
    '-ExpectedDjangoManifestSha256', $previousManifest)

  Log ''
  Log '=== recovery completed; services should be serving the pre-release code ==='
}
catch {
  Log ''
  Log '=== FAILED ==='
  Log ("message: " + $_.Exception.Message)
  Log ("at: " + $_.InvocationInfo.PositionMessage)
}
finally {
  Log ''
  Log '--- listening ports ---'
  foreach ($port in 3000, 5791, 5432) {
    $listening = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue).Count -gt 0
    Log "  $port : $(if ($listening) { 'LISTENING' } else { 'down' })"
  }
  Log ''
  Log "output saved: $out"
  Read-Host 'Press Enter to close'
}
