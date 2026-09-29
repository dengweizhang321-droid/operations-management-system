# 第 1 项：备份持续运行与轮换闭环

**2026-09-29 生产更新：本项代码已随统一批次采用，现场修正及验收边界见[正式采用记录](OPTIMIZATION_PRODUCTION_20260929.md)。下文保留开发交付时的历史状态，不能将其中“待合并/待上线”理解为当前状态。**

日期：2026-09-29（上海时间）。范围严格限于总评估第 4.1 节与第 5 节。

## 协作与交付边界

用户已授权开发及隔离验证。本项使用 `codex/backup-continuity`，基线 `e00d4a82b2480d05646f5e0b65b13e9a2cc6bb7e`。遵守本轮并行约束：只推送本分支，不自行合并 main；不修改总评估，由用户指定的统一收尾对话更新。正式环境采用、服务维护和恢复每日调度尚未授权。

公共文件：`tools/django-local-service.ps1` 仅增加备份工具打包项及 `Invoke-BackupConsoleMaintenanceFence` 的 PostgreSQL 互斥；可能与第 4、7 项相交，组合时保留这些局部改动并复验锁顺序。`tools/release-payload-retention.ps1` 只补失败阶段与异常传播，不改七天保留、当前/回滚保护、进程检查或清理策略。其余文件为现有备份 operator、备份页面及对应测试；没有第 2—7 项实现依赖，也不改 supervisor 或 Worker 启停策略。

大型构建与恢复演练串行执行，执行前核查并行任务及进程；隔离测试仅使用本 worktree 的 `.runtime/continuity-tests`、`outputs/backup-retention/ui` 和独立恢复目录/端口。不会删除其他任务资源。

## 重新核查的现状

- 原 heartbeat `e` 为 **PAUSED**，原上海时间每日 22:30，既有提示词已使用受保护安装 operator 并识别返回的 E 路径；没有新建或更新调度。
- 已部署 operator：`D:\teruisi-runtime\django-sales\app\tools\django-postgres-maintenance.ps1`。Status 复核 E 盘三个恢复点；三份 dump 与 manifest/sidecar SHA-256 全部匹配；D 日备份暂存目录为零。
- 最新恢复点 `daily-20260928T145714Z-78107f0c7a59`，完成于上海 9 月 28 日 23:03:01，manifest SHA `2bbdb1c6826930476d1bb9b7c74438bb8af809ba5294dd56e13f5fa438a1b83e`，dump 822,888,546 字节。
- 保护项仍为 `daily-20260928T125351Z-31cb501bc72d`，SHA `36f3c99be1a9c23421547a70600006d0a05027e5bc40e5579e4d973189b14ad5`，占三份中的一个名额；未改保护或删除备份。
- 开始时 D/E 可用约 203.82/333.79 GiB；这仅是时点读数。
- Worker `20260928T112356Z-eeac7bbc96a8c51a` 为 `exact_release`，supervisor PID 32412、Worker PID 52044。没有备份控制台非终态任务。没有为核查启动、停止或重启任何正式服务。
- 历史自动发布包清理 blocked 的具体根因没有可重建证据，本次不宣称已复现或修复该历史根因。

## 已实现的候选改动

