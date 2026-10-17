# Finite recovery library for the original f374/Pi150 failed Start only.
# No entrypoint, Stop, marker constructor, migration, activation or retry lives here.
function Get-Pi150FailedStartRecoveryFixedPins {
  $packet='D:\codex-isolated\main-release-packages\f3748d8e03e2-60dc61d1-622cb632'
  $attempt=Join-Path $packet 'publish-f3748d8e03e2'
  $pi='D:\teruisi-runtime\django-sales\pi-agent-additions\ff28fd7d584547dea301b9f3561ae2aa'
  $pins=[ordered]@{}
  $pins[(Join-Path $packet 'main-release-request.json')]='281c6517981752f3dd5540c5841b7a80ae7f8bf4f7cd94ae95c5e46ba8bb1521'
  $pins[(Join-Path $packet 'schema\ai-0084-evidence.json')]='0b91c3c33c7c9817bae4217e3360747b18fc176e4437a2d89efc96467ad0fd5d'
  $pins[(Join-Path $packet 'source\tools\pi_agent_addition.py')]='7181c617189dac2f0760663453f88d12a682d326e2f562236c238e4526b0ef8c'
  $names=@{
    'STARTED.json'='b90a93627b160f3c447718733cc0d0f5d2b8747e9ab2ef7997653ffb1b9be6c8'
    'FAILED.json'='ff3d41d00616be9f8ed357ff7ecef96cd3dae68a195549eac2aac3f72a3857c8'
    '启动服务-started.json'='9e289fb6be316b407900eb5cae9797935be3bf6f50e5a2229473e531c5983584'
    'WorkerApply-result.json'='b7b38ceead72814e2a1ab8e6e10928e1aa4a2afea6d2bcaa6061732cb3fffa7d'
    '退出维护-result.json'='9b141fdb976a1515b1a8924eb4b1136b9c6faece8bc42122db8491cfe1a6486b'
    '完成结构迁移-result.json'='bf0f2b385732b1a8d341ec4d6c70df1874dd0e4a3d3b5ad04aedd86c9f4f6c89'
    'maintenance-first-actor.json'='afc64056bc38a28b2c4a8d8d0c500c8d713e82dc717eb6987b68861d1d84d7c5'
    'maintenance-admission.json'='412c39b9fd04c3b421f327a4765bc8cc3a64967904b10f8c0129c6b71dc54168'
    'maintenance-first-request.json'='405d97674edb2b6dd462ff82ce82f11de1406803834c1db0851605c1d4451492'
  }
  foreach($name in $names.Keys){$pins[(Join-Path $attempt $name)]=$names[$name]}
  $names=@{
    'plan.json'='70b2fdaed5a62c52c8167b9a9653ffc701a25a10051e53618259b07657f4df32'
    'install-intent.json'='2c73c8f8b395642d7519a2f6ff2ab40b66c556eca5a8155abca3384ce77aeaf1'
    'installed.json'='941e4be13451ff0a3833a42c6bc9fe1729f5d992e7873259ffd12096e1e19d2a'
    'finalized.json'='a8d7fd2fbc39c7e13f02ec8440bc4c559c0720e76e5b3f510ada4b6dee0df110'
    'candidate.json'='0b91c3c33c7c9817bae4217e3360747b18fc176e4437a2d89efc96467ad0fd5d'
  }
  foreach($name in $names.Keys){$pins[(Join-Path $pi $name)]=$names[$name]}
  $pins['D:\teruisi-runtime\django-sales\pi-agent-addition-active.json']='8b0d857e4506b30ae800a36a9c6717409af95f8d7f791aaf22b5813702c6ad68'
  $pins['D:\teruisi-runtime\django-sales\app\deployment.json']='67696b506801744faf048141b5b4e342e1afa062e48d97669f6e44cf3634fbc2'
  $pins['D:\teruisi-runtime\django-sales\config\pandas-sandbox.json']='6266a095263d7c227ed3466bf013cf2579bfc9e33c548bb59554dfba4af09864'
  $pins['D:\teruisi-runtime\teruisi-worker-sales\releases\20261017T100706Z-1090ea88f6fe3094\deployment-manifest.json']='5bc9c99602822aa3342e1548e33a7b2ba2b42bb1a446af381bfdcf6a4203041d'
  $pins['D:\teruisi-runtime\teruisi-worker-sales\state\worker-release-rotation-consumptions\c584d268d94d1974c18068521b5039172b86fc97c2bd4580f18f5b9e0769f324.json']='29ca0955a93d60d47bb938510559af76c186beff4df12b3b38295ec5a2c8dcf5'
  $pins['D:\teruisi-runtime\teruisi-worker-sales\state\worker-release-rotation-plans\c584d268d94d1974c18068521b5039172b86fc97c2bd4580f18f5b9e0769f324.json']='c584d268d94d1974c18068521b5039172b86fc97c2bd4580f18f5b9e0769f324'
  $pins['D:\teruisi-runtime\teruisi-worker-sales\state\worker-release-successors\60dc61d1d2c884bf8670faf50244b2f71835457fa475118aef3c93045eaadfa9.json']='f9ec6cb51a89254c3c56b3d8d97a2e05dcad2d4167c649eb54f73a880cb73e1c'
  $pins['D:\teruisi-runtime\operations-watchdog\versions\ceee38dabd66ea9cc77622679d35bf601367f0582ac00fcfe5074dc10940c940\watchdog-core-overlay.ps1']='c86b635264807af5bb774863c7d525e4f7e6eed8ef418db9cdfa15e5bca4b183'
  return [pscustomobject]$pins
}

