# 京东物流受控自动化

日期：2026-10-15。实施工作树：`codex/jd-logistics-integration`。请求模型为 `gpt-6.1-sol`、`xhigh`；工具未独立返回实际型号。本记录仅描述源码、候选模板和隔离验证，不表示已安装、激活或完成正式采集导入。

## 入口与计划

候选模板为 `automation/n8n/jd-logistics-daily.workflow.json`，ID `JdLogisticsDaily2026`，`active=false`，时区 `Asia/Shanghai`，定时表达每天10:50；手动与定时共用原 helper 的协调接口。没有增加失败自动重放或小时重试入口。

链路为 `claim → A /jd-logistics/plan → B /jd-logistics/run → C /jd-logistics/verify → D /jd-logistics/notify → /jd-logistics/release`。A/B/C/D 的错误输出也进入原 execution 的 release，再用 Stop And Error 明确失败。领取未获授权时只在 A 前每5分钟等待；原协调接口72次上限保持。真实 helper 是 `tools/tmall-sycm-cookie-pipeline.ts` 与 `tools/tmall-isolated-helper.ts`；旧 `jackyun-continue-helper.ts` 是另一条续跑队列，不替换它。

`workflowKey=jd-logistics` 进入共享 legacy slot，与既有京东、吉客云和天猫共享资源互斥。业务与释放路由都要求同一 n8n execution；禁止空ID、跨执行、乱序与busy时释放。正常成功/失败由显式release收尾，失联由原inactivity机制收尾；浏览器清理失败会隔离该slot。

A读取后端 `GET /api/inventory/jd-logistics?operation=settings`、原受控京东账号注册表和独立 `config/jd-logistics-sources.json`。本地公共API使用原helper的回环fetch方式；不复制生产变量、Cookie或Token，鉴权拒绝即停止。

新来源配置为 `{version:1,bindings:[]}`，空绑定及各项disabled均不产生业务动作。绑定字段为 `sourceKind,departmentId,businessUnitCode,enabled,sourceVerified,contractVersion,collectorStoreKey,authorizedStoreKeys,warehouseCode`；流水另需显式 `initialStartDate,maxSpanDays`。四类能力分别与后端 `logisticsEnabled/capabilities/storeKeys` 取交集。原店铺enabled不会自动启用物流。启用但未验证来源、未知契约或超源最大范围均失败关闭。

同事业部、数据集和精确范围只计划一次；显式相同绑定可去重，冲突collector不会自动换账号。全仓与分仓重叠计划拒绝。流水从显式起始日到上海昨天，左闭右开；店铺商品v1固定为本次事业部“启用商品关系全集”，`sourceStatus=enabled`进入policyHash、planHash、导出证据及精确批次回执，不接停用/全部状态替换同一scope；实时库存绑定实际采集日；历史快照为上海T-1日。不得把实时采集标为历史余额。

## 持久证据与执行

运行证据位于 `outputs/jd-logistics-pipeline/`。`active.json`固定原runId、executionId和planHash；计划含协议、scope、collector、账号资源摘要、政策摘要及初始scopeRevision。修改业务阶段不能改变冻结计划哈希。计划持久化时先发布owner；意外中断导致owner有而计划缺失时停止，不自动建第二轮。

B串行调用父集成的 `tools/jd-logistics-export.ts`，仅接受已核验的真实来源适配。adapter必须在任何外部业务动作前调用 `assertOwner()`，以全局京东Chromium锁运行原Profile，持久化baseline、submit intent及唯一任务；submitting未知不得自动重发。pipeline在调用前也持久化`exporting`；该状态及任何失败均不自动回退。

adapter结果必须包含唯一taskIdentity、完整scope、来源身份观察、真实collectedAt、必要sourceAsOf及`browserClosed=true`。下载只接受本run/operation独立目录的原始文件，核验路径、文件身份、字节和SHA。两类C仓只接受XLSX，上限40MiB；流水和启用店铺商品另接受已核验中文表头的UTF-8/GB18030 CSV，上限8MiB。CSV保持原字节与`.csv`路径，不转换后冒充原始SHA。四类全部完成纯解析与内容哈希后，才开始串行导入；失败不会回滚已发布的其他数据集。

四类来源按父集成已实际观察的协议分别执行：

