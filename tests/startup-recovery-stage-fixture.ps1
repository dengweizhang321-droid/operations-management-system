param([string]$Source)
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($Source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
$f=$ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Assert-StartupRecoveryStageResult'},$true)
if($f.Count -ne 1){throw 'One actual stage predicate required'}
. ([scriptblock]::Create($f[0].Extent.Text))
$convert=$ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Convert-ApprovedStopTargets'},$true)
. ([scriptblock]::Create($convert[0].Extent.Text))
$jsonTargets=('{"depth":0}'|ConvertFrom-Json)
$normalized=Convert-ApprovedStopTargets @($jsonTargets)
if($normalized[0].depth -isnot [int]){throw 'Real JSON depth transport not normalized'}
foreach($v in @('0',$true,[double]0,@(0),-1,17)){$rejected=$false;try{Convert-ApprovedStopTargets @([pscustomobject]@{depth=$v})|Out-Null}catch{$rejected=$true};if(-not $rejected){throw 'Unsafe scalar coercion'}}
$plan=[pscustomobject]@{fixed=[pscustomobject]@{repairId='1';workerSha256='2';bundleId='3'};watchdogPlan=[pscustomobject]@{planId='4'}}
$script:recovery=@{targets=@(1,2)}
$positive=@{
 'preflight'=@{planId='4'};'create-intent'=@{status='own-maintenance-created';drainedStopped=$false};'await-drain'=@{phase='requests';id='1';keepPostgres=$true};'stop-declared-instances'=@{status='declared-instances-exited';count=2};'enter-stopped-maintenance'=@{status='maintenance';maintenanceId='1';backendStopped=$true;postgresPreserved=$true};'exit-stopped-maintenance'=@{status='maintenance_ended';maintenanceId='1'};'start-original-stack'=@{status='started';manifestSha256='2'};'verify-ready'=@{healthy=$true;diagnosticMode='readonly_driver'};'install-diagnostic'=@{status='installed';planId='4';bundleId='3'};'verify-installation'=@{status='diagnostic-installation-verified';bundleId='3'}
}
$cases=0
$positive['restore-supervisor']=@{status='supervisor-restoration-requested';readinessPending=$true}
foreach($stage in $positive.Keys){Assert-StartupRecoveryStageResult $stage ([pscustomobject]$positive[$stage]) $plan;$cases++}
foreach($stage in $positive.Keys){$refused=$false;try{Assert-StartupRecoveryStageResult $stage $null $plan}catch{$refused=$true};if(-not $refused){throw 'Null passed'};$cases++}
foreach($value in @('true',@($true),$false)){$refused=$false;try{Assert-StartupRecoveryStageResult 'verify-ready' ([pscustomobject]@{healthy=$value;diagnosticMode='readonly_driver'}) $plan}catch{$refused=$true};if(-not $refused){throw 'Typed readiness accepted invalid value'};$cases++}
foreach($stage in @('enter-stopped-maintenance','exit-stopped-maintenance')){$bad=$positive[$stage].Clone();$bad.maintenanceId='foreign';$refused=$false;try{Assert-StartupRecoveryStageResult $stage ([pscustomobject]$bad) $plan}catch{$refused=$true};if(-not $refused){throw 'Foreign gate passed'};$cases++}
foreach($json in @('{"status":"own-maintenance-created","drainedStopped":"False"}','{"status":"own-maintenance-created","drainedStopped":[false]}','{"status":"maintenance","maintenanceId":"1","backendStopped":"True","postgresPreserved":true}','{"status":"maintenance","maintenanceId":"1","backendStopped":true,"postgresPreserved":[true]}','{"phase":"requests","id":"1","keepPostgres":"True"}','{"phase":"requests","id":"1","keepPostgres":[true]}')){
 $v=$json|ConvertFrom-Json;$stage=if($null -ne $v.drainedStopped){'create-intent'}elseif($null -ne $v.backendStopped){'enter-stopped-maintenance'}else{'await-drain'}
 $rejected=$false;try{Assert-StartupRecoveryStageResult $stage $v $plan}catch{$rejected=$true};if(-not $rejected){throw 'Coerced original boolean accepted'}
}
@{cases=$cases;productionActions=0;scope='actual function extracted into synthetic inputs'}|ConvertTo-Json -Compress
