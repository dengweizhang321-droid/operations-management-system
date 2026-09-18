# ERP 精确来源选项：设计与候选纯合同

2026-09-18。当前只实现 `backend/sales/analysis_options_contract.py` 与11项纯测试；没有 owning 服务、URL、权限变更、索引表或迁移，也没有数据库或生产规模验收。

## 已核验事实

- `sales.analysis.validate()` 要求原始 `platform/shop/channel` 三项非空、无首尾空白、各不超过200字符。平台不是“京东/天猫”枚举；不能把合法原始其他平台删除，也不能从渠道名猜平台。
- `sales.analysis.read_page()` 同时限定 `is_business_row=True` 和原始 platform/shop_name/channel 等于对应 platform_key/shop_key/channel_key。同名跨平台、同店多个渠道都是不同来源。它以 `business_date`（发货业务日）取数，不用下单日替代。
- `SalesOrderLine` 已有这些查询投影和部分索引，可以复用初始化数据源及计算口径；但它仍是业务事实表，不能把它改称目录元数据表来满足“GET不扫描事实”的要求。
- `sales_projection_values()` 会 trim 原字段构造投影，并把空店铺回退到渠道/平台。summary 还保留旧展示回退和别名语义。因此 summary 的 shops/platforms 列表、consumer 的合并别名选项均不能作为新精确身份来源。
- `sales.write_service._scope_material()` 的成功批次范围仅为 `{source:'sales_ledger', startDate, endDate, channels?}`；不含平台+店铺组合。成功日期区间/渠道白名单不证明每个店铺在每一天出现。不能仅依赖成功批次恢复 ERP 目录。
- `erp_reference.ErpProductMaster` 使用全局 product_code，映射到现有 `erp_product_master`，没有平台/店铺/渠道字段。商品主数据是商品关联辅助，不是 ERP 店铺来源目录。当前网店 master 映射也必须用户显式固定，选项不自动选择它。
- `sales.query.revision_token()` 为 `salesRevision:erpRevision` 双十进制版本，不是市场的 `revision:digestPrefix`。当前纯合同保持该格式。

## 推荐最小正确实现顺序

先合入独立纯合同，再由根确认新增目录索引模式。本片不提供“GET直接DISTINCT事实”的临时降级。建议后续新增 sales owning 精确索引和单例状态两表，SQL迁移名随当时最新 sales migration 决定，不提前占号。

索引每项保存精确三字段、firstDate/lastDate、正 rowCount、规范 item 和摘要；唯一约束使用完整三字段。state 保存 ready/not_ready/blocked、generation、directoryDigest、identityCount/canonicalBytes、准备时 salesRevision。建议首档最多10000身份、16MiB规范目录；这只是待单独合同/PG验证的设计上限，本片没有证明已达到该容量。不得只留下前10000项。

初始化读取器只选 `is_business_row=True` 且原始三字段和投影三键逐项精确相等的分组，以固定C排序聚合 COUNT/MIN/MAX(business_date)，最多10001组用于明确超量拒绝，不读取客户/订单/金额/商品字段。空/回退/首尾空白身份不属于现有精确分析可查询集合，不修复或替换它们；必须说明目录不代表所有原始导入行。原值和键虽相等但含控制符/坏日期等不满足新协议时，完整初始化失败，不能静默删除该组后称成功。文字 `未分类` 本身若确为非空原值且键完全相等仍合法，不能把字面值一概删除。

准备在最外层事务外完整读取，前后核 salesRevision、真实当前账号和完整分组摘要。发布用不可从JSON恢复的内部胶囊，在短事务内取得既有销售权威/修订围栏并复验版本后替换全部目录/state；不能在全局写锁内重扫事实。不同平台和渠道的精确身份保留，不执行别名归一。

初次最小同步采用**版本失配失败关闭**：成功销售替换/导入/迁移引起 salesRevision 变化后，旧 ready 索引立即不可用，返回明确 stale/not_ready；显式完整重建后才重新可选。ERP商品分类修订只作废双版本游标，不改变身份日期目录，state 可单独比较 salesRevision。此方案需要每日导入后的受控重建调度才能持续可用；没有调度前不能声称无人值守可用。后续若增量维护，必须从真实受影响的旧新行身份重新聚合，尤其替换删除可能减少日期包络，不能将批次日期永久并集。两个方案不能混称已完成。

D1重新初始化、PG历史恢复没有已核实目录时显式 not_ready。导入原业务成功不应被新目录构建失败回滚；新目录不可用须明显展示。备份需条件化新增表/迁移依据，保留旧备份合法；备份恢复验收要重读真实 owning 页并核销售修订，不从表存在推断 ready。

