# 公共底座 F：已实现协议与交接

本轮来自 M1 `1c2cfa506dcf1430de900aaadad2e076cf1a4f9e`，源码首候选 `082737f9`，普通合并文档主线 `d3cd59ea` 后候选 `a5a13560`。本文件记录 F 实现；I 最终组合复核、main 实际合并 SHA 和冻结公告是栏目采用依据。F 分支通过不表示 main 已合入、其他四栏已实现或生产已采用。

## 1. 实际可调用接口

`GET /api/netshop/insights-context` 已实现 Worker 薄路由、固定 Django reader 路由与 service allowlist，协议 `netshop-insights-v1`。只返回来源元数据、范围、比较日历和能力，不重新存事实或采集新来源。

| 参数 | 冻结值与边界 |
| --- | --- |
| platform | 必须显式；天猫/京东；最多两个，不重复 |
| outlet | 精确 `平台 + U+001F + 店名`；最多50，不重复；省略时展开已有授权店铺，超过50拒绝 |
| dimension | 默认 spu；sku/spu；天猫sku日经营返回不适用，不借目录伪造 |
| startDate/endDate | 必填、包含端点的自然日；本期最多366天；实际查询左闭右开 |
| periodKind | custom 默认；today/yesterday/last7/last15/last30/month/quarter/custom/rolling/all；预设意图须与日期相容 |
| snapshotToken | 可选本接口64位小写hex令牌；绑定同一权限版本、范围、规则与完整来源向量 |

未知、重复单值、非法日期、越权、超量均拒绝。没有 `principal`、SQL、任意URL或补跑参数。调用者不自报权限。

`InsightsContext` 精确类型、decoder 和预算在 `lib/netshop/insights-contract.ts`；正常/错误/四态夹具在 `insights-fixtures.ts`；可运行消费例在 `insights-consumers.ts`。

- UI 与 AI 共用 `decodeInsightsContextForQuery(value, query, result.revision)`：校验内部完整协议，再校验请求平台/店集合、维度、意图、本期实际窗口、所给token及同类型 owning revision 响应头。不同类型 token 不做字符串相等比较。
- `requestedScope/effectiveScope`；本期/环比/同比真实窗口；本期逐日比较日历；来源截止；完整来源覆盖和字段存在能力；每项引用明确。
- 来源向量固定含 owning_revision、每平台 promotionManifest、每有效店的 product/promotion 修订成员；不存在写 `absent`，不遗漏成员。两平台50店最多103成员；decoder预算105，且按实际集合精确校验。01独立DTO仍为两全局＋50店×2共102。
- 覆盖按来源×平台×店×日期与 current/previous/yearAgo 分别核验。无记录的显式店铺仍保留，日期并集/最新日/成功批次/一页排行不代替完整性。
- 当前共享字段能力只声明 payment/visitors/customers/quantity/addCartCustomers 和 spend/attributedPayment。其他字段由所属查询使用共享 `NumericMetricPresent` 和已交付商品全17字段 presence 元数据证明；能力未声明不等于平台天生没有字段。
- 字段能力指已完成来源记录中的数字字段存在和范围覆盖；不是推广聚合一致性、ERP映射、历史归属或归因窗口证明。经营值仍须所属查询及其质量门禁。

## 2. 预算、权限与错误

reader 整个最多两次读取共享65秒期限，不按每次重置。保持原单SQL与进程边界，不放宽角色或连接。UI传90秒有界 service budget；完整 UTF-8 响应超过2MiB返回422。声明的上限不承诺任何最大规模生产P95；已测规模见证据。

浏览器、Worker、service fetch 的 AbortSignal 贯通，前端 generation/scope 门禁拒绝忽略取消的迟到响应。当前 WSGI 请求不能立即中止一个已在途 SQL；没有把 HTTP 取消声称为数据库事务取消。reader 在查询边界检查整个期限。

