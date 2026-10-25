# WP-5 / WP-5G 发布可靠性调查

日期：2026-10-12（Asia/Shanghai）。结论：确认并最小修复 **1 个必要缺口**，即普通服务包装器在 Windows PowerShell 5 下将真实非零退出误判成功。其他调用族保持已覆盖或待核查，不因未接入 helper 自动判缺陷。修复仅为本分支候选，未生产采用。

## 固定基线与交付边界

- baseSha：`b3c6018cca6c2b2b5c8fa6c5b52e376f3a84f354`，创建前 `git fetch origin` 得到的最新 `origin/main`。
- 任务1依赖SHA：`74c5e6330b88248c7ebcc778e32310c5b46631d3`；使用 `git show <此SHA>:docs/release-pipeline-optimization-20261012/WPB-BASELINE.md` 读取，未把主检出的未跟踪文档当固定依赖。
- 分支：`codex/release-wp5-reliability-20261012`；独立工作树：`D:/codex-isolated/release-wp5-reliability-20261012/运营管理系统`。主检出已有改动保持原状。
- 修复提交：`2f21c238d2a4766caad547d08be63acab769ab08`，仅产品包装器和两份测试；调查/证据另作聚焦文档提交，其精确SHA以最终交付和远端回读为准。
- 先读共享 Home、Preferences、Long-term Goals、Workflows及相关发布记忆，再读 AGENTS、README和开发交付、验证发布、运行启动、系统架构规范。Daily Reviews仅存在一篇日期复盘，未虚构第二篇。
- 未执行生产启停、部署、备份、恢复、清锁、调度修改、数据写入或外部发送。现场仅读取安装文件、摘要及 Task Action；没有调用旧普通 Status/Panel或触发看门狗任务。首轮既有测试的 HTTP 隔离缺口另记于验证节，不能概括为“完全未触达生产端点”。
- 不合并 main、不删除工作树，由任务6统一集成。本文不授予后续生产采用或恢复权限。

## 历史闭合与根因、采用分别判断

先读 [最终报告](../release-final-closeout-20261012/FINAL_REPORT.md)、同目录 SCOPE/REVIEW/CURRENT_RELEASE_REPORT及 [最终原回读](../release-final-closeout-20261012/evidence-final/FINAL_CLOSEOUT_READBACK_V1.json)，再回溯四份指定历史报告与 [9月29日采用记录](../历史记录/性能与发布/optimization-production-20260929.md)。最终原回执：80条WAL、19个最新状态passed、19:08:10.976上海completed、旧73条字节保留。这闭合 **f15批次事件**，不是全类缺陷关闭证明。

| 问题 | 历史事件及实际闭合范围 | 根因/修复/采用判断 | 剩余边界 |
| --- | --- | --- | --- |
| Backup外层exit1 | 600.033秒后exit1，timeoutType=null；实际备份经审计、独立Verify及有限reconcile闭合，没有重复Backup | 底层成功与外层失败分开；未证全部exit1底层原因已修复。helper与新消费链已采用 | 不能称600秒超时；不能把本次服务包装器exit9反例归为该Backup事件根因 |
| 全维护后的Stop耦合 | 原StopForRelease拒绝已完成全维护，实际已停结果经有限补证协调 | [永久选路修复](../release-maintenance-stop-route-20261012/REPORT.md)已入当前源码：先严格验MaintenanceStatus再选原Stop，不带IncludeBackend；未插入f15冻结适配器 | 后续兼容候选仍待采用；不重建引擎或放宽维护门 |
| WSL前驱引用守卫 | 原已停止WSL相关unknown经精确只读资格证明与有限补证闭合 | 事件已协调；[WSL宿主取证范围](../release-site-blockers-20261011/WSL_HOST_READONLY_SCOPE.md)和该目录原报告是不同历史阶段，不能用较早“未闭合”否定后来f15回执 | 本轮未重新枚举HCS/Guest或执行guard。缺字段、系统宿主、cwd、namespace、出生时间等通用覆盖仍待实际候选核验；不作名称豁免 |
| Start完整就绪 | 原unknown靠后置精确进程/完整就绪/维护与排空状态补证协调，未重放Start | 原helper及完整Start后置合同已采用；本轮源码仍要求精确manifest、release、PID、启用组件、无意外维护/排空 | 历史23份configFingerprint未伪造；修复一次包装器退出码不证明所有Start故障根因关闭 |
| CSS观察 | 原首页消费全部8份CSS断言失败；限定394 UI成员无变/10工具差异的补证采用8 GET200精确字节及首页index消费、14px、零非GET | 原断言没有被追认为真；只闭合该批准范围，七份lazy CSS不自动全由首页消费 | 通用资源消费合同仍待任务5；本任务不修改观察器或报告体系 |
| 自然看门狗期限 | 安装e033后仍有39.551秒Unresponsive、69.152秒失败；后来两新鲜同身份健康帧及最后Startup闭合 | 同轮重复CIM优化、安全wrapper已采用；资源变化与通过相关，不证明全部旧超时原因 | 3秒HTTP/60秒共同期限未放宽；两帧不等于持续SLO |

