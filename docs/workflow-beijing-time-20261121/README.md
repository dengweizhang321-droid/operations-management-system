# 工作流固定北京时间（2026-11-21）

## 背景

主机时区改为美国太平洋时间后，n8n 触发仍按 `Asia/Shanghai`，而 helper/Django 按主机日历取“今天/昨天”，造成京准通计划拒绝、客服 30 天窗口滞后、`n8n_schedule_watch` 误报缺失。用户 2026-11-21 决定所有工作流使用固定北京时间，取代 2026-11-03 的主机本地时区决定（提交 `50d5cd8b`）。cron 时分不变。

## 范围

- 核心：`workflowTimeZone()` 固定 `Asia/Shanghai`；客服期间、京准通/京东/天猫/ERP/销售导入等直接取主机默认日期的位置显式传入 `Asia/Shanghai`。
- Python：`pi_business_n8n`、`import_chain_status`、`followup`、`new_product_weekly_report`、`n8n_schedule_watch` 改用 `ZoneInfo`/固定 +08:00。
- n8n：45 份工作流定义、6 份 Pi 候选及生成器恢复 `settings.timezone`，目录投影 `timezone` 为 `Asia/Shanghai`；启动器固定 `GENERIC_TIMEZONE`/`TZ`；告警脚本恢复上海时间。
- UI 文案：“本地时间/本机时区/本机时间”改为“北京时间”，无布局改动。上新销售跟进页默认周也按北京时间计算。

## 兼容

新计划冻结 `host_local_calendar_v1` 与 `Asia/Shanghai`；已冻结其他时区的计划继续沿用冻结值，无标记旧计划仍为上海。恢复路径比较的是持久化时区，不与当前 `workflowTimeZone()` 比较。`lib/imports/chain-status.ts` 继续接受 `local` 的旧响应。

## 检查与未做事项

检查结果见交付报告。未做：未触碰线上 n8n、未重启任何服务、未合并/推送/发布、未执行业务功能验收。吉客云“每天本机时间 00:10”节点名保留，避免改动执行图和恢复白名单。`jd-customer-service` 生成器仍写旧 09:00 cron（与已对齐的 09:05/09:25/09:45/10:05 不同），本次未运行它，对应 JSON 由反向补丁恢复；吉客云 daily/http 两份未含重试挂接，与生成器串联输出不同，沿用基线形态。
