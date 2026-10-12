param([string]$Source,[string]$Directory,[switch]$ExpectNaturalExitSupport)
$ErrorActionPreference='Stop';. $Source
$parent=$null;$child=$null
try{
 $code=@'
using System;using System.Diagnostics;using System.IO;using System.Reflection;using System.Threading;
class Fixture{static void Main(string[] a){if(a[0]=="leaf"){Thread.Sleep(60000);return;}var p=Process.Start(new ProcessStartInfo(Assembly.GetExecutingAssembly().Location,"leaf"){UseShellExecute=false,CreateNoWindow=true});File.WriteAllText(a[1],p.Id.ToString());p.WaitForExit();}}
'@
 $cs=Join-Path $Directory 'chain.cs';$exe=Join-Path $Directory 'chain.exe';$childPidFile=Join-Path $Directory 'child.txt';[IO.File]::WriteAllText($cs,$code)
 & 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /target:winexe ('/out:'+$exe) $cs
 if($LASTEXITCODE -ne 0){throw 'Private fixture compile failed'}
 $start=[Diagnostics.ProcessStartInfo]::new($exe,('parent "'+$childPidFile+'"'));$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$parent=[Diagnostics.Process]::Start($start)
 $deadline=[DateTimeOffset]::UtcNow.AddSeconds(8);while(-not(Test-Path -LiteralPath $childPidFile)){if([DateTimeOffset]::UtcNow -gt $deadline){throw 'Private child not published'};Start-Sleep -Milliseconds 50}
 $child=[Diagnostics.Process]::GetProcessById([int][IO.File]::ReadAllText($childPidFile));$targets=@()
 foreach($pair in @(@($parent.Id,0),@($child.Id,1))){$row=@(Read-ReadonlyCimProcess $pair[0]);if($row.Count -ne 1){throw 'Private process ambiguous'};$n=Get-ReadonlyNativeProcessFields $pair[0];$targets+= [pscustomobject]@{processId=[int]$pair[0];parentProcessId=[int]$row[0].ParentProcessId;depth=[int]$pair[1];nativeCreationFileTime=[string]$n.CreationFileTime;imageSha256=Get-StopTextHash $n.ExecutablePath;commandSha256=Get-StopTextHash $n.CommandLine}}
 $caught=$null;$result=$null
 try{$result=Invoke-ExactInstanceStop $targets (Join-Path $Directory 'journal.jsonl') (Get-ProcessDeadline 15000)}catch{$caught=$_}
 $parent.WaitForExit(3000)|Out-Null;$child.WaitForExit(3000)|Out-Null
 $events=@(Get-Content -LiteralPath (Join-Path $Directory 'journal.jsonl')|ForEach-Object {$_|ConvertFrom-Json})
 $evidence=@{failed=($null -ne $caught);error=$(if($caught){$caught.Exception.Message}else{$null});parentExited=$parent.HasExited;childExited=$child.HasExited;confirmedExits=@($events|Where-Object stage -eq 'exit-confirmed').Count;productionStops=0;allProcessesCreatedByFixture=$true}
 $evidence|ConvertTo-Json -Compress
 if($ExpectNaturalExitSupport){if($caught -or -not $parent.HasExited -or -not $child.HasExited -or $result.count -ne 2){throw 'Natural held exit not handled'}}else{if(-not $caught -or -not $parent.HasExited -or -not $child.HasExited){throw 'Expected old partial failure not reproduced'}}
}finally{foreach($p in @($child,$parent)){if($null -ne $p){try{if(-not $p.HasExited){$p.Kill();$p.WaitForExit(3000)|Out-Null}}finally{$p.Dispose()}}}}
