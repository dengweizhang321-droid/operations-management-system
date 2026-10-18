[CmdletBinding()]
param([string]$BaselineCommit = '0be03eca', [string]$OutputPath = '')
$ErrorActionPreference = 'Stop'
$PiTestRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$PiService = Join-Path $PiTestRoot 'tools\django-local-service.ps1'
$PiAdopt = Join-Path $PiTestRoot 'tools\bi-app-adopt.ps1'
$PiPrivate = Join-Path ([IO.Path]::GetTempPath()) ('pi151-native-' + [Guid]::NewGuid().ToString('N'))
$PiOldLibrary = [Environment]::GetEnvironmentVariable('TERUISI_DJANGO_SERVICE_LIBRARY_ONLY','Process')
$PiUtf8 = [Text.UTF8Encoding]::new($false)
$PiCases = [Collections.Generic.List[object]]::new()

function Pi-Assert([bool]$Condition,[string]$Message) {if(-not $Condition){throw $Message}}
function Pi-Parse([string]$Source) {
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseInput($Source,[ref]$tokens,[ref]$errors)
  Pi-Assert (@($errors).Count -eq 0) ('PowerShell parser rejected candidate/baseline: '+(@($errors | ForEach-Object {$_.ErrorId+':'+$_.Extent.StartLineNumber}) -join ','))
  return @{ast=$ast;tokens=$tokens}
}
function Pi-TokenDigest([string]$Source) {
  $parsed=Pi-Parse $Source
  $lines=@($parsed.tokens | Where-Object {$_.Kind -notin @('Comment','NewLine','LineContinuation','EndOfInput')} | ForEach-Object {
    ([string]$_.Kind) + ':' + $_.Text.Replace("`r`n","`n")
  })
  $bytes=[Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
  $sha=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
}
function Pi-NormalizeNewMembers([string]$Source) {
  $parsed=Pi-Parse $Source
  $gate=$parsed.ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Assert-NoUnapprovedProtectedAiMigration'},$true)
  Pi-Assert (@($gate).Count -eq 1) 'Expected exactly one original migration gate'
  $remove=[Collections.Generic.List[object]]::new()
  foreach($statement in $gate[0].Body.EndBlock.Statements){
    if($statement.Extent.Text -cmatch '^\$piWorkspaceGate\s*=' -or $statement.Extent.Text -cmatch '^\$piWorkspaceDeployment\s*=' -or
       ($statement -is [Management.Automation.Language.IfStatementAst] -and $statement.Extent.Text.Contains("'teruisi-pi-workspace-schema-addition-v1'"))){$remove.Add($statement.Extent)}
  }
  Pi-Assert ($remove.Count -eq 3) 'Only the two new variables and finite151 branch may be normalized'
  $ranges=[Collections.Generic.List[object]]::new()
  foreach($extent in $remove){$ranges.Add(@{start=$extent.StartOffset;length=$extent.EndOffset-$extent.StartOffset})}
  $prepare=@($parsed.ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Prepare-Application'},$true))
  Pi-Assert ($prepare.Count -eq 1) 'Expected exactly one original CopyApp function'
  $members=@('tools\pi_workspace_addition.py','tools\pi_workspace_catalog.py','tools\pi_workspace_catalog.json','tools\pi_workspace_candidate.py','tools\pi_agent_upgrade_runtime.py')
  foreach($member in $members){
    $found=@($prepare[0].FindAll({param($node) $node -is [Management.Automation.Language.StringConstantExpressionAst] -and $node.Value -ceq $member},$true))
    Pi-Assert ($found.Count -eq 1) 'CopyApp must contain each new helper exactly once'
    $end=$found[0].Extent.EndOffset
    Pi-Assert ($Source[$end] -ceq ',') 'New CopyApp helper must be one isolated array member'
    $ranges.Add(@{start=$found[0].Extent.StartOffset;length=$end-$found[0].Extent.StartOffset+1})
  }
  foreach($range in @($ranges | Sort-Object -Property { [int]$_['start'] } -Descending)){$Source=$Source.Remove([int]$range['start'],[int]$range['length'])}
  return $Source
}

try {
  [void][IO.Directory]::CreateDirectory($PiPrivate)
  $start=[Diagnostics.ProcessStartInfo]::new()
  $start.FileName=(Get-Command git -CommandType Application | Select-Object -First 1).Source
  $start.Arguments='show '+$BaselineCommit+':tools/django-local-service.ps1'
  $start.WorkingDirectory=$PiTestRoot;$start.UseShellExecute=$false;$start.CreateNoWindow=$true
  $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true;$start.StandardOutputEncoding=$PiUtf8
  $git=[Diagnostics.Process]::Start($start)
  try{$baseline=$git.StandardOutput.ReadToEnd();$gitError=$git.StandardError.ReadToEnd();$git.WaitForExit();Pi-Assert ($git.ExitCode -eq 0) 'Unable to read exact baseline source'}finally{$git.Dispose()}
  $candidate=[IO.File]::ReadAllText($PiService,[Text.Encoding]::UTF8)
  $oldDigest=Pi-TokenDigest $baseline
  $normalized=Pi-NormalizeNewMembers $candidate
  $normalizedDigest=Pi-TokenDigest $normalized
  Pi-Assert ($oldDigest -ceq $normalizedDigest) 'Outside finite151+five CopyApp members, lifecycle AST tokens changed'
  $PiCases.Add(@{case='normalized-lifecycle-ast';status='passed';baseline=$BaselineCommit;digest=$oldDigest})

  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1'
  . $PiService -Action Status -RuntimeRoot $PiPrivate
  # This is the actual library function. Only outside observations and native
  # process execution are replaced. No production path is read or written.
  $RuntimeRoot='D:\teruisi-runtime\django-sales'
  $BackendRoot=Join-Path $PiPrivate 'candidate\backend'
  $Python='private-python-no-execution.exe'
  $IntegrationEvidencePath='';$IntegrationEvidenceSha256='a'*64;$IntegrationOperationId=''
  $script:PiGateMode='';$script:PiEvidenceVersion='';$script:PiRaw=@('{"status":"verified"}')
  $script:PiExit=0;$script:PiLaunch=$false;$script:PiTruncated=$false;$script:PiMissingGate=$false;$script:PiMalformed=''
  $script:PiCalls=[Collections.Generic.List[object]]::new()
  function Test-Path {
    param([string]$LiteralPath,[string]$Path,[object]$PathType)
    $value=if($LiteralPath){$LiteralPath}else{$Path}
    if($value -ceq $IntegrationEvidencePath -and $IntegrationEvidencePath){return $true}
    if($value.EndsWith('tools\pi_workspace_addition.py')){return -not $script:PiMissingGate}
    if($value.EndsWith('tools\pi_agent_addition.py')){return $true}
    if($value -match 'pi-workspace-additions\\[a-f0-9]{32}\\plan.json$'){return $script:PiGateMode -ceq 'deployment'}
    if($value.EndsWith('pi-workspace-addition-active.json')){return $script:PiGateMode -cin @('successor','release')}
    if($value.EndsWith('pi-agent-addition-active.json')){return $script:PiGateMode -ceq 'old150'}
    return $false
  }
  function Read-JsonFile {param([string]$Path,[string]$Description) return [pscustomobject]@{version=$script:PiEvidenceVersion}}
  function Invoke-BoundedNativeProcess {
    param([string]$FilePath,[object[]]$ArgumentList,[string]$WorkingDirectory)
    $script:PiCalls.Add(@{file=$FilePath;arguments=@($ArgumentList);directory=$WorkingDirectory})
    $result=[pscustomobject]@{ExitCode=[int]$script:PiExit;LaunchFailed=[bool]$script:PiLaunch;Output=@($script:PiRaw);
      Diagnostic=[pscustomobject]@{OutputRecordCount=@($script:PiRaw).Count;CapturedRecordCount=@($script:PiRaw).Count;OutputTruncated=[bool]$script:PiTruncated;OutputSha256=('b'*64)}}
    if($script:PiMalformed -ceq 'exit'){$result.ExitCode='0'}
    if($script:PiMalformed -ceq 'launch'){$result.LaunchFailed='false'}
    if($script:PiMalformed -ceq 'truncated'){$result.Diagnostic.OutputTruncated='false'}
    return $result
  }
  $routes=@(@{operation='PrepareApp';mode='admission';expected='admission'},@{operation='PrepareApp';mode='successor';expected='successor'},
    @{operation='DeployApp';mode='deployment';expected='deployment'},@{operation='DeployApp';mode='successor';expected='successor'},@{operation='Django migrate';mode='release';expected='release'})
  foreach($route in $routes){
    $script:PiCalls.Clear();$script:PiGateMode=$route.mode
    $IntegrationEvidencePath=if($route.mode -ceq 'admission'){Join-Path $PiPrivate 'evidence.json'}else{''}
    $script:PiEvidenceVersion=if($IntegrationEvidencePath){'teruisi-pi-workspace-schema-addition-v1'}else{''}
    $IntegrationOperationId=if($route.mode -ceq 'deployment'){'c'*32}else{''}
    Assert-NoUnapprovedProtectedAiMigration $route.operation $BackendRoot
    Pi-Assert ($script:PiCalls.Count -eq 1) 'Finite151 route fell through or executed more than once'
    $sent=$script:PiCalls[0].arguments
    Pi-Assert ($sent[0].EndsWith('tools\pi_workspace_addition.py') -and $sent[1] -ceq $route.expected) 'Finite151 selected wrong verifier/action'
    Pi-Assert ((@($sent | Where-Object {$_ -ceq '--evidence'}).Count -eq 1) -eq ($route.mode -ceq 'admission')) 'Admission evidence arguments drifted'
    Pi-Assert ((@($sent | Where-Object {$_ -ceq '--operation'}).Count -eq 1) -eq ($route.mode -ceq 'deployment')) 'Deployment operation arguments drifted'
    $PiCases.Add(@{case=('route-'+$route.operation+'-'+$route.mode);status='passed'})
  }
  $script:PiGateMode='successor';$IntegrationEvidencePath='';$IntegrationOperationId=''
  $negative=@(@{name='array-root';raw=@('[{"status":"verified"}]')},@{name='array-status';raw=@('{"status":["verified"]}')},
    @{name='bool-status';raw=@('{"status":true}')},@{name='unverified';raw=@('{"status":"refused"}')},
    @{name='duplicate-json';raw=@('{"status":"verified"}','{"status":"verified"}')},@{name='no-json';raw=@('warning')},
    @{name='exit-failed';raw=@('{"status":"verified"}');exit=19},@{name='launch-failed';raw=@('{"status":"verified"}');launch=$true},
    @{name='truncated';raw=@('{"status":"verified"}');truncated=$true},@{name='missing-gate';raw=@('{"status":"verified"}');missing=$true},
    @{name='string-exit';raw=@('{"status":"verified"}');malformed='exit'},@{name='string-launch';raw=@('{"status":"verified"}');malformed='launch'},@{name='string-truncated';raw=@('{"status":"verified"}');malformed='truncated'})
  foreach($bad in $negative){
    $script:PiCalls.Clear();$script:PiRaw=$bad.raw;$script:PiExit=if($bad.exit){$bad.exit}else{0}
    $script:PiLaunch=[bool]$bad.launch;$script:PiTruncated=[bool]$bad.truncated;$script:PiMissingGate=[bool]$bad.missing
    $script:PiMalformed=[string]$bad.malformed
    $rejected=$false
    try{Assert-NoUnapprovedProtectedAiMigration 'PrepareApp' $BackendRoot}catch{$rejected=$true}
    Pi-Assert $rejected ('Finite151 accepted '+$bad.name)
    Pi-Assert ($script:PiCalls.Count -le 1) 'Rejected finite151 proof fell through into old150'
    foreach($call in $script:PiCalls){Pi-Assert ($call.arguments[0].EndsWith('tools\pi_workspace_addition.py')) 'Rejected151 invoked legacy verifier'}
    $PiCases.Add(@{case=('reject-'+$bad.name);status='passed'})
  }
  $script:PiRaw=@('{"status":"verified"}');$script:PiExit=0;$script:PiLaunch=$false;$script:PiTruncated=$false;$script:PiMissingGate=$false;$script:PiMalformed=''
  $script:PiGateMode='old150';$script:PiCalls.Clear()
  Assert-NoUnapprovedProtectedAiMigration 'PrepareApp' $BackendRoot
  Pi-Assert ($script:PiCalls.Count -eq 1 -and $script:PiCalls[0].arguments[0].EndsWith('tools\pi_agent_addition.py') -and $script:PiCalls[0].arguments[1] -ceq 'successor') 'Original150 route changed'
  $PiCases.Add(@{case='original150-successor';status='passed'})

  # Real parameter binding and the early policy execute in a private child.
  # Fixed Exit at the debugger boundary cannot fall into a production body.
  $nativeExe=(Get-Process -Id $PID).Path
  $quotedAdopt="'"+$PiAdopt.Replace("'","''")+"'"
  $quotedRoot="'"+$PiPrivate.Replace("'","''")+"'"
  $probe="Set-PSBreakpoint -Script $quotedAdopt -Line 14 -Action { [Console]::Out.WriteLine('{`"parserAccepted`":true,`"productionTouched`":false}'); [Console]::Out.Flush(); [Environment]::Exit(0) } | Out-Null; & $quotedAdopt -Action Plan -AdditionKind PiWorkspace -SourceRoot $quotedRoot -OperationId $('d'*32) -MaintenanceId $('e'*32) -SchemaOnly -Execute; [Environment]::Exit(97)"
  $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($probe))
  $stdoutFile=Join-Path $PiPrivate 'parser.stdout';$stderrFile=Join-Path $PiPrivate 'parser.stderr'
  $process=Start-Process -FilePath $nativeExe -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand',$encoded) -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
  try{
    $null=$process.Handle
    if(-not $process.WaitForExit(15000)){$process.Kill();throw 'Private parser child did not stop at its fixed boundary'}
    $process.WaitForExit();$nativeExit=$process.ExitCode
    $stdout=[IO.File]::ReadAllText($stdoutFile);$stderr=[IO.File]::ReadAllText($stderrFile)
  }finally{$process.Dispose()}
  Pi-Assert ($nativeExit -eq 0 -and $stdout.Contains('"parserAccepted":true')) ('Real bi-app-adopt PiWorkspace parser/policy entry failed: exit='+$nativeExit)
  $PiCases.Add(@{case='real-adopt-parser-entry';status='passed';productionTouched=$false})

  $result=[ordered]@{status='passed';powerShellVersion=$PSVersionTable.PSVersion.ToString();baseline=$BaselineCommit;nativeColdStart=$false;productionTouched=$false;cases=@($PiCases);caseCount=$PiCases.Count}
  $PiOutputJson=$result | ConvertTo-Json -Depth 12 -Compress
  if($OutputPath){[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath),$PiOutputJson+"`n",$PiUtf8)}
  [Console]::Out.WriteLine($PiOutputJson)
} finally {
  [Environment]::SetEnvironmentVariable('TERUISI_DJANGO_SERVICE_LIBRARY_ONLY',$PiOldLibrary,'Process')
  Remove-Item Function:\Test-Path -ErrorAction SilentlyContinue
  if([IO.Directory]::Exists($PiPrivate)){
    $resolved=[IO.Path]::GetFullPath($PiPrivate)
    $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if(-not $resolved.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or -not ([IO.Path]::GetFileName($resolved)).StartsWith('pi151-native-')){throw 'Unexpected private test cleanup target'}
    Microsoft.PowerShell.Management\Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
