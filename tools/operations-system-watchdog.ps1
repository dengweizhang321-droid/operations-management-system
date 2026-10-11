#requires -Version 7.0
[CmdletBinding()]
param(
  [ValidateSet('Check','Install','Status','TestNotification')][string]$Action='Check',
  [switch]$Execute,
  [switch]$FunctionsOnly
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'process-deadline.ps1')
$WatchdogVersion='teruisi-operations-watchdog-v2'
$TaskName='TERUISI Operations Watchdog'
$ProjectRoot='D:\运营管理系统'
$WatchdogRoot='D:\teruisi-runtime\operations-watchdog'
$BackendRoot='D:\teruisi-runtime\django-sales'
$ControlPath=Join-Path $ProjectRoot 'tools\operations-system-control.ps1'
$WorkerPath=Join-Path $ProjectRoot 'tools\worker-local-service.ps1'
$SupervisorPath=Join-Path $BackendRoot 'app\tools\django-runtime-supervisor.ps1'
$DesiredPath=Join-Path $BackendRoot 'run\django-supervisor-desired-state.json'
$MaintenancePath=Join-Path $BackendRoot 'run\system-maintenance.json'
$StatePath=Join-Path $WatchdogRoot 'state.json'
$PowerShellPath=(Get-Process -Id $PID).Path
$DwsPath=Join-Path $env:APPDATA 'npm\node_modules\dingtalk-workspace-cli\vendor\dws.exe'

