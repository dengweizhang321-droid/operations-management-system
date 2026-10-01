# 店铺与平台对比 C v1

用户已定版方案1；顶部导航、字体、墨绿配色和日期控件复用系统公共板式。设计 Demo 与正式组件分离，正式页不引用 demo JS、夹具或私有日历。

当前为 M6 在途记录。正式开工父 main 为 `b7fafb482b39fb82382f7ab42e54175b89b9eece`，C 普通同步合并为 `ad4adb9cedd0f8a41128878fcea3b48ecaf503a0`。后续已普通同步实际公共 main `3fd373577815e59068217cc45a52e68153c50f01`（比较上下文/原子钻取/共享期限）和 `5d03b8ab8e85c659ad7890d038842ba048e9452c`（P series）。P/A 已验收依赖继承；C 保留获准的独立两期 current-only 投影，不改用 S 三期 series。本文件不是 C main 合并或生产采用回执。

## 六区交付范围

| 编号 | 实现 | 验证与条件 |
| --- | --- | --- |
| 3.1 | 完整精确候选配对后服务端分页，本期/独立基期/差额/变化/份额，持续对象贡献 | P/A 拥有方合计及实际 main ERP 原观察投影；完整性未知不混入完整排名。缺记录不能推导为退出或零值 |
| 3.2 | 指标矩阵、完整候选分布、列设置，无综合评分 | 比例合计分子分母；ERP 原订单号分组可观察，客户客单价与可信毛利/退货率仍需来源证明；商品日客户/访客非店铺 UV |
| 3.3 | 同指标真实日/自然周/月桶，绝对值及指数；ERP 单店原生序列已接线 | 每期第一个自然桶须完整且正；0、负或缺失不跳桶、不补零，长度不同不缩放金额。ERP 完整性未知不归一；平台原生分组待 I 实际 main |
| 3.4 | 每主图对象完整商品集合的标签/价格带/TOP5/TOP10/成交商品数 | 当前来源标签 cohort，不称官方/跨平台/历史分类；价格带按成交均价；同款映射未验证保持 unavailable |
| 3.5 | 花费/归因金额/ROAS/CTR/CPC/主整期费率及两期变化 | A 的 JD SKU/TM SPU 独立拥有范围；不同归因并列观察，不混排归因效率；错误不当缺数 |
| 3.6 | 两期完整授权候选并集、真实存在/字段覆盖/资格/原因及各参与版本 | 双 F 完整 envelope、C 附加覆盖和 A 所属 scope 全保；来源前后复验，不称分布式原子快照 |

## 请求与比较集合

固定只读 GET `/api/netshop/comparison-insights`，专属版本 `netshop-comparison-v1`。公共注册仅 I 单写。

- 继承 F 七键 platform/outlet/dimension/startDate/endDate/periodKind/snapshotToken。
- `comparisonScope` 为 `comparison-scope-v1`，仅 mode、metricSource、category、coverageFilter。分类为 all、unknown 或带精确 platform/sourceId/label/evidenceVersion 的 label_only；服务端复查真实来源版本和候选，caller 不能宣称 verified_id。
- `selectedBaseline` 独立 JSON：previous、yearAgo 或 custom(startDate/endDate)。用户两期分别是两份合法 F 的 current；每手动窗口不超过366日。F 原 previous/yearAgo、完整日历与覆盖字段不改名或裁剪。合法所属派生367日无法当第二个 F current，C 明确422，不截去一天。
- chartObjectKeys 最多4个真实候选精确键，只影响主图；店铺键为 `shop:`+平台/店铺复合键，平台键为 `platform:`+平台。平台与子店从不混排加总。
- 完整候选、汇总、分布与源覆盖不随 page 或 chartObjectKeys 改变。coverageFilter 仅控制查看页。完整对象在前，不完整与定义不可比对象分区查看，增长/下降排序只用有效比较值。
- 三张表共享一个服务端排名页：scale.items 是完整 row，efficiency.items 和 promotion.items 只是该页同序精确 objectKey 引用。浏览器解引用展示，不聚合、不遍历页。
- 整体2MiB、65秒后端期限（含 actor、两个 context、拥有方、序列化和末复验）、90秒前端同范围期限及最多2次完整读取；超限明确拒绝，不裁覆盖或候选。401/403 清除旧结果；409 完整恢复；迟到响应不能覆盖新范围。

