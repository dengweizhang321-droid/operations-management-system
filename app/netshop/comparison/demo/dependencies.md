# 对比栏目依赖与接线门槛

本记录适用3.1—3.6；属于接口需求，未冻结的新字段/路径不是现有服务。当前设计分支已同步协调记录 `daf211644efffdc762c0d33c1faba992cf082df7`，原开工基线为 `c7c6c2a4c012dd60af0565b97b2d2f11f9246c0a`。F/P/A未验收合入，用户尚未选择对比版式。本轮只在 `app/netshop/comparison/demo/**` 工作。

## 依赖接口、字段与验收

| 所属 | 需求/候选入口 | 必需字段 | 接线验收条件 |
| --- | --- | --- | --- |
| F | 精确店铺目录、身份/日历/覆盖/导航；公共草案 `netshop-insights-v1` | 授权候选全集、平台+精确店铺；current/previous范围及日历版本；逐店逐日coverage；能力、reasonCode、sourceRevisions/snapshotToken | I公布冻结提交与消费样例；候选不依赖当前排名页；同名/同ID跨店不串；自然周、短月和闰日通过 |
| P | 商品分析服务，建议 `/api/netshop/product-insights` 及详情 | 同店同维度平台成交、订单/销量原口径；访客/成交客户累计；两期完整商品候选；类目字典、TOP分子分母、价格带basis、同款映射版本 | 仅消费已合main服务；先全集配对后分页；未知类目保留；SKU/SPU隔离；同款映射有证据；天猫ERP关联另验 |
| A | 推广分析服务，建议 `/api/netshop/promotion-insights` 及详情 | spend、attributedRevenue、clicks、impressions；ROAS/CTR/CPC原始分子分母；费率逐店日配对与覆盖；归因来源/窗口/订单定义 | 同平台优先；A店推广+B店商品不能生成费率；整期不完整主费率null；JD/Tmall归因不同不混排；详情是真实专题 |
| Sales | 既有权限内有界consumer，由I协调增量需求 | grossSalesCents/netSalesCents/refundAmountCents/orderCount/netQuantity/grossProfitCents/costAmountCents；正向/退款数量定义；本期基期完整候选、实际截止日与截断 | 大毛利率继续 `(net-cost)/net`；订单毛利独立；客单价与件均净额分别定义；不把本期无行对象静默删除；不读取受限店铺 |
| C | 建议 `/api/netshop/comparison-insights` 专属只读服务 | 集合、对象summary/trend/structure、ratio_of_sums、分页、可比性、范围变化分解 | 先取得F/P/A已验收SHA；浏览器只渲染；独立PG规模/权限/执行计划验收后才接线；当前没有实现该服务 |
| I/S | 公共网关、路由、权限和专题目标 | 旧 `module=shop&view=platforms`；共享上下文、全景/商品/推广返回位置与页码 | I修改公共文件；目标在main真实存在；深链、刷新、前后退、快切及权限保持一致 |

所有正式响应须带共享合同要求的 `schemaVersion/requestId/scopeKey/requestedScope/effectiveScope/periods/sourceRevisions/snapshotToken/freshness/coverageBySource/capabilities/pagination/warnings`。权限来自服务端principal，不能把URL或请求中角色作为授权依据。新接口日期/店铺/页大小/响应预算须由F/I冻结，不把文档建议的366天、50店、20/100行当已实施限制。

## 比较集合

1. 在服务端权限内获取本期与基期完整候选，按平台+精确店铺身份做并集和配对；对象选择仅限制展示，不能以两期TOP页代替全集。
2. 店铺模式仅含店铺；平台模式平台值由该平台有证据的候选聚合。平台展开行属于解释明细，不参与第二次总计和同榜排名。
3. 完整排名依指标、两期定义一致、所需字段与店×日覆盖成立决定。部分覆盖对象仍可查看已覆盖加总与缺口，增长、指数和整期费率不伪装完整结果。过滤“覆盖完整”是显式选择，原排除原因仍可查看。
4. 持续店铺变化：只在两期身份历史与各指标全覆盖成立时，计算持续集合本期-基期。范围变化为经验证进入集合的本期量减退出集合的基期量。缺记录不证明开店/关店；总变化应可与两部分核对，不满足条件返回状态与原因。

## 指标定义与不可比条件

