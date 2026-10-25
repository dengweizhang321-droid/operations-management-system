# AB 健康探针补充验收：最终精确方案

2026-10-11（北京时间）。用户批准的 1cae 已执行，但最终健康状态为 Unresponsive，未通过；必要验收和完整 AB 交付均未闭合。本方案已纯准备，尚未获新批准或执行。实际失败见 [实际收尾记录](READINESS_SUPPLEMENT_ACTUAL_CLOSEOUT.md) 和 [实际独立核验](READINESS_SUPPLEMENT_ACTUAL_INDEPENDENT.md)。

| 封存项 | 精确值 |
| --- | --- |
| 批准范围 SHA-256 | `12c48446cf7896de39a665337ddde1dde89e0611a743b6b3287cfa1509597dc4` |
| health-scope.json 原文件 SHA-256 | `e31038cbef17f5675dee175ed7eeb51bd503f1ffc392833cae929f73406516c8` |
| 外置目录 | `E:/codex-artifacts/release-integration-review-20261010/AB-health-probe-20261011-verified-final` |
| 候选源码提交 | `c719010f3dcf00687333e05be019dc4a5723f982`；分支 `codex/release-health-probe-contract` |
| 源码及纯准备捕获合并 | `d3a7d903d9e07f90f6d9b6666b300b62b6cb9bdd`，main/D/actual 正常原子推送并逐 ref 回读 |
| 实际前驱 | 原 AB batch `9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15`；102 条，head `ceb8ee2a73a3140ae427adc06ebf373eee785360b36a7a3b27f6d7da0a384e7c` |
| 输入封存 | 4829 文件，包含旧 4771／4718／4589／当前 4505 闭包、新源码与复审、102 原 WAL；以独立物理复核为准 |
| 原所有权 | active 原文件 SHA `7c5af7f44a5aa80579bc9ac2a5038ad5ab757a90dc837de4977513d8be7b0cbf`；尚未释放 |

## 唯一拟执行范围

1. 新真人批准绑定本 scope。保留原 19 严格比较 unknown/false、原 21 unknown 和 1cae 补充验收 unknown；复验已接受的 295 精确变化合同，不重复 source88。原 20 历史审计已通过，不重放任何旧生命周期或业务动作。
2. 完整输入哈希在动态 collector 之前核验。身份、权限、维护、排空、恢复资格、配置、进程及绑定门禁保持；started 时真实采样年龄超过 5 秒即拒绝。不能用不可变证据复用替代动态检查。
3. 仅执行新只读操作 `health-probe-contract-readiness-supplement`。准入和最终检查均使用封存的外置 `readonly-control.ps1`，保留原 Running/Ready、精确版本、12 域及全部旧断言。原四暂态集合、最多四次及共同绝对期限保持，STATUS_NOT_READY 不可重试。总 55 分钟是期限上限，不是完成时间预测。
4. 该脚本由已独立复审的标准源码机械派生：固定 SourceScriptRoot、仅允许 Status+Json、限定健康记录。live/helper 各 3000ms，ready 5000ms，实际请求受共同剩余期限约束。三个真实探针均须 HTTP200、对象/精确布尔与 marker 正确、期限内完成；实际整个探针耗时不得超过 effective budget。首页健康不能代替三探针、引擎或完成证据。
5. 真正通过新的完整合同后先记 pending，necessaryAcceptanceClosed 仍 false。只有精确原 owner/head CAS 释放、独立观察物理 ENOENT 且仍在期限内后，才追加新独立 completion。原三项 unknown 不重写，originalBatchEngineCompleted=false；不能声称原严格比较或原 21 正常成功。
6. 再独立核验真实结果、收据、所有权、计时和异常，完成报告、Git 和非敏感归档，才认定完整 AB 交付。必要验收与完整交付分别记录时间。

下层固定 PS5 参数为九项：`-NoProfile -NonInteractive -File <封存目录>/readonly-control.ps1 -Action Status -Json -SourceScriptRoot D:/运营管理系统/tools`，cwd 为 `D:/运营管理系统-sales-django-release`。不能绕过外置 caller、批准绑定和完整准入直接调用下层脚本。原七参数入口的 recognizer 保持；新白名单仅适用本操作及自身精确路径，不允许任意脚本。

没有维护、启停、部署、调度修改、新 Backup/Restore、业务写入或外部发送。应用仍 AB 源 `5faac8151f59d66de72c3caead8cad916ea547da`、Worker manifest `f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113`、Django manifest `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9`。不采用 C、no-data 或 main 其他功能；将来 C 必须绑定新的实际前驱重新准备、首用走严格流程并另批。

## 失败证据与阻断

真实 native 返回成功也不等于语义验收通过。成功 Status 正文在旧断言之前 create-only/fsync 保存限定状态、实际 PID、stdout 字节/SHA 和实际 native 调用边界。PS 健康函数 finally 在自身目录 CreateNew/WriteThrough/Flush(true) 写限定 producer DTO；绑定 scope、自身 SHA、原 authority 文件 SHA 和实际 PS PID，不保存 raw body/reason。

准入和最终均要求唯一 producer 与本次 PID、状态事实、原 authority、健康合同和实际 native 时间窗一致；缺失、重复、错误来源、超预算或记录失败即拒绝。时间比较的 5ms 仅为分辨率，不是额外健康预算。记录 reader 拒绝未知原字段及非 false 的 raw flags。标准健康函数可能将 setup+请求稍过预算标 passed，本新合同仍拒绝该结果。

