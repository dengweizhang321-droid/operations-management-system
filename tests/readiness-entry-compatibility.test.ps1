[CmdletBinding()]
param([switch]$ParseOnly)
$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
foreach($relative in @('tools/operations-system-control.ps1','tools/operations-system-watchdog.ps1','tools/django-local-service.ps1')){
  $file=Join-Path $workspace $relative
  $bytes=[IO.File]::ReadAllBytes($file)
  if($bytes.Length -lt 3 -or $bytes[0] -ne 239 -or $bytes[1] -ne 187 -or $bytes[2] -ne 191){throw "Missing UTF8 BOM: $relative"}
  $parseErrors=$null
  [void][Management.Automation.Language.Parser]::ParseFile($file,[ref]$null,[ref]$parseErrors)
  if($parseErrors.Count){throw "PowerShell parse failed: $relative"}
}
if($ParseOnly){Write-Output 'PASS: readiness PS entry syntax and UTF8 BOM; no code executed';return}
$root=Join-Path ([IO.Path]::GetTempPath()) ('readiness-entry-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
try{
  $executable=Join-Path $root 'Launcher.exe'
  $compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  $source=(Resolve-Path -LiteralPath (Join-Path $workspace 'tools/desktop-launcher/Launcher.cs')).Path
  & $compiler /nologo /target:winexe /platform:anycpu /optimize+ "/out:$executable" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Net.Http.dll /reference:System.Runtime.Serialization.dll $source
  if($LASTEXITCODE -ne 0){throw 'Isolated launcher compilation failed'}
  # Run the existing real argument/receipt boundary in another process so its
  # loaded executable is released before this private compilation is removed.
  & (Get-Command pwsh.exe -ErrorAction Stop).Source -NoProfile -NonInteractive -File (Join-Path $workspace 'tests/desktop-launcher.test.ps1') -Executable $executable
  if($LASTEXITCODE -ne 0){throw 'Isolated launcher entry check failed'}
  Write-Output 'PASS: readiness PS syntax/BOM, private launcher compile and fake-controller entry; no server or installer'
}finally{
  $canonical=[IO.Path]::GetFullPath($root)
  if(-not $canonical.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $canonical -Leaf) -notmatch '^readiness-entry-[0-9a-f]{32}$'){throw 'Unsafe private entry cleanup'}
  if(Test-Path -LiteralPath $canonical){Remove-Item -LiteralPath $canonical -Recurse -Force}
}