1. 继续使用一致性快照的 custom dump 与三文件恢复点，未改 manifest/角色/权限/迁移/内容验证协议、备份密码或恢复密钥。
2. 新增只读容量探针：校验数据库、角色、回环地址、端口后读取 `pg_database_size`。生成前 D/E 各保留 `2 × 数据库物理大小 + 1 GiB`；真正复制到 E 前再次检查 `三文件大小 + 1 GiB`。恢复初始化前检查目标卷 `32 × dump 大小 + 2 GiB`。这是保守准入估算，不是预留空间或对任意压缩率的保证；运行中仍可能因其他写入失败，旧恢复点保护与失败清理继续生效。
3. 复用现有 PostgreSQL operator mutex，将其接入维护标记的原子创建；页面 state.lock 与非终态 job 保护保持。直接 Backup/RestoreRehearsal 在原 mutex 内检查持久维护标记。发布包清理仍在释放 PG 锁之后才尝试 Worker 生命周期锁，避免反向锁顺序。
4. 新操作回执保存在受保护 `audits/postgres-operations/<id>.json`，记录阶段、容量、数据库备份结果、归档轮换、发布清理、失败类别/源文件行号/HRESULT/摘要。Status 展示最新操作、最近成功归档及未完成记录；中途中断留下 running，禁止自动重放，须人工核查精确回执。旧恢复点的成功时间仍由实际 Verify 后的 manifest 提供，不追写历史运行日志。
5. 清理异常保留原异常和失败阶段，不吞掉独立工具失败退出。只输出允许列出的固定原因，其余保留异常类型、错误 ID、源码位置与摘要；不记录凭据、原生命令参数或原始 stderr。历史 blocked 不回填成成功。
6. 归档或轮换失败后，重新核验准确的 E 或 D 存留副本；通过时数据库备份保持 completed，轮换单独 blocked。若存留副本也不合格则拒绝成功。页面和后台回执分别保留归档轮换及发布清理警示，不把文件在 D 暂存等同于 E 归档成功。

## 验证结果

| 验证 | 实际结果 |
| --- | --- |
| 备份/生命周期/准备相关 Node 回归 | 63/63 通过 |
| Python 备份内容、备份控制台、权限、启动环境、新容量探针 | 31 + 20 + 4 + 2 + 1 = 58 项通过 |
| 发布保留 planner | 4/4 通过 |
| PS5/PS7 原生行为 | 两种 shell 各六组脚本通过：容量/结果持久化、三份轮换、页面维护 fence、真实跨进程 PG mutex、库参数作用域、归档根及子文件 ACL |
| 合成浏览器验证 | 5 项通过，3109 独立端口；归档与发布清理分别告警、未知响应复用请求 ID、分块上传、恢复单独发起、非管理员无操作入口；桌面/移动截图已检查 |
| 全量 `npm run test:unit` 首轮 | 2681 项：2652 通过、7 失败、1 取消、21 跳过。7 个失败来自未准备 `.runtime/test-venv`；1 个菜单浏览器用例因全量并发下 30 秒超时取消 |
| 首轮失败/取消的定向复跑 | 创建本 worktree 独立 venv 并按原 requirements 安装后，相关六个测试文件 56/56 通过。未改这些业务实现；未将结果写成整轮全绿，也未为此重复整轮六分钟测试 |
| lint / 后端边界 / diff | lint 0 错误、12 项现有非本项文件警告；544 模块边界检查通过；`git diff --check` 通过 |
| 生产构建 | 本 worktree 最终构建通过；没有在主目录构建或启动新正式服务 |
| 真实隔离恢复 | 已通过：`d6b83d704f73`，独立 E 目录/端口 55891，上海 00:30:18–00:40:35；内容 SHA 相同、完整角色权限 profile 校验通过、138 条迁移证据保留；临时数据删除且端口释放 |

新增负向测试覆盖空间边界/不可用卷、恢复初始化前拒绝低容量、归档失败保留 D、E 发布后清理失败保留 E、存留副本复验失败拒绝成功、保护变化、不泄露诊断中的凭据、未完成操作阻止重放、历史成功不被后续失败覆盖、PS7 同秒多操作排序。清理异常仍按真实失败传播，维护与直接备份的竞争使用实际子进程互斥验证。

检查中修正了两处候选自身问题：PS7 将 ISO 时间反序列化为 DateTime 后若再转字符串会丢亚秒排序；阶段写入只核对审计路径及祖先，避免对整个在线 runtime 递归扫描。没有为测试关闭正式服务。