## 指标定义

| 指标 | 来源与定义 |
| --- | --- |
| payment / quantity | P 商品日成交金额（整数分）/成交件数，完整集合合计 |
| visitors / customers / transactionOrders | P 商品×日累计；跨商品不证明去重店铺客户或订单 |
| conversion / visitorValue | 同源客户累计÷访客累计 / 成交分÷访客累计；后者独立 CNY_CENT_PER_COUNT 协议，非客单价 |
| spend / attributedPayment / roas | A 花费/所属归因金额/归因金额÷花费。京东成交订单额与天猫净成交额不同，归因窗口未知保留说明 |
| ctr / cpc / spendRate | A 点击÷展现 / 花费整数分÷点击 / paired-whole 同店同日完整商品分母费率；CPC 不先舍入 |
| erpNetSales / orderMargin / largeMargin / largeMarginAmount | 待 Sales 窄拥有方：净销售、订单毛利金额、大毛利率、原净额减原来源成本的金额；不复刻成本/仓库/退货算法，成本证据不足不称完整 |
| erpOrderCount / averageOrderValue | 仅可使用可靠订单身份的去重分母，source_line_key 不算真订单；旧件均净额不当客单价。当前尚未就绪时值为空 |
| returnQuantity / returnRate | 待 Sales 原退货件数及明确原分母，不用缺行推定零退货 |

比率差用共享百分点比较；其他同定义指标用共享相对变化。基期0或负不能强算增幅，绝对差额可在两期完整且同定义时保留。金额、数量与比例单位不互换。

## I 协调需求

公共 comparisonIntent（业务 URL 可分享）、comparisonPrefs（同账号历史绑定）、原 onApplyPeriod 和原 atomic onDrill 第四可选范围/返回已在实际 main `3fd37357` 冻结。C 直接消费公共 props，不使用临时 cast，不另建 router/history。P/A 目标已真实 main；S 在并行开发，最终合入前由 I 核验真实目标。

I 已批准在 C adapter 只读调用已 main P/A 拥有方窄 helpers。P：_source/_base/_window_rows/_cohort/_annotations/_metrics/_extra_metrics/_visitor_value/_category_evidence/_counts/_derived_buckets/_share/_money。A：_validate/_read_facts/_Reader.totals/_metric。范围、日期和名字均从 validated F/真实 actor 取，保留字段 presence、原比率与覆盖，不复制 SQL 或利润算法。未来 owning API v1 变动需 C 组合回归。

Sales provider 尚未冻结时为 dependency_pending，不称已验缺源；不得复制其他树 WIP、旧500排行或93天管理员页替代两期全集。缺分类映射时 ERP/A 不回退全店、按成交份额摊广告或猜同名商品。

## 证据与交接状态

设计：demo/evidence 的31项及独立复核为合成设计验收，继承不冒正式查询验收。正式 API `readComparisonApi` 与 `loadComparisonInsights` 均等待完整异步 `decodeComparisonInsights`：完整双 F/参与向量/单位/资格/自然桶验证后，以现有 `mappingHash` 的 native SHA 核对 Python `_canonical_token(objectKey)[:16]` 的引用家族，禁止借用其他期、对象或趋势桶。没有新增 wire 字段、裁剪来源，解析及验证 CPU 计入同一90秒。C 另加原始 F 日期与 capability 枚举类型检查，已交 I 协调共享类型收紧。

