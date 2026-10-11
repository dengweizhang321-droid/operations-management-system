# AB 实际验收及交付收尾

2026-10-11。AB 按用户批准的具体变化合同与健康补充合同完成必要验收，原批所有权已经释放，并有独立物理 ENOENT 证明。完整交付还包括本报告、Git、归档和独立收尾复核；最终准确终点以本轮 E 根 `FINAL_AB_DELIVERY.json` 为准。该文件在这些工作全部完成后 create-only 保存，不回写执行时的 fullDelivery=false 历史快照。

## 批准、版本与实际结果

用户本轮明确“按照你的方案执行，直到整个AB完成”，绑定上一条唯一 `12c48446`。批准时间 2026-10-11T00:54:49.000Z（turn 秒精度）、真人 item `01a12874-8c8d-7561-8ce6-db7cfb04d8b5`；批准原文件 SHA `e4a66322238c81f21df1bd3d1e304a0a21743f60677c48226e14f3f9d816fa50`。随后用户允许 Antigravity 协助审查，生产执行仍由单一封存调用器负责。

精确 scope `12c48446cf7896de39a665337ddde1dde89e0611a743b6b3287cfa1509597dc4`，原文件 SHA `e31038cbef17f5675dee175ed7eeb51bd503f1ffc392833cae929f73406516c8`；源码 `c719010f3dcf00687333e05be019dc4a5723f982`，此前源码/封存文档 main/D `37286eeb50f471faa0106b232c158d35122090ce`。范围见 [批准方案](HEALTH_PROBE_APPROVAL_PLAN.md)。本报告在从最新 main 建立的 `codex/release-health-probe-actual-review` 专用 worktree 完成。

| 事项 | 实际证据 |
| --- | --- |
| 唯一 caller | PID61812，00:57:29.395–01:03:03.855Z，334458.5763ms，exit0/signal null；stdout1827字节/SHA9897c37e…、stderr0 |
| 完整输入/源证明 | 4829 封存输入按原机制复验；原 source88/295 接受合同不重复追加 |
| 动态准入 | 第103条 passed；Status PS69812/direct exit0、38962ms，Running/Ready/exact、同release、12true，唯一匹配 producer |
| 最终健康 | PS20340/direct exit0、36052ms；Running/Ready/exact、同release、12true，无缺项或额外项；原断言与新增健康/producer 合同都通过 |
| 新独立验收收据 | 第106条 passed，receipt `4f65af5add1de0405e1d41b38f3cbf2e9de45566a0ae3145ce283473e630b2ce` |
| 有条件收尾 | 第107条 pending，necessary=false；第108条 distinct completion，necessary=true、ownerReleased=true、独立实际 ENOENT |
| 完整链 | 109条，head `5289afacafc13d0fe36e10c0b3df7ae7811e59616827f24565761b0079abd11f`；执行前102原字节、旧97/89和历史状态保持 |

最终三探针实测如下。其固定布尔、对象、marker、HTTP、期限及实际 whole-probe/effective budget 均通过，producer 与本次 native PID、自身 SHA、scope、原 authority 文件 SHA、实际调用窗口和健康事实一致。

| 探针 | HTTP | 实测耗时 | nominal/effective预算 |
| --- | --- | --- | --- |
| live | 200 | 58.188ms | 3000ms |
| helper | 200 | 11.728ms | 3000ms |
| ready | 200 | 1990.236ms | 5000ms |

本次 ready 耗时也低于旧 3000ms，不能据此认定此前 Unresponsive 就是预算不一致导致，更不能承诺故障已永久消失。成功证明当前新合同满足，旧失败不被覆盖。

应用保持 AB 源 `5faac8151f59d66de72c3caead8cad916ea547da`，Worker manifest `f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113`、Django manifest `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9`。新版工具用于外置只读验收，正式旧控制器未覆盖。本轮没有新增维护、部署、启停、调度修改、备份恢复、业务写入或外部发送；C/no-data/main 其他功能未采用。

## 独立复核与历史事实

[实际非作者复核](HEALTH_PROBE_ACTUAL_INDEPENDENT.md) / [原机器结果](HEALTH_PROBE_ACTUAL_INDEPENDENT.json)，JSON/原日志同字节 SHA `f821899972154ab9a9eb5dcb27631a84a32a7181d4e683cc38cafd5abff46dae`。独立审查只用 builtin、小 metadata 和已存在原证据，不新增 Status/HTTP/SQL、不重新扫描大 dump。公共受限证据原字节及复制 manifest 在 `HEALTH_PROBE_ACTUAL_PUBLIC/`，不含响应正文、任意 reason、凭据或业务行数据。

原第19严格比较 unknown/false、原第21 unknown、1cae unknown 保留；295 已接受的具体变化合同保持，原20历史审计通过且没有重放。originalBatchEngineCompleted=false、originalStrictComparisonPassed=false、originalReadiness21Passed=false 不变。新的必要闭合通过独立批准合同确认，不能写成原21正常成功或原严格比较全绿。

