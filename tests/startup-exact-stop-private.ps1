param([string]$Source,[string]$EvidenceDirectory)
$ErrorActionPreference='Stop'
. $Source
$fixtureSource=Join-Path $EvidenceDirectory 'Disposable.cs';$fixtureExe=Join-Path $EvidenceDirectory 'Disposable.exe'
[IO.File]::WriteAllText($fixtureSource,'public static class Disposable { public static void Main() { System.Threading.Thread.Sleep(60000); } }',[Text.Encoding]::ASCII)
& (Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe') /nologo /target:winexe "/out:$fixtureExe" $fixtureSource | Out-Null
if($LASTEXITCODE -ne 0){throw 'Private disposable compilation failed'}
$info=[Diagnostics.ProcessStartInfo]::new($fixtureExe)
$info.UseShellExecute=$false;$info.CreateNoWindow=$true
$child=[Diagnostics.Process]::Start($info)
$extraLease=$null
try{
 $row=$null;for($i=0;$i -lt 20;$i++){$row=Get-CimInstance Win32_Process -Filter "ProcessId=$($child.Id)";if($row -and $row.CreationDate){break};Start-Sleep -Milliseconds 100}
 if(-not $row){throw 'Private child absent'}
 $native=Get-ReadonlyNativeProcessFields $child.Id
 $target=[pscustomobject]@{processId=[int]$child.Id;parentProcessId=[int]$PID;depth=0;nativeCreationFileTime=$native.CreationFileTime.ToString([Globalization.CultureInfo]::InvariantCulture);imageSha256=(Get-StopTextHash $native.ExecutablePath);commandSha256=(Get-StopTextHash $native.CommandLine)}
 $script:privatePid=$child.Id
 function Read-ExactStopCensus {return @(Get-CimInstance Win32_Process -Filter "ProcessId=$script:privatePid OR ParentProcessId=$script:privatePid"|Select-Object ProcessId,ParentProcessId,CreationDate)}
 $correct=$target.commandSha256;$target.commandSha256='0'*64;$refused=$false
 try{Invoke-ExactInstanceStop @($target) (Join-Path $EvidenceDirectory 'wrong-hash.jsonl')|Out-Null}catch{$refused=$true}
 $child.Refresh();if(-not $refused -or $child.HasExited){throw 'Bad declaration terminated child'}
 $target.commandSha256=$correct
 $extraLease=Open-ExactStopLease $target
 if(Test-ExactHeldExited $extraLease){throw 'Live private child reported exited'}
 $wrongBirth=$target.PSObject.Copy();$wrongBirth.nativeCreationFileTime=([long]$target.nativeCreationFileTime+1L).ToString()
 $birthRefused=$false;try{Test-ExactHeldExited ([pscustomobject]@{Handle=$extraLease.Handle;Target=$wrongBirth})|Out-Null}catch{$birthRefused=$true};if(-not $birthRefused){throw 'Changed held birth accepted'}
 $query=[Teruisi.ReadonlyProcessMetadata]::OpenProcess(0x1000,$false,[uint32]$child.Id)
 if($query -eq [IntPtr]::Zero){throw 'Private query-only handle unavailable'}
 try{$waitRefused=$false;try{Test-ExactHeldExited ([pscustomobject]@{Handle=$query;Target=$target})|Out-Null}catch{if($_.Exception.Message -ceq 'Held exit state unknown'){$waitRefused=$true}else{throw}};if(-not $waitRefused){throw 'Unknown kernel wait accepted'}}finally{[void][Teruisi.ReadonlyProcessMetadata]::CloseHandle($query)}
 $result=Invoke-ExactInstanceStop @($target) (Join-Path $EvidenceDirectory 'actual-stop.jsonl')
 if(-not $child.WaitForExit(5000) -or $result.status -ne 'declared-instances-exited'){throw 'Actual held stop unconfirmed'}
 if(-not(Test-ExactHeldExited $extraLease)){throw 'Same held exited child not confirmed'}
 $initialDeadRefused=$false;try{Invoke-ExactInstanceStop @($target) (Join-Path $EvidenceDirectory 'initial-dead.jsonl')|Out-Null}catch{$initialDeadRefused=$true};if(-not $initialDeadRefused){throw 'Already-dead initial target bypassed live validation'}
 $deadEvents=@(Get-Content -LiteralPath (Join-Path $EvidenceDirectory 'initial-dead.jsonl')|ForEach-Object {$_|ConvertFrom-Json});if(@($deadEvents|Where-Object {$_.stage -in @('all-targets-validated','exit-confirmed','stop-started')}).Count){throw 'Initial dead target advanced'}
 [pscustomobject]@{privateChild=$child.Id;wrongHashRefused=$true;heldStopConfirmed=$true;changedBirthRefused=$birthRefused;unknownWaitRefused=$waitRefused;initialDeadRefused=$initialDeadRefused;productionTargetsTouched=0}|ConvertTo-Json -Compress
}finally{if($extraLease){Close-ExactStopLease $extraLease};if(-not $child.HasExited){$child.Kill();$child.WaitForExit(5000)|Out-Null};$child.Dispose()}
