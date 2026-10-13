# The caller pins this script and captures the already approved 280fa1cd helper
# bytes before invocation. Raw metadata travels only through stdin/stdout RAM.
$ErrorActionPreference='Stop'
if([IntPtr]::Size -ne 8){throw 'x64 required'}
$actor=[Security.Principal.WindowsIdentity]::GetCurrent()
if($actor.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not ([Security.Principal.WindowsPrincipal]::new($actor)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Approved SID administrator required'}
$inputText=[Console]::In.ReadToEnd()
if($inputText.Length -gt 262144){throw 'Input limit'}
$request=$inputText|ConvertFrom-Json
if($request.version -cne 'fixed-startup-metadata-input-v1'){throw 'Invalid input'}
$collector=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($request.collectorBase64))
$sha=[Security.Cryptography.SHA256]::Create()
try{$collectorHash=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($collector)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
if($collectorHash -cne '280fa1cd5b4c22b73743736e1b2c6d4b50f0a106e36e8fd8b139682666903c12'){throw 'Collector bytes changed'}
$summaryPath='E:\codex-artifacts\startup-status-receipt-safety-20261012\ADMIN_STARTUP_NATIVE_SUMMARY_V1.json'
$began=[DateTimeOffset]::UtcNow.ToString('o')
# Original collector: all processes/tasks and its original selected47936 CWD.
# Its only file write is the fixed create-only aggregate summary above.
$capture=(& ([ScriptBlock]::Create($collector)) -OutputPath $summaryPath)|ConvertFrom-Json
$targets=@(9440,38400,52220,53960,28016,62716,36644,52636,72676,70032,62748,41596,12556,31216,28748,71524,53104,67196,60408,68280,67472,10336,48520,43884,3692)
$rows=@()
foreach($target in $targets){
  $before=@(Get-CimInstance Win32_Process -Filter "ProcessId=$target" -ErrorAction Stop)
  $row=[ordered]@{processId=$target;cimBeforeCount=$before.Count;cimAfterCount=$null;cimCreationUtc=$null;cimCreationAfterUtc=$null;parentProcessId=$null;parentAfterProcessId=$null;name=$null;sessionId=$null;image=$null;commandLine=$null;openError=$null;imageError=$null;timesError=$null;commandStatusFirst=$null;commandStatusSecond=$null;nativeCreationFileTime=$null;identityStable=$false;commandStable=$false;nativeCimBirthEqual=$false}
  if($before.Count -eq 1){$row.parentProcessId=[int]$before[0].ParentProcessId;$row.name=$before[0].Name;$row.sessionId=[int]$before[0].SessionId;if($null -ne $before[0].CreationDate){$row.cimCreationUtc=$before[0].CreationDate.ToUniversalTime().ToString('o')}}
  $h=[ReleaseSiteIdentityV1]::OpenProcess(0x1000,$false,[uint32]$target)
  try{
    if($h -eq [IntPtr]::Zero){$row.openError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
    else{
      $c1=0L;$c2=0L;$e=0L;$k=0L;$u=0L
      $t1=[ReleaseSiteIdentityV1]::GetProcessTimes($h,[ref]$c1,[ref]$e,[ref]$k,[ref]$u)
      if(!$t1){$row.timesError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
      $image=[Text.StringBuilder]::new(32768);$length=[uint32]32768
      if([ReleaseSiteIdentityV1]::QueryFullProcessImageName($h,0,$image,[ref]$length)){$row.image=$image.ToString()}else{$row.imageError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
      $s1=0;$s2=0;$cmd1=[ReleaseSiteIdentityV1]::Command($h,[ref]$s1);$cmd2=[ReleaseSiteIdentityV1]::Command($h,[ref]$s2)
      $row.commandStatusFirst=$s1;$row.commandStatusSecond=$s2
      $row.commandStable=$s1 -eq 0 -and $s2 -eq 0 -and $null -ne $cmd1 -and [string]::Equals($cmd1,$cmd2,[StringComparison]::Ordinal)
      if($row.commandStable){$row.commandLine=$cmd2}
      $row.cimNativeCommandEqual=if($before.Count -eq 1 -and $null -ne $before[0].CommandLine){[string]::Equals([string]$before[0].CommandLine,$cmd2,[StringComparison]::Ordinal)}else{$null}
      $row.cimNativeImageEqual=if($before.Count -eq 1 -and $null -ne $before[0].ExecutablePath){[string]::Equals([string]$before[0].ExecutablePath,[string]$row.image,[StringComparison]::OrdinalIgnoreCase)}else{$null}
      $t2=[ReleaseSiteIdentityV1]::GetProcessTimes($h,[ref]$c2,[ref]$e,[ref]$k,[ref]$u)
      if(!$t2){$row.timesError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
      $after=@(Get-CimInstance Win32_Process -Filter "ProcessId=$target" -ErrorAction Stop);$row.cimAfterCount=$after.Count
      if($after.Count -eq 1){$row.parentAfterProcessId=[int]$after[0].ParentProcessId;if($null -ne $after[0].CreationDate){$row.cimCreationAfterUtc=$after[0].CreationDate.ToUniversalTime().ToString('o')}}
      if($t1){$row.nativeCreationFileTime=$c1.ToString([Globalization.CultureInfo]::InvariantCulture)}
      $row.nativeCimBirthEqual=$t1 -and $before.Count -eq 1 -and $null -ne $before[0].CreationDate -and [ReleaseSiteIdentityV1]::SameCreation($c1,$before[0].CreationDate.ToUniversalTime().ToFileTimeUtc())
      $row.identityStable=$t1 -and $t2 -and $c1 -eq $c2 -and $row.nativeCimBirthEqual -and $after.Count -eq 1 -and $null -ne $row.cimCreationUtc -and $row.cimCreationUtc -ceq $row.cimCreationAfterUtc -and $row.parentProcessId -eq $row.parentAfterProcessId -and $before[0].Name -ceq $after[0].Name -and $before[0].SessionId -eq $after[0].SessionId
    }
  }finally{if($h -ne [IntPtr]::Zero){[void][ReleaseSiteIdentityV1]::CloseHandle($h)}}
  $rows+=[pscustomobject]$row
}
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
[pscustomobject]@{version='fixed-startup-native-capture-v1';sid=$actor.User.Value;administrator=$true;startedAt=$began;completedAt=[DateTimeOffset]::UtcNow.ToString('o');processes=$capture.processes;selectedCwd=$capture.selectedCwd;summary=$capture.summary;fixedRows=$rows;productionActions=0}|ConvertTo-Json -Depth 10 -Compress
