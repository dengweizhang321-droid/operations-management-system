param([Parameter(Mandatory)][string]$Source,[Parameter(Mandatory)][string]$Observer)
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
function Load-Functions([string]$File,[string[]]$Names){
 $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($File,[ref]$tokens,[ref]$errors)
 if($errors.Count){throw ('Parse error: '+($errors|Out-String))}
 foreach($name in $Names){$nodes=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true));if($nodes.Count -ne 1){throw ('Missing exact function '+$name)};. ([scriptblock]::Create($nodes[0].Extent.Text))}
 # Export only the requested unchanged function definitions to caller scope.
 foreach($name in $Names){Set-Item ('Function:script:'+$name) (Get-Item ('Function:'+$name)).ScriptBlock}
}
Load-Functions $Observer @('Read-Object','Assert-MaintenanceObject','Assert-MaintenanceRaw','Decode-Command','Assert-ActorsAbsent','Assert-NoControllers')
$maintenance=[pscustomobject]@{version='teruisi-system-maintenance-v1';id='5fe642a2602243ca83819253d8848e57';runtimeRoot='D:\teruisi-runtime\django-sales';keepPostgres=$true;createdAt='original'}
Assert-MaintenanceObject $maintenance 'teruisi-system-maintenance-v1'
foreach($value in @('true',1)){$bad=$maintenance.PSObject.Copy();$bad.keepPostgres=$value;$refused=$false;try{Assert-MaintenanceObject $bad 'teruisi-system-maintenance-v1'}catch{$refused=$true};if(-not $refused){throw 'Nonboolean maintenance accepted'}}
$bad=$maintenance.PSObject.Copy();$bad.keepPostgres=@($true);$refused=$false;try{Assert-MaintenanceObject $bad 'teruisi-system-maintenance-v1'}catch{$refused=$true};if(-not $refused){throw 'Array keepPostgres accepted'}
$refused=$false;try{Assert-MaintenanceObject @($maintenance,$maintenance) 'teruisi-system-maintenance-v1'}catch{$refused=$true};if(-not $refused){throw 'Array maintenance accepted'}
foreach($rows in @(@([pscustomobject]@{ProcessId=42;ParentProcessId=1}),@([pscustomobject]@{ProcessId=99;ParentProcessId=42}))){$refused=$false;try{Assert-ActorsAbsent $rows @([pscustomobject]@{pid=42})}catch{$refused=$true};if(-not $refused){throw 'Old actor/PID reuse/child accepted'}}
$inner=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('{"script":"D:/codex-isolated/main-release-packages/private/source/tools/django-local-service.ps1","Action":"DeployApp"}'))
$outer=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$inner'))"));$refused=$false
try{Assert-NoControllers @([pscustomobject]@{ProcessId=99999;ParentProcessId=1;CommandLine=('powershell -EncodedCommand '+$outer)}) 88888}catch{$refused=$true};if(-not $refused){throw 'Nested encoded native controller accepted'}
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('19db-private-boundary-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
try{
 $dup=Join-Path $testRoot 'duplicate.json';[IO.File]::WriteAllText($dup,'{"version":"v","id":"a","id":"b"}')
 $refused=$false;try{Assert-MaintenanceRaw $dup ([pscustomobject]@{version='v';id='b'})}catch{$refused=$true};if(-not $refused){throw 'Duplicate maintenance accepted'}
 Load-Functions (Join-Path $Source 'tools/django-local-service.ps1') @('Get-PreparedApplication','Deploy-Application','Verify-PreparedApplication')
 $RuntimeRoot=$testRoot;$ExecutionRoot=Join-Path $testRoot 'source';$InstalledAppRoot=Join-Path $testRoot 'app';$DeploymentManifestPath=Join-Path $InstalledAppRoot 'deployment.json';$PreparedAppId='32ba2595db6d4cc397e34945e7cd13a4'
 $stage=Join-Path $testRoot ('app.deploy-'+$PreparedAppId);New-Item -ItemType Directory -Path $stage | Out-Null;New-Item -ItemType Directory -Path (Join-Path $testRoot 'app.previous') | Out-Null
 [IO.File]::WriteAllText((Join-Path $stage 'deployment.json'),(@{sourceRoot=$ExecutionRoot}|ConvertTo-Json -Compress))
 function Get-CanonicalPath([string]$Value){[IO.Path]::GetFullPath($Value)}
 function Assert-RuntimeChildPath([string]$Value){if(-not [IO.Path]::GetFullPath($Value).StartsWith($testRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Private path escaped'};return $Value}
 function Get-FileSha256([string]$File){(Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()}
 function Read-JsonFile([string]$File,[string]$Label){Get-Content -LiteralPath $File -Raw|ConvertFrom-Json}
 function Test-ExactObjectPropertyNames([object]$Value,[string[]]$Names){return (@(Compare-Object @($Value.PSObject.Properties.Name|Sort-Object) @($Names|Sort-Object)).Count -eq 0)}
 function Get-InstalledApplicationBinding{return ('3'*64)}
 $receipt=Join-Path $testRoot ('app.prepare-'+$PreparedAppId+'.json')
 [IO.File]::WriteAllText($receipt,(@{version='teruisi-django-prepared-app-v1';id=$PreparedAppId;runtimeRoot=$RuntimeRoot;predecessorManifestSha256=('3'*64);candidateManifestSha256=(Get-FileSha256 (Join-Path $stage 'deployment.json'))}|ConvertTo-Json -Compress));$PreparedAppSha256=Get-FileSha256 $receipt
 $script:treeCalls=0;$script:mutations=0;$script:rejectTree=$true
 function Assert-ApplicationTreeManifest([string]$Root,[string]$Label){$script:treeCalls++;if($script:rejectTree){throw 'PRIVATE_TREE_REJECT'};return @{verified=$true}}
 function Assert-ProductionMaintenance([string]$Operation){}
 function Assert-ApplicationDeploymentStopped([string]$Operation){}
 function Assert-NoUnapprovedProtectedAiMigration([string]$Operation,[string]$Backend){}
 function Remove-Item{param([string]$LiteralPath,[switch]$Recurse,[switch]$Force)$script:mutations++;if($script:treeCalls -lt 1){throw 'Mutation preceded full-tree gate'};throw 'PRIVATE_MUTATION_BOUNDARY'}
 function Move-Item{throw 'Unexpected move passed private mutation boundary'}
 $refused=$false;try{Deploy-Application}catch{if($_.Exception.Message -cne 'PRIVATE_TREE_REJECT'){throw};$refused=$true};if(-not $refused -or $script:mutations -ne 0 -or $script:treeCalls -ne 1){throw 'GetPrepared tree failure did not precede all deployment mutations'}
 $script:rejectTree=$false;$refused=$false;try{Deploy-Application}catch{if($_.Exception.Message -cne 'PRIVATE_MUTATION_BOUNDARY'){throw};$refused=$true};if(-not $refused -or $script:mutations -ne 1 -or $script:treeCalls -ne 2){throw 'Native deploy gate ordering changed'}
 Write-Output 'PASS: exact native GetPrepared receipt/full-tree boundary before first app mutation; typed maintenance/duplicate/actor/encoded guards'
}finally{
 $canonical=[IO.Path]::GetFullPath($testRoot);if(-not $canonical.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase)){throw 'Private cleanup escaped'}
 Microsoft.PowerShell.Management\Remove-Item -LiteralPath $canonical -Recurse -Force
}
