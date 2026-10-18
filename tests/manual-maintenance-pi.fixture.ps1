$ErrorActionPreference='Stop'
$file=Join-Path $PSScriptRoot '../tools/manual-maintenance-continuation.ps1'
$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($file,[ref]$null,[ref]$errors);if($errors.Count){throw 'Parse failure'}
foreach($node in $ast.EndBlock.Statements){if($node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -cin @('Hash-File','Read-Object','Require-Hash','Assert-Actor','Assert-NoControlParticipants','Assert-PiStop','Assert-OriginalNativeComplete')){. ([scriptblock]::Create($node.Extent.Text))}}
$root=Join-Path ([IO.Path]::GetTempPath()) ('pi-continuation-private-'+[Guid]::NewGuid().ToString('N'))
$djangoFixed=$root;$workerFixed=Join-Path $root 'worker';$run=Join-Path $root 'run';[void][IO.Directory]::CreateDirectory($run)
function Fails([scriptblock]$Check){$failed=$false;try{& $Check}catch{$failed=$true};if(-not $failed){throw 'Unsafe continuation accepted'}}
$script:piMode=$true;$script:piAllowed=@()
$created=[DateTime]::UtcNow;$exe=Join-Path $root 'venv/Scripts/python.exe'
$script:actor=[pscustomobject]@{actor=[pscustomobject]@{processId=123;creationDate=$created.ToString('o');commandLine='original';executablePath=$exe};rotationOwner=[pscustomobject]@{processId=456}}
$late=[pscustomobject]@{ProcessId=800;ParentProcessId=777;Name='python.exe';CreationDate=$created;ExecutablePath=$exe;CommandLine=('python -m pi_runner.wsl_control stop --config '+(Join-Path $root 'config/pi-agent.json'))}
Fails {Assert-NoControlParticipants @($late)}
$late.CommandLine='python -m pandas_runner.wsl_control stop';Fails {Assert-NoControlParticipants @($late)}
$late.Name='wsl.exe';$late.ExecutablePath='C:\Windows\System32\wsl.exe';$late.CommandLine='wsl -d TERUISI-Pandas --exec systemctl --user stop teruisi-pi-runner.service';Fails {Assert-NoControlParticipants @($late)}
$long=[pscustomobject]@{ProcessId=801;ParentProcessId=1;Name='python.exe';CreationDate=$created;ExecutablePath=$exe;CommandLine='private exact long-lived AI service'}
$script:piAllowed=@([pscustomobject]@{ProcessId=801;CreationDate=$created.ToString('o');ExecutablePath=$exe;CommandLine=$long.CommandLine})
Assert-NoControlParticipants @($long)
$long.CreationDate=$created.AddSeconds(1);Fails {Assert-NoControlParticipants @($long)}
$long.CreationDate=$created;$long.CommandLine='python -m pi_runner.wsl_control stop';Fails {Assert-NoControlParticipants @($long)}
$token='a'*32;$pidFile=Join-Path $run 'django-ai-pi-worker.pid.json';$controlFile=Join-Path $run 'django-ai-pi-worker.control.json';$ackFile=$controlFile+'.stopped'
$identity=[pscustomobject]@{version=2;service='django-ai-pi-worker';processId=900;creationDate=$created.ToString('o');commandLine='private pi worker';executablePath=$exe;arguments=@('--control-token',$token)}
$script:admissionRecord=[pscustomobject]@{piWorkerIdentity=$identity;piWorkerReceiptSha256=''}
function Save([string]$Target,[object]$Value){[IO.File]::WriteAllText($Target,($Value|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))}
function Reset-Pi {
 Save $pidFile $identity;$script:admissionRecord.piWorkerReceiptSha256=Hash-File $pidFile
 Save $controlFile @{version=1;token=$token;intent='stop'};Save $ackFile @{version=1;token=$token;status='stopped'}
}
try{
 Reset-Pi;$script:admissionRecord.piWorkerIdentity=Read-Object $pidFile;$proof=Assert-PiStop @();if($proof.controlSha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'Missing original Pi proof'}
 Save $ackFile @{version=1;token=('b'*32);status='stopped'};Fails {Assert-PiStop @()}
 Reset-Pi;[IO.File]::AppendAllText($pidFile,' ');Fails {Assert-PiStop @()}
 Reset-Pi;Fails {Assert-PiStop @([pscustomobject]@{ProcessId=900;ParentProcessId=1})}
 Reset-Pi;Fails {Assert-PiStop @([pscustomobject]@{ProcessId=901;ParentProcessId=900})}
 Reset-Pi;Remove-Item -LiteralPath $ackFile;Fails {Assert-PiStop @()}
 Reset-Pi;Save $ackFile @{version='1';token=$token;status='stopped'};Fails {Assert-PiStop @()}
 Reset-Pi;[IO.File]::WriteAllText($ackFile,('{"version":1,"token":"'+$token+'","token":"'+$token+'","status":"stopped"}'));Fails {Assert-PiStop @()}
 $InputSha256='b'*64;$script:admissionRecord|Add-Member -NotePropertyName maintenanceId -NotePropertyValue $token
 $commitFile=Join-Path $root 'complete.json';$commit=@{admissionSha256=$InputSha256;maintenanceId=$token;actorProcessId=123;exitCode=0;value=@{status='maintenance';maintenanceId=$token;postgresPreserved=$true;backendStopped=$true}}
 Save $commitFile $commit;Assert-OriginalNativeComplete (Read-Object $commitFile)
 $commit.exitCode='0';Save $commitFile $commit;Fails {Assert-OriginalNativeComplete (Read-Object $commitFile)}
 $commit.exitCode=1;Save $commitFile $commit;Fails {Assert-OriginalNativeComplete (Read-Object $commitFile)}
 $commit.exitCode=0;$commit.value.backendStopped='true';Save $commitFile $commit;Fails {Assert-OriginalNativeComplete (Read-Object $commitFile)}
 # Execute the original first-entry CAS function with fully private roots.
 # The deliberately absent owner binding is after Pi CAS, before actor writes.
 $first=Join-Path $PSScriptRoot '../tools/manual-maintenance-start.ps1'
 $firstAst=[Management.Automation.Language.Parser]::ParseFile($first,[ref]$null,[ref]$errors)
 foreach($node in $firstAst.EndBlock.Statements){if($node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -cin @('Sha','Check-FirstAttempt')){. ([scriptblock]::Create($node.Extent.Text))}}
 $djangoRoot=$root;$workerRoot=$workerFixed
 $workerScript=Join-Path $workerRoot 'releases/private/tools/worker-local-service.ps1';$workerReceipt=Join-Path $workerRoot 'state/worker-process.json';$djangoManifest=Join-Path $root 'app/deployment.json';$piConfig=Join-Path $root 'config/pi-agent.json'
 foreach($target in @($workerScript,$workerReceipt,$djangoManifest,$piConfig)){[void][IO.Directory]::CreateDirectory((Split-Path -Parent $target));[IO.File]::WriteAllText($target,'private immutable bytes')}
 Reset-Pi
 $admission=@{version='manual-maintenance-first-attempt-v2';workerScript=$workerScript;workerScriptSha256=(Hash-File $workerScript);workerReceiptSha256=(Hash-File $workerReceipt);djangoManifestSha256=(Hash-File $djangoManifest);maintenanceId=$token;preparedAt=[DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('o');readinessRoute='pi19db';piWorkerReceiptSha256=(Hash-File $pidFile);piConfigurationSha256=(Hash-File $piConfig);rotationOwnerPid=0;sourcePins=@{}}
 $InputPath=Join-Path $root 'admission.json';Save $InputPath $admission;$InputSha256=Hash-File $InputPath
 function Expect-FirstError([string]$Message){$failed=$false;try{Check-FirstAttempt|Out-Null}catch{if($_.Exception.Message -cnotlike ('*'+$Message+'*')){throw};$failed=$true};if(-not $failed){throw 'First gate unexpectedly completed'}}
 Expect-FirstError 'Original invocation binding is missing'
 [IO.File]::AppendAllText($pidFile,' ');Expect-FirstError 'Pre-admitted Pi ownership or configuration changed'
 Reset-Pi;[IO.File]::AppendAllText($piConfig,' ');Expect-FirstError 'Pre-admitted Pi ownership or configuration changed'
 if(Test-Path -LiteralPath (Join-Path $root 'maintenance-first-actor.json')){throw 'CAS rejection wrote an actor record'}
 Write-Output 'PI_CONTINUATION_NATIVE_ASSERTIONS_PASSED: late Python/WSL controls, exact receipt identity, original Pi token/absence and raw records'
}finally{
 $absolute=[IO.Path]::GetFullPath($root);if(-not $absolute.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($absolute) -cnotlike 'pi-continuation-private-*'){throw 'Unsafe fixture cleanup'}
 Remove-Item -LiteralPath $root -Recurse -Force
}
