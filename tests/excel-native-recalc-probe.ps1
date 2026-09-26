[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$excel = $null
$workbook = $null
$worksheet = $null
$first = $null
$second = $null
$formula = $null

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.ScreenUpdating = $false
  $excel.AskToUpdateLinks = $false
  $excel.AutomationSecurity = 3

  $workbook = $excel.Workbooks.Add()
  $worksheet = $workbook.Worksheets.Item(1)
  $first = $worksheet.Range('A1')
  $second = $worksheet.Range('A2')
  $formula = $worksheet.Range('A3')
  $first.Value2 = 2
  $second.Value2 = 3
  $formula.Formula = '=SUM(A1:A2)'
  $excel.CalculateFullRebuild()
  if ([double]$formula.Value2 -ne 5) { throw 'Excel initial formula recalculation failed' }

  $second.Value2 = 0
  $excel.CalculateFullRebuild()
  if ([double]$formula.Value2 -ne 2) { throw 'Excel changed-input formula recalculation failed' }
  if ([string]$formula.Formula -cne '=SUM(A1:A2)') { throw 'Excel formula text changed' }

  [pscustomobject]@{
    engine = 'Microsoft Excel COM'
    version = [string]$excel.Version
    syntheticInitial = 5
    syntheticChangedInput = 2
    nativeFormulaRecalculation = $true
    workbookWritten = $false
  } | ConvertTo-Json -Compress
} finally {
  if ($null -ne $workbook) { $workbook.Close($false) }
  if ($null -ne $excel) { $excel.Quit() }
  foreach ($item in @($formula, $second, $first, $worksheet, $workbook, $excel)) {
    if ($null -ne $item -and [Runtime.InteropServices.Marshal]::IsComObject($item)) {
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item)
    }
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