- Query 作者 clean `f243ac55fcb7f7ac377860c919e37e12a8c91e89`，实际 `3fd37357` 同源42PG（39C＋3公共 nested deadline）通过；E 独占 `comparison/query/comparison-pg-6c37f2924fb9553b6ee2`。6万合成事实/50店/两期30日：3.692秒、221 SQL、2,031,964 UTF8字节。真实 transition 样本单测在 `comparison-pg-43cdc1f46c283e92d13d`，未修改原样本。
- Page 作者 clean `ec13ba9cb6015680609448d9c58cad448f8a4bb8`，actual main＋严格 async decoder 下真实平台展开18、真实分类切换19、合法字段重排书签19项 UI 检查分别通过（不是相加的独立用例数）；桌面/390/320实际字形≥12、双月、局部滚动、粘列和弹层几何通过。67份忽略证据/16历史 UI run 已 SHA 保全至 `comparison/page/handoff-20261001T032923791Z-db7b095d-1b24-43c3-8e7a-0de6c626f592`，manifest `24b73b1b4c7facd0188d907b42172284a07699821e83e55240f174f329730b1c`。
- Q 独立42PG在自己的 `comparison-pg-3c52ab818391733ff266` 通过、正常停止、源文件前后 SHA 稳定；result SHA `40969f7b2f88156525d2751ea492375364b9adb00c90dcdb0e1cefe9da8248b7`。Q 原先可复现的 enum、vector、coverage、借 ref、单位、分页/自然桶与 F 日期强转问题已逐项修复，最后固定组合复核仍在途。
- Root 最新 C＋公共导航30 Node 通过；P/A＋C边界64 Node 历史组合通过。各次失败证据保留。全库类型188项已在公共 main 重现，C 作者无新增；仍须对 I 最终注册组合复验。性能不是生产 P95。

尚待：Sales 验收/注册/SDK 实际 main 后接 ERP，C 后端/Worker/column 公共注册、S 真目标落主线、真正 Home 钻取/返回和角色验证、最终独立 Q；不能以上述作者 UI 或 Q SQL 代替这些门槛。没有复制未提交代码或把样本接入正式页面。

## ERP-period稳定增量（非M6终验）

实际 main `49306356b22b8c8ea6925f1d0f874dc45f5a31fb` 已普通同步，替代上段 Sales 未注册状态。C 使用已注册 `netshop.sales_periods_client.read_sales_periods`，两独立窗口和最多50个已证明 RAW 三元组；无渠道/非注射/分类未映射不发空全集查询。原时间序列仍待 I 拥有方 opt-in series 的实际 main，暂为 dependency_pending，绝不按总额配日。

