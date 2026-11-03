#requires -Version 5.1
[CmdletBinding()]
param(
  [ValidateSet('Plan','Status')][string]$Action='Plan',
  [string]$ProjectRoot='',
  [string]$PythonWindowless='D:\teruisi-runtime\django-sales\venv\Scripts\pythonw.exe',
  [string]$StateRoot=(Join-Path $env:LOCALAPPDATA 'TERUISI\n8n-manual-action-alert'),
  [string]$OutputXml=''
)
$ErrorActionPreference='Stop'
$taskName='TERUISI n8n Schedule Watch'
if(-not $ProjectRoot){$ProjectRoot=Split-Path -Parent $PSScriptRoot}
$root=[IO.Path]::GetFullPath($ProjectRoot)
$state=[IO.Path]::GetFullPath($StateRoot)
$runner=Join-Path $root 'tools\n8n_schedule_watch_task.py'
if($Action -eq 'Status'){
  $task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  $info=if($task){Get-ScheduledTaskInfo -TaskName $taskName}else{$null}
  $latestPath=Join-Path $state 'schedule-watch-latest.json'
  $latest=$null;$readError=$false
  if(Test-Path -LiteralPath $latestPath){
    try{
      $file=Get-Item -LiteralPath $latestPath
      if($file.Length -gt 1048576 -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'invalid_latest'}
      $latest=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($latestPath))
      if($latest.version -ne 1 -or -not $latest.startedAt){throw 'invalid_latest'}
    }catch{$readError=$true;$latest=$null}
  }
  $overdue=$true
  if($latest -and $latest.finishedAt){
    try{
      $age=([DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($latest.finishedAt)).TotalHours
      $overdue=$age -gt 26 -or $age -lt 0
    }catch{$readError=$true}
  }
  [pscustomobject]@{task=$taskName;installed=[bool]$task;taskState=$(if($task){[string]$task.State}else{'absent'});
    lastTaskResult=$(if($info){$info.LastTaskResult}else{$null});overdue=$overdue;stateUnreadable=$readError;
    attemptStatus=$(if($latest){$latest.status}else{'unavailable'});mode=$(if($latest){$latest.mode}else{$null});
    startedAt=$(if($latest){[string]$latest.startedAt}else{$null});finishedAt=$(if($latest){[string]$latest.finishedAt}else{$null});
    exitCode=$(if($latest){$latest.exitCode}else{$null});requiresInteractiveLogon=$true;statePath=$latestPath
  }|ConvertTo-Json -Depth 3
  return
}
if((Get-TimeZone).Id -ne 'China Standard Time'){throw 'schedule_requires_China_Standard_Time'}
foreach($file in @($PythonWindowless,$runner,(Join-Path $root 'tools\n8n_schedule_watch.py'))){
  if(-not(Test-Path -LiteralPath $file -PathType Leaf)){throw 'schedule_dependency_missing'}
}
foreach($value in @($PythonWindowless,$runner,$state)){
  if($value.Contains('"') -or $value.Contains("`r") -or $value.Contains("`n")){throw 'invalid_schedule_path'}
}
$user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskAction=New-ScheduledTaskAction -Execute $PythonWindowless -Argument ('"'+$runner+'" --execute --state-root "'+$state+'"') -WorkingDirectory $root
# Planning is offline configuration only. This script intentionally has no
# Register/Enable/Start action; authorization and adoption precede registration.
& {
  # Task Scheduler's COM converter produces its native XML without registering.
  $service=New-Object -ComObject 'Schedule.Service'
  $service.Connect()
  $planned=$service.NewTask(0)
  $planned.RegistrationInfo.Description='Daily external n8n inspection; inspect LastTaskResult and local heartbeat on notification failure.'
  $planned.Principal.UserId=$user
  $planned.Principal.LogonType=3
  $planned.Principal.RunLevel=0
  $planned.Settings.StartWhenAvailable=$true
  $planned.Settings.DisallowStartIfOnBatteries=$false
  $planned.Settings.StopIfGoingOnBatteries=$false
  $planned.Settings.MultipleInstances=2
  $planned.Settings.ExecutionTimeLimit='PT25M'
  $daily=$planned.Triggers.Create(2)
  $daily.StartBoundary=(Get-Date).Date.AddHours(20).AddMinutes(17).ToString('yyyy-MM-ddTHH:mm:ss')+'+08:00'
  $daily.DaysInterval=1
  $launch=$planned.Actions.Create(0)
  $launch.Path=$taskAction.Execute;$launch.Arguments=$taskAction.Arguments;$launch.WorkingDirectory=$root
  if($OutputXml){[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputXml),$planned.XmlText,[Text.Encoding]::Unicode)}
  [pscustomobject]@{task=$taskName;status='candidate_not_installed';schedule='20:17 Asia/Shanghai';
    principal='current-user Interactive/Limited';execute=$taskAction.Execute;arguments=$taskAction.Arguments;
    workingDirectory=$root;xmlPath=$OutputXml;registrationPerformed=$false;sent=$false
  }|ConvertTo-Json -Depth 3
}
