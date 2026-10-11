param([Parameter(Mandatory=$true)][string]$EvidenceDirectory)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $EvidenceDirectory){throw 'Test directory is create-only'}
[void][IO.Directory]::CreateDirectory($EvidenceDirectory)
$launcherPath=Join-Path $PSScriptRoot 'Start-ReadOnlyAdminAudit.ps1'
$raw=[IO.File]::ReadAllText($launcherPath)
$begin=$raw.IndexOf('$start=New-Object Diagnostics.ProcessStartInfo')
$end=$raw.IndexOf('$result=[ordered]@{version=', $begin)
if($begin -lt 0 -or $end -le $begin){throw 'Transport source markers drifted'}
$transport=$raw.Substring($begin,$end-$begin)
$p=[pscustomobject]@{node=[pscustomobject]@{path='C:\Program Files\nodejs\node.exe'};resultPath=(Join-Path $EvidenceDirectory 'Unicode-测试 result.json')}
$captureText='{"text":"quoted \\" path D:\\test 中文","lines":"one\ntwo"}'
$dummy=@'
const chunks=[];for await(const c of process.stdin)chunks.push(c);
console.log(JSON.stringify({arguments:process.argv.slice(2),stdin:Buffer.concat(chunks).toString('utf8')}));
'@
$evaluator=[Text.UTF8Encoding]::new($false).GetBytes($dummy)
$originalCoverage=$env:NODE_V8_COVERAGE
$coverage=Join-Path $EvidenceDirectory 'controlled-coverage'
$env:NODE_V8_COVERAGE=$coverage
try{Invoke-Expression $transport}finally{if($null -eq $originalCoverage){Remove-Item Env:NODE_V8_COVERAGE -ErrorAction SilentlyContinue}else{$env:NODE_V8_COVERAGE=$originalCoverage}}
$response=$out|ConvertFrom-Json
if($response.stdin -cne $captureText){throw 'UTF8 stdin mismatch'}
if(@($response.arguments).Count -ne 1 -or $response.arguments[0] -cne $p.resultPath){throw 'Argument quoting mismatch'}
$coverageFiles=if(Test-Path -LiteralPath $coverage){@(Get-ChildItem -LiteralPath $coverage -File).Count}else{0}
$record=[ordered]@{version='astra-admin-loader-transport-v1';launcherSha256=(Get-FileHash -LiteralPath $launcherPath -Algorithm SHA256).Hash.ToLowerInvariant();hostVersion=$PSVersionTable.PSVersion.ToString();actualTransportExtracted=$true;dummyEvaluatorOnly=$true;utf8RoundTrip=$true;argvRoundTrip=$true;inheritedCoverageFiles=$coverageFiles;uacInvocations=0;nativeProcessScans=0;productionActions=0;scope='Actual ProcessStartInfo/argv/stdin/wait block; dummy Node evaluator, no admin bootstrap or collector invoked.'}
$json=$record|ConvertTo-Json -Depth 5
$file=Join-Path $EvidenceDirectory 'result.json'
$stream=[IO.File]::Open($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes($json+[Environment]::NewLine);$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
$json
