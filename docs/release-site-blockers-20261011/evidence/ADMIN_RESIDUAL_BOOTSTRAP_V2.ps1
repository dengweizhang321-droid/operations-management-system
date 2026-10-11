$ErrorActionPreference='Stop'
function Get-ResidualBytesSha256([byte[]]$b){$s=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($s.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}}
$r=[IO.File]::ReadAllBytes('E:\codex-artifacts\release-site-blockers-20261011\ADMIN_RESIDUAL_PACKET_V2.json')
if((Get-ResidualBytesSha256 $r) -cne 'bb861c8fecab8e5652029c6c509daba48b767344a0c494ea39bd281a83c4b0e0'){throw 'Packet drift'}
$p=[Text.Encoding]::UTF8.GetString($r)|ConvertFrom-Json
if($p.version -cne 'teruisi-five-process-readonly-packet-v1' -or $p.productionApproved -isnot [bool] -or $p.productionApproved){throw 'Wrong mode'}
$i=[Security.Principal.WindowsIdentity]::GetCurrent()
if($i.User.Value -cne $p.windowsSid -or -not ([Security.Principal.WindowsPrincipal]::new($i)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Use the existing approved administrator PowerShell; no automatic elevation'}
function Assert-ResidualPhysicalPath($v){$c=[IO.Path]::GetFullPath($v);while($c){$x=Get-Item -LiteralPath $c -Force;if(($x.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Redirected path'};$a=[IO.Path]::GetDirectoryName($c);if($a -eq $c){break};$c=$a}}
if([IO.Path]::GetFullPath($p.outputPath) -cne 'E:\codex-artifacts\release-site-blockers-20261011\ADMIN_RESIDUAL_METADATA_V2.json'){throw 'Output scope changed'}
Assert-ResidualPhysicalPath ([IO.Path]::GetDirectoryName($p.outputPath));if(Test-Path -LiteralPath $p.outputPath){throw 'Create-only output exists'}
Assert-ResidualPhysicalPath $p.script.path
$f=[IO.File]::Open($p.script.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try{$b=[IO.File]::ReadAllBytes($p.script.path);if((Get-ResidualBytesSha256 $b) -cne $p.script.sha256){throw 'Script drift'};$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules;C:\Program Files\WindowsPowerShell\Modules';& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($b))) -OutputPath $p.outputPath}finally{$f.Dispose()}
