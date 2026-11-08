$ErrorActionPreference='Stop'
# CIM properties can be read-only. Always detach the six identity fields; never
# repair, normalize in place, or fill unavailable metadata from another actor.
function ConvertTo-MaintenanceProcess {
 param([Parameter(ValueFromPipeline=$true)][object]$Process)
 process {
  [pscustomobject]@{ProcessId=$Process.ProcessId;ParentProcessId=$Process.ParentProcessId;Name=$Process.Name;CreationDate=$Process.CreationDate;ExecutablePath=$Process.ExecutablePath;CommandLine=$Process.CommandLine}
 }
}
function Assert-MaintenanceProcessVisibility([object[]]$Processes){
 foreach($process in $Processes){
  if([string]$process.Name -imatch '^(powershell|pwsh|python|pythonw|waitress-serve|node|workerd|wsl)(\.exe)?$' -and
   (-not $process.CommandLine -or -not $process.ExecutablePath -or -not $process.CreationDate)){
   throw 'Possible late control/application process has unreadable identity; continuation visibility is unknown'
  }
 }
}
function Read-MaintenanceObject([string]$File){
 $raw=[IO.File]::ReadAllText($File)
 if(-not $raw.TrimStart().StartsWith('{')){throw 'Maintenance preflight input must be an object'}
 $value=if((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){$raw|ConvertFrom-Json -DateKind String}else{$raw|ConvertFrom-Json}
 if($value -isnot [pscustomobject]){throw 'Maintenance preflight input must be an object'}
 return $value
}
function Assert-MaintenanceReadiness([object]$Readiness,[string]$DjangoRoot,[string]$WorkerRoot,[string]$SourceTools){
 if($Readiness -isnot [pscustomobject] -or $Readiness.version -cne 'manual-maintenance-readiness-v1' -or $Readiness.route -cnotin @('legacy','pi19db','native-exit-observer')){throw 'Unknown maintenance readiness route'}
 $at=[DateTimeOffset]::Parse($Readiness.preparedAt);$age=([DateTimeOffset]::UtcNow-$at).TotalSeconds
 if($age -lt 0 -or $age -ge 120){throw 'Maintenance preflight expired'}
 if($Readiness.releaseId -isnot [string] -or $Readiness.releaseId -cnotmatch '^[a-zA-Z0-9-]+$'){throw 'Invalid maintenance predecessor release'}
 $required=@('source:manual-maintenance-start.ps1','source:manual-maintenance-lock.psm1','source:manual-maintenance-continuation.ps1','source:manual-maintenance-continuation.mjs','source:publish-prepared-main.mjs','source:publish-main-command.mjs','source:manual-maintenance-process.psm1','source:manual-maintenance-preflight.ps1','django:app/deployment.json','django:app/tools/django-local-service.ps1')
 foreach($relative in @('tools/worker-local-service.ps1','tools/process-deadline.ps1','deployment-manifest.json')){$required+=('worker:releases/'+$Readiness.releaseId+'/'+$relative)}
 if($Readiness.route -cne 'legacy'){$required+='django:app/tools/django-ai.ps1'}
 if($Readiness.route -ceq 'native-exit-observer'){$required+=@('source:django-ai.ps1','source:worker-local-service.ps1','source:process-deadline.ps1','source:django-local-service.ps1')}
 $qualification=$Readiness.PSObject.Properties['controllerQualification']
 if($qualification){
  if($qualification.Value -cne 'native-isolation-controller-20261108-v1' -or $Readiness.route -cne 'native-exit-observer'){throw 'Unknown controller dependency qualification'}
  $required+=@('source:native-isolation.ps1','source:native-isolation.mjs')
  $qualified=@{
   'source:django-ai.ps1'='1b4a95bf7b76c4f8600df49b7cc67d98cac3073fd4de48ef28bd53397b2ced42'
   'django:app/tools/django-ai.ps1'='55b6701ac0f38e7aed6abea441085aa2b77f0a5f8d1a3f6c81651829ae6f9aba'
   'source:django-local-service.ps1'='93741e5537b30efa5e91b6cfebd6af44addf1104cadf91f8add108f8a3753044'
   'django:app/tools/django-local-service.ps1'='37c6dc571aeefe4954f977f5b3a64ec08516362a67775729f45f60b17bca99a6'
   'source:worker-local-service.ps1'='0e5459dd34c5dd5fa26109d3606117750bb61e11c5b66b510d13dfa889dc4516'
   'source:process-deadline.ps1'='5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd'
   'source:native-isolation.ps1'='2efe6738d9c0d963ad6d2dbc45584d702511889339b38fc82d8250f79db478c1'
   'source:native-isolation.mjs'='b4b54d559a12e79a24112fee3818a58f79444c1b7bf126fb5dc94ab6da1e662b'
  }
  $qualified['worker:releases/'+$Readiness.releaseId+'/tools/worker-local-service.ps1']='1b8c5d4d61ba491d042f41ae91e9cc7b0d0c87a28536bac7b4c8a1e53fda761e'
  $qualified['worker:releases/'+$Readiness.releaseId+'/tools/process-deadline.ps1']='5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd'
  foreach($key in $qualified.Keys){$bound=@($Readiness.pins|Where-Object {($_.root+':'+$_.relative) -ceq $key});if($bound.Count -ne 1 -or $bound[0].sha256 -cne $qualified[$key]){throw 'Controller qualification tuple changed'}}
 }
 $actual=@($Readiness.pins|ForEach-Object {$_.root+':'+$_.relative})
 if($actual.Count -ne $required.Count -or @($actual|Select-Object -Unique).Count -ne $required.Count -or (($actual|Sort-Object)-join '|') -cne (($required|Sort-Object)-join '|')){throw 'Incomplete or duplicated maintenance preflight pins'}
 foreach($pin in @($Readiness.pins)){
  if($pin.root -cnotin @('django','worker','source') -or $pin.relative -isnot [string] -or [IO.Path]::IsPathRooted($pin.relative) -or $pin.relative -match '(^|[\\/])\.\.([\\/]|$)' -or $pin.sha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'Invalid maintenance tool pin'}
  $base=switch -CaseSensitive ($pin.root){'django'{$DjangoRoot};'worker'{$WorkerRoot};'source'{$SourceTools}}
  if((Get-FileHash -LiteralPath (Join-Path $base $pin.relative) -Algorithm SHA256).Hash.ToLowerInvariant() -cne $pin.sha256){throw 'Installed maintenance tool or recovery entry changed'}
 }
 if($Readiness.route -cin @('legacy','pi19db')){
  $processes=@(Get-CimInstance Win32_Process -ErrorAction Stop|ConvertTo-MaintenanceProcess)
  Assert-MaintenanceProcessVisibility $processes
 }
 # Native Stop uses this exact receipt identity. Unknown/reused/exited identity
 # is a pre-maintenance failure, never classified as an unrelated empty path.
 $receipt=Join-Path $DjangoRoot 'run/django-ai-pi-worker.pid.json'
 $config=Join-Path $DjangoRoot 'config/pi-agent.json'
 foreach($pair in @(@($receipt,$Readiness.piWorkerReceiptSha256),@($config,$Readiness.piConfigurationSha256))){
  if($null -eq $pair[1]){if(Test-Path -LiteralPath $pair[0]){throw 'Pi ownership or configuration appeared after readiness'}}
  elseif($pair[1] -cnotmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath $pair[0] -Algorithm SHA256).Hash.ToLowerInvariant() -cne $pair[1]){throw 'Pi ownership or configuration changed after readiness'}
 }
 if($Readiness.piWorkerReceiptSha256){
  $identity=Read-MaintenanceObject $receipt
  if($identity.version -ne 2 -or $identity.service -cne 'django-ai-pi-worker' -or ($identity.processId -isnot [int] -and $identity.processId -isnot [long]) -or $identity.processId -le 0 -or $identity.processId -gt [int]::MaxValue){throw 'Invalid original Pi receipt'}
  foreach($field in @('creationDate','executablePath','commandLine')){if($identity.$field -isnot [string] -or -not $identity.$field){throw 'Incomplete original Pi identity'}}
  if([IO.Path]::GetFullPath($identity.executablePath) -ine [IO.Path]::GetFullPath((Join-Path $DjangoRoot 'venv/Scripts/python.exe'))){throw 'Original Pi executable is not the native Python'}
  $current=@(Get-CimInstance Win32_Process -Filter ('ProcessId='+$identity.processId) -ErrorAction Stop|ConvertTo-MaintenanceProcess)
  if($current.Count -ne 1 -or -not $current[0].CreationDate -or -not $current[0].ExecutablePath -or -not $current[0].CommandLine -or
   $current[0].CreationDate.ToUniversalTime().ToString('o') -cne $identity.creationDate -or [string]$current[0].ExecutablePath -ine $identity.executablePath -or [string]$current[0].CommandLine -cne $identity.commandLine){throw 'Original Pi process identity is unknown or changed'}
 }
 return $true
}
Export-ModuleMember -Function ConvertTo-MaintenanceProcess,Assert-MaintenanceProcessVisibility,Read-MaintenanceObject,Assert-MaintenanceReadiness