function Get-Pi150FailedStartRecoveryExecutionFiles {
  $files=Get-AbsentHelperRecoveryExecutionFiles
  foreach($path in @((Join-Path $ExecutionRoot 'tools\pi150-failed-start-recovery.ps1'),
      (Join-Path $ExecutionRoot 'tools\integration_release_gate.py'),
      (Join-Path $ExecutionRoot 'tools\pi150-forward-recovery.mjs'),
      (Join-Path $ExecutionRoot 'tools\publish-latest-main.mjs'),
      (Join-Path $ExecutionRoot 'tools\release-scope-plan.mjs'),
      (Join-Path $ExecutionRoot 'tools\publish-main-command.mjs'),
      (Join-Path $ExecutionRoot 'tools\release-batch.mjs'),
      (Join-Path $ExecutionRoot 'tools\release-impact.mjs'),
      (Join-Path $ExecutionRoot 'tools\release-no-data-observation.mjs'),
      (Join-Path $ExecutionRoot 'tools\release-readonly-retry.mjs'),
      (Join-Path $ExecutionRoot 'tools\publish-main-progress.mjs'),
      (Join-Path $ExecutionRoot 'tools\main-schema-release.mjs'),
      (Join-Path $ExecutionRoot 'tools\collect-d1-retirement-proof.mjs'),
      'D:\teruisi-runtime\operations-watchdog\versions\ceee38dabd66ea9cc77622679d35bf601367f0582ac00fcfe5074dc10940c940\watchdog-core-overlay.ps1',
      $Python,(Join-Path $env:SystemRoot 'System32\wsl.exe'))){
    $files | Add-Member -NotePropertyName $path -NotePropertyValue (Get-FileSha256 $path)
  }
  return $files
}

function Assert-Pi150FailedStartRecoveryFileMap([object]$Actual,[object]$Expected) {
  if(-not (Test-ExactObjectPropertyNames $Actual @($Expected.PSObject.Properties.Name))){throw 'Pi150 recovery file inventory changed'}
  foreach($file in $Expected.PSObject.Properties){
    if($Actual.PSObject.Properties[$file.Name].Value -isnot [string] -or
        $Actual.PSObject.Properties[$file.Name].Value -cne $file.Value -or $file.Value -cnotmatch '^[a-f0-9]{64}$'){
      throw 'Pi150 recovery file digest changed'
    }
  }
}

function Get-Pi150FailedStartRecoveryOriginalActors {
  $attempt='D:\codex-isolated\main-release-packages\f3748d8e03e2-60dc61d1-622cb632\publish-f3748d8e03e2'
  $actorPath=Join-Path $attempt 'maintenance-first-actor.json'
  $record=Read-AbsentHelperRecoveryJson $actorPath 'afc64056bc38a28b2c4a8d8d0c500c8d713e82dc717eb6987b68861d1d84d7c5'
  $failure=Read-AbsentHelperRecoveryJson (Join-Path $attempt 'FAILED.json') 'ff3d41d00616be9f8ed357ff7ecef96cd3dae68a195549eac2aac3f72a3857c8'
  $startup=Read-AbsentHelperRecoveryJson (Join-Path $attempt '启动服务-started.json') '9e289fb6be316b407900eb5cae9797935be3bf6f50e5a2229473e531c5983584'
  $outer=$failure.processEvidence;$inner=$outer.engineFailure
  if($failure.at -isnot [string] -or $failure.at -cne '2026-10-17T11:04:31.123Z' -or
      $startup.at -isnot [string] -or $startup.at -cne '2026-10-17T11:01:54.171Z' -or
      $startup.action -isnot [string] -or $startup.action -cne 'Start' -or
      ($outer.processId -isnot [int] -and $outer.processId -isnot [long]) -or $outer.processId -ne 54580 -or
      ($outer.exitCode -isnot [int] -and $outer.exitCode -isnot [long]) -or $outer.exitCode -ne 1 -or
      $outer.stage -isnot [string] -or $outer.stage -cne 'output' -or
      $outer.outputProtocol -isnot [string] -or $outer.outputProtocol -cne 'direct-exit-files' -or
      ($inner.processId -isnot [int] -and $inner.processId -isnot [long]) -or $inner.processId -ne 38776 -or
      ($inner.exitCode -isnot [int] -and $inner.exitCode -isnot [long]) -or $inner.exitCode -ne 1 -or
      $inner.stage -isnot [string] -or $inner.stage -cne 'completed' -or
      $inner.outputProtocol -isnot [string] -or $inner.outputProtocol -cne 'direct-exit-file-snapshot'){
    throw 'Original failed Start termination boundary is unverified'
  }
  return @($record.actor,$record.rotationOwner,
    [pscustomobject]@{processId=38776;startedAt=$startup.at;exitedAt=$failure.at},
    [pscustomobject]@{processId=54580;startedAt=$startup.at;exitedAt=$failure.at})
}

