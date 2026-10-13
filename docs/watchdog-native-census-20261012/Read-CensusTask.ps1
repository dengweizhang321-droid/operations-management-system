param()
$ErrorActionPreference='Stop'
$who=[Security.Principal.WindowsIdentity]::GetCurrent()
if($who.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not ([Security.Principal.WindowsPrincipal]::new($who)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Exact administrator required'}
$raw=Export-ScheduledTask -TaskName 'TERUISI Operations Watchdog'
$x=[xml]$raw;$actions=@($x.Task.Actions.Exec)
if($actions.Count -ne 1){throw 'One fixed task action required'}
$root='D:\teruisi-runtime\operations-watchdog\versions\e0330d7aea1e17395cf56214c8c62e8d54c2e46359d30cce9296800c8802760c'
if($actions[0].Command -cne (Join-Path $root 'Watchdog.NoConsole.exe') -or $actions[0].Arguments -cne ('"C:\Users\86137\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe" "'+(Join-Path $root 'operations-system-watchdog.ps1')+'"') -or $actions[0].WorkingDirectory -cne 'D:\teruisi-runtime\operations-watchdog'){throw 'Task action differs'}
$h=[Security.Cryptography.SHA256]::Create();try{$digest=([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($raw)))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}
@{sha256=$digest;exactAction=$true;observedAt=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json -Compress
