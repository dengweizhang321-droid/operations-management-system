# 同指纹连续失败止损（2026-11-17）

终局正则（[retry-repeat-stop-20261117](../retry-repeat-stop-20261117/README.md)，已上线）只能拦住已知的确定性失败。没被正则覆盖的失败仍会每小时重试，而且每次重试都要重新登录。11-17 之前，丽力在 7 天里空转了 61 次，拓丰空转了 53 次。本次加一道兜底：同一工作流的同一失败连续出现 4 次，就停止重试并发人工提醒 `manual_action_repeated_failure`。

规则本身写在 [n8n-hourly-safe-retry.md](../自动化/通用/n8n-hourly-safe-retry.md#同一失败连续四次止损)，这里只记录选型依据和证据。

## 选型

| 方案 | 结论 |
| --- | --- |
| n8n 工作流静态数据 | 不可行。`TeruisiHourlyRetry2026` 的 ID 长 22 个字符，超过 n8n `isWorkflowIdValid` 的 21 字符上限，静态数据不会落库。 |
| `reserve-retry` 预留文件 | 不采用。预留按 `originalExecutionId` 分链，每天的定时运行都会开一条新链，跨天重复的同一失败（丽力连续 7 天）计数会被拆散。另外它是写路径，计数逻辑放进去会和派发预留耦合。 |
| **n8n 执行历史（采用）** | 失败 execution 与它的错误信息本来就在 n8n 库里，成功运行也在，所以「成功一次清零」不需要另写任何状态。helper 已有只读打开 n8n 库的代码（retry-context 用的就是它）。新端点只读，不写文件，没有并发写的问题。 |

## 改动

- `lib/jackyun/n8n-retry-failure-streak.ts`（新）：错误文本规范化、指纹、连续计数的纯函数。
- `lib/jackyun/n8n-preflight-evidence.ts`：`queryN8nFailureStreak` / `readN8nFailureStreak`。最多扫描 200 行，只解析扫描实际走到的那几行的 `execution_data`。失败 execution 之后同一工作流只要有任何成功运行，就不停止。
- `tools/tmall-isolated-helper.ts`：只读端点 `POST /coordination/retry-failure-streak`。异常返回 409 `retry_failure_streak_unavailable`。
- `tools/n8n-hourly-retry-policy.mjs`：导出阈值 `hourlyRetrySameFailureStopThreshold = 4` 和豁免名单（吉客云）。「读取原执行计划时间」节点在 retry-context 核验之后、`reserve-retry` 之前调用端点。只有响应完全合法、`stop=true` 且 `consecutive >= 4` 时才转人工，其余一切情况都继续原流程。
- `tools/n8n-manual-action-alert.ps1`：`$hints` 新增 `manual_action_repeated_failure`。
- `automation/n8n/data-import-hourly-safe-retry.workflow.json`：重新生成。只有「读取原执行计划时间」「准备人工提醒参数」两个节点的 `jsCode` 变化，16 个节点、连线和 settings 都不变。生产已发布版本 `c77f472b` 与改动前的 main 逐节点一致。
- 测试：`tests/n8n-retry-failure-streak.test.ts`（新）；`tests/n8n-retry-context.test.ts` 增加节点级测试，覆盖停止路径、13 种降级情形、吉客云豁免，以及 ps1 文案次数与阈值常量一致。

## 证据

### 历史回放

只读打开生产 n8n 库（`file:...?mode=ro`），对 15 个目标工作流（排除吉客云）的每一次自动失败，用它当时可见的历史计算连续次数：

- 共 219 次自动失败，算出 56 个不同指纹。每个指纹下规范化后的文本都完全相同，没有把不同错误合并到一起。
- 阈值 3 会误停一次：`JdN8nSilentCopy2026` 2026-11-15 的 11519、11532、11548 三次都是「runner 未完成计划步骤」，第四次 11560 成功了。
- 阈值 4 会停下 125 次，其中 0 次之后紧接着就是成功。
- 按 11-17 前的分类器，丽力的重试会从 63 次降到 4 次，拓丰从 53 次降到 4 次。
- 这 125 次失败现在都已被终局正则判为人工处理。也就是说，按现有历史，止损不会多拦任何一次失败。它是给以后出现的、正则没覆盖的新确定性失败准备的兜底。

### 反审变异

我手工改坏实现，检查测试能否抓住，每项验证后都已还原：

| 改坏的内容 | 结果 |
| --- | --- |
| 降级失效：catch 里改为重新抛出 | 2 个测试失败 |
| 指纹去掉 description | 2 个测试失败 |
| 4 位以下数字也抹掉 | 1 个测试失败（区分短数字） |
| 手动成功不清零 | 1 个测试失败 |
| 不校验响应里的 failedExecutionId | 2 个测试失败 |
| 关掉「之后已有成功」边界 | 1 个测试失败 |
| ps1 文案改回「3 次」 | 1 个测试失败 |

### 检查

- `node --import tsx --test tests/n8n-retry-failure-streak.test.ts tests/n8n-hourly-retry-workflow.test.ts tests/n8n-retry-context.test.ts tests/automation-drain.test.ts tests/jackyun-retry-budget.test.ts tests/jackyun-fresh-restart.test.ts`：93 个测试，85 通过、8 失败。8 个失败全部在 `jackyun-fresh-restart`，改动前的基线就已失败，与本次无关。前三个文件单独运行时 0 失败。
- `node tools/build-worker-helper.mjs --source-root <worktree> --output <临时目录>/helper.mjs`：退出码 0，产物里有 `retry-failure-streak`，新文件中没有 `import.meta`。
- `node tools/release-scope-plan.mjs --base e3ecd40b`：`scope=full`，组件为 worker 和 django，`migrate=false`。升级为完整流程的原因是 `automation/n8n/...workflow.json` 属于未知路径；helper 的两个文件属于 Worker 复制清单。

## 发布步骤（每一步都需要用户在会话里明确授权）

1. **合并**到 main 并推送。
2. **主检出快进**：`D:\运营管理系统` 执行 `git merge --ff-only origin/main`，保留用户未提交的改动。用 ps1 预览模式（不带 `-Execute`）对 `manual_action_repeated_failure` 构造 payload，确认 `status=local_preview`、exit=0。旧 ps1 会拒收新告警码，提醒会静默丢失，所以这一步必须在 n8n 发布之前完成。
3. **Worker/Django 发布**：走 `tools/publish-latest-main.mjs`（制品准备包含在合并授权内，上线另需授权）。新端点随 helper 一起上线。上线前 n8n 调用这个端点会得到 404，节点按降级继续重试，行为与现在相同。
4. **n8n 发布**：按 [11-17 发布记录](../retry-repeat-stop-20261117/publish/REPORT.md) 的方式操作：先备份 n8n 库，再把仓库 JSON 精确导入为 `TeruisiHourlyRetry2026`（`n8n import:workflow`），然后 `n8n publish:workflow --id=TeruisiHourlyRetry2026`，不需要重启。发布后核对：已发布版本与仓库 JSON 逐节点一致，其余工作流没有变化。

第 3 步和第 4 步的先后不影响安全，因为任一侧缺失都会降级回现有行为。建议先做第 3 步，这样 n8n 发布后的第一次失败就会走止损检查。

回退：把 n8n 发布回 `c77f472b`（`n8n publish:workflow --id=TeruisiHourlyRetry2026 --versionId=c77f472b-3ba7-4adb-a87c-1fef1d70eba5`）。helper 端点不用回退，没有调用方时它不会产生任何作用。
