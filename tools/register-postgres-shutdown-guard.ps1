[CmdletBinding()]
param(
  # Plan only prints the task definition. Install/Uninstall change the machine and need -Execute.
  [ValidateSet("Plan", "Status", "Install", "Uninstall")]
  [string]$Action = "Plan",
  [switch]$Execute,
  # Start the guard right after Install instead of waiting for the next logon.
  [switch]$StartNow,
  [string]$TaskName = "TERUISI Postgres Shutdown Guard",
  [string]$SourceScript,
  [string]$InstallRoot = "D:\teruisi-runtime\postgres-shutdown-guard",
  [string]$PowerShellPath = (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"),
  [string]$UserName = ([Security.Principal.WindowsIdentity]::GetCurrent().Name),
  # Define the functions only (used by the tests); never touches the scheduler.
  [switch]$FunctionsOnly
)

# Registers the per-user logon task that keeps postgres-shutdown-guard.ps1 running hidden.
# The guard must be Windows PowerShell 5.1 (System.Windows.Forms). The task runs a copy of the
# script under InstallRoot so that checkouts, branch switches and release copies never change
# what runs at logon. This file only defines the task; it is never run by the guard itself.

$ErrorActionPreference = "Stop"
# $PSScriptRoot is not populated inside param() defaults on Windows PowerShell 5.1.
if (-not $SourceScript) { $SourceScript = Join-Path $PSScriptRoot "postgres-shutdown-guard.ps1" }

function Get-GuardFileSha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-PostgresShutdownGuardArguments([string]$ScriptPath) {
  return '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $ScriptPath + '"'
}

# Pure construction: builds CIM objects in memory, registers nothing.
function New-PostgresShutdownGuardTaskDefinition {
  param(
    [Parameter(Mandatory)][string]$ScriptPath,
    [Parameter(Mandatory)][string]$PowerShell,
    [Parameter(Mandatory)][string]$User,
    [string]$Name = "TERUISI Postgres Shutdown Guard"
  )
  $arguments = Get-PostgresShutdownGuardArguments $ScriptPath
  $action = New-ScheduledTaskAction -Execute $PowerShell -Argument $arguments -WorkingDirectory (Split-Path -Parent $ScriptPath)
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
  $settings = New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
  $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
  return [pscustomobject]@{
    TaskName = $Name
    Arguments = $arguments
    Action = $action
    Trigger = $trigger
    Settings = $settings
    Principal = $principal
    Description = "Stops the TERUISI PostgreSQL cleanly (pg_ctl stop -m fast) when Windows shuts down or logs off."
  }
}

# True only for a task whose single action is exactly this guard run from InstallRoot.
function Test-PostgresShutdownGuardTask([object]$Task, [string]$ScriptPath, [string]$PowerShell) {
  if (-not $Task) { return $false }
  $actions = @($Task.Actions)
  if ($actions.Count -ne 1) { return $false }
  return ([string]$actions[0].Execute -ieq $PowerShell) -and
    ([string]$actions[0].Arguments -ceq (Get-PostgresShutdownGuardArguments $ScriptPath))
}

function Invoke-PostgresShutdownGuardRegistration {
  $scriptTarget = Join-Path $InstallRoot "postgres-shutdown-guard.ps1"
  $definition = New-PostgresShutdownGuardTaskDefinition -ScriptPath $scriptTarget -PowerShell $PowerShellPath -User $UserName -Name $TaskName
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($Action -eq "Plan") {
    return [ordered]@{
      status = "plan"; taskName = $TaskName; execute = $PowerShellPath; arguments = $definition.Arguments
      trigger = "AtLogOn:$UserName"; runAs = $UserName; logonType = "Interactive"; runLevel = "Limited"; hidden = $true
      scriptSource = $SourceScript; scriptTarget = $scriptTarget; taskExists = [bool]$existing
    }
  }
  if ($Action -eq "Status") {
    return [ordered]@{
      status = if ($existing) { "registered" } else { "absent" }
      ours = [bool](Test-PostgresShutdownGuardTask $existing $scriptTarget $PowerShellPath)
      state = if ($existing) { [string]$existing.State } else { $null }
    }
  }
  if (-not $Execute) { throw "$Action changes the machine; add -Execute" }
  if ($existing -and -not (Test-PostgresShutdownGuardTask $existing $scriptTarget $PowerShellPath)) {
    throw "A task named '$TaskName' exists but is not this guard; refusing to touch it"
  }
  if ($Action -eq "Uninstall") {
    if ($existing) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
    return [ordered]@{ status = "uninstalled"; note = "A running guard keeps running until logoff; the script copy is left in place." }
  }
  # Install
  if (-not (Test-Path -LiteralPath $SourceScript -PathType Leaf)) { throw "Guard script not found" }
  if (-not (Test-Path -LiteralPath $PowerShellPath -PathType Leaf)) { throw "Windows PowerShell not found" }
  [IO.Directory]::CreateDirectory($InstallRoot) | Out-Null
  if (-not (Test-Path -LiteralPath $scriptTarget) -or (Get-GuardFileSha256 $scriptTarget) -cne (Get-GuardFileSha256 $SourceScript)) {
    $temporary = $scriptTarget + "." + [guid]::NewGuid().ToString("N") + ".tmp"
    [IO.File]::Copy($SourceScript, $temporary)
    Move-Item -LiteralPath $temporary -Destination $scriptTarget -Force
  }
  if ((Get-GuardFileSha256 $scriptTarget) -cne (Get-GuardFileSha256 $SourceScript)) { throw "Installed guard script does not match the source" }
  Register-ScheduledTask -TaskName $TaskName -Action $definition.Action -Trigger $definition.Trigger `
    -Settings $definition.Settings -Principal $definition.Principal -Description $definition.Description -Force | Out-Null
  $current = Get-ScheduledTask -TaskName $TaskName
  if (-not (Test-PostgresShutdownGuardTask $current $scriptTarget $PowerShellPath)) { throw "Task readback does not match the definition" }
  if ($StartNow) { Start-ScheduledTask -TaskName $TaskName }
  return [ordered]@{ status = "installed"; taskName = $TaskName; scriptSha256 = (Get-GuardFileSha256 $scriptTarget); started = [bool]$StartNow }
}

if (-not $FunctionsOnly) {
  Invoke-PostgresShutdownGuardRegistration | ConvertTo-Json -Depth 4
}
