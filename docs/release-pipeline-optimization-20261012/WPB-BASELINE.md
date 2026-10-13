# WP-B 发布能力基线

记录日期：2026-10-12（Asia/Shanghai）。本任务只调查与交付文档；没有测试、构建、生产服务命令、发布、业务读取/写入、调度变更或清理操作。

## 固定范围与证据规则

- baseSha：**b3c6018cca6c2b2b5c8fa6c5b52e376f3a84f354**，2026-10-12 19:16:53+08:00 提交。本任务刷新 origin 后创建分支 **codex/release-wpb-baseline-20261012**，工作树 **D:/codex-isolated/release-wpb-baseline-20261012/运营管理系统**。
- 下列源码位置均固定在上述提交，不使用脏主检出充当候选。代码行号为该提交的起始位置；证据日期与适用范围另列。
- 按用户顺序读取最终收尾报告、SCOPE/REVIEW/CURRENT_RELEASE_REPORT/最终回执，再读 10-10 策略报告和启动优化。Git 后续检索至 baseSha，最新收尾文档提交为 1a39c3dce8657cdd452c95345528f48f759cea04；b3c6018c 补充缓存未全部通过的限制。
- 主检出未跟踪 PLAN-V3.md 只作本次计划上下文：只读时 SHA-256 为 801800026500789234fed9176a6abda86aea008ca0b4db75b9d6420675a59ff4，没有固定提交。其“19.7小时即T1”表述按当前用户要求纠正，不修改原计划。
- Git/CIM/任务采集区间见 [WP-0](WP0-INVENTORY.md)。22:09之后至22:20:42报告复核前，另只读文件、摘要、快捷方式和调度配置；没有执行任何 Status/Panel，包括安全 wrapper 本身。
- “完整实现”只指该行明确支持的合同，不表示无限范围覆盖、所有测试通过或常态生产验证。“已采用”包含限定历史调用/安装事实，须读同行边界；缺记录是“未证实”。物理文件/摘要/Task Action 存在不等于目前服务健康。

## 证据索引

| 标识 | 固定位置、记录日期 | 适用范围 |
| --- | --- | --- |
| E1 | [最终报告](../release-final-closeout-20261012/FINAL_REPORT.md)、[当前报告](../release-final-closeout-20261012/CURRENT_RELEASE_REPORT.md)，2026-10-12；固定 baseSha | f15 首次采用；不是所有今后发布 |
| E2 | [Root原回读](../release-final-closeout-20261012/evidence-final/ROOT_FINAL_BATCH_READBACK_V1.json) at 2026-10-12T11:09:43.511Z；[作者回读](../release-final-closeout-20261012/evidence-final/FINAL_CLOSEOUT_READBACK_V1.json) at 11:09:01.553Z；[原件清单](../release-final-closeout-20261012/evidence-final/MANIFEST.json) | 80条WAL、19项最新passed、六次unknown历史及73原字节保全；不代替当前live检查 |
| E3 | [v3实施报告](../release-no-data-policy-20261010/REPORT.md)，2026-10-10；[现行协议](../RELEASE_BATCH_WORKFLOW.md)，固定 baseSha | 10-10未采用结论已被E1覆盖；保留其隔离试验/未测范围 |
| E4 | [启动优化](../STARTUP_RELEASE_OPTIMIZATION.md)、[9-21生产回执](../evidence/startup-release-optimization-production-20260921.json)，2026-09-21 | 在线准备、同域重叠；历史单次启动不代表常态发布时长 |
| E5 | [进程期限交付](../release-process-deadline/DELIVERY.md)、[独立复审](../release-process-deadline/INDEPENDENT_REVIEW.md)，2026-10-10；固定 baseSha | helper隔离/原链复核；生产采用另看E1/E2 |
| E6 | [收尾机制报告](../release-acceptance-closeout/REPORT.md)、[历史离线报告](../release-acceptance-closeout/historical-draft-final/REPORT.md)、[历史JSON](../release-acceptance-closeout/historical-draft-final/report.json)，2026-10-10 | 真正离线生成样本，不是f15自动报告采用证据 |
| E7 | [停止选路修复](../release-maintenance-stop-route-20261012/REPORT.md)、[独立复审](../release-maintenance-stop-route-20261012/ROOT_REVIEW.md)，2026-10-12 | 修复未插入f15冻结包；原失败有限reconcile闭合 |
| E8 | [Status永久修复](../startup-status-receipt-safety-20261012/REPORT.md)、[只读候选说明](../startup-status-receipt-safety-20261012/NATIVE_DIAGNOSTIC_CANDIDATE.md)、[census报告](../watchdog-native-census-20261012/REPORT.md)，2026-10-12 | 永久修复源码12ffb44894e90dc6d503f05aa886670396bf3c68；实际wrapper最终e033，见E1 |
| E9 | [日备份采用边界](../release-fastpath-evidence/DAILY_BACKUP_ADOPTION.md)，2026-10-10；2026-10-12本次只读automation e | 原e仍PAUSED，22:30上海；未修改/启用，未调用备份 |
| L1 | 2026-10-12本次只读已安装文件、Task Action、快捷方式、摘要 | 有限本机元数据证据；未执行完整发布解析器或全树完整性验证 |

