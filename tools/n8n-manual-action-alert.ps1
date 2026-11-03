#requires -Version 7.0
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateLength(1,8192)][ValidatePattern('^[A-Za-z0-9+/]+={0,2}$')][string]$PayloadBase64,
  [switch]$Execute,
  [string]$StateRoot=(Join-Path $env:LOCALAPPDATA 'TERUISI\n8n-manual-action-alert')
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)

function Invoke-ManualActionAlert([string]$EncodedPayload,[bool]$SendEnabled,[string]$AlertRoot){
  # Function scope contains the watchdog's script parameters and variables.
  # FunctionsOnly returns before Status/Check/install/state operations.
  . (Join-Path $PSScriptRoot 'operations-system-watchdog.ps1') -FunctionsOnly -Action Status
  $workflows=@{
    J8kY2mQ5vR7sT4pN='吉客云五表'; JdN8nM3uL7tI2026='京东多店铺'; JdN8nSilentCopy2026='京东多店铺静默'
    JdMarketDaily2026='京东市场榜单'; JdMarketSilentCopy2026='京东市场榜单静默'
    JdPromotionDaily2026='京东推广设备店'; JdPromotionCutMeat2026='京东推广切肉机店'
    M4xY8kQ2vR6sT9pC='天猫亿久'; TmallLiliDaily2026='天猫丽力'; TmallTuofengDaily2026='天猫拓丰'
    TmallCuizhiwangDaily2026='天猫炊之王'; TmallMasituDaily2026='天猫马思图'; TmallYiyongDaily2026='天猫亿用'
    JdCustomerService2026='京东客服设备店'; JdCustomerServiceCutMeat2026='京东客服切肉机店'
    JdCustomerServiceChudian2026='京东客服厨电店'; JdCustomerServiceDishwasher2026='京东客服洗碗机店'
    JdLogisticsDaily2026='京东物流'
  }
  # No remote/raw exception text or caller-provided label enters the message.
  $hints=@{
    terminal_manual_action=@('原流程已停止自动重试，需核查失败原因','到 n8n 打开原 execution，按失败节点说明处理登录、验证或来源问题；确认原状态后再恢复')
    execution_mode_not_automatic=@('本次触发方式不参与自动重试','到 n8n 查看原 execution 与业务状态，确认下一步人工处理方式')
    retry_dispatch_result_unknown=@('重试 Webhook 派发结果未知，可能已受理','核查该流程最近的 execution 与原计划；禁止直接再次派发')
    retry_context_wait_expired_manual_action=@('等待原计划核验已达 72 小时上限','核查原计划为何未完成，按原恢复入口处理，禁止盲目重跑')
    retry_context_unverified_manual_action=@('原计划无法核验','检查共享 helper 和原计划证据，再按原恢复入口处理')
    retry_reservation_result_unknown_manual_action=@('重试名额预留结果未知','核查是否已有重试被受理；禁止直接再次派发')
    retry_already_reserved_or_unverified_manual_action=@('名额已被占用或校验不通过','核查已有 execution 和预留证据，再决定恢复方式')
  }
  $payload=[Text.UTF8Encoding]::new($false,$true).GetString([Convert]::FromBase64String($EncodedPayload))|ConvertFrom-Json
  if($payload -isnot [pscustomobject]){throw 'invalid_payload'}
  if($payload.version -eq 2){
    # The external read-only monitor has no execution ID when a schedule never ran.
    # Keep a separate schema/key; never fabricate an execution for the v1 sender.
    $fields=@('version','kind','workflowId','code','anchorEpoch','executionId')
    if($payload.code -ceq 'error_workflow_failed'){$fields+=@('failureCount')}
    if(($payload.version -isnot [int] -and $payload.version -isnot [long]) -or @($payload.PSObject.Properties).Count -ne $fields.Count -or @($payload.PSObject.Properties.Name|Where-Object {$_ -cnotin $fields}).Count -or $payload.kind -cne 'schedule_watch'){throw 'invalid_payload'}
    $watchHints=@{
      schedule_not_ready='定时流程未就绪：启用状态、已发布版本或本调度周期 execution 存在缺口'
      schedule_inactive='声明了定时调度，但流程不存在、已归档或未启用'
      schedule_unpublished='声明了定时调度，但没有已发布版本'
      schedule_missing_execution='最近一个已到期调度窗口内没有定时 execution'
      schedule_invalid='目录中的调度规则无法核验，不能判断是否漏跑'
      error_workflow_missing='已启用流程没有配置错误工作流；共享错误流自身需靠外部巡检'
      error_workflow_failed='共享错误工作流最近 24 小时有失败执行'
      inspection_unavailable='巡检无法完整读取目录或 n8n 元数据，不能视为正常'
    }
    $workflow=$payload.workflowId; $code=$payload.code; $failed=$payload.executionId
    if($workflow -isnot [string] -or $workflow -cnotmatch '^[A-Za-z0-9_-]{1,128}$' -or $code -isnot [string] -or $code -cnotin @($watchHints.Keys) -or $failed -isnot [string] -or ($failed -ne '' -and $failed -cnotmatch '^[1-9][0-9]{0,19}$') -or ($code -ceq 'error_workflow_failed' -and -not $failed)){throw 'invalid_payload'}
    if(($payload.anchorEpoch -isnot [int] -and $payload.anchorEpoch -isnot [long]) -or $payload.anchorEpoch -lt 0 -or $payload.anchorEpoch -gt 4102444800){throw 'invalid_payload'}
    if($code -ceq 'error_workflow_failed'){
      if(($payload.failureCount -isnot [int] -and $payload.failureCount -isnot [long]) -or $payload.failureCount -lt 1 -or $payload.failureCount -gt 1000){throw 'invalid_payload'}
      $watchHints[$code]="最近 24 小时发生 $($payload.failureCount) 次失败"
    }
    $anchor=[DateTimeOffset]::FromUnixTimeSeconds($payload.anchorEpoch).ToOffset([TimeSpan]::FromHours(8)).ToString('yyyy-MM-dd HH:mm:ss')
    $label=if($workflows.ContainsKey($workflow)){$workflows[$workflow]}elseif($workflow -ceq 'TeruisiHourlyRetry2026'){'每小时安全重试错误流'}elseif($workflow -ceq 'TmallWarehouseDaily2026'){'天猫入仓监控'}elseif($workflow -ceq 'N8nScheduleWatch'){'n8n 外部巡检'}else{"n8n 工作流 $workflow"}
    if($code -ceq 'error_workflow_failed'){
      $key=Get-WatchTextHash ("schedule-watch-v1|$workflow|$code|$($payload.anchorEpoch)")
    }else{
      $key=Get-WatchTextHash ("schedule-watch-v1|$workflow|$code|$($payload.anchorEpoch)|$failed")
    }
    $executionLabel=if($code -ceq 'error_workflow_failed'){'最新失败 execution：'}else{'失败 execution：'}
    $message=@('【运营自动化】巡检需要人工处理',('流程：'+$label),('检查项：'+$watchHints[$code]),('观察锚点（上海）：'+$anchor),$(if($failed){$executionLabel+$failed}else{'未关联 execution'}),'请你处理：核查启用状态、已发布版本、调度与执行记录；不要给共享错误流绑定自身，不要盲目补跑或重复导入') -join "`n"
  }else{
  if($payload.version -ne 1 -or @($payload.PSObject.Properties.Name|Where-Object {$_ -cnotin @('version','workflowId','logicalExecutionId','failedExecutionId','code')}).Count){throw 'invalid_payload'}
  $workflow=[string]$payload.workflowId; $logical=[string]$payload.logicalExecutionId; $failed=[string]$payload.failedExecutionId; $code=[string]$payload.code
  if($workflow -cnotin @($workflows.Keys) -or $code -cnotin @($hints.Keys) -or $logical -cnotmatch '^[1-9][0-9]{0,19}$' -or $failed -cnotmatch '^[1-9][0-9]{0,19}$'){throw 'invalid_payload'}
  $key=Get-WatchTextHash ("manual-action-v1|$workflow|$logical|$code")
  $message=@('【运营自动化】需要人工处理',('流程：'+$workflows[$workflow]),('上海时间：'+[DateTimeOffset]::UtcNow.ToOffset([TimeSpan]::FromHours(8)).ToString('yyyy-MM-dd HH:mm:ss')),('原因：'+$hints[$code][0]),'影响：本轮尚未完成，已完成部分保留，以原计划及批次证据为准',("原逻辑 execution：$logical；失败 execution：$failed"),('请你处理：'+$hints[$code][1])) -join "`n"
  }
  if(-not $SendEnabled){return @{status='local_preview';executed=$false;message=$message;exitCode=0}}
  $AlertRoot=[IO.Path]::GetFullPath($AlertRoot).TrimEnd([char[]]@('\','/'))
  if(-not [IO.Path]::GetDirectoryName($AlertRoot)){throw 'invalid_alert_root'}
  if($AlertRoot -ieq $WatchdogRoot -or $AlertRoot.StartsWith($WatchdogRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'invalid_alert_root'}
  [void][IO.Directory]::CreateDirectory($AlertRoot)
  if((Get-Item -LiteralPath $AlertRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'invalid_alert_root'}
  # DWS transport only needs a working directory. Keep its cwd separate from
  # the watchdog root; never read/write watchdog state or installation data.
  $WatchdogRoot=$AlertRoot
  $path=Join-Path $AlertRoot ($key+'.json')
  $mutex=[Threading.Mutex]::new($false,('Local\TERUISI.ManualActionAlert.'+(Get-WatchTextHash $AlertRoot.ToLowerInvariant())))
  $held=$false
  try{
    try{$held=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$held=$true}
    if(-not $held){return @{status='busy';executed=$false;exitCode=2}}
    $previous=$null
    if(Test-Path -LiteralPath $path){
      $stateFile=Get-Item -LiteralPath $path -Force
      if($stateFile.PSIsContainer -or $stateFile.Attributes -band [IO.FileAttributes]::ReparsePoint -or $stateFile.Length -gt 1048576){throw 'invalid_notification_state'}
      # Keep arrays as arrays: a single-element JSON array must not unwrap
      # into an apparently valid record. Only absence permits first delivery.
      $previous=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($path)) -NoEnumerate
      if($previous -isnot [pscustomobject] -or ($previous.version -isnot [int] -and $previous.version -isnot [long]) -or $previous.version -ne 1 -or $previous.key -isnot [string] -or $previous.key -cne $key -or $previous.status -isnot [string] -or $previous.status -cnotin @('identity_failed','sending','sent','unknown')){throw 'invalid_notification_state'}
    }
    if($previous -and $previous.status -cin @('sending','sent','unknown')){
      $status=if($previous.status -ceq 'sent'){'sent'}else{'unknown'}
      return @{status=$status;executed=$false;suppressed=$true;exitCode=$(if($status -ceq 'sent'){0}else{3})}
    }
    $record=@{version=1;key=$key;status='identity_check';at=[DateTimeOffset]::UtcNow.ToString('o')}
    $sending=$false
    try{
      $recipient=Get-WatchRecipient
      $arguments=@('chat','+messages-send','--as','bot','--profile',$recipient.profile,'--robot-code',$recipient.bot,'--users',$recipient.user,'--text',$message,'--yes')
      # Durable reservation before the single non-idempotent call. No retries.
      $record.status='sending';Write-WatchJson $path $record;$sending=$true
      $sent=Invoke-WatchDws $arguments
      $inner=$sent.result.result
      $undelivered=@(@($inner.invalidStaffIdList)+@($inner.flowControlledStaffIdList)|Where-Object {$null -ne $_})
      if($sent.ok -ne $true -or $sent.result.success -ne $true -or $sent.result.errorCode -ne 0 -or $inner.processQueryKey -isnot [string] -or -not $inner.processQueryKey -or $undelivered.Count -ne 0){throw 'delivery_unconfirmed'}
      $record.status='sent';Write-WatchJson $path $record
      return @{status='sent';executed=$true;exitCode=0}
    }catch{
      $record.status=if($sending){'unknown'}else{'identity_failed'}
      $known=@('owner_profile_ambiguous','owner_ambiguous','owner_mismatch','owner_search_ambiguous','bot_ambiguous','dws_rejected','delivery_unconfirmed')
      $processEvidence=$_.Exception.Data['ProcessEvidence']
      $authRequired=-not $sending -and $processEvidence -and [string]$processEvidence.stderrSummary -match 'dws auth login|重新授权'
      $record.reason=if($authRequired){'dws_auth_required'}elseif($_.Exception.Message -cin $known){$_.Exception.Message}else{'notification_unconfirmed'}
      # If persisting unknown fails, the durable sending record still prevents replay.
      try{Write-WatchJson $path $record}catch{}
      return @{status=$record.status;reason=$record.reason;executed=$sending;exitCode=$(if($sending){3}else{2})}
    }
  }finally{if($held){$mutex.ReleaseMutex()};$mutex.Dispose()}
}
try{
  $result=Invoke-ManualActionAlert $PayloadBase64 ([bool]$Execute) $StateRoot
  $exitCode=[int]$result.exitCode;$result.Remove('exitCode')
  $result|ConvertTo-Json -Compress -Depth 4
  exit $exitCode
}catch{
  # Never emit exception text/ProcessEvidence: they may contain identity or CLI output.
  @{status='not_sent';reason='notification_preflight_failed';executed=$false}|ConvertTo-Json -Compress
  exit 2
}
