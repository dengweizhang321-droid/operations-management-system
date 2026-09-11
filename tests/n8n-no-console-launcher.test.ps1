$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path $repo ('.runtime\n8n-no-console-test-' + [guid]::NewGuid().ToString('N'))
$build = & (Join-Path $repo 'tools\install-n8n-no-console.ps1') -BuildOnly -InstallRoot $testRoot | ConvertFrom-Json
$exe = $build.Executable
function Assert-Equal($actual, $expected, $label) {
  if ($actual -ne $expected) { throw "$label expected $expected; got $actual" }
}
function Invoke-Launcher([string]$arguments) {
  $p = Start-Process -FilePath $exe -ArgumentList $arguments -WindowStyle Hidden -PassThru
  if (-not $p.WaitForExit(20000)) { throw 'Launcher failed to exit within 20 seconds.' }
  $p.Refresh()
  return $p.ExitCode
}
# PE subsystem 2 means Windows GUI; no console is allocated for the wrapper.
$pe = [IO.File]::ReadAllBytes($exe)
$offset = [BitConverter]::ToInt32($pe, 0x3c)
Assert-Equal ([BitConverter]::ToUInt16($pe, $offset + 24 + 68)) 2 'PE subsystem'

$probeSource = Join-Path $testRoot 'Probe.cs'
@'
using System;
using System.IO;
using System.Runtime.InteropServices;
class Probe {
  [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
  static int Main(string[] args) {
    File.WriteAllText(args[0], GetConsoleWindow().ToInt64().ToString());
    if (args.Length == 2) {
      File.WriteAllText(args[1], System.Diagnostics.Process.GetCurrentProcess().Id.ToString());
      System.Threading.Thread.Sleep(60000);
    }
    return 0;
  }
}
'@ | Set-Content -LiteralPath $probeSource -Encoding UTF8
$probe = Join-Path $testRoot 'Probe.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:exe "/out:$probe" $probeSource
if ($LASTEXITCODE -ne 0) { throw 'Probe compilation failed.' }
$script = Join-Path $testRoot '中文 service probe.ps1'
@'
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'
[ConsoleProbe]::GetConsoleWindow().ToInt64() | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'powershell-console.txt')
& (Join-Path $PSScriptRoot 'Probe.exe') (Join-Path $PSScriptRoot 'grandchild-console.txt')
# Output without a console must not block or cause a child failure.
for ($i=0; $i -lt 3000; $i++) { [Console]::Out.WriteLine(('o' * 100)); [Console]::Error.WriteLine(('e' * 100)) }
Start-Sleep -Milliseconds 500
exit 37
'@ | Set-Content -LiteralPath $script -Encoding UTF8
$clock = [Diagnostics.Stopwatch]::StartNew()
Assert-Equal (Invoke-Launcher ('"' + $script + '"')) 37 'Child exit code'
if ($clock.ElapsedMilliseconds -lt 500) { throw 'Launcher did not wait for its child.' }
Assert-Equal ([IO.File]::ReadAllText((Join-Path $testRoot 'powershell-console.txt')).Trim()) '0' 'PowerShell console handle'
Assert-Equal ([IO.File]::ReadAllText((Join-Path $testRoot 'grandchild-console.txt')).Trim()) '0' 'Native grandchild console handle'
Assert-Equal (Invoke-Launcher ('"' + (Join-Path $testRoot 'missing.ps1') + '"')) 64 'Missing script rejection'
Assert-Equal (Invoke-Launcher ('"' + $script + '" extra')) 64 'Extra arguments rejection'
Assert-Equal (Invoke-Launcher 'relative.ps1') 64 'Relative path rejection'
'exit 0' | Set-Content -LiteralPath $script -Encoding UTF8
Assert-Equal (Invoke-Launcher ('"' + $script + '"')) 0 'Success exit code'
# Verify the actual Windows scheduler lifecycle, using only a disposable probe task.
@'
$PID | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'scheduled-child.txt')
& (Join-Path $PSScriptRoot 'Probe.exe') (Join-Path $PSScriptRoot 'scheduled-console.txt') (Join-Path $PSScriptRoot 'scheduled-native.txt')
'@ | Set-Content -LiteralPath $script -Encoding UTF8
$taskName = 'TERUISI-NoConsole-Test-' + [guid]::NewGuid().ToString('N')
$registered = $false
try {
  $action = New-ScheduledTaskAction -Execute $exe -Argument ('"' + $script + '"')
  $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal | Out-Null
  $registered = $true
  Start-ScheduledTask -TaskName $taskName
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while (-not (Test-Path -LiteralPath (Join-Path $testRoot 'scheduled-native.txt'))) {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Scheduled child did not start.' }
    Start-Sleep -Milliseconds 100
  }
  $childId = [int](Get-Content -LiteralPath (Join-Path $testRoot 'scheduled-child.txt'))
  $nativeId = [int](Get-Content -LiteralPath (Join-Path $testRoot 'scheduled-native.txt'))
  Assert-Equal ([string](Get-ScheduledTask -TaskName $taskName).State) 'Running' 'Task waits for service'
  Assert-Equal ([IO.File]::ReadAllText((Join-Path $testRoot 'scheduled-console.txt')).Trim()) '0' 'Scheduled native console'
  Stop-ScheduledTask -TaskName $taskName
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  while ((Get-Process -Id $childId,$nativeId -ErrorAction SilentlyContinue)) {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Scheduler left an orphan child.' }
    Start-Sleep -Milliseconds 100
  }
} finally {
  if ($registered) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
}
[pscustomobject]@{ Result='passed'; NoConsole=$true; NativeGrandchildNoConsole=$true; ExitCodes=@(0,37,64); UnattachedOutput='passed'; SchedulerStopTree='passed'; TestRoot=$testRoot } | ConvertTo-Json