## 三个独立维度对照

20个能力单元，拆开包装/底层、冻结适配器/永久修复、安全wrapper/旧入口；不以源码文件数计功能数。

| ID / 调查项 | 实现程度 | 采用状态 | 固定源码位置、证据与适用范围 | 剩余缺口、影响与是否阻塞 |
| --- | --- | --- | --- | --- |
| A1 release-impact.mjs | 完整实现 | 已采用 | tools/release-impact.mjs:356/390/447/499；E1/E3；L1已安装字节等于base | CSS有限展示值/窄被动TSX＋完整部署输入/独立副作用复审；复杂查询、写入、迁移、依赖仍严格。普通零DB生产样本缺失，非调查阻断 |
| A2 release-batch.mjs | 完整实现 | 已采用 | tools/release-batch.mjs:64/108/224/324/378/453/513；E2；L1冻结字节不同 | WAL/唯一owner/started-before-action/unknown不重放/精确reconcile已执行。最新源码不能冒充原入口；新候选须重绑定，非调查阻断 |
| A3 release-batch-admission.mjs | 完整实现 | 已采用 | tools/release-batch-admission.mjs:87/93/158/239；E1/E2；L1字节等于base | 每动作复验源/制品/谱系/迁移闭包/状态，末原生观察年龄≤5秒；26次耗时有记录但无常态配对净收益，非调查阻断 |
| A4 release-no-data-observation.mjs | 部分实现 | 已采用 | tools/release-no-data-observation.mjs:15/44/89/102；E1/E3；L1字节等于base | 固定资源、声明式DOM、权限拒绝、自然两帧；通用display仍要求所有列举资源被页面消费。f15七项lazy CSS靠批准的有限补证闭合；不自动覆盖业务页。阻塞不能满足此合同的新观察方案 |
| B1 release-closeout-report.mjs | 完整实现 | 未证实 | tools/release-closeout-report.mjs:36/69/95/181/194/198；E6 | 离线样本已执行；f15每批自动生成/人工最终消费者未证实。渲染无写journal、acceptancePassed:null。非调查阻断，自动化采用待核 |
| C1 process-deadline.ps1 | 完整实现 | 已采用 | tools/process-deadline.ps1:10/36/60/67/114/129；E2 wal-000078；L1 helper相同 | 原内核句柄/退出码、限制继承、文件定长快照、共同期限、Direct/Preserve保留。同步OS/读文件不能硬实时抢占；不保证全部旧调用等效，非调查阻断 |
| D1 worker-local-release.mjs | 完整实现 | 已采用 | tools/worker-local-release.mjs:233/777/920/1924；E1/E4；L1字节相同 | 完整源/依赖/构建/helper/guard/指纹及runProcess保留；合约测试另有独立spawn须WP-5核四契约。非调查阻断 |
| D2 worker-local-release-rotation.mjs | 完整实现 | 已采用 | tools/worker-local-release-rotation.mjs:629/1055/1325/1424；E1/E2/E4；L1字节相同 | plan在线准备、sourceBinding、精确SHA/CAS/successor、保护入口；mutex helper单独协议待核。新来源不沿用已归档开发树路径，非调查阻断 |
| E1 release-preparation-evidence.mjs复用路径 | 部分实现 | 有证据确认未采用 | tools/release-preparation-evidence.mjs:39/109/156；E1最终测试限制；L1冻结模块不同 | 内存同批10分钟/24次，watch只失效，前后全字节重读。f15显式fresh无复用；默认缓存未获本次资格，旧missing-parent用例未闭合。阻塞启用该复用路径，不阻塞fresh |
| E2 release-payload-retention.mjs规划器 | 完整实现 | 已采用 | tools/release-payload-retention.mjs:15/51；E1/E2 installed-recovery-consumer；L1 Django字节相同 | 七天＋链末三包＋显式保护、完整目标摘要、保留元数据；实际新消费链无参数规划通过，非删除证据。非调查阻断 |
| E3 release-payload-retention.ps1执行器 | 完整实现 | 已采用 | tools/release-payload-retention.ps1:10/27/52/62/72/95；E1 Backup触发blocked；L1字节相同 | 安装位置/部署/ACL/互斥/引用/精确目标/审计/保留摘要；f15清理blocked且未删载荷。缺本批成功删除证据，非发布调查阻断，也不授权清理 |
| E4 release-history-preservation.py | 部分实现 | 未证实 | tools/release-history-preservation.py:52/63/98/124；E6 | 仅customer-service范围RR READ ONLY、HMAC外置key、scope/cutoff/身份/导入/标注/迁移generation；旧无行基线unprovable。跨域扩展及生产消费者未证，非调查阻断 |
| F1 release-lifecycle-step.ps1冻结适配器 | 完整实现 | 已采用 | tools/release-lifecycle-step.ps1:27/89/133/170（base合同）；E2原19步骤 | 原调用/输出/完整启动后置门已执行；f15 frozen c63e字节不同，Stop路由原失败靠有限补证，不能把未来修复追认到原调用。非调查阻断 |
| F2 全维护StopWorker永久选路修复 | 完整实现 | 有证据确认未采用 | tools/release-lifecycle-step.ps1:38/78；E7；L1 base97fa≠安装c63e | 原始对象容器、嵌套类型/ID/root/requests/keepPG/drainedStopped严格验证；匹配全维护选原Stop，不带IncludeBackend。阻塞用旧适配器重复同类全维护路径 |
| G1 release-daily-backup.mjs日调度包装 | 部分实现 | 有证据确认未采用 | tools/release-daily-backup.mjs:14/100/123；E9；L1仅文件安装 | started/result/失败晚到/锁前尝试保护齐；原e PAUSED。latestAttemptCoverageVerified:false、lastResult:unknown，无可信宿主最新失败覆盖。阻塞旧v2 reuse，不阻塞v3 not-required；不自行启用 |
| G2 Backup/Verify/隔离Restore底层 | 完整实现 | 已采用 | tools/django-postgres-maintenance.ps1:1075/1252/1687/2086；tools/postgres-consistent-backup.py:1999/2078；tools/postgres-backup-retention.ps1:82；E1/E2 | f15同点一次前Backup/一次已安装链Restore，内容/profile/sequence通过、隔离清理。可选RLS语法证明未测；非调查阻断，不等同生产恢复或附件/整机备份 |
| H1 integration_release_gate.py | 完整实现 | 已采用 | tools/integration_release_gate.py:66/272/354/363/394；tools/django-local-service.ps1:1764/3273；E1完整Django采用/Start后置，L1 gate相同 | 现有受保护integration/BI/delta代际门禁已接真实Prepare/Deploy/migrate调用条件；各命令本批独立运行日志未逐一归档。适用范围详见下节；非调查阻断 |
| I1 Worker-only排空切换序列 | 完整实现 | 未证实 | tools/release-batch.mjs:275/288；tools/worker-local-service.ps1:1693/1890；tools/django-local-service.ps1:4683；E3私有示例 | 原实现完整，f15实际为全维护/DeployApp，不是普通Worker-only零DB生产周期。需要首次真实限定采用/验收证据，阻塞宣称该周期生产验证或净收益 |
| J1 已安装安全只读wrapper | 完整实现 | 已采用 | E1/E8；L1 e033任务目标及九文件；tools/prepare-watchdog-native-status-driver.mjs、tools/prepare-watchdog-supervisor-status-driver.mjs（见路径核验节） | 限看门狗Backend/Worker/Supervisor，native缺字段补观察、保原判词/回执，不做清理；两新鲜自然帧已验收。非调查阻断，不证明全机旧入口安全 |
| J2 旧普通Status/Panel永久修复 | 完整实现 | 有证据确认未采用 | tools/django-local-service.ps1，12ffb448提交；E1/E8；L1 Django85cf | 最新源码终止CIM错误/不完整等待/ReadOnly Status graph不清回执；冻结85cf未热换。阻塞普通旧Status/Panel现场诊断，未来兼容候选需完整准备 |

