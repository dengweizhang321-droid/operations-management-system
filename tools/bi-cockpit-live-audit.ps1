[CmdletBinding()]
param([ValidateSet('sales','operations','inventory','flow')][string]$Source='sales', [string]$Query='range=month')
$ErrorActionPreference='Stop'
$biRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$biBranch=(& git -C $biRoot branch --show-current).Trim()
if (-not $biBranch.StartsWith('codex/') -or $biRoot -ieq 'D:\运营管理系统') { throw 'Audit only runs in an isolated worktree' }
# Establish the existing app principal and data cutoff through public read APIs.
$biActor=(Invoke-RestMethod 'http://127.0.0.1:3000/api/auth/me' -TimeoutSec 12).user
if ($biActor.scopeRestricted -ne $false -or $biActor.role -notin @('admin','operator','analyst','viewer')) { throw 'No verified unrestricted principal' }
$biFresh=Invoke-RestMethod 'http://127.0.0.1:3000/api/sales/data-health' -TimeoutSec 12
$biFolder=Join-Path $biRoot '.runtime\bi-live-audit'
if (-not (Test-Path -LiteralPath $biFolder)) { New-Item -ItemType Directory -Path $biFolder | Out-Null }
$biAcl=[Security.AccessControl.DirectorySecurity]::new()
$biAcl.SetAccessRuleProtection($true,$false)
$biAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.WindowsIdentity]::GetCurrent().User,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
$biAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-18'),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
if([IO.Directory].GetMethods().Name -contains 'SetAccessControl'){[IO.Directory]::SetAccessControl($biFolder,$biAcl)}else{[IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($biFolder),$biAcl)}
$biId=[Guid]::NewGuid().ToString('N')
$biOutput=Join-Path $biFolder "$Source-$biId.json"
$biSaved=@{}
$biNames=@('TERUISI_DJANGO_DATABASE_URL','DJANGO_SECRET_KEY','DJANGO_DEBUG','DJANGO_ALLOWED_HOSTS','TERUISI_DJANGO_INTERNAL_SECRET','TERUISI_DJANGO_ENVIRONMENT','TERUISI_DJANGO_PROCESS_ROLE','TERUISI_DJANGO_EXPECT_READ_ONLY','TERUISI_DJANGO_SALES_READER_BASE_URL','TERUISI_DJANGO_FINANCE_READER_BASE_URL','TERUISI_DJANGO_WORKFLOW_READER_BASE_URL','TERUISI_DJANGO_INVENTORY_READER_BASE_URL','TERUISI_DJANGO_NETSHOP_READER_BASE_URL','TERUISI_BI_AUDIT_PRINCIPAL','TERUISI_BI_AUDIT_QUERY','PYTHONUTF8','PYTHONDONTWRITEBYTECODE','TERUISI_DJANGO_DB_CONN_MAX_AGE')
foreach($biName in $biNames){$biSaved[$biName]=[Environment]::GetEnvironmentVariable($biName,'Process')}
function Read-BiAuditProtected([object]$Payload,[string]$Field){ $biSecure=ConvertTo-SecureString ([string]$Payload.$Field); ([Management.Automation.PSCredential]::new('local',$biSecure)).GetNetworkCredential().Password }
try {
  $biDomain=@{sales='Bi';operations='Workflow';inventory='Inventory';flow='Netshop'}[$Source]
  $biVault=Get-Content -LiteralPath ("D:\teruisi-runtime\django-sales\secrets\"+$biDomain.ToLower()+"-credentials.dpapi.json") -Raw | ConvertFrom-Json
  $biBase=Get-Content -LiteralPath 'D:\teruisi-runtime\django-sales\secrets\credentials.dpapi.json' -Raw | ConvertFrom-Json
  $biPassword=Read-BiAuditProtected $biVault ("database"+$biDomain+"Reader")
  $biRole='teruisi_'+$biDomain.ToLower()+'_reader'
  $env:TERUISI_DJANGO_DATABASE_URL="postgresql://${biRole}:$([Uri]::EscapeDataString($biPassword))@127.0.0.1:5432/teruisi_sales?sslmode=disable&connect_timeout=5&application_name=bi_readonly_candidate_audit"
  $env:DJANGO_SECRET_KEY=Read-BiAuditProtected $biBase 'djangoSecretKey'
  $env:TERUISI_DJANGO_INTERNAL_SECRET=Read-BiAuditProtected $biBase 'internalSecret'
  $env:TERUISI_DJANGO_ENVIRONMENT='production';$env:TERUISI_DJANGO_PROCESS_ROLE=$biDomain.ToLower()+'_reader';$env:TERUISI_DJANGO_EXPECT_READ_ONLY='true';$env:DJANGO_DEBUG='false';$env:DJANGO_ALLOWED_HOSTS='127.0.0.1,localhost';$env:TERUISI_DJANGO_DB_CONN_MAX_AGE='0'
  $env:TERUISI_DJANGO_SALES_READER_BASE_URL='http://127.0.0.1:8001';$env:TERUISI_DJANGO_FINANCE_READER_BASE_URL='http://127.0.0.1:8011';$env:TERUISI_DJANGO_WORKFLOW_READER_BASE_URL='http://127.0.0.1:8061';$env:TERUISI_DJANGO_INVENTORY_READER_BASE_URL='http://127.0.0.1:8051';$env:TERUISI_DJANGO_NETSHOP_READER_BASE_URL='http://127.0.0.1:8021'
  $env:TERUISI_BI_AUDIT_PRINCIPAL=$biActor | ConvertTo-Json -Compress;$env:TERUISI_BI_AUDIT_QUERY=$Query;$env:PYTHONUTF8='1';$env:PYTHONDONTWRITEBYTECODE='1'
  & 'D:\teruisi-runtime\django-sales\venv\Scripts\python.exe' (Join-Path $biRoot 'tools\bi-cockpit-live-audit.py') $Source $biOutput
  if($LASTEXITCODE -ne 0){throw "Read-only candidate audit failed for $Source"}
  $biCurrent=(Invoke-RestMethod 'http://127.0.0.1:3000/api/auth/me' -TimeoutSec 12).user
  if(($biActor | ConvertTo-Json -Compress) -cne ($biCurrent | ConvertTo-Json -Compress)){throw 'Principal changed during audit'}
  [ordered]@{source=$Source;output=$biOutput;freshness=$biFresh;query=$Query;readOnly=$true} | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $biFolder "$Source-$biId.evidence.json") -Encoding utf8
  Write-Output "Captured readonly aggregate: $biOutput"
} finally {foreach($biName in $biNames){if($null -eq $biSaved[$biName]){Remove-Item -LiteralPath ("Env:"+$biName) -ErrorAction SilentlyContinue}else{[Environment]::SetEnvironmentVariable($biName,$biSaved[$biName],'Process')}};$biPassword=$null;$biVault=$null;$biBase=$null}
