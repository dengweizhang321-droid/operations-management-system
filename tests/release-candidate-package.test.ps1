$ErrorActionPreference='Stop'
# Actual package copy, dependency closure, fingerprint, ACL and local R2 code.
# Only stopped-process and production schema admission observations are replaced.
# This is package-integrity evidence, NOT a production gate or native cold start.
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$prefix=Join-Path ([IO.Path]::GetTempPath()) 'teruisi-candidate-package-'
$root=$prefix+[Guid]::NewGuid().ToString('N')
$previous=$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
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
  function Assert-ApplicationDeploymentStopped { Assert-PrivatePackageRoot }
  function Assert-NoUnapprovedProtectedAiMigration { Assert-PrivatePackageRoot }
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
} finally {
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY=$previous
  $canonical=[IO.Path]::GetFullPath($root)
  if(-not $canonical.StartsWith([IO.Path]::GetFullPath($prefix),[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe package cleanup'}
  if(Test-Path -LiteralPath $canonical){Remove-Item -LiteralPath $canonical -Recurse -Force}
}
