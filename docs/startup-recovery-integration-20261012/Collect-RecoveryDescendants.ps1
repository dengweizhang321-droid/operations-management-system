# Metadata-only preparation. Fixed 23 roots, bounded current descendants.
# No termination handle, privilege change, status/lifecycle or raw argv output.
param([string]$RootEvidence,[string]$NativeSource,[string]$DeadlineSource)
$ErrorActionPreference='Stop'
if((Get-FileHash -LiteralPath $RootEvidence -Algorithm SHA256).Hash.ToLowerInvariant() -cne '7174f4bdc0cd447313406268a1e535a4343a216157657587aabf12367c3e6146'){throw 'Original root evidence changed'}
$holds=[Collections.Generic.List[object]]::new()
try{
 foreach($pin in @(@($NativeSource,'d8748a819bdeba1e46bf6df35973714bb996f3c51441a0481cd917b17f2e8449'),@($DeadlineSource,'5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd'))){$h=[IO.File]::Open($pin[0],'Open','Read','Read');$holds.Add($h);if((Get-FileHash -LiteralPath $pin[0] -Algorithm SHA256).Hash.ToLowerInvariant() -cne $pin[1]){throw 'Metadata source changed'}}
 . $DeadlineSource;. $NativeSource
 $roots=@(([IO.File]::ReadAllText($RootEvidence)|ConvertFrom-Json -DateKind String).rows|Where-Object {$_.auditStartup})
 if($roots.Count -ne 23){throw 'Fixed roots missing'}
 function TextHash([string]$s){$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($s)))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
 $rows=@(CimCmdlets\Get-CimInstance Win32_Process -ErrorAction Stop)
 $byId=@{};foreach($r in $rows){$key=[int]$r.ProcessId;if($byId.ContainsKey($key)){throw 'Duplicate census PID'};$byId[$key]=$r}
 $targets=@{};foreach($r in $roots){$targets[[int]$r.processId]=@{root=[int]$r.processId;depth=0;expected=$r}}
 for($depth=1;$depth -le 16;$depth++){
  $added=0;foreach($r in $rows){$parent=$targets[[int]$r.ParentProcessId];if($parent -and $parent.depth -eq $depth-1 -and -not $targets.ContainsKey([int]$r.ProcessId)){$targets[[int]$r.ProcessId]=@{root=$parent.root;depth=$depth;expected=$null};$added++}}
  if($targets.Count -gt 128){throw 'Bounded tree exceeded'};if($added -eq 0){break}
 }
 foreach($r in $rows){if($targets.ContainsKey([int]$r.ParentProcessId) -and -not $targets.ContainsKey([int]$r.ProcessId)){throw 'Descendant depth exceeded'}}
 $records=@();$unknown=@()
 foreach($entry in @($targets.GetEnumerator()|Sort-Object Key)){
  $processId=[int]$entry.Key;$shape=$entry.Value;$before=$byId[$processId]
  try{
   if(-not $before -or $before.CreationDate -isnot [datetime]){throw 'CIM birth missing'}
   $native=Get-ReadonlyNativeProcessFields $processId;$after=@(Read-ReadonlyCimProcess $processId)
   if($after.Count -ne 1 -or $after[0].CreationDate -ne $before.CreationDate -or $after[0].ParentProcessId -ne $before.ParentProcessId -or $after[0].Name -cne $before.Name -or $after[0].SessionId -ne $before.SessionId -or -not [Teruisi.ReadonlyProcessMetadata]::SameCreation([long]$native.CreationFileTime,$before.CreationDate.ToUniversalTime().ToFileTimeUtc())){throw 'Instance changed during metadata capture'}
   $imageHash=TextHash $native.ExecutablePath;$commandHash=TextHash $native.CommandLine
   if($shape.depth -eq 0){$x=$shape.expected;if([string]$native.CreationFileTime -cne $x.nativeCreationFileTime -or $imageHash -cne $x.imageSha256 -or $commandHash -cne $x.commandLineSha256 -or $before.ParentProcessId -ne $x.parentProcessId){throw 'Original service root changed'}}
   $records+=@{processId=$processId;parentProcessId=[int]$before.ParentProcessId;nativeCreationFileTime=[string]$native.CreationFileTime;imageSha256=$imageHash;commandSha256=$commandHash;rootProcessId=$shape.root;depth=[int]$shape.depth;name=[string]$before.Name;identityStable=$true}
  }catch{$unknown+=@{processId=$processId;rootProcessId=$shape.root;depth=$shape.depth;reason=$_.Exception.Message}}
 }
 $afterRows=@(CimCmdlets\Get-CimInstance Win32_Process -ErrorAction Stop)
 $relevant=@($afterRows|Where-Object {$targets.ContainsKey([int]$_.ProcessId) -or $targets.ContainsKey([int]$_.ParentProcessId)})
 $stable=($relevant.Count -eq $targets.Count -and @($relevant|Where-Object {-not $targets.ContainsKey([int]$_.ProcessId) -or $_.CreationDate -ne $byId[[int]$_.ProcessId].CreationDate -or $_.ParentProcessId -ne $byId[[int]$_.ProcessId].ParentProcessId}).Count -eq 0)
 [pscustomobject]@{version='recovery-descendant-metadata-v1';sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;administrator=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);at=[DateTimeOffset]::UtcNow.ToString('o');roots=23;records=$records;unknown=$unknown;treeStableAtSamples=$stable;rawCommandsPersisted=$false;terminateHandlesOpened=0;productionStops=0}|ConvertTo-Json -Depth 8 -Compress
}finally{foreach($h in $holds){$h.Dispose()}}
