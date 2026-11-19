# Fixture-only test for Set-ServiceProcessNormalPriority in tools/django-local-service.ps1.
# Each scenario runs in a short-lived CHILD PowerShell process that lowers ITSELF
# to BelowNormal / memory 2 / I/O 1 (what Explorer-started Startup items hand to
# PostgreSQL), dot-sources the controller in library mode against a temporary
# fake runtime root, and calls the function. It never touches any production
# process, runtime directory or database, and never starts a service.
$ErrorActionPreference = 'Stop'
$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ServiceScript = Join-Path $WorkspaceRoot 'tools\django-local-service.ps1'
$FixtureRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ('process-priority-' + [guid]::NewGuid().ToString('N'))))
New-Item -ItemType Directory -Path $FixtureRoot | Out-Null
$script:Failures = New-Object System.Collections.Generic.List[string]
$script:Passed = 0
function Check([string]$Name, [scriptblock]$Body) {
  try { & $Body; $script:Passed++ } catch { $script:Failures.Add(('FAIL: {0} :: {1}' -f $Name, $_.Exception.Message)) }
}
function Assert-That([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }

$Utf8NoBom = [Text.UTF8Encoding]::new($false)
# The child script. $Scenario selects the behaviour; the result is one JSON line.
$childSource = @'
param([string]$ServiceScript, [string]$RuntimeRoot, [string]$Scenario)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
namespace PriorityProbe {
  public static class Probe {
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessInformation(IntPtr h, int c, ref uint i, uint s);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetProcessInformation(IntPtr h, int c, ref uint i, uint s);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int c, ref uint i, int s, out int r);
    [DllImport("ntdll.dll")] static extern int NtSetInformationProcess(IntPtr h, int c, ref uint i, int s);
    public static string Read() {
      uint m = 0, io = 0; int r;
      GetProcessInformation(GetCurrentProcess(), 0, ref m, 4);
      NtQueryInformationProcess(GetCurrentProcess(), 33, ref io, 4, out r);
      return Process.GetCurrentProcess().PriorityClass.ToString() + "/" + m + "/" + io;
    }
    public static void Lower(string cls, uint memory, uint ioPriority) {
      Process.GetCurrentProcess().PriorityClass = (ProcessPriorityClass)Enum.Parse(typeof(ProcessPriorityClass), cls);
      SetProcessInformation(GetCurrentProcess(), 0, ref memory, 4);
      NtSetInformationProcess(GetCurrentProcess(), 33, ref ioPriority, 4);
    }
  }
}
"@
$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = '1'
. $ServiceScript -Action Status -RuntimeRoot $RuntimeRoot
New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
$result = [ordered]@{ scenario = $Scenario }
switch ($Scenario) {
  'lowered' {
    [PriorityProbe.Probe]::Lower('BelowNormal', 2, 1)
    $result.before = [PriorityProbe.Probe]::Read()
    $out = @(Set-ServiceProcessNormalPriority)
    $result.output = $out.Count
    $result.after = [PriorityProbe.Probe]::Read()
    $self = (Get-Process -Id $PID).Path
    $grand = Join-Path $RuntimeRoot 'grandchild.ps1'
    [IO.File]::WriteAllText($grand, 'Add-Type -TypeDefinition @"' + "`n" + 'using System;using System.Diagnostics;using System.Runtime.InteropServices;namespace G{public static class P{[DllImport("kernel32.dll")]static extern IntPtr GetCurrentProcess();[DllImport("kernel32.dll")]static extern bool GetProcessInformation(IntPtr h,int c,ref uint i,uint s);[DllImport("ntdll.dll")]static extern int NtQueryInformationProcess(IntPtr h,int c,ref uint i,int s,out int r);public static string Read(){uint m=0,io=0;int r;GetProcessInformation(GetCurrentProcess(),0,ref m,4);NtQueryInformationProcess(GetCurrentProcess(),33,ref io,4,out r);return Process.GetCurrentProcess().PriorityClass.ToString()+"/"+m+"/"+io;}}}' + "`n" + '"@' + "`n" + '[Console]::Out.Write([G.P]::Read())')
    $gp = Start-Process -FilePath $self -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $grand) `
      -RedirectStandardOutput (Join-Path $RuntimeRoot 'grand.out') -RedirectStandardError (Join-Path $RuntimeRoot 'grand.err') -PassThru -WindowStyle Hidden
    $gp.WaitForExit(60000) | Out-Null
    $result.grandchild = (Get-Content -LiteralPath (Join-Path $RuntimeRoot 'grand.out') -Raw).Trim()
    # Second call is idempotent and must not log a second "normalized" event.
    $out2 = @(Set-ServiceProcessNormalPriority)
    $result.output2 = $out2.Count
    $result.after2 = [PriorityProbe.Probe]::Read()
  }
  'higher' {
    [PriorityProbe.Probe]::Lower('AboveNormal', 5, 2)
    $result.before = [PriorityProbe.Probe]::Read()
    Set-ServiceProcessNormalPriority | Out-Null
    $result.after = [PriorityProbe.Probe]::Read()
  }
  'failing' {
    [PriorityProbe.Probe]::Lower('BelowNormal', 2, 1)
    $result.before = [PriorityProbe.Probe]::Read()
    function Initialize-ProcessPriorityNormalizer { throw 'simulated compile failure' }
    $threw = $false
    $out = $null
    try { $out = @(Set-ServiceProcessNormalPriority) } catch { $threw = $true }
    $result.threw = $threw
    $result.output = @($out).Count
    $result.after = [PriorityProbe.Probe]::Read()
  }
}
$result.log = if (Test-Path -LiteralPath $LauncherLogPath) { @(Get-Content -LiteralPath $LauncherLogPath | ForEach-Object { ($_ | ConvertFrom-Json).event }) } else { @() }
[Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
'@

function Invoke-Scenario([string]$Executable, [string]$Scenario) {
  $dir = Join-Path $FixtureRoot ([guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $dir | Out-Null
  $childPath = Join-Path $dir 'child.ps1'
  [IO.File]::WriteAllText($childPath, $childSource, [Text.UTF8Encoding]::new($true))
  $stdout = Join-Path $dir 'stdout.txt'
  $stderr = Join-Path $dir 'stderr.txt'
  $p = Start-Process -FilePath $Executable -ArgumentList @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $childPath,
    '-ServiceScript', ('"' + $ServiceScript + '"'), '-RuntimeRoot', ('"' + $dir + '"'), '-Scenario', $Scenario
  ) -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
  if (-not $p.WaitForExit(120000)) { try { $p.Kill() } catch { }; throw "scenario $Scenario timed out" }
  $p.WaitForExit()
  $text = if (Test-Path -LiteralPath $stdout) { (Get-Content -LiteralPath $stdout -Raw) } else { '' }
  $line = @($text -split "`n" | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1)
  if ($line.Count -ne 1) {
    $err = if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Raw } else { '' }
    throw "scenario $Scenario produced no result; stdout=$text stderr=$err"
  }
  return ($line[0] | ConvertFrom-Json)
}

