param([Parameter(Mandatory)][string]$SourceFile,[Parameter(Mandatory)][string]$TransportFile,[Parameter(Mandatory)][string]$AdapterCommandPath)
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($SourceFile,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
# Extract pure validators only. Never execute the production script body,
# acquire a production mutex, enumerate processes, load a runtime or call WSL.
$names=@('Assert-Record','Assert-Actor','Assert-NoControlParticipants')
foreach($node in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$false)){
 if($names -contains $node.Name){. ([scriptblock]::Create($node.Extent.Text))}
}
$script:admissionRecord=[pscustomobject]@{maintenanceId=('a'*32)}
$djangoFixed='C:\private-fixture\django';$workerFixed='C:\private-fixture\worker'
function Fails([scriptblock]$Check,[string]$Message=''){$failed=$false;try{& $Check}catch{if($Message -and $_.Exception.Message -cnotlike ('*'+$Message+'*')){throw};$failed=$true};if(-not $failed){throw 'Expected strict rejection'}}
$record=[pscustomobject]@{version='teruisi-system-maintenance-v1';id=('a'*32);runtimeRoot=$djangoFixed;keepPostgres=$true}
Assert-Record $record 'teruisi-system-maintenance-v1'
$record.keepPostgres='true';Fails {Assert-Record $record 'teruisi-system-maintenance-v1'};$record.keepPostgres=$true
$record.id=@('a'*32);Fails {Assert-Record $record 'teruisi-system-maintenance-v1'};$record.id='a'*32
Fails {Assert-Record @($record) 'teruisi-system-maintenance-v1'}
$record.runtimeRoot='C:\other';Fails {Assert-Record $record 'teruisi-system-maintenance-v1'}
$identity=[pscustomobject]@{processId=[int]123;creationDate='2026-01-01T00:00:00.0000000Z';executablePath='C:\private\pwsh.exe';commandLine='private-original'}
Assert-Actor $identity $null
$current=[pscustomobject]@{ProcessId=123;CreationDate=[DateTime]::Parse($identity.creationDate).ToUniversalTime();ExecutablePath=$identity.executablePath;CommandLine=$identity.commandLine}
Assert-Actor $identity $current
$current.CommandLine='reused';Fails {Assert-Actor $identity $current}
$identity.processId='123';Fails {Assert-Actor $identity $null};$identity.processId=[int]123
$script:actor=[pscustomobject]@{actor=$identity;rotationOwner=[pscustomobject]@{processId=[int]456}}
Assert-NoControlParticipants @()
Fails {Assert-NoControlParticipants @([pscustomobject]@{ProcessId=123;CreationDate=[DateTime]::Parse($identity.creationDate).ToUniversalTime();ExecutablePath=$identity.executablePath;CommandLine=$identity.commandLine})}
foreach($command in @('pwsh -File C:\private-fixture\django\app\tools\django-local-service.ps1 -Action Status','powershell -File C:\private\worker-local-service.ps1 -Action EnterMaintenance')){
 Fails {Assert-NoControlParticipants @([pscustomobject]@{ProcessId=800;Name='pwsh.exe';CommandLine=$command;ExecutablePath='C:\private\pwsh.exe';ParentProcessId=1;CreationDate=[DateTime]::UtcNow})}
}
$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('& C:\private\django-local-service.ps1 -Action Stop'))
Fails {Assert-NoControlParticipants @([pscustomobject]@{ProcessId=800;Name='powershell.exe';CommandLine=('powershell -EncodedCommand '+$encoded);ExecutablePath='C:\private\powershell.exe';ParentProcessId=1;CreationDate=[DateTime]::UtcNow})}
Fails {Assert-NoControlParticipants @([pscustomobject]@{ProcessId=800;Name='powershell.exe';CommandLine=$null;ExecutablePath=$null;ParentProcessId=1;CreationDate=[DateTime]::UtcNow})}
Fails {Assert-NoControlParticipants @([pscustomobject]@{ProcessId=800;Name='waitress-serve.exe';CommandLine='waitress';ExecutablePath=($djangoFixed+'\venv\Scripts\waitress-serve.exe');ParentProcessId=1;CreationDate=[DateTime]::UtcNow})}
Assert-NoControlParticipants @([pscustomobject]@{ProcessId=800;Name='pwsh.exe';CommandLine='pwsh -File C:\unrelated\read.ps1';ExecutablePath='C:\private\pwsh.exe';ParentProcessId=1;CreationDate=[DateTime]::UtcNow})
# This exact adapter output is generated in Node by productionCommandArguments,
# not a hand-written nested command. Neither bootstrap is executed here.
$adapter=[IO.File]::ReadAllText($AdapterCommandPath)|ConvertFrom-Json
Fails {Assert-NoControlParticipants @([pscustomobject]@{ProcessId=800;Name='powershell.exe';CommandLine=$adapter.commandLine;ExecutablePath='C:\private\powershell.exe';ParentProcessId=1;CreationDate=[DateTime]::UtcNow})} 'Encoded PowerShell participant remains unclassified'
'REJECTED_REAL_ADAPTER_ENCODED_REPORT'
foreach($option in @('-EncodedCommand','-ec','-e','-enco','"-enc"')){
 Fails {Assert-NoControlParticipants @([pscustomobject]@{ProcessId=800;Name='pwsh.exe';CommandLine=('pwsh '+$option+' '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('Write-Output inert')));ExecutablePath='C:\private\pwsh.exe';ParentProcessId=1;CreationDate=[DateTime]::UtcNow})} 'Encoded PowerShell participant remains unclassified'
}
# Use the real shared transport's deadline contract, without loading its native
# process type or starting a process. Evaluate the production call itself.
$deadlineAst=[Management.Automation.Language.Parser]::ParseFile($TransportFile,[ref]$tokens,[ref]$errors)
$argumentFunction=$deadlineAst.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'ConvertTo-ProcessPowerShellArguments'},$true)
. ([scriptblock]::Create($argumentFunction.Extent.Text))
$nativeArgs=ConvertTo-ProcessPowerShellArguments 'C:\private\powershell.exe' @('-NoProfile','-NonInteractive','-File','C:\private-fixture\django\app\tools\django-local-service.ps1','-Action','Report','-RuntimeRoot',$djangoFixed,'-Json')
if($nativeArgs[2] -cne '-EncodedCommand'){throw 'Expected the original native transport encoded bootstrap'}
$outer=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($nativeArgs[3]))
if($outer.Contains($djangoFixed) -or $outer.Contains('Report')){throw 'Native fixture accidentally exposed its inner JSON payload'}
$nativeLine='C:\private\powershell.exe '+($nativeArgs -join ' ')
Fails {Assert-NoControlParticipants @([pscustomobject]@{ProcessId=800;Name='powershell.exe';CommandLine=$nativeLine;ExecutablePath='C:\private\powershell.exe';ParentProcessId=1;CreationDate=[DateTime]::UtcNow})} 'Encoded PowerShell participant remains unclassified'
'REJECTED_REAL_NATIVE_TRANSPORT_ENCODED_REPORT'
$deadlineFunction=$deadlineAst.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-ProcessDeadline'},$true)
. ([scriptblock]::Create($deadlineFunction.Extent.Text))
$deadlineAssignment=$ast.Find({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -ceq '$observerDeadline'},$true)
$savedDeadline=$env:TERUISI_PROCESS_DEADLINE_UNIX_MS
try{
 $env:TERUISI_PROCESS_DEADLINE_UNIX_MS=$null
 $now=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
 . ([scriptblock]::Create($deadlineAssignment.Extent.Text))
 $budget=$observerDeadline-$now
 if($budget -lt 119000 -or $budget -gt 121000){throw 'Observer must request 120000 milliseconds from the real transport'}
 $inherited=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+2000
 $env:TERUISI_PROCESS_DEADLINE_UNIX_MS=[string]$inherited
 . ([scriptblock]::Create($deadlineAssignment.Extent.Text))
 if($observerDeadline -ne $inherited){throw 'Observer replaced the original inherited deadline'}
 $wslFunction=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Invoke-ObserverWsl'},$true)
 . ([scriptblock]::Create($wslFunction.Extent.Text))
 $script:fakeWslCapture=[pscustomobject]@{ExitCode=0;Stderr='';Stdout='synthetic-linux-only'}
 $script:fakeWslCalls=@()
 function Invoke-DeadlineProcess {param($Executable,$Arguments,$WorkingDirectory,$Deadline,$MaxOutputBytes,$Cleanup)
  $script:fakeWslCalls+=,[pscustomobject]@{Executable=$Executable;Arguments=$Arguments;WorkingDirectory=$WorkingDirectory;Deadline=$Deadline;MaxOutputBytes=$MaxOutputBytes;Cleanup=$Cleanup}
  return $script:fakeWslCapture
 }
 if((Invoke-ObserverWsl @('--list','--running','--quiet')) -cne 'synthetic-linux-only'){throw 'Read-only WSL seam lost output'}
 if($script:fakeWslCalls.Count -ne 1 -or $script:fakeWslCalls[0].Deadline -ne $inherited -or $script:fakeWslCalls[0].Cleanup -cne 'Preserve'){throw 'WSL seam widened inherited budget or cleanup'}
 $observerDeadline=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+120000
 $before=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
 [void](Invoke-ObserverWsl @('--list','--running','--quiet'))
 $slice=$script:fakeWslCalls[1].Deadline-$before
 if($slice -lt 14000 -or $slice -gt 16000){throw 'WSL observation must have a 15-second bounded slice'}
 $script:fakeWslCapture.ExitCode=1;Fails {Invoke-ObserverWsl @('--list','--running','--quiet')}
 $script:fakeWslCapture.ExitCode=0;$script:fakeWslCapture.Stderr='unknown';Fails {Invoke-ObserverWsl @('--list','--running','--quiet')}
}finally{$env:TERUISI_PROCESS_DEADLINE_UNIX_MS=$savedDeadline}
'PRIVATE_FIXTURES_PASSED'