统计（相互独立，不相加成“完成率”）：

| 维度 | 数量 |
| --- | ---: |
| 完整实现 / 部分实现 / 未实现 / 未证实 | 16 / 4 / 0 / 0 |
| 已采用 / 有证据确认未采用 / 未证实 | 13 / 4 / 3 |
| 条件性阻塞后续特定动作 / 不阻塞只读调查但有证据或范围缺口 | 6 / 14 |

条件性阻塞为 A4、E1、F2、G1、I1、J2。未证实并非证明缺陷；这里没有把历史源码报告“未采用”无条件传播到当前。

## 原协议、journal与报告生成

v3 not-required的支持能力已随新工具采用；本次实际封存并执行的是**v4 targeted-first-adoption**。其完整tools-no-migration源/迁移闭包允许一次前备份＋新安装消费链同点隔离恢复，执行前另获19步精确批准，取消后两DB阶段；不是执行中删旧步骤。

v3自身只有完整前驱/候选库存、原字节、非源码准备输入相同和精确独立副作用复审闭合时才封存零Backup/Restore，不依赖日备份/26小时点/七天演练。不宣称业务自然读写为零；GET分类也不能证明无写。v1/v2旧批次不升级、不改WAL/批准。

报告生成器离线校验batch批准摘要，原journal连续六位序号、canonical原字节、previous/hash、batch绑定和时间单调；拒未知operation，计算各原操作最新状态并保存unknown/failed/reconcile。逐回执/日志绑定摘要，投影允许字段，版本候选与独立运行观察分开。缺回执/版本/运行观察/完整交付时点写evidenceGaps；completed还要求全部passed且无cancelled。renderCloseoutDraft只是草稿，**acceptancePassed:null**，create-only生成REPORT.md/report.json/evidence-manifest.json，不写生产completed、不做独立验收。E6证明该机制曾真正离线使用，但未证f15已自动消费。

