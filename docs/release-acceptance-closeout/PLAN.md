# 发布优化 B：验收断言与证据收尾

2026-10-10。起始远端 main `99eaa0b90149a860d3e286c678ea4b2ab0a27160`，专用 `codex/release-acceptance-closeout` 分支。授权限于开发、隔离验证、独立复审、提交合并推送。主检出原改动及 E 盘封存材料保持；未操作生产生命周期、部署、业务写入、调度或外发。

依据：[客服发布](../release-customer-ps5-fix-20261009/PRODUCTION.md)、[原独立复审](../release-customer-ps5-fix-20261009/PRODUCTION_REVIEW.md)、[交互发布](../priority-interactions-20261009/PRODUCTION.md)、[风险审计](../runtime-risk-readonly-audit-20261009/REPORT.md)、[批次协议](../RELEASE_BATCH_WORKFLOW.md)。按实际 AGENTS 读取共享记忆、README、开发交付、验证发布、业务口径、导入、安全和存储规范。

## 历史保全

新增 [release-history-preservation.py](../../tools/release-history-preservation.py)。其 `capture(connection, scope, key, cutoff=None)` 只接收原域 reader 的独立空闲 DB-API 连接，不提供凭据入口。单笔 Repeatable Read READ ONLY 事务核验 reader、事务隔离及无 INSERT/UPDATE/DELETE 权限，按精确店铺和上海业务时间左闭右开查询现有表；无 API、表结构或写 SQL。查询有 200000 行边界，始终 ROLLBACK。

首次采集在该一致性快照固定 creation cutoff；后采集必须沿用前证据的 scope、cutoff 和外置随机 256 位 HMAC key。旧行集合两次都使用 `created_at < baseline.cutoff`，不以维护开始时间代替旧截点。捕获整个业务范围用于另外辨认新增，记录 cutoff 恰好相等的行而不把它算入旧集合。业务日期、主键、创建时间、导入批次与版本是范围/来源元数据；会话身份及全部导入字段、人工/AI标注字段、migration generation 用 HMAC，原客户值不持久化，key 不写报告。

`compare(before, after, transitions=(), source_receipts=None)` 分别返回旧范围 count、主键及会话身份、业务内容等价。删除、等计数替换、身份变化失败；内容不等不会因数量相等而放行。合法新增和单次重导只可通过 exact before/after rowDigest、batch、店铺、日期、completedAt、execution、raw/content SHA 与原独立回执的实际字节 SHA 核验解释。回执格式 `teruisi-source-transition-v1`，包含 `independent:true`、完整 source 及 exact transitions 清单。只有一个 SHA 标签不够。单次重导保持 first batch、创建时间、身份、标注及 migration generation，version 必须 +1；多次重导缺完整转移链时保守失败。即使合法重导被解释，`strictBusinessContentPreserved:false` 仍明确保留。

原3299→3302的基线只有聚合计数，不能升级成新行级基线。原09:02:36新增在维护前，且3189旧行有重导元数据更新；现有证据仍只能支持原复审已陈述的计数/店铺及新增来源结论，主键和内容保全标为无法证明。新实现不反推或补造该旧证据。

## UI 请求

新增 [release-acceptance-ui.mjs](../../tools/release-acceptance-ui.mjs)。静态资源只从批准候选逐路径 SHA inventory 放行，业务 GET 是任务复审过的精确 API pathname 清单，页面只限精确 HTTP 回环 origin。所有非 GET、其他 origin、额外端口、query 图标、fetch 图标、未批准后缀/路径保持 abort。

唯一图标例外是**已经 abort**的同 hostname/port、HTTPS、无 query、`/favicon.svg`、resourceType other/image，且批准 inventory 内确有该图标。它不获得网络许可。结束时必须另核验正常 HTTP 图标200与批准SHA；正常资源失败、缺失或SHA错误仍失败，不用图标分类证明那些资源已展示。

`exerciseCustomerImportUi`保留原两入口、四规范店名及顺序、8次选择、无文件禁导入和客服筛选文案的实际UI操作。新浏览器上下文必须 `serviceWorkers:'block'`；`installUiRequestAudit`保留请求类别、候选资源SHA、危险请求和失败。没有上传或点击导入。权限仍由原产品后端和相关领域测试证明，浏览器路由拦截不能代替服务端权限。隔离测试使用真实 Card/SearchableSelect/店铺配置与实际CSS的本地构建，非生产整页验收；后续新批次仍须在真实Home上执行原操作。

## 只读重试

新增 [release-readonly-retry.mjs](../../tools/release-readonly-retry.mjs)。初次+最多3次、固定2秒等待，总预算最多240000ms，包含慢Status查询、文件重新校验、等待及证据落盘。单探针最多60000ms，实际剩余期限更短则按剩余值。53秒×4+6秒=218秒，不是6秒总耗时，也不代表生产必然成功。

仅程序产生的 STATUS_TIMEOUT 及明确 OS code ECONNRESET/ETIMEDOUT/EAI_AGAIN 暂态可重试；普通非零退出、未知stderr、JSON错误、身份/权限/制品/完整性/就绪断言立即失败。不把旧查询未知归因于暂态。每次记录 stage、序号、耗时、固定脱敏code；不落原stdout/stderr、URL、argv或客户正文。Status runner只管理自己创建的只读探针，输出EOF也有界，不使用taskkill /T或触碰服务进程。同步文件系统/OS调用不能强制抢占，但返回后复验期限并禁止后续探针/成功结论。

两接缝：收尾操作显式 `readOnlyRetry:{version:'teruisi-status-retry-v1',totalTimeoutMs:240000}`，仅允许原精确SystemPS5/control `-Action Status -Json`；collector的acceptance/closeout完整就绪查询使用同一helper。12组件按真实域名逐项全true；完整源码/制品/前驱/权限门禁照常。不会重试Start、apply、备份、恢复、业务或整个collector。

## 自动收尾

新增 [release-closeout-report.mjs](../../tools/release-closeout-report.mjs)。只读离线 input，核验批准批次摘要、原canonical journal sequence/chain/bytes、所有声明回执的实际字节SHA及其WAL receipt SHA。副本日志采用固定marker投影而不复制正文；源、候选、前驱、运行观察、备份恢复、原失败、独立协调、每次尝试、未决及未执行均纳入JSON。严格类型和枚举投影避免嵌套原内容进入报告；CLI错误输出固定code。

计时以最早原批准时刻到真正completed墙钟为主，分别列原阶段duration、区间并集execution、等待/协调/未打点残差及批次完成后的文档交付；原重试记录为父duration内证据，不重复累加。协调跨度另列，不再次加到墙钟或执行。完成后的事件按真实区间裁剪，不向前平移。缺必要步骤、latest未知或取消时，没有成功/完成时长结论；`acceptancePassed:null`始终保留人工判断。封存前份元数据不代表dump仍可恢复。

输出目录与三个文件都是create-only，不覆写原证据、不调Status/服务、也不写批次completed。离线历史草稿是机制与事实核对样本，不是本任务生产验收。预计误报减少10～18分钟、文档减少5～10分钟均未新实测，不作为每批保证。