| 指标 | 计算/展示 | 不可比或不可计算 |
| --- | --- | --- |
| 平台成交 | 商品日报原金额，安全整数分，按元/万元格式化 | SKU/SPU维度或原金额语义不同；来源不全不能当完整店铺成交 |
| ERP净销售/订单毛利 | 复用销售域口径；净销售含负退款，订单毛利原字段加总 | 平台成交/归因成交/财报不能合成一个销售额 |
| 差额/增长 | 同basis本期-基期；仅正且完整基期算 `(current-base)/base` | 0、负、缺失或覆盖不足时增长主值null，并保留可成立的差额 |
| 贡献 | 规模份额须明确完整可比集合；差额贡献须另名并注明分母 | 不把“本期占比”叫增长贡献；总差额0不算差额贡献；增减混合时解释有符号贡献 |
| 客单价 | 验证同源成交与可信订单数后计算金额/订单 | 不采用旧字段名猜定义；ERP既有averageOrderValueCents为剔配件净额/净数量，属于件均净额 |
| 大毛利率 | `(净销售合计-成本合计)/净销售合计`，分子分母合计 | 不用订单毛利/净额替代；分母0或语义不成立留空 |
| 退货率 | 明确金额率/订单率/件数率及同源分母 | 不把不同退款事件、净数/正向数混用 |
| 商品效率 | 同维度同源成交客户累计/访客累计；原数据不是店铺UV | 京东SKU与天猫SPU不能无说明排名；缺可靠店铺UV不称客户转化 |
| 推广效率 | ROAS=归因额/花费；CTR=点击/展现；CPC=花费/点击 | 不平均店铺比率；归因窗口未知须披露；ROAS不当利润或广告增量 |
| 推广费率 | 同平台×店×日花费/同身份平台成交 | 整期缺覆盖主值null；可披露已配对部分的独立辅助范围，不能顶替主值 |
| 指数走势 | 明确正的有效基准为100；同单位/指标；缺日断线 | 0/负/缺失基准不强算；自然周不是每7天 |
| 结构/集中度 | 完整候选类目/商品贡献，TOP5/10分子及同口径总分母；未知类目保留 | 本页排名不能算全集TOP集中度；无可靠同款映射不按名称猜 |
| 价格带 | 明确边界、单位、成交均价或当前标价basis | 当前标价不冒充历史成交价；成交均价销量分母须成立 |

## 已有代码证据与风险

这些静态结论来自基线代码，未读取生产数据，不能推断当前经营数字已错误：

- `backend/netshop/query.py:153`：overview是导入元信息；`lib/django/netshop-service.ts:10` 是既有allowlist，新insights路径尚无注册。
- `backend/netshop/query.py:585/660/708/820`：商品访客为product_day_sum；列表按精确身份聚合后分页但为单期间；actualDates是多店日期并集，不能证明店日完整。
- `backend/netshop/query.py:1018`：旧推广费率先日期聚合跨店再交集，必须由A/F协调修复或提供可信新值，C不得直接当完整比较。
- `backend/sales/query.py:282`：averageOrderValueCents实为件均净额，大毛利率用净额-成本；`backend/netshop/sales_client.py:234` 的关联毛利率另用订单毛利/净额，两者须分名。
- `backend/sales/summary.py:236/339`、`backend/sales/consumers.py:552`：店铺summary本期无行对象可能消失、最多500行且consumer未转交groupPagination；范围可能调整到源截止日，须显式披露。
- `backend/netshop/models.py:77`：旧typed指标默认0，新合同须提供字段可用性；`backend/netshop/sales_client.py:178` 的ERP关联只处理京东，不能推出天猫映射可用。

## 公共变更请求（交I，当前未实施）

- C-F-01：冻结comparison DTO、完整候选/逐店日覆盖、basis/reasonCode、共同日历、导航和预算。
- C-P-01：完整两期结构与集中度接口、验证同款映射、商品详情上下文；不另建等价接口。
- C-A-01：同平台归因定义与逐店日配对费率、完整比较对象及详情上下文。
- C-Sales-01：完整两期授权候选与截断/actualDates；沿用既有销售算法，统一件均净额/客单价定义。
- C-I-01：在已验收组合上接 `view=platforms`、urls/gateway allowlist、权限、AI有界只读需求；核实S/P/A真实目标。

## 正式接线与回归检查单

收到I确认的对应main SHA → 同步最新main → 消费冻结协议、补精确适配 → 独立PostgreSQL中验证身份/权限/覆盖/两期全集/加权/执行计划与代表规模 → 隔离UI联调平台展开、专题钻取返回、日期/来源快切、深链及错误态 → 未编写改动的Q独立复核 → 交I串行合并。

本轮没有PG查询、reader grants或正式API实现；PostgreSQL、真实权限和正式目标专题验收均待实施，不能用本地Demo分页和详情抽屉代替。