## 已安装字节与最新源码不能混用

本次只读 L1 的Worker根为：

D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T090355Z-21c2645a63247749

Django实际deployment.json SHA-256仍为 **85cf0699925aad21f98ae682f458789236d206723b10865939915d1bcacddd09**；快捷方式仍指21c Worker release。这只证明文件/绑定，不确认当前exact process或全部健康。

| 文件 | baseSha源码SHA-256 | Worker已安装工具SHA-256 |
| --- | --- | --- |
| release-batch.mjs | 01edc3e73053b642d0160cf6c7401fe18dfc3020adb4fb5421f45cd91b241b87 | e0d2e1d38e0416fca6bb4a61eb42ccf07baabb363493796dd54f3b8e50bf2ccc |
| release-preparation-evidence.mjs | 1195ef122425bae1dfa6cd90b0628b24886db50323200ef0ee1603cbdce4a685 | b7355e8f36efe8be54dc1980334f87f109372b1bd743639160064d4034235bf6 |
| release-lifecycle-step.ps1 | 97fa13025f47994b0305ef040eab8a09ae3f2cf6d461bdcf5967e83923e19bbd | c63e8fbaa5b02a13589538ab03468d07511b27a1dec44279a893d29c8467dbce |
| process-deadline.ps1 | 5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd | 相同 |

