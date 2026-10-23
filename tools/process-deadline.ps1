# Shared direct-process transport. No EOF wait and no lifecycle tree termination.
# Native handles preserve bytes; the inherited handle list excludes caller pipes.
if (-not ('Teruisi.DeadlineProcess' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace Teruisi {
  public sealed class DeadlineProcess : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int length; public IntPtr descriptor; public int inherit; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO {
      public int cb; public string reserved; public string desktop; public string title;
      public int x,y,xSize,ySize,xCount,yCount,fill,flags; public short show,reserved2;
      public IntPtr reservedPointer,input,output,error;
    }
    [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO startup; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public int pid,tid; }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFileW(string name,uint access,uint share,ref SECURITY_ATTRIBUTES attrs,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string app,StringBuilder cmd,IntPtr processAttrs,IntPtr threadAttrs,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFOEX startup,out PROCESS_INFORMATION info);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr handle,out int code);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr handle,uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    IntPtr process,input,output,error;
    public int Id { get; private set; }
    static IntPtr FileHandle(string path,uint access,uint mode) {
      var attrs=new SECURITY_ATTRIBUTES {length=Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)),inherit=1};
      var handle=CreateFileW(path,access,7,ref attrs,mode,0x100,IntPtr.Zero);
      if(handle==new IntPtr(-1))throw new Win32Exception(Marshal.GetLastWin32Error());
      return handle;
    }
    public static DeadlineProcess Start(string executable,string arguments,string cwd,string stdout,string stderr) {
      var result=new DeadlineProcess();IntPtr list=IntPtr.Zero,values=IntPtr.Zero;bool initialized=false;
      try {
        result.input=FileHandle("NUL",0x80000000,3);
        result.output=FileHandle(stdout,0xC0000000,1);result.error=FileHandle(stderr,0xC0000000,1);
        IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);
        list=Marshal.AllocHGlobal(size);
        if(!InitializeProcThreadAttributeList(list,1,0,ref size))throw new Win32Exception(Marshal.GetLastWin32Error());
        initialized=true;values=Marshal.AllocHGlobal(3*IntPtr.Size);
        Marshal.WriteIntPtr(values,0,result.input);Marshal.WriteIntPtr(values,IntPtr.Size,result.output);Marshal.WriteIntPtr(values,2*IntPtr.Size,result.error);
        if(!UpdateProcThreadAttribute(list,0,new IntPtr(0x20002),values,new IntPtr(3*IntPtr.Size),IntPtr.Zero,IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error());
        var si=new STARTUPINFOEX();si.startup.cb=Marshal.SizeOf(typeof(STARTUPINFOEX));si.startup.flags=0x100;
        si.startup.input=result.input;si.startup.output=result.output;si.startup.error=result.error;si.attributes=list;
        PROCESS_INFORMATION pi;
        if(!CreateProcessW(executable,new StringBuilder("\""+executable+"\" "+arguments),IntPtr.Zero,IntPtr.Zero,true,0x08080000,IntPtr.Zero,cwd,ref si,out pi))throw new Win32Exception(Marshal.GetLastWin32Error());
        result.process=pi.process;result.Id=pi.pid;CloseHandle(pi.thread);return result;
      } catch {result.Dispose();throw;}
      finally {if(initialized)DeleteProcThreadAttributeList(list);if(list!=IntPtr.Zero)Marshal.FreeHGlobal(list);if(values!=IntPtr.Zero)Marshal.FreeHGlobal(values);}
    }
    public bool WaitForExit(int milliseconds) {
      uint state=WaitForSingleObject(process,(uint)milliseconds);
      if(state==0xFFFFFFFF)throw new Win32Exception(Marshal.GetLastWin32Error());return state==0;
    }
    public bool HasExited {get{return WaitForExit(0);}}
    public int ExitCode {get {if(!HasExited)throw new InvalidOperationException();int code;if(!GetExitCodeProcess(process,out code))throw new Win32Exception(Marshal.GetLastWin32Error());return code;}}
    public void Kill() {if(!HasExited&&!TerminateProcess(process,1))throw new Win32Exception(Marshal.GetLastWin32Error());}
    public void Dispose() {foreach(var handle in new[]{process,input,output,error})if(handle!=IntPtr.Zero)CloseHandle(handle);process=input=output=error=IntPtr.Zero;}
  }
}
'@
}
function Get-ProcessDeadline([int]$TimeoutMilliseconds = 600000) {
  if ($TimeoutMilliseconds -lt 1 -or $TimeoutMilliseconds -gt 1800000) { throw 'invalid_process_timeout' }
  $deadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + $TimeoutMilliseconds
  if ($env:TERUISI_PROCESS_DEADLINE_UNIX_MS) {
    $inherited = 0L
    if (-not [long]::TryParse($env:TERUISI_PROCESS_DEADLINE_UNIX_MS, [ref]$inherited) -or $inherited -le 0) { throw 'invalid_process_deadline' }
    $deadline = [Math]::Min($deadline, $inherited)
  }
  return $deadline
}
function Get-ProcessRemaining([long]$Deadline) {
  $remaining = $Deadline - [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  if ($remaining -le 0) { throw 'process_deadline_exhausted' }
  return [int][Math]::Min(2147483647, $remaining)
}
function ConvertTo-ProcessArgument([string]$Value) {
  # Windows CommandLineToArgvW quoting, including backslashes before quotes/end.
  return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}
function ConvertTo-ProcessPowerShellArguments([string]$Executable, [string[]]$Arguments) {
  if ([IO.Path]::GetFileName($Executable) -notin @('powershell.exe','pwsh.exe') -or $Arguments -notcontains '-File') { return ,$Arguments }
  $index = [Array]::IndexOf($Arguments, '-File')
  $parameters = @{}
  $switches = @('-Json','-KeepPostgres','-Execute','-ConfirmedIsolatedRestore','-ConfirmedPrune')
  for ($i=$index+2; $i -lt $Arguments.Length; $i++) {
    $key=$Arguments[$i]
    if ($key -notmatch '^-[A-Za-z][A-Za-z0-9]*$' -or $parameters.ContainsKey($key.Substring(1))) { throw 'invalid_process_parameters' }
    if ($switches -contains $key) { $parameters[$key.Substring(1)]=$true }
    else { $i++; if($i -ge $Arguments.Length) { throw 'invalid_process_parameters' }; $parameters[$key.Substring(1)]=$Arguments[$i] }
  }
  $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@{file=$Arguments[$index+1];parameters=$parameters}|ConvertTo-Json -Depth 8 -Compress)))
  $bootstrap = @"