普通 viewer/analyst/operator/admin 均须 signed principal，并读取前后检查当前 AppUser 的 email/role/status/scope/version。停用、缺账户、角色/范围/版本变化拒绝，权限变化不按数据revision重读。当前真实 scope 仅 warehouses/channels/platforms；本入口不能证明ERP渠道/仓库归属，所以非空 channels/warehouses及未知scope拒绝，不猜店铺映射。

精确保留边缘身份 `local-admin@teruisi.local/admin/scope=None` 继承现有 `_admin/current_principal` 边界，标记 `reserved_edge`、绑定明确policyVersion和非secret Django environment/processRole/debug配置，前后fence；它没有普通账户version。信任前提是原 Worker 的明确本地访问/本地构建/精确回环Host门禁和 reader 的签名验证；Django不信转发Host、不自动登记AppUser，也没有其他 absent 用户fallback。未增加任何GRANT或迁移。

| HTTP/code | 含义 |
| --- | --- |
| 400 invalid_request | owning请求非法/未知/重复参数 |
| 400 invalid_insights_contract | 共享消费校验拒绝不完整/错范围/错版本响应；失败不是业务空值 |
| 401 authentication_required | 缺签名或无效签名 |
| 403 access_denied | actor/平台范围或未支持范围不能读取 |
| 409 insights_revision_changed | token或参与修订变化；有界恢复后仍变化停止 |
| 422 quality_incomplete/not_applicable | 超店铺/响应预算或不支持维度 |
| 503 source_not_ready/service_unavailable | reader期限、来源不可用或内部服务失败 |

AI由I单写中央注册表及handler。AI使用原完整DTO、相同query/header helper、30秒signal和最终信封40000字符上限，超限拒绝而不截断。`compactInsightsContext` 是明确版本的完整覆盖区间投影样例，省略日历并明确披露，不是AI tool隐式替代。

## 3. 指标、日期与01兼容

金额安全整数分；数量整数；RATIO未乘100；MULTIPLE倍数；单位/口径/四态/reason/sourceIds/coverageRef有校验。available须可信数值与null原因；partial只能已覆盖范围可加总结果；unavailable/invalid值为null。真实0、缺字段、缺日、不适用、未关联、多义关联、零/负分母、基期不足、来源未核验、未知归因和溢出分别处理。

提供 ratio_of_sums 分子分母时，available要求有限数、正分母和比值相容；真实0分子/正分母可为0。source_value_only按原来源，不强造分母。相对增幅的0/负/缺基期返回null；比率差异为百分点；运算溢出返回null+unsafe_integer。不同单位、basis或来源定义不比较；精确对象集合与SKU/SPU/映射适用性还须领域服务核验，数值helper不等于全部业务可比证明。

日期直接复用 `store_overview.periods` 对原 sales 算法的明确适配。单日、自然月/对应日、滚动、跨月自定义及季度保持原规则。同比不将2/28、2/29重复配对至同一日期。自然周从周一；每7天从选择起日分组，保留尾段。合法366天本期的同比可能367天；只放宽派生窗口到367，本期、序列和选择上限仍366。此次也修复01 decoder对应继承缺陷；01布局、指标意义、四态、102向量预算不改。

旧商品此前统一前等长属于继承缺陷，本轮已改为唯一 `lib/netshop/periods.ts` 纯日期适配器。真实periodKind从shell贯通；20份golden直接由上述owning算法和`add_years`生成，21项Node逐值parity覆盖月底/闰日、整月/同月/跨月、滚动/季度第一天与整季度。旧商品明确传730本期预算，新页面默认366；730本期可能计算出731天同比窗口，但旧读取API仍只支持730，未验收731天旧API读取，超限基期显式失败且保留可信本期，绝不截一天冒完整。

`adaptOverview` 先调用原01 decoder，显式保留原DTO和指标语义，再增加coverageRef。它不是重新定义01协议；classic/balanced仍真实切换，只挂载活动视图。