上述六项unknown原失败不删、不改WAL，有限reconcile不构成自动重放许可。

| 指定回溯项 | 已证根因和修复范围 | 采用及未证范围 |
| --- | --- | --- |
| [SUPERVISOR_EXIT_DIAGNOSTICS_20260929](../历史记录/性能与发布/supervisor-exit-diagnostics-20260929.md) | 真实断管复现未处理EPIPE，窄处理EPIPE及有界诊断修复该独立错误路径 | 9月29日已采用；两次历史supervisor消失根因仍未明，未发现日志不能证明OOM或外部终止者 |
| [WORKER_LIVENESS_RECOVERY](../运维/监控与恢复/worker-liveness-recovery.md) | outer Wrangler仍存活而inner workerd不响应时，通过原live连续失败、身份/端口/退役门及预算恢复 | 当前supervisor已接该机制；早期文档“待采用”不是当前完整状态。只覆盖HTTP存活，不拿Django readiness失败触发Worker恢复；不证明内存泄漏已解决 |
| [WRANGLER_SELF_CHECK_STABILITY_20260929](../历史记录/性能与发布/wrangler-self-check-stability-20260929.md) | 无响应横幅版本请求真实维持socket；固定版本子环境隐藏横幅阻断此路径，保留完整R2门 | 9月29日真实Prepare/Deploy自检采用；错误路径仍可能联网，长persist路径失败未确定底层Windows根因；不能泛化全部历史自检超时同源 |
| [WORKERD_INSPECTOR_RETENTION_FIX_20260929](../历史记录/性能与发布/workerd-inspector-retention-fix-20260929.md) | 真实SDK调试代理无前端仍Network.enable及强引用消息缓存；连接门和双限额回移修复可复现累积 | 9月29日已采用；改善属于代理而非业务isolate，历史三次OOM不能逐次归因，短实验不证明任意负载或整机内存上限 |

## helper与实际调用图：四合同

精读 `tools/process-deadline.ps1`：CreateProcessW/STARTUPINFOEX仅继承限定文件句柄；从创建到退出持原kernel handle，WaitForSingleObject后读真实GetExitCodeProcess（259也是合法退出值）；固定长度stdout/stderr快照，默认合计1MiB、最高64MiB；继承绝对期限与本地期限取早者；输出/hash后再核同一期限。系统PS5固定模块路径并清library-only继承；失败保processEvidence。Preserve不杀生命周期，Direct只终止持句柄的原直接进程，不枚举后代。

同步OS/文件调用不能硬实时抢占，晚返回应拒迟到成功。helper完成只证明运输完成，非零码仍由调用方拒绝，JSON/后置身份/就绪也须各验。

