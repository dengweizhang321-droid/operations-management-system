param([Parameter(Mandatory)][string]$Observer,[Parameter(Mandatory)][string]$Source)
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$t=$null;$e=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($Observer,[ref]$t,[ref]$e);if($e.Count){throw 'Observer parse failed'}
foreach($name in @('Hash-File','Read-Object','Require-Hash','Save-New')){$node=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true))[0];. ([scriptblock]::Create($node.Extent.Text))}
Add-Type -TypeDefinition 'using System;using System.Threading;using System.Threading.Tasks;public static class PrivateMutexProbe { public static bool Available(string name) { return Task.Run(()=> {using(var m=new Mutex(false,name)) {bool ok=m.WaitOne(0);if(ok)m.ReleaseMutex();return ok;}}).Result;}}'
$script:privateRoot=Join-Path ([IO.Path]::GetTempPath()) ('6dc-gate-'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path (Join-Path $script:privateRoot 'tools'),(Join-Path $script:privateRoot 'execution')|Out-Null
$workerName='Local\TERUISI.Test.6dc.Worker.'+[Guid]::NewGuid().ToString('N');$djangoName='Local\TERUISI.Test.6dc.Django.'+[Guid]::NewGuid().ToString('N')
$moduleFile=Join-Path $script:privateRoot 'tools\manual-maintenance-lock.psm1';Copy-Item -LiteralPath (Join-Path $Source 'tools\manual-maintenance-lock.psm1') -Destination $moduleFile
$native=Join-Path $script:privateRoot 'native.ps1';$nativeText=@'
param([string]$Action,[string]$MaintenanceId,[switch]$KeepPostgres,[switch]$Json)
if($PID -ne $global:FiniteGateTest.pid){throw 'Native operation not on same process/thread scope'}
if([PrivateMutexProbe]::Available($global:FiniteGateTest.worker)){throw 'Worker lock was released before native call'}
if(-not [PrivateMutexProbe]::Available($global:FiniteGateTest.django)){throw 'Django lock was held into native call'}
if(-not (Test-Path -LiteralPath (Join-Path $global:FiniteGateTest.root 'execution\ENTER-MAINTENANCE-BOUNDARY.json'))){throw 'Native call before durable boundary'}
$global:FiniteGateTest.calls++
@{status='maintenance';maintenanceId=$MaintenanceId;postgresPreserved=[bool]$KeepPostgres;backendStopped=$true}|ConvertTo-Json -Compress
$global:LASTEXITCODE=0
'@
[IO.File]::WriteAllText($native,$nativeText,[Text.UTF8Encoding]::new($false))
$manifest=@{native=@{}};$manifest.native[$moduleFile]=Hash-File $moduleFile;[IO.File]::WriteAllText((Join-Path $script:privateRoot 'MANIFEST.json'),($manifest|ConvertTo-Json -Depth 5))
$script:intent=@{source=$script:privateRoot;outputDirectory=(Join-Path $script:privateRoot 'execution');oldWorker=$native;maintenanceId='5fe642a2602243ca83819253d8848e57';codeManifestSha256=(Hash-File (Join-Path $script:privateRoot 'MANIFEST.json'))};$InputPath=Join-Path $script:privateRoot 'RECOVERY-INTENT.json';[IO.File]::WriteAllText($InputPath,($intent|ConvertTo-Json -Depth 5));$InputSha256=Hash-File $InputPath;$OwnerPid=$PID;$Action='Enter'
$global:FiniteGateTest=@{};$global:FiniteGateTest.pid=$PID;$global:FiniteGateTest.root=$script:privateRoot;$global:FiniteGateTest.worker=$workerName;$global:FiniteGateTest.django=$djangoName;$global:FiniteGateTest.calls=0
function Get-RecoverySnapshot{if([PrivateMutexProbe]::Available($global:FiniteGateTest.worker) -or [PrivateMutexProbe]::Available($global:FiniteGateTest.django)){throw 'Snapshot not inside both actual private mutexes'};return @{maintenance=@{drainedStopped=$false};at=[DateTimeOffset]::UtcNow.ToString('o')}}
$footer=$ast.EndBlock.Statements[-1].Extent.Text
$footer=$footer.Replace('$PSScriptRoot','$script:privateRoot').Replace("'Local\TERUISI.Worker.LocalService.v1'",("'"+$workerName+"'")).Replace("('Local\TERUISI-DjangoSales-'+"+'$suffix'+")",("'"+$djangoName+"'"))
if($footer.Contains('Local\TERUISI.Worker.LocalService.v1') -or $footer.Contains('Local\TERUISI-DjangoSales-')){throw 'Private gate substitution failed'}
try{
 $value=. ([scriptblock]::Create($footer));if($global:FiniteGateTest.calls -ne 1){throw 'Native callback count differs'}
 if(-not (Test-Path -LiteralPath (Join-Path $script:privateRoot 'execution\ENTER-MAINTENANCE-COMPLETE.json'))){throw 'No native complete record'}
 if(-not [PrivateMutexProbe]::Available($workerName) -or -not [PrivateMutexProbe]::Available($djangoName)){throw 'Private locks leaked'}
 @{status='passed';nativeCalls=$global:FiniteGateTest.calls;actualGateModule=$true;productionLocks=$false}|ConvertTo-Json -Compress
}finally{if(-not [IO.Path]::GetFullPath($script:privateRoot).StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase)){throw 'Cleanup path escaped temp'};Remove-Item -LiteralPath $script:privateRoot -Recurse -Force}
