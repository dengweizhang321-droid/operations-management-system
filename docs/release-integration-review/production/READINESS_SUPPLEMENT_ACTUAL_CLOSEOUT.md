# 1cae 实际验收：组合健康未通过，AB仍未闭合

2026-10-11。用户“批准最终就绪补充验收方案”明确绑定上一轮唯一1cae范围；真人item `01a127fb-4ec9-77d3-891e-9b4b349d451f`、turn `01a127fb-4e25-7bc1-9646-37c62763606a`，批准时间 `2026-10-10T22:42:23.000Z`（北京时间06:42:23，turn秒精度）。批准文件原SHA `570dc8b6fcca40b8fcfa4aac64a1ef12ab7a6d3459138cc95eb1b6cf30a0aa7a`，原最早批准05:28:51Z不重置。

唯一冻结调用器PID48772，22:44:49.442→22:50:01.130Z，311687.5465ms/exit1。stdout0、stderr3801字节/SHA `aa4475db92fd3fd6543fd7b3c9265ad2c3fdd16151d4ddeef79bb94cddd472dc`。**必要验收、owner释放和完整AB交付均未闭合。** 本scope已消费，不重入、不自动再查Status寻找通过。

| 实际阶段 | 原事实 |
| --- | --- |
| source合同/输入复验 | 000097新批准，13966.086ms证明准备、rotation获锁2.5338ms；原88不重复追加 |
| 完整动态准入 | 000098 passed，227115.642ms；原状态子进程67748/exit0/36217ms，22:48:53.332捕获Running/Ready/exact及12true |
| 新只读操作边界 | 000099 started，真实sample age388ms，原完整预算保留 |
| 最终状态 | PID71628/exit0/direct，34557ms，stdout603字节/SHA `707135c8d88aff9ebc06217bcaf573844871d70eaa51c20c1124d05428c59032`；捕获22:50:00.768，state=Unresponsive、backend=Ready、worker=exact_release、releaseMatches=true、12true、无缺项/额外项 |
| 严格断言 | 000100一次STATUS_NOT_READY/retryable=false，000101新独立操作unknown，52403.6672ms；native时长为其子集，不重复相加 |
| 收尾 | 无pending、typed completion或释放；原active仍同SHA `7c5af7f44a5aa80579bc9ac2a5038ad5ab757a90dc837de4977513d8be7b0cbf` |

实际102条完整canonical链/head `ceb8ee2a73a3140ae427adc06ebf373eee785360b36a7a3b27f6d7da0a384e7c`。旧97及旧89归档原字节、19/21unknown、原20 receipt `fde84841…`、source88唯一均保持；增加一个独立unknown，不能将原21改正常成功。原生证据在000101.error.processEvidence，顶层processEvidence=null不等于丢失；新两个status-evidence真实字节及WAL引用已核。实际非作者结果见 [复核报告](READINESS_SUPPLEMENT_ACTUAL_INDEPENDENT.md) / [JSON](READINESS_SUPPLEMENT_ACTUAL_INDEPENDENT.json)，JSON SHA `ca577c1e26cd9eca8fc6930956b297c961b330fcc9c1e03ac9b6f1afeff9123b`。

## 精确阻断与后续隔离修补要求

实际control源码 `D:/运营管理系统/tools/operations-system-control.ps1:414–448` 由三个独立HTTP合同判断组合健康：live端点必须200/ok=true/status=live，helper5791必须200/ok=true，ready必须200/ok=true/status=ready；非指定的503降级、HTTP/格式/超时失败均可能Unresponsive。入口首页200和12后端就绪不能替代这些要求，也不能让验收绕过Running。

本次已确证是该组合健康路径失败，但输出没有三个子探针的独立结果，不能断言哪一个、哪个错误或延迟。现存日志的只读追溯另交 [运行阻断审查](READINESS_SUPPLEMENT_RUNTIME_BLOCK_REVIEW.md)；稳定预算缺口是外层默认3秒而实际ready内层允许4秒，监督层5秒。因果仍未证，不把静态预算缺口直接当本次根因。该审查同时确认22:49:48.722Z及22:50:56.130Z两次背景网店投影查询statement timeout/SQLSTATE57014，返回固定503/source_not_ready；第一项在最终Status窗口内、第二项在其后。它们不直接证明哪个健康探针失败，也不授权修改业务查询或调度。

隔离修补须补齐三个探针的固定结果、解析/原断言匹配、预算及实际耗时；不保存响应正文/任意reason/客户值。只调整已证不一致的ready预算衔接，不以放宽健康条件求通过。用真实隔离3.5秒响应及坏payload/HTTP失败/超时/期限负例证明行为；非作者复审后才能准备新的精确外置只读候选。实际D控制器、正式服务及旧冻结输入保持，不修改用户已有dirty或重放生命周期；新现场处理须绑定102实际前驱并明确批准。

## 观察、计时及四状态

入口GET正文消费并丢弃，无正文落盘：161样本22:44:33.468→22:51:14.477Z，0不可用。这只证明此段首页；与旧17:51:56.053Z之间17557415ms盲区不证明停服或正常。新方法不同于旧headers-then-cancel，不作同条件性能比较、不归因旧Worker退出。原历史异常与所有采样缺口保留。

原批准至此次失败1041.168833分钟；新1cae批准至失败7.6355分钟，其中批准至启动146442ms，不能称rotation排队。准入227.116秒、验收52.404秒、证明13.966秒和锁2.534ms互不重复；未归因的caller开销18.200秒不称空闲。最短确认暂停140.2分钟是原区间子集、不再加总。必要验收/完整交付终点仍null；失败、隔离修补/复审、协调和文档时间继续计入原总区间，其他批次排队未获完整起止证据。30～60/80～120分钟仍是待验证预算，没有同条件生产净省。

| 状态 | 当前事实 |
| --- | --- |
| 源码完成 | c060取证补充已交付；此前257源修补保持，新的子探针修补尚未交付 |
| 隔离验证 | 原43作者/26非作者结果保持；本次实际失败不被隔离通过覆盖 |
| 生产候选 | 精确1cae已批准且唯一执行，102前驱已不同，不能重入 |
| 实际采用 | AB源5fa/Workerf4e/Django237保持；补充验收失败，C/no-data未采用 |

原102日志/active、真人批准、caller/两个受限snapshot、observer和实际复核共124件已create-only归档该E root的 `ACTUAL-102-20261011`，MANIFEST SHA `2abeab19d32c96e4116669e3d964fe493bfbff152680e399657288c08dd49fa3`。后来运行审查与源码修补另行保全，不覆写旧归档/封存。没有新维护、启停、部署、Backup/Restore、业务写入、调度修改或外部发送；未再进行生产诊断请求。
