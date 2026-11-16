# 客服分析：导入后后台自动 AI 分析（2026-11-16）

分支 `codex/cs-auto-ai-analysis-20261116`，基点 `origin/main` a7cf1e47。Opus 策划与反审，Sonnet 实现。
范围：Worker（cron 任务、分析库、页面提示）+ Django `backend/customer_service` 只读接口。**无迁移**。

## 需求

用户确认：「导入后后台自动分析」——客服会话导入完成后，不需要打开页面，系统自动对未分析会话做 AI 分析（现有手动「AI分析」按钮保留）。

## 现状（已核实）

- 手动分析：`app/customer-service-view.tsx` → `POST /api/customer-service/analyze`（`app/api/customer-service/analyze/route.ts`，operator/admin + 不受限数据范围，≤8 个 id）→ `lib/customer-service/analysis.ts` `analyzeCustomerServiceConversations(ids, principal)`：取快照、拼提示词、`generateConfiguredAnalysisReply`、解析、按 `expectedVersion` 写回标注。
- Worker 每分钟 cron：`worker/index.ts:59-101` `runScheduledMarketMaintenance`，每个任务用 `runScheduledMarketTask` 包裹、互不阻断。本机运行时由 `tools/start-local-worker.mjs` 定时触发同一入口。
- 后台身份：`lib/ai/background-principal.ts` `resolveAiBackgroundPrincipal(email, "null")`，`local-admin@teruisi.local` 走本地直连分支。市场标注的写法见 `lib/market/django-annotation-scheduled.ts:22-34`（要求 operator/admin 且 scope=null，否则不调用模型）。
- 模型限额（`backend/ai_assistant/chat.py:716-747`、`views.py:1050-1056`）：单次提示词 ≤ 48,000 字符；每个账号每天 120 次派发，全局 1000 次；`analysis-reply` 同时最多 2 个并发。
- 「未分析」：手动修改会把 `analysis_source` 设为 `manual` 但 **不** 设置 `analyzed_at`（`backend/customer_service/query.py:236-241`）。所以自动分析只能选 `analysis_source == ""` 的会话，不能用 `analyzed_at IS NULL`，否则会覆盖人工标注。
- 导入：自动采集与手工上传最终都进 Django `import_customer_service`，会话的 `last_import_batch_id` 指向最近一次导入批次（批次有 `completed_at`）。重复导入不新建会话；重导入保留原标注。

## 设计（方案 A：cron 扫描，不改导入路由）

### Django（只读，reader 进程）

新增 `GET /api/customer-service/conversations/auto-analysis`（放在 `read_patterns`，`development` 角色同样挂载），operator/admin，严格参数校验（沿用 `_unknown`），参数仅 `limit`（1–8，默认 8）。返回：

```json
{ "ids": [..], "pendingCount": n, "analyzedToday": m, "windowHours": 72 }
```

- 候选：`analysis_source == ""`，且 `last_import_batch_id` 属于 `completed_at >= now - 72h` 且状态 completed 的导入批次；**随机顺序**（`order_by("?")`）取 `limit` 条，避免反复失败的一批每分钟挡住其余会话。
- `pendingCount`：同条件计数。`analyzedToday`：`analysis_source == "ai"` 且 `analyzed_at >= 上海时区今日 0 点` 的计数（含手动按钮的 AI 分析）。
- 不做 `list_conversations` 那四个 COUNT。

### Worker

