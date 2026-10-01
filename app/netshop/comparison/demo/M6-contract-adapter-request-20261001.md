# C专属DTO/adapter与公共接线申请（未开工）

收到I对七组请求的提前决策。当前实际main已fetch核验为M3 `77a26703b143288edd91fbab40c6741ed487e698`；A真正Home/返回偏好/provenance/Q仍在途，**不是M6开工通知**。本文件只提出精确路径/符号申请，以下TS/Python实现文件均未创建或执行，不引用未main A作正式父分支。

## C可独立持有的新文件与符号

| 拟专属文件 | 拟符号 | 用途/边界 |
| --- | --- | --- |
| `app/netshop/comparison/contract.ts` | `COMPARISON_SCHEMA_V1`、`ComparisonRequestV1`、`ComparisonScopeV1`、`SelectedBaselineV1`、`ComparisonCategorySelectionV1`、`ComparisonResponseV1`、`decodeComparisonForQuery` | C显式版本化请求/DTO/decoder；不改F v1。两期各绑定一份合法F current，保留各F previous/yearAgo原义。验证服务端窗口、对象/分类范围、同kind版本与header，不接受TS assertion。 |
| `app/netshop/comparison/data.ts` | `loadComparisonInsights`、`comparisonRequestKey` | 同scope的一次读取/409恢复共用90秒及AbortSignal；复用ScopedReadGate，key含两期、mode、metricSource、分类证据、图对象/分页等冻结参数。仅消费I正式注册的新C接口，不在浏览器采集商品全集聚合。 |
| `backend/netshop/comparison_contract.py` | `parse_comparison_v1`、`validate_selected_windows`、`build_period_bindings`、`validate_comparison_category` | 专属严参数解析和F合法current绑定适配，调用共享日期/指标校验，不改所属日历函数，不将手动基期塞F previous。未知/重复/非法/超预算拒绝。 |
| `backend/netshop/comparison_adapter.py` | `load_comparison_sources`、`validate_joined_revisions`、`build_comparison_result` | 消费已main P/A及I指定sales比较consumer；使用完整所属聚合，不抄P/A查询/按页求全集，不独立分摊分类。前后actor/typed向量、共同65秒期限、局部缺源与权限失败分流。 |
| `backend/netshop/comparison_insights.py` | `read_comparison_insights` | C拥有者只读编排，两期完整候选后按精确身份配对排序分页；平台/子店解释分开、加权比例及六区返回。SQL/consumer/参数预算待I批准，非第二事实源。 |
| `app/netshop/comparison/ComparisonColumn.tsx`及专属CSS/测试 | `ComparisonColumn`、专属请求/decoder/PG/UI测试 | 只实现已选方案1，复用共享导航/筛选/Metric/ReadState/pagination和原日期控件。不把demo字段拆分、私有日历或第二history带入正式页。 |
| `app/api/netshop/comparison-insights/route.ts`、专属薄SDK（位置由I定） | C GET桥/取消与有界reader调用 | 可由C交专属候选，但public路径/授权策略/SDK公共allowlist须I先冻结并串行接线，不能自行放行。 |

这些名称为申请建议，不是可调用接口。I可调整位置/命名后告知C，减少对共有文件的并行修改。

## 需要I维护的公共符号

- `lib/netshop/insights-endpoints.ts:ComparisonInsightsDTO/reservedInsightEndpoints.C`：请I冻结真实C版本、允许参数/枚举和与预留核心类型关系；不改变active F `INSIGHTS_SCHEMA`或其七参数/派生窗口。
- `app/shell/shop-context.ts:ShopLocationContext/shopContextKeys/parseShopLocationContext/writeShopLocationContext`、`navigation-contract.ts:updateShopContextLocation/drillShopLocation/returnShopLocation`：单一namespace扩展comparisonScope/selectedBaseline或专属prefs，包含真实mode/metricSource/分类证据/图2—4对象/页码恢复；旧书签省略时默认保原日期规则。图选择不缩候选全集，事实范围与显示偏好需分清。
- 可新建I拥有的 `app/shell/shop-comparison-prefs.ts` 与 `ComparisonPresentationPrefs/decodeComparisonPresentationPrefs`，沿用唯一history机制；账号提示仅偏好绑定，不当权限。不得复制Demo日历或第二history。
- `shared/module-slots.ts:NetshopColumnProps/netshopColumnModules/netshopColumnCapabilities`：必要回调/能力由I扩，C依赖通过后注册platforms；复用onContextChange/onApplyPeriod/原StatisticalPeriodPicker。真实P/A详情关系和返回路径须组合验证。
- `backend/netshop/views.py/urls.py`、`lib/django/netshop-service.ts`及gateway/授权/AI：新C桥只由I按原principal/reader/审计/budget规则放行，不新增写权限或未经确认AI surface。
- Sales新增窄owner比较consumer的真实文件/入口/返回字段由I指定。可独立新文件降低旧summary冲突，但C不能在sales域自写权限或查询算法；也不要求将500排名/93天adminpage伪装成完整比较源。

## 请求/响应语义建议

