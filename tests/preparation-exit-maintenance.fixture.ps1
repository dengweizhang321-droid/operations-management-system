[CmdletBinding()]
param([string]$EvidenceDirectory)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$source = [IO.File]::ReadAllText((Join-Path $workspace 'tools\django-local-service.ps1'))
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Candidate PowerShell parse failed' }
$gitInfo = [Diagnostics.ProcessStartInfo]::new()
$gitInfo.FileName = 'git'
$gitInfo.Arguments = 'show f641685b60ca11a674da713e3b7b454f338c622c:tools/django-local-service.ps1'
$gitInfo.WorkingDirectory = $workspace
$gitInfo.UseShellExecute = $false
$gitInfo.CreateNoWindow = $true
$gitInfo.RedirectStandardOutput = $true
$gitInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new()
$gitProcess = [Diagnostics.Process]::Start($gitInfo)
$before = $gitProcess.StandardOutput.ReadToEnd()
$gitProcess.WaitForExit()
if ($gitProcess.ExitCode -ne 0) { throw 'Baseline read failed' }
$gitProcess.Dispose()
$beforeAst = [Management.Automation.Language.Parser]::ParseInput($before, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Baseline PowerShell parse failed' }
function Functions($tree) {
  $map = @{}
  foreach ($f in $tree.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]}, $true)) { $map[$f.Name] = $f.Extent.Text.Replace("`r`n", "`n") }
  return $map
}
$oldFunctions = Functions $beforeAst
$newFunctions = Functions $ast
$changed = @()
foreach ($name in $oldFunctions.Keys) {
  if (-not $newFunctions.ContainsKey($name)) { throw "Removed function: $name" }
  if ($newFunctions[$name] -cne $oldFunctions[$name]) { $changed += $name }
}
if (($changed | Sort-Object) -join ',' -cne 'Assert-ApplicationTreeManifest,Assert-WranglerRuntimeCli') { throw "Unexpected modified functions: $changed" }
$added = @($newFunctions.Keys | Where-Object { -not $oldFunctions.ContainsKey($_) })
if ($added.Count -ne 1 -or $added[0] -cne 'Assert-WranglerRuntimeFacts') { throw 'Unexpected added function' }
# Parse/exercise only the affected fact function. No runtime library or action dispatch.
Invoke-Expression $newFunctions['Assert-WranglerRuntimeFacts']
function Read-JsonFile([string]$Path, [string]$Label) { return [IO.File]::ReadAllText($Path) | ConvertFrom-Json }
function Invoke-WranglerRuntimeProcess { throw 'Wrangler process must never run at the gate' }
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('exit-maintenance-' + [Guid]::NewGuid().ToString('N'))
$pkgRoot = Join-Path $testRoot 'runtime-tools\node_modules\wrangler'
New-Item -ItemType Directory -Path $pkgRoot -Force | Out-Null
function Save-Fixture($Closure, $Package) {
  [IO.File]::WriteAllText((Join-Path $testRoot 'runtime-tools\wrangler-dependencies.json'), (ConvertTo-Json -InputObject $Closure -Depth 6 -Compress))
  [IO.File]::WriteAllText((Join-Path $pkgRoot 'package.json'), (ConvertTo-Json -InputObject $Package -Depth 4 -Compress))
}
function Assert-Rejected($Closure, $Package) {
  Save-Fixture $Closure $Package
  $rejected = $false
  try { Assert-WranglerRuntimeFacts $testRoot | Out-Null } catch { $rejected = $true }
  if (-not $rejected) { throw 'Invalid installed version facts accepted' }
}
try {
  $closure = @{version=1;rootPackage='wrangler';rootVersion='4.92.0';packages=@(@{name='wrangler';version='4.92.0'},@{name='workerd';version='1.0.0'})}
  $package = @{name='wrangler';version='4.92.0'}
  Save-Fixture $closure $package
  if ((Assert-WranglerRuntimeFacts $testRoot) -cne '4.92.0') { throw 'Installed facts failed' }
  Assert-Rejected $closure @{name='wrangler';version='4.91.0'}
  Assert-Rejected $closure @{name='wrong';version='4.92.0'}
  Assert-Rejected $closure @{name='wrangler';version=@('4.92.0')}
  Assert-Rejected $closure @(@{name='wrangler';version='4.92.0'})
  $bad = @{version=1;rootPackage='wrangler';rootVersion='4.92.0';packages=@(@{name='wrangler';version='4.92.0'},@{name='wrangler';version='4.92.0'})}
  Assert-Rejected $bad $package
  # Old tree gate spawned CLI version/help. New tree gate consumes only installed facts.
  if ($oldFunctions['Assert-ApplicationTreeManifest'] -notmatch 'Assert-WranglerRuntimeCli \$AppRoot') { throw 'Original probe path not found' }
  if ($newFunctions['Assert-ApplicationTreeManifest'] -match 'Assert-WranglerRuntimeCli' -or
      $newFunctions['Assert-ApplicationTreeManifest'] -notmatch 'Assert-WranglerRuntimeFacts \$AppRoot') { throw 'Gate still launches CLI' }
  if ($newFunctions['Assert-WranglerRuntimeFacts'] -match 'Invoke-WranglerRuntimeProcess') { throw 'Facts spawn CLI' }
  foreach ($name in @('End-SystemMaintenance','Begin-SystemMaintenance','Complete-AutomationMaintenanceStop','Invoke-WithServiceMutex','Invoke-AutomationPgDrainFence','Invoke-BackupConsoleMaintenanceFence')) {
    if ($oldFunctions[$name] -cne $newFunctions[$name]) { throw "Gate changed: $name" }
  }
  $result = @{status='passed';shellVersion=$PSVersionTable.PSVersion.ToString();before='tree-manifest -> CLI --version (15s) + CLI help (15s)';after='tree-manifest -> installed package/closure version facts';unchangedGateFunctions=6;negativeFactCases=5;productionActions=$false}
  if ($EvidenceDirectory) { New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null; [IO.File]::WriteAllText((Join-Path $EvidenceDirectory ('ps-' + $PSVersionTable.PSVersion.Major + '.json')), ($result | ConvertTo-Json -Depth 3)) }
  $result | ConvertTo-Json -Depth 3 -Compress
} finally {
  $resolved = [IO.Path]::GetFullPath($testRoot)
  if (-not $resolved.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture cleanup escaped temp' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
