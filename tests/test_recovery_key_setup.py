"""Exercise the Windows key setup primitives without opening UI or runtime."""
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/protected-postgres-recovery-key.ps1"


@unittest.skipUnless(os.name == "nt", "Windows setup primitives")
class RecoveryKeySetupTests(unittest.TestCase):
    def test_default_plan_is_read_only_and_configuration_requires_execute(self):
        result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive",
            "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-Action", "Plan"],
            capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertFalse(payload["databaseOrServiceChanges"])
        result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive",
            "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-Action", "Configure"],
            capture_output=True, timeout=30)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"Configure requires -Execute", result.stderr)

    def test_unicode_password_pipe_roundtrip_no_overwrite_and_wrong_password(self):
        def quote(value):
            return "'" + str(value).replace("'", "''") + "'"
        with tempfile.TemporaryDirectory(prefix="teruisi-recovery-setup-test-") as directory:
            command = f"""
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$source={quote(SCRIPT)}
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){{throw 'script parse failed'}}
$functions=$ast.FindAll({{param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('Invoke-KeyPython','Protect-KeyDirectory','Get-KeyFileSha','Assert-KeyDirectoryAcl','Protect-RecoveryPassword','Read-RecoveryPasswordBinding')}},$true)
. ([scriptblock]::Create(($functions | ForEach-Object {{$_.Extent.Text}}) -join "`n"))
$request=[pscustomobject]@{{Python={quote(sys.executable)}}}
$utf8=[Text.UTF8Encoding]::new($false)
$root={quote(directory)}
Protect-KeyDirectory $root
Assert-KeyDirectoryAcl $root
$public=Join-Path $root 'public.pem'
$private=Join-Path $root 'private.pem'
$syntheticPassword='synthetic-only-' + [char]0x6062 + [char]0x590D + '-password-123'
$created=Invoke-KeyPython @{{action='create';password=$syntheticPassword;publicPath=$public;privatePath=$private}}
$checked=Invoke-KeyPython @{{action='check';password=$syntheticPassword;publicPath=$public;privatePath=$private}}
if($created.recipientSha256 -cne $checked.recipientSha256){{throw 'key identity mismatch'}}
if(-not ([IO.File]::ReadAllText($private).StartsWith('-----BEGIN ENCRYPTED PRIVATE KEY-----'))){{throw 'private key not encrypted'}}
$before=Get-KeyFileSha $private
$rejected=$false
try{{Invoke-KeyPython @{{action='create';password=$syntheticPassword;publicPath=$public;privatePath=$private}}|Out-Null}}catch{{$rejected=$true}}
if(-not $rejected -or (Get-KeyFileSha $private) -cne $before){{throw 'existing key overwritten'}}
$rejected=$false
try{{Invoke-KeyPython @{{action='check';password='wrong-synthetic-password';publicPath=$public;privatePath=$private}}|Out-Null}}catch{{$rejected=$true}}
if(-not $rejected){{throw 'wrong password accepted'}}
$cipher=Protect-RecoveryPassword $syntheticPassword $created.recipientSha256 $root
if((Read-RecoveryPasswordBinding $cipher $created.recipientSha256 $root) -cne $syntheticPassword){{throw 'DPAPI roundtrip failed'}}
foreach($changed in @(@($created.recipientSha256,($root+'-other')),@(('a'*64),$root))){{
  $rejected=$false
  try{{Read-RecoveryPasswordBinding $cipher $changed[0] $changed[1]|Out-Null}}catch{{$rejected=$true}}
  if(-not $rejected){{throw 'DPAPI copied binding accepted'}}
}}
'synthetic key checks passed'
"""
            result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive",
                "-ExecutionPolicy", "Bypass", "-Command", command],
                capture_output=True, timeout=120)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(b"synthetic key checks passed", result.stdout)
            self.assertNotIn(b"synthetic-only", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
