param([string]$RepositoryRoot)
$ErrorActionPreference='Stop'
# Load only the real function bodies through the PowerShell AST. No service
# top-level, CIM, HTTP, production filesystem, task or lifecycle is invoked.
$asts=@{}
foreach($file in @('django-local-service.ps1','operations-system-watchdog.ps1')){
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $RepositoryRoot "tools/$file"),[ref]$tokens,[ref]$errors)
  if($errors.Count){throw "Invalid source: $file"};$asts[$file]=$ast
}
foreach($name in @('Get-ProcessSnapshot','Resolve-OwnedProcess','ConvertTo-CanonicalCreationDate')){
  $fn=$asts['django-local-service.ps1'].Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
  Invoke-Expression $fn.Extent.Text
}
$resolver=$asts['django-local-service.ps1'].Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Resolve-OwnedProcess'},$true).Extent.Text
$watch=$asts['operations-system-watchdog.ps1'].Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Resolve-WatchStatusControl'},$true).Extent.Text
$cases=[Collections.Generic.List[string]]::new()
function Check([string]$Name,[scriptblock]$Body){& $Body;$cases.Add($Name)}
function MustThrow([scriptblock]$Body){$caught=$false;try{& $Body|Out-Null}catch{$caught=$true};if(-not $caught){throw 'Expected rejection'}}
function Assert([bool]$Value){if(-not $Value){throw 'Assertion failed'}}
function Start-Sleep{}
function Get-CanonicalPath([string]$Path){return $Path}
function Get-ProcessCreation($Process){return $Process.CreationDate}
function Get-CimInstance {
  [CmdletBinding()]param([string]$ClassName,[string]$Filter)
  if($script:mode -eq 'error'){throw 'Synthetic CIM access denied'}
  if($script:mode -eq 'absent'){return}
  $script:cimCalls++
  $p=[pscustomobject]@{ProcessId=123;ExecutablePath='C:\fixture\python.exe';CommandLine='fixture launch';CreationDate='2026-10-12T00:00:00.0000000Z'}
  switch($script:mode){'image'{$p.ExecutablePath=$null};'command'{$p.CommandLine=$null};'birth'{$p.CreationDate=$null};'blank'{$p.CommandLine='  '};'duplicate'{return @($p,$p)};'eventually-readable'{if($script:cimCalls -eq 1){$p.CommandLine=$null}}}
  return $p
}
foreach($mode in @('valid','absent','image','command','birth','error','duplicate','blank')){
  $script:mode=$mode
  Check "snapshot-$mode" {
    if($script:mode -eq 'valid'){Assert ((Get-ProcessSnapshot 123 1).ProcessId -eq 123)}
    elseif($script:mode -eq 'absent'){Assert ($null -eq (Get-ProcessSnapshot 123 1))}
    else{MustThrow {Get-ProcessSnapshot 123 1}}
  }
}
Check 'snapshot-incomplete-then-complete' {
  $script:mode='eventually-readable';$script:cimCalls=0
  Assert ((Get-ProcessSnapshot 123 2).ProcessId -eq 123)
  Assert ($script:cimCalls -eq 2)
}
Check 'snapshot-incomplete-through-budget' {
  $script:mode='command';$script:cimCalls=0
  MustThrow {Get-ProcessSnapshot 123 2}
  Assert ($script:cimCalls -eq 2)
}
function Test-Path {param([string]$LiteralPath,[string]$PathType);return $script:recordExists}
function Read-JsonFile {return $script:record}
function Remove-Item {param([string]$LiteralPath,[switch]$Force);$script:removed++}
function Write-LauncherEvent {$script:logged++}
function Remove-PreviousBootProcessRecordIfSafe {$script:previousCalls++;return $script:previousSafe}
function Test-CommandLineReferencesPath {return $true}
function Test-ExactStringArray($Left,$Right){return (($Left -join ',') -ceq ($Right -join ','))}
function Reset-Resolver {
  $script:mode='valid';$script:recordExists=$true;$script:removed=0;$script:logged=0;$script:previousCalls=0;$script:previousSafe=$false;$script:Action='Start'
  $script:record=[pscustomobject]@{version=2;service='fixture';processId=123;configFingerprint=('a'*64);launcherPath='C:\fixture\python.exe';executablePath='C:\fixture\python.exe';commandLine='fixture launch';creationDate='2026-10-12T00:00:00.0000000Z';startedAt='2026-10-12T00:00:00.0000000Z';arguments=@('x')}
}
foreach($case in @('missing-record','readonly-absent','lifecycle-absent','readonly-image','lifecycle-image','readonly-error','lifecycle-error','readonly-reused','lifecycle-reused','readonly-previous-boot','lifecycle-previous-boot','readonly-valid','lifecycle-valid','wrong-service','wrong-fingerprint','status-absent','aggregate-absent','status-false-switch')){
  Reset-Resolver
  Check "resolver-$case" {
    switch($case){
      'missing-record'{$script:recordExists=$false;Assert ($null -eq (Resolve-OwnedProcess fixture fixture 'C:\fixture\python.exe' -ReadOnly))}
      'readonly-absent'{$script:mode='absent';Assert ($null -eq (Resolve-OwnedProcess fixture fixture 'C:\fixture\python.exe' -ReadOnly))}
      'lifecycle-absent'{$script:mode='absent';Resolve-OwnedProcess fixture fixture 'C:\fixture\python.exe'|Out-Null;Assert ($script:removed -eq 1 -and $script:logged -eq 1)}
      'readonly-image'{$script:mode='image';MustThrow {Resolve-OwnedProcess fixture fixture 'C:\fixture\python.exe' -ReadOnly}}
      'lifecycle-image'{$script:mode='image';MustThrow {Resolve-OwnedProcess fixture fixture 'C:\fixture\python.exe'}}
      'readonly-error'{$script:mode='error';MustThrow {Resolve-OwnedProcess fixture fixture 'C:\fixture\python.exe' -ReadOnly}}
      'lifecycle-error'{$script:mode='error';MustThrow {Resolve-OwnedProcess fixture fixture 'C:\fixture\python.exe'}}
      'readonly-reused'{$script:record.creationDate='2026-10-11T00:00:00.0000000Z';MustThrow {Resolve-OwnedProcess fixture fixture 'C:\fixture\python.exe' -ReadOnly};Assert ($script:previousCalls -eq 0)}
      'lifecycle-reused'{$script:record.creationDate='2026-10-11T00:00:00.0000000Z';MustThrow {Resolve-OwnedProcess fixture fixture 'C:\fixture\python.exe'}}
      'readonly-previous-boot'{$script:previousSafe=$true;$script:record.commandLine='old';MustThrow {Resolve-OwnedProcess fixture fixture 'C:\fixture\python.exe' -ReadOnly};Assert ($script:previousCalls -eq 0)}
      'lifecycle-previous-boot'{$script:previousSafe=$true;$script:record.commandLine='old';Assert ($null -eq (Resolve-OwnedProcess fixture fixture 'C:\fixture\python.exe'));Assert ($script:previousCalls -eq 1)}
      'readonly-valid'{Assert ((Resolve-OwnedProcess fixture fixture 'C:\fixture\python.exe' -ReadOnly).ProcessId -eq 123)}
      'lifecycle-valid'{Assert ((Resolve-OwnedProcess fixture fixture 'C:\fixture\python.exe').ProcessId -eq 123)}
      'wrong-service'{$script:record.service='other';MustThrow {Resolve-OwnedProcess fixture fixture 'C:\fixture\python.exe' -ReadOnly}}
      'wrong-fingerprint'{MustThrow {Resolve-OwnedProcess fixture fixture 'C:\fixture\python.exe' -ExpectedFingerprint ('b'*64) -ReadOnly}}
      'status-absent'{$script:Action='status';$script:mode='absent';Resolve-OwnedProcess fixture fixture 'C:\fixture\python.exe'|Out-Null}
      'aggregate-absent'{$script:Action='AggregateStatus';$script:mode='absent';Resolve-OwnedProcess fixture fixture 'C:\fixture\python.exe'|Out-Null}
      'status-false-switch'{$script:Action='FinanceStatus';$script:mode='absent';Resolve-OwnedProcess fixture fixture 'C:\fixture\python.exe' -ReadOnly:$false|Out-Null}
    }
    if($case -ne 'lifecycle-absent'){Assert ($script:removed -eq 0 -and $script:logged -eq 0)}
  }
}
# Seven calls in the actual top-level/aggregate status helper graph explicitly
# retain observational behavior even when invoked from a Start readiness check.
$statusNames=@('Show-ServiceStatus','Show-FinanceServiceStatus','Get-SimpleDjangoDomainStatus','Get-SimpleDjangoReaderStatus')
$calls=@($asts['django-local-service.ps1'].FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -cin $statusNames},$true)|ForEach-Object {$_.FindAll({param($n)$n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -ceq 'Resolve-OwnedProcess'},$true)})
Assert ($calls.Count -eq 7)
foreach($call in $calls){Assert (@($call.CommandElements|Where-Object {$_ -is [Management.Automation.Language.CommandParameterAst] -and $_.ParameterName -ceq 'ReadOnly'}).Count -eq 1)}
# AST extraction has no script file origin. Relocate only its automatic source
# directory variable; all filesystem operations below remain controlled stubs.
$FixtureDriverRoot='C:\fixture\driver'
Invoke-Expression ($watch.Replace('$PSScriptRoot','$FixtureDriverRoot'))
$ProjectRoot='C:\fixture';$ControlPath='C:\fixture\control.ps1';$WorkerPath='C:\fixture\worker.ps1';$BackendRoot='C:\fixture\backend'
$driverNames=@('watchdog-status-control.ps1','watchdog-status-backend.ps1','watchdog-core-overlay.ps1','driver-binding.json')
function Test-Path {param([string]$LiteralPath,[string]$PathType);return ((Split-Path -Leaf $LiteralPath) -cin $script:present)}
function Read-WatchJson {param([string]$Path);if((Split-Path -Leaf $Path) -eq 'bundle.json'){return $script:bundle};return $script:binding}
function Get-WatchHash {param([string]$Path);if($script:hashError){throw 'Synthetic unreadable asset'};return $script:actual[(Split-Path -Leaf $Path)]}
function Reset-Watch {
  $script:present=@($driverNames);$script:bundle=$null;$script:hashError=$false
  $script:binding=[pscustomobject]@{version=1;assetHashes=[pscustomobject]@{control=('a'*64);worker='4c315221d5722b1b90abd8b25f16f95c3df588ab111f4ce4dd070f1b433ded80';backend=('c'*64);transport=('d'*64)}}
  $script:actual=@{'control.ps1'=('a'*64);'worker.ps1'=$script:binding.assetHashes.worker;'django-local-service.ps1'=('c'*64);'process-deadline.ps1'=('d'*64)}
}
foreach($case in @('unconfigured','historical-five','valid-nine','mismatch-control','mismatch-worker','mismatch-backend','mismatch-transport','missing-control','missing-backend','missing-overlay','missing-binding','orphan-binding','all-missing-declared','invalid-version','missing-hash','unreadable-asset','invalid-bundle')){
  Reset-Watch
  Check "watch-$case" {
    switch($case){
      'unconfigured'{$script:present=@()}
      'historical-five'{$script:present=@();$script:bundle=[pscustomobject]@{version=1;files=[pscustomobject]@{'operations-system-watchdog.ps1'='old'}}}
      'valid-nine'{$script:bundle=[pscustomobject]@{version=1;files=[pscustomobject]@{'driver-binding.json'='fixed'}}}
      'mismatch-control'{$script:actual['control.ps1']='b'*64}
      'mismatch-worker'{$script:actual['worker.ps1']='717408ad7b7880617967b5e230ea110c15c58b887532d02bef8eb42236f7bc1e'}
      'mismatch-backend'{$script:actual['django-local-service.ps1']='b'*64}
      'mismatch-transport'{$script:actual['process-deadline.ps1']='b'*64}
      'missing-control'{$script:present=@($driverNames|Where-Object {$_ -ne 'watchdog-status-control.ps1'})}
      'missing-backend'{$script:present=@($driverNames|Where-Object {$_ -ne 'watchdog-status-backend.ps1'})}
      'missing-overlay'{$script:present=@($driverNames|Where-Object {$_ -ne 'watchdog-core-overlay.ps1'})}
      'missing-binding'{$script:present=@($driverNames|Where-Object {$_ -ne 'driver-binding.json'})}
      'orphan-binding'{$script:present=@('driver-binding.json')}
      'all-missing-declared'{$script:present=@();$script:bundle=[pscustomobject]@{version=1;files=[pscustomobject]@{'driver-binding.json'='fixed'}}}
      'invalid-version'{$script:binding.version=2}
      'missing-hash'{$script:binding.assetHashes.worker=$null}
      'unreadable-asset'{$script:hashError=$true}
      'invalid-bundle'{$script:bundle=[pscustomobject]@{version=2;files=[pscustomobject]@{}}}
    }
    if($case -in @('unconfigured','historical-five')){Assert ((Resolve-WatchStatusControl).mode -ceq 'legacy')}
    elseif($case -eq 'valid-nine'){Assert ((Resolve-WatchStatusControl).mode -ceq 'readonly_driver')}
    else{MustThrow {Resolve-WatchStatusControl}}
  }
}
[pscustomobject]@{cases=$cases.Count;names=$cases.ToArray();explicitReadOnlyStatusCalls=$calls.Count;productionCalls=0}|ConvertTo-Json -Depth 4 -Compress
