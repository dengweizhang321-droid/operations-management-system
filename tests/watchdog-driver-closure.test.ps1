$ErrorActionPreference='Stop'
# Generator CLI and closure check against temp copies of this worktree's own tools. Nothing outside
# the temp directory is read or written, and the generated scripts are never executed.
. (Join-Path $PSScriptRoot '..\tools\watchdog-driver-closure.ps1')
$tools=(Resolve-Path (Join-Path $PSScriptRoot '..\tools')).Path
$nodeExe='C:\Program Files\nodejs\node.exe'
if(-not(Test-Path -LiteralPath $nodeExe)){throw 'node is required for this test'}
$base=Join-Path ([IO.Path]::GetTempPath()) ('watchdog-closure-test-'+[guid]::NewGuid().ToString('N'))
$script:checks=0
function Assert-Closure($Condition,[string]$Message){if(-not $Condition){throw $Message};$script:checks++}
$map=[ordered]@{control='operations-system-control.ps1';worker='worker-local-service.ps1';transport='process-deadline.ps1';isolation='native-isolation.ps1';backendIsolation='native-isolation.ps1';backend='django-local-service.ps1';supervisor='django-runtime-supervisor.ps1'}
function New-Sources([string]$Name){
  $dir=Join-Path $base $Name;New-Item -ItemType Directory -Path $dir -Force|Out-Null
  foreach($k in $map.Keys){Copy-Item -LiteralPath (Join-Path $tools $map[$k]) -Destination (Join-Path $dir ($k+'.ps1')) -Force}
  $dir
}
function Invoke-Generator([string]$Name,[string]$Sources){
  $out=Join-Path $base ($Name+'-out');$bound=@{};foreach($k in $map.Keys){$bound[$k]=Join-Path $Sources ($k+'.ps1')}
  $request=Join-Path $base ($Name+'-request.json')
  [IO.File]::WriteAllText($request,(@{outputDirectory=$out;readDirectory=$Sources;bound=$bound}|ConvertTo-Json -Depth 4))
  $stdout=& $nodeExe (Join-Path $tools 'watchdog-driver-generate.mjs') $request 2>$null
  @{exit=$LASTEXITCODE;stdout=($stdout -join "`n");out=$out}
}
function Edit-File([string]$Path,[string]$Pattern,[string]$Replacement){
  $text=[IO.File]::ReadAllText($Path);$new=[regex]::Replace($text,$Pattern,$Replacement,1)
  if($new -ceq $text){throw 'injection pattern not found: '+$Pattern}
  [IO.File]::WriteAllText($Path,$new)
}
try{
  New-Item -ItemType Directory -Path $base -Force|Out-Null

  # 1. Generator success and closure over the real (worktree) sources.
  $sources=New-Sources 'good'
  $run=Invoke-Generator 'good' $sources
  Assert-Closure ($run.exit -eq 0 -and $run.stdout -match '"ok":true') ('generator failed on unchanged sources: '+$run.stdout)
  foreach($f in 'watchdog-status-control.ps1','watchdog-status-backend.ps1','watchdog-core-overlay.ps1','driver-binding.json','native-isolation.ps1','process-deadline.ps1'){Assert-Closure (Test-Path -LiteralPath (Join-Path $run.out $f)) ('generated driver lacks '+$f)}
  $good=Invoke-WatchDriverClosureCheck $run.out $sources
  Assert-Closure ($good.ok -and $good.excepted -gt 0 -and @($good.reasons).Count -eq 0) ('closure check refused the sound driver: '+($good.reasons -join ','))
  Assert-Closure (@($script:WatchClosureExceptions).Count -le 25) 'exception table grew past its limit'

  # 2. Closure injections: each must be refused.
  $overlay=Join-Path $run.out 'watchdog-core-overlay.ps1'
  $original=[IO.File]::ReadAllText($overlay)
  $anchor='(?m)^(function Invoke-ReadonlyMetadataObservation[^{\r\n]*\{)'
  foreach($case in @(
    @{name='pid-record delete';code='Remove-Item -LiteralPath $PidPath -Force';reason='closure_forbidden_primitive'},
    @{name='Stop-Process';code='Stop-Process -Id 1 -Force';reason='closure_forbidden_primitive'},
    @{name='taskkill';code='& taskkill.exe /PID 1';reason='closure_forbidden_primitive'},
    @{name='dynamic call outside the table';code='$injected={};& $injected';reason='closure_forbidden_primitive';anchor='(?m)^(function Get-ReadonlyDiagnosticSnapshot[^{\r\n]*\{)'}
  )){
    [IO.File]::WriteAllText($overlay,$original)
    Edit-File $overlay $(if($case.anchor){$case.anchor}else{$anchor}) ('$1 '+$case.code+';')
    $bad=Invoke-WatchDriverClosureCheck $run.out $sources
    Assert-Closure ((-not $bad.ok) -and $case.reason -in @($bad.reasons)) ('closure check accepted an injected '+$case.name)
  }
  [IO.File]::WriteAllText($overlay,$original)
  Assert-Closure ((Invoke-WatchDriverClosureCheck $run.out $sources).ok) 'restoring the overlay did not restore a passing check'

  # 3. An ownership function that starts calling something outside the allow-list.
  Edit-File $overlay '(?s)(function Resolve-OwnedProcess.*?\)\s*\{)' '$1 Invoke-UnreviewedHelper;'
  $own=Invoke-WatchDriverClosureCheck $run.out $sources
  [IO.File]::WriteAllText($overlay,$original)
  Assert-Closure ((-not $own.ok) -and @($own.reasons|Where-Object {$_ -like 'ownership_*'}).Count -ge 1) 'an unlisted ownership call was accepted'

  # 3b. Review round 1, item 4: every injection form the reviewer found (all were accepted before).
  function Add-Injection([string]$Path,[string]$Anchor,[string]$Code){
    $text=[IO.File]::ReadAllText($Path);$m=[regex]::Match($text,$Anchor)
    if(-not $m.Success){throw 'injection anchor not found: '+$Anchor}
    [IO.File]::WriteAllText($Path,$text.Substring(0,$m.Index+$m.Length)+"`n"+$Code+"`n"+$text.Substring($m.Index+$m.Length))
  }
  function Test-Refused([string]$Path,[string]$Original,[string]$Anchor,[string]$Code,[string]$Why,[string]$Expect='closure_forbidden_primitive'){
    [IO.File]::WriteAllText($Path,$Original)
    Add-Injection $Path $Anchor $Code
    $r=Invoke-WatchDriverClosureCheck $run.out $sources
    [IO.File]::WriteAllText($Path,$Original)
    Assert-Closure ((-not $r.ok) -and $Expect -in @($r.reasons) -and @($r.hits).Count -ge 1) ('closure check accepted: '+$Why)
    $r
  }
  $obs='(?m)^function Invoke-ReadonlyMetadataObservation[^{\r\n]*\{'
  foreach($case in @(
    @('copy pid into variable then delete','$p=$PidPath; Remove-Item $p'),
    @('pipe pid into Remove-Item','$PidPath | Remove-Item'),
    @('braced variable','Remove-Item ${PidPath}'),
    @('splatted Remove-Item','$a=@{Path=''x''}; Remove-Item @a'),
    @('object Delete()','(Get-Item $PidPath).Delete()'),
    @('redirection to pid path','"" > $PidPath'),
    @('Start-Process taskkill','Start-Process taskkill.exe'),
    @('absolute-path taskkill','& ''C:\Windows\System32\taskkill.exe'' /PID 1'),
    @('cmd /c taskkill','cmd /c taskkill /PID 1'),
    @('Diagnostics.Process Start','[Diagnostics.Process]::Start(''taskkill.exe'',''/PID 1'')'),
    @('scriptblock Create','[scriptblock]::Create(''1'').Invoke()'),
    @('Invoke-Expression','Invoke-Expression ''1'''),
    @('Set-Content','Set-Content -Path x -Value 1'),
    @('Kill()','(Get-Process -Id 1).Kill()'),
    @('ExecutionContext','$ExecutionContext.InvokeCommand.ExpandString(''1'')')
  )){
    [void](Test-Refused $overlay $original $obs $case[1] $case[0])
  }

  # 3c. Item 2: an exception covers only the exact hit it pins; a second hit or a different one is refused.
  $transport=Join-Path $sources 'transport.ps1';$transportOriginal=[IO.File]::ReadAllText($transport)
  try{
    $r=Test-Refused $transport $transportOriginal '(\[string\]\$Cleanup = ''Preserve''\))' '(Get-Process -Id 1).Kill()' 'extra Kill() inside the excepted Invoke-DeadlineProcess'
    Assert-Closure (@($r.hits|Where-Object {$_.profile -ceq 'control' -and $_.function -ceq 'Invoke-DeadlineProcess' -and $_.primitive -ceq '.kill()'}).Count -eq 2) 'the excepted function must report all of its Kill() hits once one is extra'
  }finally{[IO.File]::WriteAllText($transport,$transportOriginal)}
  [void](Test-Refused $overlay $original $obs '$t=''taskkill.exe''; & $t /PID 1' 'taskkill through a variable inside the excepted Invoke-ReadonlyMetadataObservation')
  Assert-Closure ((Invoke-WatchDriverClosureCheck $run.out $sources).ok) 'restoring after exception tests did not restore a passing check'

  # 3d. Item 3: the control copy is scanned across its whole Status dispatch (try/catch included);
  # only the other switch branches are left out.
  $control=Join-Path $run.out 'watchdog-status-control.ps1';$controlOriginal=[IO.File]::ReadAllText($control)
  [void](Test-Refused $control $controlOriginal '(?s)if \(\$Action -ne "Panel"\) \{.*?\} catch \{' 'Stop-Process -Id 1' 'Stop-Process in the dispatcher catch block')
  [void](Test-Refused $control $controlOriginal '(?s)if \(\$Action -ne "Panel"\) \{\s*try \{' 'Stop-Process -Id 1' 'Stop-Process in the dispatcher try block outside the switch')
  [IO.File]::WriteAllText($control,$controlOriginal)
  $text=$controlOriginal.Replace('"Start" { Invoke-SystemStart }','"Start" { Stop-Process -Id 1 }')
  Assert-Closure ($text -cne $controlOriginal) 'the Start switch branch was not found'
  [IO.File]::WriteAllText($control,$text)
  $branch=Invoke-WatchDriverClosureCheck $run.out $sources
  [IO.File]::WriteAllText($control,$controlOriginal)
  Assert-Closure $branch.ok 'a non-Status switch branch must stay out of the scan'

  # 3e. Item 7: the function table follows the real load order; the later definition is the one scanned.
  $supervisorPath=Join-Path $sources 'supervisor.ps1';$supervisorOriginal=[IO.File]::ReadAllText($supervisorPath)
  $backendPath=Join-Path $sources 'backend.ps1';$backendOriginal=[IO.File]::ReadAllText($backendPath)
  $dangerous='function Test-LoadOrderProbe { Remove-Item -LiteralPath x }';$clean='function Test-LoadOrderProbe { return 1 }'
  try{
    [IO.File]::WriteAllText($overlay,$original)
    Add-Injection $overlay $obs 'Test-LoadOrderProbe;'
    # The supervisor library re-dot-sources the Django library after its own earlier definitions.
    Add-Injection $supervisorPath '(?m)^\$previousLibraryOnly = \[Environment\]' $clean
    [IO.File]::WriteAllText($backendPath,$backendOriginal+"`n"+$dangerous+"`n")
    $a=Invoke-WatchDriverClosureCheck $run.out $sources
    Assert-Closure (@($a.hits|Where-Object {$_.profile -ceq 'wrapper-supervisor' -and $_.function -ceq 'Test-LoadOrderProbe' -and $_.script -ceq 'backend'}).Count -eq 1) 'a supervisor-library definition loaded before the Django re-load must be shadowed by the Django one'
    # A definition loaded last (end of the supervisor library) wins.
    [IO.File]::WriteAllText($supervisorPath,$supervisorOriginal+"`n"+$dangerous+"`n")
    [IO.File]::WriteAllText($backendPath,$backendOriginal+"`n"+$clean+"`n")
    $b=Invoke-WatchDriverClosureCheck $run.out $sources
    Assert-Closure (@($b.hits|Where-Object {$_.profile -ceq 'wrapper-supervisor' -and $_.function -ceq 'Test-LoadOrderProbe' -and $_.script -ceq 'supervisor'}).Count -eq 1) 'the supervisor definition loaded last must be the one scanned'
  }finally{
    [IO.File]::WriteAllText($overlay,$original);[IO.File]::WriteAllText($supervisorPath,$supervisorOriginal);[IO.File]::WriteAllText($backendPath,$backendOriginal)
  }
  Assert-Closure ((Invoke-WatchDriverClosureCheck $run.out $sources).ok) 'restoring after load-order tests did not restore a passing check'

  # 3f. The Move-SupervisorStatePreviousGeneration exception is conditional on its call sites: the
  # status wrapper may pass only Strict/AllowPreviousStopped (or nothing), the function may be called
  # only by Read-SupervisorState, and the Mode gate around that call keeps its pinned text.
  $wrapperPath=Join-Path $run.out 'watchdog-status-backend.ps1';$wrapperOriginal=[IO.File]::ReadAllText($wrapperPath)
  $archiveHits={param($r) @($r.hits|Where-Object {$_.profile -ceq 'wrapper-supervisor' -and $_.function -ceq 'Move-SupervisorStatePreviousGeneration' -and $_.primitive -ceq 'move-item'}).Count}
  Assert-Closure ($wrapperOriginal -cmatch 'Read-SupervisorState "AllowPreviousStopped"') 'the wrapper no longer reads the supervisor state with AllowPreviousStopped'
  $archiveException=@($script:WatchClosureExceptions|Where-Object {$_.function -ceq 'Move-SupervisorStatePreviousGeneration'})
  Assert-Closure ($archiveException.Count -eq 1 -and $archiveException[0].callsite) 'the archive exception must carry a call-site condition'
  try{
    foreach($case in @(
      @{name='ArchivePreviousStopped literal';replacement='Read-SupervisorState "ArchivePreviousStopped"'},
      @{name='variable mode';replacement='$m = "ArchivePreviousStopped"; Read-SupervisorState $m'},
      @{name='named variable mode';replacement='Read-SupervisorState -Mode $env:X'},
      @{name='parameter-name prefix';replacement='Read-SupervisorState -Mo ArchivePreviousStopped'},
      @{name='one-letter parameter-name prefix';replacement='Read-SupervisorState -M ArchivePreviousStopped'},
      @{name='unknown parameter name carrying the mode';replacement='Read-SupervisorState -X ArchivePreviousStopped'},
      @{name='unknown parameter name with a colon argument';replacement='Read-SupervisorState -X:ArchivePreviousStopped'},
      @{name='direct caller of the archive function';replacement='Move-SupervisorStatePreviousGeneration "x"; Read-SupervisorState "AllowPreviousStopped"'}
    )){
      [IO.File]::WriteAllText($wrapperPath,$wrapperOriginal)
      Edit-File $wrapperPath 'Read-SupervisorState "AllowPreviousStopped"' $case.replacement
      $r=Invoke-WatchDriverClosureCheck $run.out $sources
      Assert-Closure ((-not $r.ok) -and (& $archiveHits $r) -ge 1) ('the archive exception must not apply for: '+$case.name)
    }
    # Positive controls: a default mode, an explicit Strict and a named allowed mode stay accepted.
    foreach($allowed in @('Read-SupervisorState','Read-SupervisorState "Strict"','Read-SupervisorState -Mode "AllowPreviousStopped"')){
      [IO.File]::WriteAllText($wrapperPath,$wrapperOriginal)
      Edit-File $wrapperPath 'Read-SupervisorState "AllowPreviousStopped"' $allowed
      Assert-Closure ((Invoke-WatchDriverClosureCheck $run.out $sources).ok) ('an allowed call form was refused: '+$allowed)
    }
    # Round 3, item 2: the pin covers the whole Read-SupervisorState definition, not just the gate.
    foreach($case in @(
      @{name='default mode changed to Archive';pattern='(\[string\]\$Mode = )"Strict"';replacement='$1"ArchivePreviousStopped"'},
      @{name='Mode reassigned before the gate';pattern='(\[string\]\$Mode = "Strict"\r?\n\) \{)';replacement='$1 $Mode = "ArchivePreviousStopped";'}
    )){
      [IO.File]::WriteAllText($supervisorPath,$supervisorOriginal)
      Edit-File $supervisorPath $case.pattern $case.replacement
      $r=Invoke-WatchDriverClosureCheck $run.out $sources
      Assert-Closure ((-not $r.ok) -and (& $archiveHits $r) -ge 1) ('the archive exception must not apply when: '+$case.name)
    }
    [IO.File]::WriteAllText($supervisorPath,$supervisorOriginal)
    # Removing the Mode gate inside Read-SupervisorState would make AllowPreviousStopped archive.
    [IO.File]::WriteAllText($wrapperPath,$wrapperOriginal)
    Edit-File $supervisorPath '(?s)if \(\$Mode -ceq "ArchivePreviousStopped"\) \{(\s*Move-SupervisorStatePreviousGeneration)' 'if ($true) {$1'
    $gate=Invoke-WatchDriverClosureCheck $run.out $sources
    Assert-Closure ((-not $gate.ok) -and (& $archiveHits $gate) -ge 1) 'removing the Mode gate around the archive call must void the exception'
  }finally{
    [IO.File]::WriteAllText($wrapperPath,$wrapperOriginal);[IO.File]::WriteAllText($supervisorPath,$supervisorOriginal)
  }
  Assert-Closure ((Invoke-WatchDriverClosureCheck $run.out $sources).ok) 'restoring after call-site tests did not restore a passing check'

  # 3g. Round 3, item 1: the dynamic-call exceptions only hold while every reached call site hands in a
  # script block literal, and a function named without being called counts as a call to it.
  $viaDynamic='Invoke-InProcessJsonStatus ${function:Remove-PreviousBootProcessRecordIfSafe} ''x'''
  foreach($case in @(
    @('${function:} reference passed as the script block',$viaDynamic),
    @('$function: reference passed as the script block','Invoke-InProcessJsonStatus $function:Remove-PreviousBootProcessRecordIfSafe ''x'''),
    @('(Get-Command X).ScriptBlock passed as the script block','Invoke-InProcessJsonStatus (Get-Command Remove-PreviousBootProcessRecordIfSafe).ScriptBlock ''x'''),
    @('(Get-Item function:X).ScriptBlock passed as the script block','Invoke-InProcessJsonStatus (Get-Item function:Remove-PreviousBootProcessRecordIfSafe).ScriptBlock ''x'''),
    @('script block held in a variable (Invoke-InProcessJsonStatus)','$sb={ 1 }; Invoke-InProcessJsonStatus $sb ''x'''),
    @('named script block variable (Invoke-InProcessJsonStatus)','$sb={ 1 }; Invoke-InProcessJsonStatus -Operation $sb -Label ''x'''),
    @('script block variable (Invoke-ReadonlyMetadataObservation)','$sb={ 1 }; Invoke-ReadonlyMetadataObservation $sb'),
    @('(Get-Command $name).ScriptBlock with a computed name','$n=''Remove-X''; $z=(Get-Command $n).ScriptBlock')
  )){
    $r=Test-Refused $overlay $original $obs $case[1] $case[0]
  }
  # A literal script block stays accepted.
  [IO.File]::WriteAllText($overlay,$original);Add-Injection $overlay $obs 'Invoke-InProcessJsonStatus { 1 } ''x'''
  $literal=Invoke-WatchDriverClosureCheck $run.out $sources
  [IO.File]::WriteAllText($overlay,$original)
  Assert-Closure $literal.ok 'a literal script block argument was refused'
  # A reference alone (never called) pulls the referenced function into the scan.
  $dangerousRef='function Test-LoadOrderProbe { Remove-Item -LiteralPath x }'
  try{
    [IO.File]::WriteAllText($backendPath,$backendOriginal+"`n"+$dangerousRef+"`n")
    Add-Injection $overlay $obs '$f=${function:Test-LoadOrderProbe}'
    $ref=Invoke-WatchDriverClosureCheck $run.out $sources
    Assert-Closure ((-not $ref.ok) -and @($ref.hits|Where-Object {$_.function -ceq 'Test-LoadOrderProbe'}).Count -ge 1) 'a function reference must put the referenced function into the closure'
    [IO.File]::WriteAllText($overlay,$original)
    Add-Injection $overlay $obs '$f=(Get-Command Test-LoadOrderProbe)'
    $ref2=Invoke-WatchDriverClosureCheck $run.out $sources
    Assert-Closure ((-not $ref2.ok) -and @($ref2.hits|Where-Object {$_.function -ceq 'Test-LoadOrderProbe'}).Count -ge 1) 'Get-Command X must put the referenced function into the closure'
  }finally{
    [IO.File]::WriteAllText($overlay,$original);[IO.File]::WriteAllText($backendPath,$backendOriginal)
  }
  Assert-Closure ((Invoke-WatchDriverClosureCheck $run.out $sources).ok) 'restoring after reference tests did not restore a passing check'
  # An extra caller of Invoke-BoundedNativeProcess voids its exception (the executable is not checkable).
  [void](Test-Refused $overlay $original $obs 'Invoke-BoundedNativeProcess ''C:\x.exe'' @()' 'new caller of Invoke-BoundedNativeProcess')

  # 3h. Round 3, item 3: further process / CIM / WMI / write / dynamic-execution forms.
  foreach($case in @(
    @('Invoke-CimMethod','Invoke-CimMethod -ClassName Win32_Process -MethodName Terminate'),
    @('Remove-CimInstance','Get-CimInstance Win32_Process | Remove-CimInstance'),
    @('Set-CimInstance','Set-CimInstance -InputObject $x'),
    @('Invoke-WmiMethod','Invoke-WmiMethod -Class Win32_Process -Name Create'),
    @('Remove-WmiObject','Remove-WmiObject -InputObject $x'),
    @('New-Item','New-Item -ItemType File -Path x'),
    @('Copy-Item','Copy-Item -LiteralPath a -Destination b'),
    @('[powershell]::Create','[powershell]::Create()'),
    @('.AddScript(','$p.AddScript(''1'')'),
    @('[runspacefactory]','[runspacefactory]::CreateRunspace()')
  )){
    [void](Test-Refused $overlay $original $obs $case[1] $case[0])
  }

  # 4. Generator rejections are structured (exit 3) and unrelated failures are not.
  $shape=New-Sources 'shape'
  [IO.File]::WriteAllText((Join-Path $shape 'supervisor.ps1'),"# not the supervisor`r`n")
  $rejected=Invoke-Generator 'shape' $shape
  Assert-Closure ($rejected.exit -eq 3 -and $rejected.stdout -match '"rejected":true' -and $rejected.stdout -match '"code":"[a-z_]+"') ('a changed source shape must be a structured rejection, got '+$rejected.exit)
  $missing=New-Sources 'missing'
  Remove-Item -LiteralPath (Join-Path $missing 'worker.ps1') -Force
  $transient=Invoke-Generator 'missing' $missing
  Assert-Closure ($transient.exit -ne 0 -and $transient.exit -ne 3) 'a missing source is a transient failure, not a cacheable rejection'

  @{passed=$script:checks;productionTouched=$false}|ConvertTo-Json -Compress
}finally{
  if([IO.Path]::GetFullPath($base).StartsWith([IO.Path]::GetTempPath()) -and (Split-Path $base -Leaf) -match '^watchdog-closure-test-[0-9a-f]{32}$'){Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue}
}