function Read-WatchJson([string]$Path) {
  if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){return $null}
  $f=Get-Item -LiteralPath $Path -Force
  if($f.Attributes -band [IO.FileAttributes]::ReparsePoint -or $f.Length -gt 1048576){throw 'invalid_state_file'}
  $options=@{}; if((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){$options.DateKind='String'}
  return [IO.File]::ReadAllText($Path)|ConvertFrom-Json @options
}
function Write-WatchJson([string]$Path,[object]$Value) {
  $parent=Split-Path -Parent $Path
  if(-not(Test-Path -LiteralPath $parent)){New-Item -ItemType Directory -Path $parent|Out-Null}
  $temp="$Path.tmp-$([guid]::NewGuid().ToString('N'))"; $backup="$temp.bak"
  try{
    [IO.File]::WriteAllText($temp,($Value|ConvertTo-Json -Depth 16),[Text.UTF8Encoding]::new($false))
    if(Test-Path -LiteralPath $Path){[IO.File]::Replace($temp,$Path,$backup,$true)}else{[IO.File]::Move($temp,$Path)}
  }finally{foreach($p in @($temp,$backup)){if(Test-Path -LiteralPath $p){[IO.File]::Delete($p)}}}
}
function Get-WatchHash([string]$Path){(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Invoke-WatchProcess([string]$Executable,[string[]]$Arguments,[int]$Seconds=60) {
  # Only direct probe ownership is admitted. DWS unknown delivery is terminal.
  $capture=Invoke-DeadlineProcess -Executable $Executable -Arguments $Arguments -WorkingDirectory $WatchdogRoot -Deadline (Get-ProcessDeadline ($Seconds*1000)) -Cleanup Direct
  $evidence=$capture.Evidence
  $evidence.stage='result-parse'
  try {
    if($capture.ExitCode -ne 0){$evidence.code='nonzero_exit';throw 'operator_failed'}
    [void](Get-ProcessRemaining $evidence.deadlineUnixMs)
    $result=$capture.Stdout.Trim()|ConvertFrom-Json -ErrorAction Stop
    if($null -eq $result -or $result -is [array] -or $result -is [string] -or $result -is [ValueType]){throw 'invalid_result'}
    [void](Get-ProcessRemaining $evidence.deadlineUnixMs)
    return $result
  } catch {
    if($evidence.code -eq 'completed'){$evidence.code='invalid_result'}
    if($_.Exception.Message -eq 'process_deadline_exhausted'){$evidence.code='process_deadline_exhausted';$evidence.timeoutType='result-parse'}
    $failure=[Exception]::new(('probe_failure '+($evidence|ConvertTo-Json -Compress)))
    $failure.Data['ProcessEvidence']=$evidence
    throw $failure
  }
}
function Invoke-WatchScript([string]$Path,[string[]]$Arguments){
  Invoke-WatchProcess $PowerShellPath (@('-NoProfile','-NonInteractive','-File',$Path)+$Arguments)
}
function Get-Admission {
  try{
    $desired=Read-WatchJson $DesiredPath
    if(-not $desired -or $desired.version -cne 'teruisi-django-supervisor-desired-state-v1' -or
      $desired.desiredState -notin @('running','stopped') -or
      $desired.serviceScriptSha256 -cne (Get-WatchHash (Join-Path $BackendRoot 'app\tools\django-local-service.ps1'))){throw 'invalid_desired_state'}
    if(Test-Path -LiteralPath $MaintenancePath){
      $maintenance=Read-WatchJson $MaintenancePath
      if($maintenance.version -cne 'teruisi-system-maintenance-v1' -or $maintenance.id -cnotmatch '^[0-9a-f]{32}$' -or
        [IO.Path]::GetFullPath([string]$maintenance.runtimeRoot).TrimEnd('\') -ine $BackendRoot){throw 'invalid_maintenance'}
      return @{mode='maintenance';fence=Get-WatchHash $DesiredPath}
    }
    return @{mode=[string]$desired.desiredState;fence=Get-WatchHash $DesiredPath}
  }catch{return @{mode='invalid';fence=$null}}
}
function Test-WatchHttp([string]$Url,[string]$Kind){
  $clock=[Diagnostics.Stopwatch]::StartNew()
  $probe=@{ok=$false;status=0;reason='transport_error';elapsedMs=0}
  $handler=[Net.Http.HttpClientHandler]::new();$handler.UseProxy=$false;$handler.AllowAutoRedirect=$false
  $client=[Net.Http.HttpClient]::new($handler)
  $request=[Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get,$Url);$response=$null
  try{
    $deadline=Get-ProcessDeadline 5000;$client.Timeout=[TimeSpan]::FromMilliseconds((Get-ProcessRemaining $deadline))
    [void]$request.Headers.TryAddWithoutValidation('x-teruisi-local-health','1')
    $response=$client.SendAsync($request,[Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    [void](Get-ProcessRemaining $deadline)
    $probe.status=[int]$response.StatusCode
    if($probe.status -ne 200){$probe.reason='http_status';return $probe}
    if($Kind -eq 'homepage'){$probe.ok=$true;$probe.reason='none';return $probe}
    $cts=[Threading.CancellationTokenSource]::new((Get-ProcessRemaining $deadline))
    try{
      $stream=$response.Content.ReadAsStreamAsync().GetAwaiter().GetResult();$bytes=[byte[]]::new(8193);$n=0
      while($n -lt $bytes.Length){$read=$stream.ReadAsync($bytes,$n,$bytes.Length-$n,$cts.Token).GetAwaiter().GetResult();if($read -eq 0){break};$n+=$read}
      if($n -gt 8192){throw 'health_body_too_large'}
      $content=[Text.UTF8Encoding]::new($false,$true).GetString($bytes,0,$n).Trim()
      $probe.reason='invalid_json'
      if(-not $content.StartsWith('{')){return $probe}
      $body=$content|ConvertFrom-Json
      if($body -isnot [pscustomobject]){return $probe}
      $probe.reason='contract_error'
      $ok=$body.ok -is [bool] -and $body.ok -eq $true
      if($Kind -in @('live','ready')){$ok=$ok -and $body.status -is [string] -and $body.status -ceq $Kind}
      [void](Get-ProcessRemaining $deadline)
      $probe.ok=$ok;if($ok){$probe.reason='none'}
      return $probe
    }finally{$cts.Dispose()}
  }catch{
    if($_.Exception.Message -eq 'process_deadline_exhausted'){$probe.reason='deadline'}
    elseif($_.Exception -is [OperationCanceledException] -or $_.Exception.InnerException -is [OperationCanceledException]){$probe.reason='timeout'}
    elseif($_.Exception.Message -eq 'health_body_too_large'){$probe.reason='body_limit'}
    return $probe
  }
  finally{$probe.elapsedMs=$clock.ElapsedMilliseconds;if($response){$response.Dispose()};$request.Dispose();$client.Dispose()}
}
function Get-WatchCoreDiagnostic($Value){
  if(-not $Value){return $null}
  $safe=@{probes=@{}}
  $elapsed=$Value.elapsedMs
  $safe.elapsedMs=if($elapsed -is [ValueType] -and $elapsed -isnot [bool] -and $elapsed -ge 0 -and $elapsed -le 3600000){$elapsed}else{$null}
  foreach($name in @('PostgreSQL','DjangoReader','DjangoWriter','ReaderReadiness','WriterReadiness','RuntimeAcl','RuntimeAclVerification')){
    $v=$Value.$name
    $safe[$name]=if($v -is [string] -and $v -cin @('running','stopped','not_ready','ready','foreign_or_unverified','foreign_port_owner','ownership_error','root_hardened','not_hardened','root_only_status')){$v}else{'unknown'}
  }
  foreach($name in @('reader','writer')){
    $v=$Value.probes.$name;if(-not $v){continue}
    $p=@{code=if($v.code -is [string] -and $v.code -cin @('none','http_status','transport_error','timeout')){$v.code}else{'unknown'}}
    foreach($field in @('statusCode','timeoutMs','elapsedMs')){$n=$v.$field;$p[$field]=if($n -is [ValueType] -and $n -isnot [bool] -and $n -ge 0 -and $n -le 3600000){$n}else{$null}}
    $safe.probes[$name]=$p
  }
  return $safe
}
function Get-WatchHealthDiagnostic($Value){
  if(-not $Value -or $Value.version -ne 1){return $null}
  $safe=@{version=1;probes=@{}}
  foreach($name in @('live','ready','helper')){
    $v=$Value.probes.$name;if(-not $v){continue}
    $p=@{}
    foreach($field in @('called','requested','passed','beforeDeadline')){$p[$field]=if($v.$field -is [bool]){$v.$field}else{$null}}
    foreach($field in @('statusCode','elapsedMs','timeoutMs','effectiveTimeoutMs')){
      $n=$v.$field;$p[$field]=if($n -is [ValueType] -and $n -isnot [bool] -and $n -ge 0 -and $n -le 3600000){$n}else{$null}
    }
    $p.errorKind=if($v.errorKind -is [string] -and $v.errorKind -cin @('none','not-called','http-error','invalid-json','predicate','backend-degraded','deadline','timeout','transport','body-limit','request-error')){$v.errorKind}else{'unknown'}
    $safe.probes[$name]=$p
  }
  return $safe
}
function Get-WatchProcessDiagnostic($Value){
  if(-not $Value){return $null}
  $safe=@{}
  foreach($name in @('processId','exitCode','deadlineUnixMs','elapsedMs','stdoutBytes','stderrBytes')){
    $v=$Value.$name;if($v -is [ValueType] -and $v -isnot [bool] -and [double]::IsFinite([double]$v)){$safe[$name]=$v}
  }
  $allowed=@{
    stage=@('spawn','direct-exit','output-snapshot','completed')
    code=@('completed','unknown','process_deadline_exhausted','nonzero_exit','invalid_result','process_output_limit','process_output_incomplete','process_exit_unavailable','process_transport_failed')
    timeoutType=@('spawn','direct-exit','output-snapshot','result-parse')
    outputProtocol=@('direct-exit-file-snapshot')
    cleanup=@('Direct','Preserve')
  }
  foreach($name in $allowed.Keys){
    $v=$Value.$name;if($v -is [string] -and $v -cin $allowed[$name]){$safe[$name]=$v}
  }
  return $safe
}
function Get-WatchSnapshot {
  $clock=[Diagnostics.Stopwatch]::StartNew()
  $admission=Get-Admission
  $snapshot=@{at=[DateTimeOffset]::UtcNow.ToString('o');admission=$admission;system='unprobed';backend='unprobed';worker='unprobed';supervisor='unprobed';supervisorHealth='unprobed';components=@{};ports=@();portsObservation=@{status='unknown';reason='not_checked'};probes=@{};stages=@{};healthy=$false;probeError=$false;processDiagnostic=$null}
  # Planned shutdown is quiet, and a corrupt gate must never be treated as permission.
  if($admission.mode -ne 'running'){return $snapshot}
  $savedDeadline=$env:TERUISI_PROCESS_DEADLINE_UNIX_MS
  $env:TERUISI_PROCESS_DEADLINE_UNIX_MS=[string](Get-ProcessDeadline 60000)
  try {
  $probeStage='control'
  $stageClock=[Diagnostics.Stopwatch]::StartNew()
  try{
    $status=Invoke-WatchScript $ControlPath @('-Action','Status','-Json')
    [void](Get-ProcessRemaining ([long]$env:TERUISI_PROCESS_DEADLINE_UNIX_MS))
    $snapshot.system=[string]$status.state;$snapshot.backend=[string]$status.backendState;$snapshot.worker=[string]$status.workerState
    foreach($name in @('core','finance','netshop','market','products','workflow','inventory','customerService','accessControl','erpReference','bi','ai')){
      $v=$status.components.$name;if($v -is [bool]){$snapshot.components[$name]=$v}
    }
    $snapshot.coreDiagnostics=Get-WatchCoreDiagnostic $status.coreDiagnostics
    $snapshot.controllerHealthEvidence=Get-WatchHealthDiagnostic $status.healthEvidence
    if($null -ne $status.healthEvidence){
      $snapshot.controllerHealthValid=($snapshot.controllerHealthEvidence -and $snapshot.controllerHealthEvidence.probes.Count -eq 3 -and @($snapshot.controllerHealthEvidence.probes.Values|Where-Object {$_.passed -ne $true}).Count -eq 0)
    }
    $snapshot.releaseId=[string]$status.releaseId;$snapshot.workerPid=$status.portProcessId;$snapshot.supervisorPid=$status.supervisorProcessId
    $snapshot.stages.control=@{status='completed';elapsedMs=$stageClock.ElapsedMilliseconds}
    $probeStage='supervisor'
    $stageClock.Restart()
    $supervisor=Invoke-WatchScript $SupervisorPath @('-Action','Status')
    [void](Get-ProcessRemaining ([long]$env:TERUISI_PROCESS_DEADLINE_UNIX_MS))
    $snapshot.supervisor=[string]$supervisor.supervisorProcess;$snapshot.supervisorHealth=[string]$supervisor.health
    $snapshot.stages.supervisor=@{status='completed';elapsedMs=$stageClock.ElapsedMilliseconds}
    $probeStage='monitor'
    $stageClock.Restart()
    $monitor=Read-WatchJson (Join-Path $BackendRoot 'monitoring\django-runtime\state.json')
    if(-not $monitor -or ([DateTimeOffset]::UtcNow-[DateTimeOffset]$monitor.updatedAt).TotalMinutes -gt 7){$snapshot.supervisorHealth='stale'}
    [void](Get-ProcessRemaining ([long]$env:TERUISI_PROCESS_DEADLINE_UNIX_MS))
    $snapshot.stages.monitor=@{status='completed';elapsedMs=$stageClock.ElapsedMilliseconds}
  }catch{
    $snapshot.probeError=$true
    $snapshot.stages[$probeStage]=@{status='failed';elapsedMs=$stageClock.ElapsedMilliseconds}
    $snapshot.processDiagnostic=@{stage=$probeStage;code=if($_.Exception.Message -eq 'process_deadline_exhausted'){'process_deadline_exhausted'}else{'probe_stage_failed'};process=Get-WatchProcessDiagnostic $_.Exception.Data['ProcessEvidence']}
  }
  foreach($kind in @('homepage','live','ready','helper')){
    if([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge [long]$env:TERUISI_PROCESS_DEADLINE_UNIX_MS){$snapshot.probes[$kind]=@{ok=$false;status=0;reason='snapshot_deadline'};continue}
    $url=switch($kind){homepage{'http://127.0.0.1:3000/'} helper{'http://127.0.0.1:5791/health'} default{"http://127.0.0.1:3000/_teruisi/local/health/$kind"}}
    $snapshot.probes[$kind]=Test-WatchHttp $url $kind
  }
  if([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt [long]$env:TERUISI_PROCESS_DEADLINE_UNIX_MS){
    $stageClock.Restart()
    try{
      $ports=@(Get-NetTCPConnection -State Listen -ErrorAction Stop|Where-Object LocalPort -in @(3000,5791,5432)|ForEach-Object {@{port=[int]$_.LocalPort;pid=[int]$_.OwningProcess}})
      [void](Get-ProcessRemaining ([long]$env:TERUISI_PROCESS_DEADLINE_UNIX_MS))
      $snapshot.ports=$ports;$snapshot.portsObservation=@{status='complete';reason='none';at=[DateTimeOffset]::UtcNow.ToString('o');elapsedMs=$stageClock.ElapsedMilliseconds}
    }catch{$snapshot.portsObservation=@{status='unknown';reason='ports_check_failed';elapsedMs=$stageClock.ElapsedMilliseconds}}
  }
  if([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge [long]$env:TERUISI_PROCESS_DEADLINE_UNIX_MS){
    $snapshot.probeError=$true;$snapshot.deadlineExceeded=$true
    if(-not $snapshot.processDiagnostic){$snapshot.processDiagnostic=@{stage='snapshot-final';code='process_deadline_exhausted';process=$null}}
  }
  $snapshot.completedAt=[DateTimeOffset]::UtcNow.ToString('o');$snapshot.elapsedMs=$clock.ElapsedMilliseconds
  $snapshot.healthy=(-not $snapshot.probeError -and ($snapshot.controllerHealthValid -ne $false) -and $snapshot.system -ceq 'Running' -and $snapshot.backend -ceq 'Ready' -and $snapshot.worker -ceq 'exact_release' -and $snapshot.supervisor -ceq 'running' -and $snapshot.supervisorHealth -ceq 'healthy' -and $snapshot.components.Count -eq 12 -and @($snapshot.components.Values|Where-Object {-not $_}).Count -eq 0 -and $snapshot.probes.Count -eq 4 -and @($snapshot.probes.Values|Where-Object {-not $_.ok}).Count -eq 0)
  return $snapshot
  } finally {$env:TERUISI_PROCESS_DEADLINE_UNIX_MS=$savedDeadline}
}
function Get-WatchBusinessHealth {
  # Passive reader telemetry only: never create a full ranking scan every minute.
  $path=Join-Path $WatchdogRoot 'business-health.json'
  $now=[DateTimeOffset]::UtcNow
  try {
    $cached=Read-WatchJson $path
    if($cached -and $cached.version -eq 'market-read-probe-v1' -and $cached.status -in @('healthy','degraded','observing','unknown') -and
        ($now-[DateTimeOffset]$cached.checkedAt).TotalSeconds -ge 0 -and
        ($now-[DateTimeOffset]$cached.checkedAt).TotalSeconds -lt 300){return $cached}
  }catch{$cached=$null}
  $result=@{version='market-read-probe-v1';checkedAt=$now.ToString('o');status='unknown';reason='no_recent_observation'}
  $handler=[Net.Http.HttpClientHandler]::new();$handler.UseProxy=$false;$handler.AllowAutoRedirect=$false
  $client=[Net.Http.HttpClient]::new($handler);$client.Timeout=[TimeSpan]::FromSeconds(3);$client.MaxResponseContentBufferSize=8192
  try {
    $response=$client.GetAsync('http://127.0.0.1:8031/api/market/health/reads').GetAwaiter().GetResult()
    try {
      if([int]$response.StatusCode -eq 404){$result.reason='reader_upgrade_required'}
      elseif([int]$response.StatusCode -ne 200){$result.reason='probe_unavailable'}
      else {
        $body=$response.Content.ReadAsStringAsync().GetAwaiter().GetResult()|ConvertFrom-Json
        if($body.version -cne 'market-read-health-v1' -or $body.status -notin @('healthy','degraded','observing','unknown')){throw 'business_probe_invalid'}
        $result.status=[string]$body.status
        $result.reason=if($body.status -eq 'degraded'){'market_queries_failing'}elseif($body.status -eq 'healthy'){'recent_reads_succeeded'}else{'no_confirmed_failure'}
      }
    }finally{$response.Dispose()}
  }catch{$result.reason='probe_unavailable'}finally{$client.Dispose()}
  Write-WatchJson $path $result
  return $result
}
function New-WatchState {
  @{version=$WatchdogVersion;failures=0;lastCheck=$null;lastHealthy=$null;incident=$null;attempts=@();lastMode='unknown';lastFence=$null;notification=$null}
}
function Get-WatchDecision($Snapshot,$State,[DateTimeOffset]$Now) {
  if($Snapshot.admission.mode -in @('maintenance','stopped')){return 'suspended'}
  if($Snapshot.healthy){return 'healthy'}
  if([int]$State.failures -lt 2){return 'confirm_failure'}
  if($Snapshot.admission.mode -ne 'running' -or $Snapshot.probeError -or $Snapshot.supervisor -in @('ownership_error','status_error') -or $Snapshot.worker -notin @('stopped','stale_or_invalid_receipt','exact_release')){return 'alert_only'}
  # Clean Worker Stop leaves the backend running: do not reverse that explicit action.
  if($Snapshot.worker -eq 'stopped' -and $Snapshot.backend -eq 'Ready'){return 'alert_only'}
  $recent=@($State.attempts|Where-Object {($Now-[DateTimeOffset]$_).TotalMinutes -lt 15})
  if($recent.Count -ge 3){return 'budget_exhausted'}
  if($recent.Count -gt 0 -and ($Now-[DateTimeOffset]$recent[-1]).TotalMinutes -lt 5){return 'cooldown'}
  if($Snapshot.worker -eq 'exact_release' -and $Snapshot.backend -eq 'Ready' -and $Snapshot.supervisor -eq 'running'){return 'alert_only'}
  return 'recover'
}
function Restore-WatchSupervisor {
  $name='Local\TERUISI-DjangoSales-'+([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($BackendRoot))).ToLowerInvariant()).Substring(0,24)
  $guard=[Threading.Mutex]::new($false,$name);$locked=$false
  try {
  try{$locked=$guard.WaitOne(0)}catch [Threading.AbandonedMutexException]{$locked=$true}
  if(-not $locked){throw 'django_lifecycle_busy'}
  $admission=Get-Admission;if($admission.mode -ne 'running'){throw 'supervisor_start_fenced'}
  $status=Invoke-WatchScript $SupervisorPath @('-Action','Status')
  if($status.supervisorProcess -eq 'running'){return}
  if($status.supervisorProcess -ne 'stopped'){throw 'supervisor_ownership_error'}
  $old=$env:PSModulePath
  try{
    $env:PSModulePath=[Environment]::GetEnvironmentVariable('PSModulePath','Machine')
    $id=[guid]::NewGuid().ToString('N')
    Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -WindowStyle Hidden -WorkingDirectory $BackendRoot -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$SupervisorPath,'-Action','Run','-Execute') -RedirectStandardOutput (Join-Path $WatchdogRoot "supervisor-$id.out.log") -RedirectStandardError (Join-Path $WatchdogRoot "supervisor-$id.err.log")|Out-Null
  }finally{$env:PSModulePath=$old}
  } finally {if($locked){$guard.ReleaseMutex()};$guard.Dispose()}
}
function Invoke-WatchRecovery([string]$ExpectedFence) {
  # Same OS thread holds the very same Worker mutex as Stop/Restart/EnterMaintenance.
  # Call the existing unique Start engine in library mode; no duplicate lifecycle implementation.
  & {
    param($Library,$Fence,$DesiredFile,$RestoreSupervisor)
    . $Library -FunctionsOnly -Action Status
    $lease=[Threading.Mutex]::new($false,(Get-WorkerServiceMutexName));$held=$false
    try{
      try{$held=$lease.WaitOne(0)}catch [Threading.AbandonedMutexException]{$held=$true}
      if(-not $held){throw 'lifecycle_busy'}
      Assert-WorkerMaintenanceInactive
      if((Get-FileHash -LiteralPath $DesiredFile).Hash.ToLowerInvariant() -cne $Fence){throw 'desired_state_changed'}
      $desired=Get-Content -LiteralPath $DesiredFile -Raw|ConvertFrom-Json
      if($desired.desiredState -cne 'running'){throw 'desired_state_stopped'}
      $identity=Get-ManifestIdentity (Get-CurrentManifestPath)
      $status=Get-WorkerStatusInternal $identity
      if($status.State -eq 'stale_or_invalid_receipt' -and $status.Receipt){
        # Reject reused PID even when both ports are empty; only absent owners are recoverable.
        if(Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$status.Receipt.supervisorPid)") {throw 'stale_pid_reused'}
      }
      [void](Invoke-WorkerSystemStart $identity)
      Assert-WorkerMaintenanceInactive
      & $RestoreSupervisor
    }finally{if($held){$lease.ReleaseMutex()};$lease.Dispose()}
  } $WorkerPath $ExpectedFence $DesiredPath ${function:Restore-WatchSupervisor}
}
function Get-WatchEvidence($Snapshot){
  $events=@()
  foreach($log in @('System','Application')){
    $filter=@{LogName=$log;StartTime=(Get-Date).AddMinutes(-20);Id=@(41,1074,6008,2004,1000,1001,1002)}
    $events+=@(Get-WinEvent -FilterHashtable $filter -MaxEvents 30 -ErrorAction SilentlyContinue|ForEach-Object {@{time=$_.TimeCreated.ToUniversalTime().ToString('o');id=$_.Id;provider=$_.ProviderName}})
  }
  $postgres=Get-ChildItem -LiteralPath (Join-Path $BackendRoot 'logs') -Filter 'postgresql-*.log' -File|Sort-Object LastWriteTime -Descending|Select-Object -First 1
  $recovery=@();if($postgres){$recovery=@(Get-Content -LiteralPath $postgres.FullName -Tail 160|Where-Object {$_ -match 'database system was interrupted|not properly shut down|redo done|ready to accept connections'}|ForEach-Object {($_ -split ' LOG: ',2)[0]+' '+ $(if($_ -match 'ready to accept'){'database_ready'}else{'database_recovery'})})}
  return @{snapshot=$Snapshot;events=$events;databaseRecovery=$recovery;capturedAt=[DateTimeOffset]::UtcNow.ToString('o')}
}
function Invoke-WatchDws([string[]]$Arguments){
  $result=Invoke-WatchProcess $DwsPath ($Arguments+@('--format','json','--timeout','15')) 25
  if($result.success -eq $false){throw 'dws_rejected'}
  return $result
}
function Get-WatchRecipient {
  $profiles=Invoke-WatchDws @('profile','list')
  $profile=@($profiles.profiles|Where-Object {$_.isCurrent -eq $true -and $_.corpName -ceq '佛山市登荣科技有限公司' -and $_.userName -ceq '邓伟章'})
  if($profile.Count -ne 1){throw 'owner_profile_ambiguous'}
  $binding=@('--profile',[string]$profile[0].profile)
  $self=Invoke-WatchDws (@('contact','user','get-self')+$binding)
  $rows=@($self.result);if($rows.Count -ne 1){throw 'owner_ambiguous'}
  $employee=$rows[0].orgEmployeeModel
  if($employee.userId -cne $profile[0].userId -or $employee.corpId -cne $profile[0].corpId -or $employee.orgUserName -cne '邓伟章'){throw 'owner_mismatch'}
  $search=Invoke-WatchDws (@('contact','user','search','--query','邓伟章')+$binding)
  $matches=@($search.result|Where-Object {$_.name -ceq '邓伟章'})
  if($matches.Count -ne 1 -or $matches[0].userId -cne $employee.userId){throw 'owner_search_ambiguous'}
  $bots=Invoke-WatchDws (@('chat','bot','search','--name','志高助手','--page','1','--size','30')+$binding)
  $exact=@($bots.robotList|Where-Object robotName -CEQ '志高助手')
  if(@($bots.robotList).Count -ge 30 -or $exact.Count -ne 1 -or -not $exact[0].robotCode){throw 'bot_ambiguous'}
  return @{profile=$profile[0].profile;user=$employee.userId;bot=$exact[0].robotCode}
}
function Get-WatchTimeText($Value){
  try{return ([DateTimeOffset]$Value).ToOffset([TimeSpan]::FromHours(8)).ToString('yyyy-MM-dd HH:mm:ss')}catch{return '时间未知'}
}
function Get-WatchPortText($Snapshot){
  return (@(3000,5791,5432)|ForEach-Object {
    $label=if(@($Snapshot.ports|Where-Object port -eq $_).Count -gt 0){'监听中'}elseif($Snapshot.portsObservation.status -ceq 'complete'){'未监听'}else{'未知（检查未完成）'}
    "$_=$label"
  }) -join '、'
}
function Get-WatchFailureText($Snapshot){
  $reasons=[Collections.Generic.List[string]]::new()
  if($Snapshot.probeError){
    $stage=switch($Snapshot.processDiagnostic.stage){control{'系统状态'} supervisor{'后端守护'} monitor{'守护状态文件'} default{'整轮监控'}}
    $process=$Snapshot.processDiagnostic.process
    $timeout=$Snapshot.deadlineExceeded -or $Snapshot.processDiagnostic.code -eq 'process_deadline_exhausted' -or $process.code -eq 'process_deadline_exhausted'
    $reasons.Add($(if($timeout){"${stage}检查超时，服务状态未完全确认"}else{"${stage}检查失败，服务状态未完全确认"}))
    $elapsed=$Snapshot.stages.($Snapshot.processDiagnostic.stage).elapsedMs
    if($elapsed -is [ValueType] -and $elapsed -isnot [bool] -and $elapsed -ge 0 -and $elapsed -le 3600000){$reasons.Add(('该阶段耗时约{0:F1}秒' -f ($elapsed/1000)))}
  }
  $names=@{core='核心后端';finance='财务';netshop='网店';market='市场';products='商品经营';workflow='运营事务';inventory='库存';customerService='客服';accessControl='权限';erpReference='ERP主数据';bi='BI';ai='AI'}
  $failed=@($names.Keys|Sort-Object|Where-Object {$Snapshot.components.$_ -is [bool] -and $Snapshot.components.$_ -eq $false}|ForEach-Object {$names[$_]})
  if($failed.Count){$reasons.Add('未就绪组件：'+($failed -join '、'))}
  if($Snapshot.components.core -eq $false -and $Snapshot.coreDiagnostics){
    $d=$Snapshot.coreDiagnostics
    foreach($name in @('PostgreSQL','DjangoReader','DjangoWriter','ReaderReadiness','WriterReadiness','RuntimeAcl')){
      $v=$d.$name;if($v -in @('not_ready','stopped','foreign_or_unverified','foreign_port_owner','ownership_error','not_hardened')){$reasons.Add("核心检查 $name=$v")}
    }
    foreach($name in @('reader','writer')){if($d.probes.$name.code -in @('timeout','http_status','transport_error')){$reasons.Add("核心 $name 探针：$($d.probes.$name.code)")}}
  }
  foreach($name in @('homepage','live','ready','helper')){
    $p=$Snapshot.probes.$name;if($p -and -not $p.ok){
      $label=switch($name){homepage{'首页'} live{'存活'} ready{'就绪'} helper{'辅助服务'}}
      if($p.reason -eq 'snapshot_deadline'){$reasons.Add("${label}未检查（整轮超时）")}
      elseif($p.reason -in @('timeout','deadline')){$reasons.Add("${label}探针超时")}
      elseif($p.reason -in @('invalid_json','body_limit','contract_error')){$reasons.Add("${label}健康响应格式不符合约定")}
      elseif($p.status -gt 0){$reasons.Add("${label}检查未通过（HTTP $($p.status)）")}
      else{$reasons.Add("${label}检查未通过或超时")}
    }
  }
  foreach($name in @('live','ready','helper')){
    $p=$Snapshot.controllerHealthEvidence.probes.$name
    if($p.called -eq $true -and $p.passed -eq $false){$reasons.Add("系统状态内 $name 探针未通过：$($p.errorKind)")}
  }
  if($Snapshot.supervisorHealth -eq 'stale'){$reasons.Add('后端守护状态超过7分钟未更新')}
  if($Snapshot.worker -in @('foreign_or_ambiguous','ownership_error','status_error')){$reasons.Add('网页服务进程归属或状态无法核验')}
  if($Snapshot.supervisor -in @('ownership_error','status_error')){$reasons.Add('后端守护进程归属或状态无法核验')}
  if($Snapshot.worker -eq 'starting_exact_release'){$reasons.Add('网页服务仍在启动，未重复启动')}
  if($Snapshot.business.status -eq 'degraded'){$reasons.Add('市场查询连续失败')}
  if($Snapshot.admission.mode -eq 'invalid'){$reasons.Add('启动配置或维护门禁无法验证')}
  if(-not $reasons.Count){$reasons.Add('健康条件未全部通过，具体原因待核实')}
  return ($reasons|Select-Object -First 8) -join '；'
}
function Get-WatchMessage($State,$Snapshot,[string]$Outcome){
  $time=Get-WatchTimeText $State.firstFailure
  $ports=Get-WatchPortText $Snapshot
  if($Outcome -eq 'recovered'){
    $completed=if($Snapshot.completedAt){$Snapshot.completedAt}else{$Snapshot.at}
    return "运营管理系统恢复提醒。故障首次发现：$time（北京时间）。恢复确认：$(Get-WatchTimeText $completed)。已通过两轮健康检查。首页/后端状态：$($Snapshot.system)/$($Snapshot.backend)。端口：$ports。需要人工处理：否。"
  }
  $label=switch($Outcome){recovery_failed{'自动恢复未通过'} budget_exhausted{'已达到本轮自动恢复次数上限'} cooldown{'等待下一次有间隔的安全恢复'} alert_only{'已告警，未自动重启'} default{'健康检查未通过'}}
  $action=if($Snapshot.probeError){'待确认；如持续出现，请检查本机控制面板及本次监控记录。'}else{'是；请检查上述失败项，并在本机控制面板确认当前状态。'}
  $checked=if($Snapshot.completedAt){$Snapshot.completedAt}else{$Snapshot.at}
  return "运营管理系统运行提醒。故障首次发现：$time（北京时间）。检查时间：$(Get-WatchTimeText $checked)。处理结果：$label。原因：$(Get-WatchFailureText $Snapshot)。首页/后端状态：$($Snapshot.system)/$($Snapshot.backend)。端口：$ports。需要人工处理：$action"
}
function Save-WatchFailureEvidence($State,$Snapshot){
  if(-not $State.incident -or $Snapshot.healthy){return}
  $evidence=Get-WatchEvidence $Snapshot
  $first=Join-Path $WatchdogRoot "evidence\$($State.incident)-first-failure.json"
  if(-not(Test-Path -LiteralPath $first)){Write-WatchJson $first $evidence}
  Write-WatchJson (Join-Path $WatchdogRoot "evidence\$($State.incident)-last-failure.json") $evidence
}
function Send-WatchAlert($State,$Snapshot,[string]$Outcome,[switch]$DryRun,[switch]$Recovery){
  $slot=if($Recovery){'recoveryNotification'}else{'notification'}
  $attemptSlot=if($Recovery){'recoveryIdentityAttempts'}else{'identityAttempts'}
  $timeSlot=if($Recovery){'lastRecoveryIdentityAttempt'}else{'lastIdentityAttempt'}
  $reasonSlot=if($Recovery){'recoveryNotificationReason'}else{'notificationReason'}
  if(-not $DryRun -and $State[$slot]){
    if($State[$slot] -ne 'identity_failed'){return}
    # Only pre-send failures are retryable. Reservation/unknown/sent stay terminal.
    if([int]$State[$attemptSlot] -ge 3){return}
    if($State[$timeSlot] -and ([DateTimeOffset]::UtcNow-[DateTimeOffset]$State[$timeSlot]).TotalMinutes -lt 15){return}
  }
  $suffix=if($Recovery){'-recovered'}else{''}
  $alertPath=Join-Path $WatchdogRoot "alerts\$($State.incident)$suffix.json"
  if(-not $DryRun){
    $previous=Read-WatchJson $alertPath
    if($previous -and $previous.status -in @('sending','sent','unknown')){$State[$slot]=$previous.status;return}
  }
  $alert=@{incident=$State.incident;at=[DateTimeOffset]::UtcNow.ToString('o');outcome=$Outcome;status='pending_identity';ports=$Snapshot.ports;businessData=$false}
  if(-not $DryRun){
    Write-WatchJson (Join-Path $WatchdogRoot "evidence\$($State.incident)$suffix-notification.json") (Get-WatchEvidence $Snapshot)
    Write-WatchJson $alertPath $alert
  }
  $stage='identity'
  try{
    if(-not $DryRun){$State[$attemptSlot]=[int]$State[$attemptSlot]+1;$State[$timeSlot]=[DateTimeOffset]::UtcNow.ToString('o');Write-WatchJson $StatePath $State}
    $recipient=Get-WatchRecipient
    $message=Get-WatchMessage $State $Snapshot $Outcome
    $arguments=@('chat','+messages-send','--as','bot','--profile',$recipient.profile,'--robot-code',$recipient.bot,'--users',$recipient.user,'--text',$message)
    if($DryRun){$preview=Invoke-WatchDws ($arguments+@('--dry-run'));if(-not $preview.dry_run -or $preview.executed){throw 'preview_invalid'};return @{status='dry_run_verified';executed=$false;targets=1}}
    # Persist BEFORE the non-idempotent remote call. Crashes/unknown delivery are never replayed.
    $alert.status='sending';Write-WatchJson $alertPath $alert
    $State[$slot]='sending';Write-WatchJson $StatePath $State
    $stage='delivery'
    $sent=Invoke-WatchDws ($arguments+@('--yes'))
    # Record only typed outcome metadata to diagnose CLI envelope drift later.
    # An unrecognized envelope still remains unknown; it is never guessed sent.
    $alert.deliveryEvidence=@{
      success=if($sent.success -is [bool]){$sent.success}else{$null}
      failedCount=if($sent.failedCount -is [ValueType] -and $sent.failedCount -isnot [bool] -and $sent.failedCount -ge 0 -and $sent.failedCount -le 30){$sent.failedCount}else{$null}
      executed=if($sent.executed -is [bool]){$sent.executed}else{$null}
      resultShape=if($sent.result -is [array]){'array'}elseif($sent.result -is [pscustomobject] -or $sent.result -is [Collections.IDictionary]){'object'}elseif($null -eq $sent.result){'absent'}else{'other'}
    }
    if($sent.success -isnot [bool] -or $sent.success -ne $true -or $sent.failedCount -gt 0){throw 'delivery_unconfirmed'}
    $alert.status='sent';$State[$slot]='sent';$State[$reasonSlot]=$null
  }catch{
    $alert.status=if($State[$slot] -eq 'sending'){'unknown'}else{'identity_failed'}
    $State[$slot]=$alert.status
    $known=@('owner_profile_ambiguous','owner_ambiguous','owner_mismatch','owner_search_ambiguous','bot_ambiguous','dws_rejected','operator_failed','probe_timeout','delivery_unconfirmed')
    $code=if($_.Exception.Message -cin $known){$_.Exception.Message}else{'preflight_failed'}
    $processDiagnostic=$_.Exception.Data['ProcessEvidence']
    if($processDiagnostic){$alert.processDiagnostic=Get-WatchProcessDiagnostic $processDiagnostic;if($alert.processDiagnostic.code){$code=$alert.processDiagnostic.code}}
    $alert.reason="$stage`:$code";$State[$reasonSlot]=$alert.reason
  }
  if(-not $DryRun){Write-WatchJson $alertPath $alert;Write-WatchJson $StatePath $State}
  elseif($alert.status -ne 'pending_identity'){throw 'notification_preflight_failed'}
}
function Invoke-WatchCycle([switch]$Recover){
  $previous=Read-WatchJson $StatePath
  $state=if($previous){$previous|ConvertTo-Json -Depth 10|ConvertFrom-Json -AsHashtable}else{New-WatchState}
  if($state.version -cne $WatchdogVersion){throw 'watchdog_state_invalid'}
  $snapshot=Get-WatchSnapshot;$now=[DateTimeOffset]::UtcNow
  if($snapshot.admission.mode -eq 'running'){
    $snapshot.business=Get-WatchBusinessHealth
    if($snapshot.business.status -eq 'degraded'){$state.marketFailureOpen=$true}
    elseif($snapshot.business.status -eq 'healthy'){$state.marketFailureOpen=$false}
    elseif($state.marketFailureOpen){$snapshot.business=@{status='degraded';reason='awaiting_successful_reads';checkedAt=$now.ToString('o')}}
    if($snapshot.business.status -eq 'degraded'){$snapshot.healthy=$false}
  }
  $state.lastCheck=$now.ToString('o')
  if($snapshot.admission.mode -in @('stopped','maintenance')){
    $state.failures=0;$state.lastMode=$snapshot.admission.mode;$state.lastFence=$snapshot.admission.fence
    Write-WatchJson $StatePath $state;return @{status='suspended';serviceChanged=$false}
  }
  if(-not $snapshot.healthy){
    if(-not $state.incident){
      $state.incident=[guid]::NewGuid().ToString('N');$state.firstFailure=$now.ToString('o');$state.notification=$null
      $state.recoveryNotification=$null;$state.recoveryIdentityAttempts=0;$state.lastRecoveryIdentityAttempt=$null;$state.recoveryNotificationReason=$null
      $state.recoveryAttempt=$null
    }
    $state.failures=[int]$state.failures+1
    Save-WatchFailureEvidence $state $snapshot
  }
  $decision=Get-WatchDecision $snapshot $state $now
  # First installation, maintenance exit, a new explicit Start or a recovered incident requires two healthy snapshots.
  if($snapshot.healthy -and ($state.incident -or $state.lastMode -ne 'running' -or $state.lastFence -ne $snapshot.admission.fence)){
    Start-Sleep -Seconds 5;$second=Get-WatchSnapshot
    $second.business=$snapshot.business
    if($second.business -and $second.business.status -eq 'degraded'){$second.healthy=$false}
    if(-not $second.healthy -or $second.admission.fence -ne $snapshot.admission.fence){
      $snapshot=$second;$decision='verification_pending'
      Save-WatchFailureEvidence $state $snapshot
    }else{$snapshot=$second}
  }
  if($decision -eq 'recover' -and $Recover){
    $state.attempts=@($state.attempts|Where-Object {($now-[DateTimeOffset]$_).TotalMinutes -lt 15})+@($now.ToString('o'))
    Write-WatchJson $StatePath $state
    Write-WatchJson (Join-Path $WatchdogRoot "evidence\$($state.incident)-before.json") (Get-WatchEvidence $snapshot)
    try{
      $state.recoveryAttempt=@{at=$now.ToString('o');status='started';code=$null}
      Write-WatchJson $StatePath $state
      Invoke-WatchRecovery $snapshot.admission.fence
      $first=Get-WatchSnapshot;Start-Sleep -Seconds 5;$second=Get-WatchSnapshot
      $first.business=$snapshot.business;$second.business=$snapshot.business
      if($snapshot.business -and $snapshot.business.status -eq 'degraded'){$first.healthy=$false;$second.healthy=$false}
      if($first.healthy -and $second.healthy -and $first.admission.fence -eq $snapshot.admission.fence -and $second.admission.fence -eq $snapshot.admission.fence){$decision='recovered'}else{$decision='recovery_failed'}
      $state.recoveryAttempt.status=$decision;$state.recoveryAttempt.code=if($decision -eq 'recovery_failed'){'post_recovery_checks_failed'}else{$null}
      $snapshot=$second
    }catch{
      $decision='recovery_failed'
      $known=@('lifecycle_busy','desired_state_changed','desired_state_stopped','stale_pid_reused','django_lifecycle_busy','supervisor_start_fenced','supervisor_ownership_error','maintenance_active','process_deadline_exhausted')
      $state.recoveryAttempt=@{at=$now.ToString('o');status='recovery_failed';code=if($_.Exception.Message -cin $known){$_.Exception.Message}else{'recovery_operation_failed'};process=Get-WatchProcessDiagnostic $_.Exception.Data['ProcessEvidence']}
    }
    Write-WatchJson (Join-Path $WatchdogRoot "evidence\$($state.incident)-recovery-attempt.json") $state.recoveryAttempt
    Save-WatchFailureEvidence $state $snapshot
  }
  if($state.incident){
    Write-WatchJson (Join-Path $WatchdogRoot "evidence\$($state.incident)-latest.json") (Get-WatchEvidence $snapshot)
    if($Recover -and [int]$state.failures -ge 2 -and $decision -notin @('confirm_failure','verification_pending','healthy')){Send-WatchAlert $state $snapshot $decision}
    if($decision -eq 'healthy'){
      Write-WatchJson (Join-Path $WatchdogRoot "evidence\$($state.incident)-recovery-confirmed.json") (Get-WatchEvidence $snapshot)
      # A recovery is a new fact, not a replay of an ambiguous failure message.
      # Only incidents whose failure message may have reached the user need it.
      if($Recover -and $state.notification -in @('sent','sending','unknown')){Send-WatchAlert $state $snapshot 'recovered' -Recovery}
    }
  }
  if($decision -in @('healthy','recovered')){$state.failures=0;$state.lastHealthy=[DateTimeOffset]::UtcNow.ToString('o');$state.incident=$null;$state.notification=$null;$state.notificationReason=$null;$state.identityAttempts=0;$state.lastIdentityAttempt=$null}
  $state.lastMode=if($decision -eq 'verification_pending'){'verification_pending'}else{'running'}
  $state.lastFence=$snapshot.admission.fence;$state.decision=$decision
  Write-WatchJson $StatePath $state
  Write-WatchJson (Join-Path $WatchdogRoot 'latest.json') $snapshot
  return @{status=$decision;serviceChanged=($decision -eq 'recovered');checkedAt=$snapshot.at}
}
function Install-Watchdog {
  if(-not $Execute){throw 'Install requires Execute'}
  $root=[IO.Path]::GetFullPath($WatchdogRoot)
  if($root -cne 'D:\teruisi-runtime\operations-watchdog'){throw 'invalid_install_root'}
  New-Item -ItemType Directory -Path $root -Force|Out-Null
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner($sid)
  foreach($s in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'),[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($s,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}
  $existingAcl=Get-Acl -LiteralPath $root
  $allowedSids=@($sid.Value,'S-1-5-18','S-1-5-32-544')
  $unexpected=@($existingAcl.Access|Where-Object {$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowedSids})
  if(-not $existingAcl.AreAccessRulesProtected -or $unexpected.Count -gt 0){Set-Acl -LiteralPath $root -AclObject $acl}
  $verifiedAcl=Get-Acl -LiteralPath $root
  if(-not $verifiedAcl.AreAccessRulesProtected -or @($verifiedAcl.Access|Where-Object {$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowedSids}).Count -gt 0){throw 'installation_acl_invalid'}
  $target=Join-Path $root 'operations-system-watchdog.ps1'
  Copy-Item -LiteralPath $PSCommandPath -Destination $target -Force
  if((Get-WatchHash $target) -cne (Get-WatchHash $PSCommandPath)){throw 'installation_hash_mismatch'}
  $transportSource=Join-Path $PSScriptRoot 'process-deadline.ps1'
  $transportTarget=Join-Path $root 'process-deadline.ps1'
  Copy-Item -LiteralPath $transportSource -Destination $transportTarget -Force
  if((Get-WatchHash $transportSource) -cne (Get-WatchHash $transportTarget)){throw 'transport_installation_hash_mismatch'}
  $launcherSource=Join-Path $PSScriptRoot 'watchdog-launcher\NoConsoleLauncher.cs'
  $launcherSourceHash=Get-WatchHash $launcherSource
  $launcher=Join-Path $root ("Watchdog.NoConsole-"+$launcherSourceHash.Substring(0,16)+'.exe')
  if(-not(Test-Path -LiteralPath $launcher)){
    $compiler=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    & $compiler /nologo /target:winexe /platform:anycpu /optimize+ "/out:$launcher" $launcherSource
    if($LASTEXITCODE -ne 0){throw 'watchdog_launcher_compile_failed'}
  }
  $config=@{version=$WatchdogVersion;scriptSha256=Get-WatchHash $target;transportSha256=Get-WatchHash $transportTarget;launcherSourceSha256=$launcherSourceHash;launcherSha256=Get-WatchHash $launcher;installedAt=[DateTimeOffset]::UtcNow.ToString('o')}
  Write-WatchJson (Join-Path $root 'installation.json') $config
  $taskAction=New-ScheduledTaskAction -Execute $launcher -WorkingDirectory $root -Argument "`"$PowerShellPath`" `"$target`""
  $user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
  $triggers=@((New-ScheduledTaskTrigger -AtLogOn -User $user),(New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)))
  $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
  $principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $existing=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if($existing){
    $expectedLegacy="-NoProfile -NonInteractive -WindowStyle Hidden -File `"$target`" -Action Check -Execute"
    $knownLegacy=$existing.Actions.Execute -ceq $PowerShellPath -and $existing.Actions.Arguments -ceq $expectedLegacy
    $knownLauncher=$existing.Actions.Execute -ceq $launcher -and $existing.Actions.Arguments -ceq $taskAction.Arguments
    if(@($existing.Actions).Count -ne 1 -or -not($knownLegacy -or $knownLauncher) -or $existing.Actions.WorkingDirectory -cne $root){throw 'unrecognized_watchdog_task_action'}
    if($existing.State -eq 'Running'){throw 'wait_for_existing_watchdog_check_to_finish'}
    Set-ScheduledTask -TaskName $TaskName -Action $taskAction -ErrorAction Stop|Out-Null
    Enable-ScheduledTask -TaskName $TaskName -ErrorAction Stop|Out-Null
  }else{
    Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $triggers -Settings $settings -Principal $principal -ErrorAction Stop|Out-Null
  }
  $task=Get-ScheduledTask -TaskName $TaskName
  if($task.Actions.Execute -cne $launcher -or $task.Actions.Arguments -cne $taskAction.Arguments -or $task.Triggers.Count -ne 2 -or $task.Triggers[1].Repetition.Interval -ne 'PT1M'){throw 'task_readback_mismatch'}
  Start-ScheduledTask -TaskName $TaskName
  return @{status='installed';cadence='independent_minutely_and_logon';task=$TaskName}
}
if($FunctionsOnly){return}
$env:PATH=(Split-Path $PowerShellPath)+[IO.Path]::PathSeparator+$env:PATH
if($Action -eq 'Install'){Install-Watchdog|ConvertTo-Json -Compress;return}
if($Action -eq 'Status'){@{task=[string](Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).State;state=Read-WatchJson $StatePath}|ConvertTo-Json -Depth 8;return}
if(-not(Test-Path -LiteralPath $WatchdogRoot)){New-Item -ItemType Directory -Path $WatchdogRoot|Out-Null}
$mutex=[Threading.Mutex]::new($false,'Local\TERUISI.Operations.Watchdog.v2');$held=$false
try{
  try{$held=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$held=$true}
  if(-not $held){@{status='busy'}|ConvertTo-Json;return}
  if($Action -eq 'TestNotification'){Send-WatchAlert @{incident='preview';firstFailure='preview';notification=$null} @{system='preview';backend='preview';ports=@()} 'preview' -DryRun|ConvertTo-Json -Compress;return}
  if($Execute){
    $installation=Read-WatchJson (Join-Path $WatchdogRoot 'installation.json')
    if(-not $installation -or $installation.scriptSha256 -cne (Get-WatchHash $PSCommandPath) -or $installation.transportSha256 -cne (Get-WatchHash (Join-Path $PSScriptRoot 'process-deadline.ps1'))){throw 'installed_watchdog_binding_invalid'}
  }
  Invoke-WatchCycle -Recover:$Execute|ConvertTo-Json -Compress
}finally{if($held){$mutex.ReleaseMutex()};$mutex.Dispose()}
