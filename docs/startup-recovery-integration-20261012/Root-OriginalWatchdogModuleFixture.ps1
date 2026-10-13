param([string]$Candidate,[string]$ExpectedHost)
$ErrorActionPreference='Stop'
$watch=New-Module -Name ('RootWatch-'+[guid]::NewGuid().ToString('N')) -ArgumentList $Candidate -ScriptBlock {param($file);. $file -Action Check -FunctionsOnly}
$before=& $watch {
 [pscustomobject]@{action=$Action;execute=[bool]$Execute;powerShellPath=$PowerShellPath;backendRoot=$BackendRoot;planFunctionFile=(Get-Command Get-WatchInstallPlan).ScriptBlock.File;installFunctionFile=(Get-Command Install-WatchdogSafely).ScriptBlock.File}
}
$dirty=New-Module -Name ('RootDjangoContrast-'+[guid]::NewGuid().ToString('N')) -ScriptBlock {
 $Action='Status';$Execute=$true;$RuntimeRoot='synthetic-only';$PowerShellPath='invalid-other-host';function Get-Contrast {return @{Action=$Action;Execute=[bool]$Execute;Root=$RuntimeRoot}}
}
$contrast=& $dirty {Get-Contrast}
$after=& $watch {
 [pscustomobject]@{action=$Action;execute=[bool]$Execute;powerShellPath=$PowerShellPath;backendRoot=$BackendRoot;planFunctionFile=(Get-Command Get-WatchInstallPlan).ScriptBlock.File;installFunctionFile=(Get-Command Install-WatchdogSafely).ScriptBlock.File}
}
if(($before|ConvertTo-Json -Compress) -cne ($after|ConvertTo-Json -Compress)){throw 'Module context polluted'}
if($before.action -cne 'Check' -or $before.execute -ne $false -or [IO.Path]::GetFullPath($before.powerShellPath) -ine [IO.Path]::GetFullPath($ExpectedHost)){throw 'Incorrect original host/parameters'}
$installer=Join-Path (Split-Path $Candidate) 'watchdog-install.ps1'
if([IO.Path]::GetFullPath($before.planFunctionFile) -ine [IO.Path]::GetFullPath($installer) -or [IO.Path]::GetFullPath($before.installFunctionFile) -ine [IO.Path]::GetFullPath($installer)){throw 'Original function origin changed'}
$fixtureMutex='Local\TERUISI.Root.ModuleFixture.'+[guid]::NewGuid().ToString('N')
$a=[Threading.Mutex]::new($false,$fixtureMutex);$b=[Threading.Mutex]::new($false,$fixtureMutex);$one=$false;$two=$false
try{$one=$a.WaitOne(0);$two=$b.WaitOne(0);if(-not $one -or -not $two){throw 'Same-thread reentry failed'}}finally{if($two){$b.ReleaseMutex()};if($one){$a.ReleaseMutex()};$b.Dispose();$a.Dispose()}
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
[pscustomobject]@{version='original-watchdog-module-isolation-fixture-v1';originalCandidateLibraryLoaded=$true;originalFunctionOrigins=$before;syntheticDjangoContrast=$contrast;moduleContextUnchanged=$true;sameThreadReentry=$true;managedThreadId=[Threading.Thread]::CurrentThread.ManagedThreadId;productionTaskApis=0;statusCalls=0;planCalls=0;installCalls=0;productionActions=0}|ConvertTo-Json -Depth 5 -Compress