- 22nd `erpNetQuantity` 与 `returnQuantity` 使用 C 专属 `netshop-comparison-native-quantity-v1` / `NATIVE_INTEGER_QUANTITY`，保持原生整数与符号，不能称 P 件数、订单或共享 COUNT。公比较偏好22键为 I 候选，实际 main 未发布前页面选择器仅实际已冻结的21键，矩阵/证据已支持22。
- ERP 净额/原生数量/原订单号分组仅已导入记录观察；成本、大毛利金额及可能写链重算的存储毛利为 partial/unverified_source。主毛利率、退回率与客单价不升可信；`CNY_CENT_PER_ORDER` 原观察均值只保在完整拥有方证据展开。
- erpEvidence 保完整 owner source/request/metricMetadata/observations/mapping 和唯一参与 sales pair。记录日期未知完整性不塞 F 店日 complete；未知计数为 null，无源不补0。主数值逐项回绑拥有方 periodTotals/精确RAW item，观察日期/对象/字段原因亦绑定，业务请求不允许控制内部expiry。
- 初读及序列化后 ONE 同expectedRevision/snapshotToken末核用同65秒；503清 ERP 值/源/向量后一次重建 P/A可信结果，401/403/409与全读过期整体失败关闭。A 原F覆盖与所有动态 C 覆盖各只传一份；无值 ERP temporal 点共用整期能力引用，不称桶覆盖。
- Query 子提交 `32afa6e44badadb56a31205745f094e786d71f04`：55PG通过、12形状定向再验通过；50店/6万事实/两期30日，3.846秒、221SQL、完整默认JSON 1,687,138 bytes。E/query `comparison-pg-87c764cbf492a93d8cf4` 全样本及计划、`comparison-pg-d3cac38b25af300a6637` 最新ERP/zero样本；全部数据库正常停止，三次容量失败原样保留。
- Page 子提交 `425e6352bce70240543508e279db8e3feb9f9d5d`：原样ERP和存0案例各19作者UI通过，非签名HTTP/Q/真正Home；85份忽略文件/21历史run已保全，manifest `f67188ba3c9eca7e16c6dc2078dd9ac4e088efafe1c473d75dc37bb86edd7ac0`，E/page `handoff-20261001T053621727Z-f5bf5da5-75cd-496b-8007-0559cd4ab6fd`。
- Root 37 Node与target lint通过。Q本阶段独立PG16、Node37、12完整原DTO正向/11否定检查、新ERP与zero UI各20通过，原投影/观察绑定P2和expiry问题在 `962797da` 修复后已关闭。签字范围为 `221fcf1d4fbab41c31f2ee8c3d39aa84b6e28004`，后继仅HANDOFF文档；报告 E/review `erp-phase2-20261001T052200Z-03a1ec1c1e774e6d9876764ec4d2c8fb/independent-review-erp-period-final.json`，SHA `2c81d7cc540f7b5b68e8e0427242e649bf7697c16401a72e4af11cbb408385e2`。这次新增ERP renderer和decoder有独立复验，未以旧21/前阶段Q42或HMAC支撑代替。

尚待 I 新系列 actual main、公共22键实际冻结、最新完整源/页面独立Q、I真正Home/签名HTTP组合。C一期21来源与本期22证据严格分层，未读生产经营数据或执行生产操作。

所有写代码 Teammate 独立工作树。只推 C 栏目分支；main 合并与最后资源/工作树清理由 I 协调。本轮未部署、操作生产数据库、启停正式服务、迁移、真实导入或发送。

## ERP单店原生趋势增量（M6仍在途）

总控确认的实际 main `a845eb560acc6a1803282de3c826acd1a153dabe`（含 `9404d3c3` 原生series）已普通合到C。Query `9051d4a0048bc0806688baf55930aa2a99fc3e73` 和Page业务 `7e35888356f67c72b1372d20f8f9351d0d1d7303` 普通集成在功能组合 `e47f5c6550bd238a103803debbf8fafb4e57b1a5`；Page专属harness交付 `7a4714b031e118aa724c766085f0f692441cfced` 后正常合为 `25f738e62ed9ba11ab20725c15d27ca0082e84df`，没有改前端业务文件。

