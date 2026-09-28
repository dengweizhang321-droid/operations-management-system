param([Parameter(Mandatory=$true)][string]$Scratch)
$ErrorActionPreference='Stop'
if (-not (Test-Path -LiteralPath $Scratch -PathType Container) -or @(Get-ChildItem -LiteralPath $Scratch -Force).Count) { throw 'Require empty scratch' }
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\tools\release-payload-retention.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Parser error'}
$definition=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Assert-ReleaseRetentionDeployment'},$true)
Invoke-Expression $definition.Extent.Text
$fixture=Join-Path $Scratch 'library.ps1'
[IO.File]::WriteAllText($fixture,@'
param([switch]$Execute,[switch]$Json,[string]$Action,[string]$RuntimeRoot='fixture-root')
if($Action -ne 'Status' -or $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY -ne '1'){throw 'unsafe library loading'}
$runtime='clobbered';$held=$true;$mutex='clobbered'
function Assert-DeployedApplication { $global:retentionFixtureChecks++ }
function Assert-RuntimeRootAclHardened { $global:retentionFixtureChecks++ }
'@)
$global:retentionFixtureChecks=0
$Execute=$true;$runtime='caller-root';$held=$false;$mutex='caller-mutex';$Action='caller-action';$json='caller-json'
$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='original-value'
Assert-ReleaseRetentionDeployment $fixture
if(-not $Execute -or $runtime -ne 'caller-root' -or $held -or $mutex -ne 'caller-mutex' -or $Action -ne 'caller-action'){throw 'Library clobbered cleanup flags'}
$json='planner-json'
if($json -ne 'planner-json'){throw 'Library leaked its Json switch type constraint'}
if($global:retentionFixtureChecks -ne 2 -or $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY -ne 'original-value'){throw 'Deployment checks or environment restore failed'}
$Execute=$false
Assert-ReleaseRetentionDeployment $fixture
if($Execute){throw 'Read-only caller became destructive'}
Write-Output 'PASS: library validation preserves Execute, caller bindings and environment'