## 候选API与实时授权（尚未实现）

建议独立 `GET /api/sales/analysis-options`，仅 reader/development URLConf注册，sales_writer不提供。严格可选query：platform/shop/channel/cursor/limit，limit省略或字符串20，shop须带platform。首版不提供 q 模糊搜索，避免SQL icontains与Unicode casefold不一致及盲目增加搜索投影；三项精确过滤已可逐层收窄。拒绝未知/重复参数，不能用dict转换提前抹掉重复。读页按完整三字段C顺序keyset、LIMIT21，不查精确total。

页schema=`business-analysis-options-v1`/domain=`sales`，项为 identity三字段、source=`erp_sales`、sourceDataset=`sales_order_lines`、日期元数据和来源口径。这里 sourceDataset 明确指选项数据来源表，是新DTO字段；不改现有 sales.analysis 证据页（该页没有sourceDataset字段）。日期 kind=`current_fact_business_date_envelope`，coverageVerified永远false；当前事实包络区别于网店/市场历史批次包络。空目录仅在完整初始化且版本一致时合法，403/503/超时/超容量不得回200空页。纯页 authorityVerified=false；未来 owning 复核授权/来源后才可生成自己的真实封套并重算摘要。

每页固定上限20条、完整UTF-8响应38000字节，长身份不能裁切；整页超限明确拒绝，不能伪称已到末页。1小时签名cursor应绑定协议/真实principal email、role、scope、version、三项query、sales:erp修订、directory generation/digest、limit20、最后完整三字段。账号变化403，来源/筛选变化409。选中前重新读取该页绑定，不改用户的分析日期或请求窗口。

新 GET 必须前后读取真实 AppUser，要求 active/admin/scope=None；现有 sales.auth.verify_principal 仅证明签名，不证明签名后未撤权。只授 sales reader 必要的用户 email/role/status/scope/version 五列SELECT并在health验证，不能扩整表用户权限；是否已有相关grants需未来 owning实施时检查。不能复用旧免登fallback当真实授权。新目录不新增模型工具，也不改变旧工具catalog、原生ERP明细、预算或映射算法。

## 已实现纯模块接口与边界

- `normalize_identity(value)`：严格三个原始精确标量，不增加平台枚举、不trim、不补默认。
- `normalize_query(value)`：仅可选精确三字段，shop依赖platform；不含cursor/limit/q，HTTP解析留给未来 owning。
- `normalize_group(value)`：严格九字段：platform/shop_name/channel/platform_key/shop_key/channel_key/firstDate/lastDate/rowCount。核 raw==key、真实ISO日期和正安全整数计数；不接受成功批次scope或ERP商品元数据冒充group。
- `make_page(groups, *, query, revision, has_more, next_cursor, previous_identity=None)`：至多20组，严格顺序/跨页边界/筛选/摘要/完整字节限制；返回独立无别名DTO。cursor只是有界不透明字符串，签名与previous_identity可信来源必须由 owning验证；纯层不能证明权限、SQL完成、is_business_row或ready。

与旧分析验证相比，新纯DTO还拒绝Unicode Cc/Cs（包括DEL和代理码位）；不修改旧reader。未来初始化遇此类旧异常数据须失败并报告需修复，不可悄然漏掉。纯合同无目录整体容量或持久化主张，不设置虚假的authority ready。

## 验收范围

本片 `PYTHONPATH=backend python -m unittest sales.test_analysis_options_contract -v`：11项通过。覆盖跨平台/多渠道不合并、空及trim/fallback拒绝、成功批次/主数据不能猜身份、精确filter、无q别名、坏日期/数字混同/Unicode、输入变异隔离、页摘要、20/21条、跨页乱序/重复、完整UTF-8超限、sales:erp版本格式。仅纯测试，没有PG、生产或模型调用。

后续 owning 必须另测：真实销售导入与替换删除/日期缩小、raw==key可查询边界、刷刷仓排除、初始空/未就绪区分、原生查询结果身份一致；真实受限reader成功且事实/用户敏感列无权读；GET SQL只能目录/auth/revision，初始化事实SQL独立；失败/超时不发部分目录；并发导入与准备/发布互斥、修订变化、撤权/跨scope、游标篡改/过期与Unicode排序；10001组和长字段完整拒绝、旧备份兼容/独立恢复。若实际聚合计划无法在原查询期限内完成，先设计专门初始化预算或增量索引，不能放宽正式API超时掩盖成本。
