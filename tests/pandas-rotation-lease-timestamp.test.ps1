# Exercise the real Get-PandasLeaseTimestamps / Assert-PandasPublicationOwner
# timestamp parsing against synthetic lease files, checking that Windows
# PowerShell 5.1 and PowerShell 7 agree on expiredNow for the same bytes.
# Does not touch any installed or production path; everything lives under a
# fresh temp directory.
param([string]$FixedNowIso = '')
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('teruisi-pandas-lease-ts-' + [Guid]::NewGuid().ToString('N'))
$RunDirectory = Join-Path $root 'run'
$Utf8NoBom = [Text.UTF8Encoding]::new($false)
$checks = [Collections.Generic.List[string]]::new()
try {
  New-Item -ItemType Directory -Path $RunDirectory | Out-Null
  function Assert-RuntimeChildPath([string]$Path) {
    if (-not ([IO.Path]::GetFullPath($Path)).StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Lease timestamp fixture escaped its temp root'
    }
    return $Path
  }
  function Read-JsonFile([string]$Path, [string]$Label) { return [IO.File]::ReadAllText($Path) | ConvertFrom-Json }

  $source = Join-Path (Split-Path -Parent $PSScriptRoot) 'tools/django-ai.ps1'
  $tokens = $null; $parseErrors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count) { throw 'Cannot parse tools/django-ai.ps1' }
  $names = @('Read-PandasRotationJson', 'Get-PandasLeaseTimestamps')
  $functions = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -cin $names }, $false))
  if ($functions.Count -ne $names.Count) { throw 'Actual controller function inventory changed' }
  . ([scriptblock]::Create(($functions.Extent.Text -join "`n")))
  $checks.Add('extracted-real-functions')

  function Write-Lease([string]$Path, [string]$CreatedAt, [string]$ExpiresAt) {
    $bytes = $Utf8NoBom.GetBytes((@{version='teruisi-release-publication-lease-v1';ownerPid=4242;maintenanceId=('a'*32);mainCommit=('b'*40);createdAt=$CreatedAt;expiresAt=$ExpiresAt} | ConvertTo-Json -Compress))
    [IO.File]::WriteAllBytes($Path, $bytes)
  }

  # Case 1: freshly created lease, 5 minutes from expiry -> must read as NOT expired.
  # A fixed instant is accepted from the caller (one shared value for both
  # PowerShell engines) so the two separate process runs parse byte-identical
  # input instead of each generating its own now() a few hundred ms apart.
  $now = if ($FixedNowIso) { [DateTimeOffset]::Parse($FixedNowIso, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind) } else { [DateTimeOffset]::UtcNow }
  $freshPath = Join-Path $RunDirectory 'fresh-lease.json'
  Write-Lease $freshPath ($now.ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ')) ($now.AddMinutes(5).ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ'))
  $fresh = Get-PandasLeaseTimestamps $freshPath
  if ($fresh.expiresAt -le [DateTimeOffset]::UtcNow) { throw 'Fresh 5-minute lease read as already expired' }
  if ([Math]::Abs(($fresh.createdAt - $now).TotalSeconds) -gt 2) { throw 'Fresh lease createdAt drifted beyond parsing tolerance' }
  $checks.Add('fresh-lease-not-expired')

  # Case 2: lease that expired 5 minutes ago -> must read as expired.
  $expiredPath = Join-Path $RunDirectory 'expired-lease.json'
  Write-Lease $expiredPath ($now.AddMinutes(-10).ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ')) ($now.AddMinutes(-5).ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ'))
  $expired = Get-PandasLeaseTimestamps $expiredPath
  if ($expired.expiresAt -gt [DateTimeOffset]::UtcNow) { throw 'Stale lease read as still valid' }
  $checks.Add('stale-lease-expired')

  # Case 3: sub-second precision must survive (PS7's auto-DateTime conversion truncates it).
  $precisePath = Join-Path $RunDirectory 'precise-lease.json'
  $preciseCreated = $now.ToString('yyyy-MM-ddTHH:mm:ss.1234567Z')
  Write-Lease $precisePath $preciseCreated ($now.AddMinutes(5).ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ'))
  $precise = Get-PandasLeaseTimestamps $precisePath
  if ($precise.createdAt.ToString('fffffff') -ne '1234567') { throw 'Sub-second precision lost while parsing lease createdAt' }
  $checks.Add('sub-second-precision-preserved')

  [ordered]@{passed=$true; psEdition=$PSVersionTable.PSEdition; psVersion=$PSVersionTable.PSVersion.ToString();
    checks=@($checks.ToArray()); freshExpiresAtIso=$fresh.expiresAt.ToString('o'); expiredExpiresAtIso=$expired.expiresAt.ToString('o')} | ConvertTo-Json -Compress
} finally {
  $temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if (-not ([IO.Path]::GetFullPath($root)).StartsWith((Join-Path $temporary 'teruisi-pandas-lease-ts-'), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Unsafe lease-timestamp fixture cleanup'
  }
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
