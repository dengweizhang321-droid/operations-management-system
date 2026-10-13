$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$source='D:\运营管理系统\tools\operations-system-control.ps1'
$expected='0e87b26637e4aac807580432025d6291bcf87ac26752eef96b784e420ac7a810'
$hold=[IO.File]::Open($source,'Open','Read','Read')
try {
 $reader=[IO.StreamReader]::new($hold,[Text.UTF8Encoding]::new($false,$true),$true,4096,$true)
 $raw=$reader.ReadToEnd();$reader.Dispose();$hold.Position=0
 $sha=[Security.Cryptography.SHA256]::Create();try{$actual=([BitConverter]::ToString($sha.ComputeHash($hold))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
 if($actual -cne $expected){throw 'Original controller source changed'}
 $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($raw,[ref]$tokens,[ref]$errors)
 if($errors.Count){throw 'Original source parse failed'}
 foreach($name in @('Get-BoundedText','Invoke-SystemHealthProbe','ConvertFrom-SystemHealthContent')) {
  $nodes=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true))
  if($nodes.Count -ne 1){throw 'Ambiguous original function'}
  . ([scriptblock]::Create($nodes[0].Extent.Text))
 }
 $results=@();foreach($entry in @(@('live','http://127.0.0.1:3000/_teruisi/local/health/live'),@('helper','http://127.0.0.1:5791/health'),@('ready','http://127.0.0.1:3000/_teruisi/local/health/ready'))) {
  $start=[DateTimeOffset]::UtcNow;$sw=[Diagnostics.Stopwatch]::StartNew();$probe=Invoke-SystemHealthProbe -Uri $entry[1];$payload=ConvertFrom-SystemHealthContent -Probe $probe;$sw.Stop()
  $fields=@{};foreach($key in @('ok','status','code')){if($null -ne $payload -and $null -ne $payload.PSObject.Properties[$key]){$fields[$key]=$payload.$key}}
  $results+=@{name=$entry[0];at=$start.ToString('o');elapsedMs=$sw.ElapsedMilliseconds;statusCode=$probe.StatusCode;payload=$fields;errorPresent=($null -ne $probe.Error)}
 }
 @{version='original-control-three-health-readonly-v1';at=[DateTimeOffset]::UtcNow.ToString('o');sourceSha256=$actual;probes=$results;originalStatusInvoked=$false;productionMutation=$false;historicalFailureExplained=$false}|ConvertTo-Json -Depth 6 -Compress
}finally{$hold.Dispose()}
