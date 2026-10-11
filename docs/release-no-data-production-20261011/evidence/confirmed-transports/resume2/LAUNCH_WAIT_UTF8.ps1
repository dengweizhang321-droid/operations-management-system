$ErrorActionPreference='Stop'
$taskBoot='E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/resume2/WAIT_BOOTSTRAP.ps1'
$taskFile=[IO.File]::Open($taskBoot,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try {
  $taskSha=[Security.Cryptography.SHA256]::Create()
  try {$taskHash=([BitConverter]::ToString($taskSha.ComputeHash($taskFile))).Replace('-','').ToLowerInvariant()} finally {$taskSha.Dispose()}
  if($taskHash -cne '27631c8004159860418c424bf9d642015e8f8090b0c3cf7da1329395f707217a'){throw 'Frozen wait bootstrap changed'}
  $taskFile.Position=0
  $taskReader=[IO.StreamReader]::new($taskFile,[Text.UTF8Encoding]::new($false,$true))
  & ([ScriptBlock]::Create($taskReader.ReadToEnd()))
} finally {$taskFile.Dispose()}
