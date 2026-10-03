param([Parameter(Mandatory)][string]$ControllerPath,[Parameter(Mandatory)][string]$TestRoot)
$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($ControllerPath,[ref]$tokens,[ref]$errors)
if (@($errors).Count) { throw 'Controller parse failed' }
$definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Assert-NoUnapprovedProtectedAiMigration'},$true)
if ($null -eq $definition) { throw 'Admission function missing' }
Invoke-Expression $definition.Extent.Text

# Only AST-extracted admission code runs. Every native/file boundary below is
# private fixture metadata. No runtime library, service or database is loaded.
$RuntimeRoot='D:\teruisi-runtime\django-sales'
$BackendRoot=Join-Path $TestRoot 'candidate\backend'
$Python='private-python-placeholder'
$IntegrationEvidencePath=''
$IntegrationEvidenceSha256=''
$IntegrationOperationId=''
$script:Generation=''
$script:Calls=@()
$script:EvidenceDigest='a'*64
$script:BadPlan=$false;$script:LinkedSource=$false;$script:BadCopiedEvidence=$false;$script:MissingSource=$false
New-Item -ItemType Directory -Path $TestRoot -ErrorAction Stop | Out-Null
$privateComplete=Join-Path $TestRoot 'protected-full-source'
$privateSubset=Join-Path $TestRoot 'prepared-subset'
New-Item -ItemType Directory -Path (Join-Path $privateComplete 'backend\tests') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $privateComplete 'tools') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $privateSubset 'backend') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $privateComplete 'backend\tests\source-only.py'),'# private complete source')
[IO.File]::WriteAllText((Join-Path $privateComplete 'tools\integration_install.py'),'# private full engine')
$expectedSource=Join-Path $RuntimeRoot ('integration-deltas\'+('b'*32)+'\source')
function Test-Path { param($LiteralPath,$Path,[string]$PathType='')
  $p=if($LiteralPath){[string]$LiteralPath}else{[string]$Path}
  if($p.StartsWith((Join-Path $RuntimeRoot 'integration-deltas'),[StringComparison]::OrdinalIgnoreCase)){
    if($script:MissingSource -and $p -match '\\source(?:\\|$)'){return $false}
    if($PathType -ceq 'Container'){return $p -ceq $expectedSource}
    return $true
  }
  return $p -match '(integration_release_gate\.py|integration-migration-policy-v3\.json|integration-release\.json|candidate-evidence\.json)$'
}
function Get-Item {param([string]$LiteralPath,[switch]$Force)
  if($script:LinkedSource -and $LiteralPath -ceq $expectedSource){return [pscustomobject]@{Attributes=[IO.FileAttributes]::ReparsePoint}}
  return [pscustomobject]@{Attributes=[IO.FileAttributes]::Normal}
}
function Get-CanonicalPath([string]$Path){[IO.Path]::GetFullPath($Path).TrimEnd('\')}
function Assert-RuntimeChildPath([string]$Path){
  $p=Get-CanonicalPath $Path
  if(-not $p.StartsWith($RuntimeRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Outside runtime source scope'}
  return $p
}
function Get-FileSha256([string]$Path) {
  if($script:BadCopiedEvidence -and $Path -match '\\evidence\\candidate\.json$'){return 'c'*64}
  return $script:EvidenceDigest
}
function Read-JsonFile([string]$Path,[string]$Label) {
  if($Path -match 'plan\.json$'){
    return [pscustomobject]@{version='teruisi-netshop-presence-release-v1';generation='teruisi-integration-migration-plan-v4-netshop-presence';status='prepared';operationId=$(if($script:BadPlan){'d'*32}else{'b'*32});candidateEvidenceSha256=$script:EvidenceDigest}
  }
  return [pscustomobject]@{generation=$script:Generation}
}
function Invoke-BoundedNativeProcess([string]$Binary,[object[]]$Arguments,[string]$WorkingDirectory) {
  $script:Calls+=,@($Arguments)
  if($Arguments[1] -ceq 'delta-admission' -and $IntegrationOperationId){
    if($Arguments[[Array]::IndexOf($Arguments,'--root')+1] -cne $expectedSource -or $WorkingDirectory -cne $expectedSource -or
        $Arguments[0] -cne (Join-Path $expectedSource 'tools\integration_release_gate.py')){throw 'Admission used prepared subset instead of full source'}
    if(-not (Microsoft.PowerShell.Management\Test-Path -LiteralPath (Join-Path $privateComplete 'backend\tests\source-only.py')) -or
        (Microsoft.PowerShell.Management\Test-Path -LiteralPath (Join-Path $privateSubset 'backend\tests'))){throw 'Private source/subset fixtures invalid'}
  }
  if($Arguments[1] -ceq 'deployment' -and $Arguments[[Array]::IndexOf($Arguments,'--root')+1] -cne (Split-Path -Parent $BackendRoot)){throw 'Staging verification replaced by full source'}
  return [pscustomobject]@{status='verified'}
}
function ConvertFrom-UniqueNativeJson($Value,[string]$Label){return $Value}
function Assert-Call([string]$Command){
  if($script:Calls.Count -ne 1 -or $script:Calls[0][1] -cne $Command){throw "Wrong admission: $Command"}
}

Assert-NoUnapprovedProtectedAiMigration 'PrepareApp'
Assert-Call 'successor'
$script:Calls=@()
$IntegrationEvidencePath=Join-Path $TestRoot 'candidate-evidence.json'
$IntegrationEvidenceSha256=$script:EvidenceDigest
$script:Generation=''
Assert-NoUnapprovedProtectedAiMigration 'PrepareApp'
Assert-Call 'successor' # Historical v3 evidence does not select v4.
$script:Calls=@()
$script:Generation='teruisi-integration-migration-plan-v4-netshop-presence'
Assert-NoUnapprovedProtectedAiMigration 'PrepareApp'
Assert-Call 'delta-admission'
$script:Calls=@()
$IntegrationOperationId='b'*32
Assert-NoUnapprovedProtectedAiMigration 'DeployApp'
if($script:Calls.Count -ne 2 -or $script:Calls[0][1] -cne 'delta-admission' -or $script:Calls[1][1] -cne 'deployment' -or $script:Calls[1] -cnotcontains '--operation-id'){throw 'Delta deploy was not fully evidence-bound'}
$script:Calls=@()
$IntegrationEvidenceSha256=''
$rejected=$false
try{Assert-NoUnapprovedProtectedAiMigration 'DeployApp'}catch{$rejected=$true}
if(-not $rejected -or $script:Calls.Count){throw 'An id alone authorized deployment'}
$IntegrationEvidenceSha256=$script:EvidenceDigest
$extra=0
foreach($case in @('wrong-plan','copied-evidence-mismatch','reparse-source','missing-source')){
  $script:Calls=@()
  switch($case){'wrong-plan'{$script:BadPlan=$true};'copied-evidence-mismatch'{$script:BadCopiedEvidence=$true};'reparse-source'{$script:LinkedSource=$true};'missing-source'{$script:MissingSource=$true}}
  $rejected=$false
  try{Assert-NoUnapprovedProtectedAiMigration 'DeployApp'}catch{$rejected=$true;$extra++}
  if(-not $rejected -or $script:Calls.Count){throw "Unbound full source accepted: $case"}
  $script:BadPlan=$false;$script:BadCopiedEvidence=$false;$script:LinkedSource=$false;$script:MissingSource=$false
}
@{status='passed';positiveChecks=4;negativeChecks=5;productionActions=0;fullSourceAndPreparedSubsetSeparated=$true} | ConvertTo-Json -Compress
