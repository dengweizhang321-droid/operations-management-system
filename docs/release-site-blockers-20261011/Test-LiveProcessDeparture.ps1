param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputPath){throw 'Create-only evidence'}
$sourcePath=Join-Path $PSScriptRoot 'Collect-LiveProcessIdentity.ps1'
$raw=[IO.File]::ReadAllText($sourcePath);$type=[regex]::Match($raw,"(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@").Groups[1].Value
Add-Type -TypeDefinition $type
$start=$raw.IndexOf('function Confirm-LiveProcessDeparture(');$end=$raw.IndexOf('$before=@(Get-CimInstance Win32_Process',$start)
if($start -lt 0 -or $end -le $start){throw 'Actual function extraction failed'}
Invoke-Expression $raw.Substring($start,$end-$start)
function New-ControlledExitChild([int]$ExitCode){
 if($ExitCode -notin @(0,259)){throw 'Invalid controlled exit'}
 $script="[Console]::Out.WriteLine('ready');[void][Console]::In.ReadLine();exit "+$ExitCode
 $info=New-Object Diagnostics.ProcessStartInfo
 $info.FileName='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe';$info.Arguments='-NoProfile -NonInteractive -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script));$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 $child=[Diagnostics.Process]::Start($info)
 if($child.StandardOutput.ReadLine() -cne 'ready'){throw 'Controlled child did not reach barrier'}
 $original=Get-CimInstance Win32_Process -Filter "ProcessId=$($child.Id)"
 $c=0L;$e=0L;$k=0L;$u=0L
 if(![ReleaseSiteIdentityV1]::GetProcessTimes($child.Handle,[ref]$c,[ref]$e,[ref]$k,[ref]$u)){throw 'Test child birth unreadable'}
 return [pscustomobject]@{child=$child;original=$original;birth=$c.ToString([Globalization.CultureInfo]::InvariantCulture)}
}
$cases=@();$owned=$null
try{
 $owned=New-ControlledExitChild 0
 $alive=Confirm-LiveProcessDeparture $owned.original $owned.birth
 if($alive.proof.kind -cne 'unproven' -or $alive.proof.exitCode -ne 259){throw 'Alive child incorrectly classified'}
 $cases+=[ordered]@{name='alive-259-rejected';passed=$true;proof=$alive.proof}
 $wrongBirth=([long]$owned.birth+10L).ToString([Globalization.CultureInfo]::InvariantCulture)
 $reused=Confirm-LiveProcessDeparture $owned.original $wrongBirth
 if($reused.proof.kind -cne 'unproven' -or $reused.proof.exitQuerySucceeded -ne $false -or $reused.proof.reason -cne 'original-native-birth-missing-or-changed'){throw 'Wrong birth not rejected before exit query'}
 $cases+=[ordered]@{name='different-native-birth-rejected-before-exit-query';passed=$true;proof=$reused.proof}
 $owned.child.StandardInput.WriteLine('release');$owned.child.StandardInput.Flush()
 if(!$owned.child.WaitForExit(10000)){throw 'Owned child did not exit naturally'}
 $exited=Confirm-LiveProcessDeparture $owned.original $owned.birth
 if($exited.proof.kind -cne 'same-instance-exited' -or $exited.proof.exitCode -ne 0){throw 'Terminated same-instance child not proven'}
 $cases+=[ordered]@{name='same-instance-exit0-proven';passed=$true;proof=$exited.proof}
 $original=$owned.original;$birth=$owned.birth;$owned.child.Dispose();$owned=$null
 $absent=Confirm-LiveProcessDeparture $original $birth
 $releasedProven=($absent.proof.kind -ceq 'pid-absent' -and $absent.proof.openError -eq 87 -and $absent.proof.finalCimState -ceq 'absent') -or ($absent.proof.kind -ceq 'same-instance-exited' -and $absent.proof.exitCode -eq 0)
 if(!$releasedProven){throw ('Released child neither kernel-absent nor exact terminated instance: '+($absent.proof|ConvertTo-Json -Compress))}
 $cases+=[ordered]@{name='released-owned-child-still-requires-kernel-departure-proof';passed=$true;proof=$absent.proof}
 $owned=New-ControlledExitChild 259;$owned.child.StandardInput.WriteLine('release');$owned.child.StandardInput.Flush()
 if(!$owned.child.WaitForExit(10000)){throw 'Owned exit259 child did not finish'}
 $ambiguous=Confirm-LiveProcessDeparture $owned.original $owned.birth
 if($ambiguous.proof.kind -cne 'unproven' -or $ambiguous.proof.exitCode -ne 259){throw 'Exit259 incorrectly accepted'}
 $cases+=[ordered]@{name='actually-terminated-exit259-remains-unknown';passed=$true;proof=$ambiguous.proof}
}finally{if($null -ne $owned){if(!$owned.child.HasExited){$owned.child.StandardInput.WriteLine('release');$owned.child.StandardInput.Flush();[void]$owned.child.WaitForExit(10000)};$owned.child.Dispose()}}
$result=[ordered]@{version='astra-real-owned-windows-departure-test-v1';sourceSha256=(Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant();hostVersion=$PSVersionTable.PSVersion.ToString();cases=$cases;passed=$cases.Count;processTerminations=0;ownedChildNaturalExits=2;existingApplicationProcessesMutated=0;privilegesAdjusted=$false;productionActions=0;scope='Actual extracted departure function and PInvoke; two private test children with stdin release barriers. No whole-system census, lifecycle action, or process kill.'}
$json=$result|ConvertTo-Json -Depth 8;$file=[IO.File]::Open($OutputPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes($json+[Environment]::NewLine);$file.Write($bytes,0,$bytes.Length)}finally{$file.Dispose()}
$json
