# S 对 A 候选契约的消费准备

2026-10-01。只读指定 Git blob `6f6c8d4720eaec87f96c861ba181733b7e8a3081:docs/netshop-refactor/promotion/contract-v1.md`，没有读取/复制在途源码、运行候选或创建S实现。该文档明确为M4候选；作者35 PG/40 Node不是S复核或main验收。只读远端main仍为 `39bc403a5385cb4766c45b0c670bd4c65f96b9b8`。S既有 `2e4031d9` M2准备与 `a4428e54` 单01设计继承，候选不是M5正式父提交。

候选声明 `/api/netshop/promotion-insights` 信封含 `columnVersion=netshop-promotion-v1`、M2 context、A sectionToken与sections，拟由 `decodePromotionInsightsForQuery(payload, requestQuery, owningRevisionHeader)` 校验。这里只记录契约；等A合main后的准确类型/字段/decoder交接，不用TS assertion或同名预留类型代替校验。

## 八章消费矩阵

| S章节 | A候选声明可供消费的内容 | S边界 / 仍需交接 |
| --- | --- | --- |
| 2.1经营成绩 | summary/comparisons/changes/attribution，原整期花费、归因成交及变化 | q和对象日期聚焦不改摘要；与平台成交、ERP净额分组。不能把归因成交当店铺成交或自然增量，不能由广告额推利润 |
| 2.2流量成交 | 广告展现、点击、CTR、CPC原口径 | 广告点击不作付费访客/店铺UV，不能拼商品访客漏斗；商品搜索/收藏/加购/支付仍由P来源能力证明 |
| 2.3商品结构 | items/contributions/listScope及可靠linkIdentity，可关联重点推广对象 | 完整可比集合先配对再Top10/搜索/分页；未知身份桶不跨期比较。同文本/跨店/不同维度不猜配，不能将不同对象视角求和；S商品表q仍消费P，不能改成A对象搜索 |
| 2.4推广经营 | summary/comparisons/changes/attribution、shops、matchedRange、对象与趋势行为 | 主费率只用完整范围`:paired-whole`；matchedRange仅独立辅助subset，绝不替主值。单店shops比较收起但不丢来源；趋势字段的准确wire名待最终A交接 |
| 2.5毛利退货 | A花费与归因可独立对照ERP结果 | ROI是归因成交/花费倍数，内部roas；不当利润ROI、不擅自扣入ERP订单毛利/大毛利、不能替财报利润。跨域权限与成本/仓库规则沿M2准备请求 |
| 2.6客户企业购 | 没有新的客户/B2B来源证明 | 广告订单行/净成交笔数不换成买家；不能从对象身份、商品名或unknown计数推客户去重、复购、B端份额 |
| 2.7目标复盘 | 原诊断/HTML/XLSX行为，可作独立入口 | 原admin/京东志高商用设备旗舰店/1—7天限制保留，不自动缩店或周期。原专项前等长基期独立标注，不称全景F同月/同比报告；allowPaidModel=false、不创建事项或外发 |
| 2.8数据口径 | sourceMatrix/objectCapabilities/context.sourceRevisions/attribution与主辅覆盖 | canQuery是资格，不是字段事实；unidentifiedCount=null保持未核验，不能补0，也不能等同ERP未映射商品数。未知归因窗口、金额/订单定义、字段和映射分别披露 |

## 必须单独保留的维度、范围与版本

1. **同店同周期不等于同维度。** A一次只选一个平台，京东固定SKU、天猫固定SPU。S商品章沿P默认SPU；京东A主费率分母是SKU日报，不是S的SPU成交。S须保留A维度与分母标签，不用SPU金额重算A主费率，不把SKU/SPU相加。仅按P证明的可靠、适用期间的SKU→SPU关系聚合或展示关联；否则保持独立SKU推广对象。
2. **摘要与列表焦点分离。** A q只改对象列表；focusDate或完整objectStartDate/objectEndDate二选一，只影响对象期及其F日历比较。summary/趋势/shops保留原整期。S日期定位不顺手缩短全景成绩；来源本期/基期与完整/焦点范围均明确。
3. **主辅费率不可交换。** 主`:paired-whole`引用完整期；辅`:matched`以真实shopDates为expected/covered。零匹配0/0是覆盖不完整、费率不可用，不是0%或整期完整。
4. **A信封不删上下文。** A的SKU context/scope、columnVersion、sectionToken、覆盖与向量须一并验证保留。不能只塞A.sections到SPU context后假称同scope，也不能把context snapshotToken当A sectionToken或owning revision。专属全景joined向量保留参与scope/kind，仍按S008由I冻结校验。
5. **CPC独立协议。** 候选沿main39bc共享 `netshop-money-per-count-v1`，整数分/真实点击数的未舍入商，展示元/点击。不能强塞旧CNY_CENT整数MetricValue、截断/四舍五入底层商或改旧协议；具体wire字段/类型/显示适配待A/I正式交接。
6. **对象ID与跳转分别处理。** A自身详情也须同范围、可靠且非null的来源身份才可读；objectId使用所属版本rowKey（不是可展示业务ID），同时带shopKey、objectKind、sectionToken；详情读取原整期且禁列表日期焦点。只有mapping=matched、exact_source_identity、可靠linkIdentity三项成立才进P：京东跟单SKU进SKU，天猫商品进SPU；返回S恢复原SPU/范围/q/页码。

现M2 `StorePanoramaDTO.promotion`核心只写A sections；正式接线前S003/S008需I兼容承载A已验证信封或完整上下文引用，保留不同dim的coverage/token。现shared onDrill/ShopLocationContext也不能据此假称已支持A对象详情/日期焦点状态；S首先只做同店同周期推广专题入口，若增加对象深链由I冻结本地导航/返回协议。

## 接入前待核与最小请求

- I交接P/M3和A/M4都在main的准确父SHA、实际可消费函数/DTO/decoder；本候选说明不解锁M5。
- A正式保证全scope summary与焦点/q list相互独立、主辅coverage引用匹配；S不自行重算分布、TOP或费率。
- I冻结S promotion子信封/不同维度向量与CPC新类型的适配，维持90秒客户端/65秒完整reader含actor前后、366天/50店/2MiB等边界。不同token种类不作整串相等比较。
- 精确kind/id/店/日期/版本的对象→P跳转与返回由I接线；category字典未有前不传给A，更不复制SPU类目来筛SKU对象。
- 跨域sales/finance/workflow权限、精确channel/别名、财报/事件consumer及批次/快照缺口继续按[M2准备](M2-PREPARATION-20261001.md)，不因A候选ready扩大权限。

正式联调时验证：JD SPU商品范围＋A SKU范围并存；SPU/SKU金额不同不误重算；完整费率无值而matched有效/0匹配；q/焦点不改总摘要；同名/跨店/跨维/未知身份；object rowKey不作业务ID；上下文/token/来源向量/actor变更409/403后清旧详情；计数null与canQuery不冒已核字段；专项限制及报告基期不同。当前没有运行这些联调或再次运行旧设计验收。

本轮仅新增角色准备文档；没有新Teammate分支/工作树、共享文件写入、候选合并/采纳、主线推送、UI/数据库/生产操作或外发。正式起步继续等I通知。

只读文档复核通过、未决0；候选契约blob摘要与角色链接已核。复核未读取A实现源码、运行测试或写入文件，不构成M4/M5功能验收。
