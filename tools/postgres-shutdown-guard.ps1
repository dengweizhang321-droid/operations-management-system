[CmdletBinding()]
param(
  # Defaults are the only production values. The overrides exist so the tests can
  # point the guard at a stand-in pg_ctl and a temporary directory.
  [string]$PgCtlPath = "D:\teruisi-runtime\django-sales\postgresql-17.11\bin\pg_ctl.exe",
  [string]$DataDirectory = "D:\teruisi-runtime\django-sales\postgres-data",
  [string]$LogDirectory = "D:\teruisi-runtime\django-sales\logs",
  [ValidateRange(1, 60)][int]$StatusTimeoutSeconds = 10,
  [ValidateRange(1, 120)][int]$StopWaitSeconds = 25,
  # Hard ceiling for the whole pg_ctl stop process; must exceed StopWaitSeconds.
  [ValidateRange(2, 180)][int]$StopProcessTimeoutSeconds = 35,
  [string]$BlockReason = "正在安全停止数据库",
  # Define the functions and the .NET type only; do not take the mutex or run the loop.
  [switch]$NoRun
)

# Keeps the local PostgreSQL from being killed by Windows shutdown/logoff. PostgreSQL here
# is an ordinary user process (pg_ctl start), so without this it dies with the session and
# the next boot always performs crash recovery (statistics are discarded). The guard owns one
# hidden top-level window; on WM_QUERYENDSESSION it registers a shutdown block reason, stops
# the deployment's PostgreSQL with `pg_ctl stop -m fast`, removes the reason and lets the
# shutdown continue. It never cancels or delays shutdown beyond the bounded pg_ctl timeouts.
# Windows PowerShell 5.1 only (System.Windows.Forms; csc language level C# 5).

$ErrorActionPreference = "Stop"

