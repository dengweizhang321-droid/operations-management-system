# Synthetic subprocess/pipe experiment; no production requests or lifecycle actions.
$ErrorActionPreference='Stop'
$TaskEofEvidence=Join-Path $PSScriptRoot '../../docs/runtime-risk-readonly-audit-20261009/evidence'
$TaskEofSandbox=Join-Path $PSScriptRoot '../../.runtime/watchdog-eof-fixture'
New-Item -ItemType Directory -Path $TaskEofSandbox -Force | Out-Null
$TaskEofChild=Join-Path $TaskEofSandbox 'child.ps1'
$TaskEofNode=(Get-Command node).Source
$TaskEofSource=@'
param([string]$TaskFixtureNode)
$ErrorActionPreference='Stop'
$taskChildInfo=[Diagnostics.ProcessStartInfo]::new($TaskFixtureNode)
$taskChildInfo.UseShellExecute=$false;$taskChildInfo.CreateNoWindow=$true
$taskChildInfo.ArgumentList.Add('-e');$taskChildInfo.ArgumentList.Add('setTimeout(()=>{},6000)')
$taskGrandchild=[Diagnostics.Process]::Start($taskChildInfo)
try {[Console]::Out.WriteLine(('{{"ok":true,"syntheticGrandchildPid":{0}}}' -f $taskGrandchild.Id))}
finally {$taskGrandchild.Dispose()}
exit 0
'@
[IO.File]::WriteAllText($TaskEofChild,$TaskEofSource,[Text.UTF8Encoding]::new($false))
. 'D:\teruisi-runtime\operations-watchdog\operations-system-watchdog.ps1' -Action Status -FunctionsOnly
$WatchdogRoot=$TaskEofSandbox
$TaskEofReceipt=@{startedAt=[DateTimeOffset]::UtcNow.ToString('o');mode='isolated exact installed Invoke-WatchProcess with synthetic child/grandchild';deadlineSeconds=2;syntheticHoldMs=6000;productionRequests=0;productionWrites=0;externalMessages=0;installedScriptSha256=Get-WatchHash 'D:\teruisi-runtime\operations-watchdog\operations-system-watchdog.ps1'}
$TaskEofTimer=[Diagnostics.Stopwatch]::StartNew()
try{$TaskEofReceipt.data=Invoke-WatchProcess $PowerShellPath @('-NoProfile','-NonInteractive','-File',$TaskEofChild,'-TaskFixtureNode',$TaskEofNode) 2;$TaskEofReceipt.status='returned'}
catch{$TaskEofReceipt.status='failed';$TaskEofReceipt.errorCode=[string]$_.Exception.Message}
$TaskEofTimer.Stop();$TaskEofReceipt.elapsedMs=$TaskEofTimer.Elapsed.TotalMilliseconds
$TaskEofReceipt.completedAt=[DateTimeOffset]::UtcNow.ToString('o');$TaskEofReceipt.deadlineExceeded=$TaskEofReceipt.elapsedMs -gt 2500
if($TaskEofReceipt.data.syntheticGrandchildPid){$TaskEofReceipt.syntheticGrandchildStillPresent=[bool](Get-Process -Id $TaskEofReceipt.data.syntheticGrandchildPid -ErrorAction SilentlyContinue)}
$TaskEofOutput=Join-Path $TaskEofEvidence 'watchdog-eof-replay.json'
if(Test-Path -LiteralPath $TaskEofOutput){throw 'Observation already exists'}
[IO.File]::WriteAllText($TaskEofOutput,($TaskEofReceipt|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
$TaskEofReceipt|ConvertTo-Json -Depth 8 -Compress
