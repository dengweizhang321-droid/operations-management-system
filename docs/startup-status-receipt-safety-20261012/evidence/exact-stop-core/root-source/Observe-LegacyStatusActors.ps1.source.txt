$ErrorActionPreference='Stop'
$source='D:\.codex\worktrees\startup-status-receipt-safety\运营管理系统\tools\watchdog-native-metadata.ps1'
if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -cne 'd8748a819bdeba1e46bf6df35973714bb996f3c51441a0481cd917b17f2e8449'){throw 'Native source drift'}
$script:actorDeadline=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+30000
function Get-ProcessDeadline{return $script:actorDeadline}
function Get-ProcessRemaining([long]$Deadline){$n=$Deadline-[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();if($n -le 0){throw 'actor_observation_deadline'};return $n}
$nativeHold=[IO.File]::Open($source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try {
. $source
$rows=@(CimCmdlets\Get-CimInstance Win32_Process -ErrorAction Stop|Where-Object {$_.Name -in @('powershell.exe','pwsh.exe','Watchdog.NoConsole.exe')})
$result=@();$unknown=0
foreach($row in $rows){
 try{
  $p=Complete-ReadonlyProcessMetadata $row
  $command=[string]$p.CommandLine
  $controller=$command -match '(?i)operations-system-control\.ps1'
  $supervisor=$command -match '(?i)django-runtime-supervisor\.ps1'
  $status=$command -match '(?i)(?:^|\s|\")-Action(?:\s|\")+(?:Status|AggregateStatus|Panel)(?:\s|\"|$)'
  $result+=@{processId=[int]$p.ProcessId;parentProcessId=[int]$p.ParentProcessId;creationUtc=$p.CreationDate.ToUniversalTime().ToString('o');controllerReferenced=$controller;supervisorReferenced=$supervisor;explicitStatusOrPanel=$status;controllerImplicitPanel=($controller -and $command -notmatch '(?i)(?:^|\s|\")-Action(?:\s|\")');identityComplete=$true}
 }catch{$unknown++;$result+=@{processId=[int]$row.ProcessId;identityComplete=$false}}
}
if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -cne 'd8748a819bdeba1e46bf6df35973714bb996f3c51441a0481cd917b17f2e8449'){throw 'Native source drift'}
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
[pscustomobject]@{version='ordinary-legacy-actor-observation-v1';at=[DateTimeOffset]::UtcNow.ToString('o');unknown=$unknown;rows=$result;rawCommandsPersisted=$false;productionActions=0;continuousExclusionEstablished=$false}|ConvertTo-Json -Depth 5 -Compress

} finally { $nativeHold.Dispose() }