L1其他相同项：impact/admission/no-data-observation/worker-local-release/rotation/daily-backup。retention两文件及integration_release_gate与Django已安装工具相同。closeout-report与history-preservation只在完整source-snapshot内见到相同字节，Worker/Django可执行tools中未见；不能由snapshot包含就证明生产执行。

## 共同期限的实际契约与待核查点

process-deadline.ps1用CreateProcessW＋限制继承句柄的STARTUPINFOEX保存原进程handle；WaitForSingleObject确认直接退出后GetExitCodeProcess读取真实code（包括合法259），不以管道EOF代退出。stdout/stderr文件在直接退出后按固定长度读，合计上限默认1MiB、允许上限64MiB，输出/hash后再核同一绝对deadline。父预算取继承期限与自身期限较早者，系统PS固定模块目录并清library-only继承；超时保processEvidence，Preserve不杀生命周期后代，Direct只终止原held直接进程。同步调用迟到需拒成功，不能承诺硬实时。

Node runProcess是等效独立实现：exit/close区分、direct-exit-files或有界eof、原期限、输出上限、固定失败字段，生命周期preserve、只读direct、隔离构建tree清理分别选择。不因未用PS文件而要求迁移。E2 wal-000078保存两层exit0/共同deadline/有界输出协议；wal-000009保存原Backup exit1、timeoutType:null，不能写成“600秒超时”。

以下是本次支持范围内发现的**待核查调用族**，不是整仓所有外部进程的穷举。无动态复验，不直接定故障；后续WP-5可按风险增补调用图。

