$ErrorActionPreference='Stop'
# Fixture test for Assert-DingTalkScreenshotProfile: the three required ACEs stay mandatory,
# and only read/execute-only Allow ACEs for AppContainer SIDs (S-1-15-2-*) are tolerated.
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\tools\django-ai.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'AI controller parse failure'}
foreach($name in @('Assert-DingTalkScreenshotProfile','Test-AppContainerReadOnlyAce')) {
  $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
  if($null -eq $fn){throw "Missing function $name"}
  . ([scriptblock]::Create($fn.Extent.Text))
}

$RuntimeRoot='C:\fixture\teruisi-runtime'
$DingTalkScreenshotRoot="$RuntimeRoot-screenshot-profile"
$DingTalkScreenshotProfile=Join-Path $DingTalkScreenshotRoot 'Chrome'
$FSR=[Security.AccessControl.FileSystemRights]
$full=[int]$FSR::FullControl
$readExec=[int]($FSR::ReadAndExecute -bor $FSR::Synchronize)
$sidSystem='S-1-5-18';$sidAdmins='S-1-5-32-544'
$sidUser=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$sidApp='S-1-15-2-1111111111-2222222222-3333333333-4044444444-1555555555-2666666666-3777777777'
$sidOther='S-1-5-32-545'
$script:events=@()
function Write-LauncherEvent([string]$Level,[string]$Event,[string]$Message='') { $script:events += "$Level|$Event|$Message" }
function Write-Host { }
function Get-Item { param([string]$LiteralPath,[switch]$Force) [pscustomobject]@{PSIsContainer=$true;Attributes=[IO.FileAttributes]::Directory} }
function New-Rule([string]$Sid,[int]$Rights,[bool]$Inherited,[string]$Type='Allow') {
  [pscustomobject]@{
    IdentityReference=[Security.Principal.SecurityIdentifier]::new($Sid)
    FileSystemRights=[Enum]::ToObject([Security.AccessControl.FileSystemRights],[int]$Rights)
    AccessControlType=[Security.AccessControl.AccessControlType]$Type
    IsInherited=$Inherited
  }
}
function Base-Rules([bool]$Root) { @((New-Rule $sidSystem $full (-not $Root)),(New-Rule $sidAdmins $full (-not $Root)),(New-Rule $sidUser $full (-not $Root))) }
$script:acls=@{}
function Get-Acl { param([string]$LiteralPath) $script:acls[$LiteralPath] }
function Set-Fixture([object[]]$RootExtra=@(),[object[]]$ChromeExtra=@(),[object[]]$RootRules=$null,[object[]]$ChromeRules=$null) {
  if($null -eq $RootRules){$RootRules=Base-Rules $true}
  if($null -eq $ChromeRules){$ChromeRules=Base-Rules $false}
  $script:events=@()
  $script:acls=@{
    $DingTalkScreenshotRoot=[pscustomobject]@{AreAccessRulesProtected=$true;Access=@($RootRules)+@($RootExtra)}
    $DingTalkScreenshotProfile=[pscustomobject]@{AreAccessRulesProtected=$false;Access=@($ChromeRules)+@($ChromeExtra)}
  }
}
function Expect-Pass([string]$Name,[scriptblock]$Setup,[bool]$ExpectNote) {
  & $Setup
  try { Assert-DingTalkScreenshotProfile } catch { throw "$Name should pass but threw: $($_.Exception.Message)" }
  $noted=@($script:events|Where-Object{$_ -like 'WARN|dingtalk_screenshot_acl_appcontainer_readonly_tolerated|*'}).Count -gt 0
  if($noted -ne $ExpectNote){throw "$Name tolerance note mismatch: expected=$ExpectNote actual=$noted"}
  if($ExpectNote -and -not (($script:events -join "`n").Contains('=S-1-15-2-'))){throw "$Name note does not list the tolerated SID"}
  "PASS: $Name"
}
function Expect-Reject([string]$Name,[scriptblock]$Setup) {
  & $Setup
  $threw=$false
  try { Assert-DingTalkScreenshotProfile } catch { $threw=$true }
  if(-not $threw){throw "$Name should be rejected"}
  if(@($script:events|Where-Object{$_ -like '*tolerated*'}).Count -gt 0){throw "$Name logged a tolerance note despite rejection"}
  "PASS: $Name rejected"
}

