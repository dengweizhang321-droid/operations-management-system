param([string]$Controller,[string]$PrivateRoot,[string]$RequestedAction)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$arguments=@{Action=$RequestedAction;RuntimeRoot=$PrivateRoot;Json=$true}
$pairs=ConvertFrom-Json $env:TERUISI_AI_BATCH2_PANDAS_ARGS
for($i=0;$i -lt $pairs.Count;$i+=2){
  $parameter=$pairs[$i]
  if($parameter -cnotmatch '^-Pandas[A-Za-z0-9]+$' -or $i+1 -ge $pairs.Count){throw 'Invalid private entry fixture arguments'}
  $arguments.Add($parameter.Substring(1),$pairs[$i+1])
}
if(-not (Test-Path -LiteralPath $PrivateRoot -PathType Container) -or @(Get-ChildItem -LiteralPath $PrivateRoot -Force).Count){
  throw 'Entry fixture requires an empty private runtime'
}
$global:PandasEntryProbeRoot=$PrivateRoot
$global:PandasEntryProbeController=$Controller
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($Controller,[ref]$null,[ref]$errors)
if($errors.Count){throw 'Actual AI controller could not be parsed'}
$matches=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.SwitchStatementAst] -and
  $node.Condition.Extent.Text -ceq '$Action'},$false) | ForEach-Object { $_.Clauses } |
  Where-Object {$_.Item1.Value -ceq $RequestedAction})
if($matches.Count -ne 1 -or $matches[0].Item2.Statements.Count -ne 1){throw 'Expected one actual action dispatcher'}
$dispatch=$matches[0].Item2.Statements[0]
$global:PandasEntryProbeDispatch=$dispatch.Extent.Text
$bp=Set-PSBreakpoint -Script $Controller -Line $dispatch.Extent.StartLineNumber -Action {
  if($RuntimeRoot -cne $global:PandasEntryProbeRoot -or
      (Get-Command Invoke-WithServiceMutex -CommandType Function).ScriptBlock.File -cne
          (Join-Path (Split-Path -Parent $global:PandasEntryProbeController) 'django-local-service.ps1')){
    [Environment]::Exit(19)
  }
  $result=[ordered]@{
    action=$Action; runtime=$RuntimeRoot; binding=$RequestedPandasRotation; json=$RequestedJson
    dispatch=$global:PandasEntryProbeDispatch
  }
  [Console]::WriteLine(($result|ConvertTo-Json -Compress))
  # Stop at the real command invocation, before the mutex or lifecycle code.
  [Environment]::Exit(17)
}
& $Controller @arguments
throw 'Pandas entry did not reach the real mutex boundary'
