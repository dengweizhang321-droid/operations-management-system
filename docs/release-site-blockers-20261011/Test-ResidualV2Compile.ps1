param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputPath){throw 'Create-only evidence'}
$sourcePath=Join-Path $PSScriptRoot 'Probe-ResidualProcessMetadataV2.ps1'
$tokens=$null;$errors=$null
[void][Management.Automation.Language.Parser]::ParseFile($sourcePath,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'PowerShell syntax rejected'}
$raw=[IO.File]::ReadAllText($sourcePath)
$code=[regex]::Match($raw,"(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@").Groups[1].Value
if(!$code.Contains('public static class ReleaseResidualMetadata')){throw 'Type extraction failed'}
Add-Type -TypeDefinition $code
$result=[ordered]@{version='astra-residual-v2-compile-only-v1';sourceSha256=(Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant();hostVersion=$PSVersionTable.PSVersion.ToString();psAstPassed=$true;actualCSharpCompiled=$true;nativeCalls=0;productionActions=0}
$json=$result|ConvertTo-Json
$stream=[IO.File]::Open($OutputPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes($json+[Environment]::NewLine);$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
$json
