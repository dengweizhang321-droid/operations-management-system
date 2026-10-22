param([Parameter(Mandatory=$true)][string]$InputPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$taskInput = [IO.File]::ReadAllText($InputPath) | ConvertFrom-Json
$taskBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$taskRoot = [IO.Path]::GetFullPath([string]$taskInput.root)
if ([IO.Path]::GetDirectoryName($taskRoot) -ine $taskBase -or [IO.Path]::GetFileName($taskRoot) -notmatch '^s05d-native-[a-f0-9]{32}$') { throw 'Private root required' }
foreach ($taskCandidate in @($InputPath, [string]$taskInput.script, [string]$taskInput.runtime)) {
  if (-not [IO.Path]::GetFullPath($taskCandidate).StartsWith($taskRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Private path escaped' }
}
$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = '1'
. ([string]$taskInput.script) -RuntimeRoot ([string]$taskInput.runtime) -Action Status
if ([IO.Path]::GetFullPath($RuntimeRoot) -ine [IO.Path]::GetFullPath([string]$taskInput.runtime)) { throw 'Native runtime argument drifted' }
# Only the already-established maintenance/stopped/tree business preconditions
# are replaced. The old Prepare/Deploy/GetPrepared/Verify bodies and addressing
# are unchanged; no real ports, credentials, database or service are consulted.
$script:taskFirstMaintenance = $true
function Assert-ApplicationDeploymentStopped([string]$Operation) { if (-not $script:taskFirstMaintenance) { throw 'Private first maintenance not established' } }
function Get-InstalledApplicationBinding { return [string]$taskInput.predecessor }
function Assert-ApplicationTreeManifest([string]$AppRoot, [string]$Label) {
  if (-not [IO.Path]::GetFullPath($AppRoot).StartsWith($taskRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Tree escaped private root' }
  if (-not (Test-Path -LiteralPath (Join-Path $AppRoot 'deployment.json') -PathType Leaf)) { throw 'Private candidate manifest missing' }
  return @{ privateTreePrecondition = $true }
}
function Assert-DeployedApplication { Assert-ApplicationTreeManifest $InstalledAppRoot 'private deployed' | Out-Null }
$PreparedAppId = [string]$taskInput.id
$PreparedAppSha256 = [string]$taskInput.receiptSha256
$taskResult = @{ version='s05d-old-django-private-entry-v1'; mode=[string]$taskInput.mode; privateRuntime=$true; productionActions=$false; fullNativeLifecycleVerified=$false }
switch ([string]$taskInput.mode) {
  'prepare-boundary' {
    function Copy-WranglerRuntimeClosure([string]$Destination) { throw 'PRIVATE_PREPARE_REACHED_COPY' }
    try { Prepare-Application | Out-Null; throw 'Expected private boundary' }
    catch { if ($_.Exception.Message -cne 'PRIVATE_PREPARE_REACHED_COPY') { throw }; $taskResult.oldPrepareReachedCopy = $true }
  }
  'deploy-present' {
    Deploy-Application | Out-Null
    $taskManifest = Read-JsonFile (Join-Path $InstalledAppRoot 'deployment.json') 'private installed candidate'
    $taskResult.deployedSourceRoot = [string]$taskManifest.sourceRoot
    $taskResult.oldPreparedAddressConsumed = $true
  }
  'deploy-retired' {
    try { Deploy-Application | Out-Null; throw 'Retired candidate unexpectedly deployed' }
    catch {
      if ($_.FullyQualifiedErrorId -notlike 'PathNotFound,*' -or [string]$_.TargetObject -notlike ('*app.deploy-'+$PreparedAppId+'*')) { throw }
      $taskResult.oldPreparedAddressRejected = $true
      $taskResult.rejection = 'Original native app.deploy-id path not found'
    }
  }
  'deploy-no-id' {
    $PreparedAppId = ''
    $PreparedAppSha256 = ''
    function Prepare-Application {
      if ((Get-CanonicalPath $ExecutionRoot) -cne (Get-CanonicalPath ([string]$taskInput.expectedOwnSource))) { throw 'No-id preparation changed its execution source' }
      return @{ id=[string]$taskInput.id; receiptSha256=[string]$taskInput.receiptSha256 }
    }
    Deploy-Application | Out-Null
    $taskResult.noIdPrepareSource = $ExecutionRoot
    $taskResult.deployedSourceRoot = [string](Read-JsonFile (Join-Path $InstalledAppRoot 'deployment.json') 'private no-id installed').sourceRoot
  }
  'verify-own' {
    $taskVerified = Verify-PreparedApplication
    if ($taskVerified.status -cne 'prepared_verified') { throw 'Old helper verify did not pass' }
    $taskResult.unrelatedHelperReadVerifyPreserved = $true
  }
  default { throw 'Unknown private mode' }
}
$taskResult | ConvertTo-Json -Depth 3 -Compress
