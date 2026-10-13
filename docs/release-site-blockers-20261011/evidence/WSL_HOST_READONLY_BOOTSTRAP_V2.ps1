$ErrorActionPreference='Stop'
function Get-HostPacketBytesSha256([byte[]]$b){$s=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($s.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}}
$r=[IO.File]::ReadAllBytes('E:\codex-artifacts\release-site-blockers-20261011\WSL_HOST_READONLY_PACKET_V2.json')
if((Get-HostPacketBytesSha256 $r) -cne '6af6ec639f51242f3afc8290669fe83f9ea8a7cfab77794ceccead28445f67ad'){throw 'Host packet drift'}
$p=[Text.Encoding]::UTF8.GetString($r)|ConvertFrom-Json
if($p.version -cne 'teruisi-wsl-host-readonly-packet-v1' -or $p.productionApproved -isnot [bool] -or $p.productionApproved){throw 'Wrong packet mode'}
$i=[Security.Principal.WindowsIdentity]::GetCurrent()
if($i.User.Value -cne $p.windowsSid -or -not ([Security.Principal.WindowsPrincipal]::new($i)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Existing administrator PowerShell required; no automatic elevation'}
function Assert-HostPacketPhysicalPath($v){$c=[IO.Path]::GetFullPath($v);while($c){$x=Get-Item -LiteralPath $c -Force;if(($x.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Redirected host audit path'};$a=[IO.Path]::GetDirectoryName($c);if($a -eq $c){break};$c=$a}}
if([IO.Path]::GetFullPath($p.outputPath) -cne 'E:\codex-artifacts\release-site-blockers-20261011\WSL_HOST_ASSOCIATION_ADMIN_V1.json'){throw 'Output outside scope'}
Assert-HostPacketPhysicalPath ([IO.Path]::GetDirectoryName($p.outputPath));if(Test-Path -LiteralPath $p.outputPath){throw 'Create-only output exists'}
$baseline=[IO.File]::ReadAllBytes('E:\codex-artifacts\release-site-blockers-20261011\ADMIN_RESIDUAL_METADATA_V2.json');if((Get-HostPacketBytesSha256 $baseline) -cne $p.baselineSha256){throw 'Approved baseline drift'}
Assert-HostPacketPhysicalPath $p.script.path
$f=[IO.File]::Open($p.script.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try{$b=[IO.File]::ReadAllBytes($p.script.path);if((Get-HostPacketBytesSha256 $b) -cne $p.script.sha256){throw 'Host source drift'};$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules;C:\Program Files\WindowsPowerShell\Modules';& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($b))) -OutputPath $p.outputPath}finally{$f.Dispose()}