实际接入链：`release-lifecycle-step → 原Worker/总控/Django`；`operations-system-control → 后端聚合/Worker`；`worker-local-service → 后端Status/Start/Stop、Node resolve/verify`；`operations-system-watchdog → 各受限探针`。生命周期选Preserve，只读探针选Direct。Node `worker-local-release.runProcess`是独立等效实现，不要求机械迁移。

下表为本次风险定向调查，不是整仓外部进程穷举；行号以baseSha为准。未做动态复验的行只列待核查。

| 调用点 | 退出码传播 | 共同期限 | 输出消费 | 身份/结论 |
| --- | --- | --- | --- | --- |
| process-deadline:129及上述直接调用方 | 真实码/null拒绝，调用方非零拒绝 | 绝对deadline包含等待、快照、hash；调用方后续组合另核 | 限量定长快照，不等EOF | 原held kernel identity；本轮PS5/7隔离负例通过，已覆盖运输合同 |
| worker-local-release:777 runProcess | exit/close分开，保code/signal；失败保processEvidence | 共用绝对期限与末检查 | direct-exit-files或有界EOF、限量 | ChildProcess身份；本轮直接退出、EOF超时、Direct后代保留通过。隔离tree清理仍用PID taskkill，PID复用硬边界未本轮复现，不外推为所有身份均已闭合 |
| worker-local-release:1323 runSalesContractTests | exit/TAP成功条件严格 | 自有10分钟timer，未见夹紧继承期限 | 16MiB，但exit时组合TAP，尾输出排空待核 | 自建child；仅合约测试调用，未复现迟到/尾部丢失，待核查 |
| worker-local-release-rotation:935 mutex holder | LOCKED及close码，非零拒绝 | 获取30分钟；释放等待未见自有期限 | stdout128字符/stderr摘要 | 专用持锁child；父deadline/异常释放/晚close待核，不能因长期持锁就称卡死 |
| django-local-service:245 Invoke-BoundedNativeProcess及maintenance调用族 | LASTEXITCODE/null→-1；本轮PS5/7真实19失败正确传播 | 同步native无本函数绝对期限，部分下游有自有timeout | 先完整捕获，后诊断截断；不是内存输出上限 | 无held native证据；调用角色不同，EOF/全预算待核，不因名字Bounded认定完备 |
| postgres-consistent-backup:1999/恢复subprocess.run | returncode与TimeoutExpired分开 | 子命令自有timeout_seconds，未见父绝对期限夹紧 | PIPE完整收集后诊断截断 | subprocess直接child；输出限量、后代/超时收尾待隔离PG验证；本任务未运行Backup/Restore |
| django-local-service:1241 Wrangler runtime process | Process.ExitCode/非零失败 | 阶段timeout另有5秒清理与5秒EOF，不等同父预算 | ReadToEndAsync，有界EOF，完整内存限量待核 | 自建Process＋该隔离自检树；已有部分等效，未强制迁移或重跑真实R2 |
| django-local-service:2784 Invoke-PgCtl、maintenance:1549 Invoke-MaintenancePgCtlStart | 两处Start-Process后转int，PS5实际pg_ctl码待核 | 40秒/45秒及不同收尾；前者另parameterless WaitForExit | 各自重定向文件；完整/增长边界待核 | timeout按PID终止和null码风险仍是线索；未用生产PG或模拟PG替代真实合同，不自动归因或改动 |
| django-runtime-supervisor:405 Start operator | 已持Handle、拒null码 | 15秒一轮pending，无终态总预算 | 文件Tail64摘要 | 原Start可仍持生命周期锁；保unknown/pending且不发第二恢复，未改成超时杀服务 |
| release-payload-retention:56/95 planner/resolve | LASTEXITCODE失败关闭 | 同步native未见自有总期限 | 整个JSON捕获 | 父外层预算及进程身份待核；本轮未执行规划器或删除 |
| operations-system-service:142 Invoke-ControlledScript | **旧PS5 exit9被接受；本次持Handle/拒null修复** | 500ms循环无终态总期限，本次不变 | 文件，JSON只取末4000字符，ReadToEnd增长/总量仍待核 | direct Process固定身份补齐；未重写传输和进度输出，见修复报告 |
| Panel/Chrome/日志、Worker与watchdog启动Supervisor | launch PID不等于就绪/成功 | 持久服务或UI按角色观察 | 独立日志/回执及后置门 | 不机械要求长期进程短命退出；实际receipt/birth/tree/ready仍需原引擎 |

