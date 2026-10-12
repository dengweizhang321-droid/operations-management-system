# Fixed diagnostic only. Load the pinned original C# declaration, not the
# collector program. The only target handle opened here is PID43884/0x1000.
$ErrorActionPreference='Stop'
if([IntPtr]::Size -ne 8){throw 'x64 required'}
$actor=[Security.Principal.WindowsIdentity]::GetCurrent()
if($actor.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001'){throw 'Wrong SID'}
$admin=([Security.Principal.WindowsPrincipal]::new($actor)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if($admin){throw 'This capability probe requires the ordinary token'}
function Get-ProbeHash([byte[]]$Bytes){$sha=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}
$sourcePath='D:\.codex\worktrees\release-site-blockers\运营管理系统\docs\release-site-blockers-20261011\Collect-LiveProcessIdentity.ps1'
$held=[IO.File]::Open($sourcePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try{
  $buffer=[IO.MemoryStream]::new();$held.CopyTo($buffer);$raw=$buffer.ToArray();$buffer.Dispose()
  if((Get-ProbeHash $raw) -cne '280fa1cd5b4c22b73743736e1b2c6d4b50f0a106e36e8fd8b139682666903c12'){throw 'Source drift'}
  $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput(([Text.UTF8Encoding]::new($false,$true)).GetString($raw),[ref]$tokens,[ref]$errors)
  if($errors.Count){throw 'Invalid pinned source'}
  $defs=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -ceq 'Add-Type'},$true))
  if($defs.Count -ne 1){throw 'Unexpected type declaration count'}
  Invoke-Expression $defs[0].Extent.Text
  $before=@(Get-CimInstance Win32_Process -Filter 'ProcessId=43884' -ErrorAction Stop)
  $result=[ordered]@{version='fixed-limited-worker-metadata-v1';sid=$actor.User.Value;administrator=$admin;processId=43884;accessMask='0x1000';cimRowsBefore=$before.Count;cimRowsAfter=$null;cimImageReadable=($before.Count -eq 1 -and $null -ne $before[0].ExecutablePath);cimCommandReadable=($before.Count -eq 1 -and $null -ne $before[0].CommandLine);openError=$null;imageError=$null;timesError=$null;nativeCreationFileTime=$null;commandStatusFirst=$null;commandStatusSecond=$null;commandStable=$false;identityStable=$false;expectedInstance=$false;imageSha256=$null;commandSha256=$null;productionActions=0;rawCommandPersisted=$false}
  $h=[ReleaseSiteIdentityV1]::OpenProcess(0x1000,$false,43884)
  try{
    if($h -eq [IntPtr]::Zero){$result.openError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
    else{
      $c1=0L;$c2=0L;$e=0L;$k=0L;$u=0L;$t1=[ReleaseSiteIdentityV1]::GetProcessTimes($h,[ref]$c1,[ref]$e,[ref]$k,[ref]$u);if(!$t1){$result.timesError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
      $image=[Text.StringBuilder]::new(32768);$size=[uint32]32768;if([ReleaseSiteIdentityV1]::QueryFullProcessImageName($h,0,$image,[ref]$size)){$result.imageSha256=Get-ProbeHash ([Text.Encoding]::UTF8.GetBytes($image.ToString()))}else{$result.imageError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
      $s1=0;$s2=0;$cmd1=[ReleaseSiteIdentityV1]::Command($h,[ref]$s1);$cmd2=[ReleaseSiteIdentityV1]::Command($h,[ref]$s2);$result.commandStatusFirst=$s1;$result.commandStatusSecond=$s2;$result.commandStable=$s1 -eq 0 -and $s2 -eq 0 -and $null -ne $cmd1 -and [string]::Equals($cmd1,$cmd2,[StringComparison]::Ordinal);if($result.commandStable){$result.commandSha256=Get-ProbeHash ([Text.Encoding]::UTF8.GetBytes($cmd2))}
      $t2=[ReleaseSiteIdentityV1]::GetProcessTimes($h,[ref]$c2,[ref]$e,[ref]$k,[ref]$u);if(!$t2){$result.timesError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
      $after=@(Get-CimInstance Win32_Process -Filter 'ProcessId=43884' -ErrorAction Stop);$result.cimRowsAfter=$after.Count
      if($t1){$result.nativeCreationFileTime=$c1.ToString([Globalization.CultureInfo]::InvariantCulture)}
      $result.identityStable=$t1 -and $t2 -and $c1 -eq $c2 -and $before.Count -eq 1 -and $after.Count -eq 1 -and $null -ne $before[0].CreationDate -and $before[0].CreationDate -eq $after[0].CreationDate -and [ReleaseSiteIdentityV1]::SameCreation($c1,$before[0].CreationDate.ToUniversalTime().ToFileTimeUtc()) -and $before[0].Name -ceq $after[0].Name -and $before[0].SessionId -eq $after[0].SessionId
      $result.expectedInstance=$result.identityStable -and $result.nativeCreationFileTime -ceq '134362442320254111'
    }
  }finally{if($h -ne [IntPtr]::Zero){[void][ReleaseSiteIdentityV1]::CloseHandle($h)}}
  $result.observedAt=[DateTimeOffset]::UtcNow.ToString('o');[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$result|ConvertTo-Json -Compress
}finally{$held.Dispose()}
