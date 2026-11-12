$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\tools\operations-system-watchdog.ps1') -FunctionsOnly
$fixtureBase=Join-Path ([IO.Path]::GetTempPath()) ('watchdog-supervisor-dedupe-tests-'+[guid]::NewGuid().ToString('N'))
$script:checks=0
function Assert-Dedupe($Condition,$Message){if(-not $Condition){throw $Message};$script:checks++}

# Everything below is a fake: nothing is spawned, no process table is read, no real runtime path is used.
function Get-CimInstance {param($ClassName,$Filter,$ErrorAction)
  $script:cimCalls++
  if($script:cimThrows){throw 'synthetic cim failure'}
  return @($script:cimRows)
}
function Start-Process {param($FilePath,$ArgumentList,$WindowStyle,$WorkingDirectory,$RedirectStandardOutput,$RedirectStandardError,[switch]$PassThru)
  $script:startCalls++
}
function Invoke-WatchSupervisorStatus {$script:statusCalls++;@{supervisorProcess=$script:statusValue}}
function Get-Admission {@{mode='running'}}

function Set-Case([string]$Status,$Rows,[bool]$Throws=$false){
  $script:statusValue=$Status;$script:cimRows=$Rows;$script:cimThrows=$Throws
  $script:cimCalls=0;$script:startCalls=0;$script:statusCalls=0
}
function Invoke-Restore{
  $failure=$null
  try{Restore-WatchSupervisor}catch{$failure=$_.Exception.Message}
  return $failure
}
function New-Row([string]$CommandLine){[pscustomobject]@{CommandLine=$CommandLine;ProcessId=4242}}

try{
  New-Item -ItemType Directory -Path $fixtureBase -Force|Out-Null
  # Unique mutex name per run (derived from BackendRoot) and fixture-only paths.
  $script:BackendRoot=Join-Path $fixtureBase 'django-sales'
  $script:WatchdogRoot=Join-Path $fixtureBase 'watchdog'
  New-Item -ItemType Directory -Path $WatchdogRoot -Force|Out-Null
  $script:SupervisorPath=Join-Path $BackendRoot 'app\tools\django-runtime-supervisor.ps1'
  $sup=$SupervisorPath
  $ps='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'

  Set-Case 'stopped' @()
  $f=Invoke-Restore
  Assert-Dedupe ($null -eq $f -and $script:startCalls -eq 1 -and $script:cimCalls -eq 1) 'no candidate must launch exactly once'

  Set-Case 'stopped' @((New-Row "`"$ps`" -NoProfile -File `"$sup`" -Action Run -Execute"))
  $f=Invoke-Restore
  Assert-Dedupe ($null -eq $f -and $script:startCalls -eq 0) 'a matching candidate must suppress the launch and return normally'

  Set-Case 'stopped' @((New-Row "$ps -File $($sup.Replace('\','/')) -Action Run"))
  $f=Invoke-Restore
  Assert-Dedupe ($null -eq $f -and $script:startCalls -eq 0) 'a forward-slash path form must also match'

  Set-Case 'stopped' @((New-Row "$ps -File $($sup.ToUpperInvariant()) -Action Run"))
  $f=Invoke-Restore
  Assert-Dedupe ($null -eq $f -and $script:startCalls -eq 0) 'path match is case-insensitive'

  Set-Case 'stopped' @((New-Row "$ps -File D:\other\some-other-script.ps1 -Action Run"))
  $f=Invoke-Restore
  Assert-Dedupe ($null -eq $f -and $script:startCalls -eq 1) 'a different script must not suppress the launch'

  Set-Case 'stopped' @((New-Row "$ps -File $sup -Action Status"))
  $f=Invoke-Restore
  Assert-Dedupe ($null -eq $f -and $script:startCalls -eq 1) 'a different Action on the supervisor script must not suppress the launch'

  Set-Case 'stopped' @([pscustomobject]@{CommandLine=$null;ProcessId=1})
  $f=Invoke-Restore
  Assert-Dedupe ($null -eq $f -and $script:startCalls -eq 1) 'a process without a readable command line is not a candidate'

  Set-Case 'stopped' @() $true
  $f=Invoke-Restore
  Assert-Dedupe ($f -ceq 'supervisor_candidate_unknown' -and $script:startCalls -eq 0) 'an enumeration failure must not launch and must throw supervisor_candidate_unknown'

  Set-Case 'running' @((New-Row "$ps -File $sup -Action Run"))
  $f=Invoke-Restore
  Assert-Dedupe ($null -eq $f -and $script:cimCalls -eq 0 -and $script:startCalls -eq 0) 'a running supervisor must neither query CIM nor launch'

  Set-Case 'weird' @()
  $f=Invoke-Restore
  Assert-Dedupe ($f -ceq 'supervisor_ownership_error' -and $script:cimCalls -eq 0 -and $script:startCalls -eq 0) 'an unexpected status keeps failing before the candidate check'

  # The mutex must be released after every path (otherwise the next case would report django_lifecycle_busy).
  Set-Case 'stopped' @()
  Assert-Dedupe ($null -eq (Invoke-Restore)) 'lifecycle mutex was leaked by an earlier path'

  # The unknown code is a known, non-counting recovery failure code.
  $src=Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\tools\operations-system-watchdog.ps1') -Raw
  Assert-Dedupe ([regex]::Matches($src,'supervisor_candidate_unknown').Count -ge 3) 'supervisor_candidate_unknown must be in both the non-counting list and the known list'
  $nonCounting='''supervisor_start_fenced'',''maintenance_active'',''supervisor_candidate_unknown'')){$countRecoveryFailure=$false}'
  Assert-Dedupe ($src.Contains($nonCounting)) 'supervisor_candidate_unknown must not count as a recovery failure'

  # Real Start-Process was never reachable: the fake shadows the cmdlet.
  Assert-Dedupe ((Get-Command Start-Process).CommandType -eq 'Function') 'real Start-Process must stay shadowed'

  @{passed=$script:checks;productionTouched=$false}|ConvertTo-Json -Compress
}finally{
  if([IO.Path]::GetFullPath($fixtureBase).StartsWith([IO.Path]::GetTempPath()) -and (Split-Path $fixtureBase -Leaf) -match '^watchdog-supervisor-dedupe-tests-[0-9a-f]{32}$'){Remove-Item -LiteralPath $fixtureBase -Recurse -Force -ErrorAction SilentlyContinue}
}
