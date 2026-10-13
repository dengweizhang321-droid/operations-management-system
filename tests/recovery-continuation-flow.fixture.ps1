param([string]$Source,[string]$Directory)
$ErrorActionPreference='Stop'
$text=[IO.File]::ReadAllText($Source);$start=$text.IndexOf('& $module {')+('& $module {').Length;$end=$text.IndexOf("`n} `$binding",$start);if($start -lt 12 -or $end -lt $start){throw 'Actual flow source shape changed'};$flow=[scriptblock]::Create($text.Substring($start,$end-$start))
function New-StartupRecoveryLease {return @{owned=$true}}
function Enter-StartupRecoveryLease($l){return $true}
function Assert-StartupRecoveryLease($l){}
function Exit-StartupRecoveryLease($l){$script:released++}
function Close-StartupRecoveryLease($l){}
function Get-ProcessDeadline {return 10000}
function Get-ProcessRemaining($d){return 9000}
function Invoke-RecoveryCapture($node,$args,$deadline,$label){if($script:case -ceq 'foreign-before' -and $label -ceq 'continuation-context-before-remove'){throw 'foreign-context'};return @{phase=$label}}
function Test-Path {return (-not $script:removed)}
function Invoke-StartupRecoveryBoundStage($stage,$plan,$deadline){$script:called.Add($stage);if($stage -ceq $script:case){throw 'synthetic-stage-failure'};return @{stage=$stage}}
function Assert-StartupRecoveryStageResult($stage,$value,$plan){if($stage -cne $value.stage){throw 'bad-result'}}
function Confirm-StartupRecoveryFailureFence($p,$exited){$script:refenced++;return @{ownFenceVerified=$true}}
$dummy=Join-Path $Directory 'remove.ps1';[IO.File]::WriteAllText($dummy,"param([switch]`$FunctionsOnly)`nfunction Remove-ExactOwnedRepairMarker {`$script:removed=`$true;return @{deleteDispositionSet=`$true}}")
$watch=New-Module {function Resolve-WatchStatusControl{return @{path='synthetic'}};function Invoke-WatchScript {$c=[ordered]@{};foreach($n in @('core','finance','netshop','market','products','workflow','inventory','customerService','accessControl','erpReference','bi','ai')){$c[$n]=$true};return [pscustomobject]@{backendState='Ready';workerState='exact_release';supervisorProcessId=36568;releaseId='20261011T090355Z-21c2645a63247749';components=[pscustomobject]$c}}}
$backend=New-Module {function Assert-RuntimeRootAclHardened{}}
$script:recovery=@{node='synthetic';watch=$watch;backend=$backend;plan=@{}}
$cases=0
foreach($case in @('success','foreign-before','restore-supervisor','verify-ready','install-diagnostic','verify-installation')){
 $script:case=$case;$script:removed=$false;$script:refenced=0;$script:released=0;$script:called=[Collections.Generic.List[string]]::new();$sub=Join-Path $Directory $case;[IO.Directory]::CreateDirectory($sub)|Out-Null;$b=@{outputRoot=$sub;markerSha256=('a'*64)};$caught=$false
 try{& $flow $b 'synthetic' ('b'*64) 'context' $dummy|Out-Null}catch{$caught=$true}
 if($script:released -ne 1){throw 'Lease not released'}
 if($case -ceq 'success'){if($caught -or ($script:called -join ',') -cne 'restore-supervisor,verify-ready,install-diagnostic,verify-installation' -or $script:refenced){throw 'Wrong continuation order'}}
 elseif($case -ceq 'foreign-before'){if(-not $caught -or $script:removed -or $script:called.Count -ne 0 -or $script:refenced){throw 'Foreign context changed'}}
 else{if(-not $caught -or -not $script:removed -or $script:refenced -ne 1 -or $script:called[-1] -cne $case){throw 'Failure continued or lost fence'}}
 if(@($script:called|Where-Object {$_ -match 'stop|start|enter|exit'}).Count){throw 'Completed prefix replayed'};$cases++
}
@{cases=$cases;allEffectsSynthetic=$true;productionActions=0}|ConvertTo-Json -Compress
