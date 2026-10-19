[CmdletBinding()]
param(
  [string]$SourceRoot = '',
  [string]$BaselineCommit = '8e1411cc',
  [string]$EvidencePath = ''
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -eq 5) {
  $env:PSModulePath = Join-Path $PSHOME 'Modules'
}
if (-not $SourceRoot) { $SourceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
$path = Join-Path $SourceRoot 'tools\django-workflow-service.ps1'
$source = [IO.File]::ReadAllText($path).Replace("`r`n", "`n").TrimEnd("`n")
$baselineLines = @(& git -C $SourceRoot show ($BaselineCommit + ':tools/django-workflow-service.ps1'))
if ($LASTEXITCODE -ne 0) { throw 'Could not read baseline Git object' }
$baseline = ($baselineLines -join "`n").TrimEnd("`n")
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Workflow parse failed' }
$helper = @($ast.FindAll({param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-NewProductWeeklyReportDeferral'
}, $true))
$report = @($ast.FindAll({param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-NewProductWeeklyReport'
}, $true))
if ($helper.Count -ne 1 -or $report.Count -ne 1) { throw 'Expected exact helper/report functions' }
$statements = $report[0].Body.EndBlock.Statements
if ($statements[0].Extent.Text -cne '$deferral = Get-NewProductWeeklyReportDeferral' -or
    $statements[1] -isnot [Management.Automation.Language.IfStatementAst] -or
    $statements[1].Clauses[0].Item1.Extent.Text -cne '$null -ne $deferral' -or
    $statements[2].Extent.Text -cne 'Assert-WorkflowRuntimeEntry') {
  throw 'Report prefix or original first statement changed'
}
$prefixStart = $statements[0].Extent.StartOffset - 2
$prefixEnd = $statements[1].Extent.EndOffset + 1
if ($source.Substring($prefixStart, 2) -cne '  ' -or $source[$prefixEnd - 1] -cne "`n") {
  throw 'Unexpected report prefix boundary'
}
$helperStart = $helper[0].Extent.StartOffset
$helperEnd = $helper[0].Extent.EndOffset + 2
if ($source.Substring($helperEnd - 2, 2) -cne "`n`n") { throw 'Unexpected helper boundary' }
$projected = $source.Remove($prefixStart, $prefixEnd - $prefixStart).Remove($helperStart, $helperEnd - $helperStart)
if ($projected -cne $baseline) { throw 'Workflow changed outside the added helper and admission prefix' }
$summary = [pscustomobject][ordered]@{
  schema='teruisi-weekly-report-admission-projection-v1'
  shellVersion=$PSVersionTable.PSVersion.ToString()
  baselineCommit=$BaselineCommit
  sourceSha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  addedHelper='Get-NewProductWeeklyReportDeferral'
  addedPrefixStatements=2
  restMatchesBaseline=$true
  passed=$true
}
$encoded = $summary | ConvertTo-Json -Depth 4
if ($EvidencePath) { [IO.File]::WriteAllText($EvidencePath, $encoded, [Text.UTF8Encoding]::new($false)) }
Write-Output $encoded
