param([string]$TemporaryPath, [string]$TargetPath, [string]$CreateOnly, [string]$FenceBase64)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$ownerStream = $null
$parentProcess = $null
try {
  if ($CreateOnly -cne "true" -and $CreateOnly -cne "false") { throw "invalid_create_only" }
  $temporary = [IO.Path]::GetFullPath($TemporaryPath)
  $target = [IO.Path]::GetFullPath($TargetPath)
  if ([IO.Path]::GetDirectoryName($temporary) -ine [IO.Path]::GetDirectoryName($target) -or -not $temporary.StartsWith($target + ".", [StringComparison]::OrdinalIgnoreCase) -or -not $temporary.EndsWith(".tmp")) { throw "invalid_temp_binding" }
  $fenceRaw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($FenceBase64))
  if ($fenceRaw -cne "null") {
    if (-not $fenceRaw.TrimStart().StartsWith("{")) { throw "invalid_fence_container" }
    $fence = ConvertFrom-Json $fenceRaw
    if ($fence -isnot [Management.Automation.PSCustomObject] -or $fence.version -isnot [int] -or $fence.version -ne 2 -or $fence.pid -isnot [int] -or $fence.pid -le 0 -or $fence.ownerToken -isnot [string] -or $fence.processIdentity -isnot [string] -or
        $fence.runId -isnot [string] -or $fence.purpose -isnot [string] -or $fence.lockDirectory -isnot [string] -or $fence.ownerToken -notmatch '^[a-f0-9-]{36}$' -or $fence.processIdentity -notmatch '^win32:[0-9]+$') { throw "unverified_publication_fence" }
    $ownerFile = Join-Path $fence.lockDirectory "owner.json"
    # Deny writes and delete/rename while the publication child holds the owner
    # object. A dead parent cannot be overtaken until this child leaves the
    # publication critical section; no late child can overwrite the next owner.
    $ownerStream = New-Object IO.FileStream($ownerFile, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    if ($ownerStream.Length -gt 8192) { throw "owner_size" }
    $reader = New-Object IO.StreamReader($ownerStream, (New-Object Text.UTF8Encoding($false, $true)), $false, 1024, $true)
    $ownerRaw = $reader.ReadToEnd(); $reader.Dispose()
    if (-not $ownerRaw.TrimStart().StartsWith("{")) { throw "invalid_owner_container" }
    $owner = ConvertFrom-Json $ownerRaw
    if ($owner -isnot [Management.Automation.PSCustomObject] -or $owner.version -isnot [int] -or $owner.pid -isnot [int] -or $owner.ownerToken -isnot [string] -or $owner.processIdentity -isnot [string] -or $owner.runId -isnot [string] -or $owner.purpose -isnot [string] -or
        $owner.version -ne 2 -or $owner.pid -ne $fence.pid -or $owner.ownerToken -cne $fence.ownerToken -or $owner.processIdentity -cne $fence.processIdentity -or $owner.runId -cne $fence.runId -or $owner.purpose -cne $fence.purpose) { throw "owner_changed" }
    $parentProcess = Get-Process -Id $fence.pid -ErrorAction Stop
    $heldHandle = $parentProcess.Handle
    $birth = "win32:" + $parentProcess.StartTime.ToUniversalTime().ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture)
    if ($birth -cne $fence.processIdentity -or $parentProcess.HasExited) { throw "parent_identity_changed" }
  }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class JackyunAtomicJson {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool MoveFileExW(string source, string destination, uint flags);
}
'@
  if ($null -ne $parentProcess -and $parentProcess.HasExited) { throw "parent_exited_before_publish" }
  [uint32]$flags = 8
  if ($CreateOnly -ceq "false") { $flags = $flags -bor 1 }
  # Same-directory move, no COPY_ALLOWED. WRITE_THROUGH completes the OS move
  # before returning; REPLACE_EXISTING is used only for an update, never claim.
  if (-not [JackyunAtomicJson]::MoveFileExW(('\\?\' + $temporary), ('\\?\' + $target), $flags)) { throw ("move_failed_" + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
  [Console]::WriteLine('{"published":true,"version":"jackyun-atomic-json-win32-v1"}')
} catch {
  [Console]::Error.WriteLine("atomic_json_publish_failed")
  exit 1
} finally {
  if ($null -ne $ownerStream) { $ownerStream.Dispose() }
  if ($null -ne $parentProcess) { $parentProcess.Dispose() }
}
