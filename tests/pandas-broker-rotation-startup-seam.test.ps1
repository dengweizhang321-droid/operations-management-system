# Exercise the exact Windows startup/complete functions with the private Linux
# fixture. Installed app ACLs and the real Windows WSL keepalive are separate.
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('teruisi-w6r-startup-' + [Guid]::NewGuid().ToString('N'))
$RunDirectory = Join-Path $root 'run'
$InstalledAppRoot = Join-Path $root 'app'
$DeploymentManifestPath = Join-Path $InstalledAppRoot 'deployment.json'
$PandasConfigPath = Join-Path $root 'pandas-config.json'
$PandasPidPath = Join-Path $RunDirectory 'pandas.pid.json'
$LogDirectory = $RunDirectory
$BackendRoot = $InstalledAppRoot
$PandasWsl = 'private fixture'
$PandasKeepaliveArguments = @()
$RunId = 'fixture'
$Utf8NoBom = [Text.UTF8Encoding]::new($false)
$nativeScript = Join-Path $PSScriptRoot 'pandas-broker-rotation-startup-fixture.py'
$python = (Get-Command python.exe).Source
$nativeCalls = [Collections.Generic.List[string]]::new()
$fixtureStarted = $false

function Invoke-PrivateNative([string]$Verb, [string]$Payload = '') {
  $nativeCalls.Add($Verb)
  $raw = if ($Payload) { & $python -B $nativeScript $Verb $Payload } else { & $python -B $nativeScript $Verb }
  if ($LASTEXITCODE -ne 0) { throw "Private Pandas native action failed: $Verb" }
  return $raw | ConvertFrom-Json
}
function Assert-RuntimeChildPath([string]$Path) {
  if (-not ([IO.Path]::GetFullPath($Path)).StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Private startup fixture escaped'
  }
  return $Path
}
function Get-FileSha256([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Read-JsonFile([string]$Path, [string]$Label) { return [IO.File]::ReadAllText($Path) | ConvertFrom-Json }
function Test-ExactObjectPropertyNames([object]$Value, [string[]]$Names) {
  return (@($Value.PSObject.Properties.Name | Sort-Object) -join ',') -ceq (@($Names | Sort-Object) -join ',')
}
function Read-PandasConfig { return Read-JsonFile $PandasConfigPath 'fixture' }
function Get-ConfigFingerprint { return 'fixture' }
function Get-Sha256Text { return 'fixture' }
function Resolve-OwnedProcess { return $false }
function Start-ManagedProcess { }
function Write-DjangoStartupTiming { }
function Assert-AiRuntimeEntry { }
function Assert-PandasInstalledBinding { }
function Assert-PandasPublicationOwner { }
function Invoke-PandasSystemctl([string]$Verb) { Invoke-PrivateNative $Verb | Out-Null }
function Invoke-PandasProbe([object]$Config, [bool]$SelfTest = $false) {
  if ($SelfTest) { return Invoke-PrivateNative 'self-test' }
  return Invoke-PrivateNative 'status-probe'
}
function Invoke-PandasRotationNative([string]$Verb, [string]$AppRoot, [object]$Binding, [object]$Config) {
  if ($Verb -ceq 'complete') {
    $file = Get-PandasRotationPath $Binding.registeredPlanSha256 'startup'
    return Invoke-PrivateNative $Verb ([Convert]::ToBase64String([IO.File]::ReadAllBytes($file)))
  }
  return Invoke-PrivateNative $Verb
}

try {
  New-Item -ItemType Directory -Path $RunDirectory,$InstalledAppRoot | Out-Null
  [IO.File]::WriteAllText($DeploymentManifestPath, '{"fixture":"private startup seam"}', $Utf8NoBom)
  $source = Join-Path (Split-Path -Parent $PSScriptRoot) 'tools/django-ai.ps1'
  $tokens = $null; $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw 'Cannot parse actual AI controller' }
  $names = @('Assert-PandasRotationBinding','Read-PandasRotationJson','Write-PandasRotationJson','Get-PandasRotationPath',
             'Assert-SamePandasRotation','Get-PendingPandasRotation','Start-PandasSandbox','Complete-PandasRotation')
  $functions = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -cin $names }, $false))
  if ($functions.Count -ne $names.Count) { throw 'Actual controller function inventory changed' }
  . ([scriptblock]::Create(($functions.Extent.Text -join "`n")))
  $fixtureStarted = $true
  $switch = Invoke-PrivateNative 'setup' (Get-FileSha256 $DeploymentManifestPath)
  [IO.File]::WriteAllText($PandasConfigPath, (@{image=$switch.image} | ConvertTo-Json -Compress), $Utf8NoBom)
  $binding = [pscustomobject]@{preparedAppId=$switch.preparedAppId; preparedAppSha256=$switch.preparedAppSha256
    registeredPlanSha256=$switch.registeredPlanSha256; sourceCommit=$switch.sourceCommit
    maintenanceId=$switch.maintenanceId; publicationOwnerPid=$switch.publicationOwnerPid}
  Write-PandasRotationJson (Get-PandasRotationPath $binding.registeredPlanSha256 'pending') $binding
  $RequestedPandasRotation = $binding
  if ((Start-PandasSandbox) -cne $true) { throw 'Actual Start-PandasSandbox did not start the private broker' }
  $startupPath = Get-PandasRotationPath $binding.registeredPlanSha256 'startup'
  $startup = Read-PandasRotationJson $startupPath
  $first = Complete-PandasRotation | ConvertFrom-Json
  $recovered = Complete-PandasRotation | ConvertFrom-Json
  if ($first.status -cne 'ready_verified' -or $first.startupReceiptSha256 -cne (Get-FileSha256 $startupPath) -or
      $recovered.startupReceiptSha256 -cne $first.startupReceiptSha256 -or
      $startup.signedStatus.selfTest -cne $false -or $startup.signedSelfTest.selfTest -cne $true -or
      $null -ne (Get-PendingPandasRotation) -or
      ($nativeCalls -join ',') -cne 'setup,startup-check,start,identity,status-probe,self-test,identity,complete,complete') {
    throw 'Windows startup receipt did not close the original Linux intent'
  }
  [ordered]@{actualPowerShellFunctions=$names; nativeCalls=@($nativeCalls.ToArray()); startup=$startup; completed=$first;
    repeatCompletionReused=$true; windowsKeepaliveAndPublicationLeaseFixture=$true} | ConvertTo-Json -Depth 8 -Compress
} finally {
  if ($fixtureStarted) { Invoke-PrivateNative 'stop' | Out-Null }
  $temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if (-not ([IO.Path]::GetFullPath($root)).StartsWith((Join-Path $temporary 'teruisi-w6r-startup-'), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Unsafe startup fixture cleanup'
  }
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
