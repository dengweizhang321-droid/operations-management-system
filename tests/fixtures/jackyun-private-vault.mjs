import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

// Synthetic credentials only. The native Known Folder boundary is replaced
// in a private test bundle; production has no environment/config path override.
export async function createPrivateJackyunVault(base, config) {
  const root = path.join(base, "TERUISI", "JackyunCredentials");
  await mkdir(root, { recursive: true });
  const script = String.raw`
$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security
$utf8=New-Object Text.UTF8Encoding($false,$true)
$reader=New-Object IO.StreamReader([Console]::OpenStandardInput(),$utf8,$false)
$r=$reader.ReadToEnd()|ConvertFrom-Json
$profile=[IO.Path]::GetFullPath($r.profile).TrimEnd('\').ToLowerInvariant()
$binding='TERUISI-JACKYUN:v1:'+$r.tenant+':'+$profile
$hasher=[Security.Cryptography.SHA256]::Create()
try {$key=([BitConverter]::ToString($hasher.ComputeHash($utf8.GetBytes($binding)))).Replace('-','').ToLowerInvariant()} finally {$hasher.Dispose()}
$acl=New-Object Security.AccessControl.DirectorySecurity
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
Set-Acl -LiteralPath $r.root -AclObject $acl
$plain=@{tenantId=$r.tenant;profile=$profile;username='fixture-user';password='fixture-only-password'}|ConvertTo-Json -Compress
$cipher=[Security.Cryptography.ProtectedData]::Protect($utf8.GetBytes($plain),$utf8.GetBytes($binding),[Security.Cryptography.DataProtectionScope]::CurrentUser)
$payload=@{version=1;binding=$key;ciphertext=[Convert]::ToBase64String($cipher)}|ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path $r.root ($key+'.json')),$payload,$utf8)
`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "psmodulepath"));
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    input: JSON.stringify({ root, tenant: config.tenantId, profile: config.profileDirectory }), env, windowsHide: true, timeout: 15000,
  });
  if (result.status !== 0) throw new Error("Synthetic DPAPI fixture creation failed");
  return root;
}

export function substituteKnownFolder(bundle) {
  const native = "[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)";
  if (bundle.split(native).length !== 2) throw new Error("Known Folder test seam is not unique");
  return bundle.replace(native, "[Environment]::GetEnvironmentVariable('TERUISI_TEST_KNOWN_FOLDER')");
}
