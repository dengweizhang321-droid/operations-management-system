param([ValidateSet('Before','After')][string]$Phase='Before')
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$administrator=([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if($identity.User.Value -cne 'S-1-5-21-815909789-107973518-1379257801-1001' -or -not $administrator){throw 'Approved administrator required'}
$library='D:\teruisi-runtime\django-sales\app\tools\django-local-service.ps1'
if((Get-FileHash -LiteralPath $library -Algorithm SHA256).Hash.ToLowerInvariant() -cne '95331de5035e8c7a284eb3a8508b547ff6511e3d712078822f2d74bd63087b1c'){throw 'Django library drift'}
$saved=$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
try{$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1';. $library -Action Status -RuntimeRoot 'D:\teruisi-runtime\django-sales' -Json}finally{$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY=$saved}
# Library-only loading does not dispatch Status. Only the original ACL predicates
# are called: no process snapshot, stale-receipt cleanup or lifecycle action.
Assert-RuntimeRootAclHardened
$allowed=@((Get-AllowedAclSids)|ForEach-Object {$_.Value})
$parent=Get-Item -LiteralPath 'D:\teruisi-runtime\django-sales\run' -Force
if($parent.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Redirected gate parent'}
Assert-ExactRuntimeAclEntry $parent (Get-RuntimeItemAccessControl $parent) $allowed 'D:\teruisi-runtime\django-sales'
$target='D:\teruisi-runtime\django-sales\run\system-maintenance.json'
$present=Test-Path -LiteralPath $target
if($Phase -eq 'Before' -and $present){throw 'Maintenance already exists'}
if($Phase -eq 'After'){
 if(-not $present){throw 'Maintenance missing after creation'}
 $item=Get-Item -LiteralPath $target -Force
 if($item.PSIsContainer -or $item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Invalid gate file'}
 Assert-ExactRuntimeAclEntry $item (Get-RuntimeItemAccessControl $item) $allowed 'D:\teruisi-runtime\django-sales'
}
if((Get-FileHash -LiteralPath $library -Algorithm SHA256).Hash.ToLowerInvariant() -cne '95331de5035e8c7a284eb3a8508b547ff6511e3d712078822f2d74bd63087b1c'){throw 'Django library drift'}
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
[pscustomobject]@{version='repair-fence-actor-acl-v1';sid=$identity.User.Value;administrator=$administrator;phase=$Phase;rootAclVerified=$true;parentAclVerified=$true;markerAclVerified=($Phase -eq 'After');observedAt=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json -Compress
