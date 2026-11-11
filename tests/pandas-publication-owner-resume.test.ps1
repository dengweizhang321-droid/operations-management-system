# Exercises the real Assert-PandasPublicationOwner / Assert-PandasOriginalPublicationOwner /
# Assert-PandasResumePublicationOwner / Get-PandasResumeJsonStringField /
# Get-PandasResumeOwnerProcess functions from tools/django-ai.ps1 against
# synthetic fixtures, on both Windows PowerShell 5.1 and PowerShell 7. Does
# not touch any installed or production path; everything lives under a
# fresh temp directory. Both predicates require ProcessName -ceq 'node', so
# every "live owner" fixture below spawns a real long-lived node.exe child
# (not powershell.exe/$PID) instead of reimplementing the check.
param([string]$FixedNowIso = '')
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('teruisi-pandas-owner-resume-' + [Guid]::NewGuid().ToString('N'))
$checks = [Collections.Generic.List[string]]::new()
$nodeContinuation = $null
$nodeStillAlive = $null
# Assert-PandasResumePublicationOwner hard-codes the real fixed release
# packages root (D:\codex-isolated\main-release-packages) for
# originalAttempt, so every fixture whose attempt directory must be
# ACCEPTED as "inside" has to physically live there, not merely under this
# test's own temp root (which exercises the "outside" rejection instead).
# This directory, and only this directory, is created/removed by this test;
# no real release package under that root is read, written or touched.
$attemptRoot = Join-Path 'D:\codex-isolated\main-release-packages' ('.teruisi-pandas-owner-resume-test-' + [Guid]::NewGuid().ToString('N'))
try {
  $RunDirectory = Join-Path $root 'run'
  New-Item -ItemType Directory -Path $RunDirectory, $attemptRoot -Force | Out-Null
  $Utf8NoBom = [Text.UTF8Encoding]::new($false)

  # Local stand-ins matching the real production helpers' contracts, scoped to
  # this fixture root instead of a global $RuntimeRoot (same approach as
  # tests/pandas-rotation-lease-timestamp.test.ps1).
  function Assert-RuntimeChildPath([string]$Path) {
    $candidate = [IO.Path]::GetFullPath($Path)
    $r = [IO.Path]::GetFullPath($RunDirectory)
    if ($candidate -ne $r -and -not $candidate.StartsWith($r + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Fixture lease path escaped its run directory'
    }
    return $candidate
  }
  function Get-CanonicalPath([string]$Path) {
    return [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  }
  function Get-FileSha256([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return 'missing' }
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
  }
  function Read-JsonFile([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label 不存在：$Path" }
    try { return Get-Content -Raw -LiteralPath $Path -Encoding UTF8 | ConvertFrom-Json }
    catch { throw "$Label 不是有效 JSON：$Path" }
  }

  # Extract the real functions under test via the PowerShell AST parser, not
  # a reimplementation, so this test exercises production code byte for byte.
  $source = Join-Path (Split-Path -Parent $PSScriptRoot) 'tools/django-ai.ps1'
  $localSource = Join-Path (Split-Path -Parent $PSScriptRoot) 'tools/django-local-service.ps1'
  $tokens = $null; $parseErrors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count) { throw 'Cannot parse tools/django-ai.ps1' }
  $names = @('Read-PandasRotationJson', 'Get-PandasLeaseTimestamps', 'Get-PandasResumeJsonStringField',
    'Get-PandasResumeOwnerProcess', 'Assert-PandasOriginalPublicationOwner', 'Assert-PandasResumePublicationOwner',
    'Assert-PandasPublicationOwner')
  $functions = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -cin $names }, $false))
  if ($functions.Count -ne $names.Count) { throw 'Actual controller function inventory changed' }
  . ([scriptblock]::Create(($functions.Extent.Text -join "`n")))
  $checks.Add('extracted-real-functions')

  $localTokens = $null; $localParseErrors = $null
  $localAst = [System.Management.Automation.Language.Parser]::ParseFile($localSource, [ref]$localTokens, [ref]$localParseErrors)
  if ($localParseErrors.Count) { throw 'Cannot parse tools/django-local-service.ps1' }
  $localNames = @('Test-ExactObjectPropertyNames')
  $localFunctions = @($localAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -cin $localNames }, $false))
  if ($localFunctions.Count -ne $localNames.Count) { throw 'Actual controller function inventory changed (django-local-service.ps1)' }
  . ([scriptblock]::Create(($localFunctions.Extent.Text -join "`n")))
  $checks.Add('extracted-real-local-helper')

  $now = if ($FixedNowIso) { [DateTimeOffset]::Parse($FixedNowIso, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind) } else { [DateTimeOffset]::UtcNow }
  $mainCommit = 'c' * 40
  $maintenanceId = 'd' * 32
  $sourceCommit = $mainCommit

  function Start-FixtureNode {
    $p = Start-Process -FilePath 'node.exe' -ArgumentList @('-e', 'setTimeout(()=>{},60000)') -PassThru -WindowStyle Hidden
    Start-Sleep -Milliseconds 300
    $cim = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p.Id)
    if ($null -eq $cim -or $cim.Name -cnotmatch '^node(\.exe)?$') { throw 'Spawned fixture node process is not CIM-visible as node' }
    return @{process = $p; creationDate = $cim.CreationDate.ToUniversalTime().ToString('o')}
  }
  # Two independent real node.exe children: one stands in for the live
  # continuation owner (and, in the original-branch cases, the live original
  # owner); the other stands in for an original owner that is still alive at
  # resume time, distinct from the continuation so "still alive" and
  # "is the continuation" cannot be confused.
  $nodeContinuation = Start-FixtureNode
  $nodeStillAlive = Start-FixtureNode
  $checks.Add('spawned-live-node-children')

  # A real but-certainly-absent pid for the "original owner already exited"
  # case, same technique as tests/django-local-service-process-snapshot-cache.test.ps1.
  $deadPid = -1
  for ($i = 0; $i -lt 50; $i++) {
    $candidate = Get-Random -Minimum 100000 -Maximum 999999
    if (-not (Get-Process -Id $candidate -ErrorAction SilentlyContinue)) { $deadPid = $candidate; break }
  }
  if ($deadPid -eq -1) { throw 'Could not find an absent pid for the fixture' }
  $checks.Add('found-absent-pid')

  function Write-Lease([string]$Path, [hashtable]$Fields) {
    $bytes = $Utf8NoBom.GetBytes(($Fields | ConvertTo-Json -Compress))
    [IO.File]::WriteAllBytes($Path, $bytes)
  }
  function Write-Attempt([string]$Dir, [string]$OwnerPid, [string]$OwnerCreationDate, [bool]$MaintenanceStarted = $true, [string]$FailedMainCommit = $mainCommit) {
    New-Item -ItemType Directory -Path $Dir -Force | Out-Null
    $started = @{publisherOwner = @{processId = [int]$OwnerPid; creationDate = $OwnerCreationDate}; mainCommit = $mainCommit}
    $failed = @{maintenanceStarted = $MaintenanceStarted; mainCommit = $FailedMainCommit}
    [IO.File]::WriteAllBytes((Join-Path $Dir 'STARTED.json'), $Utf8NoBom.GetBytes(($started | ConvertTo-Json -Compress)))
    [IO.File]::WriteAllBytes((Join-Path $Dir 'FAILED.json'), $Utf8NoBom.GetBytes(($failed | ConvertTo-Json -Compress)))
    return @{startedSha256 = (Get-FileSha256 (Join-Path $Dir 'STARTED.json')); failedSha256 = (Get-FileSha256 (Join-Path $Dir 'FAILED.json'))}
  }

  $leasePath = Join-Path $RunDirectory 'release-publication-lease.json'

  # --- Original branch (unchanged behavior) ---
  # createdAt must be at/after this owner's own real StartTime (the existing,
  # unmodified predicate is StartTime <= createdAt); the node child started
  # at roughly $now, so a several-minute-ahead createdAt tolerates fixture
  # setup time without weakening the assertion under test.
  $binding = [pscustomobject]@{publicationOwnerPid = $nodeContinuation.process.Id; maintenanceId = $maintenanceId; sourceCommit = $sourceCommit}
  Write-Lease $leasePath @{version = 'teruisi-release-publication-lease-v1'; ownerPid = $nodeContinuation.process.Id; maintenanceId = $maintenanceId; mainCommit = $sourceCommit;
    createdAt = $now.AddMinutes(10).ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ'); expiresAt = $now.AddMinutes(15).ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ')}
  Assert-PandasPublicationOwner $binding
  $checks.Add('original-branch-still-passes')
  Remove-Item -LiteralPath $leasePath -Force

  # Original branch must still refuse when the lease is expired, same as
  # before this change (regression guard, not new behavior).
  Write-Lease $leasePath @{version = 'teruisi-release-publication-lease-v1'; ownerPid = $nodeContinuation.process.Id; maintenanceId = $maintenanceId; mainCommit = $sourceCommit;
    createdAt = $now.AddMinutes(10).ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ'); expiresAt = $now.AddMinutes(-10).ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ')}
  $threw = $false
  try { Assert-PandasPublicationOwner $binding } catch { $threw = $true }
  if (-not $threw) { throw 'Original branch did not reject an expired lease' }
  $checks.Add('original-branch-expired-still-rejected')
  Remove-Item -LiteralPath $leasePath -Force

  # Original branch must refuse a resume-form lease when -AllowResume is not
  # passed (Invoke-PandasRotationSwitch's own call site never passes it).
  $attemptDirSwitch = Join-Path $attemptRoot 'switch-site'
  $sums0 = Write-Attempt $attemptDirSwitch $deadPid $nodeStillAlive.creationDate
  Write-Lease $leasePath @{version = 'teruisi-release-publication-lease-v1-resume'; ownerPid = $nodeContinuation.process.Id; phase = 'x';
    createdAt = $now.AddMinutes(10).ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ'); updatedAt = $now.ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ');
    expiresAt = $now.AddMinutes(15).ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ'); mainCommit = $sourceCommit; maintenanceId = $maintenanceId;
    out = $attemptDirSwitch; originalOwnerPid = $deadPid; originalOwnerCreationDate = $nodeStillAlive.creationDate; originalStartedSha256 = $sums0.startedSha256; originalFailureSha256 = $sums0.failedSha256; originalAttempt = $attemptDirSwitch}
  $threw = $false
  try { Assert-PandasPublicationOwner $binding } catch { $threw = $true }
  if (-not $threw) { throw 'Switch-site call (no -AllowResume) must reject a resume lease' }
  $checks.Add('switch-site-rejects-resume-lease-without-allowresume')
  Remove-Item -LiteralPath $leasePath -Force

  # --- Resume branch: build a valid fixture, then tweak exactly one thing per case ---
  # The "original owner" in every valid resume fixture is $deadPid (confirmed
  # absent), so the baseline passes; individual negative cases below swap in
  # specific values to isolate exactly one predicate each.
  function New-ValidResumeFixture([string]$Suffix) {
    $attemptDir = Join-Path $attemptRoot $Suffix
    $sums = Write-Attempt $attemptDir $deadPid $nodeStillAlive.creationDate
    $leaseFields = @{version = 'teruisi-release-publication-lease-v1-resume'; ownerPid = $nodeContinuation.process.Id; phase = '核验Pandas Broker原启动回执';
      createdAt = $now.AddMinutes(10).ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ'); updatedAt = $now.ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ');
      expiresAt = $now.AddMinutes(15).ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ'); mainCommit = $sourceCommit; maintenanceId = $maintenanceId;
      out = $attemptDir; originalOwnerPid = $deadPid; originalOwnerCreationDate = $nodeStillAlive.creationDate;
      originalStartedSha256 = $sums.startedSha256; originalFailureSha256 = $sums.failedSha256; originalAttempt = $attemptDir}
    return $leaseFields
  }
  $validBinding = [pscustomobject]@{publicationOwnerPid = $deadPid; maintenanceId = $maintenanceId; sourceCommit = $sourceCommit}

  # Positive: all conditions satisfied -> resume branch passes.
  $fields = New-ValidResumeFixture 'valid-pass'
  Write-Lease $leasePath $fields
  Assert-PandasPublicationOwner $validBinding -AllowResume
  $checks.Add('resume-branch-all-satisfied-passes')
  Remove-Item -LiteralPath $leasePath -Force

  # Negative: original owner (by this exact pid+creationDate) is STILL alive -> reject.
  $fields = New-ValidResumeFixture 'original-still-alive'
  $fields.originalOwnerPid = $nodeStillAlive.process.Id
  $fields.originalOwnerCreationDate = $nodeStillAlive.creationDate
  # The attempt dir's STARTED.json must still match the lease's originalOwnerPid/CreationDate
  # for this to isolate exactly the "still alive" predicate.
  Write-Attempt (Join-Path $attemptRoot 'original-still-alive') $nodeStillAlive.process.Id $nodeStillAlive.creationDate | Out-Null
  $fields.originalStartedSha256 = Get-FileSha256 (Join-Path $attemptRoot 'original-still-alive/STARTED.json')
  $fields.originalFailureSha256 = Get-FileSha256 (Join-Path $attemptRoot 'original-still-alive/FAILED.json')
  Write-Lease $leasePath $fields
  $bindingStillAlive = [pscustomobject]@{publicationOwnerPid = $nodeStillAlive.process.Id; maintenanceId = $maintenanceId; sourceCommit = $sourceCommit}
  $threw = $false
  try { Assert-PandasPublicationOwner $bindingStillAlive -AllowResume } catch { $threw = $true }
  if (-not $threw) { throw 'Resume branch did not reject a still-alive original owner' }
  $checks.Add('resume-branch-rejects-live-original-owner')
  Remove-Item -LiteralPath $leasePath -Force

  # Negative: CreationDate differs (pid recycled) -> original counted as exited, so this
  # alone must NOT block the resume (recycled-pid tolerance is the whole point of the design).
  $fields = New-ValidResumeFixture 'recycled-pid-tolerated'
  $fields.originalOwnerPid = $nodeStillAlive.process.Id
  $fields.originalOwnerCreationDate = $now.AddHours(-10).ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ') # different creation instant than the live process
  Write-Attempt (Join-Path $attemptRoot 'recycled-pid-tolerated') $nodeStillAlive.process.Id $fields.originalOwnerCreationDate | Out-Null
  $fields.originalStartedSha256 = Get-FileSha256 (Join-Path $attemptRoot 'recycled-pid-tolerated/STARTED.json')
  $fields.originalFailureSha256 = Get-FileSha256 (Join-Path $attemptRoot 'recycled-pid-tolerated/FAILED.json')
  Write-Lease $leasePath $fields
  $bindingRecycled = [pscustomobject]@{publicationOwnerPid = $nodeStillAlive.process.Id; maintenanceId = $maintenanceId; sourceCommit = $sourceCommit}
  Assert-PandasPublicationOwner $bindingRecycled -AllowResume
  $checks.Add('resume-branch-tolerates-recycled-pid')
  Remove-Item -LiteralPath $leasePath -Force

  # Negative: continuation ownerPid itself is not alive -> reject.
  $fields = New-ValidResumeFixture 'continuation-dead'
  $fields.ownerPid = $deadPid
  Write-Lease $leasePath $fields
  $threw = $false
  try { Assert-PandasPublicationOwner $validBinding -AllowResume } catch { $threw = $true }
  if (-not $threw) { throw 'Resume branch did not reject a dead continuation owner pid' }
  $checks.Add('resume-branch-rejects-dead-continuation')
  Remove-Item -LiteralPath $leasePath -Force

  # Negative: continuation lease expired -> reject.
  $fields = New-ValidResumeFixture 'continuation-expired'
  $fields.expiresAt = $now.AddMinutes(-1).ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ')
  Write-Lease $leasePath $fields
  $threw = $false
  try { Assert-PandasPublicationOwner $validBinding -AllowResume } catch { $threw = $true }
  if (-not $threw) { throw 'Resume branch did not reject an expired continuation lease' }
  $checks.Add('resume-branch-rejects-expired-continuation')
  Remove-Item -LiteralPath $leasePath -Force

  # Negative: field set has an extra key -> reject.
  $fields = New-ValidResumeFixture 'extra-field'
  $fields.extra = 'unexpected'
  Write-Lease $leasePath $fields
  $threw = $false
  try { Assert-PandasPublicationOwner $validBinding -AllowResume } catch { $threw = $true }
  if (-not $threw) { throw 'Resume branch did not reject an extra lease field' }
  $checks.Add('resume-branch-rejects-extra-field')
  Remove-Item -LiteralPath $leasePath -Force

  # Negative: a required field is missing -> reject.
  $fields = New-ValidResumeFixture 'missing-field'
  $fields.Remove('phase')
  Write-Lease $leasePath $fields
  $threw = $false
  try { Assert-PandasPublicationOwner $validBinding -AllowResume } catch { $threw = $true }
  if (-not $threw) { throw 'Resume branch did not reject a missing lease field' }
  $checks.Add('resume-branch-rejects-missing-field')
  Remove-Item -LiteralPath $leasePath -Force

  # Negative: originalOwnerPid on lease does not match Binding.publicationOwnerPid -> reject.
  $fields = New-ValidResumeFixture 'binding-mismatch'
  Write-Lease $leasePath $fields
  $wrongBinding = [pscustomobject]@{publicationOwnerPid = $deadPid + 1; maintenanceId = $maintenanceId; sourceCommit = $sourceCommit}
  $threw = $false
  try { Assert-PandasPublicationOwner $wrongBinding -AllowResume } catch { $threw = $true }
  if (-not $threw) { throw 'Resume branch did not reject a Binding.publicationOwnerPid mismatch' }
  $checks.Add('resume-branch-rejects-binding-pid-mismatch')
  Remove-Item -LiteralPath $leasePath -Force

  # Negative: mainCommit mismatch -> reject.
  $fields = New-ValidResumeFixture 'maincommit-mismatch'
  Write-Lease $leasePath $fields
  $wrongCommitBinding = [pscustomobject]@{publicationOwnerPid = $deadPid; maintenanceId = $maintenanceId; sourceCommit = 'f' * 40}
  $threw = $false
  try { Assert-PandasPublicationOwner $wrongCommitBinding -AllowResume } catch { $threw = $true }
  if (-not $threw) { throw 'Resume branch did not reject a mainCommit mismatch' }
  $checks.Add('resume-branch-rejects-maincommit-mismatch')
  Remove-Item -LiteralPath $leasePath -Force

  # Negative: maintenanceId mismatch -> reject.
  $fields = New-ValidResumeFixture 'maintenanceid-mismatch'
  Write-Lease $leasePath $fields
  $wrongMaintenanceBinding = [pscustomobject]@{publicationOwnerPid = $deadPid; maintenanceId = 'f' * 32; sourceCommit = $sourceCommit}
  $threw = $false
  try { Assert-PandasPublicationOwner $wrongMaintenanceBinding -AllowResume } catch { $threw = $true }
  if (-not $threw) { throw 'Resume branch did not reject a maintenanceId mismatch' }
  $checks.Add('resume-branch-rejects-maintenanceid-mismatch')
  Remove-Item -LiteralPath $leasePath -Force

  # Negative: originalAttempt path is relative (not rooted) -> reject.
  $fields = New-ValidResumeFixture 'relative-attempt'
  $fields.originalAttempt = 'relative\path'
  Write-Lease $leasePath $fields
  $threw = $false
  try { Assert-PandasPublicationOwner $validBinding -AllowResume } catch { $threw = $true }
  if (-not $threw) { throw 'Resume branch did not reject a relative originalAttempt path' }
  $checks.Add('resume-branch-rejects-relative-attempt-path')
  Remove-Item -LiteralPath $leasePath -Force

  # Negative: originalAttempt path is outside D:\codex-isolated\main-release-packages -> reject.
  $fields = New-ValidResumeFixture 'outside-release-packages'
  $outsideDir = Join-Path $root 'outside-release-packages'
  Write-Attempt $outsideDir $deadPid $nodeStillAlive.creationDate | Out-Null
  $fields.originalAttempt = $outsideDir
  $fields.originalStartedSha256 = Get-FileSha256 (Join-Path $outsideDir 'STARTED.json')
  $fields.originalFailureSha256 = Get-FileSha256 (Join-Path $outsideDir 'FAILED.json')
  Write-Lease $leasePath $fields
  $threw = $false
  try { Assert-PandasPublicationOwner $validBinding -AllowResume } catch { $threw = $true }
  if (-not $threw) { throw 'Resume branch did not reject an originalAttempt outside the fixed release packages root' }
  $checks.Add('resume-branch-rejects-attempt-outside-release-packages')
  Remove-Item -LiteralPath $leasePath -Force

  # Negative: STARTED.json digest no longer matches originalStartedSha256 -> reject.
  $fields = New-ValidResumeFixture 'started-digest-mismatch'
  Write-Lease $leasePath $fields
  [IO.File]::AppendAllText((Join-Path $attemptRoot 'started-digest-mismatch/STARTED.json'), ' ')
  $threw = $false
  try { Assert-PandasPublicationOwner $validBinding -AllowResume } catch { $threw = $true }
  if (-not $threw) { throw 'Resume branch did not reject a STARTED.json digest mismatch' }
  $checks.Add('resume-branch-rejects-started-digest-mismatch')
  Remove-Item -LiteralPath $leasePath -Force

  # Negative: FAILED.json digest no longer matches originalFailureSha256 -> reject.
  $fields = New-ValidResumeFixture 'failed-digest-mismatch'
  Write-Lease $leasePath $fields
  [IO.File]::AppendAllText((Join-Path $attemptRoot 'failed-digest-mismatch/FAILED.json'), ' ')
  $threw = $false
  try { Assert-PandasPublicationOwner $validBinding -AllowResume } catch { $threw = $true }
  if (-not $threw) { throw 'Resume branch did not reject a FAILED.json digest mismatch' }
  $checks.Add('resume-branch-rejects-failed-digest-mismatch')
  Remove-Item -LiteralPath $leasePath -Force

  # Negative: FAILED.json maintenanceStarted is not true -> reject.
  $fields = New-ValidResumeFixture 'maintenance-not-started'
  Write-Attempt (Join-Path $attemptRoot 'maintenance-not-started') $deadPid $nodeStillAlive.creationDate $false | Out-Null
  $fields.originalStartedSha256 = Get-FileSha256 (Join-Path $attemptRoot 'maintenance-not-started/STARTED.json')
  $fields.originalFailureSha256 = Get-FileSha256 (Join-Path $attemptRoot 'maintenance-not-started/FAILED.json')
  Write-Lease $leasePath $fields
  $threw = $false
  try { Assert-PandasPublicationOwner $validBinding -AllowResume } catch { $threw = $true }
  if (-not $threw) { throw 'Resume branch did not reject FAILED.json without maintenanceStarted=true' }
  $checks.Add('resume-branch-rejects-maintenance-not-started')
  Remove-Item -LiteralPath $leasePath -Force

  # Negative: FAILED.json mainCommit does not match Binding.sourceCommit -> reject.
  $fields = New-ValidResumeFixture 'failed-maincommit-mismatch'
  Write-Attempt (Join-Path $attemptRoot 'failed-maincommit-mismatch') $deadPid $nodeStillAlive.creationDate $true ('e' * 40) | Out-Null
  $fields.originalStartedSha256 = Get-FileSha256 (Join-Path $attemptRoot 'failed-maincommit-mismatch/STARTED.json')
  $fields.originalFailureSha256 = Get-FileSha256 (Join-Path $attemptRoot 'failed-maincommit-mismatch/FAILED.json')
  Write-Lease $leasePath $fields
  $threw = $false
  try { Assert-PandasPublicationOwner $validBinding -AllowResume } catch { $threw = $true }
  if (-not $threw) { throw 'Resume branch did not reject a FAILED.json mainCommit mismatch' }
  $checks.Add('resume-branch-rejects-failed-maincommit-mismatch')
  Remove-Item -LiteralPath $leasePath -Force

  # Negative: STARTED.json publisherOwner.processId/creationDate does not match
  # the lease's originalOwnerPid/originalOwnerCreationDate -> reject.
  $fields = New-ValidResumeFixture 'started-owner-mismatch'
  Write-Attempt (Join-Path $attemptRoot 'started-owner-mismatch') ($deadPid + 2) $nodeStillAlive.creationDate | Out-Null
  $fields.originalStartedSha256 = Get-FileSha256 (Join-Path $attemptRoot 'started-owner-mismatch/STARTED.json')
  $fields.originalFailureSha256 = Get-FileSha256 (Join-Path $attemptRoot 'started-owner-mismatch/FAILED.json')
  Write-Lease $leasePath $fields
  $threw = $false
  try { Assert-PandasPublicationOwner $validBinding -AllowResume } catch { $threw = $true }
  if (-not $threw) { throw 'Resume branch did not reject a STARTED.json owner mismatch' }
  $checks.Add('resume-branch-rejects-started-owner-mismatch')
  Remove-Item -LiteralPath $leasePath -Force

  [ordered]@{passed = $true; psEdition = $PSVersionTable.PSEdition; psVersion = $PSVersionTable.PSVersion.ToString(); checks = @($checks.ToArray())} | ConvertTo-Json -Compress
} finally {
  foreach ($node in @($nodeContinuation, $nodeStillAlive)) {
    if ($node) { try { Stop-Process -Id $node.process.Id -Force -ErrorAction SilentlyContinue } catch {} }
  }
  $temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if (-not ([IO.Path]::GetFullPath($root)).StartsWith((Join-Path $temporary 'teruisi-pandas-owner-resume-'), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Unsafe owner-resume fixture cleanup'
  }
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
  $releasePackages = [IO.Path]::GetFullPath('D:\codex-isolated\main-release-packages')
  if (-not ([IO.Path]::GetFullPath($attemptRoot)).StartsWith((Join-Path $releasePackages '.teruisi-pandas-owner-resume-test-'), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Unsafe owner-resume attempt-root cleanup'
  }
  if (Test-Path -LiteralPath $attemptRoot) { Remove-Item -LiteralPath $attemptRoot -Recurse -Force }
}
