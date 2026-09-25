# v4 大容量来源与同报告文件流：封闭桥接候选

当前 `AiReportRun` 固定 `reference-v2` 证据 ID、版本与封存摘要；13 表组合和推广分卷调用同一报告的 sealed-v2 Reader。该 Reader 每来源最多 2,000 页、64 MiB，不能用它声称已读完参考规模的 575,095 行推广数据。`AiBusinessV4Run` 是另一套独立账本；它的真实封存回执验证 v4 自身的页面、工具审计、修订和应用 HMAC，但回执明确 `reportGenerationSupported=false`，没有指向任一 `AiReportRun` 的外键或创建时承诺。

`backend/business_analysis/report_v4_source_bridge_candidate.py` 是默认关闭的纯合同。输入须含新报告**创建时**声明的 v4 run/计划、原 v2 报告快照/工作流/证据身份、同一 owner、原始日期、京东店铺及分析请求；还须含完整三期容量计划和最新 v4 封存回执。它重建三个推广窗口的日期、来源身份、修订、引用及期望日期摘要，要求所有来源修订与当前修订相同。结果只给未来持久绑定的候选字节摘要；`persistedSameReportLinkVerified`、`v4RowsReadableForReport`、Agent 引用、renderer 和发布均固定为 false。调用方能重新计算所有普通 SHA256，因此该纯合同本身不能证明报告创建时声明或回执来自数据库。

`backend/business_analysis/report_v4_promotion_stream_candidate.py` 接受上述候选、单窗口精确来源摘要与拥有方提供的页/审计迭代器。它在第一遍完整核对连续页、请求游标审计、响应原始摘要、行 ID、控制总额、期内全部日期和来源修订，第二遍才逐行交给私有 sink；第二遍或最终拥有方复验失败会 `abort()`，不留下完成回执。单来源上限沿用 v4 的 16,384 页与 2 GiB，未套用 v2 的 2,000 页/20 万行限制。当前测试仅为 30 行合成页；575,095 行只是 v4 容量计划的合成估算，未验证此新流的真实耗时或真实来源。

这个 stream 的 `pages_factory`、`source` 和 `verify_current` 仍由调用方提供，普通摘要都可重算；`complete()` 仅代表私有暂存完整。当前系统没有能从真实 sealed-v4 页、工具审计、HMAC 封存、同报告数据库绑定同时构造这些输入的拥有方 adapter，也没有允许它进入现有 v2 `sourceManifest` 的版本化 writer。不能把这份候选回执转换成下载权限。

正式接线仍需单独版本化并做隔离 PostgreSQL 升级/备份恢复验收：

1. 在**新报告创建事务**中记录 append-only、`report_id` 主键且 `v4_run_id` 唯一的同报告桥；绑定不可变的报告快照、工作流输入、v2 seal、v4 plan/seal、三期来源 key/query digest/ref/revision、财报来源与创建时管理员版本。应由新版本报告 `AFTER INSERT` 触发器写入，禁止独立的事后 `INSERT`；现有 `reference-v2` 报告没有该声明，不能追补。`reportSnapshotDigest` 应在插入后由数据库计算并存入桥表，避免把自身摘要嵌进 snapshot 造成循环。若修改报告快照协议，必须另立版本，不静默改变旧报告。
2. 报告创建应用先运行现有 `verify_seal` 的全页/HMAC 校验；在写事务中锁住并重核其 `run_id`、seal 摘要、目录版本、来源修订与管理员版本，再由数据库拥有方触发器写桥。数据库无法仅凭普通 SHA256 证明应用 HMAC，应用预检与 SQL 当前态栅栏两者都必需。`ai_writer` 只获新报告创建入口所需权限，不能直接 `INSERT/UPDATE/DELETE` 桥表；`ai_reader`/Agent 只经固定 `SECURITY DEFINER` 只读函数核当前报告/桥/来源，不能写桥、调用签名入口或通过客户端传入 `reportId` 加 `sealedDigest` 自证。旧函数 OID/ACL 与 renderer 1–11 保持兼容。
3. 新 sealed-v4 来源 reader 要在报告开始、每卷和结束复验桥与来源，逐页重放原始字节、连续序号、工具审计、行数/控制总额、修订和封存根；从真实 seal 正文读取 `receiptChainDigest`，从完整检查点读取 `evidenceDigest`，再构造当前纯流所需摘要。把真实行迭代器接到**新版本**私有分卷 writer，沿用现有逐卷 HTML/XLSX 回读算法与失败中止规则。当前 v4 的 `inspect` 仅面向 collecting 父任务，`verify_seal` 只返回紧凑证明，均不是可直接使用的 sealed-v4 报告行流。
4. 13 表基础报告与大容量推广卷须引用同一桥摘要及同一报告意图；若原 v2 推广选源与 v4 数据范围不同，要显式版本化其替代/并列语义，不能把 v4 行冒充已经封存的 v2 行。金额口径仍分别标示，财报按自然月背景，不按日分摊或跨域相加。
5. 隔离环境验证跨店、跨报告、错三期、修订漂移、旧封存、篡改页、重复/缺页、角色越权、半写卷回滚；用真实来源和 Office/浏览器完成 575,095 行容量与 HTML/XLSX 一致性验收，之后才考虑注册 Agent/renderer 与受控发布。

本候选不占迁移号、不创建报告或文件、不修改线上开关；纯测试仅证明形状与失败关闭，不能替代 SQL 权限或客户数据规模验收。
