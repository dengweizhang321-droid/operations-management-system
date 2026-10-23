$ErrorActionPreference='Stop';$i=[Security.Principal.WindowsIdentity]::GetCurrent();if($i.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not ([Security.Principal.WindowsPrincipal]::new($i)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Exact approved administrator identity required'}
$raw=[IO.File]::ReadAllBytes('E:\codex-artifacts\release-site-blockers-20261011\production-f15d06a\resume1\TRANSPORT_BINDING.json');$s=[Security.Cryptography.SHA256]::Create();try{$h=([BitConverter]::ToString($s.ComputeHash($raw))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($h -cne '522629ca7a49688c7bcdfc8b5ee7053d985be7085398df6d70b044c2e85d4273'){throw 'Frozen resume binding changed'};$p=[Text.Encoding]::UTF8.GetString($raw)|ConvertFrom-Json;$held=@();try{
foreach($e in $p.files){$f=[IO.File]::Open($e.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$held+=$f;$s=[Security.Cryptography.SHA256]::Create();try{$h=([BitConverter]::ToString($s.ComputeHash($f))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($h -cne $e.sha256){throw 'Resume closure changed'}}
Set-Location -LiteralPath 'D:\.codex\worktrees\release-site-blockers\运营管理系统'
& $p.node $p.runner $p.cipherManifestSha256
if($LASTEXITCODE -ne 0){throw 'Same batch resume blocked; preserve owner/gates/WAL'}
}finally{foreach($f in $held){$f.Dispose()}}