- 显式C `comparisonScope`版本 + `selectedBaseline` opt-in；保存用户两个窗口，并在服务端生成两份F合法current查询/绑定及各自actual window、kind、scopeKey、owning向量/token。默认所属派生与手动模式区分，旧F previous/yearAgo不重解释；两期手动≤366、所属派生≤367。
- 异长/重叠明确披露实际日期/天数，不按日数缩放金额、不虚构日期配对。指数只用明示且正的有效基准；标自定义差额/变化，不冒所属环比/同比。
- 类别selection显式all/label-only/unknown；verified-ID须真实证据才启用。label-only绑定platform/source标签和证据版本，不造官方ID/namespace/有效期。用本期cohort查看两期金额时标cohort，不称两期历史分类结构；缺真实分类与映射的推广/ERP组合局部不可用，不回全店或按比例摊。
- C DTO应含完整比较集合/资格和原因、两期原值及source/basis/unit/coverageRef、delta/change/份额分母、日周月、结构/推广/可比性、joinedSourceRevisions与C sectionToken。主图2—4只是展示集合，排名全集先配对后分页。
- C token绑定真实principal版本、C协议/窗口/分类证据版本/指标与适用偏好、两份F binding和全部参与域版本；异kind opaque token不互比。响应携带两份完整context或去重投影的方式由I冻结并明确版本/引用完整性；2MiB整体预算不得暗裁日历/coverage或各内部调用重置期限。

## Sales owner consumer申请最小能力

需返回完整授权两期shop集合（canonical/raw/channel映射及依据/版本）、逐店日覆盖/截止与缺口、未匹配对象、源revision、完整性/截断、按shop/date完整聚合。金额/成本复用原净销售/订单毛利/大毛利和仓库排除规则；真实orderCount带身份依据，`source_line` fallback不升级真实订单。退货量/金额率需确切分子分母，比率按合计重算，不平均店铺百分比。

条件缺失时精确返回能力/未映射状态，可继续其他来源。不能把已授权普通账号改走admin页、扩大role或套当前映射回历史。类别只有label-only时不得宣称ERP类别ID/历史归属已证明。

## 待实施负向范围（本轮未执行）

旧F无opt-in请求/旧书签保持；未知C版本/重复字段/非法窗口/手动367/预算失败；异长重叠不缩放和不重复日配对；两份合法current却窗口/权限/token错绑定；label-only同名跨平台/伪vendor ID/改版/无有效期/本期cohort误作历史；分类条件下A/ERP缺映射不回全店；500/93天截断不能作为全集；source_line无真实orderCount；全部比率对照、0/负/缺基期、401/403/409/503和迟到、分页刷新/跨专题返回及真实目标。

当前仅保存DTO/adapter申请与夹具计划，既有方案1和31设计验证继承。M4实际main准确SHA和I的M6/公共适配通知后再同步实现；本轮无运行代码、共享变更、UI/PG复测、服务/数据库/生产/外发操作。

## I接纳与两期信封冻结补充

I已接纳准备提交 `147a5de17130ff22b55e4e74ac7de6abf5e9835f` 的专属文件/符号申请；正式开工仍待实际M4main和M6通知，公共schema由I实现并另发freeze。

- C v1完整携带 `currentContext`、`baselineContext` 两份原F严格完整DTO，分别以自身current绑定用户两期。原F previous/yearAgo、calendar、coverage均保留，不采用隐式裁剪或投影。
- C token分别绑定二者scopeKey/snapshotToken、同一实际principal、分类证据及全部参与域typed向量；前后复核，不宣称分布式原子快照，不把异kind token直接互比。
- 整个C响应仍为2MiB UTF-8，单一65秒reader期限包含actor、两context、拥有者数据、序列化和末次核验。尺寸超限422、预算超时503，不能给不完整信封或各子读取重新计时。90秒客户端读取/有界恢复规则保留。
- 异长/重叠两期按原窗口和实值披露，不按比例缩放。derived367只沿原F合法派生边界；不因此让手动或F current请求扩到367，不伪造baselineContext的current或截一天冒完整。遇所属派生窗口与“两F合法current绑定”不相容时，按I最终公共schema的显式不支持规则处理。
- 公共导航区分可分享的合法比较业务意图（mode/source/selectedBaseline/分类cohort声明，严格有界URL，服务端始终鉴权）与展示偏好（chartIDs/columns/sort等account/history绑定）。新tab不得丢明确自选基期；偏好不当权限来源，不另建history。
- C→P/A清目标当前不适用classification/q，并保留原C完整范围作为返回上下文。不能携带不可用分类假装已经筛选，也不能返回时丢基期、类别或原列表状态。

待实施负向样例补充：两份完整F DTO分别错scope/window/principal/版本；2MiB完整信封超限而非单份合格即成功；第二context/序列化/末核耗尽共同期限；当前/手动367拒绝、派生367保持原边界；跨tab明确基期保留、另一账号偏好不复活；出站分类/q清理与完整C返回。仅记录用例，不在本輪宣称测试通过或开始M6。
