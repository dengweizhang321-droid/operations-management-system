param([int]$Round=1,[string]$Conversation)
$ErrorActionPreference='Stop'
$root='E:\codex-artifacts\release-site-blockers-20261011'
$prompt=Get-Content -LiteralPath (Join-Path $root "SITE_AGY${Round}_PROMPT.txt") -Raw
$args=@('-p',$prompt,'--mode','plan','--output-format','stream-json','--print-timeout','5m')
if($Conversation){$args=@('--conversation',$Conversation)+$args}
$started=[DateTimeOffset]::UtcNow
& 'C:\Users\86137\AppData\Local\agy\bin\agy.exe' @args 1> (Join-Path $root "SITE_AGY${Round}_STREAM.ndjson") 2> (Join-Path $root "SITE_AGY${Round}_STDERR.log")
$code=$LASTEXITCODE
[ordered]@{startedAt=$started.ToString('o');finishedAt=[DateTimeOffset]::UtcNow.ToString('o');durationSeconds=([DateTimeOffset]::UtcNow-$started).TotalSeconds;exitCode=$code;executable='C:/Users/86137/AppData/Local/agy/bin/agy.exe';mode='plan';productionActions=0}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root "SITE_AGY${Round}_CALL.json") -Encoding utf8
exit $code
