$ErrorActionPreference='Stop'
$r=[IO.File]::ReadAllBytes('E:\codex-artifacts\release-site-blockers-20261011\ADMIN_READONLY_PACKET_V2.json')
$s=[Security.Cryptography.SHA256]::Create();try{$h=([BitConverter]::ToString($s.ComputeHash($r))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}
if($h -cne '9e906d1e53ee9acf67b909be0198520e137d9cc08d1b8fbc3aa5adf7f709df38'){throw 'Readonly packet drift'}
$p=[Text.Encoding]::UTF8.GetString($r)|ConvertFrom-Json
$f=[IO.File]::Open([string]$p.launcher.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try{$s=[Security.Cryptography.SHA256]::Create();try{$h=([BitConverter]::ToString($s.ComputeHash($f))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($h -cne $p.launcher.sha256){throw 'Readonly launcher drift'};& $p.launcher.path -PacketSha256 '9e906d1e53ee9acf67b909be0198520e137d9cc08d1b8fbc3aa5adf7f709df38' -Launch}finally{$f.Dispose()}
Write-Host 'Readonly request dispatched. No release, restart, backup or restore was requested.'
