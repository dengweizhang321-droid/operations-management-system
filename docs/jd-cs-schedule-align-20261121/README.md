# 京东客服调度时点与线上对齐（2026-11-21）

## 背景

线上 n8n 实际生效版本（`settings.timezone = Asia/Shanghai`）的四店客服调度为：

| 工作流 | cron | 时点 |
| --- | --- | --- |
| `JdCustomerService2026` | `5 9 * * *` | 09:05 |
| `JdCustomerServiceChudian2026` | `25 9 * * *` | 09:25 |
| `JdCustomerServiceDishwasher2026` | `45 9 * * *` | 09:45 |
| `JdCustomerServiceCutMeat2026` | `5 10 * * *` | 10:05 |

仓库定义与监控目录原为 13:10 / 12:50 / 12:30 / 12:10，对应未发布的 n8n 草稿。2026-11-21 用户决定保留线上 09:xx，仓库与监控目录向线上对齐。

## 变更文件

- `automation/n8n/jd-customer-service-daily.workflow.json`、`jd-customer-service-daily.candidate.workflow.json`、`jd-customer-service-chudian-daily.candidate.workflow.json`、`jd-customer-service-dishwasher-daily.candidate.workflow.json`、`jd-customer-service-cut-meat-daily.candidate.workflow.json`：`cronExpression` 改为线上值，触发节点及 `connections` 键改名为 `每天 HH:MM 执行`；webhook 路径、ID、重试设置及工作流名称（含“09:00，30天”）不变。
- `lib/imports/chain-catalog.generated.json`：由 `node tools/build-import-chain-catalog.mjs` 重新生成，差异仅四条 cron；`backend/workflow/import_chain_catalog.json` 无变化。
- `tests/import-monitor.test.ts`、`tests/jd-customer-service-n8n-pipeline.test.ts`：独立声明的线上 cron 更新。
- `tests/jd-customer-service-stores.test.ts`：四店错峰后，逐节点比对时对调度触发节点及其 `connections` 键做归一化。

## 检查

- `tests/import-monitor.test.ts` 全部通过（含链内调度唯一性）。
- `tests/jd-customer-service-n8n-pipeline.test.ts` 的“固定9点”用例通过；其余检查结果见提交说明。
- `tests/jd-customer-service-stores.test.ts` 与 `test_n8n_schedule_watch.py` 各有基线上已存在的失败（webhook 路径差异、主机时钟日期依赖、哈希基线），与本次调度无关。
- `git diff --check` 通过。

## 未完成

线上 n8n 中残留的过期草稿仍需另行执行经用户确认的 n8n 操作来丢弃；本任务只改仓库，未触碰 n8n。
