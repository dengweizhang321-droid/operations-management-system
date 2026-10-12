param([string]$Candidate)
$ErrorActionPreference='Stop'
$module=New-Module -ArgumentList $Candidate -ScriptBlock {param($dir);. (Join-Path $dir 'operations-system-watchdog.ps1') -FunctionsOnly}
$result=& $module {Get-WatchSnapshot}
$result|ConvertTo-Json -Depth 16 -Compress
