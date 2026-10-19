# Pi表导致日常备份校验失败

## 问题与修复

2026-10-19用户要求恢复每日备份并立即备份，再清理无用构建材料。已恢复原任务e，保持每日22:30上海时间。通过安装版Backup -Execute执行后，dump生成阶段末端的PowerShell证据校验拒绝`ai_pi_controls`：Pi0084/0085迁移和表已采用，但维护脚本的requiredTables未包含这些表。原操作b7cca205cc8f496dbc812de1729d941b以failed终态结束、databaseBackup=null，三份E盘原恢复点未变，未执行任何文件清理。

本修复为PowerShell证据校验补充0084的8张Pi运行表及0085的3张工作区表。0084须有AI域证据及精确0083前驱，0085须有精确0084；重复Pi迁移收据、缺表、缺前驱、无迁移表和未知AI表继续拒绝。历史未采用Pi的备份继续按原范围核验。没有改迁移、数据库数据、保留策略或备份工具部署保护。

## 验证

在独立worktree使用Windows PowerShell 5真实Assert-MaintenanceEvidence的合成fixture，执行：

```powershell
node --test --test-name-pattern='maintenance validates complete AI backup evidence' tests/django-postgres-maintenance.test.ts
```

通过。覆盖Pi运行/工作区正例、11张表逐张缺失、前驱/迁移缺失、重复收据、未知Pi表、缺AI域以及原历史AI代际边界。没有访问生产数据库。测试中的旧AI_TABLES快照断言更新为现有AI_TABLES_PRE_PI_RUNTIME时代名称，以继续核历史65表快照。

## 交付边界

源码准备完成不等于已安装采用。不得热改安装版运维脚本或伪造已安装清单；备份运维工具上线后才能按原Backup入口重新执行并独立Verify。用户现有清理授权范围已独立复核：4套依赖node_modules约2.747GiB，3份旧普通Git source工作树约0.426GiB；只有成功备份且独立Verify通过后执行。28份七天内运行包、其余未闭合来源、外层发布证据和共享依赖保留。

现场证据：D:/codex-artifacts/disk-weekend-cleanup-20261019/，含任务恢复、失败原操作、精确清理计划及独立审查。未部署修复、未成功生成新恢复点、未删除候选文件。
