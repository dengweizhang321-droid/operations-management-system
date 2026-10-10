# Read-only fixed task metadata; no install/register/enable/start/check/send.
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
function Get-TaskDigest([string]$Text) {
  $hasher=[Security.Cryptography.SHA256]::Create()
  try { return [Convert]::ToHexString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text))).ToLowerInvariant() }
  finally { $hasher.Dispose() }
}
$name='TERUISI Operations Watchdog'
$task=Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if($null -eq $task) { @{taskName=$name;exists=$false;state='missing'}|ConvertTo-Json -Compress;return }
$raw=Export-ScheduledTask -TaskName $name
$xml=[xml]$raw
$configuration=[ordered]@{principals=[string]$xml.Task.Principals.OuterXml;triggers=[string]$xml.Task.Triggers.OuterXml;settings=[string]$xml.Task.Settings.OuterXml}
$action=@($task.Actions)
if($action.Count -ne 1){throw 'Task action is ambiguous'}
$actionIdentity=[string]$action[0].Execute+"`n"+[string]$action[0].Arguments+"`n"+[string]$action[0].WorkingDirectory
@{taskName=$name;exists=$true;enabled=[bool]$task.Settings.Enabled;state=[string]$task.State;
  taskXmlSha256=Get-TaskDigest $raw;configurationSha256=Get-TaskDigest ($configuration|ConvertTo-Json -Compress);
  actionSha256=Get-TaskDigest $actionIdentity;triggerCount=@($task.Triggers).Count;repetitionInterval=[string]$task.Triggers[1].Repetition.Interval;
  principalSha256=Get-TaskDigest ([string]$xml.Task.Principals.OuterXml);
  actionExecutable=[string]$action[0].Execute;actionArgumentsSha256=Get-TaskDigest ([string]$action[0].Arguments);
  actionWorkingDirectory=[string]$action[0].WorkingDirectory}|ConvertTo-Json -Compress
