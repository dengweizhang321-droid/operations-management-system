param([string]$NativeSource,[string]$PredicateSource)
$ErrorActionPreference='Stop'
trap { [Console]::Error.WriteLine($_.ScriptStackTrace); break }
. $NativeSource
. $PredicateSource
$checks=0
function Assert([bool]$Condition){if(!$Condition){throw 'assertion failed'};$script:checks++}
function Reject([scriptblock]$Body){$rejected=$false;try{& $Body|Out-Null}catch{$rejected=$true};Assert $rejected}
function New-Row([int]$Id=100){return [pscustomobject]@{ProcessId=$Id;ParentProcessId=50;Name='node.exe';SessionId=1;CreationDate=[datetime]'2026-10-12T00:00:00Z';ExecutablePath=$null;CommandLine=$null}}
$script:after=New-Row;$script:nativeFailure=$false;$script:nativeCalls=@();$script:nativeBirth=$script:after.CreationDate.ToFileTimeUtc();$script:nativeCommand='fixed argv';$script:nativeImage='C:\fixture\node.exe'
function Get-ReadonlyNativeProcessFields([int]$ProcessId){$script:nativeCalls+=$ProcessId;if($script:nativeFailure){throw 'diagnostic_native_open_5'};return [pscustomobject]@{CreationFileTime=$script:nativeBirth;ExecutablePath=$script:nativeImage;CommandLine=$script:nativeCommand}}
function Read-ReadonlyCimProcess([int]$ProcessId){if($null -ne $script:after){return $script:after}}
function Start-Sleep{}
function Get-ProcessCreation($p){return $p.CreationDate.ToUniversalTime().ToString('o')}
function Get-CanonicalPath([string]$p){return $p}
$original=New-Row;$filled=Complete-ReadonlyProcessMetadata $original
Assert ($filled.CommandLine -ceq 'fixed argv' -and $filled.ExecutablePath -ceq $script:nativeImage)
Assert ($null -eq $original.CommandLine -and $null -eq $original.ExecutablePath)
$complete=New-Row;$complete.CommandLine='already';$complete.ExecutablePath='C:\fixture\node.exe';$n=$script:nativeCalls.Count
Assert ((Complete-ReadonlyProcessMetadata $complete).CommandLine -ceq 'already');Assert ($script:nativeCalls.Count -eq $n)
foreach($case in @('access-denied','native-birth-reused','cim-after-reused','cim-missing','cim-duplicate','name','session','parent','image-disagree','command-disagree','missing-birth')){
 $before=New-Row;$script:after=New-Row;$script:nativeFailure=$false;$script:nativeBirth=$before.CreationDate.ToFileTimeUtc()
 switch($case){
  'access-denied'{$script:nativeFailure=$true}
  'native-birth-reused'{$script:nativeBirth+=10}
  'cim-after-reused'{$script:after.CreationDate=$script:after.CreationDate.AddTicks(10)}
  'cim-missing'{$script:after=$null}
  'cim-duplicate'{$script:after=@($script:after,$script:after)}
  'name'{$script:after.Name='other.exe'}
  'session'{$script:after.SessionId=2}
  'parent'{$script:after.ParentProcessId=60}
  'image-disagree'{$before.ExecutablePath='C:\other.exe'}
  'command-disagree'{$before.CommandLine='other argv'}
  'missing-birth'{$before.CreationDate=$null}
 }
 Reject {Complete-ReadonlyProcessMetadata $before}
}
$script:nativeFailure=$false;$script:after=New-Row;$script:nativeBirth=$script:after.CreationDate.ToFileTimeUtc()+9
Assert ((Complete-ReadonlyProcessMetadata (New-Row)).CommandLine -ceq 'fixed argv')
# An absent PID remains absent, and the generated original resolver cannot clean
# either an absent or mismatched receipt. All effects are explicit test stubs.
$script:removed=0;$script:previous=0;$script:exists=$true
function Test-Path {param([string]$LiteralPath,[string]$PathType);return $script:exists}
function Remove-Item {$script:removed++}
function Remove-PreviousBootProcessRecordIfSafe {$script:previous++;return $true}
function Test-ProcessRecordFromPreviousBoot { return $false }
function Write-LauncherEvent {throw 'diagnostic must not write launcher audit'}
function Read-JsonFile {return [pscustomobject]@{version=2;service='fixture';processId=100;configFingerprint=('a'*64);launcherPath='C:\fixture\node.exe';executablePath='C:\fixture\node.exe';creationDate='2026-10-12T00:00:00.0000000Z';commandLine='fixed argv';arguments=@()}}
function ConvertTo-CanonicalCreationDate($v){return [string]$v}
function Test-CommandLineReferencesPath {return $true}
function Test-ExactStringArray {return $true}
$script:after=$null
Assert ($null -eq (Resolve-OwnedProcess fixture fixture 'C:\fixture\node.exe'))
Assert ($script:removed -eq 0 -and $script:previous -eq 0)
$script:after=New-Row;$script:nativeBirth=$script:after.CreationDate.ToFileTimeUtc()
Assert ((Resolve-OwnedProcess fixture fixture 'C:\fixture\node.exe').ProcessId -eq 100)
Reject {Resolve-OwnedProcess fixture fixture 'C:\wrong.exe'}
Assert ($script:removed -eq 0 -and $script:previous -eq 0)
$script:exists=$false;Assert ($null -eq (Resolve-OwnedProcess fixture fixture 'C:\fixture\node.exe'))
# Worker native supplementation is restricted to the original receipt root/tree.
$script:receipt=[pscustomobject]@{supervisorPid=100};$script:tree=@();$script:rows=@((New-Row 100),(New-Row 101),(New-Row 999));$script:targets=@()
function Read-ProcessReceipt {return $script:receipt}
function Read-ReadonlyWorkerCimCensus {return $script:rows}
function Get-ProcessTree {return $script:tree}
function Complete-ReadonlyProcessMetadata($p){$script:targets+=$p.ProcessId;return $p}
$script:tree=@([pscustomobject]@{Process=$script:rows[1]})
$all=@(Get-ReadonlyWorkerCensus @{});Assert ($all.Count -eq 3);Assert (($script:targets -join ',') -ceq '100,101')
$script:receipt=$null;$script:targets=@();$all=@(Get-ReadonlyWorkerCensus @{});Assert ($script:targets.Count -eq 0)
$script:receipt=[pscustomobject]@{supervisorPid=100};$script:tree=@(1..513|ForEach-Object {[pscustomobject]@{Process=(New-Row $_)}});Reject {Get-ReadonlyWorkerCensus @{}}
[pscustomobject]@{checks=$checks;productionActions=0;nativeCallsWereFixtures=$true;receiptDeletes=$script:removed;previousBootCleanupCalls=$script:previous}|ConvertTo-Json -Compress
