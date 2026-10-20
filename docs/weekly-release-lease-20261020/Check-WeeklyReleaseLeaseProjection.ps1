[CmdletBinding()]
param(
  [string]$SourceRoot = '',
  [string]$BaselineCommit = 'origin/main',
  [string]$EvidencePath = ''
)
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if ($PSVersionTable.PSVersion.Major -eq 5) {
  $env:PSModulePath = Join-Path $PSHOME 'Modules'
}
if (-not $SourceRoot) { $SourceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
$path = Join-Path $SourceRoot 'tools\django-workflow-service.ps1'
$baselineSha = (& git -C $SourceRoot rev-parse --verify ($BaselineCommit + '^{commit}')).Trim()
if ($LASTEXITCODE -ne 0 -or -not $baselineSha) { throw 'Could not resolve baseline commit' }
$baselineLines = @(& git -C $SourceRoot show ($baselineSha + ':tools/django-workflow-service.ps1'))
if ($LASTEXITCODE -ne 0) { throw 'Could not read baseline Git object' }
$source = [IO.File]::ReadAllText($path).Replace("`r`n", "`n").TrimEnd("`n")
$baseline = ($baselineLines -join "`n").Replace("`r`n", "`n").TrimEnd("`n")
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Workflow parse failed' }
$functionNames = @(
  'Get-NewProductWeeklyReportReleaseLeaseDeferral',
  'Invoke-NewProductWeeklyReportWithReleaseLease'
)
$definitions = @()
foreach ($name in $functionNames) {
  $found = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  if ($found.Count -ne 1) { throw "Expected exactly one new function: $name" }
  $definitions += $found[0]
  if ($baseline.Contains($name)) { throw "Baseline already contains the new function: $name" }
}
foreach ($definition in ($definitions | Sort-Object { $_.Extent.StartOffset } -Descending)) {
  $start = $definition.Extent.StartOffset
  $end = $definition.Extent.EndOffset
  if ($source.Substring($end, 2) -cne "`n`n") { throw 'Unexpected function boundary' }
  $source = $source.Remove($start, $end - $start + 2)
}
$newLines = @(
  '    "RunWeeklyReport" { Invoke-NewProductWeeklyReportWithReleaseLease $false $false }',
  '    "ForceWeeklyReport" { Invoke-NewProductWeeklyReportWithReleaseLease $false $true }',
  '    "DryRunWeeklyReport" { Invoke-NewProductWeeklyReportWithReleaseLease $true $false }'
)
$oldLines = @(
  '    "RunWeeklyReport" { Invoke-WithServiceMutex { Invoke-NewProductWeeklyReport $false $false } }',
  '    "ForceWeeklyReport" { Invoke-WithServiceMutex { Invoke-NewProductWeeklyReport $false $true } }',
  '    "DryRunWeeklyReport" { Invoke-WithServiceMutex { Invoke-NewProductWeeklyReport $true $false } }'
)
for ($index = 0; $index -lt $newLines.Count; $index++) {
  if ([regex]::Matches($source, [regex]::Escape($newLines[$index])).Count -ne 1) { throw "Expected one release-lease dispatch line: $index" }
  if (-not $baseline.Contains($oldLines[$index])) { throw "Baseline dispatch line missing: $index" }
  $source = $source.Replace($newLines[$index], $oldLines[$index])
}
$projected = $source.TrimEnd("`n")
if ($projected -cne $baseline) {
  $projectedLines = $projected.Split("`n")
  $baselineFileLines = $baseline.Split("`n")
  $limit = [Math]::Min($projectedLines.Count, $baselineFileLines.Count)
  $line = 0
  for ($index = 0; $index -lt $limit; $index++) {
    if ($projectedLines[$index] -cne $baselineFileLines[$index]) { $line = $index + 1; break }
  }
  if ($line -eq 0) { $line = $limit + 1 }
  throw "Workflow changed outside the added functions and dispatch: first difference at line $line"
}
$summary = [pscustomobject][ordered]@{
  schema = 'teruisi-weekly-release-lease-projection-v1'
  shellVersion = $PSVersionTable.PSVersion.ToString()
  baselineCommit = $baselineSha
  sourceSha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  addedFunctions = $functionNames
  dispatchReplacements = $newLines.Count
  restMatchesBaseline = $true
  passed = $true
}
$encoded = $summary | ConvertTo-Json -Depth 4
if ($EvidencePath) { [IO.File]::WriteAllText($EvidencePath, $encoded, [Text.UTF8Encoding]::new($false)) }
Write-Output $encoded
