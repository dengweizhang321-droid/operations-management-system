param([ValidateSet('Check','EnterMaintenance')][string]$Action='Check',
 [Parameter(Mandatory)][string]$InputPath,[Parameter(Mandatory)][string]$InputSha256,
 [Parameter(Mandatory)][string]$OriginalFailureSha256,[switch]$Json)
$ErrorActionPreference='Stop'
$djangoFixed='D:\teruisi-runtime\django-sales'
$workerFixed='D:\teruisi-runtime\teruisi-worker-sales'
$known=@{
 releaseId='20261017T082953Z-c9da1765d84847d4'
 workerManifestSha256='91a0cdce3cd59457ab3be2ae7366411fb975e1ebd07203119ff380ee568655f1'
 djangoManifestSha256='622cb632fdf9408bfb6dc641422602a0e741aeea18d09c65f39480d203069d1a'
 workerScriptSha256='8ef6d09c23f780657d74e8c591dea543713410783ce2d5fdf165f2093db51a1d'
 djangoScriptSha256='2a4d3629d1f80b824ad247ef4b4ce810632090586b87be3686432f5b6aea98e0'
 workerTransportSha256='5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd'
}
function Hash-File([string]$File){(Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()}
function Read-Object([string]$File){
 $raw=[IO.File]::ReadAllText($File)
 if(-not $raw.TrimStart().StartsWith('{')){throw 'Expected an original JSON object'}
 $value=$raw|ConvertFrom-Json
 if($value -isnot [pscustomobject]){throw 'Expected a typed original JSON object'}
 return $value
}
function Require-Hash([string]$File,[object]$Expected){
 if($Expected -isnot [string] -or $Expected -cnotmatch '^[a-f0-9]{64}$'){throw 'Invalid pinned hash'}
 $cursor=Get-Item -LiteralPath $File -Force
 if($cursor.PSIsContainer){throw 'Pinned file is not a file'}
 while($null -ne $cursor){if($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked pinned path'};$cursor=$cursor.Parent}
 if((Hash-File $File) -cne $Expected){throw ('Pinned bytes changed: '+$File)}
}
function Save-New([string]$File,[object]$Value){
 $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 18 -Compress)+"`n")
 $stream=[IO.File]::Open($File,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
 try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
}
function Assert-Record([object]$Record,[string]$Version){
 if($Record -isnot [pscustomobject] -or $Record.version -isnot [string] -or $Record.version -cne $Version -or
  $Record.id -isnot [string] -or $Record.id -cne $script:admissionRecord.maintenanceId -or
  $Record.runtimeRoot -isnot [string] -or $Record.runtimeRoot -ine $djangoFixed -or
  $Record.keepPostgres -isnot [bool] -or $Record.keepPostgres -ne $true){throw 'Original maintenance/drain binding changed'}
}
function Assert-Actor([object]$Record,[object]$Current){
 if($Record -isnot [pscustomobject] -or $Record.processId -isnot [int] -or $Record.processId -le 0 -or
  $Record.creationDate -isnot [string] -or $Record.commandLine -isnot [string] -or
  $Record.executablePath -isnot [string] -or -not $Record.commandLine -or -not $Record.executablePath){throw 'Original actor was not pre-bound'}
 if($null -ne $Current -and ($Current.CreationDate.ToUniversalTime().ToString('o') -cne $Record.creationDate -or
  [string]$Current.ExecutablePath -ine $Record.executablePath -or [string]$Current.CommandLine -cne $Record.commandLine)){throw 'Actor PID identity changed or is unreadable'}
}
function Assert-RotationOwner([object[]]$Processes){
 $owner=$script:actor.rotationOwner
 $current=@($Processes|Where-Object {[int]$_.ProcessId -eq $owner.processId})
 if($current.Count -ne 1){throw 'Original rotation owner exited'}
 Assert-Actor $owner $current[0]
 if(-not ('ManualMaintenancePipeOwner' -as [type])){
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles; public static class ManualMaintenancePipeOwner { [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe,out uint pid); }'
 }
 $pipe=[IO.Pipes.NamedPipeClientStream]::new('.','TERUISI.Worker.ReleaseRotation.v1',[IO.Pipes.PipeDirection]::InOut)
 try{$pipe.Connect(1000);$server=[uint32]0;if(-not [ManualMaintenancePipeOwner]::GetNamedPipeServerProcessId($pipe.SafePipeHandle,[ref]$server) -or $server -ne $owner.processId){throw 'Rotation pipe belongs to another process'}}finally{$pipe.Dispose()}
}
function Assert-NoControlParticipants([object[]]$Processes){
 $first=@($Processes|Where-Object {[int]$_.ProcessId -eq $script:actor.actor.processId})
 if($first.Count -gt 0){Assert-Actor $script:actor.actor $first[0];throw 'Original maintenance actor still exists'}
 foreach($process in $Processes){
  if([int]$process.ProcessId -eq $PID -or [int]$process.ProcessId -eq $script:actor.rotationOwner.processId){continue}
  $name=[string]$process.Name;$command=[string]$process.CommandLine;$exe=[string]$process.ExecutablePath
  if($name -imatch '^(powershell|pwsh|python|pythonw|waitress-serve|node|workerd|wsl)(\.exe)?$' -and (-not $command -or -not $exe)){throw 'Possible late control/application process has unreadable identity'}
  if($name -imatch '^(powershell|pwsh)(\.exe)?$'){
   # Both native transports put file/parameters inside a second base64 JSON
   # payload. This finite bridge does not interpret executable bootstraps.
   # Every other encoded PowerShell actor remains unknown, even when an outer
   # decode would appear unrelated. Exact self and rotation owner were excluded.
   if($command -match '(?i)(?:^|\s)"?[-/](?:e|ec|en|enc|enco|encod|encode|encoded|encodedc|encodedco|encodedcom|encodedcomm|encodedcomma|encodedcomman|encodedcommand)"?(?:\s|:|$)'){
    throw 'Encoded PowerShell participant remains unclassified; no continuation'
   }
   if($command -imatch '(django-[a-z-]+|worker-local-service|operations-system-(control|service)|manual-maintenance-(start|continuation))\.ps1' -or
    $command.IndexOf($djangoFixed,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or $command.IndexOf($workerFixed,[StringComparison]::OrdinalIgnoreCase) -ge 0){throw 'A possibly late lifecycle participant still exists'}
  }
  if([int]$process.ParentProcessId -eq $script:actor.actor.processId -and $process.CreationDate -ge [DateTime]::Parse($script:actor.actor.creationDate)){throw 'An original actor descendant still exists'}
  if($name -imatch '^(python|pythonw|waitress-serve|node|workerd|wsl)(\.exe)?$' -and
   ($exe.StartsWith($djangoFixed+'\',[StringComparison]::OrdinalIgnoreCase) -or $exe.StartsWith($workerFixed+'\',[StringComparison]::OrdinalIgnoreCase) -or
    $command.IndexOf($djangoFixed,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or $command.IndexOf($workerFixed,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or $command -imatch 'TERUISI-Pandas')){throw 'An original application-scope process still exists'}
 }
}
function Assert-Inputs {
 Require-Hash $InputPath $InputSha256
 $script:admissionRecord=Read-Object $InputPath
 if($script:admissionRecord.version -cne 'manual-maintenance-first-attempt-v2' -or $script:admissionRecord.maintenanceId -isnot [string] -or $script:admissionRecord.maintenanceId -cnotmatch '^[a-f0-9]{32}$'){throw 'Not an original finite first attempt'}
 $script:attempt=[IO.Path]::GetFullPath((Split-Path -Parent $InputPath))
 if([IO.Path]::GetFullPath($script:admissionRecord.attempt) -ine $script:attempt){throw 'Original attempt root changed'}
 foreach($key in @('requestSha256','startedSha256')){if($script:admissionRecord.$key -isnot [string] -or $script:admissionRecord.$key -cnotmatch '^[a-f0-9]{64}$'){throw 'Missing original request/source binding'}}
 Require-Hash (Join-Path $script:attempt 'STARTED.json') $script:admissionRecord.startedSha256
 $started=Read-Object (Join-Path $script:attempt 'STARTED.json')
 if($started.maintenanceId -cne $script:admissionRecord.maintenanceId -or $started.mainCommit -cne $script:admissionRecord.sourceCommit -or $started.sourceTree -cne $script:admissionRecord.sourceTree -or $started.source -cne $script:admissionRecord.source -or $started.requestSha256 -cne $script:admissionRecord.requestSha256){throw 'Original STARTED source/request binding changed'}
 Require-Hash (Join-Path $script:attempt 'maintenance-first-request.json') $script:admissionRecord.requestSha256
 Require-Hash (Join-Path $script:attempt 'maintenance-first-FAILED.json') $OriginalFailureSha256
 $failure=Read-Object (Join-Path $script:attempt 'maintenance-first-FAILED.json')
 if($failure.admissionSha256 -cne $InputSha256 -or $failure.maintenanceId -cne $script:admissionRecord.maintenanceId -or $failure.automaticRetry -isnot [bool] -or $failure.automaticRetry){throw 'Original failure binding changed'}
 Require-Hash (Join-Path $script:attempt 'maintenance-first-actor.json') $failure.originalActorSha256
 $required=@('manual-maintenance-start.ps1','manual-maintenance-lock.psm1','manual-maintenance-continuation.ps1','manual-maintenance-continuation.mjs','publish-prepared-main.mjs','publish-main-command.mjs')
 if($script:admissionRecord.sourcePins -isnot [pscustomobject] -or @($script:admissionRecord.sourcePins.PSObject.Properties.Name).Count -ne $required.Count){throw 'Incomplete continuation source closure'}
 foreach($name in $required){Require-Hash (Join-Path $script:admissionRecord.source ('tools\'+$name)) $script:admissionRecord.sourcePins.$name}
 foreach($key in $known.Keys){if($script:admissionRecord.$key -isnot [string] -or $script:admissionRecord.$key -cne $known[$key]){throw ('Not the admitted old controller pair: '+$key)}}
 $script:worker=Join-Path $workerFixed ('releases\'+$known.releaseId+'\tools\worker-local-service.ps1')
 if($script:admissionRecord.workerScript -ine $script:worker){throw 'Original public Worker entry changed'}
 Require-Hash $script:worker $known.workerScriptSha256
 $workerManifestFile=Join-Path $workerFixed ('releases\'+$known.releaseId+'\deployment-manifest.json')
 Require-Hash $workerManifestFile $known.workerManifestSha256
 $workerManifest=Read-Object $workerManifestFile
 $transportKey=@($workerManifest.artifacts.keyFiles|Where-Object {$_.relativePath -ceq 'tools/process-deadline.ps1'})
 if($transportKey.Count -ne 1 -or $transportKey[0].sha256 -cne $known.workerTransportSha256){throw 'Original Worker manifest does not pin its process transport'}
 $script:observerTransport=Join-Path (Split-Path -Parent $script:worker) 'process-deadline.ps1'
 Require-Hash $script:observerTransport $known.workerTransportSha256
 Require-Hash (Join-Path $djangoFixed 'app\deployment.json') $known.djangoManifestSha256
 Require-Hash (Join-Path $djangoFixed 'app\tools\django-local-service.ps1') $known.djangoScriptSha256
 $script:actor=Read-Object (Join-Path $script:attempt 'maintenance-first-actor.json')
 if($script:actor.version -cne 'manual-maintenance-original-actor-v1' -or $script:actor.admissionSha256 -cne $InputSha256 -or $script:actor.maintenanceId -cne $script:admissionRecord.maintenanceId){throw 'No matching pre-invocation actor record'}
 Assert-Actor $script:actor.actor $null
 if($script:actor.helperSha256 -cne $script:admissionRecord.sourcePins.'manual-maintenance-start.ps1'){throw 'Original invocation source changed'}
 if($script:actor.rotationOwner.processId -ne $script:admissionRecord.rotationOwnerPid){throw 'Rotation owner binding changed'}
 foreach($name in @('登记结构迁移-started.json','部署后台-started.json','应用后台权限-started.json','迁移监控字段-started.json','配置天猫库存权限-started.json','配置Pi运行账本权限-started.json','完成结构迁移-started.json','WorkerApply-started.json','退出维护-started.json','启动服务-started.json','SUCCESS.json')){if(Test-Path -LiteralPath (Join-Path $script:attempt $name)){throw 'A downstream effect may have begun; no maintenance continuation'}}
 if(Test-Path -LiteralPath (Join-Path $workerFixed 'state\worker-process.json')){throw 'Original Worker receipt remains; stopped ports are insufficient'}
 if($script:admissionRecord.pandasConfigSha256){Require-Hash (Join-Path $djangoFixed 'config\pandas-sandbox.json') $script:admissionRecord.pandasConfigSha256}
 elseif(Test-Path -LiteralPath (Join-Path $djangoFixed 'config\pandas-sandbox.json')){throw 'Pandas scope changed'}
}
function Get-ContinuationSnapshot {
 Assert-Inputs
 $processes=@(Get-CimInstance Win32_Process -ErrorAction Stop)
 Assert-RotationOwner $processes
 Assert-NoControlParticipants $processes
 $script:maintenance=Read-Object (Join-Path $djangoFixed 'run\system-maintenance.json')
 $drain=Read-Object (Join-Path $djangoFixed 'run\automation-drain.json')
 Assert-Record $script:maintenance 'teruisi-system-maintenance-v1';Assert-Record $drain 'teruisi-automation-drain-v1'
 if($drain.phase -isnot [string] -or $drain.phase -cne 'requests'){throw 'Original request drain is not confirmed'}
 if($script:maintenance.PSObject.Properties.Name -contains 'drainedStopped' -and $script:maintenance.drainedStopped -isnot [bool]){throw 'Invalid original drainedStopped type'}
 $commit=$false;$commitFile=Join-Path $script:attempt 'maintenance-first-native-complete.json'
 if(Test-Path -LiteralPath $commitFile){
  $complete=Read-Object $commitFile
  if($complete.admissionSha256 -cne $InputSha256 -or $complete.maintenanceId -cne $script:admissionRecord.maintenanceId -or $complete.actorProcessId -ne $script:actor.actor.processId -or $complete.exitCode -isnot [int] -or $complete.exitCode -ne 0 -or
   $complete.value.status -cne 'maintenance' -or $complete.value.maintenanceId -cne $script:admissionRecord.maintenanceId -or $complete.value.postgresPreserved -isnot [bool] -or -not $complete.value.postgresPreserved -or $complete.value.backendStopped -isnot [bool] -or -not $complete.value.backendStopped){throw 'Original durable native completion does not match'}
  $commit=$true
 }
 if(($script:maintenance.drainedStopped -eq $true) -ne $commit){throw 'Original durable completion and current drainedStopped do not agree'}
 $workerStatusRaw=& $script:worker -Action Status -Json
 if($LASTEXITCODE -ne 0){throw 'Original public Worker Status failed'}
 $workerStatus=($workerStatusRaw -join "`n")|ConvertFrom-Json
 if($workerStatus -isnot [pscustomobject] -or $workerStatus.state -cne 'stopped' -or $workerStatus.releaseId -cne $known.releaseId -or $workerStatus.manifestSha256 -cne $known.workerManifestSha256){throw 'Original public Worker did not prove stopped'}
 # Reject remaining receipts before reusing assertions that could otherwise
 # clean an old supervisor receipt. This observer never performs that cleanup.
 foreach($entry in @(Get-ChildItem -LiteralPath (Join-Path $djangoFixed 'run') -Filter '*.pid.json' -File)){
  if($entry.Name -imatch '^(django-.+|ai-pandas-wsl|erp-reference-sync)\.pid\.json$'){throw 'A native application-scope process receipt remains'}
 }
 $desired=Read-Object (Join-Path $djangoFixed 'run\django-supervisor-desired-state.json')
 if($desired.desiredState -cne 'stopped' -or $desired.serviceScriptSha256 -cne $known.djangoScriptSha256){throw 'Original Stop desired-state commit is missing'}
 # Load only the pinned installed controller. Reuse its complete app/ACL and
 # native stop-scope/owned PostgreSQL assertions, never its Stop implementation.
 & {
  $previous=$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
  try{$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1';. (Join-Path $djangoFixed 'app\tools\django-local-service.ps1') -RuntimeRoot $djangoFixed -MaintenanceId $script:admissionRecord.maintenanceId
   Assert-DeployedApplication;Assert-RuntimeAclHardened
   Assert-ApplicationDeploymentStopped 'FiniteFirstMaintenanceObserver';Assert-SalesRetirementWorkerStopped 'FiniteFirstMaintenanceObserver'
  }finally{$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY=$previous}
 }
 # This old Django app predates the shared transport. Its exact Worker manifest
 # owns the existing, hash-pinned transport; no file is installed into the app.
 . $script:observerTransport
 $observerDeadline=Get-ProcessDeadline -TimeoutMilliseconds 120000
 function Invoke-ObserverWsl([string[]]$Arguments){
  $limit=[Math]::Min($observerDeadline,([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+15000))
  $capture=Invoke-DeadlineProcess -Executable (Join-Path $env:SystemRoot 'System32\wsl.exe') -Arguments $Arguments -WorkingDirectory $djangoFixed -Deadline $limit -MaxOutputBytes 65536 -Cleanup Preserve
  if($capture.ExitCode -ne 0 -or $capture.Stderr.Trim()){throw 'Pandas read-only Linux observation failed'}
  return $capture.Stdout
 }
 $pandas=$null
 if($script:admissionRecord.pandasConfigSha256){
  $config=Read-Object (Join-Path $djangoFixed 'config\pandas-sandbox.json')
  if($config.version -ne 1 -or $config.image -isnot [string] -or $config.image -cnotmatch '^sha256:[a-f0-9]{64}$'){throw 'Original Pandas config is invalid'}
  Require-Hash (Join-Path $djangoFixed 'secrets\pandas-sandbox.dpapi.json') $config.keySha256
  # Listing does not start a stopped distro. Unknown Linux state stays unknown.
  $running=Invoke-ObserverWsl @('--list','--running','--quiet')
  if(($running.Replace([string][char]0,'') -split '\r?\n' | ForEach-Object {$_.Trim().TrimStart([char]0xFFFD,[char]0xFEFF)}) -cnotcontains 'TERUISI-Pandas'){throw 'Cannot obtain bound running Pandas Linux observation'}
  $prefix=@('-d','TERUISI-Pandas','-u','teruisi-pandas','--exec')
  $linux=Invoke-ObserverWsl ($prefix+@('/usr/bin/env','-i','HOME=/home/teruisi-pandas','PATH=/usr/bin:/bin','XDG_RUNTIME_DIR=/run/user/1000','DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus','/usr/bin/systemctl','--user','show','teruisi-pandas.service','--property=ActiveState','--property=SubState','--property=MainPID','--property=ControlPID'))
  $fields=@{};foreach($line in ($linux -split '\r?\n')){if($line -match '^(ActiveState|SubState|MainPID|ControlPID)=(.*)$'){if($fields.ContainsKey($Matches[1])){throw 'Duplicate Linux state field'};$fields[$Matches[1]]=$Matches[2]}}
  if($fields.Count -ne 4 -or $fields.ActiveState -cne 'inactive' -or $fields.SubState -cne 'dead' -or $fields.MainPID -cne '0' -or $fields.ControlPID -cne '0'){throw 'Pandas Linux service is not stopped'}
  $containers=Invoke-ObserverWsl ($prefix+@('/usr/bin/docker','--host=unix:///run/user/1000/docker.sock','ps','-aq','--filter','label=teruisi.pandas-broker=v1'))
  if($containers.Trim()){throw 'Pandas Linux container cleanup is unknown or incomplete'}
  $pandas=@{distribution='TERUISI-Pandas';user='teruisi-pandas';unit='teruisi-pandas.service';activeState='inactive';subState='dead';mainPid=0;controlPid=0;containers=@()}
 }
 # A second fresh census follows the slower native/WSL observation.
 $processes=@(Get-CimInstance Win32_Process -ErrorAction Stop);Assert-RotationOwner $processes;Assert-NoControlParticipants $processes
 $script:decision=if($commit){'coordinate-completed'}else{'enter-same-id-once'}
 $snapshot=@{version='manual-maintenance-continuation-v1';requestSha256=$script:admissionRecord.requestSha256;startedSha256=$script:admissionRecord.startedSha256;admissionSha256=$InputSha256;originalFailureSha256=$OriginalFailureSha256;maintenanceId=$script:admissionRecord.maintenanceId;sourceBound=$true;rotationOwnerBound=$true;originalActorBound=$true;originalActorExited=$true;controlParticipants=@();fullNativeStopScopeVerified=$true;workerStatus=$workerStatus;workerReceiptAbsent=$true;applicationProcesses=@();postgresPreservedReady=$true;downstreamEffects=@();maintenance=$script:maintenance;drain=$drain;pandasConfigured=[bool]$script:admissionRecord.pandasConfigSha256;pandas=$pandas;durableCompleteCommit=$commit}
 foreach($key in $known.Keys){$snapshot[$key]=$known[$key]}
 return $snapshot
}
try{
 # Pin before importing the mutex adapter; no lifecycle code is loaded here.
 Require-Hash $InputPath $InputSha256;$initial=Read-Object $InputPath
 Require-Hash (Join-Path $PSScriptRoot 'manual-maintenance-lock.psm1') $initial.sourcePins.'manual-maintenance-lock.psm1'
 Import-Module (Join-Path $PSScriptRoot 'manual-maintenance-lock.psm1') -Force
 $hasher=[Security.Cryptography.SHA256]::Create()
 try{$suffix=([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($djangoFixed)))).Replace('-','').ToLowerInvariant().Substring(0,24)}finally{$hasher.Dispose()}
 $wait=120000
 if($env:TERUISI_PROCESS_DEADLINE_UNIX_MS){$deadline=[long]0;if(-not [long]::TryParse($env:TERUISI_PROCESS_DEADLINE_UNIX_MS,[ref]$deadline)){throw 'Invalid inherited process deadline'};$wait=[int][Math]::Min($wait,[Math]::Max(0,$deadline-[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()));if($wait -le 0){throw 'Inherited process deadline exhausted'}}
 Invoke-ManualMaintenanceGate -WorkerMutexName 'Local\TERUISI.Worker.LocalService.v1' -DjangoMutexName ('Local\TERUISI-DjangoSales-'+$suffix) -WaitMilliseconds $wait -Check {
  $script:before=Get-ContinuationSnapshot
  if($Action -ceq 'EnterMaintenance'){Save-New (Join-Path $script:attempt 'maintenance-continuation-STARTED.json') @{at=[DateTimeOffset]::UtcNow.ToString('o');admissionSha256=$InputSha256;originalFailureSha256=$OriginalFailureSha256;decision=$script:decision;before=$script:before}}
  return $true
 } -Operation {
  if($Action -ceq 'Check'){$script:before|ConvertTo-Json -Depth 18 -Compress;return}
  if($script:decision -ceq 'enter-same-id-once'){
   $raw=& $script:worker -Action EnterMaintenance -MaintenanceId $script:admissionRecord.maintenanceId -KeepPostgres -Json
   if($LASTEXITCODE -ne 0){throw 'The one original same-ID Enter did not complete; no further continuation'}
   $native=($raw -join "`n")|ConvertFrom-Json
   if($native.status -cne 'maintenance' -or $native.maintenanceId -cne $script:admissionRecord.maintenanceId -or $native.postgresPreserved -isnot [bool] -or -not $native.postgresPreserved -or $native.backendStopped -isnot [bool] -or -not $native.backendStopped){throw 'Original same-ID Enter returned an unknown result'}
  }
  $result=@{status='maintenance';maintenanceId=$script:admissionRecord.maintenanceId;postgresPreserved=$true;continuationDecision=$script:decision;before=$script:before;originalStopExitCodeUnknown=$true;currentlyStoppedVerified=$true}
  Save-New (Join-Path $script:attempt 'maintenance-continuation-COMPLETE.json') $result
  $result|ConvertTo-Json -Depth 18 -Compress
 }
}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}
