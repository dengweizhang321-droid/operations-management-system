import assert from "node:assert/strict";
import test from "node:test";

import { scheduleErrorLabel } from "../lib/ai/schedule-presentation";

// Codes that reach AiDingTalkScheduleRun.error_code or a stage error_code and
// had no label before this suite existed. Each one is rendered verbatim by
// app/ai-dingtalk-schedules-view.tsx:87-88, so a missing entry showed operators
// the bare "错误码：<code>" fallback instead of an action to take.
const PREVIOUSLY_UNLABELLED = [
  "access_denied",
  "conflict",
  "channel_unavailable",
  "ai_chat_quota_exceeded",
  "ai_chat_result_unknown",
  "execution_result_unknown",
  "dingtalk_group_not_allowed",
  "dingtalk_identity_mismatch",
  "dingtalk_sender_unbound",
] as const;

// The 24 entries that already existed, pinned so adding labels cannot silently
// drop or reword one of them.
const PRE_EXISTING: Record<string, string> = {
  provider_subscription_invalid: "模型订阅校验未通过，请检查订阅、密钥与模型权限，或配置可用的文本模型。",
  provider_error: "模型服务拒绝请求，请在 AI 管理检查模型配置与连接测试结果。",
  provider_rate_limited: "模型服务限流，请检查可用额度。",
  provider_timeout: "模型响应超时。",
  provider_dns_timeout: "模型地址解析超时，尚未发起模型请求。",
  provider_dns_unavailable: "模型地址解析失败，尚未发起模型请求。",
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
  schedule_analysis_prose_invalid: "AI解读包含未允许的数值或文本，未发送。",
  schedule_analysis_reference_invalid: "AI解读引用的商品或证据不符，未发送。",
  schedule_format_unsupported: "当前投递方式不支持任务要求的格式，未擅自替换或发送。",
  schedule_no_alerts: "无符合条件的预警，无需分析或发送。",
  scheduled_analysis_incomplete: "模型未生成完整解读，未发送。",
  schedule_content_too_large: "监控内容超过渠道容量，未截断发送。",
};

test("every previously unlabelled code resolves to real prose, not the fallback", () => {
  for (const code of PREVIOUSLY_UNLABELLED) {
    const label = scheduleErrorLabel(code);
    assert.notStrictEqual(label, `错误码：${code}`, `${code} still falls back to the bare code`);
    assert.ok(label.length > 0, `${code} resolves to an empty label`);
    // The fallback is the only string that embeds the raw code; a real label
    // must never leak the identifier at operators.
    assert.ok(!label.includes(code), `${code} leaks the raw code into its label`);
  }
});

test("each new label states both what happened and what to do next", () => {
  for (const code of PREVIOUSLY_UNLABELLED) {
    const label = scheduleErrorLabel(code);
    // Operator-facing prose, not a translation of the identifier: long enough
    // to carry an outcome plus an instruction, and ending as a sentence.
    assert.ok(label.length >= 24, `${code} label is too short to carry an action: ${label}`);
    assert.match(label, /。$/, `${code} label is not a finished sentence: ${label}`);
    // Every one of the nine is a "did not send / not确认" outcome whose
    // remedy is manual. Require an explicit instruction verb so a future
    // edit cannot quietly reduce one back to a bare translation.
    assert.match(label, /请/, `${code} label gives no instruction: ${label}`);
  }
});

test("the two result_unknown codes forbid a blind manual retry", () => {
  // dingtalk_schedules.py:375/:380 treat these two as unknown precisely so no
  // automatic resend happens; the label must not invite a human to do it.
  for (const code of ["ai_chat_result_unknown", "execution_result_unknown"]) {
    assert.match(scheduleErrorLabel(code), /未自动重发/, `${code} omits the no-resend fact`);
    assert.match(scheduleErrorLabel(code), /核实|确认/, `${code} does not direct the operator to verify`);
  }
  assert.match(scheduleErrorLabel("execution_result_unknown"), /请勿/);
  assert.match(scheduleErrorLabel("ai_chat_result_unknown"), /请勿/);
});

test("the three dingtalk codes each name their own configuration fix", () => {
  // dingtalk.py:78/:89/:97 raise these for three distinct misconfigurations;
  // the labels must stay distinguishable at the granularity of the real cause.
  assert.match(scheduleErrorLabel("dingtalk_sender_unbound"), /staffId/);
  assert.match(scheduleErrorLabel("dingtalk_identity_mismatch"), /robotCode/);
  assert.match(scheduleErrorLabel("dingtalk_identity_mismatch"), /corpId/);
  assert.match(scheduleErrorLabel("dingtalk_group_not_allowed"), /群/);
  const labels = new Set(
    ["dingtalk_sender_unbound", "dingtalk_identity_mismatch", "dingtalk_group_not_allowed"].map(scheduleErrorLabel),
  );
  assert.strictEqual(labels.size, 3, "the three DingTalk labels are not distinct");
});

test("ai_chat_quota_exceeded names whose quota ran out", () => {
  // chat.py:544 (daily dispatch counts) and chat.py:839 (concurrency/daily
  // receipt caps) are both this system's own limits, not the vendor's.
  assert.match(scheduleErrorLabel("ai_chat_quota_exceeded"), /额度/);
  assert.match(scheduleErrorLabel("ai_chat_quota_exceeded"), /未调用模型/);
});

test("the 24 pre-existing labels are unchanged", () => {
  for (const [code, expected] of Object.entries(PRE_EXISTING)) {
    assert.strictEqual(scheduleErrorLabel(code), expected, `${code} label changed`);
  }
  assert.strictEqual(Object.keys(PRE_EXISTING).length, 24);
});

test("an unknown code still falls back to the bare identifier", () => {
  assert.strictEqual(scheduleErrorLabel("not_a_real_code"), "错误码：not_a_real_code");
  assert.strictEqual(scheduleErrorLabel("provider_subscription_invalid_typo"), "错误码：provider_subscription_invalid_typo");
});

test("an empty code renders nothing rather than an empty 错误码 prefix", () => {
  assert.strictEqual(scheduleErrorLabel(""), "");
});
