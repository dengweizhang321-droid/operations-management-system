# AB 实际采用与阻断记录

2026-10-11 1cae已批准并实际执行一次：完整动态准入通过，最终状态Unresponsive（backend Ready、12true、exact同release），原严格断言STATUS_NOT_READY后新unknown。102条/head ceb8ee2a、原19/21unknown、原20收据/source88与owner保持；必要/完整AB交付未闭合，不重跑。最新 [实际结果](READINESS_SUPPLEMENT_ACTUAL_CLOSEOUT.md)、[非作者复核](READINESS_SUPPLEMENT_ACTUAL_INDEPENDENT.md) 与 [运行阻断](READINESS_SUPPLEMENT_RUNTIME_BLOCK_REVIEW.md)。后续先补齐三个健康探针结果及隔离预算衔接，不以首页200或隔离通过放行。下文为此前准备快照。

2026-10-11 最新准备：新的[最终就绪补充验收方案1cae786d](READINESS_SUPPLEMENT_APPROVAL_PLAN.md)已提交、合并推送及prepare-only，作者43/43、非作者26/26和4771真实文件封存复核通过。只有新独立只读最终就绪及条件owner释放/收尾，保留原19和21unknown、不重20/source88；无新批准或执行，AB仍未闭合。现存生产NotReady的具体组件/原因仍未知，不能据隔离结果认已修好；C/no-data/main其他功能未采用。

2026-10-11 442b实际续接更新：原20历史审计真实通过，原21最终就绪一次 `STATUS_NOT_READY` 后保留unknown；97条链/head d60a34f1、active原9保持，AB必要验收和完整交付尚未闭合。原19严格失败与源88接受都不改写；当前只剩原21就绪事项，但它遇到了真实现场失败。详见 [实际续接](FINAL_TAIL_CONTINUATION_20261011.md)、[实际独立复核](FINAL_TAIL_ACTUAL_INDEPENDENT.md)、[两个故障窗口](FINAL_TAIL_RUNTIME_FAILURE_REVIEW.md) 与 [取证缺口](READINESS_FAILURE_EVIDENCE_GAP.md)。以下保留较早阶段快照。

2026-10-11 最新事实：用户批准的 `295d8923` 精确变化合同已实际接受为独立事件 `000088`，原第19步严格全等失败与 unknown 保持。之后第20步前的原状态准入返回 `STATUS_NOT_READY`，原20–21均未开始，active仍保留；AB必要验收与完整交付尚未闭合。后来一次只读Status为Ready，不能覆盖实际阻断。详见 [295d实际续接](EXACT_295D_CONTINUATION_20261011.md)、[独立效果复核](EXACT_295D_ACTUAL_INDEPENDENT_REVIEW.md) 和 [独立计时](EXACT_295D_TIMING_INDEPENDENT.md)。下文是此前阶段保留的历史快照。

新的[精确尾部续接方案442bcb34](FINAL_TAIL_APPROVAL_PLAN.md)已完成33项作者、28项非作者模型回归及5＋2真实合成叶子测试，4,718文件最终物理复核通过。仅拟执行原20/21及日志/条件owner释放，绑定当前89条实际前驱；尚未新批准或执行。旧295d已消费，不能重入；新方案不改变AB应用源码/制品或原失败。

续接更新：0bca UI、7389补登记、17后Restore及18保全均通过并独立核验；19严格比較实际exit1/unknown，已停止，20–21未开始。6表真实差异、pre dump缺失及payload cleanup blocked保持，整批仍未完成。最新事实见 [7389实际续接](METADATA_CONTINUATION_20261010.md)、[严格阻断独立复核](INDEPENDENT_STRICT_CLOSEOUT_BLOCK.md) 与 [最终冻结计时](strict-closeout-blocked-final.json)。以下保留此前第10步阻断快照，不回写原WAL或原恢复收据。

2026-10-10。用户“批准 AB 批次”对应唯一 batch `9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15`，实际批准时间 `2026-10-10T05:28:51.000Z`（北京时间13:28:51）。机器快照见 [PRODUCTION_SNAPSHOT.json](PRODUCTION_SNAPSHOT.json)。本文件更新此前“尚未批准/未执行”的交付快照，不改写封存文件和历史记录。

## 四类状态

| 类别 | A＋B | C |
| --- | --- | --- |
| 源码完成 | `5faac8151f59d66de72c3caead8cad916ea547da`，原限定124路径 | 已交付、组合隔离验证完成；没有生产批准 |
| 隔离验证 | 原核心、联合、候选及独立复审通过；本次验收脚本新增修正另见补充目录 | 原报告范围内通过；不外推生产分钟数 |
| 生产候选 | `20261010T014638Z-97833d2f2b7e7bc9`，manifest `f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113` | 旧D5前驱的ABC计划已失效，必须重新准备 |
| 实际采用 | 已切换、退出维护并启动；批次停在第10步，**整批验收未闭合** | 未采用 |

Django manifest仍为 `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9`。原21步中1–9各仅执行一次并passed；第10步三次真实失败，独立零效果证明后分别追加failed，原unknown保留。11–21尚未开始；未安装本批watchdog、未取得两次自然守护、未完成后Backup/Restore、全库深比较及最终收尾。页面200不能替代这些未完成事项。

## 原失败及修正

首次UI输出槽位被准备阶段的预审输出占用，create-only写入失败；finally的EEXIST可能遮蔽更早断言，不能反推四个交互通过。预审原字节已原子迁移至E9 `production/preapproval-ui/`，摘要/迁移记录保留。

