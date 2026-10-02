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
function Test-Path { param($LiteralPath,$Path,[switch]$PathType)
  $p=if($LiteralPath){[string]$LiteralPath}else{[string]$Path}
  return $p -match '(integration_release_gate\.py|integration-migration-policy-v3\.json|integration-release\.json|candidate-evidence\.json)$'
}
function Get-FileSha256([string]$Path) { return $script:EvidenceDigest }
function Read-JsonFile([string]$Path,[string]$Label) {
  if($Path -match 'plan\.json$'){return [pscustomobject]@{candidateEvidenceSha256=$script:EvidenceDigest}}
  return [pscustomobject]@{generation=$script:Generation}
}
function Invoke-BoundedNativeProcess([string]$Binary,[object[]]$Arguments,[string]$WorkingDirectory) {
  $script:Calls+=,@($Arguments)
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
'presence-admission-5-cases-passed-no-runtime-actions'
