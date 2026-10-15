param([Parameter(Mandatory)][string]$OperatorPath,[Parameter(Mandatory)][string]$PayloadPath,[Parameter(Mandatory)][int]$ExpectedPort)
$ErrorActionPreference='Stop'
$env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY='1'
. $OperatorPath -Action Status
$payload=Get-Content -Raw -LiteralPath $PayloadPath -Encoding UTF8 | ConvertFrom-Json
Assert-MaintenanceNoKeyGeneration $payload.evidence | Out-Null
Assert-MaintenanceNoKeyEvidence $payload.profileEvidence
$original=$payload.evidence.migrations
$negatives=0
foreach($changed in @('unknown','duplicate','partial-audit')) {
  try {
    if($changed -ceq 'unknown'){$payload.evidence.migrations=@($original)+[pscustomobject]@{app='ai_assistant';name='0084_unknown'}}
    elseif($changed -ceq 'duplicate'){$payload.evidence.migrations=@($original)+@($original | Select-Object -First 1)}
    else {$payload.evidence.migrations=@($original | Where-Object {$_.app -cne 'sales' -or $_.name -cne '0011_jackyun_upload_audit_binding'})}
    $failed=$false
    try {Assert-MaintenanceNoKeyGeneration $payload.evidence | Out-Null}
    catch {$failed=$true;$negatives++}
    if(-not $failed){throw 'Unknown or partial migration catalogue accepted'}
  } finally {$payload.evidence.migrations=$original}
}
@{status='passed';generation=@($original).Count;negativeChecks=$negatives;productionTouched=$false} | ConvertTo-Json -Compress
