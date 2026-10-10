# 第二阶段组合验收报告

当前四状态：

| 范围 | 源码完成 | 隔离验证 | 生产候选 | 实际采用 |
| --- | --- | --- | --- | --- |
| ABC＋D核心 | 完成，58bce3f7核心／96aaf018入口收尾 | 联合307及439文件覆盖，原失败保留 | AB/ABC各精确候选已准备 | 否 |
| 默认AB | 5faac8151f59d66de72c3caead8cad916ea547da | 限定158/61、拥有方25、guard6、v2独立负例通过 | 21步严格batch 9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15封存；同root只读UI4通过 | 否、未批准／执行 |
| ABC替代／后续C | ABC9d41ce4fa2c7ee4d47ba1bfda0f0967d7727be9c已准备；C第二批未生成 | 原核心／限定源证据；未来C新前驱验证未做 | ABC engine未封存；C第二批无新实际前驱；fast path拒绝 | 否 |

新增只读证据：75公开资源逐HTTP摘要通过，两个401仅未签名边界；完整1256拥有方源＋8测试与2shared在SQLite私有根25项通过，6隔离接口负例通过。独立pure validator新增5、adapter/natural5、UI与adapter合12、Python库存2分别通过，不合计成单次full suite。完整Python7918库存＋真实Playwright/Chrome闭包和原task/DWS/native metadata绑定；新的生产前／后完整Backup/Restore、真切换后的全验收均待批准。原首UI失败、setup五失败、初guard/validator/adapter负例失败、错误/中止seal和第8批次sales导航abort均保留；第9只增加正常读取收尾等待，不放宽API异常。__pycache__不新做密码学验证，沿用原缓存失效及可信OS边界。


2026-10-10追加：默认AB精确STRICT/FULL 21步批次已封存，未批准/执行/采用；以 [最后批准方案](EXACT_AB_BATCH_PLAN.md)、[机器记录](evidence/final-ab-batch.json) 与 [v2非作者终审](BATCH_V2_FINAL_INDEPENDENT_REVIEW.md) 为当前状态。下文原“未封存/P01–P06待闭合”及旧Git状态是此前交付历史快照，不能覆盖本追加。ABC替代尚未封存，C快路径资格仍拒绝。原main改动保持；另任务最新main ccf87212仅并入D开发交付，不进入AB/ABC限定候选。


2026-10-10，Asia/Shanghai。用户通知已保留在[交付门禁](evidence/handoff-gate.json)。**源码、必要隔离验证及独立复审闭合；已准备两份限定范围Worker候选。发布方案可以审查，执行仍被阻断，不能据此执行生产采用。**

## 精确交付与修复

| 对象 | 实现提交 | 交付主线与证据 |
| --- | --- | --- |
| A | 67622d61ee326dc610c498356e518ec2ec7fdd81 | 5fb351821a921273d98c04527e15c79efd47480a；最终复审、200项相关回归；原11份物理源码保全逐SHA复验 |
| B | 9b9c76d4cab19283005a86b267d673bce7168130 | merge850e40a89ea1dcc7dc2ff035fd06b0f4ef047c18，交付c9586ab864dabe3a22e5abac0b17b3a9250ea27c；9份复审字节、59份保全文件复验 |
| C | 2b10f6021a0b5bda1f52424604bf697b17218e3c | 交付6445a2a61566d4c97741b26d222aa79723dea9ba，最终报告主线2b1b70160de4ec2619c41ba895084dfba205b79a；9份Git blob、44份保全文件复验 |
| D组合 | 433b41adbb99bc72502b0e54472378a7667be94e | 普通合并交付主线2b1b7016；三项实现均为祖先 |
| D实现补修 | 58bce3f7709f36b5eb8c61f324d34facb65f4e67 | 两文件daily/admission；非作者19份实现字节及14项负例复审通过 |
| D测试入口收尾 | 96aaf0183584de5f34b180ae398d936cb0f98e36 | 独立14项入口及作者入口去重；未再改变已审实现 |

原全仓失败如实保留：B原3513项含11失败、1取消、21跳过；C原3496通过/21跳过的全量早于最终A/B包含关系，不据此认定最终组合已全绿。A原失败与后续定向闭合亦不改写。不同检出换行下物理SHA可能不同，候选使用最终实际字节及manifest绑定，不拿A旧CRLF摘要代替。

D修复tools/release-daily-backup.mjs与tools/release-batch-admission.mjs：同一绝对父期限，PS5安全参数及仅子环境，文件输出协议与preserve；锁前create-only attempt，取得锁/WAL后实际Backup调用前重新核精确ACTIVE配置；迟到、owner错、落盘错及旧unknown/failure marker不能重写成成功或自动重放。无可信native scheduler最后尝试来源时，reader明确返回lastResult=unknown、latestAttemptCoverageVerified=false。这是关闭不可信恢复资格，不是日备份已采用。

