# 给集成任务 D / 共享脚本任务 C

本任务只修改 `release-batch.mjs` 的retry声明校验、原错误/尝试保留、精确只读Status执行接缝；只修改 `release-batch-admission.mjs` 的完整Status查询及create-only尝试证据。未改 `release-impact.mjs`，未重排共享文件，未改分类、生命周期、备份、恢复、业务或发布所有权协议。

## 新批次集成

1. 新collector与command.files的闭包加入 `tools/release-readonly-retry.mjs` 及其他本次使用辅助模块的精确文件SHA；最终组合源码/制品、原前驱及全部测试重新绑定。不能修改已经批准的旧batch或历史adapter来复用。
2. 精确最终Status操作可加入 `readOnlyRetry: {version:'teruisi-status-retry-v1',totalTimeoutMs:240000}`。仍声明原4个就绪/版本断言，完整12域组件通过collector验证。仅 `kind:'command', mutating:false, phase:'acceptance'|'closeout'` 与原SystemPS5、固定control脚本、精确7个argv获得资格，任何附加开关或Start皆拒绝。其他旧操作保持原行为。
3. collector完整Status重试只包裹那一项读取，其余完整tree/manifest/权限/前驱门禁不重试。CLI每次读取结果在固定发布审计根 `_observations/<batch-id>-<uuid>/<attempt>.json` create-only落盘，即使collector失败也有记录；成功时返回 `statusObservation:{value,attempts,elapsedMs}`。D的collector接口保留这个字段，原journal boundary admission携带attempts。Status子进程参数传输继续使用原PS5 UTF8/BOM协议。
4. `runApprovedOperation`将尝试以 `status:'observation-attempt', operationRef:<id>, observation:<record>`追加，不使用operationId，避免改latest/started/WAL恢复语义。父operation的duration已包含尝试/等待，不再次加子记录。未知仍按原独立协调，不重放变异操作。
5. 历史模块只对新行级基线调用。HMAC key在受限会话外置且两次一致；只留指纹。after沿用baseline.cutoff/scope。来源回执必须由独立核查实际batch/file/content/日期/原execution后的脱敏证据形成，提供原字节给compare。不会代查凭据或生产库。当前aggregate旧基线仍unprovable。
6. UI context禁ServiceWorker；候选resources是批准dist/client完整需要路径→SHA表（包括正常favicon），readPaths是独立审查的精确业务GET。调用audit安装→原实际Home任务UI→audit.finish；`status:'failed'`不能改成通过。新helper是可复用任务适配器，不更改产品鉴权。

## 报告接口

```powershell
node tools/release-closeout-report.mjs '<offline-input.json>' '<new-output-directory>'
```

input字段：`batchPath, approvedSha256, journalDirectory`；`receipts:[{path,sha256,operationId,format?}]`（format `operator-audit-v1`使用原audit.result，其余直接原回执）；`versionsEvidence:{path,sha256,format?}`（`customer-handoff-v1`投影原handoff，否则sourceCommit/candidateReleaseId/candidateManifestSha256/predecessorReleaseId/predecessorManifestSha256）；`runtimeEvidence:{path,sha256}`是原完整Status；`deliveryEvidence:{path,sha256}`取completedAt/deliveryCompletedAt；`executionLogs:[{path,sha256}]`；`observationReceipts:[{path,sha256}]`对应collector尝试；`unexecutedOrUncovered, limitations`仅经事实核对的非敏感说明。

报告只声明 `journal-completed-review-required` 或 `release-incomplete`，自动验收结论永远null。仍需独立验收/事实检查及精确运行包/恢复点存续核对。原started/unknown、回执缺口及原失败均保持。集成完成后另列精确commit和组合源码，不能从本任务main合入推定已生产采用。

本任务专用worktree因C/D集成和未提交验证/复审依赖继续使用；完成合并、推送与材料保全后按应用归档规程处理。主检出用户原修改保持，合并前检查最新main及共享文件差异。
