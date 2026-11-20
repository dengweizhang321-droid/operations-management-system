# 京东客服分日回查 503 重试与已确认部分导入自动闭合

## 背景

志高初店等京东客服店铺的 n8n 流程为 A 计划、B 运行、C 核验。B 按日导出并逐日导入（写日文件、记录 `importingDate`、POST 导入、记录回执、回查批次、清除 `importingDate`）。

execution 11802 在导入 19 天后，回查 `GET /api/customer-service/import-history` 返回 503。Django `_consistent_read` 在客服修订号于两次读取间变化时返回 503，并发的 AI 标注写入会推高修订号。`verifyCustomerServiceBatch` 对任何非 OK 响应都拒绝为 `BATCH_READBACK_FAILED`，整轮失败，但批次实际已正确入库。

失败计划带有 19 份回执、等于最后一份回执日期的 `importingDate`、30 个 `dailyFiles`，失败边界步骤仍是过时的 `export_messages`。次日 A 发现未完成计划后，运营员闭合与导出前闭合都拒绝含回执或 `importingDate` 的计划，A 永久抛出 `PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION`，没有合规出口。四个店铺共用同一代码。

## 规则

1. 回查 503 重试：只有分页响应状态恰为 503 时，从第 1 页重扫，最多额外重试 3 次，退避约 2、5、10 秒（睡眠可注入，测试即时）。其他非 OK 状态、非法分页、歧义、不一致、未找到沿用原立即拒绝与错误码；重试耗尽仍为 `BATCH_READBACK_FAILED`。导入 POST 不重试。
2. 已确认部分导入闭合：新一轮 A 在运营员闭合、导出前闭合都不适用后，尝试 `closeCustomerServiceConfirmedPartialImport`；仍不适用则保持 `PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION`。必须同时满足：
   - `version===1`、`stage==="failed"`、`failureCode` 恰为 `BATCH_READBACK_FAILED`，无 `sourceRecovery`、无 `operatorVerification`，店铺身份与注册表一致。
   - `failureBoundary.version===1`、`browserClosed===true`，步骤为 `import_days` 或（旧计划）`export_messages` 且存在 `dailyFiles`；浏览器调试端口不可连接。
   - `source.list`、`source.messages` 均为 `downloaded`；`dailyFiles` 非空；回执非空且不多于 `dailyFiles`，逐项日期、会话数、`storeKey` 对齐。
   - `importingDate` 存在且等于最后一份回执日期；若 `importingDate` 无回执，POST 结果未知，不得闭合。
   - 每份回执用 `verifyCustomerServiceBatch` 实时回查通过；n8n 失败证据（含封存副本）的失败码与计划一致。
   - 写入前再次核对原计划字节与 active 未变。
   通过后在 `failure-closures/<executionId>-<planSha256>.json` 创建即只读写入回执（协议标记、`kind: confirmed_partial_import`、原 executionId、原计划 sha256、失败码、已核验批次、替代 executionId、完成时间），不修改原计划文件。已入库日期重新导入时由 Django 内容幂等返回 `duplicate`。
3. 失败边界步骤：`runCustomerServicePlan` 仅在 `dailyFiles` 保存后、逐日导入循环前把 `step` 设为 `import_days`。此前不变，`PAIR_PARSE_REJECTED` 的来源恢复仍要求 `export_messages`；导出前闭合与来源恢复的步骤白名单未改。

## 变更文件

- `tools/jd-customer-service-import.ts`：`verifyCustomerServiceBatch` 增加 503 有界重试与可注入睡眠。
- `tools/jd-customer-service-failure-closure.ts`：新增 `isCustomerServiceConfirmedPartialImport` 与 `closeCustomerServiceConfirmedPartialImport`。
- `tools/jd-customer-service-n8n-pipeline.ts`：A 增加第三条闭合尝试；导入循环前设置 `import_days`。
- `tests/jd-customer-service-import.test.ts`、`tests/jd-customer-service-readback-closure.test.ts`：新增测试。
- `docs/规范/导入与自动化.md`：客服规则补充一句。

## 检查结果

- `node --import tsx --test tests/jd-customer-service-*.test.ts tests/customer-service-import.test.ts`：105 项，97 通过，8 失败。8 项失败在未改动基线同样失败（基线 95 项 87 通过 8 失败，失败名单一致，与运行日期相关的日期窗口、n8n 候选与旧计划断言），本次新增 10 项全部通过。
- `npx tsc --noEmit -p .`：仓库已有大量既有错误，涉及本次改动文件的错误为 0。
- `npx eslint` 针对改动的 tools 与 tests 文件：0 错误，0 警告。
- 未运行完整 `npm test`，未连接生产 n8n、Django 或本机 3000/5678/5791 端口；测试以内存 fetch 与临时 n8n sqlite 夹具完成。