function Assert-GuardNoReparsePath([string]$Path, [switch]$AllowMissing) {
  $absolute = [IO.Path]::GetFullPath($Path)
  $root = [IO.Path]::GetPathRoot($absolute)
  $current = $root
  foreach ($part in @($absolute.Substring($root.Length).Split(@('\', '/'), [StringSplitOptions]::RemoveEmptyEntries))) {
    $current = Join-Path $current $part
    if (-not (Test-Path -LiteralPath $current)) {
      if ($AllowMissing) { return }
      throw "Path component is missing: $current"
    }
    $item = Get-Item -LiteralPath $current -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Reparse points are forbidden in guarded paths: $current"
    }
  }
}

function Get-GuardInstanceMutexName([string]$Data) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(([IO.Path]::GetFullPath($Data).TrimEnd('\')).ToLowerInvariant()))
  } finally { $sha.Dispose() }
  return "Local\TERUISI.PostgresShutdownGuard." + (([BitConverter]::ToString($hash, 0, 8)).Replace("-", ""))
}

function Add-PostgresShutdownGuardType {
  if ('Teruisi.PostgresShutdownGuardHost' -as [type]) { return }
  Add-Type -ReferencedAssemblies @('System.Windows.Forms') -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace Teruisi
{
    // Hidden top-level window (message-only windows do not receive the session-end broadcast).
    public sealed class PostgresShutdownGuardWindow : NativeWindow
    {
        private const int WM_DESTROY = 0x0002;
        private const int WM_CLOSE = 0x0010;
        private const int WM_QUERYENDSESSION = 0x0011;
        private const int WM_ENDSESSION = 0x0016;

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool ShutdownBlockReasonCreate(IntPtr hWnd, string reason);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool ShutdownBlockReasonDestroy(IntPtr hWnd);

        private readonly PostgresShutdownGuardHost host;
        public PostgresShutdownGuardWindow(PostgresShutdownGuardHost owner) { host = owner; }

        public void Create()
        {
            CreateParams cp = new CreateParams();
            cp.Caption = "TERUISI PostgreSQL shutdown guard";
            cp.Style = 0; // WS_OVERLAPPED, never shown: top-level but invisible
            cp.ExStyle = 0x80; // WS_EX_TOOLWINDOW: no taskbar button
            CreateHandle(cp);
        }

        public void Destroy() { if (Handle != IntPtr.Zero) DestroyHandle(); }

        public bool CreateBlockReason(string text)
        {
            return ShutdownBlockReasonCreate(Handle, text);
        }

        public bool DestroyBlockReason()
        {
            return ShutdownBlockReasonDestroy(Handle);
        }

        protected override void WndProc(ref Message m)
        {
            try
            {
                if (m.Msg == WM_QUERYENDSESSION)
                {
                    host.OnQueryEndSession(this, m.LParam.ToInt64());
                    m.Result = (IntPtr)1; // always allow the session to end
                    return;
                }
                if (m.Msg == WM_ENDSESSION)
                {
                    host.OnEndSession(m.WParam != IntPtr.Zero, m.LParam.ToInt64());
                    m.Result = IntPtr.Zero;
                    return;
                }
                if (m.Msg == WM_CLOSE)
                {
                    DestroyHandle();
                    Application.ExitThread();
                    return;
                }
            }
            catch (Exception ex)
            {
                try { host.Log("window_error", "type", ex.GetType().Name); } catch (Exception) { }
                if (m.Msg == WM_QUERYENDSESSION) { m.Result = (IntPtr)1; return; }
            }
            base.WndProc(ref m);
        }
    }

    public sealed class PostgresShutdownGuardHost
    {
        public string PgCtlPath;
        public string DataDirectory;
        public string LogPath;
        public string BlockReasonText;
        public int StatusTimeoutMs = 10000;
        public int StopWaitSeconds = 25;
        public int StopProcessTimeoutMs = 35000;

        // Ordered in-memory trace of the decisions taken (also readable by the tests).
        public readonly List<string> Events = new List<string>();
        private readonly object gate = new object();
        private Thread thread;
        private PostgresShutdownGuardWindow window;
        private readonly ManualResetEvent ready = new ManualResetEvent(false);
        private Exception startError;
        private bool stopAttempted;

        public IntPtr Handle { get { return window == null ? IntPtr.Zero : window.Handle; } }

        public void Start()
        {
            thread = new Thread(Run);
            thread.IsBackground = false;
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            ready.WaitOne();
            if (startError != null) throw new InvalidOperationException("Guard window could not be created: " + startError.GetType().Name);
            Log("guard_started");
        }

        private void Run()
        {
            try
            {
                window = new PostgresShutdownGuardWindow(this);
                window.Create();
            }
            catch (Exception ex) { startError = ex; ready.Set(); return; }
            ready.Set();
            Application.Run();
        }

        public void WaitForExit() { if (thread != null) thread.Join(); }

        public void RequestStop()
        {
            if (window != null && window.Handle != IntPtr.Zero) PostMessage(window.Handle, 0x0010, IntPtr.Zero, IntPtr.Zero);
        }

        [DllImport("user32.dll")]
        private static extern bool PostMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

        public string[] GetEvents() { lock (gate) { return Events.ToArray(); } }

        private void Trace(string name) { lock (gate) { Events.Add(name); } }

        public void OnQueryEndSession(PostgresShutdownGuardWindow w, long lParam)
        {
            long flags = lParam & 0xFFFFFFFFL;
            Trace("query_end_session");
            Log("query_end_session", "flags", "0x" + flags.ToString("X"));
            // ENDSESSION_CLOSEAPP: Restart Manager asks only this process to exit; the session is not ending.
            if ((flags & 0x1L) != 0)
            {
                Trace("close_app_request_ignored");
                Log("close_app_request_ignored", "flags", "0x" + flags.ToString("X"));
                return;
            }
            try
            {
                bool created = w.CreateBlockReason(BlockReasonText);
                Trace("block_create");
                Log("block_reason_created", "ok", created);
            }
            catch (Exception ex) { Trace("block_create"); Log("block_reason_error", "type", ex.GetType().Name); }
            try { StopDatabase("query_end_session"); }
            finally
            {
                // Always removed after it was attempted, even when creation reported failure.
                bool destroyed = false;
                try { destroyed = w.DestroyBlockReason(); } catch (Exception) { }
                Trace("block_destroy");
                Log("block_reason_destroyed", "ok", destroyed);
            }
        }

        public void OnEndSession(bool ending, long lParam)
        {
            long flags = lParam & 0xFFFFFFFFL;
            Trace(ending ? "end_session" : "end_session_cancelled");
            Log(ending ? "end_session" : "end_session_cancelled", "flags", "0x" + flags.ToString("X"));
            if (!ending) { lock (gate) { stopAttempted = false; } return; }
            if ((flags & 0x1L) != 0)
            {
                Trace("close_app_request_ignored");
                Log("close_app_request_ignored", "flags", "0x" + flags.ToString("X"));
                return;
            }
            bool attempted;
            lock (gate) { attempted = stopAttempted; }
            // Fallback only: forced shutdowns skip WM_QUERYENDSESSION. Best effort, no block reason.
            if (!attempted) StopDatabase("end_session_fallback");
        }

        private sealed class RunResult
        {
            public bool Started;
            public bool TimedOut;
            public int ExitCode = -1;
            public long ElapsedMs;
        }

        private static string Quote(string value)
        {
            string v = value.Replace("\"", "");
            if (v.EndsWith("\\")) v += "\\";
            return "\"" + v + "\"";
        }

        private RunResult RunPgCtl(string arguments, int timeoutMs)
        {
            RunResult result = new RunResult();
            Stopwatch clock = Stopwatch.StartNew();
            try
            {
                ProcessStartInfo info = new ProcessStartInfo();
                info.FileName = PgCtlPath;
                info.Arguments = arguments;
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                info.RedirectStandardOutput = true;
                info.RedirectStandardError = true;
                using (Process process = Process.Start(info))
                {
                    result.Started = true;
                    // Drain without keeping the output; it can contain local paths.
                    process.OutputDataReceived += delegate { };
                    process.ErrorDataReceived += delegate { };
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();
                    if (process.WaitForExit(timeoutMs))
                    {
                        result.ExitCode = process.ExitCode;
                    }
                    else
                    {
                        result.TimedOut = true;
                        try { process.Kill(); } catch (Exception) { }
                    }
                }
            }
            catch (Exception ex)
            {
                Log("pg_ctl_launch_failed", "type", ex.GetType().Name);
            }
            result.ElapsedMs = clock.ElapsedMilliseconds;
            return result;
        }

        public void StopDatabase(string trigger)
        {
            lock (gate) { stopAttempted = true; }
            Stopwatch total = Stopwatch.StartNew();
            RunResult status = RunPgCtl("status -D " + Quote(DataDirectory), StatusTimeoutMs);
            Trace("status");
            Log("status_checked", "trigger", trigger, "exitCode", status.ExitCode, "timedOut", status.TimedOut, "elapsedMs", status.ElapsedMs);
            if (!status.Started || status.TimedOut) { Log("stop_skipped", "reason", "status_unavailable"); return; }
            if (status.ExitCode == 3) { Log("postgres_not_running", "elapsedMs", total.ElapsedMilliseconds); return; }
            if (status.ExitCode != 0) { Log("stop_skipped", "reason", "status_unexpected", "exitCode", status.ExitCode); return; }
            Log("stop_started", "trigger", trigger);
            RunResult stop = RunPgCtl("stop -D " + Quote(DataDirectory) + " -m fast -w -t " + StopWaitSeconds.ToString(), StopProcessTimeoutMs);
            Trace("stop");
            if (stop.TimedOut) Log("stop_timeout", "elapsedMs", stop.ElapsedMs);
            else Log("stop_finished", "exitCode", stop.ExitCode, "ok", stop.Started && stop.ExitCode == 0, "elapsedMs", stop.ElapsedMs);
        }

        private static string Json(object value)
        {
            if (value == null) return "null";
            if (value is bool) return ((bool)value) ? "true" : "false";
            if (value is int || value is long) return Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture);
            StringBuilder sb = new StringBuilder("\"");
            foreach (char c in Convert.ToString(value))
            {
                if (c == '"') sb.Append("\\\"");
                else if (c == '\\') sb.Append("\\\\");
                else if (c < 0x20) sb.Append("\\u" + ((int)c).ToString("x4"));
                else sb.Append(c);
            }
            return sb.Append('"').ToString();
        }

        public void Log(string name, params object[] pairs)
        {
            try
            {
                StringBuilder sb = new StringBuilder("{\"timestamp\":");
                sb.Append(Json(DateTimeOffset.Now.ToString("o"))).Append(",\"event\":").Append(Json(name));
                sb.Append(",\"processId\":").Append(Process.GetCurrentProcess().Id);
                for (int i = 0; i + 1 < pairs.Length; i += 2)
                    sb.Append(',').Append(Json(pairs[i])).Append(':').Append(Json(pairs[i + 1]));
                sb.Append("}").Append(Environment.NewLine);
                lock (gate)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(LogPath));
                    FileInfo info = new FileInfo(LogPath);
                    if (info.Exists && info.Length > 1048576) File.Copy(LogPath, LogPath + ".1", true);
                    if (info.Exists && info.Length > 1048576) File.WriteAllText(LogPath, "");
                    File.AppendAllText(LogPath, sb.ToString(), new UTF8Encoding(false));
                }
            }
            catch (Exception) { /* logging must never block the shutdown path */ }
        }
    }
}
'@
}

