[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Controller)
$ErrorActionPreference = 'Stop'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($Controller,[Text.Encoding]::UTF8),[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'Controller syntax failed' }
foreach ($actionName in @('PiUpgradeStatus','VerifyPiUpgradeResult')) {
  $bind = [scriptblock]::Create($ast.ParamBlock.Extent.Text + '; $Action')
  if ((& $bind -Action $actionName) -cne $actionName) { throw 'Public action binding failed' }
}
$definition = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-PiUpgradeStatus'},$true)
if (-not $definition) { throw 'Missing status implementation' }
. ([scriptblock]::Create($definition.Extent.Text))
$RuntimeRoot = 'private-runtime-fixture'
$InstalledAppRoot = 'private-installed-fixture'
$BackendRoot = 'private-backend-fixture'
$Python = 'private-python-fixture'
$RequestedPiUpgradePlanSha256 = 'a' * 64
$script:aclCalls = 0; $script:nativeCalls = 0; $script:runtimeCalls = 0
$script:fixtureStatus = 'windows_complete'
function Assert-AiRuntimeEntry { $script:runtimeCalls++ }
function Assert-PiUpgradeLeafAcl([string]$SourceSha256) {
  if ($SourceSha256 -cne ('b' * 64)) { throw 'ACL source binding changed' }
  $script:aclCalls++
}
function Invoke-BoundedNativeProcess($Executable,$Arguments,$WorkingDirectory) {
  $script:nativeCalls++
  if ($Executable -cne $Python -or $WorkingDirectory -cne $BackendRoot -or
      $Arguments.Count -ne 6 -or $Arguments[0] -cne '-B' -or
      $Arguments[1] -cne (Join-Path $InstalledAppRoot 'tools\pi_agent_upgrade_status.py') -or
      $Arguments[2] -cne '--runtime' -or $Arguments[3] -cne $RuntimeRoot -or
      $Arguments[4] -cne '--expected-plan-sha256' -or $Arguments[5] -cne $RequestedPiUpgradePlanSha256) { throw 'Native observation arguments changed' }
  return [pscustomobject]@{ExitCode=0;Output='fixture-native-result'}
}
function ConvertFrom-UniqueNativeJson($Native,$Description) {
  if ($Native.ExitCode -ne 0 -or $Native.Output -cne 'fixture-native-result') { throw 'Native receipt changed' }
  return [pscustomobject]@{
    status=$script:fixtureStatus;reason='private fixture';registeredPlanSha256=$RequestedPiUpgradePlanSha256
    sourceSha256=('b' * 64);postconditionsVerified=$false
    upgradeReceipt=[pscustomobject]@{upgraded=$true;windowsConfigUpdated=$true;sameDpapiOwner=$true;operationId=('f' * 32)}
  }
}
$observed = Get-PiUpgradeStatus | ConvertFrom-Json
if ($observed.postconditionsVerified -or $script:aclCalls -ne 0) { throw 'Status must not claim ACL postconditions' }
$verified = Get-PiUpgradeStatus $true | ConvertFrom-Json
if ($verified.postconditionsVerified -cne $true -or $script:aclCalls -ne 1 -or $verified.upgradeReceipt.operationId -cne ('f' * 32)) { throw 'Original result or ACL proof was not reused' }
foreach ($script:fixtureStatus in @('blocked','reconcile_available')) {
  $rejected = $false
  try { Get-PiUpgradeStatus $true | Out-Null } catch { $rejected=$true }
  if (-not $rejected -or $script:aclCalls -ne 1) { throw 'Incomplete upgrade passed Verify' }
}
if ($script:nativeCalls -ne 4 -or $script:runtimeCalls -ne 4) { throw 'Unexpected observation count' }
$switch = $ast.Find({param($node) $node -is [Management.Automation.Language.SwitchStatementAst] -and $node.Condition.Extent.Text -ceq '$Action'},$true)
if (-not $switch) { throw 'Public action dispatch missing' }
foreach ($actionName in @('PiUpgradeStatus','VerifyPiUpgradeResult')) {
  $clause = @($switch.Clauses | Where-Object {$_.Item1.Value -ceq $actionName})
  if ($clause.Count -ne 1 -or $clause[0].Item2.Extent.Text -notmatch 'Invoke-WithServiceMutex') { throw 'Public observation must retain native mutex' }
}
[pscustomobject]@{passed=$true;publicActions=2;observations=$script:nativeCalls;aclChecks=$script:aclCalls;productionReads=0;serviceActions=0} | ConvertTo-Json -Compress
