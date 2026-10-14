$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\tools\operations-system-watchdog.ps1') -FunctionsOnly
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('watchdog-tail-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot|Out-Null
$checks=0
function Assert-Tail($Value,$Message){if(-not $Value){throw $Message};$script:checks++}
try{
 $file=Join-Path $testRoot 'postgresql-fixture.log'
 $normal="2026-10-14 00:00:01 LOG: database system was interrupted; synthetic`n2026-10-14 00:00:02 LOG: database system was not properly shut down; automatic recovery in progress`n2026-10-14 00:00:03 LOG: redo done at 0/0`n2026-10-14 00:00:04 LOG: database system is ready to accept connections`n2026-10-14 00:00:05 LOG: statement: SELECT 'ready to accept connections synthetic-secret'`n"
 [IO.File]::WriteAllText($file,$normal,[Text.UTF8Encoding]::new($false))
 $a=Get-WatchPostgresRecoveryTail $file
 Assert-Tail ($a.records.Count -eq 4 -and $a.records[-1] -eq '2026-10-14 00:00:04 database_ready') 'Recovery markers must be precise LOG messages'
 Assert-Tail (-not $a.observation.truncated -and ($a.records -join '') -notmatch 'synthetic-secret') 'No SQL/body data in evidence'
 [IO.File]::WriteAllText($file,('x'*8388608)+"`n"+$normal,[Text.UTF8Encoding]::new($false))
 $before=(Get-FileHash $file).Hash;$clock=[Diagnostics.Stopwatch]::StartNew();$b=Get-WatchPostgresRecoveryTail $file;$clock.Stop()
 Assert-Tail ($b.observation.bytesRead -eq 262144 -and $b.observation.truncated) 'Large single line must have an exact bounded read'
 Assert-Tail ($b.records.Count -eq 4 -and (Get-FileHash $file).Hash -ceq $before) 'Original log must remain unchanged'
 [IO.File]::WriteAllText($file,($normal*200)+'unfinished',[Text.UTF8Encoding]::new($false));$c=Get-WatchPostgresRecoveryTail $file
 Assert-Tail ($c.observation.completeLinesObserved -le 160 -and $c.observation.truncated) 'Only bounded complete final lines count'
 [IO.File]::WriteAllBytes($file,[byte[]]@(255,10));$d=Get-WatchPostgresRecoveryTail $file
 Assert-Tail ($d.observation.status -eq 'unavailable' -and $d.records.Count -eq 0) 'Invalid UTF-8 stays unavailable'
 Assert-Tail ((Get-WatchPostgresRecoveryTail '').observation.status -eq 'missing') 'Missing log is explicit'
 $BackendRoot=$testRoot;New-Item -ItemType Directory -Path (Join-Path $testRoot 'logs')|Out-Null
 [IO.File]::WriteAllText((Join-Path $testRoot 'logs\postgresql-fixture.log'),('x'*8388608)+"`n"+$normal,[Text.UTF8Encoding]::new($false))
 function Get-WinEvent { @() }
 $snapshot=@{healthy=$false;worker='status_error';probeError=$false};$e=Get-WatchEvidence $snapshot
 Assert-Tail ($e.snapshot.healthy -eq $false -and $e.snapshot.worker -eq 'status_error' -and $e.databaseLogObservation.truncated) 'Evidence truncation must not relabel the failed snapshot'
 @{passed=$checks;longLineMilliseconds=$clock.ElapsedMilliseconds;productionTouched=$false;messagesSent=$false}|ConvertTo-Json -Compress
}finally{if([IO.Path]::GetFullPath($testRoot).StartsWith([IO.Path]::GetTempPath()) -and (Split-Path $testRoot -Leaf) -match '^watchdog-tail-[a-f0-9]{32}$'){Remove-Item -LiteralPath $testRoot -Recurse -Force}}