| 来源 | 完整范围与文件绑定 |
| --- | --- |
| 流水 | 通过可见El双月日历选日期，最多移动24个月，精确读回起止日；观察新鲜`queryStockFlowList`与`exportStockFlow`同一完整请求，业务时刻左闭右开、UI日期含末日。只接受`type=1/code=200/success=true`的直接CSV附件，固定IPv6 JD OSS origin与`/eclp-stock-back-oss/export/pub/stock_flow_*.csv`路径，原生Download URL必须等于本次返回附件。`direct:<摘要>`绑定本次本地requestId、scope、附件摘要及原文件，不冒称官方异步taskId；其他type保留未知，不重放或猜旧任务。 |
| 店铺商品（启用） | 唯一商品状态读回启用，其他筛选空；新鲜query/export RPC均精确`status=1+deptId+deptNo`，query总数、UI总数、task.recordCount与CSV行数一致。使用本次export响应返回的稳定taskId，再核taskParams中启用状态、事业部与源端完整店铺集合摘要；实际successCount=0仅保留原值，不当行数。监听网页`download(taskId)`及`getExportDownloadUrl(id,path)`的精确成功回执，原生Download URL必须等于本次task的附件URL；不同task、旧path及多下载候选均拒绝。CSV每行顶层`productStatus=启用`。 |
| 实时库存 | 页面导航前注册实际`listPageDetail`观察器，接受本次导航/查询的新鲜完整响应；不以缓存页面旧总数替代。实际采集时刻取本次导出请求时点。 |
| 库存快照 | 先选仓库状态全部并精确读回；只接受新鲜`listPageDetail`中`whStatus=0`及精确日期范围的请求和响应，再等UI同一总数稳定。父实测启用仓600条与全部仓900条不同，不能拿旧600证明全部仓。单日分仓文件与目标日一致。 |

两类C仓使用已观察的下载中心 `downloadCenterVev`，只观察网页本身`listPage`响应，不直接调用来源API。第一页固定10条，校验安全整数taskId与createTime同时降序；新增prefix必须有baselineMaxId锚点，十条全新而未见锚点时按截断拒绝，不能据此宣称唯一。候选要求精确文件名、源菜单、数据看板来源、秒级提交窗口和唯一post-baseline ID；状态/数量变化不改变身份。任务`deptNo=null`原样保留，仅以“本次真实导出请求的deptNo＋受控Profile＋唯一新task＋文件校验”作复合归属，不伪写任务自带BU。

签名附件URL仅在内存使用：只展开实际`&amp;`，协议相对源4URL只加`https:`，严格固定已观察的OSS origin和路径。JH显式浏览器导航使用CDP Request阶段拦截异origin重定向，并校验最终Download来源；manifest只留任务/请求/附件摘要，不保存签名URL、Cookie或headers。原legacy“名称＋创建时间＋查询条件”纯身份helper保留数量/状态变动反例；当前真实流水直出路径不回退去猜旧任务中心。

导入使用同一公开API的`POST operation=import`，保留原始SHA、完整标准化行、scope fencing、来源观察、collectedAt/sourceAsOf及collectorEvidence。规范化内容哈希忽略行号/顺序，保留重复事件的多重次数。HTTP成功还必须满足精确batch、范围、原始/内容hash、行数、来源及collector回执；POST结果未知时保留`importing`，不重发。

C重新读取磁盘manifest、原XLSX、纯解析结果和`GET operation=batches&batchId=精确ID`，独立核验当前事实的`currentSelection.current/contentHash/verifiedRowCount/scopeRevision`及当前政策。旧已完成但被新内容替换的批次、重复内容但无有效reference、文件变化、告警、撤销和未知提交均不能完成。所有计划项verified且资源关闭成立才记录completed；`disabled`、`duplicate`与新`imported`分别报告。

## 直接验证与边界

定向验证入口：

```powershell
node --import tsx --test tests/jd-logistics-pipeline.test.ts tests/jd-logistics-export.test.ts tests/jd-logistics-workflow.test.ts tests/tmall-isolated-helper.test.ts
```

覆盖默认关闭零动作、四类日期独立、共享来源去重、冲突collector、未知契约、原execution/跨execution、A后撤销、全文件校验屏障、来源/范围/清理失败、导入响应丢失、错误hash回执、C旧批次及原文件变化、重复事件和真实slot路由。API与导出替身只用于隔离验证，不能证明真实京东下载合同已经闭合。

共享helper不可变打包沿用 `tools/build-worker-helper.mjs`。本轮pipeline、policy、manifest均由调用方显式传入root，没有新增`import.meta`或放宽builder根目录声明。实际打包与最终测试结果随集成报告补充。

2026-10-15定向结果：上述三文件24项全部通过（16项pipeline、1项模板、7项原isolated helper），另新增duplicate精确原批次回查正反例。`tools/test-jd-logistics-helper-smoke.mjs`实际调用原immutable builder，并在全新合成mutable root和只读本地API上启动真实helper/Worker线程；完整claim/A/B/C/release、跨owner/乱序/retired execution拒绝、A失败释放均通过，业务写入0、下载0，最终状态为disabled。安全证据保存在临时目录 `C:/Users/86137/AppData/Local/Temp/teruisi-jd-logistics-helper-61oCCq`，包含build-receipt及合成manifest；没有复制生产变量或浏览器状态。

本自动化子任务不执行生产部署、结构迁移、工作流激活、真实业务导入或通知。本机inactive草稿安装由父集成另行完成并回读，最新状态见下文；早期“未安装”描述仅指模板制作时点。源端适配与文件契约仍以父集成的实际观察及导出报告为准。共享记忆由父集成统一收尾，本记录避免与其他子任务并发写同一vault笔记。

