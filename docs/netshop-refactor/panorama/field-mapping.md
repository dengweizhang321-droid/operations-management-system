# 全景字段与依赖盘点

只读 main `c7c6c2a4`；后续 `daf21164` 仅增加协调文档，领域源码相同。以下为静态证据，不代表所选店铺期间实际有覆盖。新 DTO 字段与路径均待 F/I 冻结。

| 内容 | 已有字段 / 来源与源码 | 全景依赖与注意点 |
| --- | --- | --- |
| 2.1 | `transactionAmountCents/transactionOrders/transactionQuantity/transactionCustomers/refundAmountCents`，`backend/netshop/query.py:561`；销售 summary consumer 的 `current/previous/yearAgo`、periods/daily，`backend/sales/consumers.py:520` | P 提供两期全集贡献；订单客单价只用成立的订单分母；平台/ERP/归因分别保留 |
| 2.2 | `pageViews/visitors/favorites/addCartCustomers/addCartQuantity/orderCustomers/orderQuantity/orderAmountCents/conversionRate/uvValue` 与搜索字段，`backend/netshop/query.py:586` | `visitorAggregation=product_day_sum`；旧 `uvValue` 是元，需要明确适配。缺字段旧 `_zero` 会吞空，不能当真零（:557）。停留/跳失需要 P 公开与加权证据 |
| 2.3 | `id/platform/skuId/spuId/productCode/category/shopNames` 与金额/流量；目录图、品牌、规格、状态、价格、库存及 `snapshotDate`，`query.py:767/280` | TOP5/10、类目、增长下降由 P 的完整集合计算；当前一页不能重算全店；库存与状态是当前快照 |
| 2.4 | `spendCents/netTransactionAmountCents/grossTransactionAmountCents/impressions/clicks/netOrders/clickThroughRate/averageClickCostCents/roas/spendRate/daily`，`query.py:1083/1185` | A 输出带来源口径的结果、覆盖和店日配对。旧费率逻辑不满足新缺日主值要求；不拷贝它到全景 |
| 2.5 | `grossSalesCents/netSalesCents/costAmountCents/grossProfitCents/refundAmountCents/netQuantity/grossMarginRate/refundRate`，`backend/sales/query.py:284`；商品 consumer，`consumers.py:879` | 大毛利率 `(net-cost)/net`，订单毛利取导入字段。退货件数旧 summary/product consumer 没有，交 owner。精确 ERP 映射成立才关联单品 |
| 2.6 | 天猫 `newTransactionCustomers/repeatTransactionCustomers/repeatTransactionAmountCents` 已保存，`lib/netshop/normalized-import.ts:542`；京东 `jd_b2b/b2b`，`backend/netshop/analysis.py:22` | 类型存在不证明本店本期有事实或子集；新老买家是商品日累计，不是去重客户/复购；去重、复购、B端占比待证据 |
| 2.7 | 财报 `current/previous/yearAgo/yearToDate/timeline/targets/progress/sync`，`backend/finance/analysis.py:775`；年度进度 `annual_progress.py:91`；事件 `occurredAt/platform/channel/shopName/type/title/status/source/sourceRef`，`backend/workflow/operations.py:206` | 财务公开接口限制 unrestricted scope；现 consumer 搜索不是单店聚合，须 I/owner 适配，不放宽权限；财报按月，事件只对照 |
| 2.8 | `coverage.actualDates/missingDates/availableDateMin/Max`，`query.py:853`；导入 `source/dataset/platform/shopName/status/dateMin/dateMax/warnings/totals/completedAt`，`serialization.py:6`；analysis 修订栅栏，`analysis.py:195` | `/api/netshop/overview` 是导入元信息，不代表完整店日经营。`/api/workflow/import-chain-status` 只查询上海今日且不接参（`workflow/import_chain_views.py:10`），不能当历史记录 |

## 可复用接口与参数

