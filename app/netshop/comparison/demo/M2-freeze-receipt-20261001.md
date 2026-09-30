# C：M2只读接收与公共依赖请求

2026-10-01 接收I冻结公告。实际远端main已fetch核验为 `9d4830ee50232b956bdb9c1c7dd5b30564805355`，包含最终9f `9f883c199e75af31db62ac770a105cd9e7ca4bb2`。按该固定提交读取M2公告、foundation README/handoff、共同契约、04提示词和实际共享代码；F作者handoff的历史pending状态由I的最终公告取代。

本轮仅依赖准备：没有合入M2到C工作树、没有启动M6实现/联调，没有改共享文件或调用业务接口。C原设计 `fd09f8a809933fa3cd928022976cc6c26a13d210`、方案1/分类/独立两期日期及31项设计验证继承，不重新做五款。正式开工仍等P M3与A M4均合main、I提供准确父SHA与M6通知；合并顺序默认S后C。

## 已接收且可复用

- 实际API只有 `GET /api/netshop/insights-context`，共享 `netshop-insights-v1`；当前请求参数为platform/outlet/dimension/startDate/endDate/periodKind/snapshotToken。`custom`是本期日期意图，previous/yearAgo仍由所属日历派生，不代表任意自选基期。
- `lib/netshop/insights-contract.ts`：`decodeInsightsContextForQuery`、`validateContextQuery`、`MetricValue`、`compareMetrics`、`SourceRevision`、`sameRevisionVector`和分页decoder；字段能力不等于经营事实、真实订单、ERP/分类映射或归因证明。
- `lib/netshop/insights-consumers.ts`：`loadInsightsContext`、`exactProductQuery`。旧精确身份配对和`pairExactProducts`不替代两期全集并集、基期独有对象、增长排行或集中度查询。
- 共享部件、`useScopedRead/ScopedReadGate`、原shell上下文与钻取返回，以及 `app/statistical-period-picker.tsx` 的双月/快捷/拖选/草稿提交。正式页面复用这些，不把Demo日历接入正式页。
- 新预算366日/50店/2MiB、派生367日、默认20/上限100行、90秒UI/65秒reader及有界重读；旧730日/推广500行及01协议能力不改。

## Pending精确公共依赖

| 请求 | 文件/符号 | 所需增量与验收 |
| --- | --- | --- |
| C-F-02 日期 | `insights-contract.ts:InsightPeriods/InsightScope/validateContextQuery/decodeInsightsContextForQuery`；`backend/netshop/insights_common.py:validate_context/comparison_calendar/read_context`；`insights-endpoints.ts:reservedInsightEndpoints.C` | 由I冻结C任意基期的请求/响应协议；建议显式区分owning_previous/custom_baseline，保留M2三期含义并另载实际自选baseline、日期规则/版本、天数和配对方式。旧省略参数仍沿所属规则；不可把custom或previous字段静默换义。C额外参数目前未含自选baseline/指标来源/粒度/覆盖/主图对象，应逐项冻结枚举/预算/严格校验。 |
| C-F-02 导航 | `app/shell/shop-context.ts:ShopLocationContext/shopContextKeys/parseShopLocationContext/writeShopLocationContext`；`navigation-contract.ts:updateShopContextLocation/drillShopLocation/returnShopLocation`；`shared/module-slots.ts:NetshopColumnProps` | 现category仅有界文本，previous/yearAgo仅bool；缺比较模式、指标来源、任意基期、版本化分类及主图选择的可恢复上下文。请I确定新增字段/默认值/规范化、范围变更页码重置、钻取缩范围和返回恢复；复用StatisticalPeriodPicker与现onApplyPeriod/onContextChange，不另建history或日期算法。 |
| C-P-02 分类/商品 | `insights-endpoints.ts:ProductInsightsDTO/ProductInsightRow/reservedInsightEndpoints.P`；P所属接口 | 分类目录需稳定ID/父子路径/层级/平台与字典版本、unknown语义、范围适用性；商品历史分类和同款/ERP映射需sourceVersion、有效期及映射状态。现category string不证明taxonomy。需要分类范围的两期完整候选、成交商品数定义/源覆盖、TOP全集分子分母、价带basis与真实详情。无映射不按名称/图片猜；不能用当前分类回填历史。 |
| C-A-02 推广 | `insights-endpoints.ts:PromotionInsightsDTO/reservedInsightEndpoints.A`；A所属接口 | 按类别读取的商品关系/归因对象身份与窗口/金额和订单定义；同店同日类别范围的花费、归因、曝光/点击、分子分母与覆盖。未映射保留并解释；不回退全店、不按占比分摊、不混平台归因排行。当前A预留参数没有分类，需要I协调正式增量。 |
| C-Sales-02 ERP | 原sales有界consumer、netshop ERP映射适配，具体入口由I指定 | 两期完整授权候选与截断披露、渠道/店铺/商品映射及版本有效期；净销售、订单毛利、成本、大毛利率、正向/退货数量、退款金额/明确分母、可信订单数。旧averageOrderValueCents仍为件均净额，不冒充客单价；不改变仓库/成本规则或扩大reader权限。 |
| C-I-02 比较DTO | `insights-endpoints.ts:ComparisonInsightsDTO/MultiSourceInsightSections/SourceSection` | 现C只是7指标items/纳入排除/分页的预留核心。需冻结current/baseline原值、差额/增长/份额与贡献分母、typed对象身份/两期完整集合、资格与按源排除原因、趋势、结构、推广、字段/窗口可比性。平台/子店解释不二次合计；完整排名服务端分页，主图2—4不是候选全集。缺历史集合则范围变化分解不可用。 |
| C-I-02 版本/接线 | `MultiSourceInsightSections:joinedSourceRevisions/consistency/sectionToken`；`shared/module-slots.ts:netshopColumnModules`；公共urls/service/gateway/权限/AI | 字典与分类/ERP/推广/同款映射修订应纳入C joined向量和sectionToken，绑定两期、分类、真实权限、指标及页面参数，不塞进M2固定netshop向量，不比较异kind token。参与域前后核版本、共同期限有界。待C及真实依赖通过后I注册platforms；需确认S/P/A真实目标。 |

