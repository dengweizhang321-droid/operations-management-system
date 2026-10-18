param([Parameter(Mandatory)][string]$Out,[Parameter(Mandatory)][string]$OriginalsSha256,[Parameter(Mandatory)][int]$WriterPid)
$ErrorActionPreference='Stop'
function Hash-Text([string]$Text){$a=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($a.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-','').ToLowerInvariant()}finally{$a.Dispose()}}
function Assert-OriginalActorsExited([object[]]$Rows){
 $actors=@(@(2552,'2026-10-18T09:44:13.7429060Z'),@(12376,'2026-10-18T09:44:29.7396960Z'),@(23444,'2026-10-18T09:44:30.8690320Z'),@(34284,'2026-10-18T09:44:12.7474900Z'))
 $result=@()
 foreach($actor in $actors){
  $current=@($Rows|Where-Object {[int]$_.ProcessId -eq $actor[0]})
  if($current.Count -gt 1){throw 'Ambiguous original actor PID'}
  $old=[DateTimeOffset]::Parse($actor[1]);$birth=$null
  if($current.Count){
   if(-not $current[0].CreationDate){throw 'Reused PID creation metadata missing'}
   $birth=[DateTimeOffset]$current[0].CreationDate.ToUniversalTime()
   if($birth -le $old){throw 'Original actor is still alive, or creation identity is not proved'}
  }
  foreach($child in @($Rows|Where-Object {[int]$_.ParentProcessId -eq $actor[0]})){
   if(-not $child.CreationDate -or $null -eq $birth -or [DateTimeOffset]$child.CreationDate.ToUniversalTime() -lt $birth){throw 'A possibly old actor descendant remains'}
  }
  if($current.Count){$result+=@{pid=$actor[0];originalBirth=$actor[1];state='reused-unrelated-pid';currentBirth=$birth.ToString('o');currentName=[string]$current[0].Name}}
  else{$result+=@{pid=$actor[0];originalBirth=$actor[1];state='absent'}}
 }
 return $result
}
function Get-OpaqueOriginalAncestryExclusion([object]$Process,[object[]]$Rows){
 $earliest=[DateTimeOffset]::Parse('2026-10-18T09:44:12.7474900Z')
 $seen=[Collections.Generic.HashSet[long]]::new();$chain=[Collections.Generic.List[object]]::new();$current=$Process
 for($hop=0;$hop -lt 128;$hop++){
  if($null -eq $current -or $null -eq $current.CreationDate){throw 'Opaque ancestry birth is unavailable'}
  if(($current.ProcessId -isnot [int] -and $current.ProcessId -isnot [uint32] -and $current.ProcessId -isnot [long]) -or [long]$current.ProcessId -le 0 -or [long]$current.ProcessId -gt [uint32]::MaxValue){throw 'Opaque ancestry PID is invalid'}
  if(($current.ParentProcessId -isnot [int] -and $current.ParentProcessId -isnot [uint32] -and $current.ParentProcessId -isnot [long]) -or [long]$current.ParentProcessId -lt 0 -or [long]$current.ParentProcessId -gt [uint32]::MaxValue){throw 'Opaque ancestry parent is unavailable'}
  if(-not $seen.Add([long]$current.ProcessId)){throw 'Opaque ancestry contains a cycle'}
  if([string]::IsNullOrWhiteSpace([string]$current.Name)){throw 'Opaque ancestry process name is unavailable'}
  $birth=[DateTimeOffset]$current.CreationDate.ToUniversalTime()
  $chain.Add(@{pid=[long]$current.ProcessId;parentPid=[long]$current.ParentProcessId;birth=$birth.ToString('o');name=[string]$current.Name})
  if($birth -lt $earliest){return @{pid=[long]$Process.ProcessId;reason='not-descended-from-original-actors';chain=@($chain.ToArray())}}
  $parent=@($Rows|Where-Object {[long]$_.ProcessId -eq [long]$current.ParentProcessId})
  if($parent.Count -ne 1 -or $null -eq $parent[0].CreationDate){throw 'Opaque ancestry parent identity is unavailable'}
  $parentBirth=[DateTimeOffset]$parent[0].CreationDate.ToUniversalTime()
  if($parentBirth -gt $birth){throw 'Opaque ancestry parent PID was reused after child creation'}
  $current=$parent[0]
 }
 throw 'Opaque ancestry exceeds its bound'
}
function Assert-NoRelatedControllers([object[]]$Rows){
 $bundle='0397f12e5f9a95d1b53d060d0007f89eb863543a5b43f7448ac60b61bfa896b3'
 $excluded=[Collections.Generic.List[object]]::new()
 foreach($row in $Rows){
  if([int]$row.ProcessId -eq $PID){continue}
  $name=[string]$row.Name;$text=([string]$row.CommandLine).Replace('\','/').ToLowerInvariant()
  if($text.Contains('/control-bundles/'+$bundle+'/') -or $text.Contains('/4b733d1aed4b-c5d5bb6f-a9e3fdb9/source/tools/')){throw 'An original-generation or exact-packet controller remains'}
  if(($name -imatch '^(node|powershell|pwsh)(\.exe)?$' -or [string]::IsNullOrWhiteSpace($name)) -and (-not $row.CommandLine -or -not $row.ExecutablePath -or -not $row.CreationDate)){
   $excluded.Add((Get-OpaqueOriginalAncestryExclusion $row $Rows))
  }
 }
 return @($excluded.ToArray())
}
function Assert-OriginalPacketNotStarted {
 $packet='D:\codex-isolated\main-release-packages\4b733d1aed4b-c5d5bb6f-a9e3fdb9'
 if(Test-Path -LiteralPath (Join-Path $packet 'publish-4b733d1aed4b')){throw 'Original packet now has native preparation/publication state'}
 if(@(Get-ChildItem -LiteralPath (Join-Path $packet 'invocations') -Force).Count){throw 'Original invocation result or partial file exists'}
}
try{
 if($OriginalsSha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'Missing exact original evidence digest'}
 if($WriterPid -le 0 -or $WriterPid -eq $PID){throw 'Observer must be a separate process'}
 $directory=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'observations'))
 if([IO.Path]::GetFullPath((Split-Path -Parent $Out)) -ine $directory -or [IO.Path]::GetFileName($Out) -cnotmatch '^[a-f0-9-]{36}\.json$'){throw 'Observer output must be a new private material record'}
 Assert-OriginalPacketNotStarted
 $rows=@(Get-CimInstance Win32_Process -ErrorAction Stop)
 $actors=Assert-OriginalActorsExited $rows;$opaque=@(Assert-NoRelatedControllers $rows)
 $self=@($rows|Where-Object {[int]$_.ProcessId -eq $PID});if($self.Count -ne 1 -or -not $self[0].CreationDate -or -not $self[0].CommandLine){throw 'Observer identity unavailable'}
 Assert-OriginalPacketNotStarted
 $selfSha=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
 $value=@{version='teruisi-admin-rejection-observation-e2-v2';scope='original-dispatch-and-known-controller-paths';opaqueExclusions=$opaque;dispatchId='e2a76305-5a58-4814-8418-a35270a55efe';at=[DateTimeOffset]::UtcNow.ToString('o');originalsSha256=$OriginalsSha256;writerPid=$WriterPid;observerPid=[int]$PID;observerCreationDate=$self[0].CreationDate.ToUniversalTime().ToString('o');observerCommandLineSha256=(Hash-Text ([string]$self[0].CommandLine));observerCodeSha256=$selfSha;actors=$actors;relatedControllers=@();packetPublishDirectoryAbsent=$true;invocationsEmpty=$true}
 $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($value|ConvertTo-Json -Depth 8 -Compress)+"`n")
 $stream=[IO.File]::Open($Out,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
 try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
 [pscustomobject]@{observationFile=$Out;observationSha256=(Get-FileHash -LiteralPath $Out -Algorithm SHA256).Hash.ToLowerInvariant()}|ConvertTo-Json -Compress
}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}
