$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../tools/manual-maintenance-process.psm1') -Force
Import-Module (Join-Path $PSScriptRoot '../tools/manual-maintenance-lock.psm1') -Force
function Fails([scriptblock]$Body,[string]$Match){$caught=$false;try{& $Body}catch{if($_.Exception.Message -notmatch $Match){throw};$caught=$true};if(-not $caught){throw 'Unsafe preflight accepted'}}
# Actual read-only CIM input under both supported engines. Mutation is confined
# to the detached PSCustomObject, including a null metadata projection.
$raw=Get-CimInstance Win32_Process -Filter ('ProcessId='+$PID) -ErrorAction Stop
$original=[string]$raw.CommandLine;$detached=$raw|ConvertTo-MaintenanceProcess
if($detached -isnot [pscustomobject] -or @($detached.PSObject.Properties).Count -ne 6){throw 'Not the independent six-field projection'}
$detached.CommandLine='private detached value'
if([string]$raw.CommandLine -cne $original){throw 'Projection modified real CIM object'}
$missing=[pscustomobject]@{ProcessId=77;ParentProcessId=1;Name='python.exe';CreationDate=[DateTime]::UtcNow;ExecutablePath=$null;CommandLine=$null}|ConvertTo-MaintenanceProcess
Fails {Assert-MaintenanceProcessVisibility @($missing)} 'unreadable identity'
$missing.Name='unrelated-system.exe';Assert-MaintenanceProcessVisibility @($missing)
$root=Join-Path ([IO.Path]::GetTempPath()) ('release-preflight-private-'+[Guid]::NewGuid().ToString('N'))
$django=Join-Path $root 'django';$worker=Join-Path $root 'worker';$source=Join-Path $root 'source'
$names=@('manual-maintenance-start.ps1','manual-maintenance-lock.psm1','manual-maintenance-continuation.ps1','manual-maintenance-continuation.mjs','publish-prepared-main.mjs','publish-main-command.mjs','manual-maintenance-process.psm1','manual-maintenance-preflight.ps1','django-ai.ps1','worker-local-service.ps1','process-deadline.ps1','django-local-service.ps1')
$pins=@();foreach($name in $names){$pins+=[pscustomobject]@{root='source';relative=$name;sha256=''}}
foreach($relative in @('app/deployment.json','app/tools/django-local-service.ps1','app/tools/django-ai.ps1')){$pins+=[pscustomobject]@{root='django';relative=$relative;sha256=''}}
foreach($relative in @('tools/worker-local-service.ps1','tools/process-deadline.ps1','deployment-manifest.json')){$pins+=[pscustomobject]@{root='worker';relative=('releases/private/'+$relative);sha256=''}}
try{
 foreach($pin in $pins){$base=switch($pin.root){'source'{$source};'django'{$django};'worker'{$worker}};$file=Join-Path $base $pin.relative;[void][IO.Directory]::CreateDirectory((Split-Path -Parent $file));[IO.File]::WriteAllText($file,'private fixture bytes');$pin.sha256=(Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant()}
 $r=[pscustomobject]@{version='manual-maintenance-readiness-v1';route='native-exit-observer';releaseId='private';preparedAt=[DateTimeOffset]::UtcNow.ToString('o');pins=$pins;piWorkerReceiptSha256=$null;piConfigurationSha256=$null}
 # Mock only the OS enumeration seam after the real-CIM proof. Never invoke
 # any actual lifecycle entry, installed runtime, WSL, task or production lock.
 $global:preflightCensusCalls=0
 function global:Get-CimInstance {param($ClassName,$Filter,$ErrorAction);$global:preflightCensusCalls++;if($Filter){return $global:preflightPiProcess};return $global:preflightCensus}
 $global:preflightCensus=@($missing);$missing.Name='node.exe'
 if(-not (Assert-MaintenanceReadiness $r $django $worker $source) -or $global:preflightCensusCalls -ne 0){throw 'Native route consumed a legacy full census'}
 $r.route='pi19db';$r.pins=@($pins|Where-Object {-not ($_.root -ceq 'source' -and $_.relative -cin @('django-ai.ps1','worker-local-service.ps1','process-deadline.ps1','django-local-service.ps1'))})
 Fails {Assert-MaintenanceReadiness $r $django $worker $source} 'unreadable identity'
 $global:preflightCensus=@();[void](Assert-MaintenanceReadiness $r $django $worker $source)
 $r.preparedAt=[DateTimeOffset]::UtcNow.AddSeconds(-121).ToString('o');Fails {Assert-MaintenanceReadiness $r $django $worker $source} 'expired';$r.preparedAt=[DateTimeOffset]::UtcNow.ToString('o')
 $saved=$r.pins;$r.pins=@($saved[0]) * $saved.Count;Fails {Assert-MaintenanceReadiness $r $django $worker $source} 'duplicated';$r.pins=$saved
 $file=Join-Path $django 'app/tools/django-ai.ps1';[IO.File]::AppendAllText($file,' drift');Fails {Assert-MaintenanceReadiness $r $django $worker $source} 'tool or recovery';[IO.File]::WriteAllText($file,'private fixture bytes')
 $receipt=Join-Path $django 'run/django-ai-pi-worker.pid.json';[void][IO.Directory]::CreateDirectory((Split-Path -Parent $receipt))
 $created=[DateTime]::UtcNow;$python=Join-Path $django 'venv/Scripts/python.exe'
 $identity=@{version=2;service='django-ai-pi-worker';processId=123;creationDate=$created.ToString('o');executablePath=$python;commandLine='private exact Pi'}
 [IO.File]::WriteAllText($receipt,($identity|ConvertTo-Json -Compress));$r.piWorkerReceiptSha256=(Get-FileHash $receipt -Algorithm SHA256).Hash.ToLowerInvariant()
 $global:preflightPiProcess=[pscustomobject]@{ProcessId=123;ParentProcessId=1;Name='python.exe';CreationDate=$created;ExecutablePath=$python;CommandLine=$identity.commandLine}
 [void](Assert-MaintenanceReadiness $r $django $worker $source)
 $global:preflightPiProcess.CommandLine=$null;Fails {Assert-MaintenanceReadiness $r $django $worker $source} 'identity is unknown'
 # Revalidate freshly admitted facts while TWO private locks are held. A new
 # unreadable Pi identity after the first pass must prevent Operation entirely.
 $script:entered=$false;$nonce=[Guid]::NewGuid().ToString('N')
 Fails {Invoke-ManualMaintenanceGate -WorkerMutexName ('Local\private-release-worker-'+$nonce) -DjangoMutexName ('Local\private-release-django-'+$nonce) -Check {Assert-MaintenanceReadiness $r $django $worker $source} -Operation {$script:entered=$true}} 'identity is unknown'
 if($script:entered){throw 'Dynamic failure reached native operation'}
 $admin=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
 'PREFLIGHT_PS_PASSED admin='+$admin+' actualCim='+$raw.CimClass.CimClassName
}finally{
 Remove-Item Function:\Get-CimInstance -ErrorAction SilentlyContinue
 if([IO.Path]::GetFullPath($root) -notlike '*release-preflight-private-*'){throw 'Unsafe test cleanup'}
 Remove-Item -LiteralPath $root -Recurse -Force
}