执行与实际独立审查保存的 fullDelivery=false 是当时仍待 Git/归档的真实状态。最终完整交付用另一个准确时点和行政证据证明，不改写这些文件。所有已执行、协调、失败与 unknown 历史继续可追溯。

## 入口异常及未解决事项

本轮首页147样本，11不可用，第一条00:59:19.129Z、最后00:59:44.204Z；失败样本跨度25.075秒，前后正常样本界00:59:16.622–00:59:46.708Z、30.086秒。它们是采样观测界，不能写为精确停服时长。观察正文消费并丢弃，没有正文保存。与前轮22:51:14.477Z到新首样本00:57:18.866Z之间7564389ms未观测，不能认该段正常或停服。

只读现存运行日志确认同 supervisor48744 下 Worker52084 于00:59:19.502Z exit1，原机制16000ms等待后自动恢复，00:59:39.749Z spawn51028；表面为 ProxyWorker/Network connection lost。这是实际稳定性异常，发生于最后严格健康检查之前，最后健康通过不能抹掉它。触发请求及根因仍未知，不归因于 observer、预算或 AB 源码，不宣称永久修复；窄窗证据见 `HEALTH_PROBE_ENTRY_ANOMALY_REVIEW`。

此事项保留为生产稳定性后续问题；本批准合同要求的实际最终身份/版本/12域/三健康探针与来源、期限和 owner 条件已满足。后续若需更改正式启动、运行包、调度或生产数据，须另有准确范围；本任务未借此额外操作生产。

原 pre 完整 dump 已轮转删除、原历史签名未重建及 payload cleanup blocked 等限制不因收尾而消失。没有可据其恢复的完整前备份；将来回滚或 C 第二批必须绑定新的实际前驱、有效恢复点和兼容方案重新准备，C首次采用仍走严格流程，不复用旧批准。

## 计时及四类状态

| 指标 | 本轮实测/口径 |
| --- | --- |
| 原 AB 批准到必要验收闭合 | 70452646ms，1174.210767分钟，起点2026-10-10T05:28:51Z、终点新completion WAL.at01:03:03.646Z |
| 本轮批准到必要验收闭合 | 494646ms，8.2441分钟；到caller terminal494855ms，8.247583分钟 |
| 本轮批准到caller开始 | 160395ms；非mutex队列 |
| source proof / mutex queue | 15012.0687ms / 2.2693ms |
| 动态准入 / 最终验收 | 245420.8977ms / 54193.1767ms；native38962/36052ms为子区间，不重复累加 |
| 最终结果返回到owner缺失 | 839ms；owner缺失观察01:03:03.477Z |
| 返回到completion WAL逻辑时间 | 1008ms；记录内字段839ms是append前采点，不能当WAL落盘耗时；fsync终点无单独打点，caller退出是之后已知终点 |
| 批准到完整交付 | 待最终Git/归档/独立行政复核后，以FINAL_AB_DELIVERY.json实际时点计算 |
| 其他批次排队 | 只有本轮mutex实测值；没有全部其他队列的成对证据，不能编造为零 |

原 AB 总墙钟包含先前失败、协调、等待、用户确认、暂停及文档收尾。已知暂停下限140.2分钟包含其中，不额外加一次。proof/准入/验收等互斥上层总计314.6284124秒，caller其他19.8301639秒没有分项打点，不能称空闲。原历史备份、恢复、排空、切换、验收与协调耗时保留于此前报告，本轮没有新的此类动作；文档/AGY/独立审查/归档在必要闭合后继续计入完整交付。

30～60/80～120分钟仍是限定条件工程预算；本次原总墙钟和有故障的续接不构成常态收益证据。无同源码、同制品、同规模、同验收范围的配对新生产节省结论。

| 状态 | 当前事实 |
| --- | --- |
| 源码完成 | ABC/D核心及AB修补已分别交付；本健康标准修补/外置候选已独立复审，正式旧控制器未安装新标准源码 |
| 隔离验证 | 标准23作者/10非作者，新外置21模型+2真实叶子、17独立不重叠覆盖通过，早失败保留、不累计轮次 |
| 生产候选 | 原AB固定制品已采用；12c精确只读候选已批准并唯一执行成功，无新应用切换 |
| 实际采用 | AB版本保持，按批准合同必要验收与owner收尾已完成；完整行政交付另有准确终点；C未采用 |

Antigravity由用户明确授权参与第二审查，只读取公共受限证据，结果与局限另保存 `AGY_AB_REVIEW_RESULT.md`。其结论需逐事实核对，不能代替上述独立实物检查或生产执行结果。首次CLI因时间参数缺单位未开始模型审查，原stderr/exit2保留；修正为240s后再次调用，不绕过默认权限。公共复制首次Buffer.equals参数类型错是文档工具问题，已写文件保持原字节，复制manifest保留更正，不涉及生产动作重放。
