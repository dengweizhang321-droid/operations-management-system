# 首次工具采用：一次备份与一次新消费链演练

用户已明确要求本次取消发布后 Backup/Restore；本次开发新批次协议，不修改旧 65fc 或 AB WAL。生产维护／切换和实际备份演练仍等待新精确范围批准。

1. 显式选择 `teruisi-release-batch-v4`，默认 v3 不变。v4 只支持 `targeted-first-adoption` 恢复政策：既有严格影响分类保留，不是 not-required/reuse。资格复用原 tools-no-migration 完整双 Django 原始清单／库存，Worker 完整差异恰十发布工具且 after 哈希等于当前执行工具。无资格、迁移／模型／依赖／PG 操作器变化、遗漏路径或重算假的工具证据均拒绝。范围改变必须新设计，不默默减免或回退成另一批准。
2. 必须恰一次 `backup-pre`，由原已安装 Backup 生成真实全库恢复点；恰一次 switch 内 RestoreRehearsal。严格次序：Backup → EnterMaintenance/停止 → Worker apply → Django DeployApp → HardenAcl → 新 installed 消费者只读计划验证 → RestoreRehearsal → ExitMaintenance → Start → 原完整验收与收尾。禁止 restore-pre、backup-post、restore-post、重复或缺失数据阶段。
3. Restore 只允许新已安装固定 operator，不接受 app.deploy 准备态或旧工具路径。必须使用前述 Backup 的确认 receipt 展开 BackupDirectory/ApprovedManifestSha256；原结果继续核 dump、manifest、expected/restored content 完全相等、productionDatabaseTouched=false、serviceStateChanged=false、profile/sequence=true、isolated_data_removed。失败保留原 owner/WAL/维护，不回放或删除失败步骤。
4. 原 Restore 代码只调用当前 app 的原 service/PG Python 工具，不执行 release-payload-retention。只有 Backup 尾部执行 retention，因此“旧 Backup＋新 Restore”不能单独证明新 resolver 的 retention 消费链。本协议额外使用固定内置只读步骤，从已安装 app/tools 执行原 release-payload-retention.mjs 无参数入口，绑定新 head 和实际安装工具哈希，不传 Execute、不删除载荷；然后再实际恢复演练。它证明规划消费兼容，不声称执行了保留删除。
5. makeBatch、verifyBatch、动作前采集和 databaseOperations 重算相同协议。只有选择 v4 且完整证据有效才产生新政策；旧 v2/v3 full 四阶段及 reuse/not-required 保持。SourceBinding、字节／路径／ACL／进程／ready／mutex／drain、原消费者与不可重放门禁不变。实际动作前再次以原收据和完整 app/app.previous 库存绑定部署阶段。
6. 仅改 impact/batch/admission，保持十运行文件范围。Worker verifier/rotation 无必要不改，D85cf 是否可复用仍须精确原始工具哈希确认。相关正负例覆盖政策篡改并重算 hash、阶段删减／重排、旧或 prepared operator、不同备份、consumer 缺失或非新 head、遗漏／漂移证据；私有原函数 seam 不冒称真实 PostgreSQL 或生产新消费链已执行。

源码事实：django-postgres-maintenance.ps1 的 Assert-MaintenanceOperationAdmission 明确允许同一 requests drain、drainedStopped 与已停应用／Worker的维护状态；Assert-MaintenanceRuntimeContext 复验当前部署／ACL。RestoreRehearsal 使用此入门并保留全部隔离监听归属、初始化／恢复／内容权限／序列验证及清理。原脚本未提供一个独立“新消费者已演练”布尔开关，本协议也不新增这种声明。