第一批限定来源另修复tools/release-impact.mjs两处盘点边界：公开.env.example/.env.sample必须参与完整盘点；只有.git探测ENOENT可切无Git盘点，已选Git文件的ENOENT不得缩小集合。最终AB5faac815保持v1分类、串行读取，不混入C的分类/IO/cache优化。首次same-mtime负例不足的原日志保留，补强后实际mtime前后相同且字节变化使treehash变化。

## 最小充分联合验证

所有重型测试、构建、实恢复与两份在线候选准备串行。以下均有原退出码和日志；除明确在线只准备外，其余源码测试未使用生产连接。

| 执行范围 | 结果 | 实测墙钟 | 证据 |
| --- | --- | ---: | --- |
| 最终组合联合＋原生命周期入口 | 307通过，0失败 | 480595ms / 8.01分钟 | [日志](evidence/joint-and-lifecycle-final.log)、[退出码](evidence/joint-and-lifecycle-final.json) |
| 全部439个.test.ts入口的剩余426文件 | 3330项：3306通过，24跳过，0失败 | 673942ms / 11.23分钟 | [覆盖映射](evidence/full-unit-coverage.json)、[日志](evidence/unit-remaining-final.log) |
| 非作者daily/真实进程/期限负例 | 14通过，0失败 | 10.376秒 | [复审](COMBINED_INDEPENDENT_REVIEW.md)、[日志](evidence/independent-combined-final.log) |
| AB原限定组合 | 158通过，0失败 | 81676ms | [日志](evidence/ab-scoped-regression.log)，源码c117，随后只变盘点文件 |
| AB最终盘点修复的相关原回归 | 61通过，0失败；公开样例/私有形状/same-mtime/缺Git文件负例通过 | 8860ms | [回归](evidence/ab-inventory-regression-final.log)、[负例](evidence/ab-inventory-negative.log) |
| lint/模块边界 | 0错误、35原warning；650模块边界通过 | 103215ms | [摘要](evidence/static-final.json) |
| D隔离构建 | exit0 | 20649ms | [摘要](evidence/build-main-final.json) |
| 现存真实点Verify/隔离RestoreRehearsal | 必需profile/序列/内容/隔离清理通过，生产未触碰 | 3168ms / 706423ms | [恢复](evidence/restorerehearsal-existing-point.json)、[独立回查](evidence/independent-existing-mirror-review.json) |
| AB实际在线只准备 | plan candidate_verified，exit0 | 556424ms / 9.27分钟 | [摘要](evidence/ab-online-prepare.json) |
| ABC实际在线只准备 | plan candidate_verified，exit0 | 694864ms / 11.58分钟 | [摘要](evidence/abc-online-prepare.json) |

439文件采用拆分覆盖，原首组入口与最终wrapper去重存在重叠，不直接相加为一次默认全量项数。逐文件覆盖与两组日志才是证据。D主线全量可能包含其他未采用功能，其结果不等于两候选每个业务测试都已重跑；ABC19核心字节与受测/复审实现相同，AB必要移植及最终盘点另有限定回归。候选各自原prepare-online完成其构建及制品门禁，不能互借构建回执。

首轮联合162项曾有1项watcher负例失败，原[joint-entrypoints.log](evidence/joint-entrypoints.log)保留。非作者用透明fs.watch诊断原断言单例1/1、同文件23/23通过，最终联合通过；首次根因仍未知，没有改断言、放宽时限或归因于资源争用。只读最终范围核验首两次分别因误要求AB含C模块、缺ABC保全目录失败，原candidate-final-verify*.log保留；没有伪sealed/生产动作。

## 实恢复的身份与限制

准备阶段的首轮联合失败墙钟97868ms另保留在[evidence/joint-entrypoints.json](evidence/joint-entrypoints.json)，不从成功样本中扣除为提速收益。草稿编写/静态审查、文档、部分协调与续接未单独采样；不得将这些未采样时间记0。工具传输/只读校验脚本失败与真实引擎/业务失败分开，原记录保持。

原保留点daily-20261009T114230Z-7117da1c1055，manifest c3def80e40bf8ebad3e0d3e3a2c09a64b2d4d99bd6cf95d48c41b7b12ff62400；dump c58c008b90079bf1ac9612a6f16bff3f6899ff854fe265f31c94c85acdc8ed49；原/恢复内容摘要均8c640b74691222c76176798d86e554e7c259f381a1f91dd81c361ac25d81f904。原安装拥有方operator执行Verify与RestoreRehearsal；没有执行Backup/Prune/生产维护。

