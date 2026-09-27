[CmdletBinding()]
param(
  [ValidateSet('Plan', 'Configure', 'Check')][string]$Action = 'Plan',
  [string]$Python = '',
  [string]$RuntimeRoot = 'D:\teruisi-runtime\protected-postgres',
  [string]$RecoveryDirectory = 'E:\TERUISI-Recovery-Key',
  [switch]$Execute
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$utf8 = [Text.UTF8Encoding]::new($false)
$request = [pscustomobject]@{ Action=$Action; Python=$Python; RuntimeRoot=$RuntimeRoot;
  RecoveryDirectory=$RecoveryDirectory; Execute=$Execute.IsPresent }

function Assert-KeyPath([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  if ($full -notmatch '^[A-Za-z]:\\') { throw 'Recovery paths must be absolute local paths' }
  $item = $full
  while ($item) {
    if (Test-Path -LiteralPath $item) {
      $entry = Get-Item -LiteralPath $item -Force
      if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Recovery paths must not contain reparse points'
      }
    }
    $item = Split-Path -Parent $item
  }
  return $full
}

function Get-KeyFileSha([string]$Path) {
  if ((Get-Item -LiteralPath $Path).Length -gt 16384) { throw 'Recovery key file is oversized' }
  $algorithm = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($Path)
  try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
  finally { $stream.Dispose(); $algorithm.Dispose() }
}

function Write-KeyBytesNew([string]$Path, [byte[]]$Bytes) {
  $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew,
    [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $stream.Write($Bytes,0,$Bytes.Length); $stream.Flush($true) }
  finally { $stream.Dispose() }
}

function Protect-KeyDirectory([string]$Path) {
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
  # Modify only the existing DACL. A brand-new security descriptor would also
  # request SACL writes and unnecessarily require SeSecurityPrivilege.
  $ownerAcl = Get-Acl -LiteralPath $Path
  if ($ownerAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $user.Value) {
    throw 'Key directory is not owned by the current operator'
  }
  $acl = [IO.Directory]::GetAccessControl($Path, [Security.AccessControl.AccessControlSections]::Access)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($old in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($old) }
  foreach ($sid in @($user,
      [Security.Principal.SecurityIdentifier]::new('S-1-5-18'),
      [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl',
      'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  [IO.Directory]::SetAccessControl($Path, $acl)
}

function Assert-KeyDirectoryAcl([string]$Path) {
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $acl = [IO.Directory]::GetAccessControl($Path)
  if (-not $acl.AreAccessRulesProtected -or
      $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $user) {
    throw 'Recovery key directory ownership or inheritance changed'
  }
  $allowed = @($user, 'S-1-5-18', 'S-1-5-32-544')
  foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if ($rule.IdentityReference.Value -notin $allowed -or $rule.IsInherited -or
        $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) {
      throw 'Recovery key directory access is wider than the operator allowlist'
    }
  }
}

function Protect-RecoveryPassword([string]$Password, [string]$Recipient, [string]$BindingRoot) {
  $bound = @{ version='teruisi-protected-recovery-key-v1'; runtimeRoot=$BindingRoot;
    recipientSha256=$Recipient; password=$Password } | ConvertTo-Json -Compress
  $secure = ConvertTo-SecureString $bound -AsPlainText -Force
  try { return ConvertFrom-SecureString $secure }
  finally { $secure.Dispose(); $bound=$null }
}

function Read-RecoveryPasswordBinding([string]$Ciphertext, [string]$Recipient, [string]$BindingRoot) {
  $secure = ConvertTo-SecureString $Ciphertext
  try {
    $bound = ([Management.Automation.PSCredential]::new('local',$secure)).GetNetworkCredential().Password | ConvertFrom-Json
    if (($bound.PSObject.Properties.Name | Sort-Object) -join ',' -cne
        'password,recipientSha256,runtimeRoot,version' -or
        $bound.version -cne 'teruisi-protected-recovery-key-v1' -or
        $bound.runtimeRoot -ine $BindingRoot -or $bound.recipientSha256 -cne $Recipient) {
      throw 'DPAPI recovery key binding differs'
    }
    return [string]$bound.password
  } finally { $secure.Dispose(); $bound=$null }
}

function Read-RecoveryPassword {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $dialog = [Windows.Forms.Form]::new()
  $dialog.Text = 'TERUISI 备份恢复密码'
  $dialog.StartPosition = 'CenterScreen'
  $dialog.Size = [Drawing.Size]::new(560, 310)
  $dialog.FormBorderStyle = 'FixedDialog'
  $dialog.MaximizeBox = $false
  $dialog.MinimizeBox = $false
  $label = [Windows.Forms.Label]::new()
  $label.Text = "设置一个你自己保管的恢复密码（至少 16 个字符）。`r`n换电脑恢复备份时需要它；不要把密码发到聊天。`r`n本窗口不会修改数据库、停止服务或发布应用。"
  $label.Location = [Drawing.Point]::new(20, 20)
  $label.Size = [Drawing.Size]::new(505, 70)
  $dialog.Controls.Add($label)
  $first = [Windows.Forms.TextBox]::new()
  $first.UseSystemPasswordChar = $true
  $first.Location = [Drawing.Point]::new(140, 100)
  $first.Size = [Drawing.Size]::new(365, 25)
  $second = [Windows.Forms.TextBox]::new()
  $second.UseSystemPasswordChar = $true
  $second.Location = [Drawing.Point]::new(140, 140)
  $second.Size = [Drawing.Size]::new(365, 25)
  foreach ($entry in @(@('恢复密码',100), @('再次输入',140))) {
    $caption = [Windows.Forms.Label]::new()
    $caption.Text = [string]$entry[0]
    $caption.Location = [Drawing.Point]::new(20, [int]$entry[1])
    $caption.Size = [Drawing.Size]::new(110, 25)
    $dialog.Controls.Add($caption)
  }
  $dialog.Controls.Add($first)
  $dialog.Controls.Add($second)
  $save = [Windows.Forms.Button]::new()
  $save.Text = '保存恢复钥匙'
  $save.Location = [Drawing.Point]::new(275, 195)
  $save.Size = [Drawing.Size]::new(115, 32)
  $cancel = [Windows.Forms.Button]::new()
  $cancel.Text = '稍后设置'
  $cancel.Location = [Drawing.Point]::new(400, 195)
  $cancel.Size = [Drawing.Size]::new(105, 32)
  $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
  $save.Add_Click({
    if ($first.Text -cne $second.Text -or $first.Text.Length -lt 16 -or
        [Text.Encoding]::UTF8.GetByteCount($first.Text) -gt 1024 -or
        @($first.Text.ToCharArray() | Select-Object -Unique).Count -lt 4) {
      [void][Windows.Forms.MessageBox]::Show('两次输入必须一致，至少 16 个字符，并避免重复的单一字符。')
      return
    }
    $dialog.DialogResult = [Windows.Forms.DialogResult]::OK
    $dialog.Close()
  })
  $dialog.Controls.Add($save)
  $dialog.Controls.Add($cancel)
  $dialog.AcceptButton = $save
  $dialog.CancelButton = $cancel
  try {
    if ($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { return $null }
    return $first.Text
  } finally {
    $first.Clear()
    $second.Clear()
    $dialog.Dispose()
  }
}

function Invoke-KeyPython([object]$Payload) {
  # The password goes through a private pipe, never argv, environment or logs.
  $code = @'
import hashlib,json,sys
from pathlib import Path
from cryptography.hazmat.primitives import serialization,hashes
from cryptography.hazmat.primitives.asymmetric import rsa,padding
try:
    raw=sys.stdin.buffer.read(16385)
    if len(raw)>16384: raise ValueError('oversized request')
    request=json.loads(raw)
    password=request['password'].encode('utf-8')
    if not 16<=len(password)<=1024: raise ValueError('invalid password length')
    public_path,private_path=Path(request['publicPath']),Path(request['privatePath'])
    if request['action']=='create':
        if public_path.exists() or private_path.exists(): raise ValueError('key already exists')
        private=rsa.generate_private_key(public_exponent=65537,key_size=3072)
        private_pem=private.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.BestAvailableEncryption(password))
        public_pem=private.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo)
        with private_path.open('xb') as stream: stream.write(private_pem)
        with public_path.open('xb') as stream: stream.write(public_pem)
    elif request['action']!='check': raise ValueError('invalid action')
    for path in (public_path,private_path):
        if path.is_symlink() or path.is_junction() or path.stat().st_nlink!=1 or path.stat().st_size>16384:
            raise ValueError('redirected or oversized key file')
    private=serialization.load_pem_private_key(private_path.read_bytes(),password=password)
    public=serialization.load_pem_public_key(public_path.read_bytes())
    if not isinstance(private,rsa.RSAPrivateKey) or private.key_size!=3072: raise ValueError('invalid private key')
    if private.public_key().public_numbers()!=public.public_numbers(): raise ValueError('public key mismatch')
    oaep=padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=b'teruisi-recovery-key-check-v1')
    probe=b'local-recovery-key-roundtrip-v1'
    if private.decrypt(public.encrypt(probe,oaep),oaep)!=probe: raise ValueError('roundtrip failed')
    der=public.public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)
    print(json.dumps({'status':'verified','recipientSha256':hashlib.sha256(der).hexdigest(),'publicFileSha256':hashlib.sha256(public_path.read_bytes()).hexdigest(),'privateFileSha256':hashlib.sha256(private_path.read_bytes()).hexdigest()}))
except Exception:
    print(json.dumps({'status':'failed','code':'recovery_key_operation_failed'}))
    sys.exit(1)
'@
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $request.Python
  $start.Arguments = '-I -B -c "' + $code.Replace('"','\"') + '"'
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.StandardOutputEncoding = $utf8
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $start
  try {
    [void]$process.Start()
    $inputBytes = $utf8.GetBytes(($Payload | ConvertTo-Json -Compress))
    try {
      $process.StandardInput.BaseStream.Write($inputBytes, 0, $inputBytes.Length)
      $process.StandardInput.BaseStream.Flush()
      $process.StandardInput.BaseStream.Close()
    } finally { [Array]::Clear($inputBytes, 0, $inputBytes.Length) }
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(60000)) { $process.Kill(); throw 'Recovery key check timed out' }
    $output = $stdout.GetAwaiter().GetResult()
    [void]$stderr.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0 -or $output.Length -gt 4096) { throw 'Recovery key operation failed' }
    $result = $output | ConvertFrom-Json
    if ($result.status -cne 'verified' -or $result.recipientSha256 -cnotmatch '^[0-9a-f]{64}$') {
      throw 'Recovery key result invalid'
    }
    return $result
  } finally { $process.Dispose() }
}

