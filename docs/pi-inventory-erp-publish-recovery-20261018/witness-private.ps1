param([Parameter(Mandatory)][string]$Observer,[Parameter(Mandatory)][string]$Admission)
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
function Load-Functions([string]$File,[string[]]$Names){$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($File,[ref]$tokens,[ref]$errors);if($errors.Count){throw 'Parse error'};foreach($name in $Names){$nodes=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true));if($nodes.Count -ne 1){throw ('Missing '+$name)};Set-Item ('Function:script:'+$name) ([scriptblock]::Create($nodes[0].Body.Extent.Text.TrimStart('{').TrimEnd('}')))}}
# Load complete definitions in caller scope so parameter contracts are unchanged.
function Import-Functions([string]$File){$t=$null;$e=$null;$a=[Management.Automation.Language.Parser]::ParseFile($File,[ref]$t,[ref]$e);if($e.Count){throw 'Parse error'};foreach($n in @($a.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst]},$false))){. ([scriptblock]::Create($n.Extent.Text));Set-Item ('Function:script:'+$n.Name) (Get-Item ('Function:'+$n.Name)).ScriptBlock}}
Import-Functions $Observer;Import-Functions $Admission
function Hash-File([string]$File){$h=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($h.ComputeHash([IO.File]::ReadAllBytes($File)))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
$privateRoot=Join-Path ([IO.Path]::GetTempPath()) ('6dc-witness-private-'+[Guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $privateRoot|Out-Null
$exe=Join-Path $privateRoot 'private.exe';[IO.File]::WriteAllText($exe,'private executable byte fixture')
$script:success=0;$script:rejections=0
function Get-CimInstance{param([string]$ClassName,[object]$ErrorAction)return $script:rows}
function Test-Path{param([string]$LiteralPath)
 if($LiteralPath -match 'WITNESS-[a-f0-9]{32}\.json$' -and -not (Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath)){
  $requestFile=@(Get-ChildItem -LiteralPath $intent.outputDirectory -Filter 'WITNESS-REQUEST-*.json')[0].FullName;$request=Read-Object $requestFile
  $high=[pscustomobject]@{pid=99;parentPid=1;name=$script:missingName;creationDate=$script:birth.ToUniversalTime().ToString('o');exe=$exe;command=$script:highCommand}
  $w=[ordered]@{version='6dc-census-witness-v1';at=[DateTimeOffset]::UtcNow.ToString('o');requestId=$request.requestId;requestSha256=(Hash-File $requestFile);intentSha256=$InputSha256;originalFailureSha256=$intent.originalFailureSha256;observer=$request.observer;owner=$request.owner;elevated=$true;records=@($high)}
  switch($script:mode){'stale'{$w.at=[DateTimeOffset]::UtcNow.AddSeconds(-121).ToString('o')};'future'{$w.at=[DateTimeOffset]::UtcNow.AddSeconds(30).ToString('o')};'request'{$w.requestSha256='a'*64};'owner'{$w.owner=$request.owner.PSObject.Copy();$w.owner.commandLineSha256='b'*64};'observer'{$w.observer=$request.observer.PSObject.Copy();$w.observer.pid=333};'newpid'{$high.pid=100};'birth'{$high.creationDate=[DateTimeOffset]::UtcNow.AddDays(-1).ToString('o')};'parent'{$high.parentPid=7};'name'{$high.name='python.exe'};'duplicate'{$w.records=@($high,$high)};'incomplete'{$high.command=''};'notElevated'{$w.elevated=$false}}
  [IO.File]::WriteAllText($LiteralPath,($w|ConvertTo-Json -Depth 10 -Compress),[Text.UTF8Encoding]::new($false))
 };return Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath
}
try{
 foreach($case in @('good','stale','future','request','owner','observer','newpid','birth','parent','name','duplicate','incomplete','notElevated','encoded','native','pandas','runtimePsStop','runtimePsStart','sourcePs','opsPs','encodedAlias','genericShell')){
  $script:mode=$case;$caseRoot=Join-Path $privateRoot $case;New-Item -ItemType Directory -Path $caseRoot|Out-Null
  $script:intent=@{outputDirectory=$caseRoot;originalFailureSha256='f'*64};$InputSha256='c'*64;$manifest=@{code=@{'observe.ps1'='d'*64;'witness.ps1'='e'*64}};$script:liveCensusWitness=$null;$script:birth=[DateTime]::UtcNow.AddHours(-1);$script:missingName='node.exe';$script:highCommand='node harmless.mjs'
  if($case -ceq 'encoded'){$script:missingName='powershell.exe';$script:highCommand='powershell -EncodedCommand SQBFAFgA'}
  if($case -ceq 'native'){$script:highCommand='node D:/codex-isolated/main-release-packages/private/source/tools/publish-main.mjs --deploy-only'}
  if($case -ceq 'genericShell'){$script:missingName='powershell.exe';$script:highCommand='powershell.exe -NoProfile -File C:/private/unrelated.ps1'}
  if($case -ceq 'runtimePsStop'){$script:missingName='powershell.exe';$script:highCommand='powershell.exe -File D:\teruisi-runtime\django-sales\app\tools\django-local-service.ps1 -Action Stop'}
  if($case -ceq 'runtimePsStart'){$script:missingName='pwsh.exe';$script:highCommand='pwsh.exe -File D:/teruisi-runtime/teruisi-worker-sales/releases/x/tools/worker-local-service.ps1 -Action Start'}
  if($case -ceq 'sourcePs'){$script:missingName='powershell.exe';$script:highCommand='powershell.exe -File D:/codex-isolated/main-release-packages/x/source/tools/django-local-service.ps1 -Action DeployApp'}
  if($case -ceq 'opsPs'){$script:missingName='powershell.exe';$script:highCommand='powershell.exe -File C:/private/operations-system-control.ps1 -Action Stop'}
  if($case -ceq 'encodedAlias'){$script:missingName='pwsh.exe';$script:highCommand='pwsh.exe -enc SQBFAFgA'}
  if($case -ceq 'pandas'){$script:missingName='wsl.exe';$script:highCommand='wsl -d TERUISI-Pandas --exec unknown'}
  $script:rows=@([pscustomobject]@{ProcessId=$PID;ParentProcessId=1;Name='powershell.exe';CreationDate=$script:birth;ExecutablePath=$exe;CommandLine='private-observer'},[pscustomobject]@{ProcessId=888;ParentProcessId=1;Name='node.exe';CreationDate=$script:birth;ExecutablePath=$exe;CommandLine='private-owner'},[pscustomobject]@{ProcessId=99;ParentProcessId=1;Name=$script:missingName;CreationDate=$script:birth;ExecutablePath=$null;CommandLine=$null})
  $phase='partial';$script:allowedRemaining=@();$refused=$false
  try{$result=@(Complete-ProcessCensus $script:rows 888);Assert-NoControllers $result 888;if($case -in @('good','genericShell')){if($result.Count -ne 3 -or $result[2].CommandLine -cne $script:highCommand){throw 'Good witness did not resolve exact row'}}}catch{if($case -in @('good','genericShell')){throw};$refused=$true}
  if($case -in @('good','genericShell')){$script:success++}elseif($refused){$script:rejections++}else{throw ('Expected witness rejection: '+$case)}
 }
 # A second census cannot admit a newly appearing unreadable process via the old witness.
 $script:mode='good';$script:intent.outputDirectory=Join-Path $privateRoot 'cache';New-Item -ItemType Directory -Path $intent.outputDirectory|Out-Null;$script:liveCensusWitness=$null;$script:missingName='node.exe';$script:highCommand='node harmless.mjs';$script:rows[2].Name='node.exe';$script:rows[2].ExecutablePath=$null;$script:rows[2].CommandLine=$null
 [void](Complete-ProcessCensus $script:rows 888);$script:rows[2].ExecutablePath=$null;$script:rows[2].CommandLine=$null;$script:rows[2].ProcessId=100;$refused=$false;try{[void](Complete-ProcessCensus $script:rows 888)}catch{$refused=$true};if(-not $refused){throw 'Cached witness admitted new PID'};$script:rejections++
 # Consume the original admission token and receipt, not a cached boolean.
 $piRoot=Join-Path $privateRoot 'pi';New-Item -ItemType Directory -Path $piRoot|Out-Null;$control=Join-Path $piRoot 'django-ai-pi-worker.control.json';$ack=$control+'.stopped';$receipt=Join-Path $piRoot 'django-ai-pi-worker.pid.json';$token='1'*32
 function Text-Hash([string]$text){$h=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
 foreach($piCase in @('good','otherToken','receiptDrift','pid','child','duplicate','version','ack')){
  [IO.File]::WriteAllText($control,'{"version":1,"token":"'+$token+'","intent":"stop"}');[IO.File]::WriteAllText($ack,'{"version":1,"token":"'+$token+'","status":"stopped"}');[IO.File]::WriteAllText($receipt,'original receipt');$rows=@()
  $i=@{piOriginalProcessId=3604;piOriginalTokenSha256=(Text-Hash $token);piReceiptSha256=(Hash-File $receipt)}
  switch($piCase){'otherToken'{[IO.File]::WriteAllText($control,'{"version":1,"token":"'+('2'*32)+'","intent":"stop"}');[IO.File]::WriteAllText($ack,'{"version":1,"token":"'+('2'*32)+'","status":"stopped"}')};'receiptDrift'{[IO.File]::WriteAllText($receipt,'drift')};'pid'{$rows=@([pscustomobject]@{ProcessId=3604;ParentProcessId=1})};'child'{$rows=@([pscustomobject]@{ProcessId=999;ParentProcessId=3604})};'duplicate'{[IO.File]::WriteAllText($control,'{"version":1,"token":"'+$token+'","token":"'+$token+'","intent":"stop"}')};'version'{[IO.File]::WriteAllText($control,'{"version":"1","token":"'+$token+'","intent":"stop"}')};'ack'{[IO.File]::WriteAllText($ack,'{"version":1,"token":"'+$token+'","status":"running"}')}}
  $i.piControlSha256=Hash-File $control;$i.piStoppedSha256=Hash-File $ack;$refused=$false;try{Assert-OriginalPiStopped $i $rows $piRoot}catch{if($piCase -ceq 'good'){throw};$refused=$true};if($piCase -ceq 'good'){$script:success++}elseif($refused){$script:rejections++}else{throw ('Pi original binding accepted '+$piCase)}
 }
 @{status='passed';actualPsFunctions=$true;productionReads=$false;positive=$script:success;negative=$script:rejections}|ConvertTo-Json -Compress
}finally{
 $target=[IO.Path]::GetFullPath($privateRoot);$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath());if(-not $target.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase)){throw 'Private cleanup escaped temp'};Remove-Item -LiteralPath $target -Recurse -Force
}