`$ErrorActionPreference='Stop'
`$ProgressPreference='SilentlyContinue'
`$utf8=[Text.UTF8Encoding]::new(`$false)
[Console]::InputEncoding=`$utf8;[Console]::OutputEncoding=`$utf8;`$OutputEncoding=`$utf8
`$request=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$payload'))|ConvertFrom-Json
`$parameters=@{};foreach(`$p in `$request.parameters.PSObject.Properties){`$parameters[`$p.Name]=`$p.Value}
`$global:LASTEXITCODE=0
& ([string]`$request.file) @parameters
`$invocationSucceeded=`$?
if(`$global:LASTEXITCODE -ne 0){exit `$global:LASTEXITCODE}
if(-not `$invocationSucceeded){exit 1}
exit 0
"@
  return ,@('-NoProfile','-NonInteractive','-EncodedCommand',[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($bootstrap)))
}
function Read-ProcessOutputSnapshot([string]$Path, [int]$Limit) {
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
  try {
    $length = $stream.Length
    if ($length -gt $Limit) { throw 'process_output_limit' }
    $bytes = New-Object byte[] ([int]$length)
    $offset = 0
    while ($offset -lt $bytes.Length) {
      $count = $stream.Read($bytes, $offset, $bytes.Length - $offset)
      if ($count -eq 0) { throw 'process_output_incomplete' }
      $offset += $count
    }
    return ,$bytes
  } finally { $stream.Dispose() }
}
function Invoke-DeadlineProcess {
  param([string]$Executable, [string[]]$Arguments, [string]$WorkingDirectory,
    [long]$Deadline = (Get-ProcessDeadline), [int]$MaxOutputBytes = 1048576,
    [ValidateSet('Preserve','Direct')][string]$Cleanup = 'Preserve')
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $evidence = [ordered]@{version=1;stage='spawn';code='unknown';processId=$null;exitCode=$null;timeoutType=$null;deadlineUnixMs=$Deadline;elapsedMs=0;outputProtocol='direct-exit-file-snapshot';cleanup=$Cleanup;stdoutBytes=0;stderrBytes=0}
  $root = Join-Path ([IO.Path]::GetTempPath()) ('teruisi-process-'+[guid]::NewGuid().ToString('N'))
  $process = $null
  try {
    [void](Get-ProcessRemaining $Deadline)
    if ($MaxOutputBytes -lt 1 -or $MaxOutputBytes -gt 67108864) { throw 'invalid_process_output_limit' }
    [void][IO.Directory]::CreateDirectory($root)
    $stdout = Join-Path $root 'stdout.log'; $stderr = Join-Path $root 'stderr.log'
    $Arguments = ConvertTo-ProcessPowerShellArguments $Executable $Arguments
    $argv = ($Arguments | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join ' '
    # Keep the kernel process handle from creation to direct exit.
    $savedDeadline = $env:TERUISI_PROCESS_DEADLINE_UNIX_MS
    $savedModules = $env:PSModulePath
    $savedLibrary = $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
    $savedMaintenanceLibrary = $env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY
    $systemHost = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $isSystemHost = [IO.Path]::GetFullPath($Executable).Equals($systemHost, [StringComparison]::OrdinalIgnoreCase)
    try {
    $env:TERUISI_PROCESS_DEADLINE_UNIX_MS = [string]$Deadline
    if ($isSystemHost) {
      $env:PSModulePath = Join-Path (Split-Path -Parent $systemHost) 'Modules'
      $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = $null
      $env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY = $null
    }
    $process = [Teruisi.DeadlineProcess]::Start($Executable, $argv, $WorkingDirectory, $stdout, $stderr)
    } finally {
      $env:TERUISI_PROCESS_DEADLINE_UNIX_MS = $savedDeadline
      $env:PSModulePath = $savedModules
      $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY = $savedLibrary
      $env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY = $savedMaintenanceLibrary
    }
    $evidence.processId = $process.Id
    $evidence.stage = 'direct-exit'
    while (-not $process.WaitForExit([Math]::Min(50, (Get-ProcessRemaining $Deadline)))) {
      if ((Get-Item -LiteralPath $stdout).Length + (Get-Item -LiteralPath $stderr).Length -gt $MaxOutputBytes) { throw 'process_output_limit' }
    }
    $evidence.exitCode = $process.ExitCode
    if ($null -eq $evidence.exitCode) { throw 'process_exit_unavailable' }
    $evidence.stage = 'output-snapshot'
    [void](Get-ProcessRemaining $Deadline)
    $out = Read-ProcessOutputSnapshot $stdout $MaxOutputBytes
    $err = Read-ProcessOutputSnapshot $stderr ($MaxOutputBytes - $out.Length)
    $evidence.stdoutBytes = $out.Length; $evidence.stderrBytes = $err.Length
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
      $evidence.stdoutSha256 = ([BitConverter]::ToString($sha.ComputeHash($out))).Replace('-','').ToLowerInvariant()
      $evidence.stderrSha256 = ([BitConverter]::ToString($sha.ComputeHash($err))).Replace('-','').ToLowerInvariant()
    } finally { $sha.Dispose() }
    [void](Get-ProcessRemaining $Deadline)
    $evidence.stage = 'completed'; $evidence.code = 'completed'; $evidence.elapsedMs = $clock.ElapsedMilliseconds
    return [pscustomobject]@{ExitCode=$evidence.exitCode;Stdout=[Text.Encoding]::UTF8.GetString($out);Stderr=[Text.Encoding]::UTF8.GetString($err);Evidence=$evidence}
  } catch {
    $code = [string]$_.Exception.Message
    if ($code -cnotmatch '^process_(deadline_exhausted|output_limit|output_incomplete|exit_unavailable)$') { $code = 'process_transport_failed' }
    $evidence.code = $code; $evidence.elapsedMs = $clock.ElapsedMilliseconds
    if ($code -eq 'process_deadline_exhausted') { $evidence.timeoutType = $evidence.stage }
    # The Process object pins the original kernel identity. Never enumerate or
    # kill descendants: a probe/adapter can parent an independently owned service.
    if ($Cleanup -eq 'Direct' -and $process -and -not $process.HasExited) { try { $process.Kill() } catch { } }
    $failure = [Exception]::new(('process_failure '+($evidence | ConvertTo-Json -Compress)))
    $failure.Data['ProcessEvidence'] = $evidence
    throw $failure
  } finally {
    if ($process) { $process.Dispose() }
    # A descendant can retain the files. Cleanup is best effort without a wait.
    foreach ($file in @('stdout.log','stderr.log')) { try { [IO.File]::Delete((Join-Path $root $file)) } catch { } }
    try { [IO.Directory]::Delete($root) } catch { }
  }
}
