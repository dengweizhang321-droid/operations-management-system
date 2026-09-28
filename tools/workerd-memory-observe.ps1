param(
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [int]$Samples = 31,
  [int]$IntervalSeconds = 20
)
$ErrorActionPreference = 'Stop'
if ($Samples -lt 2 -or $Samples -gt 181 -or $IntervalSeconds -lt 5 -or $IntervalSeconds -gt 60) { throw 'Invalid observation bounds' }
if (Test-Path -LiteralPath $OutputPath) { throw 'Output already exists' }
$root = 'D:\teruisi-runtime\teruisi-worker-sales'
$initial = Get-CimInstance Win32_Process
$receipt = Get-Content -LiteralPath "$root\state\worker-process.json" -Raw | ConvertFrom-Json
$supervisor = $initial | Where-Object { $_.ProcessId -eq $receipt.supervisorPid }
if (!$supervisor -or [Math]::Abs(($supervisor.CreationDate.ToUniversalTime() - [DateTime]::Parse($receipt.supervisorCreationDate).ToUniversalTime()).TotalMilliseconds) -gt 1) { throw 'Supervisor receipt is stale' }
$ids = @([int]$receipt.supervisorPid)
for ($depth=0; $depth -lt 5; $depth++) {
  $ids = @($ids + @($initial | Where-Object { $ids -contains [int]$_.ParentProcessId } | ForEach-Object { [int]$_.ProcessId }) | Select-Object -Unique)
}
$targets = @($initial | Where-Object { $ids -contains [int]$_.ProcessId -and $_.Name -match '^(node|workerd)\.exe$' } | ForEach-Object {
  $native = Get-Process -Id $_.ProcessId -ErrorAction Stop
  if ([Math]::Abs(($native.StartTime - $_.CreationDate).TotalMilliseconds) -gt 1) { throw 'Process identity changed during discovery' }
  [pscustomobject]@{ pid=[int]$_.ProcessId; created=$native.StartTime.ToUniversalTime().ToString('o'); role=$(if ($_.Name -eq 'workerd.exe') {'workerd'} elseif ($_.CommandLine -match 'helper') {'helper'} elseif ($_.CommandLine -match 'wrangler') {'wrangler'} else {'supervisor'}) }
})
New-Item -ItemType File -Path $OutputPath -ErrorAction Stop | Out-Null
for ($i=0; $i -lt $Samples; $i++) {
  $now = [DateTime]::UtcNow
  $rows = @($targets | ForEach-Object {
    $target = $_
    $p = Get-Process -Id $target.pid -ErrorAction SilentlyContinue
    if ($p -and $p.StartTime.ToUniversalTime().ToString('o') -eq $target.created) {
      [pscustomobject]@{ pid=$target.pid; role=$target.role; created=$target.created; ageSeconds=($now-$p.StartTime.ToUniversalTime()).TotalSeconds; workingSetBytes=$p.WorkingSet64; privateBytes=$p.PrivateMemorySize64; peakWorkingSetBytes=$p.PeakWorkingSet64; cpuSeconds=$p.TotalProcessorTime.TotalSeconds; handles=$p.HandleCount }
    } else { [pscustomobject]@{pid=$target.pid;role=$target.role;status='exited_or_identity_changed'} }
  })
  $helper = 'unavailable'
  try { $health=Invoke-RestMethod 'http://127.0.0.1:5791/health' -TimeoutSec 3; $helper=[pscustomobject]@{busy=$health.busy;status=$health.status} } catch {}
  $os=Get-CimInstance Win32_OperatingSystem
  [pscustomobject]@{utc=$now.ToString('o');release=$receipt.releaseId;manifestSha256=$receipt.manifestSha256;processes=$rows;helper=$helper;freePhysicalKiB=$os.FreePhysicalMemory;requestCount=$null;requestCountReason='current production logs do not expose reliable per-process counters'} | ConvertTo-Json -Depth 5 -Compress | Add-Content -LiteralPath $OutputPath -Encoding utf8
  if ($i+1 -lt $Samples) { Start-Sleep -Seconds $IntervalSeconds }
}
