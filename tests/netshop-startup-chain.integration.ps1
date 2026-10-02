[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$PatchedCandidateRoot,
  [Parameter(Mandatory=$true)][string]$BaselineCandidateRoot,
  [Parameter(Mandatory=$true)][string]$PythonPath,
  [Parameter(Mandatory=$true)][string]$ExpectedPythonVersion,
  [Parameter(Mandatory=$true)][string]$EvidenceRoot
)
$ErrorActionPreference='Stop'
$testTool=Join-Path (Split-Path $PSScriptRoot -Parent) 'tools\verify-netshop-startup-chain.ps1'
$testRoot=[IO.Path]::GetFullPath($EvidenceRoot)
if(Test-Path -LiteralPath $testRoot){throw 'EvidenceRoot must be new'}
[void](New-Item -ItemType Directory -Path $testRoot)
$testShells=@(
  @{path=(Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe');major=5},
  @{path=(Get-Command pwsh -ErrorAction Stop).Source;major=7}
)
$testRuns=@()
foreach($testShell in $testShells){
  foreach($testTarget in @(@{root=$PatchedCandidateRoot;expected='passed'},@{root=$BaselineCandidateRoot;expected='failed'})){
    $testEvidence=Join-Path $testRoot ('ps'+$testShell.major+'-'+$testTarget.expected)
    $testHash=(Get-FileHash -LiteralPath (Join-Path $testTarget.root 'tools\django-local-service.ps1') -Algorithm SHA256).Hash
    & $testShell.path -NoProfile -File $testTool -CandidateRoot $testTarget.root -PythonPath $PythonPath -ExpectedPythonVersion $ExpectedPythonVersion -ExpectedLauncherSha256 $testHash -EvidenceDirectory $testEvidence | Out-Null
    $testCode=$LASTEXITCODE
    $testResult=Get-Content -LiteralPath (Join-Path $testEvidence 'startup.json') -Raw | ConvertFrom-Json
    if(([Version]$testResult.powershellVersion).Major -ne $testShell.major -or $testResult.state -ne $testTarget.expected -or
       -not $testResult.candidateWsgiLive -or -not $testResult.normalChildExit -or -not $testResult.childLineageVerified -or $testResult.cleanupStatus -ne 'removed' -or
       ($testTarget.expected -eq 'passed' -and ($testCode -ne 0 -or -not $testResult.configurationPassed)) -or
       ($testTarget.expected -eq 'failed' -and ($testCode -eq 0 -or $testResult.configurationPassed -or $testResult.reason -ne 'dependency_environment_missing_or_wrong'))){throw ('Real launch positive/negative matrix failed: '+$testEvidence)}
    $testRuns += [pscustomobject]@{powershellVersion=$testResult.powershellVersion;expected=$testTarget.expected;actual=$testResult.state;candidateWsgiLive=$testResult.candidateWsgiLive;configurationPassed=$testResult.configurationPassed;normalExit=$testResult.normalChildExit;evidence=$testEvidence}
  }
  $testRejected=Join-Path $testRoot ('ps'+$testShell.major+'-wrong-hash')
  $testSavedPreference=$ErrorActionPreference
  try {
    $ErrorActionPreference='Continue'
    & $testShell.path -NoProfile -File $testTool -CandidateRoot $PatchedCandidateRoot -PythonPath $PythonPath -ExpectedPythonVersion $ExpectedPythonVersion -ExpectedLauncherSha256 ('0'*64) -EvidenceDirectory $testRejected *> (Join-Path $testRoot ('wrong-hash-'+$testShell.major+'.log'))
  } finally { $ErrorActionPreference=$testSavedPreference }
  if($LASTEXITCODE -eq 0 -or (Test-Path -LiteralPath $testRejected)){throw 'Wrong candidate hash must refuse before creating evidence or a child'}
}
$testReport=[pscustomobject]@{schemaVersion='netshop-startup-chain-matrix-v1';status='passed';cases=$testRuns;hashRefusals=2;productionOperations=0}
$testReport|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $testRoot 'matrix.json') -Encoding utf8
$testReport|ConvertTo-Json -Depth 6
