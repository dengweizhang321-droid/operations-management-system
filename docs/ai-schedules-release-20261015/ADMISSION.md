# 精确 0083 代准入与恢复兼容

本子任务仅开发、合成验证；未生产操作、未提交。基线 `927b853d`。请求 `gpt-6.1-sol/xhigh`，实际底层型号未独立确认。正式发布、候选构建和保护点取舍由主代理执行。

## 冻结实现与证据

- 新代际只允许原精确 142 加 `ai_assistant.0083_schedule_execution_profile`，迁移文件规范化 SHA-256 为 `de5f52254f6bd0df95f73fa253ec275ce7a5c23851aa108d2f3ae2231d333420`。未改旧 138/139/140/142 的登记集合、旧 BI/Jackyun/integration 指针、closed-key 或角色政策，不支持新备份豁免。
- `ai_schedule_addition_catalog.py` 固定两表的 18/8 个旧列、类型/null/default/collation、完整约束/FK、索引定义与有效/就绪标志、普通表与 RLS/无 policy、原两个触发器完整定义、共享函数体摘要/owner/config/ACL、精确表和列 ACL。143 只追加九列与五 CHECK。常量经独立隔离生成，并与主代理正式只读元数据逐项对账；不含业务行。
- `original_rows` 使用固定旧列次序流式哈希。安装先写 intent，独占事务只执行 0083，验证旧列保留及九列默认。已提交/未知请求禁止再迁移；仅在原 intent、计划和已提交完整目录一致时 reconcile 缺失回执。普通启动不要求业务字段继续保持默认。
- 备份只依赖只读目录，不依赖新 active/finalize，避免采用闭环。新独立 `ai-schedule-addition-active.json` 不覆盖旧父指针；父 142 一律用固定旧 baseline 验证。
- 仅本次候选可用 prepared Backup/Protect：绑定已审 evidence、prepared id/收据/manifest、原维护 owner、已停机的 KeepPostgres 窗口，原 service mutex 在 PG mutex 外。备份软件身份仍是当前 142，prepared 工具另存 manifest 字段。Plan 再精确绑定此字段，不能借用同窗口其他候选的前点。Protect 只认本次新 142 点；不扩展 prepared Unprotect。原三点/两 pin 上限、E 盘归档、幸存点全证据验证和清理规则保留。
- Plan 的前点 Verify 显式使用已验证的 `app.deploy-<id>` 工具；Finalize 使用新 installed 工具。Verify/Restore 仍走原 prepared 只读/隔离入口。

最终源工具闭包摘要：`ad495305af1d6a2901bdb77e32c36041bc385393b14ac6ac271ce8354c17dd5f`。全迁移树摘要：`eeeca0033aba72e1ccb7dee6021dae57fda4ddb0b9eb42b9544e2b23fc697a63`。

最终证明：[schedule-validation.json](../ai-schedules-stability-20261015/evidence/admission/schedule-validation.json)，SHA-256 `5e3e855754f134c0f554b8761b8bc8bd195b37eb50abcde3116062bee43a92be`。原目录 `.codex-tmp/ai-schedule-addition-fmunc4gi` 保留，证明绑定当前代码。测试从空隔离库固定 AI 0082 建精确 142，合成旧启停任务、sent/unknown 槽，在真实普通迁移 owner 下验证事务失败回滚、旧行保留、默认、权限；142/143 分别做 exported snapshot dump 和独立集群完整恢复，验证表行、角色、ACL、函数、策略、序列与目录。

真实 PG 负例覆盖删旧列、加额外列、删除/禁用 fence、`WHEN(false)`、`UPDATE OF prompt`、reader 表/列写入扩权、RLS/新 policy、失效/丢失索引、旧/新 CHECK、函数 owner 漂移、部分/未知迁移、重复迁移及闭锁角色开放。全部改动仅发生在隔离事务并回滚。源码/迁移哈希在证明结束重新核对，源与恢复集群均正常停止，临时密码文件删除。

8 项新准入单测、10 项原 Jackyun 单测、7 项 NoKey 证据单测通过；旧代际 10 项测试通过。两代 PS5/PS7 生成证据正向及未知/重复/部分负例通过；prepared Backup/Protect 双版本各九项负例通过。日志见 [admission 证据目录](../ai-schedules-stability-20261015/evidence/admission/)；单测与 prepared PS 控制台结果有明确标注的转录，PG 与两代 PS 消费日志保留原始输出。早期目录捕获及中间失败/旧 SHA 证明仍保留，不冒充最终结果。

## 唯一入口调用顺序

以下是主代理的执行模板；所有变量必须来自本次已审证据和原工具实际结果。不要从开发树直接调用生产迁移、备份或创建服务。`$taskPreparedRoot` 必须是 `Get-PreparedApplication` 验证的 `app.deploy-<id>`。

