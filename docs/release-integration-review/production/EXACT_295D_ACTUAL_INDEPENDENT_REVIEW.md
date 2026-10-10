# 295d 实际补充执行独立复核

本次执行**未完成 AB 收尾**。用户实际批准的精确补充 `295d8923fb794079faf5cc9c74f92f12d8bd78a3ccbbce4b9dcbb19e00fcc458` 已追加新的精确变化合同通过记录，但唯一调用器随后 exit1；原只读20历史审计、21最终就绪都没有启动。原 active9仍保留，不能重入已经消费了原head的这份 scope，也不能把调用器停止或合同通过当作整批完成。

非作者只读捕获时间：2026-10-10 16:14:15.623Z（北京时间2026-10-11 00:14:15）。机器结果见 [EXACT_295D_ACTUAL_INDEPENDENT_REVIEW.json](EXACT_295D_ACTUAL_INDEPENDENT_REVIEW.json)；独立核验脚本 [exact-295d-actual-independent.mjs](exact-295d-actual-independent.mjs) 只读取已存在的终态文件、小型清单与日志，输出本工作树报告，没有导入生产工具或调用 API/collector/Status/SQL/HTTP/锁/生命周期/Backup/Restore，也没有重复完整闭包或dump哈希。

## 实际批准及调用器终态

新人工批准原文件固定完整scope，`explicitHumanApproval=true`、`acceptExactConcurrentTransitions=true`、`preserveOriginalStrictFailure=true`；实际批准时间15:59:48Z，消息标识 `01a1268a-bc4d-7501-98f1-5ec3ceaa2a99`。原AB批准05:28:51Z保持。这是本次真实新批准，封存时 `productionSupplementApproved=false` 的旧快照没有被当成当前授权状态。

固定 API SHA `b4d5c0876086712dfa63b8f6192a6827ae5730dfab920bb22d6bc7c17b1343f9` 和 caller SHA `465ad68a9f6c9b8494e969aac61b2299214860ea896e62067e836e359cca1c04` 的物理字节仍匹配scope；scope canonical摘要和原侧文件也匹配。源码提交 `60d68879ce0f41ceb5389180b85660c532cbb508` 指本次补充证据/协议源码，不能将它写成生产应用源码已换版。

