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
 $result=Invoke-ExactInstanceStop @($target) (Join-Path $EvidenceDirectory 'actual-stop.jsonl')
 if(-not $child.WaitForExit(5000) -or $result.status -ne 'declared-instances-exited'){throw 'Actual held stop unconfirmed'}
 [pscustomobject]@{privateChild=$child.Id;wrongHashRefused=$true;heldStopConfirmed=$true;productionTargetsTouched=0}|ConvertTo-Json -Compress
}finally{if(-not $child.HasExited){$child.Kill();$child.WaitForExit(5000)|Out-Null};$child.Dispose()}
