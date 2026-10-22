$ErrorActionPreference = 'Stop'
$taskTempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$taskPrivateRoot = Join-Path $taskTempBase ('s05d-handle-acl-' + [Guid]::NewGuid().ToString('N'))
$taskLeaf = Join-Path $taskPrivateRoot 'private.bin'
$taskStream = $null
$taskOriginalAcl = $null
$taskAclChanged = $false
$taskSucceeded = $false
$taskNewOpenDenied = $false
$taskOldHandleWrote = $false
$taskRestored = $false
$taskHash = [Security.Cryptography.SHA256]::Create()
function Get-TaskTextHash([string]$Value) {
  return ([BitConverter]::ToString($taskHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-', '').ToLowerInvariant()
}
try {
  if ([IO.Path]::GetDirectoryName($taskPrivateRoot) -ine $taskTempBase -or [IO.Path]::GetFileName($taskPrivateRoot) -notmatch '^s05d-handle-acl-[a-f0-9]{32}$') { throw 'Private temporary path check failed' }
  [void][IO.Directory]::CreateDirectory($taskPrivateRoot)
  [IO.File]::WriteAllBytes($taskLeaf, [byte[]]@())
  $taskOriginalAcl = Get-Acl -LiteralPath $taskLeaf
  $taskOriginalSddlHash = Get-TaskTextHash $taskOriginalAcl.Sddl
  $taskSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $taskStream = [IO.File]::Open($taskLeaf, [IO.FileMode]::Open, [IO.FileAccess]::Write, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
  $taskDenyAcl = Get-Acl -LiteralPath $taskLeaf
  $taskRights = [Security.AccessControl.FileSystemRights]::WriteData -bor [Security.AccessControl.FileSystemRights]::AppendData
  $taskDenyRule = [Security.AccessControl.FileSystemAccessRule]::new($taskSid, $taskRights, [Security.AccessControl.AccessControlType]::Deny)
  [void]$taskDenyAcl.AddAccessRule($taskDenyRule)
  Set-Acl -LiteralPath $taskLeaf -AclObject $taskDenyAcl
  $taskAclChanged = $true
  try {
    $taskNewStream = [IO.File]::Open($taskLeaf, [IO.FileMode]::Open, [IO.FileAccess]::Write, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    $taskNewStream.Dispose()
  } catch [UnauthorizedAccessException] { $taskNewOpenDenied = $true }
  $taskStream.WriteByte(65)
  $taskStream.Flush($true)
  $taskReadStream = [IO.File]::Open($taskLeaf, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
  try { $taskOldHandleWrote = $taskReadStream.ReadByte() -eq 65 } finally { $taskReadStream.Dispose() }
  if (-not $taskNewOpenDenied -or -not $taskOldHandleWrote) { throw 'Expected private DACL/open-handle counterexample was not observed' }
  $taskSucceeded = $true
} finally {
  if ($taskAclChanged) { Set-Acl -LiteralPath $taskLeaf -AclObject $taskOriginalAcl; $taskRestored = (Get-TaskTextHash (Get-Acl -LiteralPath $taskLeaf).Sddl) -ceq $taskOriginalSddlHash }
  if ($null -ne $taskStream) { $taskStream.Dispose() }
  if (Test-Path -LiteralPath $taskLeaf) { Remove-Item -LiteralPath $taskLeaf }
  if (Test-Path -LiteralPath $taskPrivateRoot) { Remove-Item -LiteralPath $taskPrivateRoot }
  $taskHash.Dispose()
}
if (-not $taskRestored) { throw 'Original private leaf DACL was not verified restored' }
@{
  version = 's05d-private-open-handle-acl-v1'
  passed = $taskSucceeded
  originalOpenHandleStillWrote = $taskOldHandleWrote
  newWriteHandleDenied = $taskNewOpenDenied
  originalLeafDaclRestored = $taskRestored
  privateDirectoryRemoved = -not (Test-Path -LiteralPath $taskPrivateRoot)
  productionAclChanged = $false
  scope = 'One generated private temporary leaf only; no parent, runtime, account, service or production control changed.'
} | ConvertTo-Json -Depth 3 -Compress
