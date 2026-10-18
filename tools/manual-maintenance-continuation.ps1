param([ValidateSet('Check','EnterMaintenance')][string]$Action='Check',
 [Parameter(Mandatory)][string]$InputPath,[Parameter(Mandatory)][string]$InputSha256,
 [Parameter(Mandatory)][string]$OriginalFailureSha256,[ValidateSet('legacy','pi19db')][string]$Route='legacy',
 [string]$ObservationPath,[string]$ObservationSha256,[switch]$Json)
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
$script:piMode=$Route -ceq 'pi19db'
if($script:piMode){$known=@{
 releaseId='20261018T081823Z-282cee340c57bf41'
 workerManifestSha256='120911425367ef3a451c40f7a9842f3c1e39fc99b38cfd602b011ae3ed0733fc'
 djangoManifestSha256='a9e3fdb943dfcc558a69982f9d410aff103872712e26e0d50b0cefe3841693e7'
 workerScriptSha256='112b091b610b09187110ba478cfff2280b30705dd21e185a8132e683414ec2bc'
 djangoScriptSha256='d37902ebfbad7a7d6a78bce92e30056fcd6d253c70faa4267089ba5a43df74f2'
 djangoAiScriptSha256='fc767f83a175642da0922db29770400e50a73d0ca00c56ba840a87d97725455b'
 workerTransportSha256='5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd'
}}
function Hash-File([string]$File){(Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()}
function Read-Object([string]$File){
 $raw=[IO.File]::ReadAllText($File)
 if(-not $raw.TrimStart().StartsWith('{')){throw 'Expected an original JSON object'}
 $value=if($script:piMode -and (Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){$raw|ConvertFrom-Json -DateKind String}else{$raw|ConvertFrom-Json}
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
 if($Record -isnot [pscustomobject] -or ($Record.processId -isnot [int] -and -not ($script:piMode -and $Record.processId -is [long] -and $Record.processId -le [int]::MaxValue)) -or $Record.processId -le 0 -or
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
 Assert-MaintenanceProcessVisibility $Processes
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
    $command.IndexOf($djangoFixed,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or $command.IndexOf($workerFixed,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or $command -imatch 'TERUISI-Pandas')){
   $allowed=@($script:piAllowed|Where-Object {[int]$_.ProcessId -eq [int]$process.ProcessId -and
     $_.CreationDate -ceq $process.CreationDate.ToUniversalTime().ToString('o') -and $_.ExecutablePath -ieq $exe -and $_.CommandLine -ceq $command})
   if(-not $script:piMode -or $allowed.Count -ne 1){throw 'An unverified application or late native lifecycle process still exists'}
  }
 }
}
function Assert-Inputs {
 Require-Hash $InputPath $InputSha256
 $script:admissionRecord=Read-Object $InputPath
 if($script:admissionRecord.version -cne 'manual-maintenance-first-attempt-v2' -or $script:admissionRecord.maintenanceId -isnot [string] -or $script:admissionRecord.maintenanceId -cnotmatch '^[a-f0-9]{32}$'){throw 'Not an original finite first attempt'}
 if($script:piMode -and $script:admissionRecord.readinessRoute -cne 'pi19db'){throw 'Not the pre-admitted Pi predecessor route'}
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
 $required=@('manual-maintenance-start.ps1','manual-maintenance-lock.psm1','manual-maintenance-continuation.ps1','manual-maintenance-continuation.mjs','publish-prepared-main.mjs','publish-main-command.mjs','manual-maintenance-process.psm1','manual-maintenance-preflight.ps1')
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
 if($script:piMode){Require-Hash (Join-Path $djangoFixed 'app\tools\django-ai.ps1') $known.djangoAiScriptSha256}
 $script:actor=Read-Object (Join-Path $script:attempt 'maintenance-first-actor.json')
 if($script:actor.version -cne 'manual-maintenance-original-actor-v1' -or $script:actor.admissionSha256 -cne $InputSha256 -or $script:actor.maintenanceId -cne $script:admissionRecord.maintenanceId){throw 'No matching pre-invocation actor record'}
 Assert-Actor $script:actor.actor $null
 if($script:actor.helperSha256 -cne $script:admissionRecord.sourcePins.'manual-maintenance-start.ps1'){throw 'Original invocation source changed'}
 if($script:actor.rotationOwner.processId -ne $script:admissionRecord.rotationOwnerPid){throw 'Rotation owner binding changed'}
 foreach($name in @('登记结构迁移-started.json','部署后台-started.json','应用后台权限-started.json','迁移监控字段-started.json','配置天猫库存权限-started.json','配置Pi运行账本权限-started.json','完成结构迁移-started.json','WorkerApply-started.json','退出维护-started.json','启动服务-started.json','SUCCESS.json')){if(Test-Path -LiteralPath (Join-Path $script:attempt $name)){throw 'A downstream effect may have begun; no maintenance continuation'}}
 if(Test-Path -LiteralPath (Join-Path $workerFixed 'state\worker-process.json')){throw 'Original Worker receipt remains; stopped ports are insufficient'}
 if($script:admissionRecord.pandasConfigSha256){Require-Hash (Join-Path $djangoFixed 'config\pandas-sandbox.json') $script:admissionRecord.pandasConfigSha256}
 elseif(Test-Path -LiteralPath (Join-Path $djangoFixed 'config\pandas-sandbox.json')){throw 'Pandas scope changed'}
 if($script:piMode -and (Test-Path -LiteralPath (Join-Path $script:attempt 'maintenance-pi-continuation-STARTED.json'))){throw 'Pi continuation already started; no replay'}
 if($script:piMode){Require-Hash (Join-Path $djangoFixed 'config\pi-agent.json') $script:admissionRecord.piConfigurationSha256}
}
function Assert-PiStop([object[]]$Processes){
 $identity=$script:admissionRecord.piWorkerIdentity
 if($identity -isnot [pscustomobject] -or $identity.version -ne 2 -or $identity.service -cne 'django-ai-pi-worker' -or
  ($identity.processId -isnot [int] -and $identity.processId -isnot [long]) -or $identity.processId -le 0 -or $identity.processId -gt [int]::MaxValue -or $identity.creationDate -isnot [string] -or
  $identity.commandLine -isnot [string] -or $identity.executablePath -isnot [string]){throw 'No original Pi process identity'}
 if(@($Processes|Where-Object {[int]$_.ProcessId -eq $identity.processId -or [int]$_.ParentProcessId -eq $identity.processId}).Count){throw 'Pi process, reused PID or descendant still exists'}
 $run=Join-Path $djangoFixed 'run';$pidFile=Join-Path $run 'django-ai-pi-worker.pid.json'
 if(Test-Path -LiteralPath $pidFile){Require-Hash $pidFile $script:admissionRecord.piWorkerReceiptSha256}
 $controlFile=Join-Path $run 'django-ai-pi-worker.control.json';$ackFile=$controlFile+'.stopped'
 $controlSha=Hash-File $controlFile;$ackSha=Hash-File $ackFile
 $control=Read-Object $controlFile;$ack=Read-Object $ackFile
 foreach($tuple in @(@($controlFile,$control,@('version','token','intent')),@($ackFile,$ack,@('version','token','status')))){
  $names=@($tuple[1].PSObject.Properties.Name)
  if((($names|Sort-Object) -join ',') -cne (($tuple[2]|Sort-Object) -join ',')){throw 'Pi stop record fields changed'}
  if([regex]::Matches([IO.File]::ReadAllText($tuple[0]),'"(?:version|token|intent|status)"\s*:').Count -ne 3){throw 'Duplicated Pi stop record fields'}
 }
 $arguments=@($identity.arguments);$token=[string]$arguments[-1]
 if($token -cnotmatch '^[a-f0-9]{32}$' -or ($control.version -isnot [int] -and $control.version -isnot [long]) -or $control.version -ne 1 -or ($ack.version -isnot [int] -and $ack.version -isnot [long]) -or $ack.version -ne 1 -or
  $control.token -cne $token -or $ack.token -cne $token -or $control.intent -cne 'stop' -or $ack.status -cne 'stopped'){throw 'Pi stop acknowledgement is not bound to original token'}
 Require-Hash $controlFile $controlSha;Require-Hash $ackFile $ackSha
 return @{controlSha256=$controlSha;ackSha256=$ackSha}
}
function Get-PiRemainingApplicationSnapshots {
 # Only original native receipt validators can admit a remaining long-lived
 # service. A Python/WSL control grandchild has no such fixed service receipt.
 & {
  $previous=$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
  try{
   $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1'
   . (Join-Path $djangoFixed 'app\tools\django-local-service.ps1') -RuntimeRoot $djangoFixed -Action MaintenanceStatus
   $Action='MaintenanceStatus'
   $services=@('django-reader','django-writer')
   foreach($domain in @('finance','netshop','market','products','inventory','workflow','customer-service','access-control','erp-reference','ai')){foreach($side in @('reader','writer')){$services+=('django-'+$domain+'-'+$side)}}
   $services+='django-bi-reader'
   foreach($service in $services){$owned=Resolve-OwnedProcess $service (Join-Path $RunDirectory ($service+'.pid.json')) $Waitress -ReadOnly;if($owned){$owned;Get-VerifiedProcessDescendants $owned}}
   foreach($service in @('django-ai-dingtalk','django-ai-dingtalk-schedule','erp-reference-sync')){$owned=Resolve-OwnedProcess $service (Join-Path $RunDirectory ($service+'.pid.json')) $Python -ReadOnly;if($owned){$owned;Get-VerifiedProcessDescendants $owned}}
   $keepalive=@('-d','TERUISI-Pandas','-u','teruisi-pandas','--exec','/usr/bin/sleep','infinity')
   $owned=Resolve-OwnedProcess 'ai-pandas-wsl' (Join-Path $RunDirectory 'ai-pandas-wsl.pid.json') (Join-Path $env:SystemRoot 'System32\wsl.exe') $keepalive -ReadOnly
   if($owned){$owned;Get-VerifiedProcessDescendants $owned}
  }finally{$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY=$previous}
 }
}
function Assert-OriginalNativeComplete([object]$Complete){
 if($Complete.admissionSha256 -cne $InputSha256 -or $Complete.maintenanceId -cne $script:admissionRecord.maintenanceId -or $Complete.actorProcessId -ne $script:actor.actor.processId -or ($Complete.exitCode -isnot [int] -and -not ($script:piMode -and $Complete.exitCode -is [long])) -or $Complete.exitCode -ne 0 -or
  $Complete.value.status -cne 'maintenance' -or $Complete.value.maintenanceId -cne $script:admissionRecord.maintenanceId -or $Complete.value.postgresPreserved -isnot [bool] -or -not $Complete.value.postgresPreserved -or $Complete.value.backendStopped -isnot [bool] -or -not $Complete.value.backendStopped){throw 'Original durable native completion does not match'}
}
function Get-ContinuationSnapshot {
 Assert-Inputs
 if($script:piMode){$script:piAllowed=@(Get-PiRemainingApplicationSnapshots)}
 $processes=@(Get-CimInstance Win32_Process -ErrorAction Stop|ConvertTo-MaintenanceProcess)
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
  Assert-OriginalNativeComplete $complete
  $commit=$true
 }
 if(-not $script:piMode -and (($script:maintenance.drainedStopped -eq $true) -ne $commit)){throw 'Original durable completion and current drainedStopped do not agree'}
 if($script:piMode -and $script:maintenance.drainedStopped -eq $true -and -not $commit){throw 'Completed Pi maintenance lacks its original durable native completion'}
 $workerStatusRaw=& $script:worker -Action Status -Json
 if($LASTEXITCODE -ne 0){throw 'Original public Worker Status failed'}
 $workerStatus=($workerStatusRaw -join "`n")|ConvertFrom-Json
 if($workerStatus -isnot [pscustomobject] -or $workerStatus.state -cne 'stopped' -or $workerStatus.releaseId -cne $known.releaseId -or $workerStatus.manifestSha256 -cne $known.workerManifestSha256){throw 'Original public Worker did not prove stopped'}
 # Reject remaining receipts before reusing assertions that could otherwise
 # clean an old supervisor receipt. This observer never performs that cleanup.
 foreach($entry in @(Get-ChildItem -LiteralPath (Join-Path $djangoFixed 'run') -Filter '*.pid.json' -File)){
  if($script:piMode){continue}
  if($entry.Name -imatch '^(django-.+|ai-pandas-wsl|erp-reference-sync)\.pid\.json$'){throw 'A native application-scope process receipt remains'}
 }
 $desired=Read-Object (Join-Path $djangoFixed 'run\django-supervisor-desired-state.json')
 if($desired.desiredState -cne 'stopped' -or $desired.serviceScriptSha256 -cne $known.djangoScriptSha256){throw 'Original Stop desired-state commit is missing'}
 # Load only the pinned installed controller. Reuse its complete app/ACL and
 # native stop-scope/owned PostgreSQL assertions, never its Stop implementation.
 & {
  $previous=$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
  try{$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1';. (Join-Path $djangoFixed 'app\tools\django-local-service.ps1') -RuntimeRoot $djangoFixed -MaintenanceId $script:admissionRecord.maintenanceId
   if($script:piMode){
    $Action='MaintenanceStatus'
    [void](Assert-PostgresListenerOwnership);if(-not (Test-PostgresReady)){throw 'Owned PostgreSQL is not ready'}
    if($script:maintenance.drainedStopped -eq $true){Assert-ApplicationDeploymentStopped 'PiMaintenanceObserver';Assert-SalesRetirementWorkerStopped 'PiMaintenanceObserver'}
   }else{
    Assert-DeployedApplication;Assert-RuntimeAclHardened
    Assert-ApplicationDeploymentStopped 'FiniteFirstMaintenanceObserver';Assert-SalesRetirementWorkerStopped 'FiniteFirstMaintenanceObserver'
   }
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
 if(-not $script:piMode -and $script:admissionRecord.pandasConfigSha256){
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
 $processes=@(Get-CimInstance Win32_Process -ErrorAction Stop|ConvertTo-MaintenanceProcess);Assert-RotationOwner $processes;Assert-NoControlParticipants $processes
 if($script:piMode){
  $pi=Assert-PiStop $processes
  $script:decision=if($script:maintenance.drainedStopped -eq $true){'coordinate-completed'}else{'enter-same-id-once'}
  $snapshot=@{version='manual-maintenance-pi-continuation-v1';at=[DateTimeOffset]::UtcNow.ToString('o');requestSha256=$script:admissionRecord.requestSha256;startedSha256=$script:admissionRecord.startedSha256;admissionSha256=$InputSha256;originalFailureSha256=$OriginalFailureSha256;maintenanceId=$script:admissionRecord.maintenanceId;sourceBound=$true;rotationOwnerBound=$true;originalActorBound=$true;originalActorExited=$true;controlParticipants=@();workerReceiptAbsent=$true;postgresPreservedReady=$true;downstreamEffects=@();maintenance=$script:maintenance;drain=$drain;piStopBound=$true;piWorkerAbsent=$true;piStopBinding=$pi;nativeStopIdentityGatePreserved=$true;fullNativeStopScopeVerified=($script:maintenance.drainedStopped -eq $true);durableCompleteCommit=$commit}
  foreach($key in $known.Keys){$snapshot[$key]=$known[$key]};return $snapshot
 }
 $script:decision=if($commit){'coordinate-completed'}else{'enter-same-id-once'}
 $snapshot=@{version='manual-maintenance-continuation-v1';requestSha256=$script:admissionRecord.requestSha256;startedSha256=$script:admissionRecord.startedSha256;admissionSha256=$InputSha256;originalFailureSha256=$OriginalFailureSha256;maintenanceId=$script:admissionRecord.maintenanceId;sourceBound=$true;rotationOwnerBound=$true;originalActorBound=$true;originalActorExited=$true;controlParticipants=@();fullNativeStopScopeVerified=$true;workerStatus=$workerStatus;workerReceiptAbsent=$true;applicationProcesses=@();postgresPreservedReady=$true;downstreamEffects=@();maintenance=$script:maintenance;drain=$drain;pandasConfigured=[bool]$script:admissionRecord.pandasConfigSha256;pandas=$pandas;durableCompleteCommit=$commit}
 foreach($key in $known.Keys){$snapshot[$key]=$known[$key]}
 return $snapshot
}
try{
 # Pin before importing the mutex adapter; no lifecycle code is loaded here.
 Require-Hash $InputPath $InputSha256;$initial=Read-Object $InputPath
 Require-Hash (Join-Path $PSScriptRoot 'manual-maintenance-lock.psm1') $initial.sourcePins.'manual-maintenance-lock.psm1'
 Require-Hash (Join-Path $PSScriptRoot 'manual-maintenance-process.psm1') $initial.sourcePins.'manual-maintenance-process.psm1'
 Import-Module (Join-Path $PSScriptRoot 'manual-maintenance-process.psm1') -Force
 Import-Module (Join-Path $PSScriptRoot 'manual-maintenance-lock.psm1') -Force
 $hasher=[Security.Cryptography.SHA256]::Create()
 try{$suffix=([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($djangoFixed)))).Replace('-','').ToLowerInvariant().Substring(0,24)}finally{$hasher.Dispose()}
 $wait=120000
 if($env:TERUISI_PROCESS_DEADLINE_UNIX_MS){$deadline=[long]0;if(-not [long]::TryParse($env:TERUISI_PROCESS_DEADLINE_UNIX_MS,[ref]$deadline)){throw 'Invalid inherited process deadline'};$wait=[int][Math]::Min($wait,[Math]::Max(0,$deadline-[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()));if($wait -le 0){throw 'Inherited process deadline exhausted'}}
 Invoke-ManualMaintenanceGate -WorkerMutexName 'Local\TERUISI.Worker.LocalService.v1' -DjangoMutexName ('Local\TERUISI-DjangoSales-'+$suffix) -WaitMilliseconds $wait -Check {
  $script:before=Get-ContinuationSnapshot
  if($script:piMode -and $Action -ceq 'EnterMaintenance'){
   if([IO.Path]::GetFullPath((Split-Path -Parent $ObservationPath)) -ine $script:attempt -or [IO.Path]::GetFileName($ObservationPath) -cnotmatch '^maintenance-pi-observation-[a-f0-9]{32}\.json$'){throw 'Independent Pi observation path changed'}
   Require-Hash $ObservationPath $ObservationSha256;$observation=Read-Object $ObservationPath
   $observedAt=[DateTimeOffset]::Parse($observation.at)
   if($observedAt -gt [DateTimeOffset]::UtcNow -or ([DateTimeOffset]::UtcNow-$observedAt).TotalSeconds -ge 120 -or
    $observation.admissionSha256 -cne $InputSha256 -or $observation.originalFailureSha256 -cne $OriginalFailureSha256 -or
    $observation.maintenanceId -cne $script:admissionRecord.maintenanceId -or $observation.version -cne 'manual-maintenance-pi-continuation-v1' -or
    $observation.piStopBinding.controlSha256 -cne $script:before.piStopBinding.controlSha256 -or $observation.piStopBinding.ackSha256 -cne $script:before.piStopBinding.ackSha256){throw 'Independent Pi observation is stale or changed'}
  }
  if($Action -ceq 'EnterMaintenance'){$record=if($script:piMode){'maintenance-pi-continuation-STARTED.json'}else{'maintenance-continuation-STARTED.json'};$started=@{at=[DateTimeOffset]::UtcNow.ToString('o');admissionSha256=$InputSha256;originalFailureSha256=$OriginalFailureSha256;decision=$script:decision;before=$script:before};if($script:piMode){$started.observationSha256=$ObservationSha256};Save-New (Join-Path $script:attempt $record) $started}
  return $true
 } -Operation {
  if($Action -ceq 'Check'){
   if($script:piMode){$file=Join-Path $script:attempt ('maintenance-pi-observation-'+[Guid]::NewGuid().ToString('N')+'.json');Save-New $file $script:before;@{snapshot=$script:before;observationPath=$file;observationSha256=(Hash-File $file)}|ConvertTo-Json -Depth 18 -Compress}
   else{$script:before|ConvertTo-Json -Depth 18 -Compress};return
  }
  if($script:decision -ceq 'enter-same-id-once'){
   $raw=& $script:worker -Action EnterMaintenance -MaintenanceId $script:admissionRecord.maintenanceId -KeepPostgres -Json
   if($LASTEXITCODE -ne 0){throw 'The one original same-ID Enter did not complete; no further continuation'}
   $native=($raw -join "`n")|ConvertFrom-Json
   if($native.status -cne 'maintenance' -or $native.maintenanceId -cne $script:admissionRecord.maintenanceId -or $native.postgresPreserved -isnot [bool] -or -not $native.postgresPreserved -or $native.backendStopped -isnot [bool] -or -not $native.backendStopped){throw 'Original same-ID Enter returned an unknown result'}
  }
  $result=@{status='maintenance';maintenanceId=$script:admissionRecord.maintenanceId;postgresPreserved=$true;continuationDecision=$script:decision;before=$script:before;originalStopExitCodeUnknown=$true;currentlyStoppedVerified=$true}
  if($script:piMode){$result.observationSha256=$ObservationSha256}
  $completeName=if($script:piMode){'maintenance-pi-continuation-COMPLETE.json'}else{'maintenance-continuation-COMPLETE.json'}
  Save-New (Join-Path $script:attempt $completeName) $result
  $result|ConvertTo-Json -Depth 18 -Compress
 }
}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}
