$ErrorActionPreference = 'Stop'
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('teruisi-service-exit-' + [guid]::NewGuid().ToString('N'))
$savedLibrary = $env:TERUISI_SYSTEM_SERVICE_LIBRARY_ONLY
try {
  [void][IO.Directory]::CreateDirectory($fixtureRoot)
  $env:TERUISI_SYSTEM_SERVICE_LIBRARY_ONLY = '1'
  . (Join-Path $PSScriptRoot '..\tools\operations-system-service.ps1') -Action Status -Json
  $ProjectRoot = $fixtureRoot
  $LogRoot = Join-Path $fixtureRoot 'logs'
  $SystemControlMutexName = 'Local\TERUISI.Test.ServiceExit.' + [guid]::NewGuid().ToString('N')
  $hostPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  foreach ($code in @(0, 9, 259)) {
    $fake = Join-Path $fixtureRoot "exit-$code.ps1"
    [IO.File]::WriteAllText($fake, "param([switch]`$Json); Write-Output '{`"status`":`"completed`"}'; exit $code")
    $failure = $null; $result = $null
    try { $result = Invoke-ControlledScript $hostPath $fake @() "exit-$code" -CaptureJson }
    catch { $failure = $_.Exception.Message }
    if ($code -eq 0) {
      if ($failure -or $result.status -cne 'completed') { throw 'real exit0 was rejected' }
    } elseif (-not $failure -or $failure -notmatch " $code") {
      throw "real exit$code was accepted or lost"
    }
  }
  $parent = Join-Path $fixtureRoot 'parent.ps1'
  $descendantPath = Join-Path $fixtureRoot 'descendant.ps1'
  $receiptPath = Join-Path $fixtureRoot 'descendant.json'
  [IO.File]::WriteAllText($descendantPath, 'Start-Sleep -Seconds 5; Write-Output "late descendant output"')
  $parentSource = @'
param([switch]$Json)
$hostPath=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$descendant=Start-Process -FilePath $hostPath -NoNewWindow -PassThru -ArgumentList @('-NoProfile','-NonInteractive','-File',('"'+(Join-Path $PSScriptRoot 'descendant.ps1')+'"'))
$handle=$descendant.Handle
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'descendant.json'),(@{pid=$descendant.Id;birth=$descendant.StartTime.ToUniversalTime().Ticks}|ConvertTo-Json -Compress))
Write-Output '{"status":"completed"}'
exit 9
'@
  [IO.File]::WriteAllText($parent, $parentSource)
  $timer = [Diagnostics.Stopwatch]::StartNew(); $caught = $false
  try { Invoke-ControlledScript $hostPath $parent @() 'parent' -CaptureJson | Out-Null }
  catch { $caught = $_.Exception.Message -match ' 9' }
  if (-not $caught -or $timer.ElapsedMilliseconds -gt 4000) { throw 'direct exit was lost or descendant EOF was awaited' }
  $receipt = [IO.File]::ReadAllText($receiptPath) | ConvertFrom-Json
  $descendant = Get-Process -Id $receipt.pid
  try {
    $handle = $descendant.Handle
    if ($descendant.StartTime.ToUniversalTime().Ticks -ne $receipt.birth -or $descendant.HasExited) { throw 'descendant identity was lost or terminated' }
    if (-not $descendant.WaitForExit(10000)) { throw 'fixture descendant did not naturally exit' }
  } finally { $descendant.Dispose() }
  & {
    # Missing evidence must fail closed even if a wrapper supplies valid JSON.
    function Start-Process {
      $fakeProcess = [pscustomobject]@{ Handle = [IntPtr]::Zero; ExitCode = $null }
      $fakeProcess | Add-Member ScriptMethod WaitForExit { param($Milliseconds) return $true }
      $fakeProcess | Add-Member ScriptMethod Dispose {}
      return $fakeProcess
    }
    $caught = $false
    try { Invoke-ControlledScript $hostPath 'synthetic' @() 'missing' -CaptureJson | Out-Null }
    catch { $caught = $_.Exception.Message -ceq 'controlled_script_exit_unavailable' }
    if (-not $caught) { throw 'missing exit evidence was accepted' }
  }
  & {
    function Assert-Dependencies {}
    function Invoke-StopWorkerOnly { throw 'synthetic operator failure' }
    $caught = $false
    try { Invoke-Stop | Out-Null } catch { $caught = $_.Exception.Message -ceq 'synthetic operator failure' }
    if (-not $caught) { throw 'operator failure was swallowed' }
    # Another process, rather than this reentrant thread, must acquire the lock.
    $probe = '$m=[Threading.Mutex]::new($false,''' + $SystemControlMutexName + ''');try{$ok=$m.WaitOne(0);if($ok){$m.ReleaseMutex()};if(-not $ok){exit 9}}finally{$m.Dispose()}'
    & $hostPath -NoProfile -NonInteractive -Command $probe
    if ($LASTEXITCODE -ne 0) { throw 'operator failure leaked the system mutex' }
  }
  Write-Output 'PASS: real exit0/9/259, inherited descendant output separation, missing exit failure closure, and lock exception release; isolated only'
} finally {
  $env:TERUISI_SYSTEM_SERVICE_LIBRARY_ONLY = $savedLibrary
  $resolved = [IO.Path]::GetFullPath($fixtureRoot)
  if ((Split-Path -Parent $resolved) -ine ([IO.Path]::GetTempPath()).TrimEnd('\') -or
      (Split-Path -Leaf $resolved) -notmatch '^teruisi-service-exit-[a-f0-9]{32}$') { throw 'fixture escaped temporary scope' }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
