param([Parameter(Mandatory=$true)][string[]]$Names,[Parameter(Mandatory=$true)][string]$ReceiptName)
$ErrorActionPreference='Stop'
if($ReceiptName -notmatch '^[A-Za-z0-9-]+$'){throw 'invalid receipt name'}
$root='D:\codex-isolated\ai-functional-20261108'
$source='D:\.codex\worktrees\bd66\运营管理系统\tests\'
$records=Get-Content -LiteralPath "$root\processes.json" -Raw | ConvertFrom-Json
$results=@()
foreach($name in $Names){
  $r=@($records | Where-Object name -eq $name)
  if($r.Count -ne 1){throw "ambiguous process receipt: $name"}
  $r=$r[0]
  $p=Get-CimInstance Win32_Process -Filter "ProcessId = $($r.pid)"
  if(-not $p){$results+=@{name=$name;state='already_absent';pid=[int]$r.pid};continue}
  $expected=[DateTimeOffset]::FromUnixTimeMilliseconds([long]([double]$r.startedAt*1000))
  if([Math]::Abs(($p.CreationDate.ToUniversalTime()-$expected.UtcDateTime).TotalSeconds) -gt 2){throw 'process creation identity mismatch'}
  if(-not $p.CommandLine.Contains([string]$r.args[1]) -or -not ([string]$r.args[1]).StartsWith($source)){throw 'process command identity mismatch'}
  $children=@(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($p.ProcessId)")
  foreach($child in $children){
    if($child.Name -eq 'conhost.exe'){continue}
    $pythonChild=$child.Name -eq 'python.exe' -and $child.CommandLine.Contains([string]$r.args[1])
    $edgeChild=$name -eq 'edge' -and $child.ExecutablePath -in @('D:\.codex\worktrees\2949\运营管理系统\node_modules\@esbuild\win32-x64\esbuild.exe','D:\.codex\worktrees\2949\运营管理系统\node_modules\@cloudflare\workerd-windows-64\bin\workerd.exe')
    if(-not ($pythonChild -or $edgeChild)){throw 'unexpected child; no termination'}
    if($child.CreationDate -lt $p.CreationDate){throw 'child identity reused'}
    $again=Get-CimInstance Win32_Process -Filter "ProcessId = $($child.ProcessId)"
    if($again.CreationDate -ne $child.CreationDate -or $again.CommandLine -ne $child.CommandLine){throw 'child identity changed'}
    Stop-Process -Id $child.ProcessId -ErrorAction Stop
  }
  $again=Get-CimInstance Win32_Process -Filter "ProcessId = $($p.ProcessId)"
  if($again){
    if($again.CreationDate -ne $p.CreationDate -or $again.CommandLine -ne $p.CommandLine){throw 'parent identity changed'}
    Stop-Process -Id $p.ProcessId -ErrorAction Stop
  }
  $results+=@{name=$name;state='stopped_exact_test_process';pid=[int]$p.ProcessId;createdAt=$p.CreationDate.ToUniversalTime().ToString('o')}
}
$path="D:\codex-artifacts\ai-isolated-functional-20261108\$ReceiptName.json"
if(Test-Path -LiteralPath $path){throw 'receipt already exists'}
$results | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $path -Encoding utf8
$results | ConvertTo-Json -Depth 3
