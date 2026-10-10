# AB 最终就绪补充验收：精确批准范围

2026-10-11（北京时间）。442b 已真实执行，原20历史审计通过，原21一次 `STATUS_NOT_READY` 后 unknown；AB必要验收及完整交付仍未闭合。此方案已准备，尚未获得新批准或执行。原失败详情见 [442b实际结果](FINAL_TAIL_CONTINUATION_20261011.md) 和 [实际独立复核](FINAL_TAIL_ACTUAL_INDEPENDENT.md)。

| 封存项 | 精确值 |
| --- | --- |
| 批准范围 SHA-256 | `1cae786dfffa78b362e056ef2abffd889138106d6c3ce9d64add1f86b628aed7` |
| readiness-scope.json 原文件 SHA-256 | `3cf7629ec1c472b9a5c85be997edd0fa85fe1a2f326974050b5b891871249a38` |
| 外置目录 | `E:/codex-artifacts/release-integration-review-20261010/AB-final-readiness-20261011-verified-final` |
| 准备源码提交 | `c060f4d6bf330797dce28241416f4a4d43125a8f` |
| 实现及prepare捕获合并 | `23027e3986aa180b1d2eed0d953126cfdf69e2bd`，main/D正常原子推送并逐ref回读；源分支c060 |
| 输入封存 | 4771真实文件；包含旧4718、旧4589/当前4505闭包、97原WAL及全部新源码/复审，不以自报标签代替物理复核 |
| 实际前驱 | 原AB batch `9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15`；97条，head `d60a34f1aebce3bf2629a1d2c9b7e1c7f451c40fd74e44b9ac67388ef5cfdf19` |
| 原所有权 | 原active SHA `7c5af7f44a5aa80579bc9ac2a5038ad5ab757a90dc837de4977513d8be7b0cbf`，尚未释放 |

## 唯一拟执行范围

1. 新真人批准绑定本scope；复验原295精确变化合同及442实际批准、原97完整链、同一owner和全输入。复用已接受source88，不重复追加。
2. 使用明确另封存的诊断collector，对原完整动态身份、权限、维护、排空、恢复、配置和内容执行准入；各项不因不可变证据复用而减免。started边界采样年龄超过5秒或无法留足原观察期限即拒绝。
3. 执行独立只读操作 `diagnostic-final-readiness-supplement`。命令、cwd、phase、12域完整就绪/精确release/所有原断言来自原21。原四暂态集合、最多四次及共同期限保持；`STATUS_NOT_READY`仍不可重试。native成功响应先wx/fsync保全限定状态、实际PID及stdout字节/SHA，再评估原断言；取证失败也阻断。
4. 真正通过后先记pending（必要验收尚未闭合），按同一原owner和精确head CAS释放，独立确认实际ENOENT及期限，再追加 `completed-with-approved-diagnostic-final-readiness`。原19和21仍unknown，`originalBatchEngineCompleted=false`、`originalStrictComparisonPassed=false`、`originalReadiness21Passed=false`保持。新合同的闭合不是把历史失败改成原操作正常成功。
5. 独立复核实际日志、完成收据、物理owner状态、计时及异常，完成报告/Git/非敏感证据归档后才认定完整AB交付。必要验收与完整交付分别记录。

没有原20重放、其他旧操作重放、维护、启停、部署、调度修改、Backup/Restore、业务写入或外部发送。应用保持AB源 `5faac8151f59d66de72c3caead8cad916ea547da`、Worker manifest `f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113`、Django manifest `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9`；不采用C、no-data或main其他功能。

## 验证、限制与异常处理

作者最终43/43（11342.9271ms），非作者最终26/26（8197.0004ms），精确9模块前后SHA一致，lint和语法通过。早期25项24pass/1fail及后续修补、各轮原日志保留，重复轮次不相加。实现和非作者源码结果见 [设计与原始日志](../final-readiness-supplement/PLAN.md)、[独立复审](../final-readiness-supplement/INDEPENDENT_REVIEW.md)。[最终封存独立复核](READINESS_SUPPLEMENT_SEALED_REVIEW.md)已核4771/4771实际SHA及1,812,165,619字节、c060的41文件Git/E逐字节匹配，旧4718与新53完整覆盖，97原链/两个unknown/原owner保持；无新批准或执行目录。物理hash12.004秒、完整审查15.328秒仅为证据审查时间，非生产验收成绩。

这补齐失败证据，不是生产故障修复。17:43 Worker退出/原自动恢复与17:50–51原NotReady是不同时间窗，因果和原具体失败组件仍未知；后来Ready不能覆盖原失败。新验收若NotReady、错版本、组件缺失、动态绑定漂移或证据不足即停止，保留真实异常和原owner。所有后置metadata/WAL/CAS失败都保留已返回的receipt/process/状态证据；若物理释放已经确认但最终日志失败，必须如实保留释放true/确认点，不伪称仍持有、不强写foreign链、不自动再验收。停止后的进一步生产处理需按实际前驱准备精确范围。

本方案不更改运行包，验收失败无需自动部署回滚。若之后要回滚应用，沿用原唯一引擎的精确兼容发布及原恢复门禁，另批维护范围；不自动恢复生产库。原pre完整dump已轮转删除、原strict比较false、未重建历史签名、cleanupblocked等限制继续保留，295只接受既有精确工程变化证据，不能据此恢复不存在的完整前备份。

## 四类状态与计时

| 状态 | 当前事实 |
| --- | --- |
| 源码完成 | 外置取证补充c060已独立复审、合并并推送；257源补丁仅源码交付 |
| 隔离验证 | 本范围43作者/26非作者通过；无生产Status/HTTP/SQL/锁，不等同现场通过 |
| 生产候选 | 本精确外置验收范围已prepare；无新批准或执行，无新的应用切换候选 |
| 实际采用 | 原AB已部分采用但未完成验收；新补充尚未采用；C/no-data未采用 |

唯一prepare实际PID32008，`2026-10-10T18:54:57.188Z`→`18:55:33.197Z`，36007.9535ms/exit0；这是准备时间。55分钟是包含获锁、校验、准入、验收、收尾的绝对期限上限，不是发布时间预测。

原批准时钟仍05:28:51Z，不由新scope重置。442失败终态原批准至失败742.2307分钟、442批准至失败10.4973分钟；必要验收/完整AB交付终点均null。暂停最短140.2分钟单列，其他排队、失败、诊断、隔离修补/复审、文档时间与盲区继续保留。221入口样本的8不可用、17.528秒失败样本跨度/22.545秒邻健康边界不是精确停服，不用切换或owner释放跨度冒充。新执行时应另做入口观察并披露缺口。30～60/80～120分钟仍是未验证工程预算，无同条件配对生产节省结论。

原工作树、固定5fa检出及E证据仍被物理输入引用，保留；主工作区用户改动保持。未来C须绑定实际新前驱重新准备并另获批准。

## 批准边界

最终封存复核已通过。用户可明确：**“批准最终就绪补充验收方案 1cae786d 并完成 AB 收尾”**。授权仅覆盖上述精确范围；旧442已经消费且前驱已变，不能授权新的取证代码。此边界来自本任务用户要求“生产上线仍需我对最终精确候选另行明确批准”，以及 [批次协议](../../RELEASE_BATCH_WORKFLOW.md) 对未知/续接/完整批准范围的规定。再次失败不自动循环找green，不承诺本次一定通过。
