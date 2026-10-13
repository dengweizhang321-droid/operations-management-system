param([string]$Source,[string]$DeadlineSource,[string]$TempRoot)
$ErrorActionPreference='Stop'
. $DeadlineSource
. $Source
$env:TERUISI_PROCESS_DEADLINE_UNIX_MS=[string]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+20000)
$h=[Teruisi.ReadonlyProcessMetadata]::OpenProcess(0x1000,$false,[uint32]$PID)
if($h -eq [IntPtr]::Zero){throw 'self open failed'}
try{
 $self=Read-ReadonlyNativeHandle $h
 $c=0L;$e=0L;$k=0L;$u=0L
 if(-not [Teruisi.ReadonlyProcessMetadata]::GetProcessTimes($h,[ref]$c,[ref]$e,[ref]$k,[ref]$u)){throw 'self times failed'}
 if($self.CreationFileTime -ne $c){throw 'self birth changed'}
 $selfExitTime=$e
}finally{[void][Teruisi.ReadonlyProcessMetadata]::CloseHandle($h)}
$go=Join-Path $TempRoot 'go'
$body="`$ErrorActionPreference='Stop';while(-not [IO.File]::Exists('"+$go.Replace("'","''")+"')){Start-Sleep -Milliseconds 20};exit 259"
$hostPath=(Get-Process -Id $PID).Path
$child=Start-Process -FilePath $hostPath -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand',[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($body))) -PassThru
$held=[Teruisi.ReadonlyProcessMetadata]::OpenProcess(0x1000,$false,[uint32]$child.Id)
if($held -eq [IntPtr]::Zero){throw 'private child open failed'}
try{
 $initial=$null;$limit=[DateTime]::UtcNow.AddSeconds(3)
 do{try{$initial=Read-ReadonlyNativeHandle $held}catch{if([DateTime]::UtcNow -ge $limit){throw};Start-Sleep -Milliseconds 20}}while($null -eq $initial)
 [IO.File]::WriteAllText($go,'exit')
 if(-not $child.WaitForExit(5000)){throw 'private child did not exit'}
 $exitCode=[uint32]0
 if(-not [Teruisi.ReadonlyProcessMetadata]::GetExitCodeProcess($held,[ref]$exitCode) -or $exitCode -ne 259){throw 'private 259 reproduction failed'}
 $rejected=$false;try{Read-ReadonlyNativeHandle $held|Out-Null}catch{$rejected=$true}
 if(-not $rejected){throw 'exited private handle accepted'}
 [pscustomobject]@{selfBirthStable=$true;selfExitTime=$selfExitTime;privateExitCode=$exitCode;exitedHandleRejected=$rejected;productionActions=0;rights='0x1000'}|ConvertTo-Json -Compress
}finally{
 if(-not [IO.File]::Exists($go)){[IO.File]::WriteAllText($go,'exit')}
 [void]$child.WaitForExit(5000)
 [void][Teruisi.ReadonlyProcessMetadata]::CloseHandle($held)
}
