[CmdletBinding()]
param([switch]$Execute,[string]$MaintenanceId)
$ErrorActionPreference='Stop'
$recoveryRequest=@{Execute=$Execute.IsPresent;MaintenanceId=$MaintenanceId}
$root='D:\teruisi-runtime\django-sales'
$statePath=Join-Path $root 'monitoring\django-runtime\state.json'
$expectedState='15b0e4bf5fd663322239ed7f8badc86ef120ab4e0e5e4cd350d2388a0a072058'
$archivePath=Join-Path $root ('monitoring\django-runtime\state.previous-'+$expectedState+'.json')
$pins=@{
 'app\deployment.json'='4fb134f17cd22018045b87a2852ea874d5d9f3e3c36900a3e8750dc0e572e321'
 'app\tools\django-local-service.ps1'='7e9a3a88421d4ba3c1c763e62677ab05f16e58ab9c686ff46f7491fa5a1a63fa'
 'app\tools\django-runtime-supervisor.ps1'='2f3dbfd4360ccb77c8d9e4ec31cacda59ec621b3123d50e4d0c681d9f4b8022a'
 'app.previous\tools\django-runtime-supervisor.ps1'='232a561259b1ee34002313f61960462e20b508fd57e3bb811e00ce512c226bdf'
}
function Assert-SafeExactPath([string]$Path) {
 if(-not ([IO.Path]::GetFullPath($Path)).StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Path outside exact runtime'}
 $cursor=$Path
 while($cursor -and $cursor.Length -ge $root.Length){
  if(Test-Path -LiteralPath $cursor){if((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse path refused'}}
  $cursor=Split-Path $cursor -Parent
 }
}
function Assert-PinnedState {
 foreach($relative in $pins.Keys){$p=Join-Path $root $relative;Assert-SafeExactPath $p;if((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() -cne $pins[$relative]){throw ('Source changed: '+$relative)}}
 Assert-SafeExactPath $statePath;Assert-SafeExactPath $archivePath
 if((Get-FileHash -LiteralPath $statePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expectedState){throw 'Stopped-state bytes changed'}
 $state=Get-Content -LiteralPath $statePath -Raw|ConvertFrom-Json
 if($state.version -cne 'teruisi-django-supervisor-state-v1' -or $state.desiredState -cne 'stopped' -or $state.health -cne 'stopped' -or $state.code -cne 'desired_state_stopped' -or $state.recoverable -isnot [bool] -or $state.recoverable -ne $false -or $state.supervisorScriptSha256 -cne $pins['app.previous\tools\django-runtime-supervisor.ps1']){throw 'Not the exact stopped predecessor state'}
 if(Test-Path -LiteralPath (Join-Path $root 'run\django-supervisor.pid.json')){throw 'Supervisor receipt exists'}
 if(Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$state.supervisorProcessId) -ErrorAction Stop){throw 'Old supervisor PID exists; do not assume ownership'}
 Invoke-ReadonlyMetadataObservation {
  $shells=@(CimCmdlets\Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction Stop)
  foreach($p in $shells){$observed=Complete-ReadonlyProcessMetadata $p;if(-not $observed.CommandLine){throw 'Cannot rule out supervisor in unreadable shell'};if($observed.CommandLine -match 'django-runtime-supervisor\.ps1' -and $observed.CommandLine -match '-Action\s+Run'){throw 'Supervisor Run process exists'}}
 }
 if(Test-Path -LiteralPath $archivePath){throw 'Archive already exists; reconcile instead of repeating'}
}
$saved=$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
try{$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1';. (Join-Path $root 'app\tools\django-local-service.ps1') -Action Status -RuntimeRoot $root -Json}finally{$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY=$saved}
. (Join-Path $PSScriptRoot '..\..\tools\process-deadline.ps1')
. (Join-Path $PSScriptRoot '..\..\tools\watchdog-native-metadata.ps1')
$env:TERUISI_PROCESS_DEADLINE_UNIX_MS=[string]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+60000)
# Original lifecycle mutex order; the supervisor's own lease proves no live Run owner.
$workerName='Local\TERUISI.Worker.LocalService.v1'
$supervisorName='Local\TERUISI-DjangoRuntimeSupervisor-'+(Get-Sha256Text $root).Substring(0,20)
Assert-PinnedState
if(-not $recoveryRequest.Execute){[pscustomobject]@{status='planned';stateSha256=$expectedState;archive=$archivePath;productionChanged=$false}|ConvertTo-Json -Compress;return}
if($recoveryRequest.MaintenanceId -cnotmatch '^[a-f0-9]{32}$'){throw 'Exact maintenance ID required'}
$lease=[Threading.Mutex]::new($false,$supervisorName);$workerLease=[Threading.Mutex]::new($false,$workerName);$leaseState=@{Held=$false;WorkerHeld=$false}
try{
 try{$leaseState.WorkerHeld=$workerLease.WaitOne(0)}catch [Threading.AbandonedMutexException]{$leaseState.WorkerHeld=$true}
 if(-not $leaseState.WorkerHeld){throw 'Worker lifecycle busy'}
 Invoke-WithServiceMutex {
  try{$leaseState.Held=$lease.WaitOne(0)}catch [Threading.AbandonedMutexException]{$leaseState.Held=$true}
  if(-not $leaseState.Held){throw 'Supervisor lease held'}
  Assert-RuntimeRootAclHardened
  Assert-PinnedState
  $maintenance=Get-Content -LiteralPath (Join-Path $root 'run\system-maintenance.json') -Raw|ConvertFrom-Json
  $desired=Get-Content -LiteralPath (Join-Path $root 'run\django-supervisor-desired-state.json') -Raw|ConvertFrom-Json
  if($maintenance.version -cne 'teruisi-system-maintenance-v1' -or $maintenance.id -cne $recoveryRequest.MaintenanceId -or $maintenance.runtimeRoot -cne $root -or $maintenance.drainedStopped -isnot [bool] -or -not $maintenance.drainedStopped -or $desired.desiredState -cne 'stopped'){throw 'Exact drained/stopped maintenance required'}
  [IO.File]::Move($statePath,$archivePath)
  if((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expectedState -or (Test-Path -LiteralPath $statePath)){throw 'Archive readback failed'}
 }
}finally{if($leaseState.Held){$lease.ReleaseMutex()};$lease.Dispose();if($leaseState.WorkerHeld){$workerLease.ReleaseMutex()};$workerLease.Dispose()}
[pscustomobject]@{status='archived_exact_stopped_predecessor';stateSha256=$expectedState;archive=$archivePath;newState='created only by original supervisor constructor'}|ConvertTo-Json -Compress
