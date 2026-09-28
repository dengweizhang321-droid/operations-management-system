param([Parameter(Mandatory)][string]$ControllerPath, [Parameter(Mandatory)][string]$TestRoot)
$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($ControllerPath,[ref]$tokens,[ref]$errors)
if (@($errors).Count) { throw 'Controller did not parse' }
$definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Assert-IntegrationPreparedSource'},$true)
if ($null -eq $definition) { throw 'Prepared source validator missing' }
Invoke-Expression $definition.Extent.Text
function Get-FileSha256([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
$source=Join-Path $TestRoot 'source'; $prepared=Join-Path $TestRoot 'prepared'
foreach($base in @($source,$prepared)) {
 foreach($name in @('backend','config','tools','drizzle')) { New-Item -ItemType Directory -Path (Join-Path $base $name) -Force | Out-Null }
 [IO.File]::WriteAllText((Join-Path $base 'backend\main.py'),'# original')
}
Assert-IntegrationPreparedSource $prepared $source
[IO.File]::WriteAllText((Join-Path $source 'backend\new.py'),'# newly reviewed source')
$failed=$false
try { Assert-IntegrationPreparedSource $prepared $source } catch { $failed=$true }
if(-not $failed) { throw 'Missing staged backend file was accepted' }
Copy-Item -LiteralPath (Join-Path $source 'backend\new.py') -Destination (Join-Path $prepared 'backend\new.py')
Assert-IntegrationPreparedSource $prepared $source
[IO.File]::WriteAllText((Join-Path $prepared 'backend\main.py'),'# changed')
$failed=$false
try { Assert-IntegrationPreparedSource $prepared $source } catch { $failed=$true }
if(-not $failed) { throw 'Changed staged code was accepted' }
Write-Output 'prepared-source-binding-passed'
