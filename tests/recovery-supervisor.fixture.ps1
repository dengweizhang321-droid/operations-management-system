param([string]$Source)
$ErrorActionPreference='Stop';. $Source
$BackendRoot='synthetic-recovery-supervisor-'+[guid]::NewGuid().ToString('N');$SupervisorPath='original-supervisor.ps1';$WatchdogRoot=[IO.Path]::GetTempPath();$RecoverySupervisorDeadline=100
$script:spawnCount=0;$script:expired=$false;$script:spawnThrows=$false;$script:envAtSpawn='unset-test';$script:admission='running';$script:status='stopped'
function Get-Admission {return @{mode=$script:admission}}
function Invoke-WatchScript($p,$a){return @{supervisorProcess=$script:status}}
function Get-ProcessRemaining($d){if($script:expired){throw 'expired'};return 100}
function Start-Process {$script:spawnCount++;$script:envAtSpawn=$env:TERUISI_PROCESS_DEADLINE_UNIX_MS;if($script:spawnThrows){throw 'synthetic-spawn-failed'}}
$original=$env:TERUISI_PROCESS_DEADLINE_UNIX_MS;$modules=$env:PSModulePath
try{
 $env:TERUISI_PROCESS_DEADLINE_UNIX_MS='123456789';Restore-RecoverySupervisor
 if($script:spawnCount -ne 1 -or -not [string]::IsNullOrEmpty($script:envAtSpawn) -or $env:TERUISI_PROCESS_DEADLINE_UNIX_MS -cne '123456789' -or $env:PSModulePath -cne $modules){throw 'Spawn environment isolation failed'}
 $script:expired=$true;$caught=$false;try{Restore-RecoverySupervisor}catch{$caught=$true};if(-not $caught -or $script:spawnCount -ne 1){throw 'Expired recovery spawned'}
 $script:expired=$false;$script:spawnThrows=$true;$caught=$false;try{Restore-RecoverySupervisor}catch{$caught=$true};if(-not $caught -or $script:spawnCount -ne 2 -or $env:TERUISI_PROCESS_DEADLINE_UNIX_MS -cne '123456789' -or $env:PSModulePath -cne $modules){throw 'Failure did not restore environment'}
 $script:spawnThrows=$false;$script:status='ownership_error';$caught=$false;try{Restore-RecoverySupervisor}catch{$caught=$true};if(-not $caught -or $script:spawnCount -ne 2){throw 'Unknown supervisor started'}
 $script:status='running';Restore-RecoverySupervisor;if($script:spawnCount -ne 2){throw 'Running supervisor duplicated'}
 $script:status='stopped';$script:admission='maintenance';$caught=$false;try{Restore-RecoverySupervisor}catch{$caught=$true};if(-not $caught -or $script:spawnCount -ne 2){throw 'Maintenance start accepted'}
 @{cases=6;allSpawnsMocked=$true;productionActions=0;uniqueFixtureMutex=$true}|ConvertTo-Json -Compress
}finally{$env:TERUISI_PROCESS_DEADLINE_UNIX_MS=$original;$env:PSModulePath=$modules}