订单字段必须有所属来源和presence证明：商品客户累计不能充当平台订单数，推广订单行不能充当客户/平台成交订单。缺字段返回对应共享四态，不强迫补源或虚构数值。比率使用合计分子分母、差异用百分点；不同basis/单位/来源、非正基期和缺覆盖不硬比较。

## 分类/映射版本与自选基期的验收范围

1. 分类ID同名异平台、父子重叠、unknown、无效ID、字典改版、跨期改类、映射到期/多义/不在授权范围；无可靠对应时拒绝或不可用，不将无效ID降为all/unknown。分类金额由真实商品事实聚合，不按Demo比例拆分。
2. 手动基期与所属环比区分；本/基期各自ISO有效、起止有序、含端点和预算；366/367分别核手动与派生、月末/闰日/跨月/自然周/尾段。异长和重叠两期规则由I明确并披露，不暗改日期、不重复配对同一天、不把自选变化叫同比/环比。
3. scope/token须绑定完整类别/字典与映射版本、两期和principal；同范围换版本409、有界恢复仍变化停止；权限401/403清当前比较与缓存，服务故障不降格为空值，迟到响应不得覆新分类/基期。
4. 两期排名翻页/基期独有对象/无交易但来源完整与缺记录区分；权重比例对照、平台子店不重复累计、缺日/缺字段/未匹配仍可查看。各组合指标按自身来源覆盖，不借context元数据或其他源完整性证明。
5. 旧outlets classic/balanced、原五view、旧730/500能力保留；分类/基期范围切换重置页码，同规范化刷新保页，跨专题返回保两期与分类。外部/嵌套return拒绝、未知/重复参数失败关闭，API/UI/导出/AI权限一致。

上述为待I/P/A冻结后的负向用例范围，并非本轮已执行测试。原31项设计验证与Q结论继承；本轮未跑UI/PG、未改代码或启动进程。普通字段/协议取舍由I协调；缺真实来源以能力状态交付，不把条件字段当阻断所有准备工作的理由。

当前C源码仍为已交设计分支，3170及原UI09f9982c/date63d75fc0子树保留。cherry-pick等价不作为main祖先/清理依据，后续交付补完整子树归属、进程和ignored证据台账。本轮不部署、维护、生产库/迁移/重启、真实导入/补跑、外发或付费模型测试。

## I接收及初步决策（待正式冻结）

I已接收准备提交 `01ab8c5889da488c9922bfc9d019fe8c2725bb73`，七组pending及负向范围进入公共请求账本。以下来自2026-10-01总控交接，是设计约束，**不是新增可调用接口、最终wire字段冻结或M6开工通知**。

- custom baseline采用C专属、显式版本化 `comparisonScope/selectedBaseline` opt-in；`netshop-insights-v1` previous/yearAgo原含义保留。手动各期最多366，所属派生可367；异长/重叠披露，不按天数暗缩放金额、不虚构逐日配对。
- history扩展只由 `ShopLocationContext` 一套解析/写入承担；mode/metricSource/baseline/taxonomy/chart IDs精确字段待I正式冻结并测试。不复制Demo日历，不另建history。
- 分类来源只消费真实source ID/namespace/version/hierarchy/unknown，或明确标为label-only的资料。label-only不升级成官方taxonomy；不得按同名跨平台归一，不拿当前分类/映射回填历史，不比例分摊。
- 缺真实官方字典/有效期时使用unknown或不可比较状态，继续其他可靠来源内容。真实订单数与件均字段不能互换。Sales有界consumer入口待I阅读拥有者实际符号后提供；不扩角色权限，不改成本或仓库规则。
- 分类、商品/推广完整集合请求由I同步P/A。C等待P和A接口均合main及准确SHA/M6通知，届时再同步main实施；当前继续保存待办、隔离夹具规划与来源清单，不重跑旧设计验证。
- F/Q已完工树由I清理，冻结证据以main/E材料为准，不依赖旧venv/runtime；C的3170及UI/date独有历史仍保留，不能按cherry-pick等价误清理。

后续协议负向样例应覆盖opt-in与旧字段兼容、手动366/派生367、异长/重叠/不重复配对、未知namespace/字典版本/label-only、历史有效期及共享history恢复。这些仍是待实施用例，没有在本轮宣称执行通过。
