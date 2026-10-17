$ErrorActionPreference='Stop'
$taskRuntime='D:\teruisi-runtime\teruisi-worker-sales'
$taskService=Join-Path $taskRuntime 'releases\20261017T063128Z-5d4113ddb3c5cada\tools\worker-local-service.ps1'
. $taskService -FunctionsOnly
$taskShell=New-Object -ComObject WScript.Shell
$taskLink=$taskShell.CreateShortcut($StartupShortcut)
$taskProcesses=@(Get-CimInstance Win32_Process)
$taskAnchors=@(9332);$taskDescendants=@()
do {
 $taskNew=@($taskProcesses | Where-Object { $_.ProcessId -notin $taskAnchors -and $_.ParentProcessId -in $taskAnchors })
 $taskDescendants+=@($taskNew | ForEach-Object { [int]$_.ProcessId });$taskAnchors+=@($taskNew | ForEach-Object { [int]$_.ProcessId })
} while ($taskNew.Count -gt 0)
$taskPublishers=@($taskProcesses | Where-Object { $_.Name -in @('node.exe','powershell.exe','pwsh.exe') -and $_.CommandLine -match '(?i)(?:publish-main|publish-latest-main)\.mjs' } | ForEach-Object { [int]$_.ProcessId })
$taskTemporary=@(Get-ChildItem -LiteralPath (Split-Path -Parent $StartupShortcut) -Force | Where-Object { $_.Name.StartsWith('TERUISI Operations Worker.lnk.tmp-') -or $_.Name.StartsWith('TERUISI Operations Worker.lnk.backup-') } | ForEach-Object { $_.Name })
$taskListeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -in @(3000,5791) } | ForEach-Object { [int]$_.OwningProcess })
[ordered]@{
 version='manual-startup-preflight-v1';sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 administrator=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
 originalProcessPresent=(@($taskProcesses | Where-Object { $_.ProcessId -eq 9332 }).Count -ne 0)
 originalDescendants=$taskDescendants;publishers=$taskPublishers;listeners=$taskListeners
 shortcut=[ordered]@{path=$StartupShortcut;controlled=[bool](Test-IsControlledStartupShortcut $taskLink);target=$taskLink.TargetPath;arguments=$taskLink.Arguments;workingDirectory=$taskLink.WorkingDirectory;temporaryFiles=$taskTemporary}
 expectedPowerShell=(Get-Command powershell.exe).Source
}|ConvertTo-Json -Depth 6 -Compress
