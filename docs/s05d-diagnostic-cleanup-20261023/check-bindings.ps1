$ErrorActionPreference='Stop'
$target='D:\codex-worktrees\s05d-handoff-staging-diagnostic-20261023'
$taskName='TERUISI.HandoffSameChain.Diagnostic.b8d375f9-76cd-4802-ac3d-0bbeb346ebe9'
function Refers([string]$value){return $value.Replace('/','\').IndexOf($target,[StringComparison]::OrdinalIgnoreCase) -ge 0}
function Decoded([string]$args){if($args -match '(?i)-(?:EncodedCommand|enc)\s+([A-Za-z0-9+/=]+)'){try{return [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1]))}catch{throw 'Unparseable encoded Task action'}};return ''}
$processes=@(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -ne $PID -and ((Refers ([string]$_.CommandLine)) -or (Refers ([string]$_.ExecutablePath)))} | ForEach-Object {@{pid=[int]$_.ProcessId;createdAt=$_.CreationDate.ToUniversalTime().ToString('o');name=[string]$_.Name}})
$services=@(Get-CimInstance Win32_Service | Where-Object {Refers ([string]$_.PathName)} | ForEach-Object {@{name=[string]$_.Name;state=[string]$_.State}})
$s=New-Object -ComObject Schedule.Service;$s.Connect();$taskRefs=[Collections.Generic.List[object]]::new();$taskCount=0
function WalkTasks($folder){foreach($task in @($folder.GetTasks(1))){$script:taskCount++;if($script:taskCount -gt 2048){throw 'Task count bound'};foreach($action in @($task.Definition.Actions)){if([int]$action.Type -eq 0){if((Refers ([string]$action.Path)) -or (Refers ([string]$action.Arguments)) -or (Refers ([string]$action.WorkingDirectory)) -or (Refers (Decoded ([string]$action.Arguments)))){$taskRefs.Add(@{path=[string]$task.Path;state=[int]$task.State;enabled=[bool]$task.Enabled})}}}};foreach($child in @($folder.GetFolders(0))){WalkTasks $child}}
WalkTasks ($s.GetFolder('\'))
$priorAbsent=$false;try{[void]$s.GetFolder('\').GetTask($taskName)}catch{if($_.Exception.HResult -ne -2147024894){throw};$priorAbsent=$true}
$result=@{at=[DateTime]::UtcNow.ToString('o');target=$target;processRefs=$processes;serviceRefs=$services;taskRefs=@($taskRefs.ToArray());tasksInspected=$taskCount;priorDiagnosticTaskAbsent=$priorAbsent;readOnly=$true}
$json=$result|ConvertTo-Json -Depth 4
[IO.File]::WriteAllText('D:/codex-worktrees/s05d-diagnostic-cleanup-20261023/docs/s05d-diagnostic-cleanup-20261023/bindings.json',$json,[Text.UTF8Encoding]::new($false))
$json
if($processes.Count -ne 0 -or $services.Count -ne 0 -or $taskRefs.Count -ne 0 -or -not $priorAbsent){throw 'Cleanup dependency unresolved'}
