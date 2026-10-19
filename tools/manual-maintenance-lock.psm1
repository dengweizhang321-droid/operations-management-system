# This adapter owns only its own mutex acquisitions. Lifecycle actions and all
# production paths belong to the caller; importing this module performs no I/O.
function Invoke-ManualMaintenanceGate {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string] $WorkerMutexName,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string] $DjangoMutexName,

        [Parameter(Mandatory = $true)]
        [scriptblock] $Check,

        [Parameter(Mandatory = $true)]
        [scriptblock] $Operation,

        [ValidateRange(0, 2147483647)]
        [int] $WaitMilliseconds = 120000,

        # Optional presentation sink; never consumed by lifecycle admission.
        [string] $DiagnosticPath = ''
    )

    if ([string]::IsNullOrWhiteSpace($WorkerMutexName) -or
        [string]::IsNullOrWhiteSpace($DjangoMutexName) -or
        [string]::Equals($WorkerMutexName, $DjangoMutexName, [StringComparison]::Ordinal)) {
        throw 'Worker and Django mutex names must be explicit, nonempty, and distinct.'
    }

    $workerMutex = $null
    $djangoMutex = $null
    $workerHeld = $false
    $djangoHeld = $false
    $waitClock = [Diagnostics.Stopwatch]::StartNew()
    # LOCK_DIAGNOSTICS_BEGIN
    # Diagnostic output is never a lock receipt or permission to continue.
    function Write-MaintenanceLockDiagnostic([string] $Lock, [string] $Phase) {
        try {
            $record = [ordered]@{
                version = 'teruisi-maintenance-lock-diagnostic-v1'
                at = [DateTimeOffset]::UtcNow.ToString('o')
                lock = $Lock; phase = $Phase
                budgetMilliseconds = $WaitMilliseconds
                elapsedMilliseconds = $waitClock.ElapsedMilliseconds
                remainingMilliseconds = [Math]::Max(0, $WaitMilliseconds - $waitClock.ElapsedMilliseconds)
            }
            [Console]::Error.WriteLine('TERUISI_LOCK_DIAGNOSTIC ' + ($record | ConvertTo-Json -Compress))
            if ($DiagnosticPath) {
                $temporary = $DiagnosticPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
                try {
                    [IO.File]::WriteAllText($temporary, ($record | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
                    if ([IO.File]::Exists($DiagnosticPath)) { [IO.File]::Replace($temporary, $DiagnosticPath, $null) }
                    else { [IO.File]::Move($temporary, $DiagnosticPath) }
                } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
            }
        } catch { } # Presentation failure must not change mutex ownership.
    }
    # LOCK_DIAGNOSTICS_END
    try {
        $workerMutex = New-Object Threading.Mutex($false, $WorkerMutexName)
        $djangoMutex = New-Object Threading.Mutex($false, $DjangoMutexName)

        # Both acquisitions stay on this thread and share a bounded wait budget.
        Write-MaintenanceLockDiagnostic 'worker' 'waiting'
        $remaining = [int][Math]::Max(0, $WaitMilliseconds - $waitClock.ElapsedMilliseconds)
        try {
            $workerHeld = $workerMutex.WaitOne($remaining)
        } catch [Threading.AbandonedMutexException] {
            # WaitOne grants ownership before throwing for an abandoned mutex.
            $workerHeld = $true
            Write-MaintenanceLockDiagnostic 'worker' 'abandoned'
            throw 'Worker mutex was abandoned; verify the previous operation before continuing.'
        }
        Write-MaintenanceLockDiagnostic 'worker' $(if ($workerHeld) { 'acquired' } else { 'timeout' })
        if (-not $workerHeld) { throw 'Timed out waiting for Worker mutex.' }

        Write-MaintenanceLockDiagnostic 'django' 'waiting'
        $remaining = [int][Math]::Max(0, $WaitMilliseconds - $waitClock.ElapsedMilliseconds)
        try {
            $djangoHeld = $djangoMutex.WaitOne($remaining)
        } catch [Threading.AbandonedMutexException] {
            $djangoHeld = $true
            Write-MaintenanceLockDiagnostic 'django' 'abandoned'
            throw 'Django mutex was abandoned; verify the previous operation before continuing.'
        }
        Write-MaintenanceLockDiagnostic 'django' $(if ($djangoHeld) { 'acquired' } else { 'timeout' })
        if (-not $djangoHeld) { throw 'Timed out waiting for Django mutex.' }

        # Facts must be read after waiting, while both lifecycle locks are held.
        $checkResult = & $Check
        if ($checkResult -isnot [bool] -or -not $checkResult) {
            throw 'Maintenance check must return exactly one Boolean true.'
        }

        # The original Worker operation starts a separate Django PowerShell
        # process. Holding Django here would deadlock that original lifecycle.
        $djangoMutex.ReleaseMutex()
        $djangoHeld = $false
        & $Operation
    } finally {
        try {
            if ($djangoHeld) { $djangoMutex.ReleaseMutex() }
        } finally {
            try {
                if ($workerHeld) { $workerMutex.ReleaseMutex() }
            } finally {
                if ($null -ne $djangoMutex) { $djangoMutex.Dispose() }
                if ($null -ne $workerMutex) { $workerMutex.Dispose() }
                $waitClock.Stop()
            }
        }
    }
}

Export-ModuleMember -Function Invoke-ManualMaintenanceGate