第二、第三次新audit均明确报 `/api/sales/summary` 的 `net::ERR_ABORTED`，无业务写请求。商品详情本身调用此API；原脚本没有等待该次详情请求和成功DOM完成便返回，导致正常组件cleanup取消在途请求。历史networkidle标签不能证明新互动请求已排空。一次诊断通过不能覆盖两次严格失败；第三次独立结论禁止第四次原样重试。最后failed事件 `b68be115be0dc4061a1aca79df78eaabf2ed858e76e2c1bdb96c8c178e507556`，时间 `08:08:11.698Z`；active owner仍为原9。

隔离修正使用实时request身份与finished/failed终态、完整HTTP200及当前详情无error/非busy/实际KPI内容屏障，共用有界期限。保留全部原route/四交互断言，未新增sales abort例外；输出使用新的私有create-only目录，审计落盘异常也会关闭本次隔离浏览器。非作者复审提出的quiet期/挂起action期限及旧引擎ABI缺口均在最终材料中留有首失败和修正复验。

原 `reconcileOperation(passed)` 不能把明确失败包装成原操作成功；已切换批次不能cancel或手删active。精确补充控制器仅导入实际采用的旧 `executeBatch/runApprovedOperation`、旧rotation lock及原collector；真人补充批准、新脚本/独立复审/原failed event全绑定。原引擎先fsync新started，控制器再fsync绑定该event的新意图，真实新UI通过后追加明确标为补充验证的新尝试，再由原引擎首次执行11–21。前9步不重放，候选/源/原批准/原批次不换绑。具体批准对象在 [补充方案](../ui-continuation/PLAN.md) 封存后列出。

## 实测入口和计时

入口GET状态/HTML头采样从 `05:32:32.966Z` 至 `08:05:54.315Z`，3670条；批准后前221.966秒及采样停止后未观测。最大采样间隔、原JSONL摘要和逐段边界在机器快照中。响应body取消且不保存，不声称页面内容/所有用户请求已验。

两段不可用证据必须分别保留：`06:06:06.592–06:06:16.613Z`（5条HTTP500/连接拒绝/超时；相邻正常样本给出约10.02–15.06秒采样跨度界限），以及 `06:13:25.250–06:26:37.489Z`（317条连接拒绝；约13分12.24秒–13分18.54秒界限）。第一段发生于隔离restore-pre执行期间，原因须单独追溯；恢复收据的serviceStateChanged=false不能覆盖此现场异常。第二段与维护/切换期间相邻，仍只报告请求采样，**不把切换跨度当停服时间**。

[定点独立追溯](INDEPENDENT_PRE_RESTORE_ENTRY_ANOMALY.md)已证明第一段旧D5 Worker64644退出code1、原supervisor2924未换并自动spawn15520；Wrangler表面错误为ProxyWorker/Miniflare的“Network connection lost.”。原restore根包装exit0/preserve/无timeout，无期限树清理；隔离PG faststop晚于异常。缺完整workerd/OS因果轨迹，底层原因仍未知，不能定为CPU争用或排除一切外部终止。该事件不改成“无异常恢复”。

| 原动作 | 父操作执行时间，不含该步之前准入 |
| --- | --- |
| reuse worker | 234.270秒 |
| 前Backup | 735.974秒（12.27分） |
| 前Restore | 704.335秒（11.74分） |
| EnterMaintenance | 264.729秒 |
| apply | 142.539秒 |
| ExitMaintenance | 43.795秒 |
| StartWorker | 405.788秒 |
| 三次UI失败 | 20.317＋16.706＋26.867秒，分别保留 |

阶段WAL父记录含逐步准入，机器快照列prepare、backup、restore、drain、switch、acceptance各阶段合计。子进程engine/adapter时间仅为父操作内部细分，不再相加。批准到必要验收及批准到完整交付均未闭合；快照时已经超过严格80～120分工程预算，不能宣称达标。总区间保留失败、人工诊断、独立协调和续接等待；未分配墙钟时间不虚构为全部计算或全部排队。其他批次排队只在有实际_queue记录时报告，不声称自动后台排队。

前恢复点 `daily-20261010T054420Z-3f75a3055cf6`，manifest `aa5f8b30c910223d726e573560fba32933701f4b28831bfcf42cb54e5d7509df`，dump `28f3c000e35d1718482bf49702b7001e943b6e420250284836c107659e8588af`。隔离恢复4343c5618700/55592通过，295业务表/296profile表、角色/序列/内容验证及isolated cleanup按原收据范围记录；policySyntax=false保留。前Backup按既有3槽轮换删除旧10月9日点，不能继续声称该点可恢复。后备份仍可能淘汰payload，JSON保全不等于dump仍可恢复。

## 保护、回滚和交接

主目录原入口升级属于本次批准；升级前原字节与原Git补丁已存E9，未覆盖无关用户文档。D5不可变包、原manifest/guard和append-only谱系继续保留。需要兼容代码回退时准备绑定当前AB实际前驱的原受控计划；生产数据恢复须另行对仍存在的精确恢复点/目标库/维护窗口获批，本次没有执行回退或恢复正式数据。

保留旧D专用worktree、固定AB准备clone、E9及新补充材料至采用闭合；不能为清理放松pin。原历史unknown/failed/协调记录、失败audit、原stdout/stderr元数据和新观察均保留，原失败输出不重建。原批准仅覆盖AB；C需采用后以新的实际前驱独立准备并另获生产批准。

本次源码/文档提交、合并和远端核对在补充方案最终交付记录中列出；Git交付完成不代表生产验收completed。
