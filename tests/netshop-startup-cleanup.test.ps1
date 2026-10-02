$ErrorActionPreference='Stop'
$testSource=Get-Content -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) 'tools\verify-netshop-startup-chain.ps1') -Raw
$testBegin=$testSource.IndexOf('  $taskReceiptChild=[Diagnostics.Process]::GetProcessById')
if($testBegin -lt 0){throw 'Receipt acquisition source is missing'}
$testVerifyStart=$testSource.IndexOf('  try {',$testBegin)
$testVerifyEnd=$testSource.IndexOf('  $taskResult.launcherPid=', $testVerifyStart)
$testVerify=$testSource.Substring($testVerifyStart,$testVerifyEnd-$testVerifyStart)
$testCleanupStart=$testSource.IndexOf('  if ($taskProcess) {',$testVerifyEnd)
$testCleanupEnd=$testSource.IndexOf('  foreach ($taskVariable in @(', $testCleanupStart)
$testCleanup=$testSource.Substring($testCleanupStart,$testCleanupEnd-$testCleanupStart)
function New-TestHandle([int]$Id,[DateTime]$StartTime,[bool]$Exits) {
  $h=[pscustomobject]@{Id=$Id;StartTime=$StartTime;Handle=1;ExitCode=0;waitCalls=0;killCalls=0;disposeCalls=0;exits=$Exits}
  $h|Add-Member ScriptMethod WaitForExit {param($milliseconds) $this.waitCalls++;return $this.exits}
  $h|Add-Member ScriptMethod Kill {$this.killCalls++}
  $h|Add-Member ScriptMethod Dispose {$this.disposeCalls++}
  return $h
}
function Get-CimInstance {param($ClassName,$Filter) return $testCimIdentity}
$testCases=@()
foreach($kind in @('wrong-parent','older-creation','same-pid-new-creation','valid-child','valid-launcher')) {
  $testStart=[DateTime]::UtcNow
  $taskProcess=New-TestHandle 901 $testStart $true
  $testId=if($kind -in @('same-pid-new-creation','valid-launcher')){901}else{902}
  $testChildStart=if($kind -eq 'older-creation'){$testStart.AddSeconds(-1)}elseif($kind -eq 'valid-launcher'){$testStart}else{$testStart.AddSeconds(1)}
  $testUntrusted=New-TestHandle $testId $testChildStart $false
  $taskReceiptChild=$testUntrusted;$taskPythonChild=$null
  $taskReceipt=[pscustomobject]@{pid=$testId}
  $testCimIdentity=[pscustomobject]@{ParentProcessId=if($kind -eq 'wrong-parent'){999}else{901}}
  $taskResult=@{state='failed';childLineageVerified=$false}
  $testRejected=$false
  try { . ([scriptblock]::Create($testVerify)) } catch {$testRejected=$true}
  & ([scriptblock]::Create($testCleanup))
  $testValid=$kind -in @('valid-child','valid-launcher')
  if($testValid) {
    if($testRejected -or $taskResult.childLineageVerified -ne $true -or $testUntrusted.killCalls -ne 1 -or $testUntrusted.waitCalls -ne 2){throw ('Owned handle cleanup not preserved: '+$kind)}
  } elseif(-not $testRejected -or $testUntrusted.waitCalls -ne 0 -or $testUntrusted.killCalls -ne 0 -or $testUntrusted.disposeCalls -ne 1){throw ('Rejected handle gained process operation authority: '+$kind)}
  $testCases+=[pscustomobject]@{case=$kind;rejected=$testRejected;lineageVerified=$taskResult.childLineageVerified;waitCalls=$testUntrusted.waitCalls;killCalls=$testUntrusted.killCalls;disposeCalls=$testUntrusted.disposeCalls}
}
# Defense in depth: execute the actual cleanup line with an unverified handle,
# the precise prior-review seam. It must not wait or kill even if assigned.
$taskPythonChild=New-TestHandle 903 ([DateTime]::UtcNow) $false
$taskResult=@{state='failed';childLineageVerified=$false}
$testCleanupLine=@($testCleanup -split "`n"|Where-Object {$_ -match '^    if \(\$taskPythonChild'})
if($testCleanupLine.Count -ne 1){throw 'Original cleanup seam is ambiguous'}
& ([scriptblock]::Create($testCleanupLine[0]))
if($taskPythonChild.waitCalls -ne 0 -or $taskPythonChild.killCalls -ne 0){throw 'Unverified cleanup seam waited or killed'}
[pscustomobject]@{status='passed';powershellVersion=$PSVersionTable.PSVersion.ToString();cases=$testCases;unverifiedSeamWait=0;unverifiedSeamKill=0;actualProcessOperations=0}|ConvertTo-Json -Depth 5