$runtime = Assert-KeyPath $request.RuntimeRoot
$recovery = Assert-KeyPath $request.RecoveryDirectory
if ($runtime -ine 'D:\teruisi-runtime\protected-postgres' -or
    $recovery -notmatch '^E:\\[^\\]') { throw 'Recovery setup requires the fixed runtime and a separate E drive directory' }
$config = Join-Path $runtime 'recovery-key.json'
$secretPath = Join-Path $runtime 'recovery-password.dpapi'
$publicPath = Join-Path $runtime 'recovery-public.pem'
$privatePath = Join-Path $runtime 'recovery-private.encrypted.pem'
if ($request.Action -ceq 'Plan') {
  [pscustomobject]@{ status='planned'; configured=(Test-Path -LiteralPath $config);
    runtimeRoot=$runtime; recoveryDirectory=$recovery; interactivePasswordRequired=$true;
    databaseOrServiceChanges=$false } | ConvertTo-Json -Compress
  exit 0
}
if (-not $request.Python) { $request.Python = 'D:\teruisi-runtime\django-sales\venv\Scripts\python.exe' }
if (-not (Test-Path -LiteralPath $request.Python -PathType Leaf)) { throw 'Controlled Python runtime missing' }
$password = $null
try {
  if ($request.Action -ceq 'Configure') {
    if (-not $request.Execute) { throw 'Configure requires -Execute' }
    foreach ($path in @($runtime,$recovery)) {
      if (Test-Path -LiteralPath $path) { throw 'Refusing to replace an existing key directory' }
    }
    $password = Read-RecoveryPassword
    if ($null -eq $password) { '{"status":"cancelled","databaseOrServiceChanges":false}'; exit 0 }
    New-Item -ItemType Directory -Path $runtime | Out-Null
    Protect-KeyDirectory $runtime
    New-Item -ItemType Directory -Path $recovery | Out-Null
    Protect-KeyDirectory $recovery
    $offlinePublic = Join-Path $recovery 'recovery-public.pem'
    $offlinePrivate = Join-Path $recovery 'recovery-private.encrypted.pem'
    $verified = Invoke-KeyPython @{action='create';password=$password;
      publicPath=$offlinePublic;privatePath=$offlinePrivate}
    Write-KeyBytesNew $publicPath ([IO.File]::ReadAllBytes($offlinePublic))
    Write-KeyBytesNew $privatePath ([IO.File]::ReadAllBytes($offlinePrivate))
    $metadata = [ordered]@{ version='teruisi-protected-recovery-key-v1'; runtimeRoot=$runtime;
      recipientSha256=$verified.recipientSha256; publicFileSha256=$verified.publicFileSha256;
      privateFileSha256=$verified.privateFileSha256; recoveryDirectory=$recovery }
    Write-KeyBytesNew $secretPath ($utf8.GetBytes(
      (Protect-RecoveryPassword $password $verified.recipientSha256 $runtime)))
    Write-KeyBytesNew $config ($utf8.GetBytes(($metadata | ConvertTo-Json -Compress)))
    Write-KeyBytesNew (Join-Path $recovery 'recovery-key.json') ($utf8.GetBytes(($metadata | ConvertTo-Json -Compress)))
  }
  Assert-KeyDirectoryAcl $runtime
  if ((Get-Item -LiteralPath $config).Length -gt 8192 -or
      (Get-Item -LiteralPath $secretPath).Length -gt 16384) { throw 'Recovery key configuration is oversized' }
  $metadata = Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
  if ((($metadata.PSObject.Properties.Name | Sort-Object) -join ',') -cne
      'privateFileSha256,publicFileSha256,recipientSha256,recoveryDirectory,runtimeRoot,version' -or
      $metadata.version -cne 'teruisi-protected-recovery-key-v1' -or
      $metadata.runtimeRoot -ine $runtime) { throw 'Recovery key binding invalid' }
  foreach ($value in @($metadata.recipientSha256,$metadata.publicFileSha256,$metadata.privateFileSha256)) {
    if ($value -isnot [string] -or $value -cnotmatch '^[0-9a-f]{64}$') { throw 'Recovery key digest invalid' }
  }
  foreach ($pair in @(@($publicPath,$metadata.publicFileSha256), @($privatePath,$metadata.privateFileSha256))) {
    if ((Get-KeyFileSha $pair[0]) -cne $pair[1]) {
      throw 'Recovery key file changed'
    }
  }
  $password = Read-RecoveryPasswordBinding ([IO.File]::ReadAllText($secretPath)) $metadata.recipientSha256 $runtime
    $verified = Invoke-KeyPython @{action='check';password=$password;publicPath=$publicPath;privatePath=$privatePath}
    if ($verified.recipientSha256 -cne $metadata.recipientSha256) { throw 'Recovery public identity changed' }
    [pscustomobject]@{ status='ready';recipientSha256=$verified.recipientSha256;
      recoveryDirectory=$recovery;passwordShared=$false;databaseOrServiceChanges=$false } | ConvertTo-Json -Compress
} finally { $password=$null }