```powershell
# 1. 用完整候选 evidence 进行原 PrepareApp；主代理负责实际 SourceRoot/制品。
& "$taskSourceRoot/tools/django-local-service.ps1" -Action PrepareApp `
  -IntegrationEvidencePath $taskEvidencePath -IntegrationEvidenceSha256 $taskEvidenceSha

# 原唯一入口进入本次已批准维护/排空并停应用，保留 PostgreSQL 后：
# 2. 仅此候选的原 prepared Backup，仍记录 142 当前软件身份。
& "$taskPreparedRoot/tools/django-postgres-maintenance.ps1" -Action Backup -Execute `
  -PreparedToolAppId $taskPreparedId -PreparedToolAppSha256 $taskPreparedReceiptSha `
  -AiScheduleEvidencePath $taskEvidencePath -AiScheduleEvidenceSha256 $taskEvidenceSha `
  -AiScheduleMaintenanceId $taskMaintenanceId

# 3. 原 prepared Verify 和同点独立 RestoreRehearsal。
& "$taskPreparedRoot/tools/django-postgres-maintenance.ps1" -Action Verify `
  -PreparedToolAppId $taskPreparedId -PreparedToolAppSha256 $taskPreparedReceiptSha `
  -BackupDirectory $taskBeforeDirectory -ApprovedManifestSha256 $taskBeforeSha
& "$taskPreparedRoot/tools/django-postgres-maintenance.ps1" -Action RestoreRehearsal -Execute -ConfirmedIsolatedRestore `
  -PreparedToolAppId $taskPreparedId -PreparedToolAppSha256 $taskPreparedReceiptSha `
  -BackupDirectory $taskBeforeDirectory -ApprovedManifestSha256 $taskBeforeSha `
  -RehearsalId $taskBeforeRestoreId -RehearsalPort $taskBeforeRestorePort

# 4. 主代理按用户本次决定用原 Unprotect 解除指定 09/28 点，保留 09/29；
#    再用候选 Protect 绑定本次新 142 点（不绕过两 pin 上限）。
& "$taskPreparedRoot/tools/django-postgres-maintenance.ps1" -Action Protect -Execute `
  -PreparedToolAppId $taskPreparedId -PreparedToolAppSha256 $taskPreparedReceiptSha `
  -AiScheduleEvidencePath $taskEvidencePath -AiScheduleEvidenceSha256 $taskEvidenceSha `
  -AiScheduleMaintenanceId $taskMaintenanceId `
  -BackupDirectory $taskBeforeDirectory -ApprovedManifestSha256 $taskBeforeSha

# 5. 原有限采用 wrapper；同一 operation、window、source 和精确前点证明。
& "$taskSourceRoot/tools/bi-app-adopt.ps1" -AdditionKind AiSchedule -Action Plan -Execute `
  -SourceRoot $taskSourceRoot -OperationId $taskOperationId -MaintenanceId $taskMaintenanceId `
  -PreparedAppId $taskPreparedId -PreparedAppSha256 $taskPreparedReceiptSha `
  -CandidateEvidencePath $taskEvidencePath -CandidateEvidenceSha256 $taskEvidenceSha `
  -BackupDirectory $taskBeforeDirectory -BackupManifestSha256 $taskBeforeSha `
  -RestoreResultPath $taskBeforeRestorePath -RestoreResultSha256 $taskBeforeRestoreSha

# 6. 主代理通过原 DeployApp 切换该制品，传同一 IntegrationOperationId。
#    再由原 wrapper 的 owner 环境原子安装，仅允许 0083。
& "$taskSourceRoot/tools/bi-app-adopt.ps1" -AdditionKind AiSchedule -Action Install -Execute `
  -SourceRoot $taskSourceRoot -OperationId $taskOperationId -MaintenanceId $taskMaintenanceId

# 7. 原新 installed Backup + Verify + RestoreRehearsal 形成 143 同点证明后：
& "$taskSourceRoot/tools/bi-app-adopt.ps1" -AdditionKind AiSchedule -Action Finalize -Execute `
  -SourceRoot $taskSourceRoot -OperationId $taskOperationId -MaintenanceId $taskMaintenanceId `
  -BackupDirectory $taskAfterDirectory -BackupManifestSha256 $taskAfterSha `
  -RestoreResultPath $taskAfterRestorePath -RestoreResultSha256 $taskAfterRestoreSha
```

Install 结果不确定时保留原 intent/状态，不重放 Install；主代理核验后仅可用同 wrapper `-Action Reconcile`，不能手改 active 或已封存计划。完成后仍由主代理走原解除维护与启动入口。
