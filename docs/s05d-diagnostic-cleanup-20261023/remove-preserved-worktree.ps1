$ErrorActionPreference='Stop'
$target='D:\codex-worktrees\s05d-handoff-staging-diagnostic-20261023'
$workspace='D:\codex-worktrees\s05d-diagnostic-cleanup-20261023'
$docs=Join-Path $workspace 'docs/s05d-diagnostic-cleanup-20261023'
$manifestFile=Join-Path $docs 'preservation.json'
$manifestSha='ae9192d5d975530718f69e79ad9347db15d4b5da4f29ccedd3d5dbbc40ca455e'
$backup='D:\codex-artifacts\s05d-diagnostic-cleanup-20261023\preserved-3f15a48b-c867-473e-95df-5875dda958db'
$git='D:\git\Git\cmd\git.exe'
function Hash([string]$p){return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function Physical([string]$p){$full=[IO.Path]::GetFullPath($p);$n=$full;while($n){$item=Get-Item -LiteralPath $n -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse point refused'};$parent=[IO.Path]::GetDirectoryName($n);if($parent -eq $n){break};$n=$parent};return $full}
function Source([string]$relative){if([IO.Path]::IsPathRooted($relative) -or $relative -match '(^|[\\/])\.\.([\\/]|$)'){throw 'Unsafe relative member'};$full=[IO.Path]::GetFullPath((Join-Path $target $relative));if(-not $full.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Outside exact worktree'};[void](Physical $full);return $full}
if((Physical $target) -cne $target -or [IO.Path]::GetDirectoryName($target) -cne 'D:\codex-worktrees'){throw 'Resolved target changed'}
if((Hash $manifestFile) -cne $manifestSha -or (Hash (Join-Path $backup 'MANIFEST.json')) -cne $manifestSha){throw 'Preservation manifest changed'}
$m=Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8|ConvertFrom-Json
if($m.target -cne $target -or $m.backup -cne $backup -or $m.extraCount -ne 44 -or $m.trackedCount -ne 9653 -or -not $m.archive.gitBlobContentsVerified){throw 'Unexpected preservation scope'}
if((Hash $m.archive.path) -cne $m.archive.sha256){throw 'Tracked backup changed'}
if(Test-Path -LiteralPath 'D:/运营管理系统/.git/worktrees/s05d-handoff-staging-diagnostic-20261023/locked'){throw 'Worktree locked'}
$head=(& $git -C $target rev-parse HEAD);if($LASTEXITCODE -ne 0 -or $head -cne $m.head){throw 'Source HEAD changed'}
$diff=@(& $git -C $target diff --name-only HEAD --);if($LASTEXITCODE -ne 0 -or $diff.Count){throw 'Tracked changes appeared'}
$ignored=@(& $git -C $target ls-files --others --ignored --exclude-standard);if($LASTEXITCODE -ne 0 -or $ignored.Count){throw 'Ignored data appeared'}
$extra=@(& $git -C $target -c core.quotepath=false ls-files --others --exclude-standard);if($LASTEXITCODE -ne 0){throw 'Member enumeration failed'}
if((($extra|Sort-Object) -join "`n") -cne (($m.files.path|Sort-Object) -join "`n")){throw 'Untracked set changed'}
# Validate the complete preserved set before the first removal.
foreach($r in $m.files){$p=Source $r.path;$i=Get-Item -LiteralPath $p -Force;if($i.PSIsContainer -or $i.Length -ne $r.bytes -or (Hash $p) -cne $r.sha256 -or (Hash (Join-Path "$backup/files" $r.path)) -cne $r.sha256){throw 'Source/backup differs'}}
& (Join-Path $docs 'check-bindings.ps1')
$bindings=Get-Content -LiteralPath (Join-Path $docs 'bindings.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($bindings.processRefs.Count -or $bindings.serviceRefs.Count -or $bindings.taskRefs.Count -or -not $bindings.priorDiagnosticTaskAbsent){throw 'Dependencies appeared'}
$removed=[Collections.Generic.List[string]]::new()
foreach($r in $m.files){$p=Source $r.path;if((Hash $p) -cne $r.sha256){throw 'Member changed before removal'};Remove-Item -LiteralPath $p -Force;$removed.Add([string]$r.path)}
foreach($rel in @('diagnostics/handoff','diagnostics','docs/s05d-handoff-staging-diagnostic-20261023')){$p=Source $rel;if(@(Get-ChildItem -LiteralPath $p -Force).Count -ne 0){throw 'Unexpected nonempty diagnostic directory'};[IO.Directory]::Delete($p,$false)}
$status=@(& $git -C $target status --porcelain --untracked-files=all);if($LASTEXITCODE -ne 0 -or $status.Count){throw 'Source not clean after exact cleanup'}
& $git -C $workspace worktree remove -- $target
if($LASTEXITCODE -ne 0 -or (Test-Path -LiteralPath $target)){throw 'Native worktree removal incomplete'}
$list=@(& $git -C $workspace worktree list --porcelain);if($LASTEXITCODE -ne 0 -or ($list -match 's05d-handoff-staging-diagnostic-20261023')){throw 'Registration remains'}
$result=@{at=[DateTime]::UtcNow.ToString('o');target=$target;backup=$backup;manifestSha256=$manifestSha;removedDiagnosticFiles=$removed.Count;worktreeAbsent=$true;registrationAbsent=$true;forceWorktreeRemoval=$false;branchPreserved=$m.branch;productionOperation=$false}
$json=$result|ConvertTo-Json -Depth 3
[IO.File]::WriteAllText((Join-Path $docs 'cleanup-result.json'),$json,[Text.UTF8Encoding]::new($false));$json