原 transport 在非零退出时已销毁 stdout 正文；只能引用真实过程/stdout SHA 和实际 producer 旁证，不能编造解析后的失败正文。被杀未完成 finally 或缺文件必须明确缺证。所有 post-return、WAL、CAS 和 owner 确认失败保留真实收据与证据；已确认释放则如实记录释放 true/观察点，未确认则三态表达，不强写 foreign 链，不自动再试或裸循环健康检查。

本轮背景 netshop 查询 statement timeout 已确证，但没有证据证明其导致哪个健康探针失败。源码 3 秒外层小于 ready 4 秒内层的预算缺口及私有 3.5 秒复现已验证，仍不能认定就是 1cae 的实际根因。后续失败须列真实探针、精确文件和触发条件，不以降低断言换取收尾。

本方案没有应用切换，失败不自动部署回滚。若另需回滚应用，必须另批精确兼容批次并执行原恢复门禁；不自动恢复生产库。原 pre 完整 dump 已轮转删除、原 strict=false、历史签名未重建及 cleanup blocked 的限制保持，不能声称恢复不存在的完整前备份。

## 验证与四类状态

标准源码修补 `fc84d723a8aca3b822f45ad3a7229cce8c58e112`：作者最终 23/23、非作者 10/10；仅源码完成，正式旧入口未覆盖。新外置候选作者最终模型 21/21、真实私有 loopback PowerShell 2/2；非作者不重叠 17 项为最终纯模型/私有 owner 15/15 加首轮真实 writer/finally 2/2，进程均确认退出。早期真实失败及提取夹具遗漏日志保留，轮次数不相加。

[候选设计及原日志](../health-probe-closeout/PLAN.md)、[独立源码报告](../health-probe-closeout/INDEPENDENT_REVIEW.md)；独立 JSON SHA `0e420c9dddbe82841f2a3832b80e232e2904095dcb98ee5797f678a18b4e7b0e`。pure prepare PID72076，00:08:58.446–00:09:41.973Z，exit0，43526.186ms；未执行 collector、Status 或锁。最终封存物理结果见 [独立封存核查](HEALTH_PROBE_SEALED_REVIEW.md)。公共源码与本轮交付按精确 Git 字节 create-only 归档；最终 ref/manifest 在本外置目录 FINAL_GIT_DELIVERY.json，不更改本 scope 或 sourceCommit。

最终独立物理复核通过 4829/4829 实际 SHA、1,814,680,631 字节、46 个 Git/E 源文件，旧 4771 及全部旧闭包完整覆盖；102 原链、old97/89 原字节、三个 unknown、source88、原20收据和原 owner 均保持，新批准/production 目录不存在。流式哈希 12208.1322ms、完整审查 15835.5004ms 仅为审查成本，不是生产验收成绩。

| 状态 | 当前事实 |
| --- | --- |
| 源码完成 | 标准修补和新外置候选已独立复审、提交、合并、推送 |
| 隔离验证 | 上述最终覆盖通过；不等同生产通过或原失败根因已修复 |
| 生产候选 | 本精确只读验收范围已 prepare；尚未新批准或执行，没有新应用切换候选 |
| 实际采用 | 应用仍 AB5fa；旧 1cae 验收失败、owner 未释放，AB 尚未闭合；C 未采用 |

## 计时与批准

原 AB 批准 2026-10-10T05:28:51Z 到 1cae 实际 caller 失败终态为 1041.168833 分钟，1cae 批准到该终态 7.6355 分钟；均不是验收闭合。必要验收及完整交付终点仍 null。失败、续接、协调、源修补、准备和文档时间继续计入原时钟，既有 140.2 分钟暂停下限已包含，不重复相加。

1cae caller 311.688 秒：proof 13.966 秒、mutex queue 0.0025 秒、admission 227.116 秒、validation 52.404 秒；native 34.557 秒包含于 validation，不重复计时，未归类 18.200 秒不冒称空闲。批准到调用入口等待 2.4407 分钟不冒称 mutex queue；其他批次排队没有新证据，不编造为零。

本轮 161 首页样本均可用，不能证明三个健康接口通过，也不能覆盖新旧观察间 4 小时 52 分 37.415 秒盲区。旧 442 的 8 个不可用样本、17.528 秒观测跨度及相邻 22.545 秒界保留，不能用切换跨度冒充精确停服时间；新正文消费方式与旧 cancel 不构成相同条件收益比较。隔离小测试、prepare/hash 时间均不是生产发布时间或节省时间。

30～60/80～120 分钟仍为待验证工程预算。批准后按准备、准入、备份、恢复、排空、切换、验收、文档、失败协调及续接分项报告；本新范围没有新备份/恢复/排空切换动作，原批历史耗时保持。没有同源码、制品、规模、范围的配对新生产收益结论。

**唯一待用户批准：批准健康探针补充验收方案 12c48446 并完成 AB 收尾。**

旧 1cae 批准已消费且实际失败；本方案改变健康预算、验收脚本和实际 102 条前驱，旧批准不覆盖本新精确范围。这遵守用户要求的最终精确批次批准，不能把源码合并当作生产授权。
