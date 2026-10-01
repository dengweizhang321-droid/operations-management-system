# S 收到 M2 冻结后的准备回执

2026-10-01。已 fetch 并核实 `origin/main=9d4830ee50232b956bdb9c1c7dd5b30564805355`，包含 M1、最终 M2 `9f883c19` 和冻结公告。S 分支以普通 merge 同步到 `a5afe89ff34b6c18efb45b4dac38146dfbb3e22a`；这只是准备基线，**不是 M5 起步或验收提交**。正式实现/联调仍须 I 通知含已验 P/M3 和 A/M4 的准确 main 父提交。

已完整读取共同契约、S 提示词、[M2公告](../execution/20261001-M2-foundation.md)、[foundation README](../foundation/README.md)和[handoff](../foundation/handoff.json)。F 作者 handoff 的旧状态/摘要绑定其原提交，后续组合与期限修正以 I 的 `9d4830ee` 公告为准，不把作者原 manifest 当最终 main 文件摘要。

本轮只读盘点与文档准备；没有新组件、API、DTO副本、采集、数据库或公共文件修改。M1/M2 与此前 S Demo 证据继承，不重复跑设计验收。`app/netshop/panorama/demo/**` 同步前后 Git diff 为空，唯一01仍为 `a4428e54` 的已验设计。

## 已具备与仍待

| 能力 | 冻结事实 / 精确符号 | S 使用边界 |
| --- | --- | --- |
| 共享范围 | `GET /api/netshop/insights-context`；`lib/netshop/insights-consumers.ts:loadInsightsContext`、`insights-contract.ts:decodeInsightsContextForQuery` | 主线实现，不代表当前生产版本采用。只验证来源元信息、实际三期/日历、能力/覆盖；不当经营数值或映射证明 |
| 日期 | `lib/netshop/periods.ts:resolveNetshopPeriods`，`app/statistical-period-picker.tsx:StatisticalPeriodPicker` | 正式S复用实际期间/意图；不复制Demo日期算法。本期366、派生同比可367；旧730/500边界保留 |
| 身份与往返 | `ProductIdentity/encodeProductIdentity`、`ShopLocationContext`、`shopContextFromLocation/updateShopContextLocation/drillShopLocation/returnShopLocation` | 精确平台/店/维度/ID；S必须明确单店，未选店不隐选。表内q/页码与期间随原shell，拒绝外部/嵌套返回地址 |
| 共享展示与读取 | `InsightFilterBar(sticky=false)`、`InsightMetric/InsightComparison/InsightReadState/InsightSourceCoverage/InsightListPagination`、`useScopedRead/ScopedReadGate` | 筛选非固定与系统字体保留；独立章节状态；加载/失败/版本变化不误显旧店，HTTP取消不冒称SQL中止 |
| 接线 | `app/netshop/shared/module-slots.ts:NetshopColumnProps/netshopColumnModules` | map当前为空，I唯一维护。S未来交组件后I注册analysis；outlets的总览01独立路径保持 |
| P/A/S DTO | `lib/netshop/insights-endpoints.ts:ProductInsightsDTO/PromotionInsightsDTO/StorePanoramaDTO/MultiSourceInsightSections/reservedInsightEndpoints` | 是预留核心，不是已可调用接口。P/A处理器、消费符号、section token/decoder及实际验收SHA均待交付；不得引用在途实现 |

M2 context 当前默认20行/上限100；S已验Demo选项5/10/20，其中默认5是设计演示状态。正式S如何从共享默认20初始化到设计5，交I沿合法`shopPageSize`保守协调，不改共享默认或静默缩减旧API能力。原分页组件已有上下页；若正式保留数字页和页大小选择，I决定兼容扩展共享组件或允许S局部控制，S不改公共组件。共享InsightMetric/formatMetric当前默认显示元；设计中的万元只属显示单位，不能改CNY_CENT传输。保留万元展示如需format选项，由I兼容协调，不在S改共享默认。

## S001—S008 精确公共请求

以下只提出需求，不创建这些接口/字段；P/A主线＋I起步通知是M5硬依赖，其他来源条件未成立时相应分区诚实降级，不阻塞其余可信章节。

