# Loaded only after exact manifest pin. No lifecycle operations are exposed.
function Get-CommandHash([string]$Command){$h=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($Command)))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function New-ProcessBinding([object]$Row){if($null -eq $Row -or -not $Row.CommandLine -or -not $Row.ExecutablePath){throw 'Witness actor identity unavailable'};return @{pid=[int]$Row.ProcessId;creationDate=$Row.CreationDate.ToUniversalTime().ToString('o');executableSha256=(Hash-File $Row.ExecutablePath);commandLineSha256=(Get-CommandHash $Row.CommandLine)}}
function Copy-ProcessCensusRows([object[]]$Rows){foreach($row in $Rows){[pscustomobject]@{ProcessId=[int]$row.ProcessId;ParentProcessId=[int]$row.ParentProcessId;Name=[string]$row.Name;CreationDate=$row.CreationDate;ExecutablePath=[string]$row.ExecutablePath;CommandLine=[string]$row.CommandLine}}}
function Complete-ProcessCensus([object[]]$Rows,[int]$Owner){
 $relevant=@($Rows|Where-Object {$_.Name -imatch '^(powershell|pwsh|python|pythonw|waitress-serve|node|workerd|wsl)(\.exe)?$'})
 if(@($relevant|Where-Object {-not $_.CommandLine -or -not $_.ExecutablePath}).Count -eq 0){return $Rows}
 if($script:liveCensusWitness){$request=$script:liveCensusWitness.request;$requestSha=$script:liveCensusWitness.requestSha;$requestFile=$script:liveCensusWitness.requestFile;$witnessFile=$script:liveCensusWitness.witnessFile;$witnessSha=$script:liveCensusWitness.witnessSha;$witness=$script:liveCensusWitness.witness;$requestId=$request.requestId}else{
 $requestId=[Guid]::NewGuid().ToString('N');$requestFile=Join-Path $intent.outputDirectory ('WITNESS-REQUEST-'+$requestId+'.json');$witnessFile=Join-Path $intent.outputDirectory ('WITNESS-'+$requestId+'.json')
 $request=@{version='6dc-census-request-v1';at=[DateTimeOffset]::UtcNow.ToString('o');requestId=$requestId;intentSha256=$InputSha256;originalFailureSha256=$intent.originalFailureSha256;observer=(New-ProcessBinding @($Rows|Where-Object ProcessId -eq $PID)[0]);owner=(New-ProcessBinding @($Rows|Where-Object ProcessId -eq $Owner)[0]);observerBridgeSha256=$manifest.code.'observe.ps1';witnessScriptSha256=$manifest.code.'witness.ps1'}
 $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($request|ConvertTo-Json -Depth 10 -Compress)+"`n");$stream=[IO.File]::Open($requestFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read);try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()};$requestSha=Hash-File $requestFile
 $until=[DateTimeOffset]::UtcNow.AddSeconds(120);while(-not (Test-Path -LiteralPath $witnessFile)){if([DateTimeOffset]::UtcNow -ge $until){throw 'Fresh independent witness not supplied; no native action'};Start-Sleep -Milliseconds 250}
 $witnessSha=Hash-File $witnessFile;$witness=Read-Object $witnessFile
 if($witness.version -cne '6dc-census-witness-v1' -or $witness.requestId -cne $requestId -or $witness.requestSha256 -cne $requestSha -or $witness.intentSha256 -cne $InputSha256 -or $witness.originalFailureSha256 -cne $intent.originalFailureSha256 -or $witness.elevated -isnot [bool] -or -not $witness.elevated){throw 'Independent witness binding rejected'}
 $date=[DateTimeOffset]::Parse($witness.at);if($date -gt [DateTimeOffset]::UtcNow -or ([DateTimeOffset]::UtcNow-$date).TotalSeconds -ge 120 -or $date -lt [DateTimeOffset]::Parse($request.at)){throw 'Independent witness stale'}
 foreach($field in @('observer','owner')){foreach($key in @('pid','creationDate','executableSha256','commandLineSha256')){if($witness.$field.$key -cne $request.$field.$key){throw 'Witness request actor changed'}}}
 $script:liveCensusWitness=@{request=$request;requestSha=$requestSha;requestFile=$requestFile;witnessFile=$witnessFile;witnessSha=$witnessSha;witness=$witness}
 }
 $date=[DateTimeOffset]::Parse($witness.at);if($date -gt [DateTimeOffset]::UtcNow -or ([DateTimeOffset]::UtcNow-$date).TotalSeconds -ge 120){throw 'Cached independent witness stale'}
 $fresh=@(Copy-ProcessCensusRows @(Get-CimInstance Win32_Process -ErrorAction Stop))
 foreach($field in @(@('observer',$PID),@('owner',$Owner))){$bound=New-ProcessBinding @($fresh|Where-Object ProcessId -eq $field[1])[0];foreach($key in @('pid','creationDate','executableSha256','commandLineSha256')){if($bound.$key -cne $request.($field[0]).$key){throw 'Witness current actor changed'}}}
 $ids=@();foreach($record in @($witness.records)){if($ids -contains [int]$record.pid){throw 'Witness duplicate PID'};$ids+=[int]$record.pid}
 foreach($row in $fresh){
  if($row.Name -inotmatch '^(powershell|pwsh|python|pythonw|waitress-serve|node|workerd|wsl)(\.exe)?$' -or ($row.CommandLine -and $row.ExecutablePath)){continue}
  $record=@($witness.records|Where-Object {[int]$_.pid -eq [int]$row.ProcessId});if($record.Count -ne 1){throw 'New unreadable process not witnessed'};$record=$record[0]
  if($record.name -cne [string]$row.Name -or [int]$record.parentPid -ne [int]$row.ParentProcessId -or $record.creationDate -cne $row.CreationDate.ToUniversalTime().ToString('o') -or -not $record.exe -or -not $record.command){throw 'Unreadable witness identity drift'}
  $row.ExecutablePath=[string]$record.exe;$row.CommandLine=[string]$record.command
 }
 Require-Hash $requestFile $requestSha;Require-Hash $witnessFile $witnessSha
 return $fresh
}