| 调用点（baseSha） | 退出码 | 期限 | 输出消费 | 进程身份 / 待核结论 |
| --- | --- | --- | --- | --- |
| worker-local-release.mjs:777 runProcess | exit/close真实code和signal | 绝对deadline/迟到复核 | EOF上限或文件快照 | 创建的ChildProcess；隔离taskkill树清理须另核PID复用。已有等效保障，不强制迁移 |
| worker-local-release.mjs:1323 runSalesContractTests | exit code＋TAP统计 | 自有10分钟timer，未见本函数夹紧继承共同期限 | 16MiB；在exit解析，可能仍有未收尽尾部待核 | 自建child kill；仅合约测试，不是服务Start。核短预算/最后输出，不自动定缺陷 |
| worker-local-release-rotation.mjs:935 acquireWorkerServiceMutex | 握锁LOCKED、释放close code | 获取30分钟；释放promise未见自有期限 | stdout128字符拒；stderr约1KiB | 独立mutex持有helper，跨长action持锁；核释放晚退出和父期限，不把长持有等同卡死 |
| django-local-service.ps1:245 Invoke-BoundedNativeProcess；maintenance Backup/Verify/Restore大量复用 | 保存LASTEXITCODE，缺失-1；JSON要求唯一对象 | 此函数未见等待timeout/继承夹紧；某下游另有1800秒等限制 | @(& exe 2>&1)先完整收集，Diagnostic才截断 | 这里没有held handle证据。核实际调用可终止性/总预算/EOF与限量；名字Bounded不证明四契约 |
| postgres-consistent-backup.py:1999/restore下游subprocess.run | returncode；超时独立异常 | 子命令timeout_seconds，未见继承绝对期限夹紧 | PIPE捕获后诊断截断，内存消费上限待核 | 由subprocess创建；pg_dump/restore及后代身份/超时收尾待核。不得重跑生产Backup证明 |
| django-local-service.ps1:1241 Invoke-WranglerRuntimeProcess | Process.ExitCode | 阶段timeout＋额外5秒清理/5秒EOF；不等同原共同预算 | ReadToEndAsync并有界等EOF，完整内存输出上限待核 | Process对象＋本夹具树清理；仅隔离R2 smoke范围，已有部分等效保护 |
| django-local-service.ps1:2784 pg_ctl；django-postgres-maintenance.ps1:1576隔离pg_ctl | Process.ExitCode形状待实机PS5核 | 前者timeout后另WaitForExit；后者45秒 | 文件/返回输出各自核，勿概括所有Start-Process | 正式PG启动与隔离PG启动分别核handle/创建时间/端口数据目录，不扩大杀树 |
| django-runtime-supervisor.ps1:405 Invoke-SupervisorStartOperator | 先取Handle，拒null ExitCode | 15秒轮询保pending，但无终态总预算 | 重定向文件，Tail64摘要 | 直接handle已持有；原Start可能仍持mutex，核pending续接/拒第二恢复，不贸然超时杀服务 |
| release-payload-retention.ps1:56/95 Node planner/resolve | LASTEXITCODE | 原同步native调用未见自有deadline | 整个JSON管道 | Node脚本只规划/解析；核调用者外层期限/原进程身份，不在本任务执行规划器 |
| operations-system-service.ps1:142 Invoke-ControlledScript | 直接ExitCode（PS5空值待核） | WaitForExit(500)循环无总上限 | 文件tail有限；增量ReadToEnd按文件时点，增长/JSON尾截断待核 | Start-Process wrapper/背景出生时间为部分证据；核真实持handle。旧status调用仍禁止 |
| operations-system-control.ps1:Panel后台启动/日志/Chrome；worker-local-service.ps1:1481 supervisor；watchdog:355恢复supervisor | launch PID不是服务成功；UI打开无业务成功合同 | 分别是持久服务/交互入口，不机械要求短命退出 | 服务重定向日志/独立回查，需分角色 | 查原receipt、birth、tree及后置ready；不把刻意长期进程视为漏超时 |

## 备份底层、integration gate及排空条件

真实调用：release-daily-backup → 系统PS5 installed django-postgres-maintenance -Action Backup -Execute → 原mutex/admission/runtime/PG身份及ready → Invoke-MaintenanceBackupCycle → Invoke-MaintenanceBackup → capacity → Python一致性备份 → pg_restore --list → manifest/dump/sidecar复验 → E归档/三份轮换。release payload清理在PG mutex外，避免倒置生命周期锁；数据库dump完成、E归档轮换、release清理是三个不同结果。

Python备份将导出snapshot和内容证据绑定到同一RR事务，pg_dump custom/compress6/--snapshot；no-new-keys按既有profile锁/权限边界处理，不新建生产密码或恢复密钥。Verify完整验manifest/sidecar/dump大小SHA、归档列表/领域证据，而不是实际Restore。RestoreRehearsal必须Execute＋ConfirmedIsolatedRestore＋精确manifest＋12位ID＋独立端口/目录，创建隔离PG/角色、恢复、重采内容/profile/sequence、停止精确实例并回查端口、删除隔离data，失败保独立清理状态。不恢复生产；policySyntaxWitness可选，f15没有该完整语法证明。E三文件独立受限ACL；先生成并复验新点及保留者后才淘汰旧点，保护项不为名额自动解除。

integration_release_gate不是通用“所有发布都再做备份恢复”的开关。真实调用方：

- django-local-service:1764受保护PrepareApp/DeployApp/migrate gate，显式delta evidence选择v4-netshop-presence；既有integration-release的后继Prepare走successor并核迁移digest不变，Deploy走release。
- 同文件:3273在固定django-sales runtime且gate文件存在时，migrate前database核已完成migration集合/无待执行计划；BI active追加走bi_app_addition.complete_database；有delta核139代际；固定数据库、owner和5432身份。
- django-integration-install.ps1:117/170为明确integration安装执行candidate/deployment；integration_install.py:19导入verify_backup_restore/deployment等；bi_app_addition.py:49/102复用父代与恢复证据。
- 初始/显式升级release证据可要求绑定前后备份/恢复；同迁移后继并不每次重新生成这些历史证据。不得为提速全局删gate，也不把本次tools-no-migration当真实迁移演练。没有直接业务UI/CI通用调用方证据。