- 同一65秒期限：prime完整ERP两期授权候选（page1/pageSize100、最多50、核无截断）→只从其真实union选1–4绘图RAW→固定prime pair的opt-in native series→完整C序列化后同pair、新series snapshot复核。第二次不借prime旧snapshot，也不按桶发RPC或刷新预算。无ERP记录的F候选仍保留，null/no_records不是业务0。
- 原ERP tuple由拥有方restore helper还原；各桶有真实期/对象/日期观察引用，0、负与缺桶保留。周为周一至周日、月为自然月并剪原窗口首尾；订单为每RAW身份及桶内原ERP订单号去重，非日计数相加。原始数量、成本未核验、记录完整性未知与原均值口径保持。
- 平台趋势新增接口由I协调，当前仅该能力为 `platform_series_dependency_pending`；C不复制平台金融/订单聚合。当前公共偏好仍21键，22键矩阵与原始证据保留，等待I正式冻结选择器键。
- 作者PG14通过并正常停止，原样day/week/month C DTO及每次RPC请求在 `E:/codex-artifacts/netshop-scheme2-20261001/comparison/query/comparison-pg-4221637a57c6c082bab8`；对应186256/148829/141444 UTF8字节。Root原样3grain正向和新增5项借桶/引用/原值否定检查通过；与原32合同、5公共导航构成42项相关Node。Target lint通过，类型仍188继承、C0。
- 非作者Q在e47独立PG18、Node42、3grain原wire及20独立反例、新页面各粒度19项通过；源码17文件前后hash稳定、私有PG和3191均正常停止。中间报告在 `E:/codex-artifacts/netshop-scheme2-20261001/comparison/review/temporal-stage3-20261001T072700Z-bbc1849d0e9948e0a56aaee173e4427e/e47-shop-temporal-independent-interim.json`。这不是后继容量投影或整个M6签字。
- Page原样3grain各21作者UI通过，不相加冒独有63项；新增零/负/缺桶、未知完整性/禁归一、日期与返回、实际字形与320/390布局均验。107份忽略文件/26历史run逐hash保全至 `E:/codex-artifacts/netshop-scheme2-20261001/comparison/page/handoff-20261001T082446005Z-81cc78a7-2964-4730-8ea7-03fcfbfbbcbf/manifest.json`，SHA `99a5d5638b9283c53d7100dc2c43831377dcb0f86c6b1a7c51df1d5e7c09841c`；失败旧harness断言证据也保留。私有3171/Chrome已关闭，用户3170静态设计保留。

最大范围是有界能力，不承诺所有日期/对象组合均能在2MiB内返回。4RAW×独立双366天日图的完整C JSON在停止构造未参图P/A桶后仍为3,834,050 bytes，必须明确422，原尺寸细分与两次失败正常停止证据保留（`comparison-pg-9571806c2def34419e1d`、`comparison-pg-b1db989a28ddb61640d9`）。不裁参与证据、抬预算或默缩窗口；总控已确认以最大真实负向加实际4RAW×双120天正向及50店/6万事实/双30日最终回归验收。后继projection、该正向规模、平台新main、公开22键、C签名HTTP和真正Home组合仍待最终交接，不能由本阶段样本替代。

### 单店趋势最终容量回归

Query最终clean `1949e30d4d857ca8e32b35aef20c78ecd88ec8eb` 已普通集成；其 `fc75e0e3` 只在ERP主图时停止构造未参与response的P/A图桶及附加覆盖。双F原完整carrier、各源整期缺日、主汇总/排名/结构P/A指标和覆盖、ERP每桶实际原值/观察、完整候选和参与向量不裁。2MiB错误仍422，明确提示缩短期间、切换周/月或减少主图对象。

最终实际fe47源的ERP16＋原50店代表1，共17定向PG通过，9文件before/after稳定，全部正常停止。原样8正向DTO与RPC层在 `E:/codex-artifacts/netshop-scheme2-20261001/comparison/query/comparison-pg-77bb0b3c9a9cd0ac8dcf`；Root全量await解码8/8、相关Node42通过；测试golden在 `17313a6ec23b23d367d0a83a1e8f54aae27fe893` 换成最新原样三粒度，没有编造数值。

| 实际场景 | 结果与限制 |
| --- | --- |
| 4RAW、两期各120日、日图960点 | 1,381,346 bytes，1.219秒，3次同期限RPC，通过 |
| 4RAW、两期各366日、日图 | 完整3,834,050 bytes，真实容量负向422；原先正向失败及尺寸细分保留 |
| 同366日、周图428点 | 1,501,563 bytes，2.398秒，3次同期限RPC，通过 |
| 同366日、月图104点 | 1,199,640 bytes，2.587秒，3次同期限RPC，通过 |
| 50店、6万事实、两期30日 | 1,783,606 bytes，3.657秒，221 SQL，通过；非生产P95 |

平台source、公共22键、S实际main/真实Home与C签名HTTP仍待I；本条只是单店原生趋势与容量回归收执，最终独立后继签字另附，不冒整个栏目完成。
