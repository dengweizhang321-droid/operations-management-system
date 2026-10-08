# 发布与数据库备份保留

2026-09-28 用户确认本约定并明确授权上线，本机已采用。Worker 保留源码 `73e60559` 的候选包，Django 运维修正最终为 `9b88f08a`；精确版本与验收见 [生产证据](evidence/backup-retention-production-20260928.json)。

## 日常规则

发布备份／恢复是否可以复用，按[发布批次协议](RELEASE_BATCH_WORKFLOW.md)的实际影响与当前证据门禁判断。此候选规则不改变三份／两保护策略，也不授权自动启用日常调度；备份机制或生命周期修改的首次采用仍须完整前后备份与恢复。

- Worker 完整发布包保留最近七个完整 24 小时。当前版本、最近两个前驱以及 `state/release-retention-protection.json` 中显式保护的版本保留完整包，即使超过七天。只对验证后的 successor 链内旧版本清理 `dist`、`helper`、`source-snapshot`、`node_modules`；其他清单、工具、guard、authority、successor 与审计材料保留，链外目录不自动清理。生产维护/发布与清理共用原生命周期锁，不以清理为由启停服务。
- PostgreSQL 沿用原一致性快照与 custom dump，以及现有 v1/v2 归档的角色、权限和内容验证。每个恢复点包含 `teruisi-sales.dump`、`backup-manifest.json`、`backup-manifest.json.sha256` 三个文件，不新增备份密钥。
- 正式恢复点在 `E:\运营管理系统业务数据`，最多三份。保护项占名额，最多保护两份以留下一个新备份位置，其余保留最新完成的备份。发布前后备份也计入。生成新备份时允许暂时第四份；先复制并验证所有保留项，再清理旧份和 D 盘重复件。磁盘空间不足、E 盘不可用、校验失败、保护项丢失或身份冲突时，不提前删除旧备份。
- D 盘原 `backups\postgres-daily` 继续作为受保护生成区。保留副本的三个文件在删除期间以不共享写入/删除的句柄保持打开，避免校验后被替换。所有删除绑定精确目录和清单摘要，并写入持久审计。历史待淘汰归档只使用容器完整性核验（完整三文件、manifest/sidecar/dump SHA、大小、数据库身份、归档条目与软件摘要），不把后来新增业务证据字段作为旧包删除条件；选中的三个保留点及保护项仍须通过完整业务证据验证。该容器模式仅供 Backup/Retain/Prune 内部盘点，Verify、导入和恢复不能使用。
- 成功备份后自动执行七天发布包清理。发布链忙或校验不通过时单独返回 `releaseRetention.status=blocked`，不把已经成功的数据库备份误报为失败，不自动重试清理。

历史的“30 天/至少 7 份”与未采用的“14 天/至少 7 份”目标由上述规则替代。旧策略函数保留用于历史兼容检查；正式 operator 只有在新策略已受控采用后才进入三份轮换。

## 系统设置 → 数据库备份

仅无数据范围限制的管理员可访问。Worker 保留同源写入检查和签名身份传输；Django 在每次请求及后台任务开始时复查当前管理员权限。普通 reader 不能接受写操作；不增加数据库账号权限或新业务表。

- **立即备份**：后台运行原已部署 operator；关页面不会取消或重放备份。
- **导出**：先通过原 Verify，生成包含完整三个文件的 ZIP。使用 Chrome/Edge 的文件保存接口按分块落盘，不把整个数据库包放入浏览器内存。下载每块验证 SHA-256。导出临时文件有效期 24 小时，后续备份任务清理过期导出副本。
- **导入**：只接受可信来源的系统 ZIP，最多 8 GiB；按 128 KiB 分块、连续偏移和摘要上传，重复同一块只复用一致内容。解包只接受三个固定普通文件，拒绝路径穿越、链接、重复条目、额外文件、加密 ZIP 和超限膨胀。上传完成后调用原 Verify，导入副本保存在 D 盘受保护临时区。
- **隔离恢复验证**：导入校验通过后由管理员单独发起。原 operator 在 55432–55999 的独立端口与独立 E 盘临时集群完成内容、权限和迁移回查，再清理临时数据库。导入副本不是已恢复的生产数据，也不会静默加入正式三份列表。
- **恢复生产**：本页面不提供直接覆盖生产的接口。使用已验证导入副本的精确清单摘要提出恢复计划，由用户明确确认目标、恢复点和维护窗口，再走原受控恢复流程。上传、隔离验证和本轮上线批准均不自动授权生产恢复。
- **保护/解除保护**：绑定恢复点和清单 SHA，保护项仍占三个名额。解除保护须明确确认已不再用于迁移回退。
- **结果未确认**：保留原任务编号，不自动重放；未闭合任务阻止后续任务。运维人员先核查原进程和日志再处理，禁止通过删任务记录来重跑。文件位于受保护 `backups\console`，不是业务事实源。

