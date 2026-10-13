param()
$ErrorActionPreference='Stop'
$root='E:\codex-artifacts\release-site-blockers-20261011'
foreach($name in @('SITE_AGY3_STREAM.ndjson','SITE_AGY3_STDERR.log','SITE_AGY3_CALL.json')){if(Test-Path -LiteralPath (Join-Path $root $name)){throw 'Review evidence is create-only'}}
$prompt=[IO.File]::ReadAllText((Join-Path $root 'SITE_AGY3_PROMPT.txt'),[Text.Encoding]::UTF8)
$started=[DateTimeOffset]::UtcNow
& 'C:\Users\86137\AppData\Local\agy\bin\agy.exe' -p $prompt --mode plan --output-format stream-json --print-timeout 90s 1> (Join-Path $root 'SITE_AGY3_STREAM.ndjson') 2> (Join-Path $root 'SITE_AGY3_STDERR.log')
$code=$LASTEXITCODE
[ordered]@{startedAt=$started.ToString('o');finishedAt=[DateTimeOffset]::UtcNow.ToString('o');exitCode=$code;mode='plan';productionActionsRequested=0}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'SITE_AGY3_CALL.json') -Encoding utf8
exit $code
