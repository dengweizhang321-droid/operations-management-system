[CmdletBinding(PositionalBinding=$false)]
param(
 [Parameter(Mandatory=$true)][string]$RunFile,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$RunSha256,
 [Parameter(Mandatory=$true)][string]$Node,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$NodeSha256
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
function Get-HandoffDigest([string]$File) { (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() }
function Assert-HandoffPhysical([string]$File) {
 if(-not [IO.Path]::IsPathRooted($File) -or $File -match '["\r\n\x00]'){throw 'Unsafe fixed handoff path'}
 $next=[IO.Path]::GetFullPath($File)
 while($next){$item=Get-Item -LiteralPath $next -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse handoff path'};$parent=[IO.Path]::GetDirectoryName($next);if($parent -eq $next){break};$next=$parent}
}
function Write-HandoffCreateOnly([string]$File,$Value) {
 $raw=[Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 6 -Compress)+"`n")
 $fileStream=[IO.File]::Open($File,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
 try{$fileStream.Write($raw,0,$raw.Length);$fileStream.Flush($true)}finally{$fileStream.Dispose()}
}
function Wait-HandoffInteractiveExplorer([string]$ExpectedSid,[int]$Session,[bool]$AfterLogon) {
 $interactiveClock=[Diagnostics.Stopwatch]::StartNew()
 do{
  $matchingExplorers=0
  foreach($explorer in @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe' AND SessionId=$Session")){
   $owner=Invoke-CimMethod -InputObject $explorer -MethodName GetOwnerSid
   if($null -eq $owner -or $owner.ReturnValue -isnot [uint32] -or $owner.ReturnValue -ne 0 -or $owner.Sid -isnot [string]){throw 'Interactive owner unavailable'}
   if($owner.Sid -ceq $ExpectedSid){$matchingExplorers++}
  }
  if($matchingExplorers -gt 0 -or -not $AfterLogon -or $interactiveClock.ElapsedMilliseconds -ge 30000){break}
  [Threading.Thread]::Sleep(250)
 }while($true)
 if($matchingExplorers -lt 1){throw 'Same-user interactive Explorer required'}
}
Assert-HandoffPhysical $RunFile
Assert-HandoffPhysical $Node
if((Get-HandoffDigest $RunFile) -cne $RunSha256){throw 'Handoff RUN changed'}
if((Get-HandoffDigest $Node) -cne $NodeSha256){throw 'Handoff Node changed'}
$run=[IO.File]::ReadAllText($RunFile,[Text.UTF8Encoding]::new($false,$true))|ConvertFrom-Json
if($run.version -cne 'teruisi-preparation-retirement-handoff-v1' -or $run.runId -notmatch '^[a-f0-9-]{36}$'){throw 'Invalid fixed handoff run'}
if([IO.Path]::GetFullPath($RunFile) -ine [IO.Path]::Combine([string]$run.directory,'RUN.json')){throw 'Run directory changed'}
if([IO.Path]::GetFullPath($Node) -ine [string]$run.node.path -or $NodeSha256 -cne [string]$run.node.sha256){throw 'Node binding changed'}
Assert-HandoffPhysical ([string]$run.host.entry)
Assert-HandoffPhysical ([string]$run.host.runner)
if($PSCommandPath -ine [string]$run.host.runner -or (Get-HandoffDigest $PSCommandPath) -cne [string]$run.host.runnerSha256){throw 'Runner must use its frozen exact path'}
if((Get-HandoffDigest ([string]$run.host.entry)) -cne [string]$run.host.entrySha256){throw 'Fixed Node host changed'}
$ownedConsole=$run.PSObject.Properties.Name -ccontains 'console'
if($ownedConsole){
 if([string]$run.console.version -cne 'teruisi-handoff-owned-console-v1' -or [string]$run.phase -cnotin @('control-prepare','control-adopt') -or [bool]$run.afterLogon){throw 'Owned console is restricted to fixed control phases'}
 # The GUI verifies the actual newly created PS before any Add-Type/compiler or Node.
 $guiPsFile=[IO.Path]::Combine([string]$run.directory,'GUI-PS.json')
 $guiClock=[Diagnostics.Stopwatch]::StartNew()
 $guiPs=$null
 do{
  if(Test-Path -LiteralPath $guiPsFile){
   Assert-HandoffPhysical $guiPsFile
   $guiFrame=$null
   try{$guiFrame=[IO.File]::ReadAllText($guiPsFile,[Text.UTF8Encoding]::new($false,$true))}catch{
    $guiReadError=$_.Exception
    while($null -ne $guiReadError.InnerException){$guiReadError=$guiReadError.InnerException}
    if($guiReadError -isnot [IO.IOException] -or ($guiReadError.HResult -band 65535) -notin @(32,33)){throw}
   }
   if($null -ne $guiFrame -and $guiFrame.EndsWith("`n",[StringComparison]::Ordinal)){
    if($guiFrame.IndexOf("`n",[StringComparison]::Ordinal) -ne ($guiFrame.Length-1) -or $guiFrame.Contains("`r")){throw 'GUI proof must be one compact JSON line'}
    $guiPs=$guiFrame|ConvertFrom-Json;break
   }
  }
  if($guiClock.ElapsedMilliseconds -ge 15000){throw 'GUI PS proof unavailable; no replay'}
  [Threading.Thread]::Sleep(25)
 }while($true)
 if([string]$guiPs.version -cne [string]$run.console.version -or [string]$guiPs.runId -cne [string]$run.runId -or [string]$guiPs.runSha256 -cne $RunSha256 -or [int]$guiPs.parent.processId -ne $PID -or $guiPs.strictRoleProven -isnot [bool] -or $guiPs.strictRoleProven){throw 'GUI PS binding changed'}
}
# Consume the one-shot before any identity/Explorer wait can fail. No automatic replay.
foreach($name in @('ATTEMPT.json','STARTED.json','RESULT.json','EXIT.json','PARENT.json','stdout.log','stderr.log')){if(Test-Path -LiteralPath ([IO.Path]::Combine([string]$run.directory,$name))){throw 'Handoff run was previously attempted; no replay'}}
Write-HandoffCreateOnly ([IO.Path]::Combine([string]$run.directory,'ATTEMPT.json')) @{version='teruisi-preparation-retirement-handoff-v1';runId=[string]$run.runId;runSha256=$RunSha256;phase=[string]$run.phase;pid=$PID;at=[DateTime]::UtcNow.ToString('o')}
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public class RetirementRunnerToken {
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool GetTokenInformation(IntPtr t,int c,IntPtr b,int n,out int r);
 public static int Read(IntPtr t,int c){int n;GetTokenInformation(t,c,IntPtr.Zero,0,out n);IntPtr p=Marshal.AllocHGlobal(n);try{if(!GetTokenInformation(t,c,p,n,out n))throw new System.ComponentModel.Win32Exception();if(c==20)return Marshal.ReadInt32(p);IntPtr sid=Marshal.ReadIntPtr(p);int count=Marshal.ReadByte(sid,1);return Marshal.ReadInt32(sid,8+4*(count-1));}finally{Marshal.FreeHGlobal(p);}}
}
'@
$who=[Security.Principal.WindowsIdentity]::GetCurrent()
$session=[Diagnostics.Process]::GetCurrentProcess().SessionId
if($who.User.Value -cne [string]$run.identity.sid -or $session -le 0 -or (-not $run.afterLogon -and $session -ne [int]$run.identity.sessionId)){throw 'Handoff SID/session changed'}
if([RetirementRunnerToken]::Read($who.Token,20) -ne 0 -or [RetirementRunnerToken]::Read($who.Token,25) -ne 8192){throw 'Handoff runner requires actual medium unelevated token'}
Wait-HandoffInteractiveExplorer $who.User.Value $session ([bool]$run.afterLogon)
$configPreimage=[IO.Path]::Combine([string]$run.directory,'CONFIG-PREIMAGE.json')
Assert-HandoffPhysical $configPreimage
if((Get-HandoffDigest $configPreimage) -cne [string]$run.configSha256){throw 'Configuration preimage changed'}
$preimage=[IO.File]::ReadAllText($configPreimage,[Text.UTF8Encoding]::new($false,$true))|ConvertFrom-Json
$allowed=@('SYSTEMROOT','WINDIR','SYSTEMDRIVE','COMSPEC','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA','PROGRAMFILES','PROGRAMFILES(X86)','COMMONPROGRAMFILES','COMMONPROGRAMFILES(X86)','HOMEDRIVE','HOMEPATH','USERNAME','USERDOMAIN','LOGONSERVER','OS','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS','PATH')
if(@($run.environment.PSObject.Properties).Count -ne @($preimage.publisherBaseEnvironment.PSObject.Properties).Count){throw 'Fixed environment member set changed'}
foreach($field in $run.environment.PSObject.Properties){if($allowed -cnotcontains $field.Name -or $field.Value -isnot [string] -or $field.Value.Contains([char]0) -or $field.Value -cne $preimage.publisherBaseEnvironment.($field.Name)){throw 'Unapproved fixed environment'}}
$myProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
if(-not $myProcess.CommandLine -or -not $myProcess.ExecutablePath){throw 'Runner process identity unavailable'}
$hash=[Security.Cryptography.SHA256]::Create()
try{$commandSha=([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$myProcess.CommandLine)))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
$parent=@{version='teruisi-preparation-retirement-handoff-v1';runId=[string]$run.runId;runSha256=$RunSha256;pid=$PID;createdAt=$myProcess.CreationDate.ToUniversalTime().ToString('o');commandLineSha256=$commandSha;executablePath=[string]$myProcess.ExecutablePath;executableSha256=(Get-HandoffDigest ([string]$myProcess.ExecutablePath));identity=@{sid=$who.User.Value;sessionId=$session;elevated=$false;integrityRid=8192}}
Write-HandoffCreateOnly ([IO.Path]::Combine([string]$run.directory,'PARENT.json')) $parent
$outFile=[IO.Path]::Combine([string]$run.directory,'stdout.log')
$errFile=[IO.Path]::Combine([string]$run.directory,'stderr.log')
$out=[IO.File]::Open($outFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
$err=[IO.File]::Open($errFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
$process=[Diagnostics.Process]::new()
$process.StartInfo.FileName=$Node
$process.StartInfo.Arguments='"'+[string]$run.host.entry+'" --action execute --run "'+$RunFile+'" --run-sha '+$RunSha256
$process.StartInfo.WorkingDirectory=[string]$run.directory
$process.StartInfo.UseShellExecute=$false
$process.StartInfo.CreateNoWindow=-not $ownedConsole
$process.StartInfo.RedirectStandardOutput=$true
$process.StartInfo.RedirectStandardError=$true
$process.StartInfo.EnvironmentVariables.Clear()
foreach($field in $run.environment.PSObject.Properties){$process.StartInfo.EnvironmentVariables[$field.Name]=[string]$field.Value}
$directCode=1
$outputComplete=$false
try{
 if(-not $process.Start()){throw 'Fixed ordinary Node did not start'}
 $childCreatedAt=$process.StartTime.ToUniversalTime().ToString('o')
 $outCopy=$process.StandardOutput.BaseStream.CopyToAsync($out)
 $errCopy=$process.StandardError.BaseStream.CopyToAsync($err)
 # WaitForExit observes the direct kernel process. Output EOF is independently bounded.
 $process.WaitForExit()
 $directCode=$process.ExitCode
 $directAt=[DateTime]::UtcNow.ToString('o')
 try{$outputComplete=[Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($outCopy,$errCopy),2000)}catch{$outputComplete=$false}
 if(-not $outputComplete){$process.StandardOutput.Dispose();$process.StandardError.Dispose();try{[void][Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($outCopy,$errCopy),2000)}catch{}}
 $out.Flush($true);$err.Flush($true)
}finally{$out.Dispose();$err.Dispose()}
$resultFile=[IO.Path]::Combine([string]$run.directory,'RESULT.json')
$resultSha=$null
if(Test-Path -LiteralPath $resultFile){Assert-HandoffPhysical $resultFile;$resultSha=Get-HandoffDigest $resultFile}
$exitRecord=@{version='teruisi-preparation-retirement-handoff-v1';runId=[string]$run.runId;runSha256=$RunSha256;phase=[string]$run.phase;pid=$process.Id;createdAt=$childCreatedAt;exitCode=$directCode;directExitAt=$directAt;outputComplete=$outputComplete;stdoutSha256=(Get-HandoffDigest $outFile);stderrSha256=(Get-HandoffDigest $errFile);stdoutBytes=([IO.FileInfo]::new($outFile)).Length;stderrBytes=([IO.FileInfo]::new($errFile)).Length;resultSha256=$resultSha;parentSha256=(Get-HandoffDigest ([IO.Path]::Combine([string]$run.directory,'PARENT.json')))}
if($run.PSObject.Properties.Name -ccontains 'diagnostic'){
 $diagnosticFile=[IO.Path]::Combine([string]$run.directory,'DIAGNOSTIC.json')
 $diagnosticSha=$null
 if(Test-Path -LiteralPath $diagnosticFile){Assert-HandoffPhysical $diagnosticFile;$diagnosticSha=Get-HandoffDigest $diagnosticFile}
 $exitRecord.diagnosticSha256=$diagnosticSha
}
Write-HandoffCreateOnly ([IO.Path]::Combine([string]$run.directory,'EXIT.json')) $exitRecord
$process.Dispose()
exit $directCode
