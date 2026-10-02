[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$CandidateRoot,
  [Parameter(Mandatory=$true)][string]$PythonPath,
  [Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$ExpectedPythonVersion,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedLauncherSha256,
  [Parameter(Mandatory=$true)][string]$EvidenceDirectory
)
$ErrorActionPreference = 'Stop'
$taskSource = (Resolve-Path -LiteralPath $CandidateRoot).Path
$taskPython = (Resolve-Path -LiteralPath $PythonPath).Path
$taskEntry = Join-Path $taskSource 'tools\django-local-service.ps1'
$taskChild = Join-Path $PSScriptRoot 'netshop-readiness\startup-child.py'
$taskEntryHash = (Get-FileHash -LiteralPath $taskEntry -Algorithm SHA256).Hash.ToLowerInvariant()
$taskManifestPath=Join-Path $taskSource 'deployment.json'
$taskManifestHash=if(Test-Path -LiteralPath $taskManifestPath -PathType Leaf){(Get-FileHash -LiteralPath $taskManifestPath -Algorithm SHA256).Hash.ToLowerInvariant()}else{$null}
if ($taskEntryHash -cne $ExpectedLauncherSha256.ToLowerInvariant()) { throw 'Candidate launcher differs from the requested source hash' }
if (-not (Test-Path -LiteralPath (Join-Path $taskSource 'backend\teruisi_backend\wsgi.py') -PathType Leaf)) { throw 'Candidate WSGI app is missing' }
$taskEvidence = [IO.Path]::GetFullPath($EvidenceDirectory)
if ($taskEvidence.StartsWith($taskSource.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) -or
    $taskEvidence.StartsWith('D:\teruisi-runtime\',[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $taskEvidence)) { throw 'Evidence must be a new directory outside the candidate and production runtime' }
$taskNonce = [Guid]::NewGuid().ToString('N')
$taskScratch = Join-Path ([IO.Path]::GetTempPath()) ('teruisi-startup-chain-'+$taskNonce)
$taskEnvironment = @{}
foreach ($taskVariable in Get-ChildItem Env:) { $taskEnvironment[$taskVariable.Name] = $taskVariable.Value }
$taskPreserve = @('SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','PATH','PATHEXT','PSMODULEPATH','USERPROFILE','LOCALAPPDATA','APPDATA','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMW6432','NUMBER_OF_PROCESSORS','OS','PROCESSOR_ARCHITECTURE')
$taskProcess = $null
$taskPythonChild = $null
$taskLaunchAttempted=$false
$taskResult = [ordered]@{ schemaVersion='netshop-startup-chain-v1'; state='failed'; candidateRoot=$taskSource; launcherSha256=$taskEntryHash; candidateManifestSha256=$taskManifestHash; powershellVersion=$PSVersionTable.PSVersion.ToString(); childLaunched=$false; candidateWsgiLive=$false; configurationPassed=$false; normalChildExit=$false; productionOperations=0; businessReadiness='not_run'; reason='not_started' }
try {
  [void](New-Item -ItemType Directory -Path $taskScratch)
  $taskSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $taskAcl = [Security.AccessControl.DirectorySecurity]::new()
  $taskAcl.SetOwner($taskSid); $taskAcl.SetAccessRuleProtection($true,$false)
  $taskAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($taskSid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
  Set-Acl -LiteralPath $taskScratch -AclObject $taskAcl
  [void](New-Item -ItemType Directory -Path $taskEvidence)
  foreach ($taskVariable in @(Get-ChildItem Env:)) {
    if ($taskVariable.Name.ToUpperInvariant() -notin $taskPreserve) { [Environment]::SetEnvironmentVariable($taskVariable.Name,[NullString]::Value,'Process') }
  }
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1'
  $env:PYTHONDONTWRITEBYTECODE='1'
  # Load the exact candidate, not a copied or reimplemented launcher function.
  . $taskEntry -Action Status -RuntimeRoot $taskScratch
  [void](New-Item -ItemType Directory -Path $LogDirectory,$RunDirectory)
  $taskReady = Join-Path $taskScratch 'child-ready.json'
  $taskStop = Join-Path $taskScratch 'stop'
  $taskPid = Join-Path $RunDirectory 'startup-probe.pid.json'
  $taskArguments = @($taskChild,'--candidate',$taskSource,'--ready',$taskReady,'--stop',$taskStop,'--nonce',$taskNonce)
  $taskSecrets = [pscustomobject]@{ InternalSecret=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N'); DjangoSecretKey=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N') }
  $taskLaunchAttempted=$true
  $taskLaunched = Invoke-WithDjangoEnvironment $taskSecrets 'postgresql://startup_fixture:fixture@127.0.0.1:5432/startup_fixture' 'netshop_reader' $true 1048576 '' '' {
    Start-ManagedProcess 'netshop-startup-probe' $taskPython $taskArguments (Join-Path $taskSource 'backend') $taskPid $taskEntryHash (Join-Path $LogDirectory 'probe.stdout.log') (Join-Path $LogDirectory 'probe.stderr.log')
  }
  # The production launcher returns its verified Win32_Process snapshot.
  $taskProcess = [Diagnostics.Process]::GetProcessById([int]$taskLaunched.ProcessId)
  $null = $taskProcess.Handle
  $taskSecrets=$null
  $taskResult.childLaunched=$true
  $taskDeadline=[DateTimeOffset]::UtcNow.AddSeconds(25)
  while (-not (Test-Path -LiteralPath $taskReady) -and -not $taskProcess.HasExited -and [DateTimeOffset]::UtcNow -lt $taskDeadline) { Start-Sleep -Milliseconds 100 }
  if (-not (Test-Path -LiteralPath $taskReady)) { throw 'Child did not provide a bounded startup receipt' }
  $taskReceipt = Get-Content -LiteralPath $taskReady -Raw | ConvertFrom-Json
  $taskResult.childReceipt=$taskReceipt
  if ($taskReceipt.schemaVersion -cne 'netshop-startup-child-v1' -or $taskReceipt.nonce -cne $taskNonce -or $taskReceipt.state -cne 'running') { throw 'Candidate WSGI child failed its startup contract' }
  if ($taskReceipt.pythonVersion -cne $ExpectedPythonVersion) { throw 'Child interpreter differs from the expected runtime version' }
  $taskReceiptChild=[Diagnostics.Process]::GetProcessById([int]$taskReceipt.pid)
  try {
    $null=$taskReceiptChild.Handle
    if ($taskReceipt.pid -ne $taskProcess.Id) {
      # Windows venv python.exe is a redirector. Accept only its exact child.
      $taskChildIdentity=Get-CimInstance Win32_Process -Filter ('ProcessId = '+[int]$taskReceipt.pid)
      if ($null -eq $taskChildIdentity -or $taskChildIdentity.ParentProcessId -ne $taskProcess.Id -or $taskReceiptChild.StartTime -lt $taskProcess.StartTime) { throw 'Candidate child is not owned by the launched process' }
    } elseif ($taskReceiptChild.StartTime -ne $taskProcess.StartTime) {
      throw 'Candidate receipt process creation differs from the launched process'
    }
    # Only a completely verified receipt handle has cleanup authority.
    $taskPythonChild=$taskReceiptChild
    $taskReceiptChild=$null
    $taskResult.childLineageVerified=$true
  } finally {
    if ($taskReceiptChild) { $taskReceiptChild.Dispose() }
  }
  $taskResult.launcherPid=$taskProcess.Id
  $taskPort = [int]$taskReceipt.listenerPort
  if ($taskPort -lt 1024 -or $taskPort -in @(3000,5432,5791,8001,8011,8021,8022,8061)) { throw 'Child listener outside isolated port policy' }
  $taskHttp=[Net.HttpWebRequest]::Create('http://127.0.0.1:'+$taskPort+'/health/live')
  $taskHttp.Proxy=$null; $taskHttp.AllowAutoRedirect=$false; $taskHttp.Timeout=5000; $taskHttp.ReadWriteTimeout=5000
  $taskResponse=$null; $taskReader=$null
  try {
    $taskResponse=$taskHttp.GetResponse()
    if ([int]$taskResponse.StatusCode -ne 200 -or $taskResponse.ContentLength -gt 16384) { throw 'Candidate liveness failed' }
    $taskReader=[IO.StreamReader]::new($taskResponse.GetResponseStream(),[Text.Encoding]::UTF8)
    $taskBuffer=New-Object char[] 16385
    $taskRead=$taskReader.ReadBlock($taskBuffer,0,$taskBuffer.Length)
    if ($taskRead -gt 16384) { throw 'Candidate liveness response exceeded budget' }
    $taskBody=(-join $taskBuffer[0..($taskRead-1)]) | ConvertFrom-Json
    if ($taskBody.status -cne 'ok' -or $taskBody.service -cne 'teruisi-django') { throw 'Unexpected candidate liveness contract' }
    $taskResult.candidateWsgiLive=$true
  } finally { if($taskReader){$taskReader.Dispose()};if($taskResponse){$taskResponse.Dispose()};$taskHttp.Abort() }
  $taskResult.configurationPassed=$taskReceipt.roleVerified -eq $true -and @($taskReceipt.dependencies.PSObject.Properties | Where-Object { $_.Value.present -ne $true -or $_.Value.matchesRequiredEndpoint -ne $true }).Count -eq 0 -and @($taskReceipt.dependencies.PSObject.Properties).Count -eq 3
  $taskResult.dependencies=$taskReceipt.dependencies
  $taskResult.wsgiSha256=$taskReceipt.wsgiSha256
  # Candidate must not change underneath the probe.
  if ((Get-FileHash -LiteralPath $taskEntry -Algorithm SHA256).Hash.ToLowerInvariant() -cne $taskEntryHash) { throw 'Candidate changed during startup probe' }
  if ($taskManifestHash -and (Get-FileHash -LiteralPath $taskManifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $taskManifestHash) { throw 'Candidate manifest changed during probe' }
  $taskResult.state=if($taskResult.configurationPassed){'passed'}else{'failed'}
  $taskResult.reason=if($taskResult.configurationPassed){$null}else{'dependency_environment_missing_or_wrong'}
} catch {
  $taskResult.errorType=$_.Exception.GetType().Name
  $taskResult.errorLine=$_.InvocationInfo.ScriptLineNumber
  $taskResult.state='failed'
  if ($taskResult.reason -eq 'not_started') { $taskResult.reason='startup_probe_failed' }
} finally {
  if(Test-Path -LiteralPath $taskScratch){[IO.File]::WriteAllText((Join-Path $taskScratch 'stop'),'stop',[Text.UTF8Encoding]::new($false))}
  if ($taskProcess) {
    if ($taskPythonChild -and $taskResult.childLineageVerified -eq $true -and -not $taskPythonChild.WaitForExit(8000)) { $taskPythonChild.Kill();[void]$taskPythonChild.WaitForExit(3000);$taskResult.state='failed';$taskResult.reason='isolated_child_timed_out' }
    if ($taskProcess.WaitForExit(8000)) { $taskResult.normalChildExit=$true; $taskResult.childExitCode=$taskProcess.ExitCode; if($taskProcess.ExitCode -ne 0){$taskResult.state='failed'} }
    else { $taskProcess.Kill(); [void]$taskProcess.WaitForExit(3000); $taskResult.normalChildExit=$false }
    if (-not $taskResult.normalChildExit) { $taskResult.state='failed';$taskResult.reason='isolated_child_failed_or_timed_out' }
    $taskProcess.Dispose()
    if($taskPythonChild){$taskPythonChild.Dispose()}
  }
  foreach ($taskVariable in @(Get-ChildItem Env:)) { if (-not $taskEnvironment.ContainsKey($taskVariable.Name)) { [Environment]::SetEnvironmentVariable($taskVariable.Name,[NullString]::Value,'Process') } }
  foreach ($taskName in $taskEnvironment.Keys) { [Environment]::SetEnvironmentVariable($taskName,$taskEnvironment[$taskName],'Process') }
  $taskResult.limitations=@('Real candidate environment function, managed process launcher, Waitress and Django WSGI; private synthetic settings only','No production lifecycle Start/Stop/apply, no database connection, no peer business request','Business checks must run separately against the corresponding staged or deployed stack; liveness alone never passes the release gate')
  $taskResult.cleanupStatus='not_created'
  if (Test-Path -LiteralPath $taskScratch) {
    $taskResolved=(Resolve-Path -LiteralPath $taskScratch).Path
    $taskTemp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    if (-not $taskResolved.StartsWith($taskTemp,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $taskResolved -Leaf) -cne ('teruisi-startup-chain-'+$taskNonce) -or ($taskLaunchAttempted -and -not $taskResult.normalChildExit)) {
      $taskResult.cleanupStatus='retained_unverified';$taskResult.retainedScratch=$taskScratch;$taskResult.state='failed'
    } else {
      try { Remove-Item -LiteralPath $taskResolved -Recurse -Force; $taskResult.cleanupStatus='removed' }
      catch { $taskResult.cleanupStatus='retained_cleanup_failed';$taskResult.retainedScratch=$taskScratch;$taskResult.state='failed' }
    }
  }
  if (Test-Path -LiteralPath $taskEvidence) {
    $taskJson=$taskResult|ConvertTo-Json -Depth 7
    $taskBytes=[Text.UTF8Encoding]::new($false).GetBytes($taskJson)
    $taskStream=[IO.File]::Open((Join-Path $taskEvidence 'startup.json'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{$taskStream.Write($taskBytes,0,$taskBytes.Length)}finally{$taskStream.Dispose()}
    Write-Output $taskJson
  }
}
if($taskResult.state -ne 'passed'){exit 2}
