const errors: Record<string, string> = {
  provider_subscription_invalid: "模型订阅校验未通过，请检查订阅、密钥与模型权限，或配置可用的文本模型。",
  provider_error: "模型服务拒绝请求，请在 AI 管理检查模型配置与连接测试结果。",
  provider_rate_limited: "模型服务限流，请检查可用额度。",
  provider_timeout: "模型响应超时。",
  delivery_unknown: "平台受理结果未确认，未自动重发。",
  missed_window: "执行器错过计划时段，未补发。",
  interrupted_result_unknown: "执行中断，结果未确认，未自动重发。",
  prior_stage_failed: "前序阶段失败，未执行。",
  prior_stage_unknown: "前序阶段结果未知，未执行。",
  prior_stage_interrupted: "前序阶段中断，未执行。",
  schedule_data_invalid: "本轮数据、日期或覆盖校验未通过，未发送。",
  schedule_data_stale: "库存来源已过期或水位不一致，未发送。",
  schedule_date_changed: "业务日期已变化，旧日期内容未发送。",
  schedule_source_changed: "分析后来源发生变化，未重新生成或发送。",
  schedule_model_changed: "本轮模型配置已变化，未换模型重试。",
  schedule_analysis_invalid: "AI解读未通过结构或事实引用校验，未发送。",
  scheduled_analysis_incomplete: "模型未生成完整解读，未发送。",
  schedule_content_too_large: "监控内容超过渠道容量，未截断发送。",
};

export function scheduleErrorLabel(code: string): string {
  return errors[code] ?? (code ? `错误码：${code}` : "");
}
