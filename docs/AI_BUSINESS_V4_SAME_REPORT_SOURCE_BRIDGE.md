# v4 大容量来源与同报告文件流：封闭桥接候选

当前 `AiReportRun` 固定 `reference-v2` 证据 ID、版本与封存摘要；13 表组合和推广分卷调用同一报告的 sealed-v2 Reader。该 Reader 每来源最多 2,000 页、64 MiB，不能用它声称已读完参考规模的 575,095 行推广数据。`AiBusinessV4Run` 是另一套独立账本；它的真实封存回执验证 v4 自身的页面、工具审计、修订和应用 HMAC，但回执明确 `reportGenerationSupported=false`，没有指向任一 `AiReportRun` 的外键或创建时承诺。

`backend/business_analysis/report_v4_source_bridge_candidate.py` 是默认关闭的纯合同。输入须含新报告**创建时**声明的 v4 run/计划、原 v2 报告快照/工作流/证据身份、同一 owner、原始日期、京东店铺及分析请求；还须含完整三期容量计划和最新 v4 封存回执。它重建三个推广窗口的日期、来源身份、修订、引用及期望日期摘要，要求所有来源修订与当前修订相同。结果只给未来持久绑定的候选字节摘要；`persistedSameReportLinkVerified`、`v4RowsReadableForReport`、Agent 引用、renderer 和发布均固定为 false。调用方能重新计算所有普通 SHA256，因此该纯合同本身不能证明报告创建时声明或回执来自数据库。

正式接线仍需单独版本化并做隔离 PostgreSQL 升级/备份恢复验收：

1. 在**新报告创建事务**中记录 append-only、唯一 `(report_id, v4_run_id)` 的同报告桥；绑定不可变的报告快照、工作流输入、v2 seal、v4 plan/seal、三期来源 key/query digest/ref/revision、财报来源与创建时管理员版本。拒绝为既有 sealed-v2 报告事后附加 v4 run。若修改报告快照协议，必须另立版本，不静默改变旧报告。
2. 数据库拥有方函数复核两个真实父记录、当前账号和作用域、最新 seal 与全部来源修订，并在授权的 report writer 角色下才创建绑定。reader/Agent 不得写桥、调用签名入口或通过客户端传入 `reportId` 加 `sealedDigest` 自证。桥表不可更新、删除、换绑，唯一性和角色 ACL 均由 SQL 守卫；旧函数 OID/ACL 与 renderer 1–11 保持兼容。
3. 新 sealed-v4 来源 reader 要在报告开始、每卷和结束复验桥与来源，逐页重放原始字节、连续序号、工具审计、行数/控制总额、修订和封存根；把真实行迭代器接到现有私有分卷 writer。当前 v4 的 `inspect` 仅面向 collecting 父任务，`verify_seal` 只返回紧凑证明，均不是可直接使用的 sealed-v4 报告行流。
4. 13 表基础报告与大容量推广卷须引用同一桥摘要及同一报告意图；若原 v2 推广选源与 v4 数据范围不同，要显式版本化其替代/并列语义，不能把 v4 行冒充已经封存的 v2 行。金额口径仍分别标示，财报按自然月背景，不按日分摊或跨域相加。
5. 隔离环境验证跨店、跨报告、错三期、修订漂移、旧封存、篡改页、重复/缺页、角色越权、半写卷回滚；用真实来源和 Office/浏览器完成 575,095 行容量与 HTML/XLSX 一致性验收，之后才考虑注册 Agent/renderer 与受控发布。

本候选不占迁移号、不创建报告或文件、不修改线上开关；纯测试仅证明形状与失败关闭，不能替代 SQL 权限或客户数据规模验收。
