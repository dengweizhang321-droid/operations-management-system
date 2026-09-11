using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

// Windows GUI subsystem: no console for this process. CreateProcess suppresses
// the child's console. A kill-on-close job owns the entire service process tree.
internal class NoConsoleLauncher
{
    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfo
    {
        public uint cb;
        public IntPtr reserved, desktop, title;
        public uint x, y, xSize, ySize, xChars, yChars, fill, flags;
        public ushort show, reservedSize;
        public IntPtr reservedBytes, stdin, stdout, stderr;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInfo { public IntPtr process, thread; public uint processId, threadId; }
    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimit
    {
        public long processTime, jobTime;
        public uint flags;
        public UIntPtr minimumWorkingSet, maximumWorkingSet;
        public uint activeProcesses;
        public UIntPtr affinity;
        public uint priority, scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters { public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes; }
    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimit
    {
        public BasicLimit basic;
        public IoCounters io;
        public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimit info, uint length);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool CreateProcess(string application, StringBuilder commandLine,
        IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags,
        IntPtr environment, string directory, ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [STAThread]
    private static int Main(string[] args)
    {
        IntPtr job = IntPtr.Zero;
        var child = new ProcessInfo();
        bool assigned = false;
        try
        {
            if (args.Length != 1 || !Path.IsPathRooted(args[0]) ||
                args[0].IndexOf('"') >= 0 || args[0].IndexOf('\r') >= 0 || args[0].IndexOf('\n') >= 0 ||
                !String.Equals(Path.GetExtension(args[0]), ".ps1", StringComparison.OrdinalIgnoreCase) ||
                !File.Exists(args[0])) return 64;
            string script = Path.GetFullPath(args[0]);
            string shell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                @"WindowsPowerShell\v1.0\powershell.exe");
            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) return 70;
            var limits = new ExtendedLimit();
            limits.basic.flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits))) return 70;
            var startup = new StartupInfo();
            startup.cb = (uint)Marshal.SizeOf(startup);
            var command = new StringBuilder("\"" + shell + "\" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\"");
            // CREATE_NO_WINDOW | CREATE_SUSPENDED: assign ownership before any script can run.
            // No inherited handles: children cannot keep the ownership job alive.
            if (!CreateProcess(shell, command, IntPtr.Zero, IntPtr.Zero, false, 0x08000004,
                IntPtr.Zero, Path.GetDirectoryName(script), ref startup, out child)) return 70;
            if (!AssignProcessToJobObject(job, child.process)) return 70;
            assigned = true;
            if (ResumeThread(child.thread) == UInt32.MaxValue) return 70;
            if (WaitForSingleObject(child.process, UInt32.MaxValue) != 0) return 70;
            uint code;
            return GetExitCodeProcess(child.process, out code) ? unchecked((int)code) : 70;
        }
        catch { return 70; } // No message box; the scheduler records the failure code.
        finally
        {
            if (!assigned && child.process != IntPtr.Zero) TerminateProcess(child.process, 70);
            if (job != IntPtr.Zero) CloseHandle(job);
            if (child.thread != IntPtr.Zero) CloseHandle(child.thread);
            if (child.process != IntPtr.Zero) CloseHandle(child.process);
        }
    }
}