function New-PostgresShutdownGuardHost {
  param(
    [Parameter(Mandatory)][string]$PgCtl,
    [Parameter(Mandatory)][string]$Data,
    [Parameter(Mandatory)][string]$Logs,
    [int]$StatusSeconds = 10,
    [int]$StopWait = 25,
    [int]$StopProcessSeconds = 35,
    [string]$Reason = "正在安全停止数据库"
  )
  if ($StopProcessSeconds -le $StopWait) { throw "StopProcessTimeoutSeconds must exceed StopWaitSeconds" }
  $pgCtlFull = [IO.Path]::GetFullPath($PgCtl)
  $dataFull = [IO.Path]::GetFullPath($Data).TrimEnd('\')
  $logsFull = [IO.Path]::GetFullPath($Logs).TrimEnd('\')
  Assert-GuardNoReparsePath $pgCtlFull
  Assert-GuardNoReparsePath $dataFull
  Assert-GuardNoReparsePath $logsFull -AllowMissing
  if (-not (Test-Path -LiteralPath $pgCtlFull -PathType Leaf)) { throw "pg_ctl is missing" }
  if (-not (Test-Path -LiteralPath $dataFull -PathType Container)) { throw "PostgreSQL data directory is missing" }
  Add-PostgresShutdownGuardType
  $hostObject = [Teruisi.PostgresShutdownGuardHost]::new()
  $hostObject.PgCtlPath = $pgCtlFull
  $hostObject.DataDirectory = $dataFull
  $hostObject.LogPath = Join-Path $logsFull "postgres-shutdown-guard.jsonl"
  $hostObject.BlockReasonText = $Reason
  $hostObject.StatusTimeoutMs = $StatusSeconds * 1000
  $hostObject.StopWaitSeconds = $StopWait
  $hostObject.StopProcessTimeoutMs = $StopProcessSeconds * 1000
  return $hostObject
}

if (-not $NoRun) {
  $mutex = [Threading.Mutex]::new($false, (Get-GuardInstanceMutexName $DataDirectory))
  $owned = $false
  try {
    try { $owned = $mutex.WaitOne([TimeSpan]::Zero) } catch [Threading.AbandonedMutexException] { $owned = $true }
    if (-not $owned) { exit 0 }
    $guard = New-PostgresShutdownGuardHost -PgCtl $PgCtlPath -Data $DataDirectory -Logs $LogDirectory `
      -StatusSeconds $StatusTimeoutSeconds -StopWait $StopWaitSeconds -StopProcessSeconds $StopProcessTimeoutSeconds -Reason $BlockReason
    $guard.Start()
    $guard.WaitForExit()
  } finally {
    if ($owned) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
  exit 0
}
