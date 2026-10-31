# 客服四条修正 · 独立反审（2026-10-30）

审查对象：分支 `codex/jd-customer-service-retry-schedule-20261030`，提交 `ba0022a3`。
审查者未参与实现（按 `docs/规范/任务模型分工.md` 的独立审查要求）。

## 结论：通过，可合并

逐项自己验证，不采信执行者报告。

| 核查项 | 方法 | 结果 |
| --- | --- | --- |
| webhook path 派生正确 | 独立用 `sha256("teruisi-hourly-retry:"+workflowId)` 前 40 位算四条，与产物比对 | **四条逐值一致** |
| cron 以线上为准 | 与 A1 线上读回值逐条比对 | **四条全对**（设备 13:10 / 切肉机 12:10 / 厨电 12:50 / 洗碗机 12:30） |
| errorWorkflow 已绑 | 读四份定义的 `settings` | 四条均为 `TeruisiHourlyRetry2026` |
| 白名单已加 | diff 错误工作流 | `targets` 映射与 `targetWorkflowIds` 数组各加四条 |
| 告警路径未被删 | 对比 main 与分支的节点清单 | **13 → 13，三个告警节点全保留** |
| 新增测试有效 | 在分支 worktree 跑 | `tests/import-monitor.test.ts` **10/10 通过**（原 9 + 新 1） |
| 未新增测试失败 | 在 main 与分支分别跑两个报称预存失败的测试 | main 各 1 失败、分支各 1 失败，**数量相同，未新增** |
| 推送状态 | `git rev-parse HEAD origin/<branch>` | 本地与远端一致 |

## 执行者避开的一个真实陷阱（值得记录）

执行者报告称"完整重跑生成器会删掉手工加的钉钉告警路径"，我独立验证**此判断成立**：

- `main` 上 `automation/n8n/data-import-hourly-safe-retry.workflow.json` 有 **13 个节点**，含 `转人工发钉钉提醒`、`收集被丢弃的终局失败`、`告警-派发未知`
- 调 `buildHourlyRetryErrorWorkflow()` 只产出 **10 个节点**，上述三个都没有

说明 `f2bbbc0b`（"转人工出口接入钉钉提醒"）**直接改了产物、没有同步生成器源**。如果这次盲目跑 `npm run n8n:retry:generate` 覆盖该文件，会静默删掉钉钉转人工告警——而测试里那条预存失败恰恰是这个漂移的症状，容易被当成"反正本来就红"而忽略。

执行者改为只手工补 `targets` 与 `targetWorkflowIds`，保留了告警逻辑。**这是正确处置。**

## 由此暴露的一个独立问题（本次未修，建议单独处理）

`tools/n8n-hourly-retry-policy.mjs` 的 `buildHourlyRetryErrorWorkflow()` 已不能重建当前线上/仓库的错误工作流——生成器源落后于产物三个节点。后果：

- 任何人将来跑 `npm run n8n:retry:generate` 都会删掉钉钉告警路径
- `tests/n8n-hourly-retry-workflow.test.ts` 的那条失败会一直红，掩盖真实回归

建议作为单独任务：把 `f2bbbc0b` 手工加的三个节点与连线补进生成器源，使"重跑生成器"重新成为安全操作。这件事与本次修正无关，但不做的话这个陷阱会再次被踩。

## 本次未动的内容（符合用户决定）

- `JdLogisticsDaily2026`：cron 本来就对，未改；**是否入重试白名单仍待用户决定**
- `TmallWarehouseDaily2026`：按用户决定，留到真正启用时再做
- 四条的节点名、helper 入口、业务逻辑、其他 settings 字段：未动
- n8n 线上：**一个字未改**

## 顺带修正的一处

`lib/imports/chain-catalog.generated.json` 里 `JdLogisticsDaily2026` 的 `0 8` → `50 8`（其定义文件早已是 `50 8`，属生成器漏跑），由重跑 `tools/build-import-chain-catalog.mjs` 带出。

## 发布状态

**未合并、未准备制品、未发布到 n8n。** 这三步各需用户单独授权。

发布时另须注意：四条中三条文件名带 `.candidate`。它们现在已接入重试机制，但候选状态本身未改变；发布序列照 `docs/自动化/通用/n8n-hourly-safe-retry.md` 第 74 行起执行，先发共享错误工作流的白名单，再逐条更新原 ID。
