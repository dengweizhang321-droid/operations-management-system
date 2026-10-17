$ErrorActionPreference='Stop'
# Actual package copy, dependency closure, fingerprint, ACL and local R2 code.
# Only stopped-process and production schema admission observations are replaced.
# This is package-integrity evidence, NOT a production gate or native cold start.
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$prefix=Join-Path ([IO.Path]::GetPathRoot($workspace)) 'trcp-'
$root=$prefix+[Guid]::NewGuid().ToString('N')
$previous=$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
$previousTemp=$env:TEMP;$previousTmp=$env:TMP
$previousXdg=$env:XDG_CONFIG_HOME;$previousWranglerLog=$env:WRANGLER_LOG_PATH
$completed=$false
function Assert-PrivatePackageRoot {
  if ([IO.Path]::GetFullPath($RuntimeRoot) -cne [IO.Path]::GetFullPath($root) -or
      -not [IO.Path]::GetFullPath($RuntimeRoot).StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or
      (Test-Path -LiteralPath (Join-Path $root 'secrets')) -or
      (Test-Path -LiteralPath (Join-Path $root 'service.json'))) { throw 'Private package root escaped or acquired credentials' }
}
try {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1'
  . (Join-Path $workspace 'tools/django-local-service.ps1') -Action DeployApp -RuntimeRoot $root
  Assert-PrivatePackageRoot
  # Match the existing short-path Wrangler isolation fixture. All cache/log/
  # storage paths belong to this test; a long user TEMP is a different topology.
  $env:TEMP=Join-Path $root 'temp';$env:TMP=$env:TEMP
  $env:XDG_CONFIG_HOME=Join-Path $root 'config-home'
  $env:WRANGLER_LOG_PATH=Join-Path $root 'wrangler-logs'
  New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
  function Assert-ApplicationDeploymentStopped { Assert-PrivatePackageRoot }
  function Assert-NoUnapprovedProtectedAiMigration { Assert-PrivatePackageRoot }
  function Get-WranglerRuntimeFailureDigest([object]$Result) {
    Assert-PrivatePackageRoot
    [IO.File]::WriteAllText((Join-Path $root 'wrangler-decoded.stdout.txt'),[string]$Result.Stdout)
    [IO.File]::WriteAllText((Join-Path $root 'wrangler-decoded.stderr.txt'),[string]$Result.Stderr)
    return Get-Sha256Text (Protect-LogText (([string]$Result.Stdout)+"`n"+([string]$Result.Stderr)))
  }
  $timer=[Diagnostics.Stopwatch]::StartNew()
  $prepared=Prepare-Application
  $PreparedAppId=$prepared.id;$PreparedAppSha256=$prepared.receiptSha256
  $stage=Get-PreparedApplication $PreparedAppId $PreparedAppSha256
  if (Test-Path -LiteralPath $InstalledAppRoot) { throw 'Prepare activated app' }
  Deploy-Application
  Set-RuntimeAcl
  Assert-DeployedApplication
  Assert-RuntimeAclHardened
  Assert-WranglerLocalR2RoundTrip $InstalledAppRoot
  foreach($relative in @('tools/django-local-service.ps1','tools/django-runtime-supervisor.ps1')) {
    $sourceFile=Join-Path $workspace $relative;$packFile=Join-Path $InstalledAppRoot $relative
    if ((Get-FileHash -LiteralPath $sourceFile).Hash -cne (Get-FileHash -LiteralPath $packFile).Hash) { throw "Candidate package bytes differ: $relative" }
  }
  $tampered=Join-Path $InstalledAppRoot 'backend/teruisi_backend/__init__.py'
  [IO.File]::AppendAllText($tampered,"`n# private integrity rejection probe")
  $rejected=$false;try{Assert-DeployedApplication}catch{$rejected=$true}
  if(-not $rejected){throw 'Package content drift was accepted'}
  Assert-PrivatePackageRoot
  Write-Output "PASS: private actual package copy/deploy/hash/ACL/R2; production process/schema admission not executed; elapsedMs=$($timer.ElapsedMilliseconds)"
  $completed=$true
} catch {
  Write-Output "PRIVATE_PACKAGE_FAILED_ROOT=$root"
  throw
} finally {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY=$previous
  $env:TEMP=$previousTemp;$env:TMP=$previousTmp
  $env:XDG_CONFIG_HOME=$previousXdg;$env:WRANGLER_LOG_PATH=$previousWranglerLog
  $canonical=[IO.Path]::GetFullPath($root)
  if(-not $canonical.StartsWith([IO.Path]::GetFullPath($prefix),[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe package cleanup'}
  if($completed -and (Test-Path -LiteralPath $canonical)){Remove-Item -LiteralPath $canonical -Recurse -Force}
}
