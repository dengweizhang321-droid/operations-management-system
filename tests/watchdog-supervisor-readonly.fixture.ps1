param([string]$Source)
$ErrorActionPreference='Stop';. $Source
$SupervisorPidPath='synthetic';$SupervisorScriptPath='original';$SupervisorReceiptVersion='v1'
$script:deleted=0;$script:cleanup=0;$script:mode='valid'
function Test-Path {return $true}
function Read-JsonFile {return [pscustomobject]@{version='v1';processId=100;creationDate='birth';executablePath='image';commandLine='command';scriptPathSha256='pathHash';scriptSha256='fileHash';startedAt='start'}}
function Assert-SupervisorExactPropertySet($v,$p,$label){}
function Get-SupervisorCanonicalPath($p){return $p}
function Get-Sha256Text($p){return 'pathHash'}
function Get-FileSha256($p){return 'fileHash'}
function ConvertTo-CanonicalCreationDate($p){return $p}
function Test-CommandLineReferencesPath($c,$p){return ($c -ceq 'command')}
function Remove-Item {$script:deleted++;throw 'Unexpected deletion'}
function Remove-PreviousBootProcessRecordIfSafe {$script:cleanup++;return $true}
function Get-ReadonlyDiagnosticSnapshot($p,$n){switch($script:mode){'absent'{return $null};'denied'{throw 'native denied'};'reused'{return [pscustomobject]@{CreationDate='newBirth';ExecutablePath='image';CommandLine='command'}};default{return [pscustomobject]@{CreationDate='birth';ExecutablePath='image';CommandLine='command'}}}}
$checks=0
if((Resolve-SupervisorProcess).CreationDate -cne 'birth'){throw 'valid identity rejected'};$checks++
$script:mode='absent';if($null -ne (Resolve-SupervisorProcess)){throw 'absence invalid'};$checks++
foreach($m in @('denied','reused')){$script:mode=$m;$caught=$false;try{Resolve-SupervisorProcess|Out-Null}catch{$caught=$true};if(-not $caught){throw 'Unknown identity admitted'};$checks++}
if($script:deleted -ne 0 -or $script:cleanup -ne 0){throw 'Diagnostic changed receipts'}
@{checks=$checks;deletes=$script:deleted;previousBootCleanup=$script:cleanup;productionActions=0}|ConvertTo-Json -Compress
