# 吉客云审计迁移采用准备

本页记录步骤 1–3 的准备，不是生产批准。原统一恢复业务实现见 [REPORT](REPORT.md)，五表验收和补跑边界见 [ADOPTION](ADOPTION.md)。Windows 临时管理员执行能力已核实；不修改 UAC、永久权限或现有服务入口。

## 有限迁移与旧谱系

只允许 `erp_reference.0003_jackyun_upload_audit_binding` 和 `sales.0011_jackyun_upload_audit_binding`，从权威 140 目录到 142。两文件的规范化源码摘要固定，旧 migration、BI active、139 原证明均保持；不接受 141、未知步骤、半列/坏索引或不完整回执。

复用 `bi-app-adopt.ps1 -AdditionKind JackyunAudit`、原服务互斥、维护、应用停稳、数据库身份、受限凭据和原 Backup/Verify/RestoreRehearsal。新 verifier 不创建第二个生命周期引擎。Plan 绑定干净 Git worktree、完整 prepared app、实际前驱、原 BI 父证明、隔离验证、同维护窗口内的新 140 备份及其精确恢复结果。DeployApp 只能使用该 operation；Install 在一个数据库事务内完成两个迁移并比较三个原表既有列的行数和摘要。原业务行不被修改。

Install 先落 intent。超时或响应丢失不得重复 Install；Reconcile 只查询原数据库结果，确认 142 与 intent 的旧行摘要一致后补缺失收据。仍为 140、内容变化或损坏临时文件时停止并保留证据。Finalize 接受完全相同的已复制证明以恢复中断，拒绝覆盖不同内容；普通启动必须等待精确 142 备份与隔离恢复已验证。

## 明确的采用顺序

限定批次协议 `teruisi-release-batch-jackyun-audit-v1` 保持 strict/full。旧 v2/v3/v4 的批准、WAL、顺序不改写。新批次只承载上述有限追加，并绑定同一 operation、source、prepared app 和维护 ID：

1. 在线只读前驱核验、不可变 Worker plan 和 Django PrepareApp；完整 Git 差异生成范围计划，封存候选后等待批准。
2. 获批后，经唯一引擎 EnterMaintenance KeepPostgres、确认任务排空和应用停止、StopWorker。
3. 原 140 Backup/Verify；同恢复点原 RestoreRehearsal；绑定实际返回的目录、manifest、恢复文件和 SHA。
4. 原有限 Plan → Worker apply → 同 operation 的 Django DeployApp → HardenAcl → 原有限 Install。
5. 已安装新消费链的 142 Backup/Verify → 同点 RestoreRehearsal → Finalize。
6. 同 ID ExitMaintenance → 唯一 Start → 完整组件、身份、权限、页面及业务只读验收 → 收尾。

备份保持 E 盘最多三份及原保护项规则。本次同时修改备份消费机制，需要 140/142 两个真实恢复证明；不是要求所有后续无迁移发布机械重复前后恢复。源码采用不包括正式 n8n 模板更新或真实补跑，二者按最终批准的范围另列精确动作。

任一失败或 unknown 保留 owner、维护、WAL、备份及真实失败记录。应用回退不撤销新增审计列，不丢弃新版恢复/导入记录；迁移后只能使用理解 142 证明的兼容候选或前向修复。生产数据库恢复是独立授权动作。

## 本轮隔离验证

证据根：`D:/codex-artifacts/jackyun-migration-adoption-20261013`。

- `postgres-final.log`：62 项通过、退出 0；真实事务回滚、旧行保全、141/未知/坏列/索引、普通角色权限负例；独立 140 和 142 集群使用原 profile 收集/pg_dump/pg_restore/内容、目录、角色 ACL 比较成功。源和恢复集群均停止，临时密码删除，无生产连接或外部效果。
- `.codex-tmp/jackyun-recovery-postgres-eh5g6oph/audit-validation.json`：绑定执行前后相同的门禁/生命周期/测试源码摘要及完整 migration 摘要，原始测试和恢复日志摘要保留。
- `release-final.log`：109 项通过，含新批次顺序/错范围/重复/unknown 不重放，以及 Windows PowerShell 5、PowerShell 7 原函数派发和参数作用域测试。
- `unit-final.log`：10 项；`legacy-frozen.log`：10 项。旧 139 正例使用政策所固定的历史源码，当前扩展目录仍被旧 gate 拒绝。
- `fastpath-private-final.log`：23 项通过。全局 npm 目录监听出现变更事件导致原批次回归失败的记录留在 `watcher-diagnostic.log`；同一原断言改用独立 Node/npm 测试夹具执行，未放宽生产监听或延长超时。
- `lint.log`：0 errors、112 warnings。首次回归及修复前失败日志保留，不称所有历史全量测试均通过。

真实 n8n 人工派发→Webhook→helper→A–E 采用原合成网关成功证据，只有候选 helper/工作流及关联业务实现逐字节相同时才复用。它不表示五表生产导入成功。

## 当前候选边界

现场生产前驱在本任务期间已两次前进；原 `21c2645a` 在线 plan 和后来的 `1513c2b2` 观察不得用于新采用。18:24 的 Worker 为 `20261013T091815Z-878966319497c4bd`，Django app fingerprint 为 `bafabc6e44d1dc9699e11b0d9738c286c83ec770b5ffb0c6b985fd56c6e54df1`。最终准备仍须再核身份和 manifest。

新组合从实际不可变 source-snapshot 逐字节复制，仅叠加本任务及必要门禁文件。Git 中的前驱表示提交用于完整 diff，明确不是伪称生产原始开发提交；保持所有范围外生产字节。具体候选、范围计划、plan/prepared 收据及剩余事项在在线准备完成后补充。
