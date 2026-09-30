# 推广 A 专属合同 v1

当前为 M4 实际候选；公共注册及旧报告兼容由 I 串行接线。正式开工基线是 `9d4830ee50232b956bdb9c1c7dd5b30564805355`，已普通合并共享 CPC 基线 `39bc403a5385cb4766c45b0c670bd4c65f96b9b8`。页面继承已选 01 经营双栏、系统颜色字号；界面指标名 ROI，内部 roas 字段及归因金额/花费倍数公式保持。

## S / C 消费

`GET /api/netshop/promotion-insights` 返回 `columnVersion=netshop-promotion-v1`、M2 `context`、推广 `sectionToken` 和 `sections`。使用 `lib/netshop/promotion-insights-contract.ts` 的实际类型及 `decodePromotionInsightsForQuery(payload, requestQuery, owningRevisionHeader)`。不得仅凭 TypeScript assertion 接纳响应，也不能把 snapshotToken 当 owning_revision。

| 用途 | 字段 | 约束 |
| --- | --- | --- |
| 推广摘要 | summary / comparisons / changes / attribution | 单平台、完整原统计期，q 与对象日期不改摘要；四态、source/basis/unit/coverageRef 一起消费 |
| 店铺比较 | shops.items / shops.visible | 精确 shopKey；单店收起重复比较；份额为店铺花费/整期花费，不是成交渠道份额 |
| 辅助费率 | matchedRange | 仅同平台×店铺×日期已匹配子集合，shopDates 与自己的 coverage 完整对应；不复制到主费率 |
| 来源与能力 | sourceMatrix / objectCapabilities / context.sourceRevisions | canQuery 是资格，不是字段已核实；unidentifiedCount=null 表示尚未核验，不能展示成 0 |
| 对象变化 | contributions / listScope / items | 完整可比集合先配对，再 Top10 和列表搜索分页；未知身份桶不跨期比较；不同对象视角不可相加 |

主费率覆盖引用为该完整范围 `:paired-whole`，即使无值也展示实际配对覆盖；辅助 `:matched` 的 expected=covered=真实匹配店日数。零匹配为 0/0 不完整，费率不可用。常规推广指标来源为 jd_promotion 或 tmall_promotion、basis=platform_attributed；配对平台成交分母来源为京东 SKU 日 jd_sku_daily 或天猫 SPU 日 tmall_product_daily、basis=product_day_sum。CPC 使用共享独立版本 `netshop-money-per-count-v1`，整数分/真实点击数的未舍入商，展示元/点击；不放宽旧 CNY_CENT/COUNT 协议。

## 请求与详情

每次只选京东或天猫：JD 固定 SKU，天猫固定 SPU，避免归因金额定义混合。共用 F 的自然日范围/基期和 366 天、50 店铺、2 MiB 完整响应预算；趋势支持 day/week/month；列表 page 1—10000、pageSize 1—100、q 120 字以内。允许参数、去重及精确查询语法以 `promotion-insights-query.ts` 为准，分类字典未提供前不接 category。

搜索只改当前对象列表。趋势定位对象期使用 focusDate，或完整 objectStartDate/objectEndDate 二选一；对应比较日期由 F 日历生成，主摘要/趋势/店铺仍保留原整期。对象候选使用焦点本期、环比、同比真实源日期身份全集，保留基期仅有对象的下降贡献，不带其他日期杂项。

P→A 可选 `productIdentity` 使用共享规范四元 JSON `[platform,shopName,dimension,id]`，仅商品视角，JD只SKU、天猫只SPU，必须在平台/店铺授权范围内。按完整真实对象集合的唯一 exact_source_identity/linkIdentity 匹配后，才搜索分页；同文本ID、相似名称或当前页不能替代精确关联。`listScope.productFocus` 区分可用关联、未关联和多义，后两者不表示无投放；它绑定请求身份与 sectionToken。焦点只缩窄对象明细和贡献，花费占比的分母仍为原选店×对象日的该视角全集，整期摘要/趋势/店铺不变。详情继承同焦点及可靠返回 rowKey/token，跨焦点或其它店铺不能复用。

`GET /api/netshop/promotion-insights/detail` 必须同时提供 `objectId=rowKey`、shopKey、显式 objectKind、sectionToken。rowKey 是内部不可展示作业务 ID 的所属版本 lookup key；仅存在于同范围的可靠非 null 来源身份可读。详情使用原整期，禁止列表日期聚焦。推广自己的详情与 P 联动分开：仅 mapping=matched、exact_source_identity、可靠 linkIdentity 才触发 P；京东跟单 SKU 联 SKU，天猫推广商品联 SPU。同文本不同维度、跨店、跨期多义映射不能猜配。

## 八分区与条件来源

| 分区 | 实际行为 | 来源门槛 |
| --- | --- | --- |
| 5.1 概览 | 花费、归因成交、ROI、展现/点击、CTR/CPC、源订单、主/辅费率及两种比较 | 完成批次、manifest/state/raw/shop/product 对账、字段存在与精确店日覆盖 |
| 5.2 趋势 | 投入产出/ROI/点击/CPC日周月，日期联动对象及增减贡献 | 真 0 与来源缺席有别；可核验空集合 0 只指完整导入来源未报告该身份 |
| 5.3 店铺 | 投入/份额/产出/效率/变化/覆盖，单店折叠 | 每店独立，跨店同 ID 不合并 |
| 5.4 商品 | 京东跟单 SKU 分摊视角或天猫推广商品；明细/整期详情/P 联动 | 映射唯一才进 P；缺 ID 留核查桶 |
| 5.5 计划单元 | 同名按精确源 ID 分开、花费/变化/贡献及真实关系 | 保留原 admin、京东志高商用设备旗舰店、1—7 天范围；原字段真实存在才 available |
| 5.6 关键词搜索词 | 词原文、所属计划单元/匹配方式及归因指标 | 同上；原词文本是来源身份，不冒独立平台词 ID；缺词不推造 |
| 5.7 诊断复盘 | 复用原 HTML/XLSX，观察事实/公开规则/证据/核查建议 | I 接线可选 ROI、allowPaidModel=false、expectedOwningRevision；原专项前等长基期独立标注，不冒页面 F 同月/同比导出 |
| 5.8 数据归因 | 金额订单定义、未知窗口、店日覆盖、来源版本/字段能力/映射与不可比项 | 京东总订单金额、天猫净成交分别标名；订单行/笔数不换客户；不推自然成交或利润/广告增量 |

所有读取前后均核验 actor/来源向量；版本变化返回 409，权限变化 403，前端清除旧范围与详情。65 秒完整 reader 预算包含首次 actor 和末次 actor，客户端 SDK/组件取消期限为 90 秒。真实付费解释、事项创建、保存负责人、自动停投/调预算不属于本栏目。
