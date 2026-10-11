# Inline-only source for the derived controller. No invocation occurs here.
function Test-ProbeSafePath {
  param([string]$Path)
  $full=[IO.Path]::GetFullPath($Path);$cursor=[IO.Path]::GetPathRoot($full)
  foreach($part in $full.Substring($cursor.Length).Split([IO.Path]::DirectorySeparatorChar)) {
    if(-not $part){continue};$cursor=Join-Path $cursor $part
    $item=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
    if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'probe_reparse_path'}
    if($cursor -cne $full -and -not $item.PSIsContainer){throw 'probe_not_directory'}
  }
  return $full
}
function Get-ProbeHash {
  param([string]$Path)
  [void](Test-ProbeSafePath $Path)
  $algorithm=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($algorithm.ComputeHash([IO.File]::ReadAllBytes($Path)))).Replace('-','').ToLowerInvariant()}finally{$algorithm.Dispose()}
}
function Get-ReadonlyProbeContext {
  $self=Test-ProbeSafePath $script:ProducerControllerPath;$root=Split-Path -Parent $self
  if((Split-Path -Parent $root) -cne 'E:\codex-artifacts\release-integration-review-20261010' -or
      (Split-Path -Leaf $root) -cnotmatch '^AB-health-probe-20261011-[a-z0-9-]+$'){throw 'probe_artifact_root'}
  $scopePath=Test-ProbeSafePath (Join-Path $root 'health-scope.json')
  $scopeRawSha=Get-ProbeHash $scopePath
  $sidecar=([IO.File]::ReadAllText((Test-ProbeSafePath "$scopePath.sha256"))).Trim()
  if($sidecar -cnotmatch '^[a-f0-9]{64}$' -or $scopeRawSha -cne $sidecar){throw 'probe_authority_raw_hash'}
  $scope=[IO.File]::ReadAllText($scopePath)|ConvertFrom-Json -ErrorAction Stop
  if($scope.version -cne 'teruisi-ab-health-probe-closeout-v1' -or $scope.scopeSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      [IO.Path]::GetFullPath([string]$scope.outputRoot) -cne $root -or
      [IO.Path]::GetFullPath([string]$scope.derivedControllerPath) -cne $self -or
      (Get-ProbeHash $self) -cne [string]$scope.derivedControllerSha256){throw 'probe_authority_identity'}
  return [pscustomobject]@{root=$root;scopeSha256=[string]$scope.scopeSha256;producerSha256=[string]$scope.derivedControllerSha256;authorityRawSha256=$scopeRawSha}
}
function ConvertTo-ProbeEvidence {
  param([object]$Value)
  if(-not $Value -or $Value.version -ne 1){return $null}
  $time=$null
  if($Value.checkedAt -is [string] -and $Value.checkedAt -cmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?Z$') {
    $parsed=[DateTimeOffset]::MinValue
    if([DateTimeOffset]::TryParse($Value.checkedAt,[ref]$parsed)){$time=$parsed.UtcDateTime.ToString('o')}
  }
  $probes=@{}
  foreach($name in @('live','helper','ready')) {
    $v=$Value.probes.$name
    if(-not $v){$probes[$name]=$null;continue};$p=@{}
    foreach($k in @('called','requested','parsedObject','okMatches','markerMatches','passed','degradedMatches','beforeDeadline')) {
      $p[$k]=$(if($v.$k -is [bool]){$v.$k}else{$null})
    }
    foreach($k in @('statusCode','timeoutMs','effectiveTimeoutMs','elapsedMs')) {
      $n=$v.$k;$valid=($n -is [byte] -or $n -is [int16] -or $n -is [int] -or $n -is [long] -or $n -is [single] -or $n -is [double] -or $n -is [decimal]) -and
        -not [double]::IsNaN([double]$n) -and -not [double]::IsInfinity([double]$n)
      if($valid){$valid=switch($k){statusCode{$n -ge 100 -and $n -le 599 -and [Math]::Floor($n) -eq $n};elapsedMs{$n -ge 0 -and $n -le 600000};default{$n -ge 1 -and $n -le 10000 -and [Math]::Floor($n) -eq $n}}}
      $p[$k]=$(if($valid){$n}else{$null})
    }
    $p.errorKind=$(if([string]$v.errorKind -cin @('none','not-called','timeout','deadline','request-error','http-error','invalid-json','predicate','backend-degraded','unrecognized')){[string]$v.errorKind}else{'unrecognized'})
    $probes[$name]=[pscustomobject]$p
  }
  return [pscustomobject]@{version=1;checkedAt=$time;probes=[pscustomobject]$probes}
}
function Write-ReadonlyProbeTrace {
  param([object]$Context,[bool]$FunctionReturned,[AllowNull()][string]$ObservedState,[object]$HealthEvidence)
  $root=Test-ProbeSafePath $Context.root
  foreach($part in @('production','health-probe-evidence')) {
    $root=Join-Path $root $part
    if(-not [IO.Directory]::Exists($root)){[void][IO.Directory]::CreateDirectory($root)}
    [void](Test-ProbeSafePath $root)
  }
  $knownState=$(if($FunctionReturned -and $ObservedState -cin @('Running','BackendDegraded','Unresponsive')){$ObservedState}else{$null})
  $record=[pscustomobject]@{version='teruisi-health-producer-trace-v1';scopeSha256=$Context.scopeSha256;producerSha256=$Context.producerSha256;
    authorityRawSha256=$Context.authorityRawSha256;
    processId=$PID;at=[DateTimeOffset]::UtcNow.UtcDateTime.ToString('o');functionReturned=$FunctionReturned;observedState=$knownState;
    healthEvidence=(ConvertTo-ProbeEvidence $HealthEvidence);rawBodyPersisted=$false;rawReasonPersisted=$false}
  $file=Join-Path $root "$PID-$([guid]::NewGuid().ToString('N')).json"
  $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($record|ConvertTo-Json -Depth 12 -Compress)+"`n")
  $stream=[IO.FileStream]::new($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read,65536,[IO.FileOptions]::WriteThrough)
  try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
}
function Get-SystemHealthState {
  param([switch]$Refresh)
  $returned=$false;$observed=$null
  try{$observed=Get-SourceSystemHealthState -Refresh:$Refresh;$returned=$true;return $observed}
  finally{Write-ReadonlyProbeTrace -Context $script:ReadonlyProbeContext -FunctionReturned $returned -ObservedState $observed -HealthEvidence $script:lastHealthEvidence}
}
