param([string]$Source,[string]$DeadlineSource,[string]$Root,[string]$Shell,
 [ValidateSet('extended','deadline','fence','maintenance','abandoned')][string]$Mode)
$ErrorActionPreference='Stop'
$ast=[Management.Automation.Language.Parser]::ParseFile($Source,[ref]$null,[ref]$null)
$function=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Invoke-WithServiceMutex'},$true)
. ([scriptblock]::Create($function.Extent.Text))
function Get-CanonicalPath([string]$value){[IO.Path]::GetFullPath($value).TrimEnd('\')}
function Get-Sha256Text([string]$value){$s=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($s.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}}
function Write-LauncherEvent([string]$level,[string]$event,[string]$detail){$script:events+=,$event}
function Assert-NoSystemMaintenance {if(Test-Path -LiteralPath (Join-Path $Root 'maintenance')){throw 'fixture maintenance active'}}
function Get-FileSha256([string]$file){return ('a'*64)}
function Assert-SupervisorStartFence([string]$sha){throw 'fixture stopped or changed desired-state fence'}
$RuntimeRoot=$Root;$SupervisorDesiredStatePath=Join-Path $Root 'intent';$script:events=@()
$name='Local\TERUISI-DjangoSales-'+(Get-Sha256Text (Get-CanonicalPath $Root)).Substring(0,24)
$ready=Join-Path $Root 'ready';$effectFile=Join-Path $Root 'operation'
$delay=if($Mode -ceq 'extended'){35000}elseif($Mode -ceq 'deadline'){5000}else{400}
$abandon=if($Mode -ceq 'abandoned'){'[Environment]::Exit(0)'}else{'$m.ReleaseMutex()'}
$change=if($Mode -ceq 'maintenance'){"[IO.File]::WriteAllText('$(Join-Path $Root 'maintenance')','closed');"}else{''}
$holderCode="`$ErrorActionPreference='Stop';`$m=[Threading.Mutex]::new(`$false,'$name');`$null=`$m.WaitOne();[IO.File]::WriteAllText('$ready','ready');Start-Sleep -Milliseconds $delay;$change $abandon"
$info=New-Object Diagnostics.ProcessStartInfo
$info.FileName=$Shell;$info.Arguments='-NoProfile -NonInteractive -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($holderCode))
$info.UseShellExecute=$false;$info.CreateNoWindow=$true
$holder=$null;$keep=[Threading.Mutex]::new($false,$name)
try{
 $holder=[Diagnostics.Process]::Start($info)
 $readyClock=[Diagnostics.Stopwatch]::StartNew()
 while(-not(Test-Path -LiteralPath $ready)){if($holder.HasExited -or $readyClock.ElapsedMilliseconds -gt 10000){throw 'fixture holder not ready'};Start-Sleep -Milliseconds 20}
 $Action=if($Mode -ceq 'fence'){'Start'}elseif($Mode -ceq 'deadline'){'CompleteDrain'}else{'AutoStartDingTalk'}
 $env:TERUISI_PROCESS_DEADLINE_UNIX_MS=[string]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+$(if($Mode -ceq 'extended'){50000}elseif($Mode -ceq 'deadline'){600}else{5000}))
 $clock=[Diagnostics.Stopwatch]::StartNew();$message=$null
 try{Invoke-WithServiceMutex {[IO.File]::WriteAllText($effectFile,'ran')}}catch{$message=$_.Exception.Message}
 if($Mode -ceq 'extended'){
  if($message -or -not(Test-Path -LiteralPath $effectFile) -or $clock.ElapsedMilliseconds -lt 30000 -or $clock.ElapsedMilliseconds -gt 47000){throw "extended wait failed: $message elapsed=$($clock.ElapsedMilliseconds)"}
  if($script:events -cnotcontains 'release_mutex_waiting'){throw 'missing lifecycle wait log'}
 }elseif($Mode -ceq 'abandoned'){
  if($message -or -not(Test-Path -LiteralPath $effectFile) -or $script:events -cnotcontains 'abandoned_mutex_recovered'){throw 'abandoned mutex behavior changed'}
 }else{
  if(-not $message -or (Test-Path -LiteralPath $effectFile)){throw 'rejected operation ran'}
  if($Mode -ceq 'deadline' -and $clock.ElapsedMilliseconds -gt 2000){throw 'inherited deadline was not respected'}
  if($Mode -ceq 'fence' -and $message -notlike '*desired-state fence*'){throw $message}
  if($Mode -ceq 'maintenance' -and $message -notlike '*maintenance active*'){throw $message}
 }
 @{mode=$Mode;passed=$true;elapsedMs=$clock.ElapsedMilliseconds}|ConvertTo-Json -Compress
}finally{if($holder){if(-not $holder.HasExited){$holder.Kill()};$null=$holder.WaitForExit(5000);$holder.Dispose()};$keep.Dispose()}
