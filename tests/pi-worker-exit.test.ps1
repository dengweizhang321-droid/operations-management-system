param([switch]$Native,[string]$Python='python.exe')
$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$root=Join-Path ([IO.Path]::GetTempPath()) ('pi-native-exit-'+[Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
function Import-Functions([string]$File,[string[]]$Names){
 $errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($File,[ref]$null,[ref]$errors)
 if($errors.Count){throw 'Invalid controller syntax'}
 foreach($name in $Names){$f=@($ast.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -ceq $name});if($f.Count -ne 1){throw ('Missing exact function '+$name)};. ([scriptblock]::Create($f[0].Extent.Text))}
}
# Dot-source the importer so its exact AST functions remain in this scope.
$common=Join-Path $workspace 'tools/django-local-service.ps1'
. Import-Functions $common @('Get-CanonicalPath','Get-FileSha256','Get-ExistingFileSha256','Get-ProcessCreation','ConvertTo-CanonicalCreationDate','Get-ProcessSnapshot','Resolve-OwnedProcess','Stop-OwnedProcess','Start-ManagedProcess','ConvertTo-ProcessArgument','Write-AtomicJson','Read-JsonFile','Test-ExactObjectPropertyNames','Test-CommandLineReferencesPath')
. Import-Functions (Join-Path $workspace 'tools/django-ai.ps1') @('Get-PiWorkerArguments','Wait-PiWorkerExit','Stop-PiRuntime')
$Utf8NoBom=[Text.UTF8Encoding]::new($false);$RunId=[Guid]::NewGuid().ToString('N');$Action='Stop'
$PiWorkerPidPath=Join-Path $root 'worker.pid.json';$PiWorkerControlPath=Join-Path $root 'control.json'
function Write-LauncherEvent {}
function Write-DjangoStartupTiming {}
function Test-ProcessRecordFromPreviousBoot {return $false}
function Read-PiConfig {return [pscustomobject]@{enabled=$true}}
$script:runnerStops=0
function Invoke-PiLifecycle([string]$Verb){if($Verb -cne 'stop'){throw 'Unexpected runner call'};$script:runnerStops++}
function Stop-VerifiedProcessTree {throw 'No process may be killed by this private stop fixture'}
$token=[Guid]::NewGuid().ToString('N')
function Reset-Control {Write-AtomicJson $PiWorkerControlPath ([ordered]@{version=1;token=$token;intent='running'});Write-AtomicJson "$PiWorkerControlPath.stopped" ([ordered]@{version=1;token=$token;status='stopped'})}
try{
 if($Native){
  $Python=(Get-Command $Python -ErrorAction Stop).Source
  $previousPythonPath=$env:PYTHONPATH;$previousBytecode=$env:PYTHONDONTWRITEBYTECODE
  $env:PYTHONPATH=Join-Path $workspace 'backend';$env:PYTHONDONTWRITEBYTECODE='1'
  Reset-Control
  Remove-Item -LiteralPath "$PiWorkerControlPath.stopped"
  $arguments=@('-u','-B',(Join-Path $workspace 'tests/pi-worker-exit-fixture.py'),$root,'--control-file',$PiWorkerControlPath,'--control-token',$token)
  $process=Start-ManagedProcess 'django-ai-pi-worker' $Python $arguments $root $PiWorkerPidPath ('a'*64) (Join-Path $root 'stdout.log') (Join-Path $root 'stderr.log')
  $deadline=[DateTimeOffset]::UtcNow.AddSeconds(30)
  while(-not (Test-Path -LiteralPath (Join-Path $root 'READY.json'))){if([DateTimeOffset]::UtcNow -ge $deadline -or -not (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue)){throw ('Real worker never reached its empty main loop: '+[IO.File]::ReadAllText((Join-Path $root 'stderr.log')))};Start-Sleep -Milliseconds 100}
  $ready=Read-JsonFile (Join-Path $root 'READY.json') 'private readiness'
  if($ready.mainLoopQueries -ne 2 -or $ready.queuedOperations -ne 0){throw 'Private queue readiness invalid'}
  Stop-PiRuntime
  if($script:runnerStops -ne 1 -or (Test-Path -LiteralPath $PiWorkerPidPath) -or (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue)){throw 'Real worker stop did not close exactly once'}
  $ack=Read-JsonFile "$PiWorkerControlPath.stopped" 'real worker ack'
  if($ack.token -cne $token -or $ack.status -cne 'stopped'){throw 'Real worker did not acknowledge same token'}
  if([IO.File]::ReadAllText((Join-Path $root 'stderr.log')).Trim()){throw 'Real worker wrote a failure to stderr'}
  Write-Output 'Real original pi_worker.main empty-loop -> exact receipt -> same-token Stop passed; runner lifecycle not executed'
 }else{
  $Python='C:\private\python.exe';$created=[DateTime]::UtcNow
  $expected=[pscustomobject]@{ProcessId=123;CreationDate=$created.ToString('o');ExecutablePath=$Python;CommandLine='private-pi-worker'}
  $script:expected=$expected
  function Resolve-OwnedProcess {return $script:expected}
  function Stop-OwnedProcess {$script:cleanups++}
  function Start-Sleep {}
  foreach($scenario in @('transient','query-error','multiple','creation','image','command','receipt','control','ack-missing','ack-token','unreadable-timeout')){
   $script:scenario=$scenario;$script:poll=0;$script:runnerStops=0;$script:cleanups=0
   [IO.File]::WriteAllText($PiWorkerPidPath,'original receipt');Reset-Control
   if($scenario -ceq 'ack-missing'){Remove-Item -LiteralPath "$PiWorkerControlPath.stopped"}
   if($scenario -ceq 'ack-token'){Write-AtomicJson "$PiWorkerControlPath.stopped" @{version=1;token=('b'*32);status='stopped'}}
   function Get-CimInstance {
    $script:poll++
    if($script:scenario -ceq 'query-error'){throw 'CIM query failed'}
    $row=[pscustomobject]@{ProcessId=123;CreationDate=$created;ExecutablePath=$Python;CommandLine='private-pi-worker'}
    if($script:scenario -ceq 'multiple'){return @($row,$row)}
    if($script:scenario -ceq 'creation'){$row.CreationDate=$created.AddSeconds(1);return $row}
    if($script:scenario -ceq 'image'){$row.ExecutablePath='C:\other.exe';return $row}
    if($script:scenario -ceq 'command'){$row.CommandLine='other';return $row}
    if($script:scenario -ceq 'receipt'){[IO.File]::WriteAllText($PiWorkerPidPath,'changed');return $row}
    if($script:scenario -ceq 'control'){[IO.File]::WriteAllText($PiWorkerControlPath,'changed');return $row}
    if($script:scenario -ceq 'unreadable-timeout'){return [pscustomobject]@{ProcessId=123;CreationDate=$null;ExecutablePath=$null;CommandLine=$null}}
    if($script:poll -eq 1){$row.ExecutablePath=$null;$row.CommandLine=$null;return $row}
    if($script:poll -eq 2){return $row}
    return
   }
   $failed=$false
   try{
    if($scenario -ceq 'unreadable-timeout'){Wait-PiWorkerExit $expected (Get-FileSha256 $PiWorkerPidPath) (Get-FileSha256 $PiWorkerControlPath) ([DateTimeOffset]::UtcNow.AddMilliseconds(20))}
    else{Stop-PiRuntime}
   }catch{$failed=$true}
   if($scenario -ceq 'transient'){
    if($failed -or $script:cleanups -ne 1 -or $script:runnerStops -ne 1 -or $script:poll -ne 3){throw 'Transient -> same -> absent did not close exactly once'}
   }elseif(-not $failed -or $script:cleanups -ne 0 -or $script:runnerStops -ne 0 -or -not (Test-Path -LiteralPath $PiWorkerPidPath)){throw ('Unknown stop was allowed to clean or stop runner: '+$scenario)}
  }
  Write-Output '11 private Pi exit cases passed; no unknown case cleaned ownership or stopped runner'
 }
}finally{
 if($Native){$env:PYTHONPATH=$previousPythonPath;$env:PYTHONDONTWRITEBYTECODE=$previousBytecode}
 if($Native -and $process -and (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue)){
  # Only our exact created process can be cleaned up after a failed fixture.
  $snapshot=Get-ProcessSnapshot $process.ProcessId 1
  if($snapshot -and $snapshot.CreationDate -ceq (Get-ProcessCreation $process)){Stop-Process -Id $process.ProcessId -Force}
 }
 $resolved=[IO.Path]::GetFullPath($root)
 if(-not $resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -cnotlike 'pi-native-exit-*'){throw 'Unsafe private fixture cleanup'}
 Remove-Item -LiteralPath $root -Recurse -Force
}
