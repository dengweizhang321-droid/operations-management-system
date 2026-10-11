param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputPath){throw 'Evidence is create-only'}
if([IntPtr]::Size -ne 8){throw 'x64 required'}
$sourcePath=Join-Path $PSScriptRoot 'Probe-ResidualProcessMetadata.ps1'
$raw=[IO.File]::ReadAllText($sourcePath)
$type=[regex]::Match($raw,"(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@").Groups[1].Value
if(!$type.Contains('public static class ReleaseResidualMetadata')){throw 'Type extraction failed'}
Add-Type -TypeDefinition $type
$start=$raw.IndexOf('$buffer=[Runtime.InteropServices.Marshal]::AllocHGlobal(64)')
$end=$raw.IndexOf('$t2=[ReleaseResidualMetadata]::GetProcessTimes', $start)
if($start -lt 0 -or $end -le $start){throw 'Native parser extraction failed'}
$taskPid=[uint32]$PID;$r=[ordered]@{};$buffer=[IntPtr]::Zero
$h=[ReleaseResidualMetadata]::OpenProcess(0x1000,$false,$taskPid)
if($h -eq [IntPtr]::Zero){throw ('Self OpenProcess failed: '+[Runtime.InteropServices.Marshal]::GetLastWin32Error())}
try{Invoke-Expression $raw.Substring($start,$end-$start)}finally{if($buffer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)};[void][ReleaseResidualMetadata]::CloseHandle($h)}
$record=[ordered]@{version='astra-self-native-metadata-layout-v1';sourceSha256=(Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant();hostVersion=$PSVersionTable.PSVersion.ToString();processId=$taskPid;selfOnly=$true;actualNativeParserExtracted=$true;result=$r;productionActions=0;limitations='Current self process validates this x64 response layout only; does not classify any of the five inaccessible target processes.'}
$json=$record|ConvertTo-Json -Depth 5
$stream=[IO.File]::Open($OutputPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes($json+[Environment]::NewLine);$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
$json
if(!$r.layoutValid -or !$r.protectionSucceeded){throw 'Self metadata query/layout did not validate; failure evidence retained'}