Worker-only：同32位MaintenanceId；BeginWorkerDrain要求无完整维护、固定已部署app/ACL、KeepPG、原Wait-AutomationDrain与PG/备份console围栏；保留requests drain。StopWorker经MaintenanceStatus：无完整维护选StopForRelease（禁止IncludeBackend），匹配completed full维护才允许新版选原Stop。apply沿原plan/CAS，Start带ExpectedWorkerManifestSha256/ExpectedDjangoManifestSha256/ExpectedDrainId，同drain时BackendStartPolicy=RequireReady，后端不ready即拒，跳过接收器自动启动；最后完整组件/精确候选/无维护且同drain验证。EndWorkerDrain仅exact Worker＋helper同协议/ID、busy=false、storeExecutions空后CancelDrain并核门缺席。任一步unknown不重放。f15是EnterMaintenance→StopWorker→apply→DeployApp/HardenAcl→installed consumer/Restore→ExitMaintenance→Start，与该普通零DB周期分开。

## 安全观察入口的实际位置

本次真实Task Action/目录仍为：

D:/teruisi-runtime/operations-watchdog/versions/e0330d7aea1e17395cf56214c8c62e8d54c2e46359d30cce9296800c8802760c/

真正文件是 **watchdog-status-control.ps1、watchdog-status-backend.ps1、watchdog-core-overlay.ps1、process-deadline.ps1**，不是假定的“backend-status-readonly.ps1”。backend wrapper限制Status/AggregateStatus及Backend/Worker/Supervisor目标，按driver-binding核原backend/worker/supervisor/transport字节；dot-source只在library-only加载，再叠加只读Resolver/Worker census。生成来源见 [census报告](../watchdog-native-census-20261012/REPORT.md)、tools/prepare-watchdog-native-status-driver.mjs、tools/prepare-watchdog-supervisor-status-driver.mjs及其同目录证据源码；旧开发树已可能归档，不能硬编码其物理存在。

L1实际SHA-256：backend wrapper 7083dc98103adf1aabcfd0b715b8a933a0d4a97a0043f020ccf53cd3c3fd965d；control wrapper effae9851b920e36f6b28e128dc83d01eafb607c146e7248ed24b55bd69481b3；overlay 20b0d9781b8088b5ec48a245b47e77bf277af4bf273e49317d541edc11edbe7a。普通token native只读元数据、同轮前后CIM/held native句柄/末树身份复核；无跨轮TTL，不凭PID补造缺receipt。

该driver绑定主检出control0e87/worker717，二者与baseSha最新源码b7ac/ca15不同。Git快进也会写这些正式保护入口，须先协调运行绑定；不能仅因主树Git可快进就直接更新，详见WP-0。

**禁止现场验证入口**：未采用永久修复的普通权限旧django-local-service Status/AggregateStatus、旧operations-system-control Status/Panel（包括README中的旧调用）、operations-system-service status及npm system:status/菜单/桌面面板转到同旧路径的状态环。不因“Status名字”就判只读，也不直接调用旧watchdog根目录fallback。后续先核真实安装版本、绑定和安全wrapper合同；Task为Running也不代表健康。本任务没有调用上述入口或触发看门狗任务。

## T1 / T2 / T3：已测与未测

