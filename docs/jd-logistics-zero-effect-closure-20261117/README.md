# 京东物流零效果失败自动闭合（2026-11-17）

基线 `b728fd7c`，分支 `codex/jd-logistics-zero-effect-closure-20261117`。稳定规则见 [导入与自动化](../规范/导入与自动化.md)；本文记录问题、判定、布局与现场只读结果，不代表已发布或已在生产闭合。

## 问题

`JdLogisticsDaily2026` 自 10-31 起每天 08:50 在 A 阶段 1-2 秒内报 `JD_LOGISTICS_PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION`。原因是 `planJdLogisticsN8nRun` 只要 `active.json` 指向另一 execution 且 `stage !== "completed"` 就永远拒绝。active 指向 10-30 的 execution 11037（`jdl-c74beae0-781f-4ee2-9d6f-8757b2695c1f`），其 manifest 为 `failed/JD_LOGISTICS_LOGIN_REQUIRED`，第一项 `exporting`、其余 `planned`，下载目录为空，通知 `pending`。

旧方案 `tools/close-jd-logistics-login-11037.ts` 依赖 n8n `execution_data` 中 11037 的哈希，该记录已过保留期，工具必然失败；按执行号硬编码闭合工具也不可持续。旧工具保留不动，不是新机制的依赖。

## 判定（只读）

`assessJdLogisticsZeroEffect(root, active)` 全部满足才返回 `zero_effect`，否则 `not_closable` 并给出原因：

1. manifest 与 active 的 runId、executionId、planHash 一致，且通过 `assertLogisticsManifest`；顶层无未知字段。
2. `stage=failed`、`outcome=pending`、`failure.stage=run`，失败码在白名单内。
3. 全部 operation 只含静态计划字段与 `stage`；`export`、`receipt`、`contentHash`、`rowCount`、`parserVersion` 及任何未知字段都使其不可闭合。仅首项可为 `exporting`，其余必须 `planned`。
4. `notification` 只有 `stage: "pending"`，无 response、result、requestHash。
5. `downloads/<runId>` 不存在，或只含（属于本计划 operationId 的）空目录；出现文件、符号链接或 junction、未知目录、过深或过多条目都不可闭合。

### 失败码白名单

`jd-logistics-session.ts` 的 `createJdLogisticsSessionGuard` 是这些码的唯一抛出处（全仓扫描，其余引用仅为 9851/11037 的历史目标与旧工具中的正则文本）。导出器只在 `exportJdLogistics` 入口与 `exportJhSource` 的导出清单落盘前调用该守卫；`exportEnabledProducts`、`exportFlowSource` 不再调用。因此这 13 个码都发生在任何导出提交之前。

纳入白名单（9 个）：`LOGIN_REQUIRED`、`LOGIN_CHALLENGE_MANUAL_ACTION`、`LOGIN_CONTROL_AMBIGUOUS`、`BUSINESS_FRAME_AMBIGUOUS`、`LOGIN_ORIGIN_REJECTED`、`LOGIN_STORE_MISMATCH`、`LOGIN_CREDENTIAL_UNAVAILABLE_MANUAL_ACTION`、`LOGIN_FORM_NOT_READY_MANUAL_ACTION`、`BUSINESS_FRAME_NOT_READY`（均带 `JD_LOGISTICS_` 前缀）。2026-11-28 起（白名单 v2）另纳入 `LOGIN_NOT_COMPLETED_MANUAL_ACTION`，共 10 个，见 [登录未完成可闭合](../jd-logistics-login-not-completed-20261128/REPORT.md)。

虽在业务前抛出、但有意排除（3 个，`JD_LOGISTICS_CREDENTIAL_RISK_SUFFIXES`）：`LOGIN_CREDENTIAL_REJECTED_MANUAL_ACTION`、`LOGIN_LOCKED_MANUAL_ACTION`、`LOGIN_SUBMISSION_UNKNOWN_MANUAL_ACTION`。它们表示凭据被拒、账号锁定或登录提交结果未决；闭合后下一次 A 会再次提交同一凭据，自动重试存在加重锁定的风险，故仍交人工。这是判断而非业务效果证据的缺口，需要时只改该常量即可纳入。

### 抛出点钉子

`tests/jd-logistics-zero-effect-closure.test.ts` 扫描 `tools/` 与 `lib/`：按文件和守卫函数体内出现次数比对各码，不钉行号；除守卫外任何新文件引用这些码、动态拼接 `JD_LOGISTICS_` 前缀、导出器新增 `navigate()` 调用，或 `navigate()` 晚于导出清单写入或导出提交，测试都会变红。

## 闭合流程

在 `planJdLogisticsN8nRun` 的计划锁内，先执行 `reconcileJdLogisticsZeroEffectClosures`（处理中断遗留），再读取 active。active 指向另一 execution 且 `stage=failed` 时调用 `closeJdLogisticsZeroEffectPlan`：

