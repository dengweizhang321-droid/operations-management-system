$ErrorActionPreference='Stop'
$root='E:\codex-artifacts\release-site-blockers-20261011'
$destination=Join-Path $root 'PS5_REVIEW_ARGV_TRANSPORT_V1.json'
if(Test-Path -LiteralPath $destination){throw 'Evidence is create-only'}
$prompt=[IO.File]::ReadAllText((Join-Path $root 'SITE_AGY3_PROMPT.txt'),[Text.Encoding]::UTF8)
$output=& 'C:\Program Files\nodejs\node.exe' (Join-Path $PSScriptRoot 'check-review-argv.mjs') $prompt
[IO.File]::WriteAllText($destination,[string]$output+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
$output
exit $LASTEXITCODE