## 锁路径、持有范围与异常释放

| 锁/路径 | 获取顺序与持有范围 | 释放/嵌套及剩余验证边界 |
| --- | --- | --- |
| 系统互斥 `Operations.SystemControl.v2` | 总控Start/Stop及service Stop/Restart非阻塞先取系统锁；Start服务包装器委托总控自己取锁 | try/finally释放并Dispose；拿不到拒绝/报告在途。service不先持同名锁再调用总控Start，避免跨进程自阻塞。本轮异常后另一进程能取得测试命名空间锁 |
| Worker `Worker.LocalService.v1` | Worker全部mutating Actions取锁覆盖动作；Start允许有界等待并夹紧WorkerOperationDeadline；其他争用拒绝 | 获取异常释放，顶层finally释放。维护时Worker锁内调用Django service锁；本轮争用期限/Stop拒绝/失败不继续Start通过，未用生产mutex |
| rotation named pipe `Worker.ReleaseRotation.v1` | plan/apply先rotation锁，再Worker mutex；release-batch将有效rotation lease传给子动作，避免重复获取同pipe | finally先serviceLock再releaseLock；在线prepare明确在构建阶段释放Worker锁、关键边界重取并复验，不释放rotation lease。mutex helper退出/释放无总deadline待核 |
| Django service `DjangoSales-<canonical-runtime hash>` | 顶层Start/Stop、Deploy/Harden及domain动作；覆盖完整core/domain生命周期。维护/排空在Worker→Django路径内 | .NET同线程嵌套域调用可重入，每层finally对应释放。普通争用30秒，Start最多900秒，自有预算与父期限待核；维护与desired-state fence仍保留 |
| PostgreSQL maintenance `DjangoPostgresMaintenance-<runtime hash>` | maintenance operator5秒获取，覆盖Backup/Verify/Restore/归档与备份轮换；Django排空/backup-console fence在Django锁内取得同PG锁 | finally释放；排空遇AbandonedMutex须先证原备份结果并失败，不能仅因拿到锁推安全。**release payload清理在PG锁释放后**才取Worker锁，避免PG→Worker与Worker→Django→PG倒置 |
| backup console byte0、background/activity byte0 | Wait-AutomationDrain先helper阶段，再backup-console fence（PG锁→console字节锁），background lease排空后设requests阶段，再activity lease；最后短PG fence围栏 | 文件锁每个try/finally Unlock/Dispose；队列/unknown保门、超时保服务，gate是持久owner状态而非自动解锁许可。不同角色不一律相同AbandonedMutex语义 |
| Django supervisor run mutex | supervisor单实例锁覆盖Run监视循环；恢复Start子进程另取Django service mutex/desired fence | finally释放；长pending保持unknown、不可第二恢复，不因15秒轮询视为deadline缺陷或重放机会 |

文件锁、system maintenance、automation drain、release batch owner是不同机制。上述顺序来自当前调用体，不是全OS无环证明；外部自动化、unknown helper晚退出和跨进程混合版本仍待定向验证。本次未清任何锁/回执，也未调整持锁顺序。

## 安全观察入口

本轮只读核对实际 Task Action仍指向 `D:/teruisi-runtime/operations-watchdog/versions/e0330d7aea1e17395cf56214c8c62e8d54c2e46359d30cce9296800c8802760c/`。安装字节与任务1一致：

