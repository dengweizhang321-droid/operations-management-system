$ErrorActionPreference='Stop'
# Read-only preflight for the 09aa2f8d startup-path recovery. ASCII only on purpose.
$taskRuntime='D:\teruisi-runtime\teruisi-worker-sales'
$taskService=Join-Path $taskRuntime 'releases\20261114T090844Z-11ad15dba2e78d98\tools\worker-local-service.ps1'
. $taskService -FunctionsOnly
$taskShell=New-Object -ComObject WScript.Shell
$taskLink=$taskShell.CreateShortcut($StartupShortcut)
$taskProcesses=@(Get-CimInstance Win32_Process)
# 38384 = failed InstallStartup child, 23688 = original publisher owner (FAILED.json / STARTED.json).
# A process only counts as original if it was created no later than the recorded failure
# (2026-11-14T09:36:06Z); a later process that merely reuses the PID is not the original.
$taskOriginalPids=@(38384,23688)
$taskCutoff=[DateTime]::new(2026,11,14,9,36,6,[DateTimeKind]::Utc)
$taskOriginals=@($taskProcesses | Where-Object { $_.ProcessId -in $taskOriginalPids -and $_.CreationDate -and $_.CreationDate.ToUniversalTime() -le $taskCutoff })
$taskAnchors=@($taskOriginals | ForEach-Object { [int]$_.ProcessId });$taskDescendants=@()
do {
 $taskNew=@($taskProcesses | Where-Object { $_.ProcessId -notin $taskAnchors -and $_.ParentProcessId -in $taskAnchors })
 $taskDescendants+=@($taskNew | ForEach-Object { [int]$_.ProcessId });$taskAnchors+=@($taskNew | ForEach-Object { [int]$_.ProcessId })
} while ($taskNew.Count -gt 0)
$taskPublishers=@($taskProcesses | Where-Object { $_.Name -in @('node.exe','powershell.exe','pwsh.exe') -and $_.CommandLine -match '(?i)(?:publish-main|publish-latest-main)\.mjs' } | ForEach-Object { [int]$_.ProcessId })
$taskTemporary=@(Get-ChildItem -LiteralPath (Split-Path -Parent $StartupShortcut) -Force | Where-Object { $_.Name.StartsWith('TERUISI Operations Worker.lnk.tmp-') -or $_.Name.StartsWith('TERUISI Operations Worker.lnk.backup-') } | ForEach-Object { $_.Name })
$taskListeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -in @(3000,5791) } | ForEach-Object { [int]$_.OwningProcess })
# Read-only exclusive open (FileShare.None): fails while any other handle (the likely cause of the original Replace failure) is still held.
$taskExclusive=[ordered]@{opened=$false;error=$null}
try {
 $taskStream=[System.IO.File]::Open($StartupShortcut,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::None)
 $taskStream.Dispose();$taskExclusive.opened=$true
} catch { $taskExclusive.error=[string]$_.Exception.Message }
[ordered]@{
 version='manual-startup-preflight-09aa2f8d-v1';sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 administrator=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
 originalProcessPresent=($taskOriginals.Count -ne 0)
 originalDescendants=$taskDescendants;publishers=$taskPublishers;listeners=$taskListeners
 shortcut=[ordered]@{path=$StartupShortcut;controlled=[bool](Test-IsControlledStartupShortcut $taskLink);target=$taskLink.TargetPath;arguments=$taskLink.Arguments;workingDirectory=$taskLink.WorkingDirectory;temporaryFiles=$taskTemporary}
 shortcutExclusive=$taskExclusive
 expectedPowerShell=(Get-Command powershell.exe).Source
}|ConvertTo-Json -Depth 6 -Compress
