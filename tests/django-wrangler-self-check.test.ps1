[CmdletBinding()]
param([ValidateSet('real', 'negative')][string]$Mode = 'negative', [int]$Rounds = 3)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
# Use a short independent runtime for stability samples, like production.
# Longer storage paths are compared separately by the diagnostic matrix.
$testRoot = Join-Path ([IO.Path]::GetPathRoot($workspace)) ('wrangler-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$previousLibraryOnly = $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = '1'
try {
  . (Join-Path $workspace 'tools\django-local-service.ps1') -Action Status -RuntimeRoot $testRoot
} finally { $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = $previousLibraryOnly }
# No Deploy/Prepare/Start action, database, production config, or production state.
$testApp = Join-Path $testRoot 'app'
$cliPath = Join-Path $testApp 'runtime-tools\node_modules\wrangler\wrangler-dist\cli.js'
New-Item -ItemType Directory -Path (Split-Path $cliPath -Parent) -Force | Out-Null
$savedTemp = $env:TEMP
$savedTmp = $env:TMP
$savedConfig = $env:XDG_CONFIG_HOME
$savedLog = $env:WRANGLER_LOG_PATH
$env:TEMP = Join-Path $testRoot 'temp'
$env:TMP = $env:TEMP
$env:XDG_CONFIG_HOME = Join-Path $testRoot 'config'
$env:WRANGLER_LOG_PATH = Join-Path $testRoot 'wrangler-logs'
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
function Assert-Test([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Read-Events { return @(Get-Content -LiteralPath $LauncherLogPath | ForEach-Object { $_ | ConvertFrom-Json }) }
try {
  if ($Mode -eq 'real') {
    Copy-WranglerRuntimeClosure (Join-Path $testApp 'runtime-tools') | Out-Null
    for ($round = 1; $round -le $Rounds; $round++) {
      Assert-WranglerLocalR2RoundTrip $testApp
    }
    $events = Read-Events
    Assert-Test (@($events | Where-Object event -eq 'wrangler_roundtrip_passed').Count -eq $Rounds) 'roundtrip receipt missing'
    $rows = @($events | Where-Object event -eq 'wrangler_cli_stage' | ForEach-Object { $_.message | ConvertFrom-Json })
    Assert-Test ($rows.Count -eq 6 * $Rounds) 'stage evidence missing'
    Assert-Test (@($rows | Where-Object { $_.timedOut -or -not $_.outputComplete }).Count -eq 0) 'incomplete exit'
    Assert-Test (@($rows | Where-Object { $_.stage -eq 'missing' -and $_.exitCode -eq 1 }).Count -eq $Rounds) 'missing did not preserve real exit 1'
    Assert-Test (@($rows | Where-Object { $_.stage -ne 'missing' -and $_.exitCode -ne 0 }).Count -eq 0) 'nonzero exit swallowed'
  } else {
    # Real process failures, using only a task-owned synthetic CLI.
    [IO.File]::WriteAllText($cliPath, 'process.stderr.write("deliberate failure"); process.exit(7);')
    $run = Invoke-WranglerRuntimeProcess $testApp @('--version') 2 'exit_fixture'
    Assert-Test ($run.ExitCode -eq 7) 'real nonzero exit lost'
    [IO.File]::WriteAllText($cliPath, 'setInterval(() => {}, 1000);')
    $failed = $false
    try { Invoke-WranglerRuntimeProcess $testApp @('--version') 1 'timeout_fixture' | Out-Null } catch { $failed = $true }
    Assert-Test $failed 'timeout returned success'
    $timeout = (Read-Events | Where-Object event -eq 'wrangler_cli_stage' | Select-Object -Last 1).message | ConvertFrom-Json
    Assert-Test ($timeout.timedOut -and $timeout.started -and $null -ne $timeout.exitCode) 'timeout lost real termination status'
    $savedNode = $Node
    $Node = $cliPath # Existing nonexecutable: exercise Process.Start failure.
    $failed = $false
    try { Invoke-WranglerRuntimeProcess $testApp @('--version') 1 'launch_fixture' | Out-Null } catch { $failed = $true }
    $Node = $savedNode
    Assert-Test $failed 'launch failure returned success'
    $launch = (Read-Events | Where-Object event -eq 'wrangler_cli_stage' | Select-Object -Last 1).message | ConvertFrom-Json
    Assert-Test (-not $launch.started -and $null -eq $launch.exitCode -and $launch.phase -eq 'launch') 'launch phase lost'

    # Drive the original validation function through each semantic failure.
    $script:fault = ''
    function Assert-WranglerRuntimeCli([string]$AppRoot) { }
    function Invoke-WranglerRuntimeProcess([string]$AppRoot, [string[]]$Arguments, [int]$TimeoutSeconds, [string]$Stage) {
      $code = 0
      $out = ''
      if ($Stage -eq $script:fault) { $code = 23 }
      if ($Stage -eq 'get' -and $code -eq 0) {
        $file = $Arguments[[Array]::IndexOf($Arguments, '--file') + 1]
        $text = if ($script:fault -eq 'hash') { 'corrupted' } else { 'teruisi-wrangler-runtime-smoke-v1' }
        [IO.File]::WriteAllBytes($file, [Text.Encoding]::UTF8.GetBytes($text))
      }
      if ($Stage -eq 'missing') {
        $code = 1; $out = 'does not exist'
        if ($script:fault -eq 'missing') { $code = 23 }
        if ($script:fault -eq 'missing_zero') { $code = 0 }
        if ($script:fault -eq 'missing_message') { $out = 'unrelated failure' }
        if ($script:fault -eq 'missing_file') {
          [IO.File]::WriteAllText($Arguments[[Array]::IndexOf($Arguments, '--file') + 1], 'unexpected')
        }
      }
      return [pscustomobject]@{ ExitCode=$code; Stdout=$out; Stderr='' }
    }
    foreach ($faultCase in @('put','get','hash','delete','missing','missing_zero','missing_message','missing_file')) {
      $script:fault = $faultCase
      $failed = $false
      try { Assert-WranglerLocalR2RoundTrip $testApp } catch { $failed = $true }
      Assert-Test $failed "validation accepted $faultCase"
      $receipt = Read-Events | Where-Object event -eq 'wrangler_roundtrip_failed' | Select-Object -Last 1
      $expected = if ($faultCase.StartsWith('missing')) { 'missing' } else { $faultCase }
      Assert-Test ($receipt.message -match "stage=$expected ") "wrong failure phase for $faultCase"
    }
    Assert-Test (@(Read-Events | Where-Object event -eq 'wrangler_roundtrip_passed').Count -eq 0) 'negative test recorded success'
  }
  Write-Output "PASS: $Mode; PowerShell=$($PSVersionTable.PSVersion); evidence=$LauncherLogPath"
} finally {
  $env:TEMP = $savedTemp; $env:TMP = $savedTmp
  $env:XDG_CONFIG_HOME = $savedConfig; $env:WRANGLER_LOG_PATH = $savedLog
}
