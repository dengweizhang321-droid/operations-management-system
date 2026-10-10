# AB 原只读尾部精确续接候选

当前只准备源码，没有封存、批准或执行这份新协议。作者不能用自己此前对295d协议的独立审查批准这里的新代码；`protocol.mjs`、`runtime.mjs`、`execute.mjs`、`prepare.mjs`须由非作者重新独立复审。机器报告约定为 `INDEPENDENT_REVIEW.json`，至少包括 independent=true、acceptedResumeCandidate=true、productionExecutionApproved=false、blockingFindings=[] 及 api/caller/runtime/sealer 四个精确SHA。

## 绑定及唯一范围

原AB批次9f79、原应用源5fa、Worker20261010T014638Z-97833d2f2b7e7bc9/f4e和Django237f保持。新main、C与无数据策略不采用。原批准05:28:51Z保持，不用新批准或本机次日重置。

原第19步 `316f341e…` 的unknown/exit1/strictEquality=false保持。295d真实批准原文件SHA `c70ac58556ffca976c0d19c0abebf5858da545b034c3b09048dd82f7fe8a3970`只授权了295d，不能代替新代码批准。89条现链head `ee784dfd…`、已accepted88及receipt `73c0de24…`固定；原87原字节、完整89链与实际失败复核报告绑定。原16:09:29 STATUS_NOT_READY保留，16:14另一次Ready不是原21通过。

旧4589全部输入和原当前4505闭包保持，复验原typed源合同及profile90/1完整根，不重新定义源变化或追加第二个acceptedSource。只执行原不可变20历史审计与21最终就绪；复用原collector完整动态binding、原argv/assertions、原PS5封装、原只读观察重试和原runApprovedOperation。新human receipt须对最终新scope明确允许“复用已接受源合同、只执行原20/21、保留原严格失败、精确释放owner”。旧9f79/0bca/7389/295d的消息标识全部拒绝作为新批准。

## 同一期限、记账与异常

单一预算最多3300000ms（55分钟）是拒绝无限等待的工程上限，**不是发布时间预测或提速证据**。调用器在完整pre-import核验之前建立一次绝对期限；通过原受支持的 `TERUISI_PROCESS_DEADLINE_UNIX_MS`继承机制约束原子进程。原 `processDeadline`会取本段期限与继承期限的较早者；不靠原runApprovedOperation忽略的context字段，不改变原argv、断言或NotReady分类。结束恢复本caller环境，不改全局环境。

同一原rotation互斥内，先复验精确89/head/active及旧状态，再记新批准。每步在完整准入后先started，再按真实直接退出/receipt/断言记结果。原观察重试的append可更新state，但每个协议append前后均核CAS、本event、条数和完整canonical最后事件。并发或新head不能接纳为本次前驱；第二次调用不能重放20/21。

每次完整scope哈希在原collector之前，包含原21前最后一次完整输入复核。collector后只做binding、active、小WAL和CAS检查，started前再验证并记录实际sample age不超过5秒；不把943MB扫描插在fresh sample与动作之间。原runApprovedOperation自身的完整依赖校验不省略。原21真实返回后只保留小元数据闭合和精确释放，记录返回到completion及release间隔；不宣称unlink时先前采样仍5秒以内，不新增重复Status、不采用泛化缓存。

准入失败单列 `tail-resume-admission-failed`，保全安全processEvidence、原状态观察的错误码/不可重试分类/原文件SHA与脱敏numeric basename。异常正文只留SHA和固定basenameframe，不存private path、查询、正文、DTO或凭据。子进程原临时输出的清理规则不变，因此没有原文件时只保存其真实字节数/SHA及原状态attempt，不能制造诊断正文。

20/21失败或完成证据缺失记unknown并停止；任意失败保留owner。尾部真实通过后追加单独 `completed-with-approved-exact-transitions`，明确 originalBatchEngineCompleted=false、originalStrictComparisonPassed=false、fullDeliveryClosed=false。CAS复验精确active文件身份/原字节/head，并在同一期限内unlink，回读ENOENT后才报告释放。若unlink已发生而完成回读迟到，记录释放未完整确认（null），不能伪称无效果或迟到成功。

旧journal读取先安全读取000000；缺旧目录只读拒绝，不为准备建立新生产目录。封存器只写新限定E artifact根，create-only/fsync，scope authority最后写入；不获取rotation lock、不调用API/collector/Status、不运行20/21。

## 作者验证与未覆盖

作者模型最终33/33通过，8814.6024ms（`AUTHOR_TESTS_FINAL.log`）；首轮25/25及中间31/31日志均保留，重复项不累计为额外覆盖。所有锁、operator、collector、WAL写入和释放均为内存替身；只读现存元数据建立模型，没有业务行/SQL/HTTP/生产方法调用或943MB dump校验。覆盖旧批准、新head、既有tail、源/closure漂移、typed源变化、准入/完整回执、原NotReady证据保留、并发/CAS、共同期限、迟到/无效释放、隐私及缺旧目录/硬链接；passed/unknown/admission日志写入失败都保留实际子进程/receipt/attempts/源错误摘要，不覆盖foreign WAL。原B14已知码及内层Status进程保持；未知枚举只hash，多层清洗保留合法SHA。

用户另要求真实隔离子进程：作者5/5首次通过（`AUTHOR_NATIVE_FIRST.log`，1455.4059ms），只用已pin原不可变模块的通用runProcess启动最小合成Node叶子，独立tmp cwd/无业务连接env、direct-exit-files/cleanup direct。4个实际PID的退出由signal0独立观察；第二次过期调用PID null明确未spawn。延迟父回调例有同PID私有exit marker真实exit0，但超过继承期限仍拒绝。没有调用operator/collector/Status或任何正式服务动作，未触碰服务树。非作者还须独立审代码和日志，作者不能把自己的通过作为独立认可。

最终目标文件lint完成、exit0、无源码warning/error；React版本检测因当前worktree未装React有工具环境提示。首次本worktree缺ESLint和随后unused-import warning的日志都保留，最终使用现存固定源的ESLint/config只读检查，没有安装、链接或修改依赖。新4运行模块已冻结，实际封存必须与非作者机器报告四SHA一致。

尚未执行实际封存器/调用器或新的生产准入。非作者审查通过、提交源码并create-only封存后，还须独立核最终scope物理字节和用户的精确新批准；之后真实执行及终态另做非作者只读复核。原pre全备份包未恢复，旧清理blocked、原历史失败及观测缺口不改变；必要验收和完整交付仍未闭合。
