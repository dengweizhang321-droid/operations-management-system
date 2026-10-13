param([Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$PacketSha256,[switch]$Launch)
$ErrorActionPreference='Stop'
$packetPath='E:\codex-artifacts\release-site-blockers-20261011\ADMIN_READONLY_PACKET_V2.json'
$packetRaw=[IO.File]::ReadAllBytes($packetPath)
function Get-ByteHash([byte[]]$Bytes){$algorithm=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$algorithm.Dispose()}}
if((Get-ByteHash $packetRaw) -cne $PacketSha256){throw 'Approved readonly packet changed'}
$packet=[Text.Encoding]::UTF8.GetString($packetRaw)|ConvertFrom-Json
if($packet.version -cne 'teruisi-admin-readonly-packet-v1' -or $packet.productionApproved -isnot [bool] -or $packet.productionApproved -ne $false){throw 'Not a readonly packet'}
if((Get-ByteHash ([IO.File]::ReadAllBytes($MyInvocation.MyCommand.Path))) -cne $packet.launcher.sha256){throw 'Readonly launcher drift'}
if(-not $Launch){[pscustomobject]@{status='review-only';packetSha256=$PacketSha256;scope=$packet.scope;productionActions=0}|ConvertTo-Json;return}
# This bootstrap runs as literal encoded source. It verifies and captures script bytes
# before evaluating them; it never executes a mutable helper via -File.
$bootstrap=@'
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
function HashBytes([byte[]]$b){$s=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($s.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}}
$raw=[IO.File]::ReadAllBytes('E:\codex-artifacts\release-site-blockers-20261011\ADMIN_READONLY_PACKET_V2.json')
if((HashBytes $raw) -cne '__PACKET_SHA__'){throw 'Readonly packet drift'}
$p=[Text.Encoding]::UTF8.GetString($raw)|ConvertFrom-Json
if($p.version -cne 'teruisi-admin-readonly-packet-v1' -or $p.productionApproved -isnot [bool] -or $p.productionApproved -ne $false){throw 'Wrong mode'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if($identity.User.Value -cne $p.windowsSid){throw 'Different Windows identity'}
if(-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Administrator readonly token required'}
function AssertPhysical($path){
 $cursor=[IO.Path]::GetFullPath([string]$path)
 while($cursor){$item=Get-Item -LiteralPath $cursor -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Redirected pinned path'};$parent=[IO.Path]::GetDirectoryName($cursor);if($parent -eq $cursor){break};$cursor=$parent}
}
function ReadPinned($entry){
 $full=[IO.Path]::GetFullPath([string]$entry.path);AssertPhysical $full
 $bytes=[IO.File]::ReadAllBytes($full);if((HashBytes $bytes) -cne $entry.sha256){throw 'Readonly source drift'};return ,$bytes
}
foreach($target in @($p.captureSummaryPath,$p.resultPath,$p.completionPath)){
 if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath([string]$target)) -cne 'E:\codex-artifacts\release-site-blockers-20261011'){throw 'Output escaped fixed audit root'}
 AssertPhysical ([IO.Path]::GetDirectoryName([string]$target));if(Test-Path -LiteralPath $target){throw 'Readonly output already exists'}
}
AssertPhysical $p.node.path
$nodeFile=[IO.File]::Open([string]$p.node.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try{
 $nodeHasher=[Security.Cryptography.SHA256]::Create()
 try{$nodeHash=([BitConverter]::ToString($nodeHasher.ComputeHash($nodeFile))).Replace('-','').ToLowerInvariant()}finally{$nodeHasher.Dispose()}
 if($nodeHash -cne $p.node.sha256){throw 'Readonly Node binary drift'}
$collector=ReadPinned $p.collector
$evaluator=ReadPinned $p.evaluator
$PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules;C:\Program Files\WindowsPowerShell\Modules'
$env:PSModulePath=$PSModulePath
$capture=& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($collector))) -OutputPath $p.captureSummaryPath
$captureText=[string]::Join([Environment]::NewLine,[string[]]$capture)
if([Text.Encoding]::UTF8.GetByteCount($captureText) -gt 8388608){throw 'Capture too large'}
$start=New-Object Diagnostics.ProcessStartInfo
$start.FileName=[string]$p.node.path;$start.UseShellExecute=$false;$start.CreateNoWindow=$true
$start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
$start.StandardOutputEncoding=New-Object Text.UTF8Encoding($false)
$start.StandardErrorEncoding=New-Object Text.UTF8Encoding($false)
foreach($key in @($start.EnvironmentVariables.Keys|Where-Object {$_ -like 'NODE_*'})){$start.EnvironmentVariables.Remove([string]$key)}
$source64=[Convert]::ToBase64String($evaluator)
$start.Arguments='--input-type=module --eval "await import(''data:text/javascript;base64,''+process.argv[1]);" '+$source64+' "'+[string]$p.resultPath+'"'
$child=[Diagnostics.Process]::Start($start)
$stdout=$child.StandardOutput.ReadToEndAsync();$stderr=$child.StandardError.ReadToEndAsync()
$stdinBytes=[Text.UTF8Encoding]::new($false).GetBytes($captureText)
$child.StandardInput.BaseStream.Write($stdinBytes,0,$stdinBytes.Length);$child.StandardInput.BaseStream.Flush();$child.StandardInput.BaseStream.Close()
if(-not $child.WaitForExit(60000)){throw 'Readonly evaluator timeout; process not terminated automatically'}
$out=$stdout.GetAwaiter().GetResult();$err=$stderr.GetAwaiter().GetResult()
if($child.ExitCode -ne 0){throw ('Readonly evaluator failed: '+$err)}
$result=[ordered]@{version='teruisi-admin-readonly-completion-v1';at=[DateTimeOffset]::UtcNow.ToString('o');packetSha256='__PACKET_SHA__';status='completed-readonly';resultPath=$p.resultPath;productionActions=0;privilegesAdjusted=$false}
$file=[IO.File]::Open([string]$p.completionPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try{$b=[Text.UTF8Encoding]::new($false).GetBytes(($result|ConvertTo-Json)+[Environment]::NewLine);$file.Write($b,0,$b.Length)}finally{$file.Dispose()}
}finally{$nodeFile.Dispose()}
'@
$bootstrap=$bootstrap.Replace('__PACKET_SHA__',$PacketSha256)
$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($bootstrap))
Start-Process -FilePath 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand',$encoded)
[pscustomobject]@{status='Windows-admin-confirmation-requested';packetSha256=$PacketSha256;productionActions=0}|ConvertTo-Json