1. `lib/django/customer-service.ts`：新路径常量加入 `readerMethods`，新增客户端函数。
2. `lib/customer-service/analysis.ts`：**按提示词长度分批**。records 按顺序贪心装入子批，使每个子批的完整提示词 ≤ 40,000 字符；每个子批单独调用模型、单独解析写回，结果合并后保持现有返回结构。单条会话本身超长时，继续截短该会话的消息（按现有 24 条 × 300 字截断后仍超时，从末尾减少消息条数）而不是整批失败。手动按钮同样受益。
3. 新文件 `lib/customer-service/auto-analysis-scheduled.ts`，导出 `runScheduledCustomerServiceAnalysis()`，每次 tick 最多处理一批（≤8 条）：
   - 开关：`env.CUSTOMER_SERVICE_AUTO_ANALYSIS`，值为 `off`/`false`/`0` 时直接返回 `{ skipped: "disabled" }`；默认开启。
   - 执行账号：`env.CUSTOMER_SERVICE_AUTO_ANALYSIS_OWNER`，默认 `local-admin@teruisi.local`；经 `resolveAiBackgroundPrincipal(owner, "null")` 解析，`retryable` 失败直接跳过本轮；非 operator/admin 或 scope≠null 时跳过并 `console.error` 一行（不调用模型）。
   - 每日上限：`env.CUSTOMER_SERVICE_AUTO_ANALYSIS_DAILY_LIMIT`（会话数，默认 480，约 60 次派发，给同一账号的手动/助理使用留余量）；`analyzedToday >= 上限` 时跳过。
   - 未配置文本模型（`resolveChatModel(principal)` 为空）时跳过。
   - 有 ids 时调用 `analyzeCustomerServiceConversations(ids, principal)`；捕获配额 429（`ai_chat_quota_exceeded`）与模型未配置错误，返回 skipped 而不是抛出；其它错误照常抛出交给 `runScheduledMarketTask` 记录。
   - 所有 Django 请求带 `AbortSignal.timeout`（列表 5s）。
4. `worker/index.ts` `runScheduledMarketMaintenance`：用 `runScheduledMarketTask("customer service auto analysis runner failed", ...)` 接入，与现有任务并行或放在图片缓存之前，**不得阻塞**其它任务；返回对象加 `customerServiceAnalysis` 字段。
5. 页面：`GET /api/customer-service/analyze` 额外返回 `autoAnalysis: { enabled, dailyLimit }`（`configured` 字段与现有行为不变）；`customer-service-view.tsx` 标题区在 enabled 时显示一枚提示「导入后自动 AI 分析已开启（每分钟最多 8 条，每日上限 N 条）」。手动按钮与现有 8 条循环不变（`tests/customer-service-analysis.test.ts` 有文本断言）。
6. `docs/使用手册/` 下客服分析对应手册（用 `git grep -l "会话与聊天记录" docs/使用手册` 找）追加一段 2026-11-16 说明：触发方式、选择条件（只分析 72 小时内导入且从未分析、非人工标注的会话）、每日上限、开关与执行账号环境变量、限额共享提示。

## 不做

- 不改导入路由（`tests/jd-customer-service-bound-import-route.test.ts` 等用 esbuild 打包并固定依赖）。
- 不补分析历史积压（只处理 72 小时内导入的会话）。
- 不新增表或迁移，不改 AI 限额。

## 测试

- Django：`backend/customer_service/tests/` 新增：候选排除 manual / ai / 超窗口批次 / 未完成批次；`limit` 越界与未知参数 400；`analyzedToday` 只数今日 ai；非 operator/admin 403。
- Worker（`node --import tsx --test`）：
  - 新 `tests/customer-service-auto-analysis.test.ts`：关闭开关、身份失效、上限已满、无模型、无候选 → 都不调用分析；正常时以返回的 ids 调用；429 返回 skipped。
  - `analysis.ts` 分批：8 条长会话产生 ≥2 次模型调用且每次提示词 ≤40,000；短会话仍是 1 次。
  - 现有 `tests/customer-service-analysis.test.ts`、`tests/customer-service-read-scope.test.ts`、`tests/customer-analysis-recovery-interaction.test.ts`（若需浏览器则只确认未受影响，不运行）保持通过。
- 若 `worker/index.ts` 的定时任务有测试固定返回结构（`git grep -l runScheduledMarketMaintenance tests`），同步更新。

## 必需检查

Django 新增测试；Worker 相关单测；`npx tsc --noEmit` 仅比较本次触及文件。不跑全量、不构建。
