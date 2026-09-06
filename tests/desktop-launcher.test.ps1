[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference = 'Stop'
$assembly = [Reflection.Assembly]::LoadFrom((Resolve-Path -LiteralPath $Executable).Path)
$launcherType = $assembly.GetType('Launcher')
$configType = $assembly.GetType('LauncherConfig')
$binding = [Reflection.BindingFlags]'NonPublic,Static'
$readyMethod = $launcherType.GetMethod('IsReady', $binding)
foreach ($case in @(
  @{ Text='{"ok":true,"status":"ready","backend":"django-postgresql"}'; Expected=$true },
  @{ Text='{"ok":false,"status":"degraded","backend":"django-postgresql"}'; Expected=$false },
  @{ Text='{"ok":true,"status":"ready","backend":"foreign"}'; Expected=$false },
  @{ Text='<html>wrong service</html>'; Expected=$false }
)) {
  $actual = $readyMethod.Invoke($null, @([string]$case.Text))
  if ($actual -ne $case.Expected) { throw 'Readiness accepted an invalid service response.' }
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('teruisi-launcher-test-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
$fixture = Join-Path $testRoot "controller with ' quote.ps1"
$config = [Activator]::CreateInstance($configType)
$config.ControllerPath = $fixture
$config.PowerShellPath = (Get-Command pwsh.exe -ErrorAction Stop).Source
$config.ChromePath = $config.PowerShellPath
$method = $launcherType.GetMethod('StartController', $binding)

# Exercise the real subprocess/argument/result boundary, without touching a server.
$success = @'
param([string]$Action,[switch]$Open,[switch]$Json)
if($Action -cne 'Start' -or -not $Open -or -not $Json){exit 9}
Write-Output '{"version":"teruisi-operations-system-control-v2","status":"already_running","state":"Running"}'
exit 0
'@
Set-Content -LiteralPath $fixture -Value $success -Encoding UTF8
$task = $method.Invoke($null, @($config, [string](Join-Path $testRoot 'success')))
$result = $task.GetAwaiter().GetResult()
if ($result['status'] -cne 'already_running') { throw 'Controller result was lost.' }

foreach ($failure in @(
  "Write-Output '{`"version`":`"wrong`",`"status`":`"started`",`"state`":`"Running`"}'; exit 0",
  "Write-Output '{`"version`":`"teruisi-operations-system-control-v2`",`"status`":`"started`",`"state`":`"StatusError`"}'; exit 0",
  "Write-Output '{`"version`":`"teruisi-operations-system-control-v2`",`"status`":`"started`",`"state`":`"Running`"}'; exit 7"
)) {
  Set-Content -LiteralPath $fixture -Value $failure -Encoding UTF8
  $logDirectory = Join-Path $testRoot ([Guid]::NewGuid().ToString('N'))
  $task = $method.Invoke($null, @($config, [string]$logDirectory))
  $rejected = $false
  try { $null = $task.GetAwaiter().GetResult() } catch { $rejected = $true }
  if (-not $rejected) { throw 'Invalid or failed controller was accepted.' }
}
Write-Output 'PASS: readiness identity, quoted paths, Start/Open/Json delegation, invalid receipt and nonzero exit.'
Write-Output "Isolated evidence: $testRoot"
