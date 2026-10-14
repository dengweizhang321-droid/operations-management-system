$ErrorActionPreference='Stop'
$out='D:\codex-artifacts\jackyun-live-test-20261014'
$barrier=Get-Content (Join-Path $out 'unbound-helper-adoption\worker-ready-for-monitor.json') -Raw|ConvertFrom-Json
$gate=Get-Content 'D:\teruisi-runtime\django-sales\run\automation-drain.json' -Raw|ConvertFrom-Json
if($barrier.status -cne 'ready_with_drain_retained' -or $barrier.maintenanceId -cne 'f1dbd359ccd54bb2aeaa77c8054ee63c' -or $gate.id -cne $barrier.maintenanceId -or $gate.phase -cne 'requests'){throw 'Exact ready drain required'}
$taskName='TERUISI Operations Watchdog'
$oldRoot='D:\teruisi-runtime\operations-watchdog\versions\ceee38dabd66ea9cc77622679d35bf601367f0582ac00fcfe5074dc10940c940'
$task=Get-ScheduledTask -TaskName $taskName
if($task.Actions.Execute -cne (Join-Path $oldRoot 'Watchdog.NoConsole.exe')){throw 'Task version changed'}
if((Get-FileHash (Join-Path $oldRoot 'operations-system-watchdog.ps1')).Hash.ToLowerInvariant() -cne '1e651d0dc6d2a9cadd89f99989a047b5247c808908434ef1fb876b7ab26fdc05'){throw 'Old source changed'}
Disable-ScheduledTask -TaskName $taskName|Out-Null
$owned=$null;$launcher=$null;$rs=$null;$ps=$null
try{
 $p=Get-CimInstance Win32_Process -Filter 'ProcessId=34912'
 if($p){
  if($p.ParentProcessId -ne 45080 -or $p.Name -cne 'pwsh.exe' -or $p.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.ffffff') -cne '2026-10-14T03:20:24.571216' -or $p.CommandLine -notmatch [regex]::Escape($oldRoot)){throw 'Stalled instance changed'}
  $owner=Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid
  if($owner.ReturnValue -ne 0 -or $owner.Sid -cne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value){throw 'Owner changed'}
  $parent=Get-CimInstance Win32_Process -Filter 'ProcessId=45080'
  if($parent.ExecutablePath -cne (Join-Path $oldRoot 'Watchdog.NoConsole.exe')){throw 'Launcher identity changed'}
  $owned=[Diagnostics.Process]::GetProcessById(34912);$held=$owned.Handle
  $native=$owned.StartTime.ToUniversalTime().ToFileTimeUtc();$cim=$p.CreationDate.ToUniversalTime().ToFileTimeUtc()
  if([decimal]::Floor([decimal]$native/10) -ne [decimal]::Floor([decimal]$cim/10) -or $owned.HasExited){throw 'Birth identity changed'}
  $launcher=[Diagnostics.Process]::GetProcessById(45080);$launcherHandle=$launcher.Handle
  $ci=[System.Management.Automation.Runspaces.NamedPipeConnectionInfo]::new(34912);$ci.OpenTimeout=5000;$ci.OperationTimeout=5000
  $rs=[runspacefactory]::CreateRunspace($ci);$rs.Open();$ps=[powershell]::Create();$ps.Runspace=$rs
  [void]$ps.AddScript("`$f=@((Get-Runspace -Id 1).Debugger.GetCallStack())|Where-Object FunctionName -eq 'Get-WatchEvidence'|Select-Object -First 1;if(-not `$f){throw 'Evidence frame changed'};[pscustomobject]@{Function=`$f.FunctionName;Line=`$f.ScriptLineNumber;Snapshot=`$f.InvocationInfo.BoundParameters['Snapshot']}|ConvertTo-Json -Depth 18")
  $ar=$ps.BeginInvoke();if(-not $ar.AsyncWaitHandle.WaitOne(5000)){$ps.Stop();throw 'Read-only frame timeout'}
  $raw=($ps.EndInvoke($ar)-join "`n");if($ps.HadErrors){throw 'Frame unavailable'};$capture=$raw|ConvertFrom-Json
  if($capture.Function -cne 'Get-WatchEvidence' -or $capture.Line -ne 392 -or $capture.Snapshot.healthy -cne $false){throw 'Not the confirmed evidence collector stall'}
  $ps.Dispose();$ps=$null;$rs.Dispose();$rs=$null
  if(@(Get-CimInstance Win32_Process -Filter 'ParentProcessId=34912'|Where-Object {$_.Name -cne 'conhost.exe'}).Count){throw 'Business/unknown child exists'}
  $evidence=Join-Path $out 'watchdog-stuck-before-drained-stop.json';if(Test-Path $evidence){throw 'Prior stop evidence exists; reconcile'}
  [IO.File]::WriteAllText($evidence,$raw,[Text.UTF8Encoding]::new($false))
  if($owned.HasExited){throw 'Original instance exited before stop'}
  $owned.Kill();if(-not $owned.WaitForExit(5000)){throw 'Collector exit not confirmed'}
  if(-not $launcher.WaitForExit(10000)){throw 'Launcher exit not confirmed'}
 }
 @{status='original_check_stopped';targetPid=34912;businessServicesStopped=$false;taskTemporarilyDisabled=$true;at=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content (Join-Path $out 'watchdog-drained-stop-result.json') -Encoding utf8
}catch{Enable-ScheduledTask -TaskName $taskName|Out-Null;throw}
finally{if($ps){$ps.Dispose()};if($rs){$rs.Dispose()};if($owned){$owned.Dispose()};if($launcher){$launcher.Dispose()}}