| 请求 | 文件 / 符号、输入输出与用途 | 状态、兼容与验收 |
| --- | --- | --- |
| S001 底座/P/A交接 | M2上述共享符号；未来 `backend/netshop/product_insights.py`、`promotion_insights.py` 的可消费函数由P/A交付准确名字；P/A正式端点与decoder | M2已收；P/A实现与准确main SHA仍待。只消费已合接口/拥有方聚合，不复建商品或推广算法 |
| S002 analysis注册/往返 | I维护 `shared/module-slots.ts:netshopColumnModules.analysis`、原 `shop-module-view.tsx` 与 shell context；S组件接受 `NetshopColumnProps` | 保留analysis书签与其他旧view；通过onContextChange/onDrill/onReturn/onNavigate接线；同范围刷新保页、范围/q/类目/页大小变化归1，详情返回恢复q/页码/期间；shared平台枚举当前仅JD/TM，不据此删除旧analysis的其他ERP平台功能，I保守保留原兼容路径 |
| S003全景GET/DTO扩展 | I维护 `insights-endpoints.ts:StorePanoramaDTO/reservedInsightEndpoints.S`、`backend/netshop/views.py/urls.py`、`lib/django/netshop-service.ts`、薄公开route；S后续拥有 `store_panorama.py` 专属处理器 | `/store-panorama`仍预留。请I冻结section八个枚举与缺省、q/page/pageSize只作用products的规则、DTO新增项与专属decoder；不绕过真实principal/reader/90s-65s/2MiB预算，不能注册未来未合组件 |
| S004 ERP销售 | 复用 `backend/netshop/sales_client.py:read_sales_consumer/sales_alias`、`backend/sales/consumers.py:validate_consumer_request/_summary/_outlet_filter/_product_performance`；输入精确outlet+channel与左闭右开窗口，输出所属三期/净额/成本/订单毛利/大毛利/退货和来源证明 | **待owner修/验**：summary接受channel但转换成platform/shop时丢弃；alias返回canonical/raw结构不是consumer outlet。请I协调精准channel过滤、受控别名转换、所选店覆盖/批次证明，保留旧聚合与排除仓。退货件数/订单数未提供，不从净/绝对数量倒推 |
| S005 财报/年度目标 | I协调 `backend/finance/consumers.py:CONSUMER_OPERATIONS/validate_consumer_request/execute_consumer_query`，复用 `analysis.get_finance_analysis/annual_progress.annual_progress`；精确平台＋店＋实际月集合/年份，带权限、缺月、目标/财报版本与来源 | 当前仅三类search，不是聚合。需有界只读consumer与明确财务店铺键映射；不得扩大unrestricted/角色规则。年度目标不塞成月度目标，不摊为日利润；缺月/未设目标/无权限分别说明 |
| S006事件/记录 | I协调 `backend/workflow/consumers.py` 暴露已有 `operations_views._record_options/operations.list_records` 的精确平台/店/occurredAt左闭右开过滤和分页，返回记录ID/来源/occurredAt/channel/revision | 现workflow_search只有全文摘要与updatedAt。不得拼成时间线或推因果；旧批次入口按精确batchRef关联。`import_chain_views.today_status`只查上海今日且拒筛选，不能充作历史execution；历史关联能力未交付则保留入口和缺口 |
| S007商品表 | 已转P：`ProductInsightsDTO.sections.items/pagination/summary/comparisons/growth`及P专属服务；q按ID/标题、page/pageSize、total/returned/hasMore/truncated、scope/token/version | 继承设计5/10/20。q只筛表，完整范围summary与TOP/贡献不变；全集跨期配对后分页、跨店同ID隔离、空/末页边界、窗口/版本/权限重验。S不拉全量事实到浏览器；不从当前页算集中度 |
| S008跨域向量/运输 | I冻结 `MultiSourceInsightSections.joinedSourceRevisions/consistency/sectionToken`的各domain-kind-scope含义、验证/预算；共享transport保留401/403及实际剩余deadline | context自身sourceRevisions只收netshop精确成员，其他域放专属joined向量，不塞进context以绕decoder。现sales_client的HTTPError归URLError而折503，且无整体deadline入参，须owner保持分类与总预算。前后版本不一致仅停相关组合，不自称分布式原子快照 |

## 八章所需的 DTO 增补清单

`StorePanoramaDTO`当前只是核心。以下名称是需求描述，须I/P/A冻结准确wire字段；不在S另建共享type、basis或reason枚举。

