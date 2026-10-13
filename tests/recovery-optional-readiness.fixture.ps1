param([string]$Source)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$t=$null;$e=$null;$a=[Management.Automation.Language.Parser]::ParseFile($Source,[ref]$t,[ref]$e);if($e.Count){throw($e|Out-String)}
$f=$a.FindAll({param($x)$x -is [Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -ceq 'Assert-RecoveryServiceReadiness'},$true);if($f.Count -ne 1){throw 'Actual predicate missing'};. ([scriptblock]::Create($f[0].Extent.Text))
function New-Snapshot { $x=@{probeError=$false;system='Running';backend='Ready';worker='exact_release';components=@{};probes=@{}};1..12|ForEach-Object{$x.components[[string]$_]=$true};1..4|ForEach-Object{$x.probes[[string]$_]=@{ok=$true}};return $x }
$count=0
foreach($shape in @('dictionary','object')){
 foreach($case in @('missing','true','false','string','array','null','component-false','probe-false')){
  $x=New-Snapshot
  switch($case){'true'{$x.controllerHealthValid=$true};'false'{$x.controllerHealthValid=$false};'string'{$x.controllerHealthValid='True'};'array'{$x.controllerHealthValid=@($true)};'null'{$x.controllerHealthValid=('{"value":null}'|ConvertFrom-Json).value};'component-false'{$x.components['1']=$false};'probe-false'{$x.probes['1'].ok=$false}}
  $value=if($shape -ceq 'object'){[pscustomobject]$x}else{$x};$caught=$false
  try{Assert-RecoveryServiceReadiness $value}catch{$caught=$true}
  if($caught -ne ($case -notin @('missing','true'))){throw ('Wrong result '+$shape+'/'+$case)};$count++
 }
}
@{cases=$count;strictLatest=$true;productionActions=0}|ConvertTo-Json -Compress