页面任务预留与进入系统维护共享同一个一字节文件锁。在相同锁内，任务拒绝现有维护标记，维护拒绝 queued/running/unknown 或损坏的备份任务；核查和维护标记创建不可交错。发布排空须包含这些备份任务，不能为上线中断正在生成或验证的备份。

导入临时包最多三项，可在页面清理；过期上传仍允许清理。数据库 dump 不包含 R2 外部附件字节或整机配置，不能当作整机恢复包。

## 受控采用步骤

1. 开发、测试和生产构建在独立 worktree 完成，合并并推送 main；生产流程遵守 [STARTUP_RELEASE_OPTIMIZATION.md](STARTUP_RELEASE_OPTIMIZATION.md)。构建及候选准备保持当前生产正常，切换须用户对本次发布明确批准。
2. 受控发布包含 Django 的新备份模块/运维工具与 Worker 的页面/薄路由。没有新增迁移，不修改既有数据库角色授权，也不重启 n8n。部署前复查现有每日备份自动化及其调用路径，避免重复创建调度。
3. 核实目前仍需用于跨迁移恢复的备份，并在已安装的新 operator 下显式采用策略。示例中的路径与摘要必须取自本轮真实 Verify，不能猜测：

   ```powershell
   $maintenance = 'D:\teruisi-runtime\django-sales\app\tools\django-postgres-maintenance.ps1'
   & $maintenance -Action AdoptRetention -BackupDirectory '<关键迁移前备份的精确目录>' -ApprovedManifestSha256 '<该备份清单 SHA-256>' -Execute
   & $maintenance -Action Retain
   # 核对计划与保护项之后，执行已获批准的轮换。
   & $maintenance -Action Retain -Execute -ConfirmedPrune
   ```

   `AdoptRetention` 只建立保护绑定并限定 E 根 ACL，不执行删除。已采用时拒绝重复采用。清理审计在 `audits\postgres-retention`；策略在 `run\backup-retention-v2.json`。E 的目录和文件只允许当前 Windows 用户、SYSTEM 和 Administrators，拒绝链接及权限漂移。
4. 原 Backup 命令在新策略存在时自动归档和轮换，返回的 `backupDirectory` 改为已验证 E 路径。检查现有自动化的归档步骤是否识别该路径，不能再次复制自己，也不能为新流程再建一份重复调度。
   本轮只读核验时，原每天 22:30 的 heartbeat `e` 为 `PAUSED`。保持该暂停状态；上线时只更新已有任务提示词以识别新返回路径和受控轮换，不擅自恢复调度。后续需用户要求恢复才改为 ACTIVE。
5. 验收管理员页面、拒绝越权、真实备份/导出清单、隔离导入恢复、D/E 三份规则、版本保护、当前进程/版本/启动绑定及全部组件。通过前保留必要发布来源，之后再归档已合并 worktree 和删除本次开发分支。

`Verify` 和 `RestoreRehearsal` 支持固定 E 归档根，以及固定 D 导入根 `backups\postgres-imports`；仍拒绝任意路径。生产备份创建/轮换只允许已安装 operator，prepared tools 继续限于 Verify 与隔离恢复。

## 验证入口

```powershell
.\.venv\Scripts\python.exe tests/test_system_backups.py
.\.venv\Scripts\python.exe tests/test_system_backup_permissions.py
node --test tests/release-payload-retention.test.mjs
# Scratch 必须是本轮显式创建的空临时目录，测试不连接生产。
powershell -NoProfile -File tests/postgres-backup-retention.test.ps1 -Scratch '<空临时目录>'
node tests/database-backups-ui.mjs
```

另运行相关 Django 生命周期、PostgreSQL 维护、Worker release/rotation、权限适配、设置导航测试，以及 lint、后端边界检查和隔离生产构建。浏览器验证使用合成 API，不等同于生产业务验收。

## 2026-09-28 生产验收

E 盘最终三个恢复点、D 盘日备份暂存为零；初次受控轮换移除 D 盘 99 个旧备份及重复目录。发布前备份独立恢复通过，约 823 MB 备份包通过公开接口完整下载、逐块上传、全文件 SHA-256 核对、导入及隔离恢复，导入临时文件已清理。最终备份已由页面接口生成并独立 Verify，保护项仍为发布前恢复点。

验收暴露并修正 E 盘权限函数边界/PS5 中文编码、后台 PowerShell 模块继承、历史归档业务字段兼容及清理库参数作用域问题，共进行了四次应用维护。最终 12 组件 Ready、正式资源 18 份字节一致、启动绑定、Django 守护、AI/Pandas/钉钉连接和两轮自然看门狗通过；PostgreSQL 与 n8n 进程未重启，138 条迁移清单未变化。一次原有并发启动运行意图保护拒绝，经原 Start 入口重试恢复，未修改该保护规则。

最终备份的自动发布包清理回执为 blocked，原通用 catch 未记录精确底层原因；随后通过同一已部署工具独立执行成功，当前无待删除载荷。原回执保留，不回写成自动成功。本轮期间四条原周报检查失败，后续自然执行成功，未手动补跑或补发。原备份 heartbeat e 已更新说明，仍保持 PAUSED。