独立私有集群rehearsal4088f7ed4793、端口55591、E:/TERUISI-Postgres-Rehearsals/restore-4088f7ed4793，恢复后data删除/端口关闭；生产PID4080与原创建UTC ticks一致。受保护原恢复JSON及sidecar由非作者直接回查，原文件SHA0a0cfa4f72415b8a6def5afa76bdfa2a27e1d7277905853b555adb1c70e0ef6d。PS7自动日期类型转换造成的首次比较误报保留，重新按PID/UTCticks核对，未改operator回执。

额外policySyntaxEquivalenceVerified=false、无可选语法witness，见[限制](evidence/restore-syntax-limitation.json)。必需profile/角色/目录/内容/序列通过不等于所有SQL语法等价。实恢复使用现存完整点，不是小型合成库；仍不能证明生产整批发布时间，也不是获批批次的新前/后备份恢复，更不建立native日备份最新成功资格。原dump/profile留受保护E盘，没有复制原客户数据到Git。

## 四类状态

| 范围 | 源码完成 | 隔离验证 | 生产候选 | 实际采用 |
| --- | --- | --- | --- | --- |
| A/B/C+D核心 | 完成，精确提交/字节已审 | 本次联合/负例/覆盖/构建完成，保留列明限制 | 见下两候选；engine batch未闭合 | 未采用 |
| 第一批AB | 5faac8151f59d66de72c3caead8cad916ea547da | 必要限定回归＋盘点安全补修闭合 | 20261010T014638Z-97833d2f2b7e7bc9，已准备 | 未采用 |
| ABC合并替代 | 9d41ce4fa2c7ee4d47ba1bfda0f0967d7727be9c | 19核心字节等价＋各自制品门禁；实际生产验收待批次 | 20261010T015810Z-ec9a7dfc12336d52，已准备 | 未采用 |
| 默认第二批C | 实现已交付 | 组合源码通过 | AB采用后须新实际前驱重新准备 | 未采用 |
| C数据库恢复复用 | 机制源码完成 | 资格拒绝负例通过 | native latest未知，资格拒绝 | 未采用/未启用e |

A/B/C单项待交付门禁已闭合。源代码复审、候选准备、批次封存、生产资格及真实采用分别表达。最终完整scope见[candidate-scope.json](candidate-scope.json)，精确Git状态见[DELIVERY](DELIVERY.md)。

## 仍未闭合的发布阻断与计时

[最终非作者交付复审](FINAL_INDEPENDENT_REVIEW.md)通过：AB17份存在核心/2份C模块排除、22个keyFiles/4receipt；ABC19核心、24个keyFiles/4receipt及两份原plan/manifest关键SHA复算匹配。439=13+426文件集合无漏/额外/文件重叠。没有新增源码/候选准备或非执行方案结论阻断；不重新hash完整依赖树、不宣称重新执行重型验证，也没有关闭下述生产执行门槛。

[RELEASE_PLAN](RELEASE_PLAN.md)列出P01–P06。新增自动封存/验收草稿被非作者发现BD01–BD10，未执行、未seal、未进入候选；文本原字节保留在evidence/withdrawn-drafts。它们不是已修复并通过的生产入口。后续可沿原受审接口建立最小具体操作闭包，或重新实现草稿，但须真实负例和非作者复审，不能靠checks=全strict列表、source-assets标签或wrapper completed补齐覆盖。

没有生产批准/排空/切换/采用，因此批准→必要验收、批准→完整交付、生产批次排队、维护/排空/切换/自然验收/文档收尾和失败协调续接的生产耗时均未测，实际入口不可用观测未测，不能记0或以切换跨度代替。以上准备/测试/镜像样本单独计时，不相加成发布SLA，不重复累加父操作及子阶段。原30～60/80～120分钟仍为待验证工程预算；同源码、制品、数据规模和验收范围的生产前后对照尚未完成。C原三阶段21.614/24.167秒属于C+B限定样本，不泛化为最终ABC或多分钟收益。

本次未维护、启停、部署、改调度、生成生产备份、写业务数据或外发。在线prepare只增加未激活不可变候选/plan，不替换正式effective head。Django绑定实际237fbe0d拥有方，不DeployApp。默认AB的可变准备检出已恢复，ABC旧plan当前不能通过可变源码身份；选择替代时需检出精确ABC并复验所有新鲜门禁，不能同时声称两计划都可执行。

已读取新合入的 [独立执行耗时评估](../abc-execution-timing-review-20261010/REPORT.md)：事实截止12:22:02，218.25分钟涵盖集成开发、候选、返工及协调，不是生产发布SLA。其旧P01/v2初轮快照由本轮第9终审更新；不可归因时间不称空闲，无测量节省数字不采用，重复样本不加总。后续稳定流程先集中建立真实ABI/依赖/范围映射与轻量预检，准确区分源码交付和可供最终批准，保留本批必要门禁。
