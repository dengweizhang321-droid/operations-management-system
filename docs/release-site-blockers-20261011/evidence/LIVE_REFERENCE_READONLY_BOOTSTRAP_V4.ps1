$ErrorActionPreference='Stop'
function Get-QualificationBytesSha([byte[]]$b){$s=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($s.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}}
$b=[IO.File]::ReadAllBytes('E:\codex-artifacts\release-site-blockers-20261011\LIVE_REFERENCE_READONLY_QUALIFICATION_V4.json')
if((Get-QualificationBytesSha $b) -cne 'de8900edfc9a3216791d59bb5a58a75fb2eac8d8a1186fd265f3e9fd3f66d785'){throw 'Readonly qualification packet drift'}
$p=[Text.Encoding]::UTF8.GetString($b)|ConvertFrom-Json
$i=[Security.Principal.WindowsIdentity]::GetCurrent();if($i.User.Value -cne $p.windowsSid -or -not ([Security.Principal.WindowsPrincipal]::new($i)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Approved same-SID admin token required'}
if($p.productionApproved -isnot [bool] -or $p.productionApproved){throw 'Readonly mode required'}
$held=@();try{
foreach($e in $p.entries){$f=[IO.File]::Open($e.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$held+=$f;$s=[Security.Cryptography.SHA256]::Create();try{$h=([BitConverter]::ToString($s.ComputeHash($f))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()};if($h -cne $e.sha256){throw 'Readonly closure changed'}}
foreach($name in @(Get-ChildItem Env:|Where-Object {$_.Name -like 'NODE_*'})) {[Environment]::SetEnvironmentVariable($name.Name,$null,'Process')}
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules;C:\Program Files\WindowsPowerShell\Modules'
& $p.node $p.qualifier
if($LASTEXITCODE -ne 0){throw 'Readonly live qualification refused; original failure retained'}
}finally{foreach($f in $held){$f.Dispose()}}
