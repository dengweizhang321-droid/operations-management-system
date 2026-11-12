#requires -Version 7.0
[CmdletBinding()]
param(
  [ValidateSet('Check','PlanInstall','Install','Status','TestNotification')][string]$Action='Check',
  [switch]$Execute,
  [switch]$FunctionsOnly,
  [string]$ApprovedInstallPlanId='',
  [string]$PreparedLauncherPath='',
  [string]$PreparedLauncherSha256='',
  [string]$RequalifyDriftedAssets=''
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'process-deadline.ps1')
. (Join-Path $PSScriptRoot 'watchdog-install.ps1')
. (Join-Path $PSScriptRoot 'watchdog-driver-closure.ps1')
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
function Get-WatchSanitizedStderrSummary([string]$Value){
  # Bounded, best-effort evidence for a failed probe/dws process. Never trust
  # this as structured data: it is free text, kept only as a short, redacted
  # hint of what failed. First 200 characters, then strip anything shaped
  # like a filesystem path, a URL, or a credential/token so a leaked secret
  # or local path never reaches stored evidence or an alert message.
  if([string]::IsNullOrEmpty($Value)){return $null}
  $text=$Value.Substring(0,[Math]::Min(200,$Value.Length))
  # URL first: a URL's scheme (e.g. "https:") would otherwise also satisfy
  # the single-letter-drive path pattern below ("s:" followed by "//...").
  $text=[regex]::Replace($text,'(?i)\b[a-z][a-z0-9+.-]*://[^\s"'']*','[url]')
  $text=[regex]::Replace($text,'(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'']*','[path]')
  $text=[regex]::Replace($text,'(?:\\\\|//)[^\s"'']+','[path]')
  # "Authorization: <scheme> <value>" or "Authorization: <value>": redact the
  # whole remainder (scheme word included), not just the first token after
  # the colon - a credential value never stops at the scheme name.
  $text=[regex]::Replace($text,'(?i)(authorization)\s*:\s*(?:[a-z0-9._-]+\s+)?\S+','$1=[redacted]')
  # A standalone "Bearer <token>" not already consumed above (e.g. no
  # leading "Authorization:" label) must still redact the token.
  $text=[regex]::Replace($text,'(?i)\bbearer\s+\S+','bearer=[redacted]')
  # Credential-shaped "<name>: <value>" / "<name>=<value>". The leading
  # "\b" only guards the start of this alternation group, not each
  # alternative's own start: that lets a compound identifier like
  # "refresh_token", "client_secret" or "access_token" match on its
  # keyword suffix even though "_" has no word-boundary before it, while
  # still requiring a real word boundary before the whole credential-ish
  # run (so this never fires mid-word on unrelated text).
  $text=[regex]::Replace($text,'(?i)\b[a-z0-9_-]*?(?:token|secret|password|credential|apikey|api[_-]?key|private[_-]?key|session|cookie)\s*[:=]\s*\S+','[redacted]')
  $text=[regex]::Replace($text,'[0-9a-fA-F]{24,}','[redacted]')
  return $text.Trim()
}
function Invoke-WatchProcess([string]$Executable,[string[]]$Arguments,[int]$Seconds=60) {
  # Only direct probe ownership is admitted. DWS unknown delivery is terminal.
  $capture=Invoke-DeadlineProcess -Executable $Executable -Arguments $Arguments -WorkingDirectory $WatchdogRoot -Deadline (Get-ProcessDeadline ($Seconds*1000)) -Cleanup Direct
  $evidence=$capture.Evidence
  $evidence.stage='result-parse'
  try {
    if($capture.ExitCode -ne 0){
      $evidence.code='nonzero_exit'
      $evidence.stderrSummary=Get-WatchSanitizedStderrSummary $capture.Stderr
      throw 'operator_failed'
    }
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
function Invoke-WatchScript([string]$Path,[string[]]$Arguments,[int]$Seconds=60){
  Invoke-WatchProcess $PowerShellPath (@('-NoProfile','-NonInteractive','-File',$Path)+$Arguments) $Seconds
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
function Test-WatchHttp([string]$Url,[string]$Kind,$Pending){
  $clock=if($Pending){$Pending.clock}else{[Diagnostics.Stopwatch]::StartNew()}
  $probe=@{ok=$false;status=0;reason='transport_error';elapsedMs=0}
  if($Pending){$client=$Pending.client;$request=$Pending.request}else{
    $handler=[Net.Http.HttpClientHandler]::new();$handler.UseProxy=$false;$handler.AllowAutoRedirect=$false
    $client=[Net.Http.HttpClient]::new($handler)
    $request=[Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get,$Url)
  }
  $response=$null
  try{
    if($Pending){$deadline=$Pending.deadline;$response=$Pending.task.GetAwaiter().GetResult()}else{
      $deadline=Get-ProcessDeadline $(if($Kind -eq 'ready'){20000}else{5000});$client.Timeout=[TimeSpan]::FromMilliseconds((Get-ProcessRemaining $deadline))
      [void]$request.Headers.TryAddWithoutValidation('x-teruisi-local-health','1')
      $response=$client.SendAsync($request,[Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    }
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
function Get-WatchHttpProbes($Urls){
  if(-not ('Teruisi.WatchResponseCleanup' -as [type])){
    Add-Type -TypeDefinition 'namespace Teruisi { public static class WatchResponseCleanup { public static void Observe(System.Threading.Tasks.Task<System.Net.Http.HttpResponseMessage> task) { task.ContinueWith(t => { if(t.Status == System.Threading.Tasks.TaskStatus.RanToCompletion) t.Result.Dispose(); else if(t.IsFaulted) { var ignored = t.Exception; } }, System.Threading.CancellationToken.None, System.Threading.Tasks.TaskContinuationOptions.ExecuteSynchronously, System.Threading.Tasks.TaskScheduler.Default); } } }'
  }
  $result=@{};$pending=[Collections.Generic.List[object]]::new()
  try{
    foreach($name in @('homepage','live','ready','helper')){
      # Independent HTTP budgets still inherit the one 120s snapshot deadline.
      $deadline=Get-ProcessDeadline $(if($name -eq 'ready'){20000}else{5000})
      if([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $deadline){$result[$name]=@{ok=$false;status=0;reason='snapshot_deadline';elapsedMs=0};continue}
      $handler=[Net.Http.HttpClientHandler]::new();$handler.UseProxy=$false;$handler.AllowAutoRedirect=$false
      $client=[Net.Http.HttpClient]::new($handler);$request=[Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get,$Urls[$name])
      $job=@{name=$name;client=$client;request=$request;clock=[Diagnostics.Stopwatch]::StartNew();deadline=$deadline;task=$null;consumed=$false}
      $pending.Add($job)
      $client.Timeout=[TimeSpan]::FromMilliseconds((Get-ProcessRemaining $deadline))
      [void]$request.Headers.TryAddWithoutValidation('x-teruisi-local-health','1')
      $job.task=$client.SendAsync($request,[Net.Http.HttpCompletionOption]::ResponseHeadersRead)
    }
    while(@($pending|Where-Object {-not $_.consumed}).Count){
      $jobs=@($pending|Where-Object {-not $_.consumed})
      $completed=[Threading.Tasks.Task]::WhenAny([Threading.Tasks.Task[]]@($jobs|ForEach-Object {$_.task})).GetAwaiter().GetResult()
      $job=$jobs|Where-Object {[object]::ReferenceEquals($_.task,$completed)}|Select-Object -First 1
      $result[$job.name]=Test-WatchHttp $Urls[$job.name] $job.name $job;$job.consumed=$true
    }
  }catch{
    foreach($name in @('homepage','live','ready','helper')){if(-not $result.ContainsKey($name)){$result[$name]=@{ok=$false;status=0;reason='snapshot_deadline';elapsedMs=0}}}
  }finally{
    foreach($job in $pending){
      if(-not $job.consumed){
        $job.client.CancelPendingRequests()
        if($job.task){[Teruisi.WatchResponseCleanup]::Observe($job.task)}
        $job.request.Dispose();$job.client.Dispose()
      }
    }
  }
  return $result
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
  # stderrSummary is free text, not an enum: it was already bounded to 200
  # characters and redacted by Get-WatchSanitizedStderrSummary at capture
  # time. Re-cap the length defensively here too, since this function is the
  # one boundary all process evidence crosses before it can reach stored
  # evidence or an outgoing alert message.
  $summary=$Value.stderrSummary
  if($summary -is [string] -and $summary.Length -gt 0 -and $summary.Length -le 200){$safe.stderrSummary=$summary}
  return $safe
}
function Get-WatchBindingDiagnostic([string]$Code,$Value){
  # Only fixed asset names are recorded. No file paths or hashes leave this function.
  $codes=@('diagnostic_predecessor_changed','invalid_diagnostic_binding','diagnostic_driver_incomplete','invalid_diagnostic_bundle','diagnostic_regeneration_rejected','diagnostic_generator_unavailable','diagnostic_sources_changing')
  if($Code -cnotin $codes){return $null}
  $assets=@(@($Value.assets)|Where-Object {$_ -is [string] -and $_ -cin @('control','worker','backend','transport','supervisor','isolation','backendIsolation')}|Sort-Object -Unique)
  $result=@{valid=$false;code=$Code;assets=$assets;requiresRequalification=($Code -cnotin @('diagnostic_sources_changing','diagnostic_generator_unavailable'))}
  # A fixed-enum reason only; anything else is dropped.
  $reason=[string]$Value.reason
  if($reason -and $reason -cin (@($WatchDriverRejectionReasons)+@($WatchDriverUnavailableReasons))){$result.reason=$reason}
  return $result
}
# ---- Automatic read-only driver regeneration (docs/watchdog-root-fix-20261112/DESIGN.md) ----
# The diagnostic driver is a generated copy of the production status path, pinned to the exact
# bytes of the pinned sources. After any merge or Django release those bytes change; instead of
# going blind until a human requalifies the driver, this watchdog regenerates it with the
# generator suite that was reviewed and frozen into this installation, and refuses (fail closed,
# alert) whenever the generator proof, the transitive closure check or the call list check fails.
$WatchGeneratorSuite=@('prepare-watchdog-status-driver.mjs','prepare-watchdog-native-status-driver.mjs','prepare-watchdog-supervisor-status-driver.mjs','watchdog-native-metadata.ps1','watchdog-driver-generate.mjs','watchdog-driver-closure.ps1')
$WatchDriverFiles=@('watchdog-status-control.ps1','watchdog-status-backend.ps1','watchdog-core-overlay.ps1','driver-binding.json','native-isolation.ps1','process-deadline.ps1')
$WatchDriverRejectionReasons=@('source_shape_changed','original_predicate_changed','unexpected_relative_dependency','capability_marker_missing','closure_forbidden_primitive','ownership_unlisted_command','ownership_function_missing','ownership_dynamic_call','closure_parse_failed','closure_analysis_failed','closure_entry_missing','generated_script_unparsable')
$WatchDriverUnavailableReasons=@('node_missing','generator_timeout','generator_failed','generator_output_invalid','source_unreadable','staging_failed','binding_mismatch')
$script:WatchDriverDirectory=$null
$script:WatchNodePathOverride=$null
function Get-WatchDriversRoot {Join-Path $WatchdogRoot 'drivers'}
function Test-WatchDriverLayout {
  # The generator suite is part of the installed bundle. Without it (an old flat or
  # pre-generator layout) the driver stays whatever the installer put beside the script.
  return @($WatchGeneratorSuite|Where-Object {Test-Path -LiteralPath (Join-Path $PSScriptRoot $_) -PathType Leaf}).Count -eq $WatchGeneratorSuite.Count
}
function Get-WatchDriverSources {
  # Fixed paths, no external input. The main checkout files are the Worker rotation's protected
  # entry points: the bytes production is using, so following them is correct.
  return [ordered]@{
    control=$ControlPath;worker=$WorkerPath
    transport=(Join-Path $ProjectRoot 'tools\process-deadline.ps1')
    isolation=(Join-Path $ProjectRoot 'tools\native-isolation.ps1')
    backendIsolation=(Join-Path $BackendRoot 'app\tools\native-isolation.ps1')
    backend=(Join-Path $BackendRoot 'app\tools\django-local-service.ps1')
    supervisor=$SupervisorPath
  }
}
function New-WatchDriverFailure([string]$Code,[string]$Reason='') {
  # Carries a fixed-enum reason only: never a path or a hash.
  $failure=[Exception]::new($Code)
  $failure.Data['DiagnosticBinding']=@{code=$Code;assets=@();reason=$Reason}
  return $failure
}
function Get-WatchSourceHash([string]$Path) {
  $item=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if($item.PSIsContainer -or $item.Length -gt 16777216 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'source_unreadable'}
  return Get-WatchHash $Path
}
function Get-WatchDriverDigest($SourceHashes,$SuiteHashes) {
  $lines=@('layout=1')+@($SourceHashes.Keys|Sort-Object|ForEach-Object {'source:'+$_+'='+$SourceHashes[$_]})+@($SuiteHashes.Keys|Sort-Object|ForEach-Object {'suite:'+$_+'='+$SuiteHashes[$_]})
  return Get-WatchTextHash ($lines -join "`n")
}
function Get-WatchNodeCandidatePath {'C:\Program Files\nodejs\node.exe'}
function Resolve-WatchNodePath([string]$Candidate) {
  # One resolver for install admission and runtime: the fixed location, present, not a reparse point.
  if([string]::IsNullOrWhiteSpace($Candidate) -or [IO.Path]::GetFullPath($Candidate) -ine [IO.Path]::GetFullPath((Get-WatchNodeCandidatePath))){throw 'node_missing'}
  $item=Get-Item -LiteralPath $Candidate -Force -ErrorAction Stop
  if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'node_missing'}
  return [IO.Path]::GetFullPath($Candidate)
}
function Get-WatchNodePath {
  try{
    $candidate=if($script:WatchNodePathOverride){$script:WatchNodePathOverride}else{[string](Read-WatchJson (Join-Path $WatchdogRoot 'installation.json')).nodePath}
    return Resolve-WatchNodePath $candidate
  }catch{throw (New-WatchDriverFailure 'diagnostic_generator_unavailable' 'node_missing')}
}
function Remove-WatchContainedTree([string]$Root,[string]$Path) {
  # Best-effort removal strictly inside $Root; a reparse point at the top is never followed.
  try{
    Assert-WatchContainedDirectory $Root $Path
    if(-not(Test-Path -LiteralPath $Path)){return}
    $item=Get-Item -LiteralPath $Path -Force
    if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){return}
    if($item.PSIsContainer){[IO.Directory]::Delete($Path,$true)}else{[IO.File]::Delete($Path)}
  }catch{}
}
function Remove-WatchStaleDrivers([string]$Root,[string]$KeepDigest) {
  # Keep the driver in use and the 4 most recent others; abandoned staging older than an hour and
  # old rejection records go too. Cleanup never fails the snapshot.
  try{
    $others=@(Get-ChildItem -LiteralPath $Root -Directory -Force|Where-Object {$_.Name -cmatch '^[0-9a-f]{64}$' -and $_.Name -cne $KeepDigest}|Sort-Object LastWriteTimeUtc -Descending)
    foreach($directory in @($others|Select-Object -Skip 4)){Remove-WatchContainedTree $Root $directory.FullName}
    foreach($directory in @(Get-ChildItem -LiteralPath $Root -Directory -Force|Where-Object {$_.Name -cmatch '^\.staging-[0-9a-f]{32}$' -and ([DateTime]::UtcNow-$_.LastWriteTimeUtc).TotalHours -ge 1})){Remove-WatchContainedTree $Root $directory.FullName}
    $records=@(Get-ChildItem -LiteralPath $Root -File -Force|Where-Object {$_.Name -cmatch '^rejected-[0-9a-f]{64}\.json$'}|Sort-Object LastWriteTimeUtc -Descending)
    foreach($record in @($records|Select-Object -Skip 8)){Remove-WatchContainedTree $Root $record.FullName}
  }catch{}
}
function Test-WatchDriverDirectory([string]$Directory,[string]$Digest) {
  # An existing directory is used only when it is exactly what generation wrote. A damaged one is
  # reported, never silently deleted or repaired.
  try{
    Assert-WatchContainedDirectory (Get-WatchDriversRoot) $Directory
    $manifest=Read-WatchJson (Join-Path $Directory 'driver-manifest.json')
    if(-not $manifest -or $manifest.version -ne 1 -or $manifest.digest -cne $Digest){throw 'invalid_diagnostic_bundle'}
    $expected=@($WatchDriverFiles)+@('driver-manifest.json')
    $entries=@(Get-ChildItem -LiteralPath $Directory -Force)
    if($entries.Count -ne $expected.Count -or @($entries|Where-Object {$_.Name -cnotin $expected -or $_.PSIsContainer -or ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)}).Count){throw 'invalid_diagnostic_bundle'}
    foreach($name in $WatchDriverFiles){if((Get-WatchHash (Join-Path $Directory $name)) -cne [string]$manifest.files.$name){throw 'invalid_diagnostic_bundle'}}
    return $true
  }catch{throw (New-WatchDriverFailure 'invalid_diagnostic_bundle')}
}
function Get-WatchDriverRejection([string]$Digest) {
  $path=Join-Path (Get-WatchDriversRoot) "rejected-$Digest.json"
  if(-not(Test-Path -LiteralPath $path -PathType Leaf)){return $null}
  try{$record=Read-WatchJson $path}catch{return $null}
  if($record -and $record.version -eq 1 -and $record.digest -ceq $Digest -and [string]$record.reason -cin $WatchDriverRejectionReasons){return [string]$record.reason}
  return $null
}
function Set-WatchDriverRejection([string]$Root,[string]$Digest,[string]$Reason) {
  # Only structured proof failures reach here: a transient failure must be retried, not cached.
  Write-WatchJson (Join-Path $Root "rejected-$Digest.json") @{version=1;digest=$Digest;reason=$Reason;at=[DateTimeOffset]::UtcNow.ToString('o')}
  throw (New-WatchDriverFailure 'diagnostic_regeneration_rejected' $Reason)
}
function New-WatchDriver([string]$Root,[string]$Digest,$Sources,$SourceHashes) {
  $node=Get-WatchNodePath
  $staging=Join-Path $Root ('.staging-'+[guid]::NewGuid().ToString('N'))
  Assert-WatchContainedDirectory $WatchdogRoot $staging
  try{
    # 1. Freeze: the bytes that are hashed, generated from and pinned are one set of copies.
    try{
      [void][IO.Directory]::CreateDirectory((Join-Path $staging 'sources'))
      foreach($name in $Sources.Keys){
        $copy=Join-Path $staging ('sources\'+$name+'.ps1')
        [IO.File]::Copy($Sources[$name],$copy)
        if((Get-WatchHash $copy) -cne $SourceHashes[$name]){throw (New-WatchDriverFailure 'diagnostic_sources_changing')}
      }
    }catch{
      if($_.Exception.Message -ceq 'diagnostic_sources_changing'){throw}
      throw (New-WatchDriverFailure 'diagnostic_generator_unavailable' 'staging_failed')
    }
    # 2. Generate with the frozen suite, through the direct-exit transport (no pipe, no background process).
    $request=@{outputDirectory=(Join-Path $staging 'driver');readDirectory=(Join-Path $staging 'sources');bound=@{}}
    foreach($name in $Sources.Keys){$request.bound[$name]=[string]$Sources[$name]}
    $requestPath=Join-Path $staging 'request.json'
    [IO.File]::WriteAllText($requestPath,($request|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
    try{
      $capture=Invoke-DeadlineProcess -Executable $node -Arguments @((Join-Path $PSScriptRoot 'watchdog-driver-generate.mjs'),$requestPath) -WorkingDirectory $staging -Deadline (Get-ProcessDeadline 30000) -Cleanup Direct
    }catch{
      $evidence=$_.Exception.Data['ProcessEvidence']
      throw (New-WatchDriverFailure 'diagnostic_generator_unavailable' $(if($evidence -and $evidence.code -ceq 'process_deadline_exhausted'){'generator_timeout'}else{'generator_failed'}))
    }
    $generated=$null
    try{$generated=$capture.Stdout.Trim()|ConvertFrom-Json -ErrorAction Stop}catch{}
    if($capture.ExitCode -eq 3){
      $reason=switch([string]$generated.code){'source_shape_changed'{'source_shape_changed'} 'original_predicate_changed'{'original_predicate_changed'} 'unexpected_relative_dependency'{'unexpected_relative_dependency'} 'capability_marker_missing'{'capability_marker_missing'} default{$null}}
      if(-not $reason){throw (New-WatchDriverFailure 'diagnostic_generator_unavailable' 'generator_output_invalid')}
      Set-WatchDriverRejection $Root $Digest $reason
    }
    if($capture.ExitCode -ne 0){throw (New-WatchDriverFailure 'diagnostic_generator_unavailable' 'generator_failed')}
    if(-not $generated -or $generated.ok -ne $true){throw (New-WatchDriverFailure 'diagnostic_generator_unavailable' 'generator_output_invalid')}
    $driverDirectory=Join-Path $staging 'driver'
    $names=@(Get-ChildItem -LiteralPath $driverDirectory -Force|ForEach-Object Name|Sort-Object)
    if((@($names) -join '|') -cne ((@($WatchDriverFiles)|Sort-Object) -join '|')){throw (New-WatchDriverFailure 'diagnostic_generator_unavailable' 'generator_output_invalid')}
    # 3. Mechanical checks of what was generated.
    foreach($name in @($WatchDriverFiles|Where-Object {$_ -like '*.ps1'})){
      if(-not (Test-WatchScriptParses (Join-Path $driverDirectory $name))){Set-WatchDriverRejection $Root $Digest 'generated_script_unparsable'}
    }
    $check=Invoke-WatchDriverClosureCheck $driverDirectory (Join-Path $staging 'sources')
    if(-not $check.ok){
      $reason=@($check.reasons|Where-Object {$_ -cin $WatchDriverRejectionReasons}|Select-Object -First 1)
      Set-WatchDriverRejection $Root $Digest $(if($reason.Count){[string]$reason[0]}else{'closure_analysis_failed'})
    }
    $binding=Read-WatchJson (Join-Path $driverDirectory 'driver-binding.json')
    foreach($name in $Sources.Keys){if([string]$binding.assetHashes.$name -cne $SourceHashes[$name]){throw (New-WatchDriverFailure 'diagnostic_generator_unavailable' 'binding_mismatch')}}
    # 4. The production files must not have moved while the copies were being turned into a driver.
    foreach($name in $Sources.Keys){
      $now=try{Get-WatchSourceHash $Sources[$name]}catch{$null}
      if($now -cne $SourceHashes[$name]){throw (New-WatchDriverFailure 'diagnostic_sources_changing')}
    }
    $files=[ordered]@{};foreach($name in $WatchDriverFiles){$files[$name]=Get-WatchHash (Join-Path $driverDirectory $name)}
    Write-WatchJson (Join-Path $driverDirectory 'driver-manifest.json') @{version=1;digest=$Digest;createdAt=[DateTimeOffset]::UtcNow.ToString('o');sources=$SourceHashes;files=$files;generatorProofSha256=[string]$generated.proofSha256;closureExceptionsUsed=[int]$check.excepted}
    # 5. Publish atomically; a concurrent generator that got there first wins.
    $final=Join-Path $Root $Digest
    try{[IO.Directory]::Move($driverDirectory,$final)}catch{if(-not(Test-Path -LiteralPath $final)){throw (New-WatchDriverFailure 'diagnostic_generator_unavailable' 'staging_failed')}}
    return $final
  }finally{Remove-WatchContainedTree $Root $staging}
}
function Invoke-WatchDriverEnsure {
  $root=Get-WatchDriversRoot
  $sources=Get-WatchDriverSources
  $sourceHashes=@{};$suiteHashes=@{}
  try{foreach($name in $sources.Keys){$sourceHashes[$name]=Get-WatchSourceHash $sources[$name]}}catch{throw (New-WatchDriverFailure 'diagnostic_generator_unavailable' 'source_unreadable')}
  try{foreach($name in $WatchGeneratorSuite){$suiteHashes[$name]=Get-WatchSourceHash (Join-Path $PSScriptRoot $name)}}catch{throw (New-WatchDriverFailure 'diagnostic_generator_unavailable' 'generator_failed')}
  $digest=Get-WatchDriverDigest $sourceHashes $suiteHashes
  Assert-WatchContainedDirectory $WatchdogRoot $root
  $final=Join-Path $root $digest
  if(Test-Path -LiteralPath $final){
    [void](Test-WatchDriverDirectory $final $digest)
    Remove-WatchStaleDrivers $root $digest
    return @{directory=$final;digest=$digest;regenerated=$false}
  }
  $rejected=Get-WatchDriverRejection $digest
  if($rejected){throw (New-WatchDriverFailure 'diagnostic_regeneration_rejected' $rejected)}
  [void][IO.Directory]::CreateDirectory($root)
  $final=New-WatchDriver $root $digest $sources $sourceHashes
  [void](Test-WatchDriverDirectory $final $digest)
  Remove-WatchStaleDrivers $root $digest
  return @{directory=$final;digest=$digest;regenerated=$true}
}
function Initialize-WatchDriver {
  # The generation budget (45s) is its own: it must not eat the 120s status snapshot parent.
  $saved=$env:TERUISI_PROCESS_DEADLINE_UNIX_MS
  try{
    $env:TERUISI_PROCESS_DEADLINE_UNIX_MS=[string](Get-ProcessDeadline 45000)
    return Invoke-WatchDriverEnsure
  }finally{$env:TERUISI_PROCESS_DEADLINE_UNIX_MS=$saved}
}
function Invoke-WatchSupervisorStatus {
  # Status goes through the generated read-only driver whenever one is resolved: the original
  # supervisor script is never asked for Status in the driver layout.
  if($script:WatchDriverDirectory){return Invoke-WatchScript (Join-Path $script:WatchDriverDirectory 'watchdog-status-backend.ps1') @('-Action','Status','-DiagnosticTarget','Supervisor')}
  if(Test-WatchDriverLayout){throw 'supervisor_ownership_error'}
  return Invoke-WatchScript $SupervisorPath @('-Action','Status')
}
function Resolve-WatchStatusControl($Driver=$null,$DriverFailure=$null) {
  if(Test-WatchDriverLayout){
    # Never a legacy controller in the driver layout: a missing driver is a closed failure.
    if($DriverFailure){throw $DriverFailure}
    if(-not $Driver){throw (New-WatchDriverFailure 'diagnostic_generator_unavailable' 'generator_failed')}
    return @{path=(Join-Path $Driver.directory 'watchdog-status-control.ps1');mode='readonly_driver';reason=$(if($Driver.regenerated){'regenerated'}else{'cached'})}
  }
  $driver=Join-Path $PSScriptRoot 'watchdog-status-control.ps1'
  $driverNames=@('watchdog-status-control.ps1','watchdog-status-backend.ps1','watchdog-core-overlay.ps1','driver-binding.json')
  $present=@($driverNames|Where-Object {Test-Path -LiteralPath (Join-Path $PSScriptRoot $_)})
  $bundle=Read-WatchJson (Join-Path $PSScriptRoot 'bundle.json')
  $declared=@()
  if($null -ne $bundle){
    if($bundle.version -ne 1 -or $null -eq $bundle.files){throw 'invalid_diagnostic_bundle'}
    $names=if($bundle.files -is [Collections.IDictionary]){@($bundle.files.Keys)}else{@($bundle.files.PSObject.Properties.Name)}
    $declared=@($driverNames|Where-Object {$_ -cin $names})
  }
  # Only a genuinely never-configured historical driver may use legacy status.
  if($present.Count -eq 0 -and $declared.Count -eq 0){return @{path=$ControlPath;mode='legacy';reason='driver_not_installed'}}
  if($present.Count -ne $driverNames.Count){throw 'diagnostic_driver_incomplete'}
  $binding=Read-WatchJson (Join-Path $PSScriptRoot 'driver-binding.json')
  $sources=@{control=$ControlPath;worker=$WorkerPath;backend=(Join-Path $BackendRoot 'app\tools\django-local-service.ps1');transport=(Join-Path $ProjectRoot 'tools\process-deadline.ps1')}
  if(-not $binding -or $binding.version -ne 1){throw 'invalid_diagnostic_binding'}
  # Never update the expected hashes here: a changed predecessor must stay a
  # closed failure until the driver is regenerated and separately reviewed.
  # Name the drifted assets so the alert can say the monitor needs requalification.
  $drifted=@($sources.Keys|Sort-Object|Where-Object {(Get-WatchHash $sources[$_]) -cne $binding.assetHashes.$_})
  if($drifted.Count){
    $failure=[Exception]::new('diagnostic_predecessor_changed')
    $failure.Data['DiagnosticBinding']=@{code='diagnostic_predecessor_changed';assets=$drifted}
    throw $failure
  }
  return @{path=$driver;mode='readonly_driver';reason='exact_predecessor'}
}
function Get-WatchSnapshot {
  $clock=[Diagnostics.Stopwatch]::StartNew()
  $admission=Get-Admission
  $snapshot=@{at=[DateTimeOffset]::UtcNow.ToString('o');admission=$admission;system='unprobed';backend='unprobed';worker='unprobed';supervisor='unprobed';supervisorHealth='unprobed';components=@{};ports=@();portsObservation=@{status='unknown';reason='not_checked'};probes=@{};stages=@{};healthy=$false;probeError=$false;processDiagnostic=$null}
  # Planned shutdown is quiet, and a corrupt gate must never be treated as permission.
  if($admission.mode -ne 'running'){return $snapshot}
  # Driver regeneration has its own budget and runs before the 120s snapshot parent starts.
  $driver=$null;$driverFailure=$null;$script:WatchDriverDirectory=$null
  if(Test-WatchDriverLayout){try{$driver=Initialize-WatchDriver;$script:WatchDriverDirectory=$driver.directory}catch{$driverFailure=$_}}
  $savedDeadline=$env:TERUISI_PROCESS_DEADLINE_UNIX_MS
  # Measured driver run ~46-54s; control now also allows a 20s ready request.
  # Keep one 120s snapshot parent, with a 90s control child and other children at 60s.
  $env:TERUISI_PROCESS_DEADLINE_UNIX_MS=[string](Get-ProcessDeadline 120000)
  try {
  $probeStage='control'
  $stageClock=[Diagnostics.Stopwatch]::StartNew()
  try{
    $selected=Resolve-WatchStatusControl $driver $driverFailure
    $snapshot.diagnosticMode=$selected.mode;$snapshot.diagnosticReason=$selected.reason
    $status=Invoke-WatchScript $selected.path @('-Action','Status','-Json') -Seconds 90
    [void](Get-ProcessRemaining ([long]$env:TERUISI_PROCESS_DEADLINE_UNIX_MS))
    $snapshot.system=[string]$status.state;$snapshot.backend=[string]$status.backendState;$snapshot.worker=[string]$status.workerState
    foreach($name in @('core','finance','netshop','market','products','workflow','inventory','customerService','accessControl','erpReference','bi','ai')){
      $v=$status.components.$name;if($v -is [bool]){$snapshot.components[$name]=$v}
    }
    $snapshot.coreDiagnostics=Get-WatchCoreDiagnostic $status.coreDiagnostics
    $snapshot.statusTimings=@{}
    foreach($name in @('backendMs','workerMs','httpMs')){$n=$status.statusTimings.$name;if($n -is [ValueType] -and $n -isnot [bool] -and $n -ge 0 -and $n -le 3600000){$snapshot.statusTimings[$name]=$n}}
    $snapshot.controllerHealthEvidence=Get-WatchHealthDiagnostic $status.healthEvidence
    if($null -ne $status.healthEvidence){
      $snapshot.controllerHealthValid=($snapshot.controllerHealthEvidence -and $snapshot.controllerHealthEvidence.probes.Count -eq 3 -and @($snapshot.controllerHealthEvidence.probes.Values|Where-Object {$_.passed -ne $true}).Count -eq 0)
    }
    $snapshot.releaseId=[string]$status.releaseId;$snapshot.workerPid=$status.portProcessId;$snapshot.supervisorPid=$status.supervisorProcessId
    $snapshot.stages.control=@{status='completed';elapsedMs=$stageClock.ElapsedMilliseconds}
    $probeStage='supervisor'
    $stageClock.Restart()
    $supervisor=Invoke-WatchSupervisorStatus
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
    $code=if($_.Exception.Message -eq 'process_deadline_exhausted'){'process_deadline_exhausted'}
      elseif($_.Exception.Message -cin @('diagnostic_predecessor_changed','invalid_diagnostic_binding','diagnostic_driver_incomplete','invalid_diagnostic_bundle','diagnostic_regeneration_rejected','diagnostic_generator_unavailable','diagnostic_sources_changing')){$_.Exception.Message}
      else{'probe_stage_failed'}
    $snapshot.processDiagnostic=@{stage=$probeStage;code=$code;process=Get-WatchProcessDiagnostic $_.Exception.Data['ProcessEvidence']}
    # The monitor cannot observe the system until its driver is requalified.
    # Record that separately so it is alertable instead of looking like a probe failure.
    $snapshot.diagnosticBinding=Get-WatchBindingDiagnostic $code $_.Exception.Data['DiagnosticBinding']
  }
  $snapshot.probes=Get-WatchHttpProbes @{homepage='http://127.0.0.1:3000/';live='http://127.0.0.1:3000/_teruisi/local/health/live';ready='http://127.0.0.1:3000/_teruisi/local/health/ready';helper='http://127.0.0.1:5791/health'}
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
  @{version=$WatchdogVersion;failures=0;lastCheck=$null;lastHealthy=$null;incident=$null;attempts=@();lastMode='unknown';lastFence=$null;notification=$null;notificationEscalations=0;lastNotificationEscalation=$null;notificationSuffix=$null;blindnessSeen=$false;incidentRecoveryFailures=0}
}
function Get-WatchDecision($Snapshot,$State,[DateTimeOffset]$Now) {
  if($Snapshot.admission.mode -in @('maintenance','stopped')){return 'suspended'}
  if($Snapshot.healthy){return 'healthy'}
  if([int]$State.failures -lt 2){return 'confirm_failure'}
  if($Snapshot.admission.mode -ne 'running' -or $Snapshot.probeError -or $Snapshot.supervisor -in @('ownership_error','ownership_check_failed','status_error') -or $Snapshot.worker -notin @('stopped','stale_or_invalid_receipt','exact_release')){return 'alert_only'}
  # Clean Worker Stop leaves the backend running: do not reverse that explicit action.
  if($Snapshot.worker -eq 'stopped' -and $Snapshot.backend -eq 'Ready'){return 'alert_only'}
  # The same incident gets at most 3 recovery attempts in total (a supervisor that exits at once was
  # re-launched every 5 minutes before); after that it is alert-only until the incident closes.
  if([int]$State.incidentRecoveryFailures -ge 3){return 'recovery_exhausted'}
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
  $status=Invoke-WatchSupervisorStatus
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
function Get-WatchPostgresRecoveryTail([string]$FilePath){
  $limit=262144;$stream=$null
  if([string]::IsNullOrWhiteSpace($FilePath)){return @{records=@();observation=@{status='missing';byteLimit=$limit;bytesRead=0;truncated=$false}}}
  try{
    $stream=[IO.FileStream]::new($FilePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    $length=$stream.Length;$start=[Math]::Max(0,$length-$limit);[void]$stream.Seek($start,[IO.SeekOrigin]::Begin)
    $buffer=[byte[]]::new([int]($length-$start));$read=0
    while($read -lt $buffer.Length){$n=$stream.Read($buffer,$read,$buffer.Length-$read);if($n -eq 0){break};$read+=$n}
    $first=0;$last=$read
    # Discard partial edge lines before strict UTF-8 decoding. A huge SQL line
    # is omitted as incomplete evidence, never read backwards without a bound.
    if($start -gt 0){while($first -lt $read -and $buffer[$first] -ne 10){$first++};if($first -lt $read){$first++}}
    while($last -gt $first -and $buffer[$last-1] -ne 10){$last--}
    $text=if($last -gt $first){[Text.UTF8Encoding]::new($false,$true).GetString($buffer,$first,$last-$first)}else{''}
    $lines=@($text -split "`n" | Where-Object {$_.Length -gt 0} | Select-Object -Last 160)
    $records=@(foreach($line in $lines){
      $tag=$line.IndexOf(' LOG: ',[StringComparison]::Ordinal)
      if($tag -lt 0 -or $tag -gt 256){continue}
      $message=$line.Substring($tag+6).TrimStart()
      if($message -match '^(database system was interrupted|database system was not properly shut down|redo done|database system is ready to accept connections)'){
        $line.Substring(0,$tag)+' '+$(if($message -match '^database system is ready'){'database_ready'}else{'database_recovery'})
      }
    })
    return @{records=$records;observation=@{status='read';sourceBytes=$length;byteLimit=$limit;bytesRead=$read;completeLinesObserved=$lines.Count;truncated=($start -gt 0 -or $last -lt $read -or $read -ne $buffer.Length)}}
  }catch{return @{records=@();observation=@{status='unavailable';reason='bounded_log_tail_read_failed';byteLimit=$limit}}}
  finally{if($null -ne $stream){$stream.Dispose()}}
}
function Get-WatchEvidence($Snapshot){
  $events=@()
  foreach($log in @('System','Application')){
    $filter=@{LogName=$log;StartTime=(Get-Date).AddMinutes(-20);Id=@(41,1074,6008,2004,1000,1001,1002)}
    $events+=@(Get-WinEvent -FilterHashtable $filter -MaxEvents 30 -ErrorAction SilentlyContinue|ForEach-Object {@{time=$_.TimeCreated.ToUniversalTime().ToString('o');id=$_.Id;provider=$_.ProviderName}})
  }
  $postgres=Get-ChildItem -LiteralPath (Join-Path $BackendRoot 'logs') -Filter 'postgresql-*.log' -File|Sort-Object LastWriteTime -Descending|Select-Object -First 1
  $tail=Get-WatchPostgresRecoveryTail $(if($postgres){$postgres.FullName}else{''})
  return @{snapshot=$Snapshot;events=$events;databaseRecovery=$tail.records;databaseLogObservation=$tail.observation;capturedAt=[DateTimeOffset]::UtcNow.ToString('o')}
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
  if($Snapshot.diagnosticBinding -and $Snapshot.diagnosticBinding.valid -eq $false){
    # Say plainly that the monitor is blind, not that the system is unhealthy.
    $names=@{control='总控脚本';worker='Worker 服务脚本';backend='Django 服务脚本';transport='进程传输脚本';supervisor='Django 守护脚本';isolation='主检出隔离脚本';backendIsolation='Django 隔离脚本'}
    $assets=@(@($Snapshot.diagnosticBinding.assets)|ForEach-Object {$names[$_]}|Where-Object {$_})
    $reasonText=@{source_shape_changed='源文件结构已变化';original_predicate_changed='所有权判定函数已变化';unexpected_relative_dependency='出现新的相对依赖';capability_marker_missing='后端能力标记缺失';closure_forbidden_primitive='调用闭包出现结束进程或改写进程记录的操作';ownership_unlisted_command='所有权判定函数调用了未审过的代码';ownership_function_missing='所有权判定函数缺失';ownership_dynamic_call='所有权判定函数出现动态调用';closure_parse_failed='安全检查无法解析脚本';closure_analysis_failed='安全检查无法完成';closure_entry_missing='安全检查找不到驱动入口';generated_script_unparsable='生成的脚本无法解析';node_missing='找不到 Node.js';generator_timeout='生成超时';generator_failed='生成器运行失败';generator_output_invalid='生成器输出无效';source_unreadable='源文件无法读取';staging_failed='临时目录写入失败';binding_mismatch='生成结果与源文件不符'}
    $reasonDetail=if($Snapshot.diagnosticBinding.reason -is [string] -and $reasonText.ContainsKey($Snapshot.diagnosticBinding.reason)){'：'+$reasonText[$Snapshot.diagnosticBinding.reason]}else{''}
    $blind=switch($Snapshot.diagnosticBinding.code){
      'diagnostic_regeneration_rejected'{"源码结构变化超出自动生成的安全范围，监控需人工复核$reasonDetail，本轮未能观测服务状态；这不代表服务异常"}
      'diagnostic_generator_unavailable'{"监控的诊断驱动生成器不可用$reasonDetail，本轮未能观测服务状态；这不代表服务异常"}
      'diagnostic_sources_changing'{'受监控的源文件在生成诊断驱动期间发生变化，下一轮自动重试，本轮未能观测服务状态；这不代表服务异常'}
      default{$null}
    }
    if($blind){$reasons.Add($blind)}
    $detail=if($blind){$null}else{switch($Snapshot.diagnosticBinding.code){
      'diagnostic_predecessor_changed'{if($assets.Count){'已变化：'+($assets -join '、')}else{'受钉源文件已变化'}}
      'invalid_diagnostic_binding'{'钉子文件无效'}
      'diagnostic_driver_incomplete'{'诊断驱动文件不完整'}
      'invalid_diagnostic_bundle'{'诊断包清单无效'}
      default{'诊断绑定无效'}
    }}
    if(-not $blind){$reasons.Add("监控自身需要重新资格化（$detail），本轮未能观测服务状态；这不代表服务异常")}
  }
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
  if($Snapshot.supervisor -eq 'ownership_check_failed'){$reasons.Add('监控自身未能完成后端守护进程归属核验，这不代表 supervisor 异常')}
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
    $current=if($Snapshot.currentlyHealthy -eq $false){'当前另有异常，请查看最新运行提醒。'}else{'需要人工处理：否。'}
    $blindNote=if($State.blindnessSeen -eq $true){'其间包含监控失明时段，不等于服务故障。'}else{''}
    return "运营管理系统恢复提醒。故障首次发现：$time（北京时间）。该事件恢复确认：$(Get-WatchTimeText $completed)。确认时已通过两轮健康检查。确认时首页/后端状态：$($Snapshot.system)/$($Snapshot.backend)。确认时端口：$ports。$blindNote$current"
  }
  $reminderNote=''
  if([string]$State.notificationSuffix -cmatch '^-reminder(?<n>\d+)$'){
    $reminderNote="持续提醒（第 $($Matches['n']) 次）：该事件自 $time 起未恢复。"
    if($State.blindnessSeen -eq $true){$reminderNote+='其间包含监控失明时段，不等于服务故障。'}
  }
  $label=switch($Outcome){recovery_exhausted{'同一事件自动恢复已尝试3次未通过，不再自动拉起'} recovery_failed{'自动恢复未通过'} budget_exhausted{'已达到本轮自动恢复次数上限'} cooldown{'等待下一次有间隔的安全恢复'} alert_only{'已告警，未自动重启'} default{'健康检查未通过'}}
  $action=if($Snapshot.probeError){'待确认；如持续出现，请检查本机控制面板及本次监控记录。'}else{'是；请检查上述失败项，并在本机控制面板确认当前状态。'}
  $checked=if($Snapshot.completedAt){$Snapshot.completedAt}else{$Snapshot.at}
  return "运营管理系统运行提醒。${reminderNote}故障首次发现：$time（北京时间）。检查时间：$(Get-WatchTimeText $checked)。处理结果：$label。原因：$(Get-WatchFailureText $Snapshot)。首页/后端状态：$($Snapshot.system)/$($Snapshot.backend)。端口：$ports。需要人工处理：$action"
}
function Save-WatchFailureEvidence($State,$Snapshot){
  if(-not $State.incident -or $Snapshot.healthy){return}
  $evidence=Get-WatchEvidence $Snapshot
  $first=Join-Path $WatchdogRoot "evidence\$($State.incident)-first-failure.json"
  if(-not(Test-Path -LiteralPath $first)){Write-WatchJson $first $evidence}
  Write-WatchJson (Join-Path $WatchdogRoot "evidence\$($State.incident)-last-failure.json") $evidence
}
function Send-WatchAlert($State,$Snapshot,[string]$Outcome,[switch]$DryRun,[switch]$Recovery,[string]$ReservationPath=$StatePath){
  $slot=if($Recovery){'recoveryNotification'}else{'notification'}
  $attemptSlot=if($Recovery){'recoveryIdentityAttempts'}else{'identityAttempts'}
  $timeSlot=if($Recovery){'lastRecoveryIdentityAttempt'}else{'lastIdentityAttempt'}
  $reasonSlot=if($Recovery){'recoveryNotificationReason'}else{'notificationReason'}
  $codeSlot=if($Recovery){'recoveryIdentityFailureCode'}else{'identityFailureCode'}
  # A still-open incident must not go silent forever because one delivery was
  # unconfirmed. Replaying the same alert is still forbidden; instead a bounded
  # number of later rounds may send a NEW record of their own. Escalation is
  # time-gated and never applies to recovery notices or a confirmed send.
  # 2026-11-12: the 3-reminder cap is gone. While the incident stays open, a record in a terminal
  # state (unknown, sent, sending left by a killed process, or identity_failed with its retries
  # used up) is followed by a NEW record -reminder<N> every 24 hours. Old records are never
  # replayed or overwritten; N continues from the existing counter.
  $escalation=0
  if(-not $DryRun -and -not $Recovery -and $State.incident){
    $current=[string]$State[$slot]
    $terminal=$current -cin @('unknown','sent','sending') -or ($current -ceq 'identity_failed' -and [int]$State[$attemptSlot] -ge 3)
    if($terminal){
      $done=[int]$State['notificationEscalations']
      $last=if($State['lastNotificationEscalation']){$State['lastNotificationEscalation']}else{$State[$timeSlot]}
      # An unknown record with no timestamp at all is overdue; a sent/sending one needs a time to age from.
      $aged=if($last){([DateTimeOffset]::UtcNow-[DateTimeOffset]$last).TotalHours -ge 24}else{$current -ceq 'unknown'}
      if($aged){$escalation=$done+1}
    }
  }
  if(-not $DryRun -and $State[$slot] -and -not $escalation){
    if($State[$slot] -ne 'identity_failed'){return}
    # Only pre-send failures are retryable. Reservation/unknown/sent stay terminal.
    if([int]$State[$attemptSlot] -ge 3){return}
    # A process-level nonzero exit (e.g. a DingTalk access token that expired
    # the instant the probe ran) is a transient failure expected to clear on
    # its own shortly. It alone gets one shorter wait than the normal 15
    # minutes, so a retry is not forced to land inside the same expiry
    # window. The attempt count above still bounds the total; this never
    # grants extra attempts or an unbounded retry loop, and it never touches
    # the 'unknown' terminal status handled above.
    $minimumWaitMinutes=if($State[$codeSlot] -ceq 'nonzero_exit'){2}else{15}
    if($State[$timeSlot] -and ([DateTimeOffset]::UtcNow-[DateTimeOffset]$State[$timeSlot]).TotalMinutes -lt $minimumWaitMinutes){return}
  }
  # The current record's suffix lives in state so identity retries target the reminder record, not the base one.
  $suffix=if($Recovery){'-recovered'}elseif($escalation){"-reminder$escalation"}elseif([string]$State['notificationSuffix'] -cmatch '^-reminder\d+$'){[string]$State['notificationSuffix']}else{''}
  $alertPath=Join-Path $WatchdogRoot "alerts\$($State.incident)$suffix.json"
  if(-not $DryRun){
    $previous=Read-WatchJson $alertPath
    if($previous -and $previous.status -in @('sending','sent','unknown')){$State[$slot]=$previous.status;return}
  }
  $alert=@{incident=$State.incident;at=[DateTimeOffset]::UtcNow.ToString('o');outcome=$Outcome;status='pending_identity';ports=$Snapshot.ports;businessData=$false}
  if($escalation){
    $alert.reminder=$escalation
    # Claim this round before sending, so a crash cannot reuse the same slot.
    $State['notificationEscalations']=$escalation;$State['notificationSuffix']=$suffix
    $State['lastNotificationEscalation']=[DateTimeOffset]::UtcNow.ToString('o')
    $State[$slot]=$null;$State[$attemptSlot]=0;$State[$codeSlot]=$null
    if(-not $DryRun){Write-WatchJson $ReservationPath $State}
  }
  if(-not $DryRun){
    Write-WatchJson (Join-Path $WatchdogRoot "evidence\$($State.incident)$suffix-notification.json") (Get-WatchEvidence $Snapshot)
    Write-WatchJson $alertPath $alert
  }
  $stage='identity'
  try{
    if(-not $DryRun){$State[$attemptSlot]=[int]$State[$attemptSlot]+1;$State[$timeSlot]=[DateTimeOffset]::UtcNow.ToString('o');Write-WatchJson $ReservationPath $State}
    $recipient=Get-WatchRecipient
    $message=Get-WatchMessage $State $Snapshot $Outcome
    $arguments=@('chat','+messages-send','--as','bot','--profile',$recipient.profile,'--robot-code',$recipient.bot,'--users',$recipient.user,'--text',$message)
    if($DryRun){$preview=Invoke-WatchDws ($arguments+@('--dry-run'));if(-not $preview.dry_run -or $preview.executed){throw 'preview_invalid'};return @{status='dry_run_verified';executed=$false;targets=1}}
    # Persist BEFORE the non-idempotent remote call. Crashes/unknown delivery are never replayed.
    $alert.status='sending';Write-WatchJson $alertPath $alert
    $State[$slot]='sending';Write-WatchJson $ReservationPath $State
    $stage='delivery'
    $sent=Invoke-WatchDws ($arguments+@('--yes'))
    # Record only typed outcome metadata to diagnose CLI envelope drift later.
    # An unrecognized envelope still remains unknown; it is never guessed sent.
    # Observed bot envelope: {ok:bool, result:{errorCode:0, success:bool,
    #   result:{processQueryKey, invalidStaffIdList[], flowControlledStaffIdList[]}}}.
    # Top-level success/failedCount do not exist on this path; absent stays unconfirmed.
    $inner=$sent.result.result
    $undelivered=@(@($inner.invalidStaffIdList)+@($inner.flowControlledStaffIdList)|Where-Object {$null -ne $_})
    $alert.deliveryEvidence=@{
      ok=if($sent.ok -is [bool]){$sent.ok}else{$null}
      success=if($sent.result.success -is [bool]){$sent.result.success}else{$null}
      errorCode=if($sent.result.errorCode -is [ValueType] -and $sent.result.errorCode -isnot [bool] -and $sent.result.errorCode -ge 0 -and $sent.result.errorCode -le 1000000){$sent.result.errorCode}else{$null}
      undeliveredCount=if($undelivered.Count -le 30){$undelivered.Count}else{$null}
      acknowledged=($inner.processQueryKey -is [string] -and $inner.processQueryKey.Length -gt 0)
      resultShape=if($sent.result -is [array]){'array'}elseif($sent.result -is [pscustomobject] -or $sent.result -is [Collections.IDictionary]){'object'}elseif($null -eq $sent.result){'absent'}else{'other'}
    }
    $evidence=$alert.deliveryEvidence
    # Confirm only on a fully positive envelope: CLI ok, API success, zero errorCode,
    # a per-target acknowledgement key, and nobody rejected or flow-controlled.
    if($evidence.ok -ne $true -or $evidence.success -ne $true -or $evidence.errorCode -ne 0 -or
       $evidence.acknowledged -ne $true -or $evidence.undeliveredCount -ne 0){throw 'delivery_unconfirmed'}
    $alert.status='sent';$State[$slot]='sent';$State[$reasonSlot]=$null;$State[$codeSlot]=$null
  }catch{
    $alert.status=if($State[$slot] -eq 'sending'){'unknown'}else{'identity_failed'}
    $State[$slot]=$alert.status
    $known=@('owner_profile_ambiguous','owner_ambiguous','owner_mismatch','owner_search_ambiguous','bot_ambiguous','dws_rejected','operator_failed','probe_timeout','delivery_unconfirmed')
    $code=if($_.Exception.Message -cin $known){$_.Exception.Message}else{'preflight_failed'}
    $processDiagnostic=$_.Exception.Data['ProcessEvidence']
    if($processDiagnostic){$alert.processDiagnostic=Get-WatchProcessDiagnostic $processDiagnostic;if($alert.processDiagnostic.code){$code=$alert.processDiagnostic.code}}
    $alert.reason="$stage`:$code";$State[$reasonSlot]=$alert.reason
    # Record the diagnostic code alongside the identity_failed reservation so
    # the shorter transient-failure retry wait above can recognize it on the
    # next round. Only meaningful while the status is the retryable
    # identity_failed; 'unknown' stays terminal and never reads this slot.
    $State[$codeSlot]=if($alert.status -eq 'identity_failed'){$code}else{$null}
  }
  if(-not $DryRun){Write-WatchJson $alertPath $alert;Write-WatchJson $ReservationPath $State}
  elseif($alert.status -ne 'pending_identity'){throw 'notification_preflight_failed'}
}
function Confirm-WatchRecovery($State,$Snapshot){
  $path=Join-Path $WatchdogRoot "evidence\$($State.incident)-recovery-confirmed.json"
  if(-not(Test-Path -LiteralPath $path)){Write-WatchJson $path (Get-WatchEvidence $Snapshot)}
  if($State.notification -notin @('sent','sending','unknown')){return}
  if($State.incident -cnotmatch '^[0-9a-f]{32}$'){throw 'invalid_recovery_incident'}
  $pending=Join-Path $WatchdogRoot "recovery-outbox\$($State.incident).json"
  $completed=Join-Path $WatchdogRoot "recovery-completed\$($State.incident).json"
  if((Test-Path -LiteralPath $pending) -or (Test-Path -LiteralPath $completed)){return}
  # Persist the new fact before the main incident is cleared. The outbox uses
  # its own reservation file, never replacing the live monitoring state.
  Write-WatchJson $pending @{version=$WatchdogVersion;incident=$State.incident;firstFailure=$State.firstFailure;notification=$State.notification;recoveryNotification=$null;recoveryIdentityAttempts=0;lastRecoveryIdentityAttempt=$null;recoveryNotificationReason=$null;blindnessSeen=($State.blindnessSeen -eq $true)}
}
function Invoke-WatchRecoveryOutbox($CurrentSnapshot){
  if($CurrentSnapshot.admission.mode -ne 'running'){return}
  $root=Join-Path $WatchdogRoot 'recovery-outbox'
  if(-not(Test-Path -LiteralPath $root)){return}
  $files=@(Get-ChildItem -LiteralPath $root -Filter '*.json' -File|Sort-Object LastWriteTime|Select-Object -First 32)
  foreach($file in $files){
    if($file.BaseName -cnotmatch '^[0-9a-f]{32}$'){throw 'invalid_recovery_outbox_file'}
    $record=Read-WatchJson $file.FullName
    if(-not $record -or $record.version -cne $WatchdogVersion -or $record.incident -cne $file.BaseName){throw 'invalid_recovery_outbox_record'}
    $record=$record|ConvertTo-Json -Depth 10|ConvertFrom-Json -AsHashtable
    $terminal=$record.recoveryNotification -in @('sent','sending','unknown') -or [int]$record.recoveryIdentityAttempts -ge 3
    if(-not $terminal){
      if($record.lastRecoveryIdentityAttempt -and ([DateTimeOffset]::UtcNow-[DateTimeOffset]$record.lastRecoveryIdentityAttempt).TotalMinutes -lt 15){continue}
      $confirmed=Read-WatchJson (Join-Path $WatchdogRoot "evidence\$($record.incident)-recovery-confirmed.json")
      if(-not $confirmed.snapshot.healthy){throw 'invalid_recovery_confirmation'}
      $snapshot=$confirmed.snapshot|ConvertTo-Json -Depth 16|ConvertFrom-Json -AsHashtable
      $snapshot.currentlyHealthy=[bool]$CurrentSnapshot.healthy
      Send-WatchAlert $record $snapshot 'recovered' -Recovery -ReservationPath $file.FullName
      $terminal=$record.recoveryNotification -in @('sent','sending','unknown') -or [int]$record.recoveryIdentityAttempts -ge 3
    }
    if($terminal){
      $done=Join-Path $WatchdogRoot "recovery-completed\$($record.incident).json"
      Write-WatchJson $done $record
      # Both absolute paths are fixed descendants of this task's state root.
      $prefix=[IO.Path]::GetFullPath($WatchdogRoot).TrimEnd('\')+'\'
      if(-not $file.FullName.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or -not [IO.Path]::GetFullPath($done).StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'invalid_recovery_archive_path'}
      [IO.File]::Delete($file.FullName)
    }
    return
  }
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
      $state.notificationEscalations=0;$state.lastNotificationEscalation=$null
      $state.notificationSuffix=$null;$state.blindnessSeen=$false;$state.incidentRecoveryFailures=0
    }
    if($snapshot.diagnosticBinding){$state.blindnessSeen=$true}
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
    if($decision -eq 'recovery_failed'){$state.incidentRecoveryFailures=[int]$state.incidentRecoveryFailures+1}
    Write-WatchJson (Join-Path $WatchdogRoot "evidence\$($state.incident)-recovery-attempt.json") $state.recoveryAttempt
    Save-WatchFailureEvidence $state $snapshot
  }
  if($state.incident){
    Write-WatchJson (Join-Path $WatchdogRoot "evidence\$($state.incident)-latest.json") (Get-WatchEvidence $snapshot)
    if($Recover -and [int]$state.failures -ge 2 -and $decision -notin @('confirm_failure','verification_pending','healthy','recovered')){Send-WatchAlert $state $snapshot $decision}
    if($decision -in @('healthy','recovered')){Confirm-WatchRecovery $state $snapshot}
  }
  if($decision -in @('healthy','recovered')){$state.failures=0;$state.lastHealthy=[DateTimeOffset]::UtcNow.ToString('o');$state.incident=$null;$state.notification=$null;$state.notificationReason=$null;$state.identityAttempts=0;$state.lastIdentityAttempt=$null;$state.identityFailureCode=$null;$state.notificationEscalations=0;$state.lastNotificationEscalation=$null;$state.notificationSuffix=$null;$state.blindnessSeen=$false;$state.incidentRecoveryFailures=0}
  $state.lastMode=if($decision -eq 'verification_pending'){'verification_pending'}else{'running'}
  $state.lastFence=$snapshot.admission.fence;$state.decision=$decision
  Write-WatchJson $StatePath $state
  Write-WatchJson (Join-Path $WatchdogRoot 'latest.json') $snapshot
  if($Recover){Invoke-WatchRecoveryOutbox $snapshot}
  return @{status=$decision;serviceChanged=($decision -eq 'recovered');checkedAt=$snapshot.at}
}
function Install-Watchdog { Install-WatchdogSafely $PSScriptRoot }
if($FunctionsOnly){return}
$env:PATH=(Split-Path $PowerShellPath)+[IO.Path]::PathSeparator+$env:PATH
if($Action -eq 'PlanInstall'){Get-WatchInstallPlan|ConvertTo-Json -Depth 8;return}
if($Action -eq 'Install'){Install-Watchdog|ConvertTo-Json -Compress;return}
if($Action -eq 'Status'){@{task=[string](Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).State;state=Read-WatchJson $StatePath}|ConvertTo-Json -Depth 8;return}
if(-not(Test-Path -LiteralPath $WatchdogRoot)){New-Item -ItemType Directory -Path $WatchdogRoot|Out-Null}
$mutex=[Threading.Mutex]::new($false,(Get-WatchdogMutexName));$held=$false
try{
  try{$held=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$held=$true}
  if(-not $held){@{status='busy'}|ConvertTo-Json;return}
  if($Action -eq 'TestNotification'){Send-WatchAlert @{incident='preview';firstFailure='preview';notification=$null} @{system='preview';backend='preview';ports=@()} 'preview' -DryRun|ConvertTo-Json -Compress;return}
  if($Execute){
    $installation=Read-WatchJson (Join-Path $WatchdogRoot 'installation.json')
    if(-not $installation -or $installation.scriptSha256 -cne (Get-WatchHash $PSCommandPath) -or $installation.transportSha256 -cne (Get-WatchHash (Join-Path $PSScriptRoot 'process-deadline.ps1'))){throw 'installed_watchdog_binding_invalid'}
    if($installation.layout -eq 'immutable-v1'){
      $expectedDirectory=Join-Path $WatchdogRoot ('versions\'+$installation.bundleId)
      if([IO.Path]::GetFullPath($PSScriptRoot) -ine [IO.Path]::GetFullPath($expectedDirectory)){throw 'installed_watchdog_path_invalid'}
      Assert-WatchContainedDirectory $WatchdogRoot $expectedDirectory
      Assert-WatchBundle $expectedDirectory $installation
    }
  }
  Invoke-WatchCycle -Recover:$Execute|ConvertTo-Json -Compress
}finally{if($held){$mutex.ReleaseMutex()};$mutex.Dispose()}
