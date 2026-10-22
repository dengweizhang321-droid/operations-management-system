param([Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference='Stop'
# Read-only fixed-scope observation. The only write is the caller's evidence file.
$stateRoot='D:\codex-isolated\main-manual-release-20261016'
$packetRoot='D:\codex-isolated\main-release-packages\36668589cab0-71ecf390-bbc9a5ef'
$installationPath=Join-Path $stateRoot 'CONTROL-INSTALLATION.json'
function DigestText([string]$Text) {
  $hash=[Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-','').ToLowerInvariant() } finally {$hash.Dispose()}
}
$installationText=[IO.File]::ReadAllText($installationPath)
$installation=$installationText | ConvertFrom-Json
$currentSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
function PrincipalLabel([string]$Value) {
  try {
    $sid=if($Value -match '^S-1-'){ $Value }else{[Security.Principal.NTAccount]::new($Value).Translate([Security.Principal.SecurityIdentifier]).Value}
    if($sid -eq $currentSid){return 'current-user'}
    if($sid -eq 'S-1-5-18'){return 'SYSTEM'}
    if($sid -eq 'S-1-5-32-544'){return 'Administrators'}
    return 'sid-sha256:'+ (DigestText $sid)
  } catch { return 'unresolved-principal-sha256:'+(DigestText $Value) }
}
$roots=@('D:\codex-isolated',$stateRoot,'D:\codex-isolated\main-release-packages',$packetRoot,'D:\teruisi-runtime','D:\teruisi-runtime\teruisi-worker-sales','D:\teruisi-runtime\django-sales')
$aclRows=@(foreach($root in $roots){
  $acl=Get-Acl -LiteralPath $root
  if($acl.Access.Count -gt 128){throw 'ACL rule bound exceeded'}
  [pscustomobject]@{path=$root;owner=(PrincipalLabel ([string]$acl.Owner));protected=[bool]$acl.AreAccessRulesProtected;rules=@($acl.Access|ForEach-Object{
    [pscustomobject]@{principal=(PrincipalLabel ([string]$_.IdentityReference));rights=[string]$_.FileSystemRights;type=[string]$_.AccessControlType;inherited=[bool]$_.IsInherited;inheritance=[string]$_.InheritanceFlags;propagation=[string]$_.PropagationFlags}
  })}
})
$scheduler=New-Object -ComObject Schedule.Service
$scheduler.Connect()
$task=$scheduler.GetFolder('\').GetTask([string]$installation.preparationTask.name)
$definition=$task.Definition
$action=$definition.Actions.Item(1)
$spec=$installation.preparationTask.definition
$taskUser=[string]$definition.Principal.UserId
if($taskUser -notmatch '^S-1-'){$taskUser=[Security.Principal.NTAccount]::new($taskUser).Translate([Security.Principal.SecurityIdentifier]).Value}
$taskProjection=[pscustomobject]@{
  name=[string]$installation.preparationTask.name;state=[int]$task.State;instances=[int]$task.GetInstances(0).Count
  enabled=[bool]$definition.Settings.Enabled;triggers=[int]$definition.Triggers.Count;actions=[int]$definition.Actions.Count
  userMatchesInstalled=($taskUser -ceq [string]$spec.userId);logonType=[int]$definition.Principal.LogonType;runLevel=[int]$definition.Principal.RunLevel
  pathMatchesInstalled=([string]$action.Path -ceq [string]$spec.path);argumentsMatchInstalled=([string]$action.Arguments -ceq [string]$spec.arguments)
  workingDirectoryMatchesInstalled=([string]$action.WorkingDirectory -ceq [string]$spec.workingDirectory)
  allowDemandStart=[bool]$definition.Settings.AllowDemandStart;multipleInstances=[int]$definition.Settings.MultipleInstances
  restartCount=[int]$definition.Settings.RestartCount;startWhenAvailable=[bool]$definition.Settings.StartWhenAvailable;allowHardTerminate=[bool]$definition.Settings.AllowHardTerminate
}
if([IO.File]::ReadAllText($installationPath) -cne $installationText){throw 'Installation changed during observation'}
$result=[pscustomobject]@{
  version='s05d-retirement-native-metadata-v1';at=[DateTime]::UtcNow.ToString('o');readOnly=$true
  installation=[pscustomobject]@{path=$installationPath;textSha256=(DigestText $installationText);status=[string]$installation.status;installId=[string]$installation.installId;bundleSha256=[string]$installation.bundleSha256}
  lastBootUpTimeUtc=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')
  task=$taskProjection;acl=$aclRows
  limits=@('Fixed roots only; no recursive ACL traversal or handle census.','ACL projection is not an effective access token check.','Task state is an observation, not a persistent admission fence.','No task, service, process, runtime, registry, or queue mutations.')
}
$json=$result|ConvertTo-Json -Depth 7
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputFile),$json+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
[pscustomobject]@{roots=$aclRows.Count;taskState=$taskProjection.state;instances=$taskProjection.instances;writeDestination=[IO.Path]::GetFullPath($OutputFile)}|ConvertTo-Json -Compress