| 已有接口 / consumer | 参数与边界 |
| --- | --- |
| `/api/netshop/product-performance` | `dimension=sku|spu`、`view=summary|full|page`、`q/platform/outlet/startDate/endDate/page/pageSize`；page 必须 snapshotToken；SKU 仅京东；旧730天/页100保留（`views.py:415`、`query.py:30`） |
| `/api/netshop/products` | 同上目录分页参数，当前档案快照；现 ERP 关联专用逻辑仅京东，天猫另验（`views.py:384`、`sales_client.py:178`） |
| `/api/netshop/promotion-performance/overview` | 显式 `platform/startDate/endDate`、可选 `outlet/snapshotToken` |
| `/api/netshop/promotion-performance/items` | 同上加 `q/page/pageSize`，旧上限500；来源身份继续保留（`views.py:453/515`） |
| 销售内部 `operation=summary` | `range=custom`、左闭右开日期、`platforms`、精确 `outlets[{platform,shopName,channel?}]`、`productQueries/categories`，最多366天；已有签名只读通道（`sales/consumers.py:324/520`、`netshop/sales_client.py:94`） |
| `/api/finance/analysis`、`/api/finance/targets` | analysis 用 month/platform/shop（财务复合键）；annual 用 view=annual/year/page/pageSize，无单店筛选；需要 unrestricted scope（`finance/views.py:52/263/292`） |
| `/api/workflow/operations-records` | GET，`platform/shopName/from/to/type/status/priority/owner/query/page/pageSize`，左闭右开；范围由服务端核验（`operations_views.py:107/322`） |

网店 outlet 沿用平台 + `\x1f` + 精确店名的序列化（`query.py:103`），不能换成店名或财务 JSON key。现网店授权是平台 scope（`lib/netshop/access.ts:25`）；不把它描述成已有的新单店授权。公开销售 summary/财报的 unrestricted 限制保留。

**口径陷阱：**ERP `averageOrderValueCents` 是 `netSalesExcludingAccessoriesCents / netQuantity`（`sales/query.py:300`），不能标订单客单价；网店目录的 `grossProfit/netSales` 不能替代销售大毛利率（:301）。全景不修其他领域算法；需求与证据交总控。

## 冻结前接口消费需求

| 依赖 | 要求字段能力（草案） | 验收条件 |
| --- | --- | --- |
| F | scope/periods/requestedScope/effectiveScope/schemaVersion、真实 principal、sourceRevisions/snapshotToken/coverageBySource/capabilities；每指标 value/unit/status/reasonCode/basis/aggregation/coverageRef | 实际日期与旧规则一致；短月闰日、范围/非法重复参；未知身份失败；不同种 token 不互比；未选店不自动选第一店 |
| P | 本期/基期/差额与 daily、身份/图片/类目/来源、成交商品数、TOP集中度、类目/增长下降贡献、高访低成交、精确详情、映射/库存快照；天猫条件字段 | 全集配对再排序分页；当前页1/基期页3仍正确；同 ID 跨店隔离；SKU/SPU不相加；字段未提供不填0；停留/跳失等有适用聚合证据 |
| A | 花费/归因/ROAS/CTR/CPC/订单及比较、daily、分布/重点对象；完整店日配对与能力、归因窗口、推广/触发/跟单身份 | 缺日整期费率主值 null；A店推广/B店商品不能配对；来源订单定义分开；钻取与组合版本成立；旧诊断范围限制保留 |
| I / owner | 财报/年度目标有界单店 consumer、ERP 退货量与率、事件和记录能力、共享导航/注册/薄 gateway | 最小 reader 权限不放宽；精确财务店铺映射；实际月范围；商品/推广/原领域往返保留店铺、日期、身份、章节、页码 |

多源读取前后 revision 不一致时，仅停止参与组合的指标。单源章节保留自己的可信结果与截止日，不声称分布式同一时点。正式 handler/consumer 必须在角色隔离 PostgreSQL 上验证；设计 UI 与源事实验收分别记录。