Expect-Pass 'three required ACEs' { Set-Fixture } $false
Expect-Pass 'AppContainer read-only on root and Chrome (explicit)' {
  Set-Fixture -RootExtra @(New-Rule $sidApp $readExec $false) -ChromeExtra @(New-Rule $sidApp $readExec $false)
} $true
Expect-Pass 'AppContainer read-only on root only' { Set-Fixture -RootExtra @(New-Rule $sidApp $readExec $false) } $true
Expect-Pass 'AppContainer read-only inherited on Chrome' {
  Set-Fixture -RootExtra @(New-Rule $sidApp $readExec $false) -ChromeExtra @(New-Rule $sidApp $readExec $true)
} $true
Expect-Pass 'eight AppContainer SIDs read-only' {
  $extra=1..8|ForEach-Object{New-Rule ("S-1-15-2-$_-2-3-4-5-6-7") $readExec $false}
  Set-Fixture -RootExtra $extra
} $true

# Every single write/delete/permission/owner bit on an AppContainer ACE must be rejected.
foreach($bit in @('WriteData','AppendData','WriteExtendedAttributes','WriteAttributes','Delete','DeleteSubdirectoriesAndFiles','ChangePermissions','TakeOwnership','FullControl','Modify')) {
  $rights=$readExec -bor [int]$FSR::$bit
  Expect-Reject "AppContainer read + $bit" ({ Set-Fixture -RootExtra @(New-Rule $sidApp $rights $false) }).GetNewClosure()
}
Expect-Reject 'AppContainer GenericRead bit (unknown/generic mask)' { Set-Fixture -RootExtra @(New-Rule $sidApp ([int]0x80000000) $false) }
Expect-Reject 'AppContainer zero rights' { Set-Fixture -RootExtra @(New-Rule $sidApp 0 $false) }
Expect-Reject 'AppContainer Deny read-only' { Set-Fixture -RootExtra @(New-Rule $sidApp $readExec $false 'Deny') }
Expect-Reject 'non-AppContainer read-only' { Set-Fixture -RootExtra @(New-Rule $sidOther $readExec $false) }
Expect-Reject 'AppContainer on Chrome with write bit' {
  Set-Fixture -RootExtra @(New-Rule $sidApp $readExec $false) -ChromeExtra @(New-Rule $sidApp ($readExec -bor [int]$FSR::WriteData) $true)
}
Expect-Reject 'missing required ACE (root)' {
  Set-Fixture -RootRules @((New-Rule $sidSystem $full $false),(New-Rule $sidAdmins $full $false)) -RootExtra @(New-Rule $sidApp $readExec $false)
}
Expect-Reject 'missing required ACE (Chrome), padded with AppContainer' {
  Set-Fixture -ChromeRules @((New-Rule $sidSystem $full $true),(New-Rule $sidAdmins $full $true)) -ChromeExtra @(New-Rule $sidApp $readExec $true)
}
Expect-Reject 'required ACE downgraded to read-only' {
  Set-Fixture -RootRules @((New-Rule $sidSystem $full $false),(New-Rule $sidAdmins $full $false),(New-Rule $sidUser $readExec $false))
}
Expect-Reject 'required ACE duplicated' {
  Set-Fixture -RootRules @((New-Rule $sidSystem $full $false),(New-Rule $sidSystem $full $false),(New-Rule $sidUser $full $false))
}
Expect-Reject 'unprotected root' {
  Set-Fixture; $script:acls[$DingTalkScreenshotRoot].AreAccessRulesProtected=$false
}
Expect-Reject 'protected Chrome' {
  Set-Fixture; $script:acls[$DingTalkScreenshotProfile].AreAccessRulesProtected=$true
}
Expect-Reject 'root required ACE inherited' {
  Set-Fixture -RootRules (Base-Rules $false)
}
'PASS: DingTalk screenshot ACL tolerance matrix'