| 文件 | SHA-256 |
| --- | --- |
| watchdog-status-control.ps1 | `effae9851b920e36f6b28e128dc83d01eafb607c146e7248ed24b55bd69481b3` |
| watchdog-status-backend.ps1 | `7083dc98103adf1aabcfd0b715b8a933a0d4a97a0043f020ccf53cd3c3fd965d` |
| watchdog-core-overlay.ps1 | `20b0d9781b8088b5ec48a245b47e77bf277af4bf273e49317d541edc11edbe7a` |
| process-deadline.ps1 | `5ae9617f8526197979a4f30585e055f05d38ca41ae69e52515256f13be4cb0fd` |

control限制Status并拒Open/StopWorker；backend限制Status/AggregateStatus及Backend/Worker/Supervisor目标，library-only加载后叠加只读Resolver/同轮metadata观察；driver-binding固定原control/backend/worker/transport/supervisor摘要，源变化应失败关闭，不fallback旧入口。核对只是安装/绑定事实，未执行wrapper，不证明当前健康或所有诊断无副作用。

禁止旧普通权限Django Status/AggregateStatus、总控Status/Panel、service Status、npm system:status和转到同旧路径的菜单/桌面面板用于现场诊断。[永久Status修复](../startup-status-receipt-safety-20261012/REPORT.md)已入源码但未热换冻结Django85cf。README示例与名称Status都不能代替该边界；本次服务退出码修复也不会使旧Status变安全。

## 修复、验证与复现边界

见 [必要修复与验证报告](WP5-RELIABILITY-FIX.md)。真实负例仅为本任务创建的子脚本：输出completed JSON随后exit9。旧PS5 accepted=true，PS7拒绝；修后两shell均拒绝，zero/259/null/后代输出/锁异常路径通过。不是生产故障注入，也不推断历史Backup、OOM或unknown根因。

首轮原定向组合44项，**30通过/14失败**，原日志保留。13项在固定base解包后原样失败（batch.recovery未按新合同构造，进程运行前失败）；另一watchdog夹具旧mock未覆盖新增Get-WatchHttpProbes，可能触达本机生产健康端口。本轮承认该隔离缺口：没有写/启停，原测试失败不归为产品健康或根因；该case不重跑求绿，后续应先完整stub网络入口并补合法controller健康字段。不能拿它证明“晚端口返回被接受”。

确认隔离的受影响回归17/17，共同期限定向子集13/13，Django真实native失败传播两shell各通过；全仓lint结果及原失败详见修复报告。未跑全量单测、生产构建、真实PG/R2、正式Start/Stop或持续SLO。正确性按本次缺陷关闭；没有对应生产配对提速样本，不报告省分钟数。

## 剩余缺口与任务交接

- **已关闭候选缺陷**：service PS5直接子进程真实失败被null→0吞掉。本分支已修，待任务6集成；未生产采用。
- **已有但未采用的修复**：永久Status/Stop选路兼容候选。任务6不得把本次推送当已安装工具更新，仍需完整来源、冻结包及绑定复验。
- **待核查**：上表native/PG/contract runner/mutex holder的父期限、输出/EOF与身份边界；本轮没有安全真实复现就不定根因，不扩大超时或降低门禁。
- **任务5接口**：本次成功JSON、CLI、锁名和日志格式无结构变化；失败文本增加实际退出码，新增 `controlled_script_exit_unavailable` 失败标识。若证据消费者读取失败文本，应保留unknown及原非零信息，不把它当重试许可。当前13个旧fixture缺batch.recovery、watchdog批量HTTP入口及健康证据形状、通用lazy CSS消费合同、首次失败/通知快照保全与自动报告采用需求交任务5；本任务不改这些产品/证据模块。
- **任务6验收限制**：受影响17项和安全deadline13项通过不等于原44项全绿或全库全绿；原13个基线夹具失败和1个尚未安全复验case仍明确列出。独立集成审查应核最终字节及相邻任务重叠，保持unknown不自动重放。
