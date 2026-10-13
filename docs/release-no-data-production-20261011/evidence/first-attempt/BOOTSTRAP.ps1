$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if($identity.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Exact approved administrator identity required'}
function Get-TransportHash([byte[]]$bytes){$s=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($s.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}}
$raw=[IO.File]::ReadAllBytes('E:\codex-artifacts\release-site-blockers-20261011\production-f15d06a\TRANSPORT_BINDING.json')
if((Get-TransportHash $raw) -cne '55bb79503d4f1922da7f237a52d0ac1fdf7c5cc05ae7a943aab2971a8ed16383'){throw 'Approved transport binding drift'}
$p=[Text.Encoding]::UTF8.GetString($raw)|ConvertFrom-Json;$held=@()
try {foreach($e in $p.files){$f=[IO.File]::Open($e.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$held+=$f;$s=[Security.Cryptography.SHA256]::Create();try{$h=([BitConverter]::ToString($s.ComputeHash($f))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($h -cne $e.sha256){throw 'Approved transport input bytes changed'}}
foreach($e in @(Get-ChildItem Env:|Where-Object{$_.Name -like 'NODE_*'})){[Environment]::SetEnvironmentVariable($e.Name,$null,'Process')}
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules;C:\Program Files\WindowsPowerShell\Modules'
Set-Location -LiteralPath $p.workingDirectory
& $p.node $p.runner $p.approvalSha256
if($LASTEXITCODE -ne 0){throw 'Approved batch blocked; retain exact original owner, maintenance, drain and WAL'}
}finally{foreach($f in $held){$f.Dispose()}}
