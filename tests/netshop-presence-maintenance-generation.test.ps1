param([Parameter(Mandatory)][string]$OperatorPath,[Parameter(Mandatory)][string]$Payload138,[Parameter(Mandatory)][string]$Payload139,[Parameter(Mandatory)][int]$ExpectedPort)
$ErrorActionPreference='Stop'
$env:TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY='1'
. $OperatorPath -Action Status
$first=Get-Content -Raw -LiteralPath $Payload138 -Encoding UTF8
$second=Get-Content -Raw -LiteralPath $Payload139 -Encoding UTF8
function Check([string]$Raw){
  $payload=$Raw | ConvertFrom-Json
  Assert-MaintenanceEvidence $payload.evidence 'teruisi_integration_role_probe' 'ai_rehearsal_admin' $ExpectedPort $true
  Assert-MaintenanceNoKeyEvidence $payload.profileEvidence
  return $payload
}
$legacy=Check $first
$current=Check $second
$rejected=0
for($case=0;$case -lt 8;$case++){
  $payload=$second | ConvertFrom-Json
  $entries=@($payload.evidence.migrations)
  switch($case){
    0 {$entries+= [pscustomobject]@{app='netshop';name='0005_unknown';appliedAt='2026-10-03T00:00:00Z'}}
    1 {$entries=@($entries | Where-Object { -not ($_.app -ceq 'netshop' -and $_.name -ceq '0004_promotion_presence_cache') })}
    2 {$entries=@($entries | Select-Object -Skip 1)}
    3 {$entries[0].name='9999_unknown'}
    4 {$entries[0].app=$entries[1].app;$entries[0].name=$entries[1].name}
    5 {foreach($item in $entries){if($item.app -ceq 'netshop' -and $item.name -ceq '0004_promotion_presence_cache'){$item.name='0004_wrong'}}}
    6 {foreach($item in $entries){if($item.app -ceq 'ai_assistant' -and $item.name -ceq '0082_no_new_keys_profile'){$item.name='0082_unknown'}}}
    7 {$entries=@(($first | ConvertFrom-Json).evidence.migrations);$entries[0].app='netshop';$entries[0].name='0004_promotion_presence_cache'}
  }
  $payload.evidence.migrations=$entries
  $failed=$false
  try{Assert-MaintenanceEvidence $payload.evidence 'teruisi_integration_role_probe' 'ai_rehearsal_admin' $ExpectedPort $true}catch{$failed=$true;$rejected++}
  if(-not $failed){throw "Unreviewed catalogue accepted: $case"}
}
if($rejected -ne 8){throw 'Negative count mismatch'}
$typeRejected=0
foreach($field in @('app','name')){
  $originalValue=($second | ConvertFrom-Json).evidence.migrations[0].$field
  $variants=[Collections.Generic.List[object]]::new()
  $variants.Add([object[]]@($originalValue))
  $variants.Add([pscustomobject]@{value=$originalValue})
  $variants.Add(7)
  $variants.Add($null)
  foreach($value in $variants){
    $payload=$second | ConvertFrom-Json
    $payload.evidence.migrations[0].$field=$value
    $failed=$false
    try{Assert-MaintenanceEvidence $payload.evidence 'teruisi_integration_role_probe' 'ai_rehearsal_admin' $ExpectedPort $true}catch{$failed=$true;$typeRejected++}
    if(-not $failed){throw "Non-scalar migration identity accepted: $field"}
  }
}
$payload=$second | ConvertFrom-Json
$payload.evidence.migrations[0]='not-a-migration-object'
$failed=$false
try{Assert-MaintenanceEvidence $payload.evidence 'teruisi_integration_role_probe' 'ai_rehearsal_admin' $ExpectedPort $true}catch{$failed=$true;$typeRejected++}
if(-not $failed -or $typeRejected -ne 9){throw 'Migration raw type checks incomplete'}
@{status='passed';positiveChecks=2;negativeChecks=8;rawTypeNegativeChecks=9;productionActions=0} | ConvertTo-Json -Compress
