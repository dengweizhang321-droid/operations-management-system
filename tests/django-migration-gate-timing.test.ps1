$ErrorActionPreference='Stop'
# Execute the real function body; only native/process/database effects are
# replaced. No production controller is dot-sourced or invoked.
$source=Join-Path $PSScriptRoot '../tools/django-local-service.ps1'
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$null,[ref]$errors)
if($errors.Count){throw 'PowerShell source parse failed'}
$function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-DjangoMigrations'},$true)
Invoke-Expression $function.Extent.Text
$Python='private-python';$RuntimeRoot='D:\teruisi-runtime\django-sales'
$BackendRoot='D:\private-never-executed\backend';$ExecutionRoot='D:\private-never-executed'
$LogDirectory='D:\private-never-executed\logs';$RunId='synthetic';$WriterStatementTimeoutMs=1000;$WriterMaxBodyBytes=1000
function Test-Path { param($LiteralPath,$PathType) return $true }
function Database-Url { param($a,$b,$c,$d,$e) return 'private-identity' }
function Get-CanonicalPath { param($Value) return $Value }
function Invoke-WithDjangoEnvironment { param($a,$b,$c,$d,$e,$f,$g,[scriptblock]$Body) & $Body }
function Assert-NoUnapprovedProtectedAiMigration {
  param($Operation)
  $script:events.Add('release')
  if($script:mode -ceq 'release-failed'){throw 'original-release-failure'}
}
function Invoke-BoundedNativeProcess {
  param($Executable,$Arguments,$WorkingDirectory)
  if($Arguments[1] -ceq 'database'){
    $script:events.Add('database')
    if($script:mode -ceq 'database-failed'){throw 'original-database-failure'}
    return @{status='verified'}
  }
  $script:events.Add('migrate-boundary')
  throw 'private-stop-before-native-migrate'
}
function ConvertFrom-UniqueNativeJson { param($Value,$Label) return $Value }
function Write-DjangoStartupTiming {
  param($Stage,$StartedAt,$ElapsedMilliseconds,$Outcome)
  if($script:mode -ceq 'timing-failed'){throw 'private-timing-failure'}
  if($ElapsedMilliseconds -lt 0 -or [string]::IsNullOrEmpty($StartedAt)){throw 'Invalid timing'}
  $script:timings.Add(@{stage=$Stage;outcome=$Outcome})
}
foreach($case in @('completed','release-failed','database-failed','timing-failed')){
  $script:mode=$case;$script:events=New-Object 'Collections.Generic.List[string]';$script:timings=New-Object 'Collections.Generic.List[object]'
  $message='';try{Invoke-DjangoMigrations @{OwnerPassword='synthetic-not-a-credential'}}catch{$message=$_.Exception.Message}
  $expectedMessage=if($case -ceq 'release-failed'){'original-release-failure'}elseif($case -ceq 'database-failed'){'original-database-failure'}else{'private-stop-before-native-migrate'}
  if($message -cne $expectedMessage){throw "Original failure changed: $case / $message"}
  $expectedEvents=if($case -ceq 'release-failed'){'release'}elseif($case -ceq 'database-failed'){'release,database'}else{'release,database,migrate-boundary'}
  if(($script:events -join ',') -cne $expectedEvents){throw "Gate order changed: $case"}
  if($case -cne 'timing-failed'){
    $release=@($script:timings|Where-Object{$_.stage -ceq 'protected-release-gate'})
    if($release.Count -ne 1 -or $release[0].outcome -cne $(if($case -ceq 'release-failed'){'failed'}else{'completed'})){throw 'Release timing incorrect'}
    $database=@($script:timings|Where-Object{$_.stage -ceq 'database-complete-gate'})
    if($case -ceq 'release-failed'){if($database.Count){throw 'Database gate ran after release failure'}}
    elseif($database.Count -ne 1 -or $database[0].outcome -cne $(if($case -ceq 'database-failed'){'failed'}else{'completed'})){throw 'Database timing incorrect'}
  }
}
'PASS: PS'+$PSVersionTable.PSVersion.Major+' real gate order, independent success/failure timing and original exception preservation; native migrate not invoked'
