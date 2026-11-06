[CmdletBinding()]
param([string]$BaselineCommit = '77382b5f', [string]$OutputPath = '')
$ErrorActionPreference = 'Stop'
$PiTestRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$PiService = Join-Path $PiTestRoot 'tools\django-local-service.ps1'
$PiAdopt = Join-Path $PiTestRoot 'tools\bi-app-adopt.ps1'
$PiPrivate = Join-Path ([IO.Path]::GetTempPath()) ('ai159-native-' + [Guid]::NewGuid().ToString('N'))
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
    if($statement.Extent.Text -cmatch '^\$aiUnifiedTasksGate\s*=' -or $statement.Extent.Text -cmatch '^\$aiUnifiedTasksDeployment\s*=' -or
       ($statement -is [Management.Automation.Language.IfStatementAst] -and $statement.Extent.Text.Contains("'teruisi-ai-unified-tasks-schema-addition-v1'"))){$remove.Add($statement.Extent)}
  }
  Pi-Assert ($remove.Count -eq 3) 'Only the two new variables and finite159 branch may be normalized'
  $ranges=[Collections.Generic.List[object]]::new()
  foreach($extent in $remove){$ranges.Add(@{start=$extent.StartOffset;length=$extent.EndOffset-$extent.StartOffset})}
  $prepare=@($parsed.ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Prepare-Application'},$true))
  Pi-Assert ($prepare.Count -eq 1) 'Expected exactly one original CopyApp function'
  $members=@('tools\ai_unified_tasks_addition.py','tools\ai_unified_tasks_catalog.py','tools\ai_unified_tasks_catalog.json','tools\ai_unified_tasks_candidate.py')
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

function Ai159-Selectors([string]$Source) {
 $parsed=Pi-Parse $Source
 $biRequest=@{AdditionKind='AiUnifiedTasks';Action='Plan';OperationId=('c'*32);MaintenanceId=('d'*32);PreparedAppId=('e'*32);PreparedAppSha256=('f'*64)}
 $biRoot='private-root'
 foreach($name in @('biGateName','biArgs','biApplicationName')){
  $statements=@($parsed.ast.FindAll({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left -is [Management.Automation.Language.VariableExpressionAst] -and $node.Left.VariablePath.UserPath -ceq $name -and $node.Operator -eq [Management.Automation.Language.TokenKind]::Equals},$true))
  Pi-Assert ($statements.Count -eq 1) ('Missing exact assignment: '+$name)
  if($name -ceq 'biArgs'){$biGate=Join-Path $PiPrivate $biGateName}
  . ([scriptblock]::Create($statements[0].Extent.Text))
 }
 foreach($flag in @('--execute','--prepared-id')){
  $selected=@($parsed.ast.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Extent.Text -cmatch '^if\s*\(\$biRequest.AdditionKind -cin ' -and $node.Extent.Text.Contains("'"+$flag+"'")},$true))
  Pi-Assert ($selected.Count -eq 1) ('Missing exact kind argument branch: '+$flag)
  . ([scriptblock]::Create($selected[0].Extent.Text))
 }
 Pi-Assert ($biGateName -ceq 'tools\ai_unified_tasks_addition.py') 'Wrong finite159 gate mapping'
 Pi-Assert ($biApplicationName -ceq 'teruisi_ai_unified_tasks_schema_append') 'Wrong finite159 database application name'
 Pi-Assert ($biArgs -ccontains '--execute') 'Finite159 execution flag omitted'
 Pi-Assert ($biArgs -ccontains '--prepared-id' -and $biArgs -ccontains '--prepared-receipt-sha') 'Finite159 prepared binding omitted'
}
function Ai159-ParserAccepts([string]$File,[string]$Action) {
 $native=(Get-Process -Id $PID).Path
 $fileQuote="'"+$File.Replace("'","''")+"'"
 $rootQuote="'"+$PiPrivate.Replace("'","''")+"'"
 # Hard process exit at the first runtime assignment, before library import.
 $probe="`$ErrorActionPreference='Stop'; Set-PSBreakpoint -Script $fileQuote -Line 14 -Action { [Console]::Out.WriteLine('AI159_BOUNDARY'); [Console]::Out.Flush(); [Environment]::Exit(0) } | Out-Null; try { & $fileQuote -Action $Action -AdditionKind AiUnifiedTasks -SourceRoot $rootQuote -OperationId $('d'*32) -MaintenanceId $('e'*32) -SchemaOnly -Execute } catch { [Environment]::Exit(86) }; [Environment]::Exit(97)"
 $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($probe))
 $tag=[guid]::NewGuid().ToString('N');$stdout=Join-Path $PiPrivate ($tag+'.out');$stderr=Join-Path $PiPrivate ($tag+'.err')
 $process=Start-Process -FilePath $native -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand',$encoded) -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
 try{
  $null=$process.Handle
  if(-not $process.WaitForExit(15000)){$process.Kill();throw 'Private parser child did not stop at boundary'}
  $process.WaitForExit()
  return $process.ExitCode -eq 0 -and [IO.File]::ReadAllText($stdout).Contains('AI159_BOUNDARY')
 }finally{$process.Dispose()}
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
  Pi-Assert ($oldDigest -ceq $normalizedDigest) 'Outside finite159+five CopyApp members, lifecycle AST tokens changed'
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
    if($value.EndsWith('tools\ai_unified_tasks_addition.py')){return -not $script:PiMissingGate}
    if($value.EndsWith('tools\workflow_automation_addition.py')){return $true}
    if($value -match 'ai-unified-tasks-additions\\[a-f0-9]{32}\\plan.json$'){return $script:PiGateMode -ceq 'deployment'}
    if($value.EndsWith('ai-unified-tasks-addition-active.json')){return $script:PiGateMode -cin @('successor','release')}
    if($value.EndsWith('workflow-automation-addition-active.json')){return $script:PiGateMode -ceq 'old156'}
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
    $script:PiEvidenceVersion=if($IntegrationEvidencePath){'teruisi-ai-unified-tasks-schema-addition-v1'}else{''}
    $IntegrationOperationId=if($route.mode -ceq 'deployment'){'c'*32}else{''}
    Assert-NoUnapprovedProtectedAiMigration $route.operation $BackendRoot
    Pi-Assert ($script:PiCalls.Count -eq 1) 'Finite159 route fell through or executed more than once'
    $sent=$script:PiCalls[0].arguments
    Pi-Assert ($sent[0].EndsWith('tools\ai_unified_tasks_addition.py') -and $sent[1] -ceq $route.expected) 'Finite159 selected wrong verifier/action'
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
    Pi-Assert $rejected ('Finite159 accepted '+$bad.name)
    Pi-Assert ($script:PiCalls.Count -le 1) 'Rejected finite159 proof fell through into old156'
    foreach($call in $script:PiCalls){Pi-Assert ($call.arguments[0].EndsWith('tools\ai_unified_tasks_addition.py')) 'Rejected151 invoked legacy verifier'}
    $PiCases.Add(@{case=('reject-'+$bad.name);status='passed'})
  }
  $script:PiRaw=@('{"status":"verified"}');$script:PiExit=0;$script:PiLaunch=$false;$script:PiTruncated=$false;$script:PiMissingGate=$false;$script:PiMalformed=''

  # Disable each new native refusal in-memory; raw controller bytes never change.
  $gateAst=@((Pi-Parse $candidate).ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Assert-NoUnapprovedProtectedAiMigration'},$true))[0]
  $originalGate=$gateAst.Extent.Text
  foreach($guard in @(
    @{message='Ai159 requires its exact verifier';mode='missing'},
    @{message='Ai159 requires one complete typed native JSON object';mode='launch'},
    @{message='Ai159 schema addition gate refused';mode='status'})){
   $matches=@($gateAst.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Clauses.Count -eq 1 -and $node.Clauses[0].Item2.Statements.Count -eq 1 -and $node.Clauses[0].Item2.Statements[0] -is [Management.Automation.Language.ThrowStatementAst] -and $node.Clauses[0].Item2.Extent.Text.Contains($guard.message)},$true))
   Pi-Assert ($matches.Count -eq 1) ('Missing exact AI159 refusal: '+$guard.message)
   $condition=$matches[0].Clauses[0].Item1.Extent
   $offset=$condition.StartOffset-$gateAst.Extent.StartOffset
   $mutantGate=$originalGate.Remove($offset,$condition.EndOffset-$condition.StartOffset).Insert($offset,'$false')
   . ([scriptblock]::Create($mutantGate))
   $script:PiGateMode='successor';$script:PiMissingGate=$guard.mode -ceq 'missing'
   $script:PiLaunch=$guard.mode -ceq 'launch';$script:PiRaw=if($guard.mode -ceq 'status'){@('{"status":"refused"}')}else{@('{"status":"verified"}')}
   $accepted=$true
   try{Assert-NoUnapprovedProtectedAiMigration 'PrepareApp' $BackendRoot}catch{$accepted=$false}
   Pi-Assert $accepted ('Refusal mutation was hidden by another exception: '+$guard.message)
   $PiCases.Add(@{case=('native-refusal-mutation-'+$guard.mode);status='killed';productionTouched=$false})
  }
  $mutantGate=$originalGate.Replace("throw 'Unsupported Ai159 lifecycle operation'","'successor'")
  Pi-Assert ($mutantGate -cne $originalGate) 'Unsupported-operation refusal is not the expected new finite branch'
  . ([scriptblock]::Create($mutantGate))
  $script:PiMissingGate=$false;$script:PiLaunch=$false;$script:PiRaw=@('{"status":"verified"}')
  $accepted=$true
  try{Assert-NoUnapprovedProtectedAiMigration 'UnsupportedPrivateOperation' $BackendRoot}catch{$accepted=$false}
  Pi-Assert $accepted 'Unsupported-operation mutation hidden by another exception'
  $PiCases.Add(@{case='native-refusal-mutation-operation';status='killed';productionTouched=$false})
  . ([scriptblock]::Create($originalGate))

  $script:PiGateMode='old156';$script:PiCalls.Clear()
  Assert-NoUnapprovedProtectedAiMigration 'PrepareApp' $BackendRoot
  Pi-Assert ($script:PiCalls.Count -eq 1 -and $script:PiCalls[0].arguments[0].EndsWith('tools\workflow_automation_addition.py') -and $script:PiCalls[0].arguments[1] -ceq 'successor') 'Original156 route changed'
  $PiCases.Add(@{case='original156-successor';status='passed'})

  # Real parameter binding and the early policy execute in a private child.
  # Fixed Exit at the debugger boundary cannot fall into a production body.
  $nativeExe=(Get-Process -Id $PID).Path
  $quotedAdopt="'"+$PiAdopt.Replace("'","''")+"'"
  $quotedRoot="'"+$PiPrivate.Replace("'","''")+"'"
  $probe="Set-PSBreakpoint -Script $quotedAdopt -Line 14 -Action { [Console]::Out.WriteLine('{`"parserAccepted`":true,`"productionTouched`":false}'); [Console]::Out.Flush(); [Environment]::Exit(0) } | Out-Null; & $quotedAdopt -Action Plan -AdditionKind AiUnifiedTasks -SourceRoot $quotedRoot -OperationId $('d'*32) -MaintenanceId $('e'*32) -SchemaOnly -Execute; [Environment]::Exit(97)"
  $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($probe))
  $stdoutFile=Join-Path $PiPrivate 'parser.stdout';$stderrFile=Join-Path $PiPrivate 'parser.stderr'
  $process=Start-Process -FilePath $nativeExe -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand',$encoded) -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
  try{
    $null=$process.Handle
    if(-not $process.WaitForExit(15000)){$process.Kill();throw 'Private parser child did not stop at its fixed boundary'}
    $process.WaitForExit();$nativeExit=$process.ExitCode
    $stdout=[IO.File]::ReadAllText($stdoutFile);$stderr=[IO.File]::ReadAllText($stderrFile)
  }finally{$process.Dispose()}
  Pi-Assert ($nativeExit -eq 0 -and $stdout.Contains('"parserAccepted":true')) ('Real bi-app-adopt AiUnifiedTasks parser/policy entry failed: exit='+$nativeExit)
  $PiCases.Add(@{case='real-adopt-parser-entry';status='passed';productionTouched=$false})


  $adoptSource=[IO.File]::ReadAllText($PiAdopt,[Text.Encoding]::UTF8)
  Ai159-Selectors $adoptSource
  Pi-Assert (Ai159-ParserAccepts $PiAdopt 'Reconcile') 'Real158 Reconcile parameter/policy binding refused'
  $adoptParsed=Pi-Parse $adoptSource
  $kindNodes=@($adoptParsed.ast.FindAll({param($node) $node -is [Management.Automation.Language.StringConstantExpressionAst] -and $node.Value -ceq 'AiUnifiedTasks'},$true))
  Pi-Assert ($kindNodes.Count -eq 7) 'Finite159 must have exactly seven kind declarations'
  foreach($kindNode in $kindNodes){
   $extent=$kindNode.Extent
   $mutant=$adoptSource.Remove($extent.StartOffset,$extent.EndOffset-$extent.StartOffset).Insert($extent.StartOffset,"'RemovedAi159'")
   $mutantFile=Join-Path $PiPrivate ('mutant-'+$extent.StartLineNumber+'.ps1')
   [IO.File]::WriteAllText($mutantFile,$mutant,[Text.UTF8Encoding]::new($true))
   $killed=$false
   try{
    Ai159-Selectors $mutant
    Pi-Assert (Ai159-ParserAccepts $mutantFile 'Plan') 'Mutation removed158 Plan policy'
    Pi-Assert (Ai159-ParserAccepts $mutantFile 'Reconcile') 'Mutation removed158 Reconcile policy'
   }catch{$killed=$true}
   Pi-Assert $killed ('Undetected kind omission at line '+$extent.StartLineNumber)
   $PiCases.Add(@{case=('kind-mutation-line-'+$extent.StartLineNumber);status='killed';productionTouched=$false})
  }
  $PiCases.Add(@{case='seven-kind-original-selectors';status='passed';productionTouched=$false})

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
    if(-not $resolved.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or -not ([IO.Path]::GetFileName($resolved)).StartsWith('ai159-native-')){throw 'Unexpected private test cleanup target'}
    Microsoft.PowerShell.Management\Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