## 4. 必要旧逻辑修复

- 旧商品 `product-performance` 新增可选 `view=identities`。参数只有 dimension/platform/outlet/startDate/endDate/identity/sourceRevision；1—100个 `identity=JSON[平台,精确店,维度,ID]`，有日期且同一个 owning revision。返回有界items、unmatched、pairing=exact_identity、sourceRevision；unmatched不补0。本期第1页/基期第3页按精确ID取值，不按基期独立排名同页配对。
- 原 full/page/summary 路径及730天/100行边界保持；添加可选sourceRevision、summaryFieldAvailability和每行fieldAvailability（原17字段complete/reason）。Typed 默认0不证明存在；旧商品顶部与行字段缺失/缺日显示“—”，conversion/searchClickRate变化按百分点；负基期不输出普通增长。增长排行全集配对由P新栏目实现。
- 旧推广 `promotion_overview` 按平台×店×日匹配，核原字段、已完成来源、raw与aggregate行数/金额及state；整期不全主spendRate与promotionTransactionShare为null。summary.matchedRange含辅助值和明确匹配店日；主值不借辅助范围。新增coverage complete/expected/matched/missingByShop、spendRateReason。旧500行推广列表未缩减。
- 店铺分析旧推广分组不得将日行null费率或缺payment经0重算为可用整期值；完整真实零费率保留0。只声明经过验证的同店日完整范围。
- 店铺/日期切换后经典摘要、商品/目录、SPU访客、推广旧结果按原范围key隔离；推广retained pair也绑定scope。错误/迟到不把前店数据当新店。商品初读与后续精确配对均按来源/权限异常分流：可信本期200＋基期503清比较并保留正确新本期；401/403清本基两期及缓存门禁，失败关闭。没有继续以撤权前的读取称当前授权结果。

## 5. 栏目边界、路径与调用

公共导航已提取 `app/netshop/shared/navigation.tsx`。`module=shop`及原analysis/outlets/platforms/products/promotion值不变，当前旧标签不提前替换；01自己的路由和模式保留。

`shared/module-slots.ts` 是 I 后续唯一注册点。M2 map为空，不引用未来栏目或设计Demo；只挂载活动栏目；outlets不能通过此map替换01。`NetshopColumnProps` 提供真实期间/意图、ShopLocationContext、当前用户、onContextChange、onDrill、onReturn、原日期/导航回调。栏目交自己的组件后由I串行接线，不再各改整份shop-module-view。

ShopContext由原shell解析/序列化与history负责：平台、精确店集合、SKU/SPU、比较、粒度、章节、类目、表内q/分页、精确商品和受限本地返回上下文，期间含原预设意图。范围/q/类目/页大小改变归第一页；同规范化范围刷新保页。钻取缩至精确对象，返回恢复原期间/筛选/页码；拒绝外部及嵌套返回URL。日期组件继续复用原 StatisticalPeriodPicker，不另造日历。

共享部件：InsightFilterBar(sticky可false供S标题筛选区)、InsightMetric、InsightComparison、InsightReadState、InsightSourceCoverage、InsightListPagination、useScopedRead/ScopedReadGate。只在组件scope引用系统字体角色，不改全局字号。加载/失败/空/版本变更有独立状态。

| 栏目 | 预留专属路径 | 实现状态 |
| --- | --- | --- |
| P | /api/netshop/product-insights、/detail | 未实现/未注册；现可消费实际context及旧精确配对能力 |
| A | /api/netshop/promotion-insights、/detail | 未实现/未注册；复用实际context及旧同店日率质量门禁 |
| S | /api/netshop/store-panorama | 未实现/未注册；等待P/A main接口及所属ERP/财务consumer |
| C | /api/netshop/comparison-insights | 未实现/未注册；等待P/A main接口及完整可比对象集合 |