本次真实演练使用**现有已部署 operator**验证最新既有恢复点，未在正式环境采用候选脚本，也未生成新正式备份。恢复内容 SHA 为 `a5982f54b5acd84f587d1d0c36266daddaad85facff198e17fe54c365d35fa9d`，结果 `profileRestoreVerified=true`、`productionDatabaseTouched=false`、`cleanupStatus=isolated_data_removed`。结果文件保留在 `E:\TERUISI-Postgres-Rehearsals\restore-d6b83d704f73\rehearsal-result.json`；仓库只保存非敏感摘要，不提交数据库或原始业务数据。

结束回查：Running / Ready / exact_release，12 组件就绪；Worker release 与 supervisor/Worker PID 与开始一致。E 仍三份，原调度仍 PAUSED；main 仍为 `e00d4a82` 且干净。没有停启正式服务、迁移、正式部署或恢复生产数据库。

## 独立交付文件

- 运维：`tools/django-postgres-maintenance.ps1`、`tools/postgres-backup-continuity.ps1`、`tools/postgres-backup-retention.ps1`、`tools/postgres-consistent-backup.py`、`tools/release-payload-retention.ps1`。
- 公共接入：`tools/django-local-service.ps1`（仅上述两处局部修改）。
- 页面/后台：`app/database-backups.tsx`、`backend/system_backups/runner.py`。
- 测试：`tests/postgres-backup-continuity.test.ps1`、`tests/backup-direct-maintenance-fence.test.ps1`、`tests/test_backup_capacity.py`、`tests/django-postgres-maintenance.test.ts`、`tests/test_system_backups.py`、`tests/database-backups-ui.mjs`。
- 本说明与 `docs/evidence/backup-continuity-candidate-20260929.json`。本轮不改总评估、README 或 AGENTS。

依赖只有当前 main 已采用的三份保留、备份控制台、已部署 operator 和原维护锁；不依赖其他优化分支。分支、提交与远端回读状态以本聊天交付为准。

## 待统一收尾与确认的具体采用方案

1. 统一收尾对话逐项合并本分支及其他获准分支；重新跑组合后的备份、生命周期和构建测试。重点审查 `django-local-service.ps1` 的锁顺序与文件打包清单。组合后再准备 Django/Worker 候选并给出精确提交、候选 ID、摘要和前驱绑定。
2. 用户确认该具体候选与维护窗口后，复核在途 n8n/helper/导入/备份/恢复任务已排空，使用旧正式 operator 生成发布前备份、验证 E 三文件并做独立恢复；不为腾空间先删除旧恢复点。
3. 沿唯一 Worker 引擎 `EnterMaintenance -KeepPostgres`，采用准备好的 Django 与 Worker 候选，完成原退出维护/启动/12 组件、版本/启动绑定与备份页面验收。本项没有新迁移，不需要重启 n8n；最终组合是否包含其他迁移由收尾对话单独确认。失败按精确前驱和原兼容回滚协议处理，不覆盖生产数据库。
4. 使用新已部署 operator 验证一次新备份与完整回执、E 三份/保护项、归档失败隔离以及恢复清理；不在正式环境故障注入或强杀服务。既有历史恢复点保持保护，任何解除保护另行确认。
5. **单独确认恢复原 `e` 每日 22:30 调度**：复用原 ID、原目标聊天、原时间。补充先检查 operator Status 的 unresolved；备份返回 retention blocked 时保留已成功 dump 并停止追加生成，报告精确阶段。新策略返回 D 时不复制为“旧策略”，也不擅自执行删除/解除保护。修改已有提示词后才将原任务改 ACTIVE，不建立第二份调度。
6. 下一次自然运行独立 Verify 精确回执目录和 SHA，回查三份、保护项、归档/清理状态及最近成功时间；自然运行未完成前，调度持续运行验收仍是待办。正常/不变保持安静，只对失败、过期、空间不足或需人工处理通知，不额外新增外发渠道。
7. 上线前候选或基线变化则重新准备。分支/worktree 交统一收尾使用，本轮不归档、不删除；不会以开发通过冒充已采用或自然调度已验收。