| 章节 | M2预留核心 | 仍需拥有方提供的真实能力 |
| --- | --- | --- |
| 2.1 | performance的platformPayment/erpNetSales/erpOrderMargin/erpLargeMarginRate | 所属订单/件数/客单价定义、退款/推广独立分组、三期差额、独立daily与商品变化贡献。商品日报累计订单与ERP订单不可混名；旧ERP averageOrderValueCents为剔配件净额/净量，不能当订单客单价 |
| 2.2 | visitors/customers/conversion/addCartRate | 浏览、收藏、加购客户/件数、下单/支付、访客价值与来源支持的搜索/停留/跳失；17字段presence由P拥有方证明，不把M2未列能力解释为天生缺源 |
| 2.3 | items/pagination与ProductInsightRow | P的成交商品数、TOP5/10、类目贡献、全集增长/下降与重点商品；当前图文/档案/库存带各自证据、未关联记录保留 |
| 2.4 | PromotionInsightsDTO核心九指标、attribution、matchedRange、items | A的daily/两期趋势与投入分布/重点对象、商品/触发/跟单身份；条件对象明细不伪造。不将归因拆自然/付费份额 |
| 2.5 | erpNetSales/erpOrderMargin/erpLargeMarginRate/returnAmount | ERP成本、原定义的退货率/量/订单及贡献排行；精确映射后单品关联。原商品经营consumer只支持7—365 days、无单店/自定义且剔snapshotToken，不能直接接成同scope结果 |
| 2.6 | b2bShare/repeatCustomers | 先有来源的商品日新老买家累计与企业购金额/订单/件数/结构；去重客户、真正复购、B端子集比例仍条件未核验，不能混用repeatCustomers名称 |
| 2.7 | months的actual/target | 既有年度目标、真实月财报/年累计/历史同期、事件。finance_month basis不强装年度目标配置；请I定义明确年度引用/目标来源并兼容扩DTO |
| 2.8 | unmappedProductCount/snapshotDate | 每源截止/三期店日缺口、字段/映射/比较性、batch/流程引用；库存/目录/成本多快照不能挤成同一snapshotDate；总体未匹配数不能从一页推断 |

## 各域版本与快照不得混用

- netshop context：原owning＋平台manifest＋精确店product/promotion成员，缺源保留absent；原decoder按完整集合校验。
- sales：`X-Sales-Data-Revision`为两个整数的sales revision与ERP计数pair；它不是netshop digest token、不是inventory版本。summary截止来自principal销售全集且缺latestBatch，不能当所选店完整性证据。
- erp_reference：独立owning整数＋digest，与sales第二计数有关但完整token不同。档案已有updatedAt，批次业务snapshotDate为None时不能把导入时间改名快照日；需要owner提供精确来源batch引用。
- inventory：独立owning版本；stock/age分别有batchId/snapshotDate。全仓货品投影不等于店铺库存；当前system_cost_snapshot只正成本，不能替换历史订单成本或缺成本为0。
- products原商品经营：自身owning＋内部snapshotToken绑定sales pair、products、独立库存projection revision和batch。projection的64字符小写SHA-256摘要（256 bit）不是inventory owning；现consumer剔token且不支持单店自定义，优先由P提供已验关联。
- finance/workflow：分别保留自身revision与真实月份/occurredAt/关联范围。搜到记录不是覆盖证明，最新批次不等于当前店/商品的批次。

只有实际参与计算的域要求组合前后版本一致；独立章节可保留自身可信结果。权限错误不得降成业务缺源，未取得允许读取权不能从freshness推事实；不扩大reader grants或创建写入、目标编辑、CRM/新库存账。

## 待正式起步的验收集合

保留现有设计结果，只在含P/A的起步提交上新增：精确店/同名/同ID与channel/别名负向；实际三期与滚动/短月/闰日/截尾；缺字段与真0、零负分母、原毛利/成本/排除口径；不同域修订变化与陈旧projection；401/403/503、actor/version改变、预算/截断；单店财务缺月/未设目标、事件occurredAt边界；商品q只改表、分页/返回/快切店和旧五view/总览01。独立PostgreSQL、合成UI、真实来源与生产采用分别记录，当前没有新增通过声明。

## 本角色资源与边界

- S：`codex/netshop-panorama` / `D:\.codex\worktrees\netshop-panorama\运营管理系统`；本轮只写角色文档。
- field_mapping：复用原只读Teammate，读9d已提交blob，无子分支/子工作树/写入；其他既有只读复核身份无新代码树。
- 设计与证据保留：`a4428e54`与`evidence/round-3`；不重做五版，不将夹具接正式页。
- 3160静态预览源码/预留保留。本次只读端口核验未见监听，没有启动、强停或归档；未见监听不作为清理许可。未启用任何新PG/UI/后端/控制端口。
- 未运行生产生命周期、迁移、下载导入/补跑、外发或付费模型；不推main、不写公共文件。M5依赖与起步SHA待I再次交接。

只读文档复核已通过、阻断0；独立复核没有运行设计/UI/PG。相对链接、M2祖先关系、准备JSON边界和Demo五文件摘要均已核验，未以本次准备声明新的功能验收通过。