类型化专属DTO核心及精确预留参数集在 `insights-endpoints.ts`，不是可调用服务。接口消费需保留context，再由栏目 owning服务提供有类型sections；S/C须joinedSourceRevisions+revision_vector_checked+sectionToken，读取前后核参与域修订，不能声称跨域原子事务。公共路径/gateway/权限/AI由I单写接线。声明范围外的字段/端点/排序枚举扩展须角色请求I评审，不自造另外一套公共指标。

## 6. 来源与缺源限制

已实现的shared context只读 netshop PostgreSQL 元数据和原完成事实：京东SKU/SPU日、天猫SPU日、京东/天猫推广原字段。没有新源采集、客户身份或企业购子集证明；没有新增店铺去重UV、付费/自然访客、复购、历史档案/库存、财报日分摊、天猫SKU日、ERP自动映射或归因窗口。数值和能力不从商品名称/目录/点击数推断。

平台支付、ERP正负净销售、订单毛利、大毛利、财报和平台归因分开。原成本、仓库排除和映射规则不改；ERP/财务/库存由原所属consumer核其权限、映射、快照与版本。原资料和未匹配行不丢弃。加购率只addCartCustomers/visitors，不用件数。

## 7. 验证、资源和阶段

证据根：`E:\codex-artifacts\netshop-scheme2-20260930\foundation`，非敏感源码/日志/合成截图/计划保全。具体最终命令、SHA和文件摘要由 `handoff.json` 记录。

- 私有PG动态端口、独立目录/随机凭据、合成事实与最小reader role；没有5432 fallback或新生产GRANT。包含22初轮、63旧回归、25修订、68最终规模/权限/旧01/旧API/consumer/source-guard回归，分轮日志不相加冒独有测试数。
- 50店×366天本期/367天同比完整缺日响应1,748,954 UTF-8字节，102来源成员，未截断。5000合成行/10店/10日/500商品的读取12条SQL、94,717字节；控制金额5,000,000分匹配，有同环境ANALYZE/BUFFERS计划。该单次约0.104秒只说明这个合成规模，不承诺生产P95。
- 合成React harness31交互通过、无runtime error，含迟到/失败/版本恢复、0/缺数、非sticky、分页/钻取/返回/搜索、390px、旧五view、新旧01、精确跨排名比较/百分点、自定义与rolling实际请求、初读基期503及同/新范围401/403。仅合成组件API，不称完整真实Worker/Django联调。测试脚本曾有选择器/默认比较未开启/旧CSS顺序影响，失败证据保留，闭合版本见机器结果。
- Node定向132通过，含原lifecycle强断言、共享合同、20组owning日历夹具、旧01 decoder与730/500边界、route/header/权限；独立的原authorization与access-control transport11项通过，确验已有local-direct-access边界。typecheck整体188条既有诊断与I d3cd baseline标准化比无新增，不宣称全库类型通过；相关lint0错误/2既有img警告、backend boundary通过、隔离构建通过。
- F3130静态合成harness与blank headless Chrome已正常关闭；18130/18131/13130未启用。所有PG实例正常stop。无Teammate子分支/子树；F独立编写，最终独立复核由未写本变更的Q承担。

未执行生产采用、维护停服、生产迁移、服务重启、真实下载导入、业务补跑、外部通知或付费模型测试。F树及ignored deps/build/runtime暂保留给Q/I复验，清理由I按远端包含性/无独有脏内容/证据保全/无资源依赖门槛处理；不得把“已测试分支”当“可删除已合主线树”。

## 8. 公共所有权交还

F当前串行写公共入口、旧query及共享类型。M2验收并交接后，app/page/shop-module-view/shell、shared/日期、backend/netshop公共query/views/urls、netshop-service/access/query-contract/01必要decoder及公共测试由I唯一协调维护。四栏自己的路径按原合同归P/A/S/C。F无生产运维授权；独立Q结论、实际main SHA和四栏正式实施不能由本作者替代。