1. 重新判定；create-only 创建 `outputs/jd-logistics-pipeline/zero-effect-<executionId>-<activeSha256 前 16 位>/`（executionId 中非 `[A-Za-z0-9._-]` 字符替换为 `_`）。
2. 写 `active.original.json`、`manifest.original.json`、`intent.json`（版本、时间、闭合执行者、原 active 与 manifest 的 sha256、判定证据快照）。
3. 复验锁与证据未变，用不覆盖的移动把 `active.json` 移入目录并命名 `active.archived.json`。
4. 核对归档字节、原件、原 manifest 摘要，写 `committed.json`（含 intent 摘要）。
5. 继续按原流程建新计划。

原失败 manifest 不被修改。`not_closable` 时抛出的仍是原错误文案 `JD_LOGISTICS_PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION`（保持不变以免改动对外错误文案；是否自动重试并不取决于它：`jd-logistics-daily.workflow.json` 的 A/B/C/D 等业务节点失败出口都经「失败后释放原执行 helper」汇入同一个固定的 stop 文案「京东物流流程未完成；原计划与未决任务已保留，禁止自动重发导出或导入」，`classifyHourlyRetryFailure` 对该文案判为终局，测试已钉住这条链路，`n8n-hourly-retry-policy.mjs` 未改）；内部原因放在 `error.cause`。同一 execution 重入的既有逻辑未改。

## 中断续做

| 状态 | 处理 |
| --- | --- |
| 目录已建但无 intent，active 仍为原件 | 目录名与现行 active 摘要相符才续做，补写缺失文件，已存在文件必须字节一致 |
| 有 intent、无归档、active 仍为原件 | 重新判定证据与 intent 快照完全一致才续做，否则拒绝 |
| 已归档、无 committed、active 不存在 | 核对归档、原件、原 manifest 摘要后补写 committed，再正常建新计划 |
| 摘要不一致；active 与归档同时存在；两者都缺；intent 缺失或被改；多个未完成目录；committed 已存在而 active 仍在 | 全部失败关闭，保持原错误 |

## 11037 只读判定

2026-11-17 在主检出对生产目录只读运行 `inspect`（入口 `node --import tsx tools/jd-logistics-zero-effect-inspect.ts inspect <绝对根目录>`；该脚本使用 `import.meta`，只能独立存在，不得被 helper 打包闭包内的文件 import，否则 `tools/build-worker-helper.mjs` 会以 unreviewed import.meta 拒绝构建）（未写任何文件，未 apply）：判为 `zero_effect`。证据：`activeSha256=c34404de…57b7`（旧工具会据此算出恢复目录名 `login-11037-c34404deffc764f2`；该目录在生产上并不存在，只是同一摘要前缀的对照）、`manifestSha256=eb40de00…1231`、`failureCode=JD_LOGISTICS_LOGIN_REQUIRED`、`failure.stage=run`、`failureAt=2026-10-30T00:50:26.393Z`；operations 为 flow `exporting`，其余三项 `planned`；通知 `pending`；下载目录仅含空目录。发布后的下一次 A 将自动闭合并建立新计划。

## 人工收尾：残留的 zero-effect-* 目录

若日志持续报 `JD_LOGISTICS_PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION` 且 `error.cause` 为 `pending_closure_state_inconsistent`（或 `pending_closure_without_intent`、`multiple_pending_closures` 等），说明 `outputs/jd-logistics-pipeline/` 下留着没有 `committed.json` 的 `zero-effect-*` 目录，且状态与自动续做的三种情形都不符。

只读判断（不改任何文件）：

1. 列出目录内文件：`active.original.json`、`manifest.original.json`、`intent.json`、`active.archived.json`、`committed.json` 各是否存在。
2. 判断 `active.json` 是否存在，并计算它、`active.archived.json`、`active.original.json` 与 `intent.json` 中 `original.activeSha256` 的 SHA-256 是否一致；对原失败 manifest（`<runId>.json`）及 `manifest.original.json` 对照 `original.manifestSha256`。
3. 对照结果：
   - 摘要全部一致，只是缺 `committed.json`，且 `active.json` 不存在：属于已归档未提交，下一次 A 会自动补写，无需人工。
   - `active.json` 与归档同时存在、或两者都缺、或摘要不一致：说明有人或别的进程动过这些文件，不要让自动流程猜测。

人工收尾原则：**不得删除或改写任何证据文件**（原件、intent、归档、原失败 manifest），也不得手写 `committed.json`。需要放行时，先保留整个目录，确认原失败计划确无业务效果，再由有权限的人按「摘要一致、active 仅一份」把现场恢复到上表前两种自动可续的状态，或另行制定人工对账方案；拿不准就保持现状，计划保持阻塞好过误放行。

## 发布范围

见交付报告：`tools/jd-logistics-n8n-pipeline.ts` 运行在 helper 中，属 Worker 组件范围，无 Django migration。