$shells = @((Get-Command 'powershell.exe' -ErrorAction Stop).Source)
$pwsh = Get-Command 'pwsh.exe' -ErrorAction SilentlyContinue
if ($null -ne $pwsh) { $shells += $pwsh.Source }

try {
  foreach ($shell in $shells) {
    $label = Split-Path -Leaf $shell
    Check "$label lowered: becomes Normal/5/2 and children inherit it" {
      $r = Invoke-Scenario $shell 'lowered'
      Assert-That ($r.before -ceq 'BelowNormal/2/1') "precondition not met: $($r.before)"
      Assert-That ($r.after -ceq 'Normal/5/2') "after=$($r.after)"
      Assert-That ($r.grandchild -ceq 'Normal/5/2') "grandchild=$($r.grandchild)"
      Assert-That ($r.output -eq 0 -and $r.output2 -eq 0) 'function must emit no pipeline output'
      Assert-That ($r.after2 -ceq 'Normal/5/2') "second call changed state: $($r.after2)"
      Assert-That (@($r.log | Where-Object { $_ -ceq 'process_priority_normalized' }).Count -eq 1) "log=$($r.log -join ',')"
    }
    Check "$label higher: never lowers an already higher process" {
      $r = Invoke-Scenario $shell 'higher'
      Assert-That ($r.before -ceq 'AboveNormal/5/2') "precondition not met: $($r.before)"
      Assert-That ($r.after -ceq 'AboveNormal/5/2') "lowered or changed: $($r.after)"
      Assert-That (@($r.log).Count -eq 0 -or @($r.log | Where-Object { $_ -like 'process_priority_*' }).Count -eq 0) "unexpected event: $($r.log -join ',')"
    }
    Check "$label failing: failure is logged, never thrown, no pipeline output" {
      $r = Invoke-Scenario $shell 'failing'
      Assert-That (-not $r.threw) 'Set-ServiceProcessNormalPriority threw'
      Assert-That ($r.output -eq 0) 'failure path emitted pipeline output'
      Assert-That (@($r.log | Where-Object { $_ -ceq 'process_priority_normalize_failed' }).Count -eq 1) "log=$($r.log -join ',')"
      Assert-That ($r.after -ceq 'BelowNormal/2/1') "state changed unexpectedly: $($r.after)"
    }
  }

  Check 'Start-Postgres normalizes priority before creating any child process' {
    $source = [IO.File]::ReadAllText($ServiceScript)
    $start = $source.IndexOf('function Start-Postgres {')
    $end = $source.IndexOf('function Stop-Postgres {')
    Assert-That ($start -ge 0 -and $end -gt $start) 'Start-Postgres not found'
    $body = $source.Substring($start, $end - $start)
    $call = $body.IndexOf('Set-ServiceProcessNormalPriority | Out-Null')
    $first = $body.IndexOf('Get-PortListeners')
    $pgctl = $body.IndexOf('Invoke-PgCtl')
    Assert-That ($call -ge 0) 'Start-Postgres does not call Set-ServiceProcessNormalPriority'
    Assert-That ($call -lt $first -and $call -lt $pgctl) 'priority must be raised before the listener probe and pg_ctl'
    Assert-That ($source.IndexOf('Set-ServiceProcessNormalPriority | Out-Null') -eq ($start + $call)) 'only Start-Postgres should call it'
  }
} finally {
  Remove-Item -LiteralPath $FixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
}

foreach ($failure in $script:Failures) { [Console]::Out.WriteLine($failure) }
[Console]::Out.WriteLine(('passed={0} failed={1}' -f $script:Passed, $script:Failures.Count))
exit $(if ($script:Failures.Count -eq 0) { 0 } else { 1 })
