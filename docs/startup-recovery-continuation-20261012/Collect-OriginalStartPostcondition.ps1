param([Parameter(Mandatory)][string]$OutputRoot)
$ErrorActionPreference='Stop'
$actor=[Security.Principal.WindowsIdentity]::GetCurrent()
$admin=([Security.Principal.WindowsPrincipal]::new($actor)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if($actor.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not $admin){throw 'Exact approved administrator required'}
$expectedRoot='E:\codex-artifacts\startup-recovery-continuation-20261012\original-start-postcondition-v1'
if([IO.Path]::GetFullPath($OutputRoot) -cne $expectedRoot){throw 'Fixed evidence root required'}
function Check-Physical([string]$Path){for($q=[IO.Path]::GetFullPath($Path);$q;$q=[IO.Path]::GetDirectoryName($q)){if((Get-Item -LiteralPath $q -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse path rejected'}}}
function Digest-Bytes([byte[]]$Bytes){$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
$pins=@(
 @{path='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe';sha256='7600ffe12da441fe89d035b13801e8e91d064bc544a27b19a5cf49f6ab8b18f5'},
 @{path='D:\运营管理系统\tools\process-deadline.ps1';sha256='5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd'},
 @{path='D:\运营管理系统\tools\worker-local-service.ps1';sha256='717408ad7b7880617967b5e230ea110c15c58b887532d02bef8eb42236f7bc1e'},
 @{path='D:\运营管理系统\tools\operations-system-control.ps1';sha256='0e87b26637e4aac807580432025d6291bcf87ac26752eef96b784e420ac7a810'},
 @{path='D:\teruisi-runtime\django-sales\app\tools\django-local-service.ps1';sha256='95331de5035e8c7a284eb3a8508b547ff6511e3d712078822f2d74bd63087b1c'},
 @{path='D:\teruisi-runtime\django-sales\app\deployment.json';sha256='85cf0699925aad21f98ae682f458789236d206723b10865939915d1bcacddd09'}
)
$holds=[Collections.Generic.List[object]]::new()
function Assert-Pins {foreach($p in $pins){Check-Physical $p.path;if((Get-FileHash -LiteralPath $p.path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $p.sha256){throw 'Original source drift'}}}
function Save-Once([string]$Name,[byte[]]$Bytes){$f=[IO.File]::Open((Join-Path $OutputRoot $Name),'CreateNew','Write','Read');try{$f.Write($Bytes,0,$Bytes.Length);$f.Flush($true)}finally{$f.Dispose()}}
function Capture([string]$Label,[string]$Script,[string]$Action){
 Assert-Pins
 $r=Invoke-DeadlineProcess -Executable 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Arguments @('-NoProfile','-NonInteractive','-File',$Script,'-Action',$Action,'-Json') -WorkingDirectory (Split-Path $Script) -Deadline $deadline -Cleanup Direct -MaxOutputBytes 2097152
 Save-Once ($Label+'.stdout.json') ([Text.Encoding]::UTF8.GetBytes($r.Stdout))
 Save-Once ($Label+'.stderr.log') ([Text.Encoding]::UTF8.GetBytes($r.Stderr))
 Save-Once ($Label+'.process.json') ([Text.Encoding]::UTF8.GetBytes(($r.Evidence|ConvertTo-Json -Depth 10 -Compress)))
 if($r.ExitCode -ne 0){throw ('Original postcondition probe failed: '+$Label)}
 if(-not $r.Stdout.TrimStart().StartsWith('{')){throw 'Probe JSON root must be an object'}
 $v=ConvertFrom-Json -InputObject $r.Stdout
 if($v -isnot [pscustomobject]){throw 'Probe object required'}
 Assert-Pins
 return $v
}
try{
 Check-Physical $OutputRoot
 foreach($p in $pins){$f=[IO.File]::Open($p.path,'Open','Read','Read');$holds.Add($f)}
 Assert-Pins
 . 'D:\运营管理系统\tools\process-deadline.ps1'
 $deadline=Get-ProcessDeadline 240000
 $oldModules=$env:PSModulePath;$oldLibrary=$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY;$oldMaintenanceLibrary=$env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY
 try{
  $env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules';$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY=$null;$env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY=$null
  $before=(Get-FileHash -LiteralPath 'D:\teruisi-runtime\django-sales\app\deployment.json' -Algorithm SHA256).Hash.ToLowerInvariant()
  $worker=Capture 'worker' 'D:\运营管理系统\tools\worker-local-service.ps1' 'Status'
  $control=Capture 'control' 'D:\运营管理系统\tools\operations-system-control.ps1' 'Status'
  $maintenance=Capture 'maintenance' 'D:\运营管理系统\tools\worker-local-service.ps1' 'MaintenanceStatus'
  $after=(Get-FileHash -LiteralPath 'D:\teruisi-runtime\django-sales\app\deployment.json' -Algorithm SHA256).Hash.ToLowerInvariant()
  $value=@{version='original-start-postcondition-capture-v1';role=@{sid=$actor.User.Value;administrator=$admin};worker=$worker;control=$control;maintenanceStatus=$maintenance;djangoBeforeSha256=$before;djangoAfterSha256=$after;completedAt=[DateTimeOffset]::UtcNow.ToString('o');sourcePins=$pins;originalStatusMayAuditOrCleanup=$true;startInvocations=0;backupRestoreInvocations=0}
  $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($value|ConvertTo-Json -Depth 16 -Compress))
  Save-Once 'CAPTURE_RESULT.json' $bytes
  [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);[Console]::WriteLine([Text.Encoding]::UTF8.GetString($bytes))
 }finally{$env:PSModulePath=$oldModules;$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY=$oldLibrary;$env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY=$oldMaintenanceLibrary}
}finally{foreach($f in $holds){$f.Dispose()}}