| 事实 | 原始结果 |
| --- | --- |
| 唯一调用器 | PID23656，16:02:43.604Z开始，16:10:06.046Z结束 |
| 外层结果 | exit1、signal null、442440.7197ms |
| 原 stdout | 0字节，SHA `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| 原 stderr | 206字节，SHA `356e425f8d366127eb6aacdcf9090161dc5f2f94e947e4dc47ac29ad09e135b0` |
| stderr内容 | `exact-acceptance-supplement-rejected`、Error；messageSHA `89af35ecd4898a67168820857c157cd22d018b3acac9ca466e763f959a1e5496`，sourceLocation null |

这次外层stdout/stderr原文件确实存在，字节数和摘要与 `execute-finished.json` 完全相等。它们不能替代失败准入子进程的原stdout/stderr或processEvidence；这些子进程信息未被本次失败回执持久化。后来取得的原 `_observations` 证实状态准入失败；不能从被脱敏的messageSHA或状态错误码推断具体哪个组件/触发原因，更不能重新制造原诊断正文。

## 原日志及新增合同

89条现存 WAL 的序号、previous、batch绑定、canonical原字节和全部event摘要独立复核通过。最初87条与此前已归档的 `E7389/production/DELIVERY-cb007f05/journal-at-delivery` **逐字节相等**。原19仍是11:03:09Z的非零unknown `316f341eafafe08c3366fc79ca2c36b96258d2b00fcd9767a82a32cd62f7ce7d`，exit1与stderr摘要原值保持；原strictEquality仍false，原engine正常completed仍false。

新增87是16:07:16.824Z的首轮完整准入记账 `b3a73a3a6091b4e10c01671b4ce77ee6fcb02b9f2d23f433acd3a257b932e8ef`，duration245423.7965ms。新增88是16:07:17.063Z的 `exact-transition-acceptance-passed`，head `ee784dfd718bc16aabcc2868667ac5b5d707bf3a582624a4f722019a050d7485`，receipt `73c0de244c7358a9c7031411dac86d1c028689bdd02efb5e14a0e7154d5c5f5f`。用实际批准原JSON、完整scope和记录内acceptanceProof重算receipt，精确相等。

该通过限定296张profile中的290张不变、4追加旧根、3项精确变化/其他87项保持、1评论、4工作流写、193内部空claim等新合同真值；历史签名重验、原人授权独立恢复、原严格相等仍为false，不能由新通过倒填。

原1–18的此前终态保持，原1–19没有任何本轮started或效果重放。20/21既没有started，也没有passed/unknown/processEvidence/真实receipt；没有新completion事件或原engine正常completed。当前实际失败边界在原20启动前的准入流程，尚无原20业务动作结果可协调。原观测重试仅属于此前历史，本轮原21的状态重试尚未执行。

## 所有权、版本与未闭合事项

捕获时 active原字节仍属于 `integration-ab-v2-20261010-c22d8dd69a` / 原batch `9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15`；没有释放证明。不能手删 active，不能使用旧execute跳过19，也不能重复调用这份head绑定的补充scope来寻找green。

只读核小型实际运行清单：Worker仍 `20261010T014638Z-97833d2f2b7e7bc9`，manifest物理 SHA `f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113`，sourceFingerprint仍 `92c2656c064c6a202239f4f010f0d241e90ae19fb35638cd328727a7ac64973c`，对应原限定AB5fa源码；Django部署清单物理SHA仍 `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9`。没有新部署/生命周期记录，C和新无数据策略未由此补充采用。清单身份只能证明这次观测的版本元数据，不能用它或页面200覆盖当前动态健康未知。

原批准到本次停止38475046ms（约641.251分钟），**不得把此区间当作验收闭合**。本轮约7.374分钟，新批准到停止约10.301分钟。源证明12.444827秒、队列1.6851ms、首轮准入245.423797秒分别保留，未闭合的后续准入/失败时间不能消失或重复加进源证明。必要验收闭合和完整交付时间仍为null，原暂停/历史失败/入口异常继续按原独立报告保留；本报告未新增主动入口请求或宣称全程无异常。

## 后续取得的原观察证据

已直接读取原 `_observations/integration-ab-v2-20261010-c22d8dd69a-ab0b0c76-a1f4-4ced-9344-d5931a1bc6d3/1.json`：16:06:10.905Z、首个状态观察passed、35249.8704ms；读取 `…-795cf0fe-1590-432a-9047-64b3840ed049/1.json`：16:09:29.948Z、首个状态观察failed、`STATUS_NOT_READY`、retryable=false、35919.2876ms。这些是原collector持久化的状态尝试，不是为改变原WAL或失败而重建的记录。具体失败组件/原子触发条件仍未知。

执行者另一次明确的只读诊断 Status（未由本reviewer执行）于16:14:03.267–16:14:39.083Z回读 Running/Ready/exact_release/原AB，12个实际组件均true。原518字节stdout SHA `7ad819e68973fb26659975c8b46fbefcebb7f755e33c013129d1d89e16eb252f` 与单独process metadata精确匹配（PID68700、exit0/direct/completed，35811ms）。其标识明确 `notOriginalOperation21=true`；它不覆盖此前 `STATUS_NOT_READY`，不是原21通过，也没有释放active。

同批观察器已经冻结：16:02:33.574–16:12:30.031Z，238个原JSONL样本、0个入口不可用样本，stop reason是本补充在20前exit1。该窗口不覆盖以前异常或未观测区间，也不能用入口200覆盖本次真实状态准入失败。首版实际JSON（SHA `e6b52b7a1b7bc9ff109ed1f175f93b93b6782df9aae53b92169447ea614fad7d`）另存 [EXACT_295D_ACTUAL_INDEPENDENT_REVIEW_FIRST.json](EXACT_295D_ACTUAL_INDEPENDENT_REVIEW_FIRST.json)，后取得原观察记录和单独诊断以补充观测时间追加，保留首次截点。

后续若继续，先保全本次失败与89条真实链，再用受审的精确新续接范围明确承认合同已记账、20/21未启动及owner未释放，并获取对应授权/动态准入；本报告不授权新协议、协调、重试或生产操作。