最终增量验证：43项全部通过（18项pipeline、17项exporter、1项模板、7项原isolated helper），覆盖CSV原字节B/C回查、非CSV数据集扩展名拒绝、任务状态变动/迟到旧ID/同窗多候选/分页截断、scope残留、下载RPC ID→附件精确绑定、签名URL实体与异origin重定向拒绝。叶子源码严格TypeScript检查与范围lint通过。再次调用原immutable builder与真实helper隔离演练通过，证据目录 `C:/Users/86137/AppData/Local/Temp/teruisi-jd-logistics-helper-1xvjDJ`；默认关闭，业务写入0、下载0。四源真实页面和文件证据由父集成手工采样取得，本增量没有再执行真实导出；受控自动串行正向及生产采用仍分别待验证/授权。

## D：默认关闭的缺货提醒

用户后续明确C仓业务页面也实施，并指定缺货提醒专用群为“测试群聊”。该指定仅约束本业务缺货提醒；没有扩大为其他工作流人工协助的群发授权。本D实现不发送测试消息，不启用正式通知配置；唯一群和现行“志高助手”的只读核验由父集成完成，真正发送前仍由Django动态核验目标，不持久化群/机器人真实ID。

A冻结后端`notification`的开关、配置摘要与固定群/机器人名称，并把本计划事业部的三开、阈值及来源资格写入`notificationPlan`和planHash。D只可能选择本计划同时含`realtime_inventory + inventory_snapshot`且C已逐项verified的事业部，不借用flow-only计划以外的旧库存去提醒；所有计划文件、批次和资源关闭均须成立。C结束阶段为`verified`，D结束后才是整轮`completed`。

全局关闭、配置缺失、空计划或没有满足物流/监控/推送三开及阈值的双库存事业部时，D在本地记录`disabled/not_configured/empty`并产生零`notify`业务POST。通知文件缺失时的空configDigest仅可在configured=false下表示未配置，不应阻断既有数据采集；其后启用或更换配置不能承用原冻结计划发送。

有资格的D先持久化`notification.stage=notifying`与请求摘要，再POST统一公开API的`operation=notify`，只发送本次`departmentIds,runId,executionId,protocol,planHash,verifiedBatches`。不允许调用者提供消息、收件人或目标URL。服务端独立复核当前批次、开关、阈值、风险、来源完整度和投递账本；消息由服务端构造为一次范围汇总，不逐SKU或事业部发送。

POST后只有严格确认的`sent/duplicate`或真`empty`可完成：sent/duplicate必须按精确deliveryId独立GET通知ledger，核对sent、完整事业部范围、riskCount、unknownCount、receipt/config/source/scope摘要及有界message/target摘要；重复回查只读该精确ledger，不再POST。`notified`内部阶段表示D终态已核验，是否外发仍以status为准，不能把disabled/empty/duplicate伪报为新发送。

已知风险与未知覆盖分别披露：已知risk>0时可按服务端摘要发送并注明unknownCount；无risk且未知覆盖不为零不能叫“无风险”。D已POST却收到disabled/not_configured/denied等未投递结果时明确失败停止；收到empty但unknownCount>0也失败，不能当本地关闭的正常skip。网络/HTTP结果未知、未知回执或精确ledger不符，保留`unknown`、原响应与deliveryId（若已取得），禁止同execution重POST；数据已verified的事实与回执保留，不回滚导入。

通知新增验证只覆盖D及直接受影响的helper/模板：默认关闭/无计划零POST、缺配置、缺双库存范围、跨owner/未完成C、三开与阈值、发送/duplicate精确回查、响应丢失/unknown不重放、错误ledger、C后撤销、发送已知风险同时披露未知覆盖、POST未配置失败及真empty/未知覆盖区分。没有为D重跑真实来源或再次执行旧四源下载验收。

D最终验证：13项通知/关闭/owner路由定向全部通过，另1项A/B/C/D模板验证通过；严格叶子TypeScript检查和范围lint通过。最终原immutable builder及真实helper关闭演练证据为 `C:/Users/86137/AppData/Local/Temp/teruisi-jd-logistics-helper-WwEQdf`，完整claim/A/B/C/D/release与失败释放均通过，业务写入0、下载0、真实外发0。

父集成随后按本次“搭建工作流”授权，通过官方n8n CLI成功导入本机未发布inactive草稿：`JdLogisticsDaily2026`，`active=false`，13节点、11组connections与冻结JSON相等。首次冻结SHA为 `ecef4f5b9c7564131b9a187c1741d6c307efcd314478555f87b41e5c95bcd5a8`；父仅将sticky note中的“未安装”改为“安装与发布状态以当前画布为准”，业务节点和边保持，最终SHA为 `c5d897c4b245eec0ebb61ae9ca0f05a31d410eddc1518c512458abfc4428b654` 并重导本JD inactive草稿，模板1项增量复验通过。原22条工作流name/active/nodes/connections/settings摘要未变，当前总数23、active仍17；未publish、activate或run。该草稿安装不表示正式helper/Worker/Django服务已部署，也不表示通知全局开关或事业部开关已启用。
