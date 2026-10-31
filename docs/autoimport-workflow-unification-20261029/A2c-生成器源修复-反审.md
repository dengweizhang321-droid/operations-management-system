# 生成器源修复 + 物流入白名单 · 独立反审（2026-10-30）

审查对象：分支 `codex/jd-customer-service-retry-schedule-20261030`，提交 `2fd0abcb`（在 `ba0022a3` 之上）。
审查者未参与实现。子代理结束时未送出报告，本文全部结论来自我自己的验证。

## 结论：技术上通过。但合并前有一个分支基点问题要你决定

## 一、两段验证我都自己做了

### 第一段：生成器源是否真能复现产物（关键证明）

做法：临时把 `JdLogisticsDaily2026` 从 `hourlyRetryTargets` 移出 → 重跑 `npm run n8n:retry:generate` → 看差异。

结果：差异**只有物流那一条**（`targets` 映射 121 字符 + `targetWorkflowIds` 一项），其余**字节等价**。

这证明：
- 三个告警节点（`收集被丢弃的终局失败`、`告警-派发未知`、`转人工发钉钉提醒`）已正确补进生成器源
- 筛选节点内 822 字符的 `droppedFailures` 逻辑已补齐
- 四条连线的拓扑（告警串在原链路中间，不是旁挂）已复现

**这一段是本任务成功的硬判据，不能跳过。** 若直接验第二段，"多出一条白名单"与"漏补某个节点"的差异会混在一起。

### 第二段：加回物流后

恢复 18 条 → 重跑生成器 → `git status` 为空，与已提交状态完全一致。
错误工作流仍是 **13 个节点、14 条连线、三个告警节点全在**。

## 二、一项独立的硬证据：预存失败转绿

`tests/n8n-hourly-retry-workflow.test.ts`：
- 未改动的 `main` 上：**9 tests / 8 pass / 1 fail**
- 本分支：**9 tests / 9 pass / 0 fail**

那条失败正是生成器漂移的症状。它转绿**不是我们声称补齐了，而是一条独立存在的测试认了**。这比自写断言可信。

## 三、其余核查

| 项 | 方法 | 结果 |
| --- | --- | --- |
| 白名单条数 | 执行 `hourlyRetryTargets.length` | **18**（grep 数出 19 是别处同名字段，实际 18） |
| 物流 webhook path | 独立算 `sha256("teruisi-hourly-retry:JdLogisticsDaily2026")` 前 40 位 | `...4a047ca9719d5560...` **一致** |
| 物流 errorWorkflow | 读定义 `settings` | `TeruisiHourlyRetry2026` 已绑 |
| 物流 cron 未被误改 | 读 scheduleTrigger | 仍 `50 8 * * *`（本来就对，不该动） |
| `import-monitor` 回归 | 分支 worktree 跑 | **10/10 通过** |
| 构建含类型检查 | `npm run build` | 通过 |
| 本任务两提交是否干净 | 逐提交 `--stat` | `ba0022a3` 9 文件、`2fd0abcb` 4 文件，**都只含本任务文件** |
| 推送 | 比对本地与远端 HEAD | 一致 |
| 天猫入仓未被动 | 查白名单 | `TmallWarehouseDaily2026` 不在，符合用户决定 |

## 四、⚠️ 合并前要你决定的一件事

**这个分支不是从干净的 `main` 切出来的。**

`git diff --stat main..HEAD` 除本任务文件外，还含三个无关文件：
- `backend/netshop/consumers.py`、`backend/teruisi_backend/settings.py`、`backend/netshop/tests/test_consumers.py` ← 来自 `2c29fc3c`「memoize market projection total per netshop revision」
- `tools/postgres_no_key_backup.py` ← 来自 `4164d99f`「load the Django app registry before generation153 catalog」

我已核实这些**不是本任务引入的**：本任务两个提交逐一查过，只含自己的文件。它们来自分支基点 `2dc377f0`（"把最新 main 并入网店投影 total 记忆化分支"）。

**后果**：直接合并这个分支，会把"网店投影 total 记忆化"和"备份 django.setup 修复"这两件**别的工作**一起带进 `main`。

三个选项：
1. **一起合**——如果那两件本来就验收过、准备合了，这样最省事
2. **把本任务两个提交 cherry-pick 到从干净 main 切的新分支**——范围最清楚，代价是要重跑一次验证
3. **先合那两件，再合本分支**——顺序清楚，但要分两次授权

我倾向选项 1 或 3，取决于那两件的状态。选项 2 最干净但要重做验证。

## 五、发布时的注意事项

- 客服四条中三条文件名带 `.candidate`，已接入重试机制但候选状态本身未变，发布时需确认按候选还是转正式
- 发布序列照 `docs/自动化/通用/n8n-hourly-safe-retry.md` 第 74 行起：只读备份 → **先发共享错误工作流**（白名单从 13→18）→ 逐条更新原 ID（不新建副本，保留 owner 与 active）→ 回读 `activeVersionId == versionId` 且 webhook 已注册 → 隔离的可逆失败验一次，**不制造平台业务点击**
- 顺序不能颠倒：若先发目标工作流而错误工作流白名单还是 13 条，新接入的五条失败时仍会被判"该流程未接入自动重试"

## 六、当前状态

**未合并、未准备制品、未发布到 n8n。** 这三步各需你单独授权。
