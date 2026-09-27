param([Parameter(Mandatory)][string]$OperatorPath,
  [Parameter(Mandatory)][string]$PayloadPath,
  [Parameter(Mandatory)][int]$ExpectedPort)
$ErrorActionPreference = 'Stop'
$env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY = '1'
. $OperatorPath -Action Status
$payload = Get-Content -Raw -LiteralPath $PayloadPath -Encoding UTF8 | ConvertFrom-Json
Assert-MaintenanceEvidence $payload.evidence 'teruisi_integration_role_probe' 'ai_rehearsal_admin' $ExpectedPort $true
Assert-MaintenanceNoKeyEvidence $payload.profileEvidence
$rejected = 0
foreach ($bad in @('protected_business_unknown', 'ai_unknown_table')) {
  $payload.evidence.tables | Add-Member -NotePropertyName $bad -NotePropertyValue 0
  try {
    $failed = $false
    try { Assert-MaintenanceEvidence $payload.evidence 'teruisi_integration_role_probe' 'ai_rehearsal_admin' $ExpectedPort $true }
    catch { $failed = $true; $rejected++ }
    if (-not $failed) { throw 'Unreviewed table accepted' }
  } finally { $payload.evidence.tables.PSObject.Properties.Remove($bad) }
}
$payload.profileEvidence.privateKeyRows = 1
try { Assert-MaintenanceNoKeyEvidence $payload.profileEvidence; throw 'Nonempty key table accepted' }
catch {
  if ($_.Exception.Message -eq 'Nonempty key table accepted') { throw }
  $rejected++
}
if ($rejected -ne 3) { throw 'Negative check count mismatch' }
@{status='passed'; negativeChecks=$rejected; productionWrites=$false} | ConvertTo-Json -Compress
