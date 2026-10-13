param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputPath){throw 'Create-only system tool evidence'}
$systemTool='C:\Windows\System32\wsl.exe'
$cursor=$systemTool
while($cursor){$item=Get-Item -LiteralPath $cursor -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Redirected system tool path'};$parent=[IO.Path]::GetDirectoryName($cursor);if($parent -eq $cursor){break};$cursor=$parent}
$hold=[IO.File]::Open($systemTool,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try{
 $algorithm=[Security.Cryptography.SHA256]::Create()
 try{$digest=([BitConverter]::ToString($algorithm.ComputeHash($hold))).Replace('-','').ToLowerInvariant()}finally{$algorithm.Dispose()}
 $signature=Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $systemTool
 $result=[ordered]@{version='teruisi-system-wsl-identity-v1';path=$systemTool;sha256=$digest;signatureStatus=[string]$signature.Status;signerSubject=$signature.SignerCertificate.Subject;signerIssuer=$signature.SignerCertificate.Issuer;signerThumbprint=$signature.SignerCertificate.Thumbprint;owner=(Get-Acl -LiteralPath $systemTool).Owner;productionActionsRequested=0;scope='One exact Windows system executable hash/signature/owner under read sharing; no WSL command or service action. Not an application-artifact hardlink waiver.'}
 $json=$result|ConvertTo-Json
 $output=[IO.File]::Open($OutputPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
 try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes($json+[Environment]::NewLine);$output.Write($bytes,0,$bytes.Length)}finally{$output.Dispose()}
 $json
}finally{$hold.Dispose()}
