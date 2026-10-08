const errors: Record<string, string> = {
  provider_subscription_invalid: "模型订阅校验未通过，请检查订阅、密钥与模型权限，或配置可用的文本模型。",
  provider_error: "模型服务拒绝请求，请在 AI 管理检查模型配置与连接测试结果。",
  provider_rate_limited: "模型服务限流，请检查可用额度。",
  provider_timeout: "模型响应超时。",
  missed_window: "执行器错过计划时段，未补发。",
  interrupted_result_unknown: "执行中断，结果未确认，未自动重发。",
};

export function scheduleErrorLabel(code: string): string {
  return errors[code] ?? (code ? `错误码：${code}` : "");
}