| 口径 | 已测证据 | 未测/不能外推 |
| --- | --- | --- |
| T1 批准→完整交付（含材料/Git/记忆） | f15批准2026-10-11T15:25:28Z→必要Startup 2026-10-12T11:08:10.973Z为19小时42分42.973秒；→completed为42.976秒。E6另一个历史批次批准→原文档交付10,021,661ms，不能混用 | f15完整交付终点未在本次读取的原交付回执中确认。19h42m是此特定故障批次必要验收/完成时间，**不是完整T1、常态基线或最低发布预算**；Git commit时间不能代全部交付时间 |
| T2 有证据支持的业务不可用区间 | E1七份离散采样和V2 599样本：static598×200/1拒连，ready588×200/10期限/1拒连；无凭据入口480×401/119×503；最大间隔33.079秒；维护/停止/启动WAL另见E2 | 跨夜17:32→00:40、00:53→01:25空档不回填；401是预期鉴权拒绝，503/拒连是有限样本。不能由单个ExitMaintenance/Start时点重建完整业务不可用时长；没有连续认证业务SLO或普通零DB配对 |
| T3 失败、补证、恢复分类 | 六次unknown；前Backup外层600.033秒后exit1/non-timeout；Restore666.826秒；末bootstrap285.307秒，准入192.455/185.217秒；26次非嵌套admission合计3544.472秒 | 机器/人工独占分类、UAC/休息/故障开发分项没有完整打点；残差不是纯空闲。T3通常包含在T1，可能重叠T2，**不与T1/T2相加** |
| 净收益 | 私有11步/36WAL/零DB72.494秒是隔离接缝；历史2Backup＋2Restore约50–55分钟为毛成本池 | 普通零DB生产发布与可比净收益均未测。不能宣称省50分钟、固定5–15分钟或常态19.7小时 |

原六次unknown分别涉及Backup外层、全维护后的Stop选路、已停止WSL引用守卫、Start完整就绪、首页按需CSS消费断言、自然看门狗期限。原失败保留，有限补证只追加reconcile；恢复开发、UAC、跨夜休息均计批准后等待，不移到准备阶段。92对象恢复是23直接终止叶子＋69持有对象自然退出，不是终止23原根；它是本批历史恢复证据，不授予重复执行。

215组合两轮各214/215，旧missing-parent没有闭合；定向通过不冒充整套全绿。自然两帧12组件/4探针成功只证明有限时点，未证明持续可用。用户关闭应用后的资源压力下降与通过相关，不证明所有旧超时根因。

## 后续任务与可能无需代码改动的结项

1. WP-1先在隔离CI核验证分层、依赖/制品来源与扩大规则；本调查不跑CI、也不把L2/L3列为已通过。
2. WP-5先核上表四契约及真实调用者，等效保障成立可直接记录；发现需要修改的具体证据再交WP-5G。Supervisor pending语义不能未经设计改为超时杀服务。
3. WP-4可立即读原WAL/独立回执重建T1/T2/T3；用区间并集处理重叠并保留空档，不等待CI施工完成。补f15真正全交付终点和普通零DB可比样本。
4. WP-2对齐已有分类/部署输入和v3/v4边界，可能仅规范说明；不扩大复杂查询/写入到display。
5. WP-3报告工具与原件绑定已存在；若下游仅需接入原离线输入/独立事实复核，可“无需代码改动”结项。跨域历史保全是另需明确范围的候选，不能假造旧行基线。
6. WP-5G可复用已在main的永久Status/停止选路修复做兼容候选准备；若待核契约无新必要缺口，也可“无需代码改动”。准备与生产采用分别授权，不热改冻结包。
7. WP-0G不是本次工作或发布优化前置门槛。工作树实际治理前逐项重核当前状态、归属、忽略材料与绑定；受管树只能应用归档。

## 文档交付与读取

只检查本次两份文档的链接、位置/命令和差异，聚焦提交并推送本分支；不合并main、不删除工作树。共享记忆只存可复用结论与证据边界。

下游无需改变主检出：

~~~powershell
git -C "D:\运营管理系统" fetch origin
git -C "D:\运营管理系统" show origin/codex/release-wpb-baseline-20261012:docs/release-pipeline-optimization-20261012/WPB-BASELINE.md
git -C "D:\运营管理系统" show origin/codex/release-wpb-baseline-20261012:docs/release-pipeline-optimization-20261012/WP0-INVENTORY.md
~~~