function Assert-Pi150FailedStartRecoveryProcessInventory([object[]]$Processes,[object[]]$Listeners,[int[]]$OwnAncestors,[object[]]$OriginalActors=@()) {
  if(@($Listeners | Where-Object {$_.Port -in @(3000,5791,8001,8002,8011,8012,8021,8022,8031,8032,8041,8042,8051,8052,8061,8062,8071,8072,8081,8091,8092,8101,8102,8111,8112,8121)}).Count){throw 'An application listener is still present'}
  $lifetimes=@{}
  foreach($id in @(38776,54580,54152,63044)){$lifetimes[$id]=[pscustomobject]@{start=$null;reuseAfter=$null;reusedAt=$null}}
  # Pre-invocation records bind two exact births. The two Start actors instead
  # have a fixed direct-child exit completion before the sealed FAILED.at. This
  # is a process lifetime boundary, never a claim of zero deployment effects.
  if($OriginalActors.Count -ne 0 -and $OriginalActors.Count -ne 4){throw 'Incomplete original actor identities'}
  $bound=[Collections.Generic.HashSet[int]]::new()
  foreach($actor in $OriginalActors){
    if($actor -isnot [pscustomobject] -or ($actor.processId -isnot [int] -and $actor.processId -isnot [long]) -or
        [int]$actor.processId -notin @(38776,54580,54152,63044) -or -not $bound.Add([int]$actor.processId)){
      throw 'Original actor identity is invalid'
    }
    $lifetime=$lifetimes[[int]$actor.processId]
    if([int]$actor.processId -in @(54152,63044)){
      if($actor.creationDate -isnot [string] -or $actor.creationDate -cnotmatch '^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$' -or
          $actor.executablePath -isnot [string] -or [string]::IsNullOrWhiteSpace($actor.executablePath) -or
          $actor.commandLine -isnot [string] -or [string]::IsNullOrWhiteSpace($actor.commandLine)){throw 'Original actor creation identity is invalid'}
      $lifetime.start=[DateTimeOffset]::Parse($actor.creationDate,[Globalization.CultureInfo]::InvariantCulture).UtcDateTime
      $lifetime.reuseAfter=$lifetime.start
    }else{
      if($actor.startedAt -isnot [string] -or $actor.startedAt -cne '2026-10-17T11:01:54.171Z' -or
          $actor.exitedAt -isnot [string] -or $actor.exitedAt -cne '2026-10-17T11:04:31.123Z'){throw 'Original Start actor termination identity is invalid'}
      $lifetime.start=[DateTimeOffset]::Parse($actor.startedAt,[Globalization.CultureInfo]::InvariantCulture).UtcDateTime
      $lifetime.reuseAfter=[DateTimeOffset]::Parse($actor.exitedAt,[Globalization.CultureInfo]::InvariantCulture).UtcDateTime
    }
  }
  foreach($id in @($lifetimes.Keys)){
    $current=@($Processes|Where-Object {[int]$_.ProcessId -eq $id})
    if($current.Count -gt 1){throw 'Original actor PID has ambiguous current identity'}
    if($current.Count -eq 0){continue}
    $lifetime=$lifetimes[$id];$row=$current[0]
    if($null -eq $lifetime.start -or $row.CreationDate -isnot [datetime] -or
        $row.ExecutablePath -isnot [string] -or $row.CommandLine -isnot [string] -or
        [string]::IsNullOrWhiteSpace([string]$row.ExecutablePath) -or [string]::IsNullOrWhiteSpace([string]$row.CommandLine)){
      throw 'Original actor or unclassified PID reuse remains'
    }
    $created=$row.CreationDate.ToUniversalTime()
    # Equality can still be the original actor; an earlier timestamp contradicts
    # the pre-bound historical identity. Neither is proof of unrelated reuse.
    if($created -le $lifetime.reuseAfter){throw 'Original actor remains or its lifetime identity is inconsistent'}
    $lifetime.reusedAt=$created
  }
  foreach($p in $Processes){
    $parentId=[int]$p.ParentProcessId
    if(-not $lifetimes.ContainsKey($parentId)){continue}
    $parent=$lifetimes[$parentId]
    if($p.CreationDate -isnot [datetime] -or $null -eq $parent.start){throw 'A possible original descendant has unknown creation identity'}
    $created=$p.CreationDate.ToUniversalTime()
    # ParentProcessId is numeric and survives parent exit. A child predating the
    # original parent cannot descend from it. A child at/after proven PID reuse
    # strictly after the new birth belongs to that instance; equal timestamps
    # cannot establish parent-before-child ordering and remain unsafe.
    if($created -lt $parent.start){continue}
    if($null -ne $parent.reusedAt -and $created -gt $parent.reusedAt){continue}
    throw 'An original actor descendant remains or its parent generation is unknown'
  }
  foreach($p in $Processes){
    if($OwnAncestors -contains [int]$p.ProcessId){continue}
    $name=[string]$p.Name;$command=([string]$p.CommandLine).Replace('/','\');$exe=([string]$p.ExecutablePath).Replace('/','\')
    if($name -imatch '^(powershell|pwsh|python|pythonw|waitress-serve|node|workerd|esbuild|wsl)(\.exe)?$'){
      if(-not $command -or -not $exe){throw 'Possible late control/application process identity is unreadable'}
      if($name -imatch '^(powershell|pwsh)(\.exe)?$' -and $command -match '(?i)(?:^|\s)"?[-/](?:e|ec|en|enc|enco|encod|encode|encoded|encodedc|encodedco|encodedcom|encodedcomm|encodedcomma|encodedcomman|encodedcommand)"?(?:\s|:|$)'){
        throw 'Encoded control participant remains unclassified'
      }
      if($command -imatch 'teruisi-runtime\\(django-sales|teruisi-worker-sales)\\|pi-publish-recovery|f3748d8e03e2-60dc61d1-622cb632|worker-local-runtime-supervisor\.mjs|tmall-workflow-helper\.(mjs|ts)|TERUISI-Pandas|django-[a-z-]+\.ps1|worker-local-service\.ps1|operations-system-(control|service)\.ps1' -or
          $exe -imatch 'teruisi-runtime\\(django-sales|teruisi-worker-sales)\\'){throw 'A possibly late lifecycle/application participant remains'}
    }
  }
}

function Complete-Pi150FailedStartRecoveryProcessMetadata([object]$Process) {
  $overlay='D:\teruisi-runtime\operations-watchdog\versions\ceee38dabd66ea9cc77622679d35bf601367f0582ac00fcfe5074dc10940c940\watchdog-core-overlay.ps1'
  $cursor=$overlay;while($cursor){if((Get-Item -LiteralPath $cursor -Force -ErrorAction Stop).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Readonly process metadata library is linked'};$cursor=Split-Path -Parent $cursor}
  if((Get-FileSha256 $overlay) -cne 'c86b635264807af5bb774863c7d525e4f7e6eed8ef418db9cdfa15e5bca4b183'){throw 'Readonly process metadata library changed'}
  # Keep all overlay function replacements in a child scope. Its query-only
  # metadata path double-reads native handles and CIM creation identity.
  return & {
    param($Row,$Library)
    $previousCensus=Get-Variable -Name ReadonlyCensus -Scope Script -ErrorAction SilentlyContinue
    $hadPreviousCensus=$null -ne $previousCensus
    $previousCensusValue=if($hadPreviousCensus){$previousCensus.Value}else{$null}
    try{
      . $Library
      # Force the original native double-read even when CIM supplied both
      # strings, then compare every original nonempty field with that result.
      $query=$Row|Select-Object *;$query.ExecutablePath=$null;$query.CommandLine=$null
      $completed=Complete-ReadonlyProcessMetadata $query
      if((-not [string]::IsNullOrWhiteSpace([string]$Row.ExecutablePath) -and
            -not [string]::Equals([string]$Row.ExecutablePath,[string]$completed.ExecutablePath,[StringComparison]::OrdinalIgnoreCase)) -or
          (-not [string]::IsNullOrWhiteSpace([string]$Row.CommandLine) -and
            -not [string]::Equals([string]$Row.CommandLine,[string]$completed.CommandLine,[StringComparison]::Ordinal))){throw 'Original CIM and native process metadata disagree'}
      return $completed
    }
    finally{
      if($hadPreviousCensus){$script:ReadonlyCensus=$previousCensusValue}
      else{Remove-Variable -Name ReadonlyCensus -Scope Script -ErrorAction SilentlyContinue}
    }
  } $Process $overlay
}

function Assert-Pi150FailedStartRecoverySnapshot {
  if(Test-Path -LiteralPath 'D:\teruisi-runtime\teruisi-worker-sales\state\worker-process.json'){throw 'Worker process receipt remains'}
  foreach($entry in @(Get-ChildItem -LiteralPath $RunDirectory -Filter '*.pid.json' -File -ErrorAction Stop)){
    if($entry.Name -imatch '^(django-.+|ai-pandas-wsl|erp-reference-sync)\.pid\.json$'){throw 'Application process receipt remains'}
  }
  $processes=@(Get-CimInstance Win32_Process -ErrorAction Stop)
  if($processes.Count -lt 1 -or $processes.Count -gt 100000){throw 'Process inventory is unavailable or unbounded'}
  $ancestors=[Collections.Generic.List[int]]::new();$current=[int]$PID
  while($current -gt 0){
    if($ancestors.Contains($current)){throw 'Recovery ancestry is ambiguous'};$ancestors.Add($current)
    $entry=@($processes|Where-Object {$_.ProcessId -eq $current})
    if($entry.Count -ne 1){throw 'Recovery ancestry is unreadable'}
    $parent=@($processes|Where-Object {$_.ProcessId -eq $entry[0].ParentProcessId})
    if($parent.Count -eq 0){break}
    if($parent.Count -ne 1 -or $null -eq $entry[0].CreationDate -or $null -eq $parent[0].CreationDate){throw 'Recovery ancestry is ambiguous'}
    if([datetime]$parent[0].CreationDate -gt [datetime]$entry[0].CreationDate){break};$current=[int]$parent[0].ProcessId
  }
  $processes=@(foreach($process in $processes){
    $originalPid=$process.ProcessId -in @(38776,54580,54152,63044)
    $opaqueRelated=$ancestors -notcontains [int]$process.ProcessId -and [string]$process.Name -imatch '^(powershell|pwsh|python|pythonw|waitress-serve|node|workerd|esbuild|wsl)(\.exe)?$' -and
      ([string]::IsNullOrWhiteSpace([string]$process.CommandLine) -or [string]::IsNullOrWhiteSpace([string]$process.ExecutablePath))
    if($originalPid -or $opaqueRelated){
      Complete-Pi150FailedStartRecoveryProcessMetadata $process
    }else{$process}
  })
  $listeners=@([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners())
  Assert-Pi150FailedStartRecoveryProcessInventory $processes $listeners $ancestors.ToArray() @(Get-Pi150FailedStartRecoveryOriginalActors)
  # Reuse original native ownership/port checks; never call Stop here.
  Assert-ApplicationProcessesStopped 'Pi150FailedStartRecovery'
  Assert-SalesRetirementWorkerStopped 'Pi150FailedStartRecovery'
  Assert-PostgresListenerOwnership | Out-Null
  if(-not (Test-PostgresReady)){throw 'Owned PostgreSQL is not ready'}
}

function Get-Pi150WslReadAdapterCode {
  return @'
import base64,json,os,subprocess,sys,time
try:
    if len(sys.argv)!=3:raise ValueError('adapter_arguments')
    raw=base64.b64decode(sys.argv[1],validate=True)
    if len(raw)>8192:raise ValueError('adapter_arguments')
    args=json.loads(raw.decode('utf-8'))
    prefix=['-d','TERUISI-Pandas','-u','teruisi-pandas','--exec']
    commands={
      'list':['--list','--running','--quiet'],
      'unit':prefix+['/usr/bin/env','-i','HOME=/home/teruisi-pandas','PATH=/usr/bin:/bin','XDG_RUNTIME_DIR=/run/user/1000','DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus','/usr/bin/systemctl','--user','show','teruisi-pandas.service','--property=ActiveState','--property=SubState','--property=MainPID','--property=ControlPID'],
      'containers':prefix+['/usr/bin/docker','--host=unix:///run/user/1000/docker.sock','ps','-aq','--filter','label=teruisi.pandas-broker=v1']}
    if type(args) is not list or any(type(a) is not str for a in args):raise ValueError('adapter_arguments')
    command=next((name for name,value in commands.items() if args==value),None)
    if command is None:raise ValueError('adapter_command')
    deadline=int(sys.argv[2])
    remaining=min(15.0,deadline/1000-time.time())
    if remaining<=0:raise ValueError('adapter_deadline')
    env={k:v for k,v in os.environ.items() if k.upper() in {'SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','PATH'}}
    # subprocess's Windows list2cmdline leaves WSL flags unquoted; no shell and
    # no caller-controlled executable or command string is admitted here.
    result=subprocess.run([r'C:\Windows\System32\wsl.exe']+args,stdin=subprocess.DEVNULL,capture_output=True,timeout=remaining,env=env)
    if result.returncode!=0 or len(result.stdout)>65536 or len(result.stderr)!=0:raise ValueError('adapter_result')
    data=result.stdout
    if command=='list' and (data.startswith(b'\xff\xfe') or b'\x00' in data):
        output=data.decode('utf-16' if data.startswith(b'\xff\xfe') else 'utf-16-le',errors='strict')
    else:
        output=data.decode('utf-8-sig',errors='strict')
    if '\x00' in output:raise ValueError('adapter_encoding')
    print(json.dumps({'status':'verified','command':command,'stdout':output,'stdoutBytes':len(data),'stderrBytes':0,'exitCode':0},ensure_ascii=True,separators=(',',':')))
except Exception:
    print('{"status":"unverified"}')
    raise SystemExit(1)
'@
}

function Invoke-Pi150WslRead([string[]]$Arguments,[long]$Deadline) {
  $limit=[Math]::Min($Deadline,([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+15000))
  [void](Get-ProcessRemaining $limit)
  $payload=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject @($Arguments) -Compress)))
  $launcher=ConvertTo-PythonBase64Launcher (Get-Pi150WslReadAdapterCode) 'pi150_wsl_readonly_adapter.py'
  $run=Invoke-DeadlineProcess -Executable $Python -Arguments @('-B','-c',$launcher,$payload,[string]$limit) -WorkingDirectory $ExecutionRoot -Deadline $limit -MaxOutputBytes 65536 -Cleanup Preserve
  if($run.ExitCode -ne 0 -or $run.Stderr.Length -ne 0){throw 'Pandas read-only Linux observation failed'}
  $record=ConvertFrom-ExactJson $run.Stdout 'Pi150 WSL read-only observation'
  if(-not (Test-ExactObjectPropertyNames $record @('status','command','stdout','stdoutBytes','stderrBytes','exitCode')) -or
      $record.status -isnot [string] -or $record.status -cne 'verified' -or $record.command -isnot [string] -or
      $record.command -cnotin @('list','unit','containers') -or $record.stdout -isnot [string] -or
      ($record.stdoutBytes -isnot [int] -and $record.stdoutBytes -isnot [long]) -or $record.stdoutBytes -lt 0 -or $record.stdoutBytes -gt 65536 -or
      ($record.stderrBytes -isnot [int] -and $record.stderrBytes -isnot [long]) -or $record.stderrBytes -ne 0 -or
      ($record.exitCode -isnot [int] -and $record.exitCode -isnot [long]) -or $record.exitCode -ne 0){throw 'Pandas read-only Linux observation is unverified'}
  return $record.stdout
}

function Assert-Pi150FailedStartRecoveryPandas {
  $configPath=Join-Path $RuntimeRoot 'config\pandas-sandbox.json'
  $config=Read-AbsentHelperRecoveryJson $configPath '6266a095263d7c227ed3466bf013cf2579bfc9e33c548bb59554dfba4af09864'
  if(-not (Test-ExactObjectPropertyNames $config @('version','image','keySha256')) -or $config.version -ne 1 -or
      $config.image -isnot [string] -or $config.image -cnotmatch '^sha256:[a-f0-9]{64}$' -or
      (Get-FileSha256 (Join-Path $RuntimeRoot 'secrets\pandas-sandbox.dpapi.json')) -cne $config.keySha256){throw 'Pandas scope or credential fingerprint changed'}
  $deadline=Get-ProcessDeadline -TimeoutMilliseconds 60000
  $running=Invoke-Pi150WslRead @('--list','--running','--quiet') $deadline
  if(($running.Replace([string][char]0,'') -split '\r?\n'|ForEach-Object {$_.Trim().TrimStart([char]0xFFFD,[char]0xFEFF)}) -cnotcontains 'TERUISI-Pandas'){throw 'Cannot obtain bound running Pandas Linux observation'}
  $prefix=@('-d','TERUISI-Pandas','-u','teruisi-pandas','--exec')
  $linux=Invoke-Pi150WslRead ($prefix+@('/usr/bin/env','-i','HOME=/home/teruisi-pandas','PATH=/usr/bin:/bin','XDG_RUNTIME_DIR=/run/user/1000','DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus','/usr/bin/systemctl','--user','show','teruisi-pandas.service','--property=ActiveState','--property=SubState','--property=MainPID','--property=ControlPID')) $deadline
  $fields=@{};foreach($line in ($linux -split '\r?\n')){if($line -match '^(ActiveState|SubState|MainPID|ControlPID)=(.*)$'){if($fields.ContainsKey($Matches[1])){throw 'Duplicate Pandas Linux state field'};$fields[$Matches[1]]=$Matches[2]}elseif($line.Trim()){throw 'Unexpected Pandas Linux state field'}}
  if($fields.Count -ne 4 -or $fields.ActiveState -cne 'inactive' -or $fields.SubState -cne 'dead' -or $fields.MainPID -cne '0' -or $fields.ControlPID -cne '0'){throw 'Pandas Linux service is not stopped'}
  if((Invoke-Pi150WslRead ($prefix+@('/usr/bin/docker','--host=unix:///run/user/1000/docker.sock','ps','-aq','--filter','label=teruisi.pandas-broker=v1')) $deadline).Trim()){throw 'Pandas Linux container cleanup is incomplete or unknown'}
}

function Assert-Pi150FailedStartRecoveryShortcut([object]$Record) {
  $path=Join-Path ([Environment]::GetFolderPath('Startup')) 'TERUISI Operations Worker.lnk'
  if(-not (Test-ExactObjectPropertyNames $Record @('path','sha256')) -or $Record.path -isnot [string] -or
      [IO.Path]::GetFullPath($Record.path) -ine $path -or $Record.sha256 -isnot [string] -or
      $Record.sha256 -cnotmatch '^[a-f0-9]{64}$' -or (Get-FileSha256 $path) -cne $Record.sha256){throw 'Original activated startup shortcut changed'}
  $cursor=$path;while($cursor){if((Get-Item -LiteralPath $cursor -Force -ErrorAction Stop).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Startup shortcut path is linked'};$cursor=Split-Path -Parent $cursor}
  $shell=New-Object -ComObject WScript.Shell;$shortcut=$shell.CreateShortcut($path)
  $release='D:\teruisi-runtime\teruisi-worker-sales\releases\20261017T100706Z-1090ea88f6fe3094'
  $target=((Get-Command powershell.exe -CommandType Application -ErrorAction Stop|Select-Object -First 1).Source).Replace('/','\')
  $arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$release+'\tools\worker-local-service.ps1" -Action Start -ManifestPath "'+$release+'\deployment-manifest.json"'
  if($shortcut.TargetPath -ine $target -or $shortcut.Arguments -cne $arguments -or $shortcut.WorkingDirectory -ine $release){throw 'Startup shortcut does not bind the exact activated Worker'}
}

function Assert-Pi150FailedStartRecoverySource {
  $code=@'
import json,sys
from pathlib import Path
root=Path(r'D:\codex-isolated\main-release-packages\f3748d8e03e2-60dc61d1-622cb632\source')
sys.dont_write_bytecode=True
sys.path.insert(0,str(root/'tools'))
import pi_agent_addition as p
if p.code_digest(root)!='74c6e6b8686dd69c011491ccc9b66a438b2f2c823c53d6186e869fdfc2d92d6b' or p.source_inventory(root)!='0b5b525464dd4a9ef5efbb003c6f42c732bc79dd80db1a024a59fecae18b90bc':raise ValueError('Original source changed')
print(json.dumps({'status':'verified'}))
'@
  $launcher=ConvertTo-PythonBase64Launcher $code 'pi150_original_source_observer.py'
  $result=Invoke-AbsentHelperRecoveryRead $Python @('-B','-c',$launcher)
  if($result.status -cne 'verified'){throw 'Original Pi150 source is unverified'}
}

function Assert-Pi150FailedStartRecoveryBindings([ValidateSet('Initial','Requests','Final')][string]$Stage,[object]$Proof) {
  if($Stage -cne 'Initial'){Assert-AbsentHelperRecoveryWorkerOwner}
  if($Action -cne 'BeginMaintenance' -or $KeepPostgres -ne $true -or $MaintenanceId -cne 'ca1bc9efd18d4263aeb298353ca93714' -or
      (Get-CanonicalPath $RuntimeRoot) -ine 'D:\teruisi-runtime\django-sales' -or
      [IO.Path]::GetFullPath($RecoveryProofPath) -ine 'D:\codex-artifacts\pi-publish-recovery-20261017-v4\absent-helper-proof.json'){
    throw 'Pi150 absent-helper recovery is limited to the exact original operation'
  }
  if(-not (Test-ExactObjectPropertyNames $Proof @('version','operationId','recoveryAttemptId','files','executionFiles','preparedAppId','preparedAppSha256','workerResolved','shortcut','validation','ready')) -or
      $Proof.version -isnot [string] -or $Proof.version -cne 'teruisi-pi150-failed-start-absent-helper-v1' -or
      $Proof.operationId -isnot [string] -or $Proof.operationId -cne $MaintenanceId -or
      $Proof.recoveryAttemptId -isnot [string] -or $Proof.recoveryAttemptId -cnotmatch '^[a-f0-9]{32}$' -or
      $Proof.preparedAppId -isnot [string] -or $Proof.preparedAppId -cnotmatch '^[a-f0-9]{32}$' -or
      $Proof.preparedAppSha256 -isnot [string] -or $Proof.preparedAppSha256 -cnotmatch '^[a-f0-9]{64}$'){
    throw 'Pi150 recovery proof identity or closed fields changed'
  }
  $pins=Get-Pi150FailedStartRecoveryFixedPins
  Assert-Pi150FailedStartRecoveryFileMap $Proof.files $pins
  foreach($file in $pins.PSObject.Properties){
    if($file.Name.EndsWith('.json',[StringComparison]::OrdinalIgnoreCase)){[void](Read-AbsentHelperRecoveryJson $file.Name $file.Value)}
    elseif((Get-FileSha256 $file.Name) -cne $file.Value){throw 'Original Pi150 source file changed'}
  }
  $execution=Get-Pi150FailedStartRecoveryExecutionFiles
  Assert-Pi150FailedStartRecoveryFileMap $Proof.executionFiles $execution
  if(-not (Test-ExactObjectPropertyNames $Proof.validation @('path','sha256'))){throw 'Pi150 private validation is missing'}
  $validation=Read-AbsentHelperRecoveryJson $Proof.validation.path $Proof.validation.sha256
  if($validation.version -isnot [string] -or $validation.version -cne 'teruisi-pi150-absent-helper-tests-v1' -or
      $validation.status -isnot [string] -or $validation.status -cne 'passed' -or
      $validation.productionTouched -isnot [bool] -or $validation.productionTouched -cne $false -or
      $validation.powershell5 -isnot [bool] -or $validation.powershell5 -cne $true -or
      $validation.powershell7 -isnot [bool] -or $validation.powershell7 -cne $true){throw 'Pi150 private PS5/PS7 validation is incomplete'}
  Assert-Pi150FailedStartRecoveryFileMap $validation.executionFiles $execution
  if(-not (Test-ExactObjectPropertyNames $Proof.ready @('path','sha256')) -or $Proof.ready.path -isnot [string] -or
      [IO.Path]::GetFullPath($Proof.ready.path) -ine 'D:\codex-artifacts\pi-publish-recovery-20261017-v4\READY.json'){throw 'Pi150 forward READY reference changed'}
  $ready=Read-AbsentHelperRecoveryJson $Proof.ready.path $Proof.ready.sha256
  if($ready.version -isnot [string] -or $ready.version -cne 'pi150-forward-recovery-v1' -or
      $ready.source -isnot [string] -or (Get-CanonicalPath $ready.source) -ine (Get-CanonicalPath $ExecutionRoot) -or
      $ready.sourceIdentity.commit -isnot [string] -or $ready.sourceIdentity.commit -cnotmatch '^[a-f0-9]{40}$' -or
      $ready.sourceIdentity.tree -isnot [string] -or $ready.sourceIdentity.tree -cnotmatch '^[a-f0-9]{40}$' -or
      $ready.pkg.id -isnot [string] -or $ready.pkg.id -cne $Proof.preparedAppId -or
      $ready.pkg.receiptSha256 -isnot [string] -or $ready.pkg.receiptSha256 -cne $Proof.preparedAppSha256 -or
      $ready.predecessorDjangoSha256 -cne '67696b506801744faf048141b5b4e342e1afa062e48d97669f6e44cf3634fbc2' -or
      $ready.facts.maintenanceId -cne $MaintenanceId -or $ready.facts.schemaOperationId -cne 'ff28fd7d584547dea301b9f3561ae2aa'){
    throw 'Pi150 forward READY does not bind the repair source, operation and prepared app'
  }
  $prepared=Get-PreparedApplication $Proof.preparedAppId $Proof.preparedAppSha256
  if($ready.djangoManifestSha256 -isnot [string] -or (Get-FileSha256 (Join-Path $prepared 'deployment.json')) -cne $ready.djangoManifestSha256){throw 'Pi150 forward READY candidate manifest changed'}
  $manifest=Read-JsonFile (Join-Path $prepared 'deployment.json') 'Pi150 repair candidate'
  if($manifest.sourceRoot -isnot [string] -or (Get-CanonicalPath $manifest.sourceRoot) -ine (Get-CanonicalPath $ExecutionRoot) -or
      (Get-FileSha256 (Join-Path $prepared 'tools\pi150-failed-start-recovery.ps1')) -cne $execution.PSObject.Properties[(Join-Path $ExecutionRoot 'tools\pi150-failed-start-recovery.ps1')].Value -or
      (Get-FileSha256 (Join-Path $prepared 'tools\django-local-service.ps1')) -cne $execution.PSObject.Properties[(Join-Path $ExecutionRoot 'tools\django-local-service.ps1')].Value -or
      (Get-FileSha256 (Join-Path $prepared 'tools\integration_release_gate.py')) -cne $execution.PSObject.Properties[(Join-Path $ExecutionRoot 'tools\integration_release_gate.py')].Value){throw 'Prepared repair application source or execution bytes changed'}
  $node=(Get-Command node.exe -CommandType Application -ErrorAction Stop|Select-Object -First 1).Source
  $resolved=Invoke-AbsentHelperRecoveryRead $node @((Join-Path $ExecutionRoot 'tools\worker-local-release-rotation.mjs'),'resolve','--json')
  if($resolved.status -cne 'resolved' -or $resolved.releaseId -cne '20261017T100706Z-1090ea88f6fe3094' -or
      $resolved.manifestSha256 -cne '5bc9c99602822aa3342e1548e33a7b2ba2b42bb1a446af381bfdcf6a4203041d' -or
      ($resolved.successorCount -isnot [int] -and $resolved.successorCount -isnot [long]) -or $resolved.successorCount -ne 245 -or
      -not (Test-ExactObjectPropertyNames $Proof.workerResolved @($resolved.PSObject.Properties.Name))){throw 'Effective activated Worker changed'}
  foreach($field in $resolved.PSObject.Properties){
    $bound=$Proof.workerResolved.PSObject.Properties[$field.Name].Value
    if($field.Name -ceq 'successorCount'){
      if(($bound -isnot [int] -and $bound -isnot [long]) -or ($field.Value -isnot [int] -and $field.Value -isnot [long]) -or
          $bound -ne 245 -or $bound -ne $field.Value){throw 'Worker successor count changed or has an invalid type'}
    }elseif($bound -isnot [string] -or $field.Value -isnot [string] -or $bound -cne $field.Value){throw 'Worker activation chain binding changed'}
  }
  Assert-Pi150FailedStartRecoveryShortcut $Proof.shortcut
  Assert-Pi150FailedStartRecoverySource
  if(Read-SystemMaintenance){throw 'Pi150 recovery cannot replace or replay an existing maintenance marker'}
  $gate=Read-AutomationDrain
  $intentPath=Assert-RuntimeChildPath (Join-Path $RunDirectory ('pi150-failed-start-recovery-'+$MaintenanceId+'.intent.json'))
  if($Stage -ceq 'Initial'){
    if($null -ne $gate -or (Test-Path -LiteralPath $intentPath)){throw 'Pi150 recovery requires absent original drain and no prior recovery intent'}
  }else{
    $context=$script:Pi150FailedStartRecoveryContext
    if($null -eq $context -or $context.processId -ne $PID -or $context.proofSha256 -cne $RecoveryProofSha256 -or
        $context.executionRoot -cne (Get-CanonicalPath $ExecutionRoot) -or -not $context.drainCreatedAt -or
        (Get-FileSha256 $intentPath) -cne $context.intentSha256 -or
        -not (Test-ExactObjectPropertyNames $gate @('version','id','runtimeRoot','phase','keepPostgres','createdAt')) -or
        $gate.version -isnot [string] -or $gate.version -cne 'teruisi-automation-drain-v1' -or
        $gate.id -isnot [string] -or $gate.id -cne $MaintenanceId -or
        $gate.runtimeRoot -isnot [string] -or $gate.runtimeRoot -ine (Get-CanonicalPath $RuntimeRoot) -or
        $gate.keepPostgres -isnot [bool] -or $gate.keepPostgres -cne $true -or
        $gate.phase -isnot [string] -or $gate.phase -cne 'requests' -or
        $gate.createdAt -isnot [string] -or $gate.createdAt -cne $context.drainCreatedAt){throw 'Pi150 same-process recovery intent or request transition changed'}
  }
  Assert-Pi150FailedStartRecoverySnapshot
  Assert-Pi150FailedStartRecoveryPandas
  Assert-Pi150FailedStartRecoverySnapshot
  return [pscustomobject]@{proof=$Proof;intentPath=$intentPath}
}

function Wait-Pi150FailedStartRecoveryDrain([int]$TimeoutSeconds,[object]$Proof) {
  Assert-AbsentHelperRecoveryWorkerOwner
  $state=Assert-Pi150FailedStartRecoveryBindings 'Initial' $Proof
  $intent=[ordered]@{version='teruisi-pi150-failed-start-recovery-intent-v1';operationId=$MaintenanceId;
    recoveryAttemptId=$Proof.recoveryAttemptId;proofSha256=$RecoveryProofSha256;preparedAppId=$Proof.preparedAppId;
    preparedAppSha256=$Proof.preparedAppSha256;processId=[int]$PID;createdAt=[DateTimeOffset]::UtcNow.ToString('o')}
  $bytes=$Utf8NoBom.GetBytes(($intent|ConvertTo-Json -Depth 8 -Compress))
  $stream=[IO.FileStream]::new($state.intentPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
  $script:Pi150FailedStartRecoveryContext=[pscustomobject]@{processId=[int]$PID;proofSha256=$RecoveryProofSha256;
    executionRoot=(Get-CanonicalPath $ExecutionRoot);intentSha256=(Get-FileSha256 $state.intentPath);drainCreatedAt=$null}
  # This closes helper admission. It does not manufacture a health ACK.
  Set-AutomationDrainPhase 'helpers'
  $gate=Read-AutomationDrain
  if($gate.phase -cne 'helpers' -or $gate.id -cne $MaintenanceId -or $gate.keepPostgres -isnot [bool] -or $gate.keepPostgres -cne $true -or -not $gate.createdAt){throw 'Pi150 helpers admission was not established'}
  $script:Pi150FailedStartRecoveryContext.drainCreatedAt=$gate.createdAt
  $deadline=[DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
  do{
    try{Invoke-BackupConsoleMaintenanceFence {};break}catch{
      if($_.Exception.Message -cne 'Backup task is still active or unresolved; maintenance refused' -or [DateTimeOffset]::UtcNow -ge $deadline){throw}
      Start-Sleep -Milliseconds 500
    }
  }while($true)
  Wait-AutomationActivityLock 'automation-background.lock' $deadline
  Set-AutomationDrainPhase 'requests'
  Wait-AutomationActivityLock 'automation-activity.lock' $deadline
  [void](Assert-AbsentHelperRecoveryBindings 'Requests')
}
