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
